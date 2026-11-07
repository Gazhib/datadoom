"""Synthetic HTTP boundary for integration tests and explicit local rehearsal."""

import json
import time
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class Stub:
    def __init__(self, port=0):
        self.mode = "fixture"
        self.grades = json.loads((FIXTURES / "grades.json").read_text())
        self.organizer_payload = {
            "isSuccess": True,
            "data": {"records": json.loads((FIXTURES / "synthetic.json").read_text())},
        }
        self.fail_ids = set()
        self.delay = 0
        self.status = 200
        self.raw_body = None
        self.custom_response = None
        self.requests = []
        self.active = 0
        self.max_active = 0
        self.lock = Lock()
        self.stream_status = 200
        self.stream_events = None
        self.stream_raw = None
        self.judges_payload = {
            "execution": "auto",
            "quorum": 1,
            "timeout_seconds": 540,
            "judges": [],
        }
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send_json(self, body):
                time.sleep(stub.delay)
                payload = stub.raw_body if stub.raw_body is not None else json.dumps(body).encode()
                self.send_response(stub.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                stub.requests.append((self.command, self.path, None))
                self.send_json(
                    stub.judges_payload if self.path == "/judges" else stub.organizer_payload
                )

            def do_POST(self):
                with stub.lock:
                    stub.active += 1
                    stub.max_active = max(stub.max_active, stub.active)
                try:
                    self.evaluate()
                finally:
                    with stub.lock:
                        stub.active -= 1

            def evaluate(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                stub.requests.append((self.command, self.path, body))
                if self.path == "/evaluate/stream":
                    result = stub.custom_response or {
                        "mode": stub.mode,
                        "model": {"provider": "synthetic-test", "model": "synthetic-v1"},
                        "grades": deepcopy(stub.grades),
                    }
                    events = (
                        stub.stream_events
                        if stub.stream_events is not None
                        else [
                            {"event": "started", "judges": ["judge-1"]},
                            {"event": "judge_started", "judge": "judge-1"},
                            {
                                "event": "judge_finished",
                                "judge": "judge-1",
                                "status": "ok",
                                "seconds": 0.1,
                                "error_code": None,
                            },
                            {"event": "result", "result": result},
                        ]
                    )
                    payload = (
                        stub.stream_raw
                        if stub.stream_raw is not None
                        else b"".join(json.dumps(e).encode() + b"\n" for e in events)
                    )
                    self.send_response(stub.stream_status)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                if body["conversation"]["conversation_id"] in stub.fail_ids:
                    self.send_response(503)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_json(
                    stub.custom_response
                    if stub.custom_response is not None
                    else {
                        "mode": stub.mode,
                        "model": {
                            "provider": "fixture" if stub.mode == "fixture" else "synthetic-test",
                            "model": "synthetic-v1",
                        },
                        "grades": deepcopy(stub.grades),
                    }
                )

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


if __name__ == "__main__":
    with Stub(port=8001):
        print("Synthetic fixture evaluator on 127.0.0.1:8001; no real inference.", flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
