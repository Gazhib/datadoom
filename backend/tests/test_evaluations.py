from copy import deepcopy
from dataclasses import replace
from fractions import Fraction

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.scoring import half_up


def evaluate(client, key, version="default-v1"):
    return client.post(
        "/api/evaluations", json={"conversation_key": key, "checklist_version_id": version}
    )


def test_fixture_score_sections_and_rerun_history(client, evaluation, key, stub):
    score = evaluation["original"]
    assert evaluation["mode"] == "fixture"
    assert evaluation["model"] == {"provider": "fixture", "model": "synthetic-v1"}
    assert score == evaluation["final"]
    assert score["total"] == 77.69
    assert score["serious_error"] is False
    assert [(s["points"], s["possible"]) for s in score["sections"]] == [
        (15.38, 15.38),
        (23.08, 30.77),
        (39.23, 53.85),
        (None, None),
    ]
    for index in [1, 2, 7]:
        assert score["items"][index]["effective_weight"] is None
        assert score["items"][index]["points"] is None
    stub.grades.reverse()
    rerun = evaluate(client, key).json()
    assert rerun["id"] != evaluation["id"]
    assert rerun["original"] == score
    assert client.get(f"/api/evaluations?conversation_key={key}").json()["items"] == [
        rerun,
        evaluation,
    ]


def test_serious_error_is_independent(client, evaluation, key, stub):
    stub.grades[7]["value"] = "yes"
    score = evaluate(client, key).json()["original"]
    assert score["total"] == 77.69
    assert score["serious_error"] is True


def test_arbitrary_criteria_all_na_and_unsectioned(client, key, stub):
    criterion = client.get("/api/checklists").json()["items"][0]["criteria"][1]
    criterion.update(id="custom/criterion-КЗ", section="Optional section")
    version = client.post(
        "/api/checklists", json={"name": "All N/A", "criteria": [criterion]}
    ).json()
    stub.grades = [
        {
            "criterion_id": criterion["id"],
            "value": "na",
            "reason": "Enough initial context under the configured N/A rule",
            "evidence_turn_ids": ["t1"],
        }
    ]
    result = evaluate(client, key, version["version_id"]).json()
    assert result["original"]["total"] is None
    assert result["original"]["sections"][0]["points"] is None
    assert result["original"]["sections"][0]["possible"] is None
    appeal = client.post(
        f"/api/evaluations/{result['id']}/appeals",
        json={"criterion_id": criterion["id"], "comment": "Check this"},
    )
    assert appeal.status_code == 201
    decision = client.post(
        f"/api/evaluations/{result['id']}/appeals/{criterion['id']}/decision",
        json={"action": "confirm", "reason": "Confirmed N/A context"},
    )
    assert decision.status_code == 200
    criterion.update(allow_na=False, na_rule=None, section=None)
    version2 = client.post(
        "/api/checklists", json={"name": "Unsectioned", "criteria": [criterion]}
    ).json()
    stub.grades[0]["value"] = "yes"
    result2 = evaluate(client, key, version2["version_id"]).json()
    assert result2["original"]["total"] == 100
    assert result2["original"]["sections"] == []


def test_exact_half_up_and_unrounded_contributions(client, key, stub):
    assert half_up(Fraction(1, 8)) == 0.13
    criterion = client.get("/api/checklists").json()["items"][0]["criteria"][0]
    rows = [dict(criterion, id=str(i), weight=1, section="Same") for i in range(3)]
    version = client.post("/api/checklists", json={"name": "Thirds", "criteria": rows}).json()
    stub.grades = [
        {
            "criterion_id": str(i),
            "value": "yes",
            "reason": "Synthetic evidence",
            "evidence_turn_ids": ["t1"],
        }
        for i in range(3)
    ]
    score = evaluate(client, key, version["version_id"]).json()["original"]
    assert [item["points"] for item in score["items"]] == [33.33] * 3
    assert score["total"] == score["sections"][0]["points"] == 100


@pytest.mark.parametrize(
    "mutate",
    [
        lambda g: g.pop(),
        lambda g: g.append(deepcopy(g[0])),
        lambda g: g[-1].update(criterion_id="C01"),
        lambda g: g[0].update(criterion_id="unknown"),
        lambda g: g[0].update(evidence_turn_ids=["missing-turn"]),
        lambda g: g[0].update(evidence_turn_ids=[]),
        lambda g: g[0].update(reason=" "),
        lambda g: g[0].update(value=True),
        lambda g: g[0].update(value=1),
        lambda g: g[0].update(value="na"),
        lambda g: g[3].update(value="15"),
        lambda g: g[3].update(value="yes"),
        lambda g: g[3].update(value=14),
        lambda g: g[-1].update(value="na"),
    ],
)
def test_invalid_evaluator_grades_never_persist(client, key, evaluation, stub, mutate):
    mutate(stub.grades)
    response = evaluate(client, key)
    assert response.status_code == 502
    assert set(response.json()) == {"error"}
    assert client.get(f"/api/evaluations?conversation_key={key}").json()["items"] == [evaluation]


def test_unavailable_invalid_and_timed_out_evaluator_preserve_results(
    client, settings, stub, evaluation, key
):
    stub.status = 503
    assert evaluate(client, key).status_code == 502
    stub.status = 504
    response = evaluate(client, key)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "upstream_timeout"
    stub.status = 200
    stub.raw_body = b"not JSON"
    assert evaluate(client, key).status_code == 502
    stub.raw_body = None
    stub.delay = 0.1
    with TestClient(create_app(replace(settings, evaluator_timeout=0.01))) as impatient:
        assert evaluate(impatient, key).status_code == 504
    assert client.get(f"/api/evaluations?conversation_key={key}").json()["items"] == [evaluation]


def test_live_backend_rejects_fixture_and_bad_configuration(settings, stub, client, key):
    with TestClient(create_app(replace(settings, allow_fixture=False))) as live:
        assert evaluate(live, key).status_code == 502
        assert live.get(f"/api/evaluations?conversation_key={key}").json()["items"] == []
        stub.mode = "live"
        assert evaluate(live, key).json()["mode"] == "live"
    with TestClient(create_app(replace(settings, evaluator_url=""))) as unconfigured:
        assert evaluate(unconfigured, key).status_code == 503
    with TestClient(create_app(replace(settings, evaluator_url="http://127.0.0.1:1"))) as offline:
        assert evaluate(offline, key).status_code == 502
