import json
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

from backend.tests.test_evaluations import evaluate
from backend.tests.test_imports import upload

ROOT = Path(__file__).resolve().parents[2]


def control(settings, stub, version="default-v1", import_organizer=False):
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
