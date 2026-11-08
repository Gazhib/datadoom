import json
import os
import socket
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from time import monotonic, sleep

import httpx
import pytest

from backend.tests.test_evaluations import evaluate
from backend.tests.test_imports import upload

ROOT = Path(__file__).resolve().parents[2]


def control(settings, stub, version="default-v1", import_organizer=False, extra=()):
    environment = {
        **os.environ,
        "DATABASE_PATH": str(settings.database_path),
        "EVALUATOR_URL": stub.url,
        "ORGANIZER_GET_URL": settings.organizer_get_url,
        "BACKEND_ALLOW_FIXTURE": "true",  # The CLI must override this for control processing.
    }
    args = [
        sys.executable,
        "-m",
        "backend.cli",
        "--group-id",
        "SYNTH",
        "--checklist-version-id",
        version,
    ]
    if import_organizer:
        args.append("--import-organizer")
    args.extend(extra)
    result = subprocess.run(
        args, cwd=ROOT, env=environment, capture_output=True, text=True, timeout=20
    )
    return result, [json.loads(line) for line in result.stdout.splitlines()]


def test_control_http_failure_retry_resume_and_version_scoping(
    client, records, key, settings, stub
):
    assert (
        evaluate(client, key).status_code == 201
    )  # A fixture must not count as a completed live run.
    pending = deepcopy(records[0])
    pending["conversation_id"] = "pending"
    assert upload(client, [pending]).status_code == 200
    stub.mode = "live"  # Simulated live response, strictly inside the synthetic test harness.
    stub.fail_ids.add("pending")
    result, events = control(settings, stub)
    assert result.returncode == 1, result.stderr
    summary = events[-1]
    assert (summary["total"], summary["succeeded"], summary["failed"], summary["skipped"]) == (
        2,
        1,
        1,
        0,
    )
    assert summary["p95_seconds"] is not None
    assert summary["evaluations_per_second"] > 0
    assert summary["retries"] == 0
    assert any(event.get("code") == "upstream_failure" for event in events)
    stub.fail_ids.clear()
    result, events = control(settings, stub)
    assert result.returncode == 0, result.stderr
    assert (events[-1]["succeeded"], events[-1]["failed"], events[-1]["skipped"]) == (1, 0, 1)
    calls_before = len(stub.requests)
    result, events = control(settings, stub)
    assert result.returncode == 0
    assert (events[-1]["succeeded"], events[-1]["skipped"]) == (0, 2)
    assert len(stub.requests) == calls_before
    checklist = client.get("/api/checklists").json()["items"][0]
    checklist.pop("version_id")
    version = client.post("/api/checklists", json=checklist).json()["version_id"]
    result, events = control(settings, stub, version=version)
    assert result.returncode == 0
    assert (events[-1]["succeeded"], events[-1]["skipped"]) == (2, 0)
    assert "Здравствуйте" not in result.stdout + result.stderr


def test_control_can_import_and_always_rejects_fixtures(client, settings, stub):
    result, events = control(settings, stub, import_organizer=True)
    assert result.returncode == 1
    assert events[0] == {"event": "import", "group_id": "SYNTH", "imported": 1, "skipped": 0}
    assert events[-1]["failed"] == 1
    assert events[-2]["code"] == "unexpected_fixture"
    key = client.get("/api/conversations").json()["items"][0]["key"]
    assert client.get(f"/api/evaluations?conversation_key={key}").json() == {"items": []}


def test_control_missing_version_returns_safe_failure(settings, stub):
    result, events = control(settings, stub, version="missing")
    assert result.returncode == 1
    assert events[-1]["code"] == "not_found"


@pytest.fixture
def running_api(settings, stub):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
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
        cwd=ROOT,
        env={
            **os.environ,
            "DATABASE_PATH": str(settings.database_path),
            "EVALUATOR_URL": stub.url,
            "ORGANIZER_GET_URL": settings.organizer_get_url,
            "BACKEND_ALLOW_FIXTURE": "false",
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        with httpx.Client(base_url=url, trust_env=False, timeout=2) as client:
            deadline = monotonic() + 10
            while True:
                try:
                    assert client.get("/api/health").status_code == 200
                    break
                except httpx.ConnectError:
                    if process.poll() is not None or monotonic() >= deadline:
                        pytest.fail("Backend did not start")
                    sleep(0.05)
            yield url, client
    finally:
        process.terminate()
        process.communicate(timeout=10)


def test_api_control_import_export_error_rows_and_resume(
    running_api, settings, stub, records, tmp_path
):
    url, client = running_api
    second = deepcopy(records[0])
    second["conversation_id"] = "pending"
    stub.organizer_payload["data"]["records"].append(second)
    stub.mode = "live"
    stub.fail_ids.add("pending")
    path = tmp_path / "results.json"
    extra = ["--via-api", url, "--export", str(path), "--team-name", "Team", "--expect-count", "2"]
    result, events = control(settings, stub, import_organizer=True, extra=extra)
    assert result.returncode == 0, result.stderr
    assert events[-1] == {"event": "results_checked", "count": 2, "ok": 1, "errors": 1}
    rows = json.loads(path.read_text())["results"]
    assert [r["status"] for r in rows] == ["ok", "error"]
    assert rows[1]["score"] is None
    stub.fail_ids.clear()
    result, events = control(settings, stub, extra=extra)
    assert result.returncode == 0, result.stderr
    assert events[-1]["ok"] == 2
    summary = next(e for e in events if e["event"] == "summary")
    assert (summary["succeeded"], summary["skipped"]) == (1, 1)
    assert "Здравствуйте" not in result.stdout + result.stderr
    result, events = control(settings, stub, extra=[*extra[:-1], "10"])
    assert result.returncode == 1
    assert events[-1]["code"] == "invalid_results"


def test_control_limits_and_standalone_export(client, records, settings, stub, tmp_path):
    rows = [dict(records[0], conversation_id=str(i)) for i in range(3)]
    assert upload(client, rows).status_code == 200
    stub.mode = "live"
    path = tmp_path / "results.json"
    result, events = control(
        settings,
        stub,
        extra=[
            "--only",
            "1,2",
            "--limit",
            "1",
            "--export",
            str(path),
            "--team-name",
            "Team",
            "--expect-count",
            "3",
        ],
    )
    assert result.returncode == 0, result.stderr
    assert events[-1] == {"event": "results_checked", "count": 3, "ok": 1, "errors": 2}
    assert [r[2]["conversation"]["conversation_id"] for r in stub.requests] == ["1"]


def test_api_control_subset_uses_existing_jobs(running_api, records, settings, stub):
    url, client = running_api
    assert (
        upload(client, [dict(records[0], conversation_id=str(i)) for i in range(3)]).status_code
        == 200
    )
    stub.mode = "live"
    extra = ["--via-api", url, "--only", "1,2", "--limit", "1"]
    result, events = control(settings, stub, extra=extra)
    assert result.returncode == 0, result.stderr
    assert events[-1]["succeeded"] == 1 and events[-1]["total"] == 1
    result, events = control(settings, stub, extra=extra)
    assert result.returncode == 0, result.stderr
    assert events[-1]["skipped"] == 1
    assert [r[2]["conversation"]["conversation_id"] for r in stub.requests] == ["1"]
