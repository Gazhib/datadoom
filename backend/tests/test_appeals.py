from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


def appeal(client, evaluation, criterion="C06"):
    return client.post(
        f"/api/evaluations/{evaluation['id']}/appeals",
        json={
            "criterion_id": criterion,
            "comment": "Incomplete consultation is separate from dialogue clarity.",
        },
    )


def change():
    return {
        "action": "change",
        "reason": "Dialogue is clear; consultation completeness is graded separately.",
        "replacement": {
            "criterion_id": "C06",
            "value": 10,
            "reason": "The wording and order are clear.",
            "evidence_turn_ids": ["t2", "t3"],
        },
    }


def decision_path(evaluation, criterion="C06"):
    return f"/api/evaluations/{evaluation['id']}/appeals/{criterion}/decision"


def test_change_recomputes_final_and_persists_original(client, evaluation, settings):
    assert appeal(client, evaluation).status_code == 201
    response = client.post(decision_path(evaluation), json=change())
    assert response.status_code == 200
    result = response.json()
    assert result["original"]["total"] == 77.69
    assert result["final"]["total"] == 84.62
    assert result["original"] == evaluation["original"]
    assert result["appeals"][0]["decision"] == change()
    assert result["appeals"][0]["status"] == "resolved"
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get(f"/api/evaluations/{evaluation['id']}").json() == result
        assert restarted.post(decision_path(evaluation), json=change()).status_code == 409
        assert appeal(restarted, evaluation).status_code == 409


def test_confirm_keeps_original_and_duplicate_appeal_conflicts(client, evaluation):
    assert appeal(client, evaluation).status_code == 201
    assert appeal(client, evaluation).status_code == 409
    response = client.post(
        decision_path(evaluation),
        json={"action": "confirm", "reason": "The original evidence supports the grade."},
    )
    assert response.status_code == 200
    assert response.json()["original"] == response.json()["final"]


def test_multiple_decisions_overlay_original_instead_of_losing_prior_change(client, evaluation):
    appeal(client, evaluation)
    client.post(decision_path(evaluation), json=change())
    appeal(client, evaluation, "C07")
    second = change()
    second["replacement"].update(criterion_id="C07", value="yes")
    result = client.post(decision_path(evaluation, "C07"), json=second).json()
    assert result["original"]["total"] == 77.69
    assert result["final"]["total"] == 92.31
    assert result["final"]["items"][5]["value"] == 10
    assert result["final"]["items"][6]["value"] == "yes"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(reason=" "),
        lambda d: d.pop("replacement"),
        lambda d: d["replacement"].update(criterion_id="C07"),
        lambda d: d["replacement"].update(value=9),
        lambda d: d["replacement"].update(evidence_turn_ids=["bogus"]),
        lambda d: d["replacement"].update(reason=""),
        lambda d: d.update(action="confirm"),
    ],
)
def test_invalid_decision_keeps_appeal_open_and_score_unchanged(client, evaluation, mutate):
    appeal(client, evaluation)
    body = deepcopy(change())
    mutate(body)
    assert client.post(decision_path(evaluation), json=body).status_code == 422
    result = client.get(f"/api/evaluations/{evaluation['id']}").json()
    assert result["final"] == evaluation["original"]
    assert result["appeals"][0]["status"] == "open"


def test_competing_reviewers_only_one_decision_commits(client, evaluation):
    appeal(client, evaluation)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(lambda _: client.post(decision_path(evaluation), json=change()), range(2))
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert client.get(f"/api/evaluations/{evaluation['id']}").json()["final"]["total"] == 84.62
