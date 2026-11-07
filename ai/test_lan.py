import asyncio
import io
import json
import os
from contextlib import redirect_stdout
from time import perf_counter
from unittest.mock import patch

import httpx

from ai.doctor import check
from ai.main import app, provider_client
from ai.test_evaluate import EvaluatorTestCase, ollama


class LanTests(EvaluatorTestCase):
    def hosts(self, hosts=(11431, 11432, 11433), fallbacks=None, **panel):
        fallbacks = fallbacks or {}
        self.use_judges(*(
            dict(name=f"j{i}", model=f"m{i}", provider="ollama", url=f"http://lan.test:{port}",
                 **fallbacks.get(i, {}))
            for i, port in enumerate(hosts, 1)
        ), **panel)
        self.events = []
        self.gets = []
        self.chat_delay = {}
        self.dead = {}
        self.bad_chat = {}
        self.votes = {}
        self.warmups = []

    async def handle(self, request):
        port = request.url.port
        path = request.url.path
        if request.method == "GET":
            self.gets.append((port, path))
            if self.dead.get(port) == "connect":
                raise httpx.ConnectError("private address")
            if self.dead.get(port) == "timeout":
                await asyncio.sleep(3)
            if path == "/api/version":
                return httpx.Response(200, json={"version": "stub"})
            names = ["m1", "m2", "m3", "backup"] if path == "/api/tags" and port != 11431 else ["m2", "m3"]
            return httpx.Response(200, json={"models": [{"name": f"{name}:latest"} for name in names]})
        body = json.loads(request.content)
        model = body["model"]
        if path == "/api/generate":
            self.warmups.append((port, body))
            return httpx.Response(200, json={"done": True})
        self.requests.append(body)
        self.events.append(("start", model, port))
        try:
            await asyncio.sleep(self.chat_delay.get(model, .015))
            if model in self.bad_chat:
                raise self.bad_chat[model]
            value = self.votes.get(model, "yes")
            return ollama([dict(self.binary, value=value), self.scale], model)
        finally:
            self.events.append(("end", model, port))

    def send(self, method="POST", path="/evaluate", **kwargs):
        async def mock_provider():
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.handle)) as client:
                yield client

        async def request():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                return await client.request(method, path, **kwargs)

        app.dependency_overrides[provider_client] = mock_provider
        return asyncio.run(request())

    def evaluate(self):
        with patch.dict(os.environ, {"EVALUATOR_EMIT_PANEL": "true"}):
            return self.send(json=self.data)

    def test_different_hosts_overlap_and_probe_cache_is_reused(self):
        self.hosts()
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual([event[0] for event in self.events], ["start"] * 3 + ["end"] * 3)
        self.assertEqual(len(self.gets), 3)
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(len(self.gets), 3)

    def test_auto_limits_same_host_and_parallel_does_not(self):
        for execution in ("auto", "sequential", "parallel"):
            with self.subTest(execution=execution):
                self.hosts((11431,) * 3, execution=execution, early_exit=False)
                response = self.evaluate()
                self.assertEqual(response.status_code, 200)
                shape = ["start", "end"] * 3 if execution != "parallel" else ["start"] * 3 + ["end"] * 3
                self.assertEqual([event[0] for event in self.events], shape)
                self.assertEqual([model for event, model, _ in self.events if event == "start"], ["m1", "m2", "m3"])

    def test_early_exit_only_skips_queued_shared_host_after_quorum(self):
        self.hosts((11431,) * 3)
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        report = reply.json()["panel"]["judges"]
        self.assertEqual([row["status"] for row in report], ["ok", "ok", "skipped"])
        self.assertIsNone(report[2]["error_code"])
        self.assertNotIn("m3", [model for _, model, _ in self.events])
        self.hosts((11431,) * 3, quorum=3)
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual([row["status"] for row in reply.json()["panel"]["judges"]], ["ok"] * 3)

    def test_fallbacks_share_actual_host_and_override_model(self):
        self.hosts(fallbacks={
            2: {"fallback_url": "http://lan.test:11431", "fallback_model": "backup"},
            3: {"fallback_url": "http://lan.test:11431"},
        }, early_exit=False, keep_alive=0)
        self.dead = {11432: "connect", 11433: "connect"}
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(self.events, [
            (event, model, 11431) for model in ("m1", "backup", "m3") for event in ("start", "end")
        ])
        reports = reply.json()["panel"]["judges"]
        self.assertEqual([(r["host"], r["fallback"], r["model"]) for r in reports], [
            ("http://lan.test:11431", False, "m1"), ("http://lan.test:11431", True, "backup"),
            ("http://lan.test:11431", True, "m3"),
        ])
        self.assertTrue(all(request["keep_alive"] == 0 for request in self.requests))

    def test_dead_host_fails_fast_and_panel_reports_failed_judge(self):
        self.hosts()
        self.dead[11431] = "timeout"
        started = perf_counter()
        reply = self.evaluate()
        self.assertLess(perf_counter() - started, 2)
        self.assertEqual(reply.status_code, 200)
        panel = reply.json()["panel"]
        self.assertEqual(panel["quorum"], 2)
        self.assertEqual(panel["agreement"], 1)
        self.assertEqual(panel["judges"][0], {
            "name": "j1", "host": "http://lan.test:11431", "provider": "ollama", "model": "m1",
            "fallback": False, "status": "failed", "error_code": "provider_unavailable", "seconds": None,
        })
        self.assertNotIn("j1", panel["votes"][0]["ballots"])

    def test_read_timeout_does_not_switch_to_fallback(self):
        self.hosts(fallbacks={1: {"fallback_url": "http://lan.test:11432", "fallback_model": "backup"}})
        self.bad_chat["m1"] = httpx.ReadTimeout("private detail")
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        first = reply.json()["panel"]["judges"][0]
        self.assertEqual((first["status"], first["error_code"], first["fallback"]), ("failed", "provider_timeout", False))
        self.assertNotIn("backup", [model for _, model, _ in self.events])

    def test_per_judge_timeout_starts_on_admission(self):
        self.hosts((11431, 11431, 11433), judge_timeout_seconds=.10)
        self.chat_delay = {"m1": 1, "m2": .04}
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual([r["status"] for r in reply.json()["panel"]["judges"]], ["failed", "ok", "ok"])

    def test_panel_budget_caps_running_judge_and_skips_waiting_judge(self):
        self.hosts((11431, 11431, 11433), quorum=1, timeout_seconds=.15)
        self.chat_delay["m1"] = 1
        with patch("ai.panel.MIN_START_SECONDS", .05):
            reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual([r["status"] for r in reply.json()["panel"]["judges"]], ["failed", "skipped", "ok"])
        self.assertNotIn("m2", [model for _, model, _ in self.events])

    def test_agreement_and_votes_follow_checklist_and_yaml_order(self):
        self.hosts()
        self.votes["m2"] = "no"
        reply = self.evaluate()
        self.assertEqual(reply.status_code, 200)
        panel = reply.json()["panel"]
        self.assertEqual(list(panel), ["quorum", "agreement", "judges", "votes"])
        self.assertAlmostEqual(panel["agreement"], 5 / 6)
        self.assertEqual(panel["votes"][0], {
            "criterion_id": self.binary["criterion_id"], "value": "yes", "agreement": 2 / 3,
            "ballots": {"j1": "yes", "j2": "no", "j3": "yes"},
        })
        self.assertEqual([row["name"] for row in panel["judges"]], ["j1", "j2", "j3"])

    def test_health_is_liveness_and_judges_reports_primary_and_fallback(self):
        self.hosts(fallbacks={3: {"fallback_url": "http://lan.test:11432"}})
        self.dead[11433] = "connect"
        self.assertEqual(self.send("GET", "/health").json(), {"status": "ok"})
        self.assertEqual(self.gets, [])
        started = perf_counter()
        response = self.send("GET", "/judges")
        self.assertLess(perf_counter() - started, 3)
        self.assertEqual(response.status_code, 200)
        report = response.json()
        self.assertEqual((report["execution"], report["quorum"], report["timeout_seconds"]), ("auto", 2, 540))
        self.assertFalse(report["judges"][0]["model_available"])
        self.assertTrue(report["judges"][1]["model_available"])
        self.assertEqual(report["judges"][2], {
            "name": "j3", "provider": "ollama", "model": "m3", "host": "http://lan.test:11433",
            "reachable": False, "model_available": None, "fallback_host": "http://lan.test:11432",
            "fallback_reachable": True,
        })

    def test_warmup_sends_keep_alive_without_grading(self):
        self.hosts(keep_alive="20m")
        response = self.send(path="/warmup")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.warmups), 3)
        self.assertTrue(all(row["keep_alive"] == "20m" and "prompt" not in row for _, row in self.warmups))
        self.assertFalse(self.requests)

    def test_doctor_prints_actionable_hints_and_exits_below_quorum(self):
        self.hosts()
        self.dead = {11432: "connect", 11433: "timeout"}

        async def diagnose():
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.handle)) as client:
                return await check(client)

        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(asyncio.run(diagnose()), 1)
        for expected in ('version="stub"', "OLLAMA_HOST=", "Wi-Fi client isolation", "ollama pull m1", "0/3 usable"):
            self.assertIn(expected, output.getvalue())
        self.assertNotIn("private address", output.getvalue())
