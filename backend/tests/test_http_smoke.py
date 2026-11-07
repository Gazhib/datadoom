import os
import socket
import subprocess
import sys
from pathlib import Path
from time import monotonic, sleep

import httpx


def test_running_backend_http_import_evaluate_and_review(settings, stub, records):
    # Use a disposable port and database, and explicitly opt into the synthetic evaluator.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    environment = {
        **os.environ,
        "DATABASE_PATH": str(settings.database_path),
        "EVALUATOR_URL": stub.url,
        "BACKEND_ALLOW_FIXTURE": "true",
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
            "--log-level",
            "error",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=2
        ) as client:
            deadline = monotonic() + 10
            while True:
                try:
                    assert client.get("/api/health").json() == {"status": "ok"}
                    break
                except httpx.ConnectError:
                    if process.poll() is not None or monotonic() >= deadline:
                        raise AssertionError("Backend server failed to start") from None
                    sleep(0.05)
            response = client.post(
                "/api/imports", json={"source": "upload", "group_id": "SYNTH", "records": records}
            )
            assert response.status_code == 200
            key = client.get("/api/conversations").json()["items"][0]["key"]
            response = client.post(
                "/api/evaluations",
                json={"conversation_key": key, "checklist_version_id": "default-v1"},
            )
            assert response.status_code == 201
            evaluation = response.json()
            assert evaluation["original"]["total"] == 77.69
            assert evaluation["mode"] == "fixture"
            path = f"/api/evaluations/{evaluation['id']}/appeals"
            assert (
                client.post(
                    path, json={"criterion_id": "C06", "comment": "Review clarity separately."}
                ).status_code
                == 201
            )
            response = client.post(
                path + "/C06/decision",
                json={
                    "action": "change",
                    "reason": "Clarity is sufficient.",
                    "replacement": {
                        "criterion_id": "C06",
                        "value": 10,
                        "reason": "Clear sequence.",
                        "evidence_turn_ids": ["t2", "t3"],
                    },
                },
            )
            assert response.status_code == 200
            assert response.json()["final"]["total"] == 84.62
            assert (
                client.get(f"/api/evaluations/{evaluation['id']}").json()["original"]["total"]
                == 77.69
            )
    finally:
        process.terminate()
        process.communicate(timeout=10)
