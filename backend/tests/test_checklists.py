from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


def test_versions_remain_immutable_after_restart(client, evaluation, settings, key, stub):
    original = client.get("/api/checklists").json()["items"][0]
    assert original["version_id"] == "default-v1"
    assert original["name"] == "Чек-лист Freedom Broker"
    assert [c["weight"] for c in original["criteria"]] == [10, 15, 20, 20, 15, 15, 5, 0]
    updated = deepcopy(original)
    updated.pop("version_id")
    updated["name"] = "Edited version"
    updated["criteria"][4]["label"] = "Оператор явно предложил ответить на английском"
    updated["criteria"][4]["instruction"] = "Да, если явно предложен ответ на английском."
    response = client.post("/api/checklists", json=updated)
    assert response.status_code == 201
    saved = response.json()
    assert saved["version_id"] != "default-v1"
    stub.grades[4]["value"] = "no"
    new_run = client.post(
        "/api/evaluations",
        json={"conversation_key": key, "checklist_version_id": saved["version_id"]},
    ).json()
    assert stub.requests[-1][2]["checklist"] == saved
    assert stub.requests[-1][2]["conversation"]["key"] == key
    assert new_run["checklist"] == saved
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get(f"/api/evaluations/{evaluation['id']}").json() == evaluation
        assert restarted.get(f"/api/evaluations/{new_run['id']}").json() == new_run
        assert restarted.get("/api/checklists").json()["items"] == [saved, original]


def test_saved_replacement_reaches_evaluator_for_fresh_input_pair(
    client, evaluation, records, key, stub
):
    # The HTTP stub simulates grades; this verifies backend forwarding, not inference.
    checklist = deepcopy(evaluation["checklist"])
    checklist.pop("version_id")
    checklist["criteria"][4].update(
        label="Оператор явно предложил ответить на английском",
        instruction="Да, если оператор явно предложил ответить на английском.",
    )
    saved = client.post("/api/checklists", json=checklist).json()
    stub.mode = "live"
    stub.grades[4]["value"] = "no"
    original = client.post(
        "/api/evaluations",
        json={"conversation_key": key, "checklist_version_id": saved["version_id"]},
    )
    assert original.status_code == 201
    original_request = stub.requests[-1][2]

    fresh = deepcopy(records[0])
    fresh["conversation_id"] = "ru-fresh-english-offer"
    fresh["transcript"][2]["text"] += " Могу ответить на английском."
    assert (
        client.post(
            "/api/imports", json={"source": "upload", "group_id": "FRESH", "records": [fresh]}
        ).status_code
        == 200
    )
    fresh_key = client.get("/api/conversations?group_id=FRESH").json()["items"][0]["key"]
    assert fresh_key != key
    stub.grades[4].update(value="yes", evidence_turn_ids=["t3"])
    changed = client.post(
        "/api/evaluations",
        json={"conversation_key": fresh_key, "checklist_version_id": saved["version_id"]},
    )
    assert changed.status_code == 201
    changed_request = stub.requests[-1][2]
    assert original_request["checklist"] == changed_request["checklist"] == saved
    assert "Могу ответить" not in original_request["conversation"]["turns"][2]["text"]
    assert "Могу ответить" in changed_request["conversation"]["turns"][2]["text"]
    assert original.json()["mode"] == changed.json()["mode"] == "live"
    assert original.json()["original"]["items"][4]["value"] == "no"
    assert changed.json()["original"]["items"][4]["value"] == "yes"
    assert changed.json()["original"]["items"][4]["evidence_turn_ids"] == ["t3"]
    assert client.get(f"/api/evaluations/{evaluation['id']}").json() == evaluation


@pytest.mark.parametrize(
    "mutation",
    [
        lambda c: c.update(label=" "),
        lambda c: c.update(instruction=""),
        lambda c: c.update(weight=0),
        lambda c: c.update(weight=101),
        lambda c: c.update(weight=True),
        lambda c: c.update(weight=1.5),
        lambda c: c.update(scale=[0, 1]),
        lambda c: c.update(allow_na=True, na_rule=" "),
        lambda c: c.update(na_rule="Unexpected rule"),
        lambda c: c.update(allow_na="false"),
        lambda c: c.update(kind="scale", scale=[0, 5, 5, 10]),
        lambda c: c.update(kind="scale", scale=[5, 10]),
        lambda c: c.update(kind="scale", scale=[0]),
        lambda c: c.update(kind="scale", scale=[0, -1, 10]),
        lambda c: c.update(kind="scale", scale=[0, True, 10]),
        lambda c: c.update(kind="flag", weight=1),
        lambda c: c.update(kind="flag", weight=0, allow_na=True, na_rule="Reason"),
    ],
)
def test_invalid_criterion_is_rejected(client, mutation):
    criterion = client.get("/api/checklists").json()["items"][0]["criteria"][0]
    mutation(criterion)
    assert (
        client.post(
            "/api/checklists", json={"name": "Invalid", "criteria": [criterion]}
        ).status_code
        == 422
    )
    assert len(client.get("/api/checklists").json()["items"]) == 1


def test_no_weighted_criterion_and_duplicate_ids_rejected(client):
    criteria = client.get("/api/checklists").json()["items"][0]["criteria"]
    for rows in ([], [criteria[-1]], [criteria[0], criteria[0]]):
        assert (
            client.post("/api/checklists", json={"name": "Bad", "criteria": rows}).status_code
            == 422
        )
