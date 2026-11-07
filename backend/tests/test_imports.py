import logging
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.upstream import organizer_url


def upload(client, records, group="SYNTH"):
    return client.post(
        "/api/imports", json={"source": "upload", "group_id": group, "records": records}
    )


def test_import_preserves_source_and_survives_restart(client, settings, records):
    call = deepcopy(records[0])
    call.update(
        conversation_id="en-call",
        channel="voice call",
        language="EN",
        audio_url="https://example.test/synthetic.wav",
    )
    call["transcript"] = [
        {"timestamp": "2026-11-07T10:00:00+05:00", "speaker": "bot", "text": "Welcome"},
        {"timestamp": "2026-11-07T10:00:01+05:00", "speaker": "client", "text": "Hello"},
    ]
    kz = deepcopy(records[0])
    kz.update(conversation_id="kz-chat", language="KZ", audio_url="  ")
    kz["transcript"][0]["text"] = "Сәлеметсіз бе!"
    data = [*records, call, kz]
    assert client.get("/api/health").json() == {"status": "ok"}
    assert upload(client, data).json() == {"group_id": "SYNTH", "imported": 3, "skipped": 0}
    listing = client.get("/api/conversations?group_id=SYNTH").json()["items"]
    assert [row["conversation_id"] for row in listing] == ["ru-001", "en-call", "kz-chat"]
    for raw, row in zip(data, listing, strict=True):
        result = client.get(f"/api/conversations/{row['key']}").json()
        assert [dict(id=f"t{i}", **turn) for i, turn in enumerate(raw["transcript"], 1)] == result[
            "turns"
        ]
        assert "turns" not in row
    assert listing[-1]["audio_url"] is None
    assert upload(client, data).json()["skipped"] == 3
    assert client.get("/api/conversations?group_id=OTHER").json() == {"items": []}
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get("/api/conversations").json()["items"] == listing
        assert len(restarted.get("/api/checklists").json()["items"]) == 1


def test_conflicting_batch_rolls_back_all_records(client, records, key):
    fresh = deepcopy(records[0])
    fresh["conversation_id"] = "new-id"
    changed = deepcopy(records[0])
    changed["transcript"][0]["text"] = "Changed source"
    assert upload(client, [fresh, changed]).status_code == 409
    assert len(client.get("/api/conversations").json()["items"]) == 1
    assert client.get("/api/conversations").json()["items"][0]["key"] == key
    assert upload(client, [fresh, fresh]).json()["skipped"] == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda r: r.update(language="XX"),
        lambda r: r.update(channel="email"),
        lambda r: r.update(transcript=[]),
        lambda r: r.update(conversation_id=" "),
        lambda r: r["transcript"][0].update(speaker="admin"),
        lambda r: r.update(audio_url="javascript:alert(1)"),
        lambda r: r.update(transcript=[{"timestamp": "now", "speaker": "client", "text": " "}]),
        lambda r: r["transcript"][0].update(timestamp=""),
    ],
)
def test_invalid_upload_is_atomic_and_does_not_echo_source(client, records, mutation):
    invalid = deepcopy(records[0])
    mutation(invalid)
    response = upload(client, [records[0], invalid])
    assert response.status_code == 422
    assert set(response.json()) == {"error"}
    assert "Какой" not in response.text
    assert client.get("/api/conversations").json() == {"items": []}


def test_concurrent_imports_keep_one_key(client, records):
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: upload(client, records), range(2)))
    assert sorted(response.json()["imported"] for response in responses) == [0, 1]
    assert len(client.get("/api/conversations").json()["items"]) == 1


def test_signed_query_is_preserved_and_group_cannot_inject():
    source = "https://example.test/raw?sig=a%2Bb%2f%3D&group_id=DEV&space=a+b&space=c%20d"
    assert organizer_url(source, "A&B /?=") == source.replace(
        "group_id=DEV", "group_id=A%26B%20%2F%3F%3D"
    )
    assert organizer_url("https://example.test/raw?sig=x", "CONTROL").endswith(
        "sig=x&group_id=CONTROL"
    )


def test_organizer_uses_http_wrapper_and_empty_success(client, stub):
    response = client.post("/api/imports", json={"source": "organizer", "group_id": "SYNTH & MORE"})
    assert response.status_code == 200
    assert response.json()["imported"] == 1
    assert (
        stub.requests[-1][1] == "/signed?sig=synthetic%2Btoken&group_id=SYNTH%20%26%20MORE&x=a%20b"
    )
    stub.organizer_payload["data"]["records"] = []
    assert (
        client.post("/api/imports", json={"source": "organizer", "group_id": "EMPTY"}).json()[
            "imported"
        ]
        == 0
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"isSuccess": False},
        {"isSuccess": "true"},
        {"isSuccess": True, "data": {}},
        {"isSuccess": True, "data": {"records": [{}]}},
    ],
)
def test_invalid_organizer_response_does_not_write(client, stub, body):
    stub.organizer_payload = body
    assert (
        client.post("/api/imports", json={"source": "organizer", "group_id": "SYNTH"}).status_code
        == 502
    )
    assert client.get("/api/conversations").json()["items"] == []


def test_unconfigured_organizer_is_503(settings):
    with TestClient(create_app(replace(settings, organizer_get_url=None))) as client:
        assert (
            client.post("/api/imports", json={"source": "organizer", "group_id": "DEV"}).status_code
            == 503
        )


def test_signed_organizer_url_is_not_logged_at_info(settings, caplog):
    caplog.set_level(logging.INFO, logger="httpx")
    caplog.set_level(logging.DEBUG, logger="httpcore")
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/imports", json={"source": "organizer", "group_id": "DEV"})
    assert response.status_code == 200
    assert "synthetic%2Btoken" not in caplog.text
    assert "sig=" not in caplog.text
