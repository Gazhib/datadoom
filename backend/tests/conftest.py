import json

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.tests.http_stub import FIXTURES, Stub


@pytest.fixture
def records():
    return json.loads((FIXTURES / "synthetic.json").read_text())


@pytest.fixture
def stub():
    with Stub() as server:
        yield server


@pytest.fixture
def settings(tmp_path, stub):
    return Settings(
        database_path=tmp_path / "test.sqlite3",
        evaluator_url=stub.url,
        organizer_get_url=stub.url + "/signed?sig=synthetic%2Btoken&group_id=DEV&x=a%20b",
        upstream_timeout=1,
        allow_fixture=True,
        frontend_dir=tmp_path / "no-dist",
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as connection:
        yield connection


@pytest.fixture
def key(client, records):
    response = client.post(
        "/api/imports", json={"source": "upload", "group_id": "SYNTH", "records": records}
    )
    assert response.status_code == 200, response.text
    return client.get("/api/conversations?group_id=SYNTH").json()["items"][0]["key"]


@pytest.fixture
def evaluation(client, key):
    response = client.post(
        "/api/evaluations", json={"conversation_key": key, "checklist_version_id": "default-v1"}
    )
    assert response.status_code == 201, response.text
    return response.json()
