import sqlite3
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import MIGRATIONS, Database
from backend.jobs import Jobs
from backend.main import create_app
from backend.models import Evaluation
from backend.tests.test_evaluations import evaluate
from backend.tests.test_jobs import enqueue, import_keys


def panel(grades):
    return {
        "quorum": 1,
        "agreement": 1,
        "future": "ignored",
        "judges": [
            {
                "name": "judge-1",
                "provider": "ollama",
                "model": "qwen3:1.7b",
                "host": "http://localhost:11434",
                "fallback": False,
                "status": "ok",
                "error_code": None,
                "seconds": 0.1,
                "future": True,
            }
        ],
        "votes": [
            {
                "criterion_id": g["criterion_id"],
                "value": g["value"],
                "agreement": 1,
                "ballots": {"judge-1": g["value"]},
            }
            for g in grades
        ],
    }


def test_panel_forward_compatibility_persistence_old_payload_and_mismatch(
    client, key, stub, caplog
):
    stub.custom_response = {
        "mode": "fixture",
        "model": {"provider": "fixture", "model": "synthetic"},
        "grades": stub.grades,
        "panel": panel(stub.grades),
    }
    response = evaluate(client, key)
    assert response.status_code == 201
    evaluation = response.json()
    assert "future" not in evaluation["panel"]
    assert "future" not in evaluation["panel"]["judges"][0]
    assert client.get(f"/api/evaluations/{evaluation['id']}").json()["panel"] == evaluation["panel"]
    old = dict(evaluation)
    del old["panel"]
    assert Evaluation.model_validate(old).panel is None
    stub.custom_response["panel"]["votes"][0]["criterion_id"] = "wrong"
    assert evaluate(client, key).json()["panel"] is None
    assert "Dropped panel" in caplog.text


def test_panel_keeps_valid_judge_grades_and_drops_invalid_evidence(client, key, stub, caplog):
    stub.custom_response = {
        "mode": "fixture",
        "model": {"provider": "fixture", "model": "synthetic"},
        "grades": stub.grades,
        "panel": panel(stub.grades),
    }
    stub.custom_response["panel"]["judges"][0]["grades"] = stub.grades
    assert evaluate(client, key).json()["panel"]["judges"][0]["grades"] == stub.grades
    bad = [{**grade, "evidence_turn_ids": ["no-such-turn"]} for grade in stub.grades]
    stub.custom_response["panel"]["judges"][0]["grades"] = bad
    saved = evaluate(client, key).json()["panel"]
    assert saved["judges"][0]["grades"] is None
    assert len(saved["votes"]) == len(stub.grades)
    assert "Dropped grades of judge judge-1" in caplog.text


@pytest.mark.parametrize(
    "name,value",
    [
        ("UPSTREAM_TIMEOUT_SECONDS", "61"),
        ("UPSTREAM_TIMEOUT_SECONDS", "0"),
        ("EVALUATOR_TIMEOUT_SECONDS", "901"),
        ("EVALUATOR_TIMEOUT_SECONDS", "0"),
        ("EVALUATOR_TIMEOUT_SECONDS", "nan"),
        ("EVALUATOR_TIMEOUT_SECONDS", "text"),
        ("EVALUATION_CONCURRENCY", "0"),
        ("EVALUATION_CONCURRENCY", "9"),
        ("EVALUATION_CONCURRENCY", "1.5"),
    ],
)
def test_bad_settings_name_is_clear(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        Settings.from_env()


def test_evaluator_timeout_is_independent(client, settings, stub, key, monkeypatch):
    monkeypatch.setenv("EVALUATOR_TIMEOUT_SECONDS", "900")
    assert Settings.from_env().evaluator_timeout == 900
    stub.delay = 0.05
    with TestClient(
        create_app(replace(settings, upstream_timeout=0.01, evaluator_timeout=1))
    ) as impatient_organizer:
        assert evaluate(impatient_organizer, key).status_code == 201
        response = impatient_organizer.post(
            "/api/imports", json={"source": "organizer", "group_id": "OTHER"}
        )
        assert response.status_code == 504


@pytest.mark.parametrize("version", [1, 2])
def test_migrations_preserve_existing_data(tmp_path, version):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as connection:
        for migration in MIGRATIONS[:version]:
            for statement in migration:
                connection.execute(statement)
        connection.execute(f"PRAGMA user_version = {version}")
        connection.execute("INSERT INTO checklists VALUES ('old-version', 'saved')")
        if version == 2:
            connection.execute(
                "INSERT INTO conversations VALUES ('key', 'group', 'id', '{}', '{}')"
            )
            connection.execute(
                "INSERT INTO evaluation_jobs "
                "(id, conversation_key, checklist_version_id, status, created_at) "
                "VALUES ('old-job', 'key', 'old-version', 'queued', '2026-11-01')"
            )
    Database(path).initialize()
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
        assert (
            connection.execute(
                "SELECT payload FROM checklists WHERE version_id = 'old-version'"
            ).fetchone()[0]
            == "saved"
        )
        rows = connection.execute(
            "SELECT id, status, reason_locale FROM evaluation_jobs"
        ).fetchall()
        assert rows == ([("old-job", "queued", None)] if version == 2 else [])


def test_stream_progress_and_result_are_saved(settings, records, stub):
    with TestClient(
        create_app(replace(settings, evaluator_stream=True), start_workers=False)
    ) as streamed:
        key = import_keys(streamed, records, 1)[0]
        job = enqueue(streamed, key, reason_locale="kk").json()
        assert Jobs(streamed.app.state.service).run_one()
        assert stub.requests[-1][2]["reason_locale"] == "kk"
        done = streamed.get(f"/api/evaluation-jobs/{job['id']}").json()
        assert done["status"] == "succeeded"
        assert done["progress"] == {
            "judges": [
                {
                    "name": "judge-1", "status": "ok", "host": None, "seconds": 0.1,
                    "error_code": None, "grades": None,
                }
            ]
        }
        assert (
            streamed.get(f"/api/evaluations/{done['evaluation_id']}").json()["original"]["total"]
            == 77.69
        )


@pytest.mark.parametrize("status", [404, 405])
def test_stream_fallback_remembered(settings, client, key, stub, status):
    stub.stream_status = status
    with TestClient(create_app(replace(settings, evaluator_stream=True))) as streamed:
        assert evaluate(streamed, key, reason_locale="ru").status_code == 201
        assert evaluate(streamed, key).status_code == 201
    assert [r[1] for r in stub.requests].count("/evaluate/stream") == 1
    assert [r[1] for r in stub.requests].count("/evaluate") == 2
    payloads = [body for _, path, body in stub.requests if path.startswith("/evaluate")]
    assert [body.get("reason_locale") for body in payloads] == ["ru", "ru", None]
    assert "reason_locale" not in payloads[-1]


@pytest.mark.parametrize(
    "raw",
    [
        b"not-json\n",
        b"{}\n",
        b'{"event":"started","judges":[]}\n',
        b' {"event":"result","result":{}}\n',
        b"x" * 2_000_001,
        b'{"event":"started","judges":[]}\n{"event":"error","status":0,"error":{}}\n',
    ],
)
def test_stream_protocol_errors_create_no_evaluation(settings, client, key, stub, raw):
    stub.stream_raw = raw
    with TestClient(create_app(replace(settings, evaluator_stream=True))) as streamed:
        response = evaluate(streamed, key)
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "invalid_evaluator_response"
        assert streamed.get(f"/api/evaluations?conversation_key={key}").json()["items"] == []


def test_stream_error_keeps_prior_evaluation(settings, client, key, evaluation, stub):
    stub.stream_events = [
        {"event": "started", "judges": []},
        {
            "event": "error",
            "status": 504,
            "error": {"code": "provider_timeout", "message": "Timed out"},
        },
    ]
    with TestClient(create_app(replace(settings, evaluator_stream=True))) as streamed:
        response = evaluate(streamed, key)
        assert response.status_code == 504
        assert response.json()["error"]["code"] == "provider_timeout"
        assert streamed.get(f"/api/evaluations?conversation_key={key}").json()["items"] == [
            evaluation
        ]


@pytest.mark.parametrize(
    "bad_grade",
    [None, {"criterion_id": "unknown"}, {"value": 99}, {"evidence_turn_ids": ["unknown"]}],
)
def test_partial_grades_survive_panel_failure(settings, records, stub, bad_grade):
    stub.stream_events = [
        {"event": "started", "judges": ["judge-1", "judge-2", "judge-3"]},
        {"event": "judge_finished", "judge": "judge-2", "status": "ok", "grades": stub.grades},
        {
            "event": "judge_finished", "judge": "judge-1", "status": "failed",
            "error_code": "provider_timeout",
        },
        {"event": "judge_finished", "judge": "judge-3", "status": "skipped"},
        {"event": "error", "status": 502, "error": {
            "code": "quorum_not_met", "message": "Quorum missed",
        }},
    ]
    if bad_grade:
        stub.stream_events[3] = {
            "event": "judge_finished", "judge": "judge-3", "status": "ok",
            "grades": [{**stub.grades[0], **bad_grade}, *stub.grades[1:]],
        }
    with TestClient(
        create_app(replace(settings, evaluator_stream=True), start_workers=False)
    ) as streamed:
        key = import_keys(streamed, records, 1)[0]
        job = enqueue(streamed, key).json()
        assert Jobs(streamed.app.state.service).run_one()
        done = streamed.get(f"/api/evaluation-jobs/{job['id']}").json()
        assert done["status"] == "failed"
        assert done["evaluation_id"] is None
        expected_error = "invalid_evaluator_response" if bad_grade else "quorum_not_met"
        assert done["error"]["code"] == expected_error
        judges = done["progress"]["judges"]
        assert judges[0]["status"] == "failed"
        assert judges[0]["error_code"] == "provider_timeout"
        assert judges[1]["status"] == "ok"
        assert judges[1]["grades"] == stub.grades
        assert judges[2]["status"] == ("pending" if bad_grade else "skipped")
        assert judges[2]["grades"] is None
