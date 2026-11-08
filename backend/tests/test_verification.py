import json
import os
import subprocess
import sys
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.models import RawRecord
from backend.verify import summarize_records

ROOT = Path(__file__).resolve().parents[2]


def verify_organizer(settings, group="DEV"):
    result = subprocess.run(
        [sys.executable, "-m", "backend.verify", "--group-id", group],
        cwd=ROOT,
        env={
            **os.environ,
            "ORGANIZER_GET_URL": settings.organizer_get_url or "",
            # This path must never be created: the verifier is read-only.
            "DATABASE_PATH": str(settings.database_path.parent / "not-created.sqlite3"),
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
    )
    return result, json.loads(result.stdout)


def test_dev_verification_checks_counts_without_disclosing_source(settings, stub, records):
    samples = []
    languages = ["RU"] * 35 + ["KZ"] * 15 + ["EN"] * 15
    for index, language in enumerate(languages):
        record = deepcopy(records[0])
        record.update(conversation_id=f"synthetic-{index}", language=language)
        if index >= 60:
            record.update(channel="voice call", audio_url="https://example.test/secret-audio")
            record["transcript"][0]["timestamp"] = "2026-11-07T10:00:00+05:00"
        samples.append(record)
    stub.organizer_payload["data"]["records"] = samples
    result, report = verify_organizer(settings)
    assert result.returncode == 0, result.stderr
    assert report["passed"] is True
    assert report["dev_counts_match"] is True
    assert report["records"] == report["unique_conversations"] == 65
    assert report["channels"] == {"agent chat": 60, "voice call": 5}
    assert report["languages"] == {"RU": 35, "KZ": 15, "EN": 15}
    assert report["speakers"] == {"client": 65, "operator": 130, "system": 65}
    assert report["timestamp_formats"] == {"relative": 255, "iso8601": 5}
    assert report["calls_with_audio"] == 5
    assert report["calls_without_audio"] == 0
    assert report["recording_access_checked"] is False
    assert report["elapsed_seconds"] >= 0
    assert not (settings.database_path.parent / "not-created.sqlite3").exists()
    for source_value in ["Какой", "synthetic-0", "secret-audio", "synthetic%2Btoken", stub.url]:
        assert source_value not in result.stdout + result.stderr


def test_verification_targets_dev_only_and_accepts_empty_control(settings):
    result, report = verify_organizer(settings)
    assert result.returncode == 1
    assert report["dev_counts_match"] is False
    result, report = verify_organizer(settings, group="CONTROL")
    assert result.returncode == 0
    assert report["dev_counts_match"] is None
    empty = summarize_records("CONTROL", [])
    assert empty["passed"] is True
    assert empty["records"] == 0


def test_verification_flags_missing_recordings_duplicates_and_unknown_timestamps(records):
    call = deepcopy(records[0])
    call.update(channel="voice call", audio_url=None)
    call["transcript"][0]["timestamp"] = "source timestamp"
    raw = RawRecord.model_validate(call)
    report = summarize_records("CONTROL", [raw, raw])
    assert report["passed"] is False
    assert report["records"] == 2
    assert report["unique_conversations"] == 1
    assert report["calls_without_audio"] == 2
    assert report["timestamp_formats"] == {"other": 2, "relative": 6}


def test_verification_unconfigured_and_invalid_source_fail_safely(settings, stub):
    result, report = verify_organizer(replace(settings, organizer_get_url=None))
    assert result.returncode == 1
    assert report["code"] == "configuration_unavailable"
    stub.organizer_payload = {"isSuccess": False}
    result, report = verify_organizer(settings)
    assert result.returncode == 1
    assert report["code"] == "invalid_upstream_response"
    assert "sig=" not in result.stdout + result.stderr


@pytest.mark.parametrize(
    "url",
    [
        "https://[invalid?sig=private",
        "https://example.test:invalid?sig=private",
        "https://example.test:99999?sig=private",
        "http://:80/raw?sig=private",
        "http://example.test:0/raw?sig=private",
        "file:///private?sig=private",
    ],
)
def test_malformed_service_urls_return_safe_configuration_errors(settings, client, key, url):
    for config, path, body in [
        (
            replace(settings, organizer_get_url=url),
            "/api/imports",
            {"source": "organizer", "group_id": "DEV"},
        ),
        (
            replace(settings, evaluator_url=url),
            "/api/evaluations",
            {"conversation_key": key, "checklist_version_id": "default-v1"},
        ),
    ]:
        with TestClient(create_app(config)) as misconfigured:
            response = misconfigured.post(path, json=body)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "configuration_unavailable"
        assert "private" not in response.text
    assert client.get(f"/api/evaluations?conversation_key={key}").json()["items"] == []
