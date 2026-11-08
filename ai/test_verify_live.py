import unittest
from unittest.mock import patch

import httpx

from ai.verify_live import submit


class LiveVerifierTests(unittest.TestCase):
    def check_calls(self, script):
        calls = []

        def handle(request):
            method, path, status, body = script[len(calls)]
            calls.append((request.method, request.url.path))
            self.assertEqual(calls[-1], (method, path))
            return httpx.Response(status, json=body)

        with httpx.Client(base_url="http://backend", transport=httpx.MockTransport(handle)) as client:
            result = submit(client, {"conversation_key": "c", "checklist_version_id": "v"}, timeout=20)
        self.assertEqual(len(calls), len(script))
        return result

    @patch("ai.verify_live.sleep")
    def test_jobs_are_polled_and_evaluation_is_read_once(self, sleep):
        status, body = self.check_calls([
            ("POST", "/evaluation-jobs", 202, {"id": "job", "status": "queued"}),
            ("GET", "/evaluation-jobs/job", 200, {"id": "job", "status": "running"}),
            ("GET", "/evaluation-jobs/job", 200, {"id": "job", "status": "succeeded", "evaluation_id": "run"}),
            ("GET", "/evaluations/run", 200, {"id": "run"}),
        ])
        self.assertEqual((status, body), (200, {"id": "run"}))
        self.assertEqual(sleep.call_count, 2)

    def test_missing_jobs_route_uses_v1(self):
        self.assertEqual(self.check_calls([
            ("POST", "/evaluation-jobs", 404, {"detail": "Not Found"}),
            ("POST", "/evaluations", 201, {"id": "run"}),
        ]), (201, {"id": "run"}))

    def test_failed_job_never_submits_a_duplicate(self):
        self.assertEqual(self.check_calls([
            ("POST", "/evaluation-jobs", 202, {"id": "job", "status": "failed", "error": {"code": "provider_error"}}),
        ]), (502, {"error": {"code": "provider_error"}}))
