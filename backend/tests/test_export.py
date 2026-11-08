import json
import os
import subprocess
import sys
from copy import deepcopy

import pytest

from backend.errors import APIError
from backend.export import build_results, check_document, check_file, write_results
from backend.tests.test_evaluations import evaluate


def export(client, **kwargs):
    return build_results(
        client.app.state.service.database, "SYNTH", "default-v1", "Test team", **kwargs
    )


@pytest.fixture
def document(client, key, stub):
    stub.mode = "live"
    assert evaluate(client, key).status_code == 201
    return export(client).model_dump()


def test_export_values_original_and_final_and_attachment(client, key, stub, document, tmp_path):
    row = document["results"][0]
    criteria = {c["criterion_id"]: c for c in row["criteria"]}
    assert row["score"] == {"final_score": 77.69, "critical_flag": False}
    assert criteria["discovery"]["value"] is None
    assert criteria["consultation"]["value"] == 15
    assert criteria["dialogue"]["value"] == 7
    assert criteria["consultation"]["evidence_turns"] == [1, 3]
    evaluation = client.get(f"/api/evaluations?conversation_key={key}").json()["items"][0]
    run_id = evaluation["id"]
    client.post(
        f"/api/evaluations/{run_id}/appeals",
        json={"criterion_id": "C06", "comment": "Review clarity"},
    )
    response = client.post(
        f"/api/evaluations/{run_id}/appeals/C06/decision",
        json={
            "action": "change",
            "reason": "Clarity confirmed",
            "replacement": {
                "criterion_id": "C06",
                "value": 10,
                "reason": "Clear reply",
                "evidence_turn_ids": ["t2", "t3"],
            },
        },
    )
    assert response.status_code == 200
    assert export(client).results[0].score.final_score == 77.69
    assert export(client, use_final=True).results[0].score.final_score == 84.62
    path = tmp_path / "results.json"
    assert write_results(export(client), path, 1)["ok"] == 1
    assert check_file(path, 1).results[0].score.final_score == 77.69
    assert not list(tmp_path.glob(".results-*"))
    raw = path.read_text()
    assert "turns" not in json.loads(raw)["results"][0]
    assert "Здравствуйте" not in raw
    attachment = client.get(
        "/api/exports/results",
        params={
            "group_id": "SYNTH",
            "checklist_version_id": "default-v1",
            "team_name": "Team",
            "use_final": "true",
        },
    )
    assert attachment.status_code == 200
    assert attachment.headers["content-disposition"] == 'attachment; filename="results.json"'
    assert attachment.json()["results"][0]["score"]["final_score"] == 84.62


def test_missing_evaluation_fixture_exclusion_and_latest_live(client, key, stub, evaluation):
    row = export(client).results[0]
    assert row.status == "error" and row.score is None and row.criteria == []
    assert row.error == "No successful live evaluation for this checklist version."
    stub.mode = "live"
    evaluate(client, key)
    stub.grades[5]["value"] = 10
    evaluate(client, key)
    stub.mode = "fixture"
    stub.grades[5]["value"] = 0
    evaluate(client, key)
    assert export(client).results[0].score.final_score == 84.62


def test_mapping_custom_ids_and_error_code(client, key, stub):
    checklist = client.get("/api/checklists").json()["items"][0]
    checklist.pop("version_id")
    checklist["criteria"][0]["id"] = "custom-contact"
    version = client.post("/api/checklists", json=checklist).json()["version_id"]
    database = client.app.state.service.database
    with pytest.raises(APIError, match="custom-contact") as exc:
        build_results(database, "SYNTH", version, "Team")
    assert exc.value.code == "unmapped_criteria"
    response = client.get(
        "/api/exports/results",
        params={"group_id": "SYNTH", "checklist_version_id": version, "team_name": "Team"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unmapped_criteria"
    stub.mode = "live"
    stub.grades[0]["criterion_id"] = "custom-contact"
    assert evaluate(client, key, version).status_code == 201
    result = build_results(
        database, "SYNTH", version, "Team", criterion_map={"custom-contact": "contact"}
    )
    assert result.results[0].criteria[0].criterion_id == "contact"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(schema_version="2.0"),
        lambda d: d.update(team_name=" "),
        lambda d: d["model"].update(mode="other"),
        lambda d: d["model"].update(name=""),
        lambda d: d["results"].append(deepcopy(d["results"][0])),
        lambda d: d["results"][0]["criteria"].pop(),
        lambda d: d["results"][0]["criteria"][0].update(criterion_id="discovery"),
        lambda d: d["results"][0]["criteria"][0].update(value=1),
        lambda d: d["results"][0]["criteria"][0].update(value=None),
        lambda d: d["results"][0]["criteria"][3].update(value=True),
        lambda d: d["results"][0]["criteria"][3].update(value=14),
        lambda d: d["results"][0]["criteria"][5].update(value=None),
        lambda d: d["results"][0]["criteria"][0].update(rationale=" "),
        lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[0]),
        lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[True]),
        lambda d: d["results"][0]["criteria"][0].update(evidence_turns=["1"]),
        lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[]),
        lambda d: d["results"][0]["score"].update(final_score=100.01),
        lambda d: d["results"][0]["score"].update(final_score=-1),
        lambda d: d["results"][0]["score"].update(final_score=77.691),
        lambda d: d["results"][0]["score"].update(final_score=True),
        lambda d: d["results"][0]["score"].update(final_score=float("nan")),
        lambda d: d["results"][0]["score"].update(critical_flag=True),
        lambda d: d["results"][0].update(status="error"),
        lambda d: d["results"][0].update(status="error", criteria=[], score=None, error=" "),
    ],
)
def test_checker_rejects_contract_failures(document, mutate):
    mutate(document)
    with pytest.raises(APIError) as exc:
        check_document(document)
    assert exc.value.code == "invalid_results"


def test_checker_count_encoding_json_and_atomic_failure(document, tmp_path, monkeypatch):
    with pytest.raises(APIError):
        check_document(document, 10)
    path = tmp_path / "results.json"
    for content in [b"\xff", b"{broken"]:
        path.write_bytes(content)
        with pytest.raises(APIError):
            check_file(path)
    path.write_text("previous output")
    monkeypatch.setattr("backend.export.os.replace", lambda *args: (_ for _ in ()).throw(OSError()))
    with pytest.raises(OSError):
        write_results(check_document(document), path)
    assert path.read_text() == "previous output"
    assert not list(tmp_path.glob(".results-*"))


def test_export_command_and_standalone_check(client, key, stub, settings, tmp_path):
    stub.mode = "live"
    evaluate(client, key)
    path = tmp_path / "results.json"
    args = [sys.executable, "-m", "backend.export"]
    result = subprocess.run(
        args
        + [
            "--group-id",
            "SYNTH",
            "--checklist-version-id",
            "default-v1",
            "--out",
            str(path),
            "--team-name",
            "Team",
            "--expect-count",
            "1",
        ],
        env={**os.environ, "DATABASE_PATH": str(settings.database_path)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ok"] == 1
    result = subprocess.run(
        args + ["--check", str(path), "--expect-count", "1"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


def test_model_modes_and_unique_names(client, key, stub, records):
    stub.mode = "live"
    stub.custom_response = {
        "mode": "live",
        "model": {
            "provider": "panel",
            "model": "ollama/qwen3:1.7b + llama.cpp/gguf + ollama/qwen3:1.7b",
        },
        "grades": stub.grades,
    }
    evaluate(client, key)
    assert export(client).model.model_dump() == {"mode": "local", "name": "qwen3:1.7b + gguf"}
    second = dict(records[0], conversation_id="second")
    client.post("/api/imports", json={"source": "upload", "group_id": "SYNTH", "records": [second]})
    key2 = client.get("/api/conversations").json()["items"][1]["key"]
    stub.custom_response["model"] = {"provider": "openai", "model": "model-test"}
    evaluate(client, key2)
    assert export(client).model.mode == "hybrid"
    assert export(client).model.name == "qwen3:1.7b + gguf + model-test"
