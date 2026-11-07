import asyncio
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch

import httpx

from ai.main import app, provider_client
from ai.test_evaluate import EvaluatorTestCase, completion, ollama


class GraphParityTests(EvaluatorTestCase):
    def test_same_responses_for_repair_failure_timeout_and_splits(self):
        self.data["checklist"]["criteria"][0].update(allow_na=True, na_rule="No contact was possible.")
        self.use_judges(
            *({"name": name, "provider": "ollama", "model": name} for name in ("a", "b", "c")),
            execution="parallel", timeout_seconds=2, judge_timeout_seconds=.5,
        )

        def grade(model, value="yes"):
            return ollama([dict(self.binary, value=value), self.scale], model)

        async def stall():
            await asyncio.sleep(1)
            return grade("c")

        def bad(model):
            return ollama([dict(self.binary, evidence_turn_ids=["not-a-turn"]), self.scale], model)

        scenarios = {
            "repair": lambda: {"a": [bad("a"), grade("a")], "b": [grade("b")], "c": [grade("c")]},
            "invalid": lambda: {"a": [bad("a"), bad("a")], "b": [grade("b")], "c": [grade("c")]},
            "timeout": lambda: {"a": [grade("a")], "b": [grade("b")], "c": [stall]},
            "below-quorum": lambda: {"a": [grade("a")], "b": [httpx.ConnectError("down")], "c": [httpx.Response(500)]},
            "split-2-1": lambda: {"a": [grade("a", "no")], "b": [grade("b")], "c": [grade("c")]},
            "split-1-1-1": lambda: {"a": [grade("a", "na")], "b": [grade("b")], "c": [grade("c", "no")]},
        }
        for name, routes in scenarios.items():
            with self.subTest(name=name):
                results = []
                for engine in ("legacy", "langgraph"):
                    with patch.dict(os.environ, {"EVALUATOR_ENGINE": engine}):
                        response = self.post(routes=routes())
                    results.append((response.status_code, response.json()))
                self.assertEqual(*results)

    def mock_transport(self, *, stall=None, fail=False):
        async def handle(request):
            if request.method == "GET":
                return httpx.Response(200)
            if stall:
                await stall()
            if fail:
                return httpx.Response(502)
            return completion([self.binary, self.scale])

        async def mock_provider():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
                yield client

        app.dependency_overrides[provider_client] = mock_provider

    def stream(self, data):
        async def send():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                async with client.stream("POST", "/evaluate/stream", json=data) as response:
                    lines = [line async for line in response.aiter_lines()]
                    return response.status_code, response.headers["content-type"], [json.loads(line) for line in lines]
        return asyncio.run(send())

    def test_stream_success_and_single_final_error(self):
        for engine in ("legacy", "langgraph"):
            with self.subTest(engine=engine), patch.dict(os.environ, {"EVALUATOR_ENGINE": engine}):
                self.mock_transport()
                status, mime, lines = self.stream(self.data)
                self.assertEqual((status, mime), (200, "application/x-ndjson"))
                events = ["started", "judge_started", "judge_finished", "result"] if engine == "langgraph" else ["started", "result"]
                self.assertEqual([line["event"] for line in lines], events)
                self.assertEqual(lines[0], {"event": "started", "judges": ["solo"]})
                self.assertEqual(set(lines[-1]["result"]), {"mode", "model", "grades"})
                self.assertEqual(lines[-1]["result"]["grades"], [self.binary, self.scale])
                if engine == "langgraph":
                    self.assertEqual(lines[-2]["grades"], [self.binary, self.scale])
                self.mock_transport(fail=True)
                _, _, lines = self.stream(self.data)
                self.assertEqual([line["event"] for line in lines], events[:-1] + ["error"])
                self.assertEqual(lines[-1]["error"]["code"], "provider_error")
                self.assertEqual(lines[-1]["status"], 502)
                if engine == "langgraph":
                    self.assertEqual(lines[-2]["error_code"], "provider_error")
                    self.assertNotIn("grades", lines[-2])

    def test_stream_configuration_and_validation_fail_before_ndjson(self):
        self.mock_transport()
        self.judges_file.unlink()
        status, mime, lines = self.stream(self.data)
        self.assertEqual((status, mime, lines[0]["error"]["code"]), (503, "application/json", "provider_unavailable"))
        status, mime, lines = self.stream({})
        self.assertEqual((status, mime, lines[0]["error"]["code"]), (422, "application/json", "invalid_request"))

    def test_disconnect_cancels_active_judge_and_never_admits_next(self):
        self.use_judges(
            {"name": "first", "provider": "llama.cpp", "model": "test-model"},
            {"name": "second", "provider": "llama.cpp", "model": "test-model"},
        )

        async def exercise():
            started = asyncio.Event()
            cancelled = asyncio.Event()
            calls = 0

            async def stall():
                nonlocal calls
                calls += 1
                started.set()
                try:
                    await asyncio.sleep(30)
                finally:
                    cancelled.set()

            self.mock_transport(stall=stall)
            sent_request = False

            async def receive():
                nonlocal sent_request
                if not sent_request:
                    sent_request = True
                    return {"type": "http.request", "body": json.dumps(self.data).encode(), "more_body": False}
                await started.wait()
                return {"type": "http.disconnect"}

            async def send(_message):
                pass

            scope = {
                "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1",
                "method": "POST", "scheme": "http", "path": "/evaluate/stream",
                "raw_path": b"/evaluate/stream", "query_string": b"", "root_path": "",
                "headers": [(b"content-type", b"application/json")],
                "client": ("127.0.0.1", 50000), "server": ("localhost", 8001),
            }
            await asyncio.wait_for(app(scope, receive, send), 3)
            self.assertEqual(calls, 1)
            await asyncio.wait_for(cancelled.wait(), 1)

        with patch.dict(os.environ, {"EVALUATOR_ENGINE": "langgraph"}):
            asyncio.run(exercise())


class TracingTests(unittest.TestCase):
    def test_default_overrides_tracing_and_explicit_opt_in_is_preserved(self):
        code = 'from ai.graph import graph; import os; print(os.environ["LANGSMITH_TRACING"], os.environ["LANGCHAIN_TRACING_V2"])'
        env = dict(os.environ, LANGSMITH_TRACING="true", LANGCHAIN_TRACING_V2="true", EVALUATOR_ALLOW_TRACING="false")
        self.assertEqual(subprocess.check_output([sys.executable, "-c", code], env=env, text=True).strip(), "false false")
        env["EVALUATOR_ALLOW_TRACING"] = "true"
        self.assertEqual(subprocess.check_output([sys.executable, "-c", code], env=env, text=True).strip(), "true true")
