"""Exercise the evaluator against three Ollama-compatible HTTP stubs on loopback ports."""

import asyncio
import json
import os
import tempfile
import threading
from contextlib import ExitStack, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter, sleep

import httpx
import yaml

from ai.doctor import probe_input
from ai.main import app
from ai.scheduler import probe_cache


@contextmanager
def server(events: list[tuple], lock: threading.Lock):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, data):
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/api/version":
                self.reply({"version": "loopback-stub"})
            else:
                self.send_error(404)

        def do_POST(self):
            if self.path != "/api/chat":
                self.send_error(404)
                return
            model = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["model"]
            port = self.server.server_address[1]
            with lock:
                events.append(("start", port, model, perf_counter()))
            sleep(.2)
            with lock:
                events.append(("end", port, model, perf_counter()))
            self.reply({"model": model, "done": True, "done_reason": "stop", "message": {"content": json.dumps({
                "grades": [{"id": "greeting", "v": "yes", "r": "Operator greeted the client.", "e": ["t2"]}],
            })}})

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as httpd:
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": .02}, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{httpd.server_port}"
        finally:
            httpd.shutdown()
            thread.join()


async def measure() -> None:
    events = []
    lock = threading.Lock()
    with ExitStack() as stack:
        config_dir = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        primary = [stack.enter_context(server(events, lock)) for _ in range(2)]
        remote = ExitStack()
        stack.callback(remote.close)
        primary.append(remote.enter_context(server(events, lock)))
        config = config_dir / "judges.yaml"
        config.write_text(yaml.safe_dump({
            "panel": {"early_exit": False}, "judges": [
                {"name": f"j{i}", "model": f"stub-{i}", "provider": "ollama", "url": host,
                 **({"fallback_url": primary[0], "fallback_model": "stub-backup"} if i == 3 else {})}
                for i, host in enumerate(primary, 1)
            ],
        }))
        os.environ.update(EVALUATOR_JUDGES_FILE=str(config), EVALUATOR_EMIT_PANEL="true", EVALUATOR_ENGINE="langgraph")

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://evaluator") as client:
            for phase in ("three-ports", "one-remote-offline"):
                if phase == "one-remote-offline":
                    remote.close()
                    probe_cache.clear()  # The test changes network state immediately; a real entry expires after 30 s.
                events.clear()
                started = perf_counter()
                response = await client.post("/evaluate", json=probe_input().model_dump())
                response.raise_for_status()
                elapsed = perf_counter() - started
                reports = response.json()["panel"]["judges"]
                assert len(reports) == 3 and all(row["status"] == "ok" for row in reports)
                if phase == "three-ports":
                    assert [event[0] for event in events] == ["start"] * 3 + ["end"] * 3
                else:
                    assert reports[2]["fallback"] and reports[2]["host"] == primary[0]
                    host_events = [event for event, port, *_ in events if port == int(primary[0].rsplit(":", 1)[1])]
                    assert host_events == ["start", "end", "start", "end"]
                print(json.dumps({"mode": "stub", "phase": phase, "seconds": round(elapsed, 3),
                                  "events": [[event, port, model, round(at-started, 3)]
                                             for event, port, model, at in events]}))


if __name__ == "__main__":
    asyncio.run(measure())
