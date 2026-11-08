from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.mark.parametrize(
    "path",
    [
        "/api/conversations/missing",
        "/api/evaluations/missing",
        "/api/evaluations?conversation_key=missing",
        "/api/does-not-exist",
    ],
)
def test_missing_ids_and_routes_use_error_envelope(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert set(response.json()["error"]) == {"code", "message"}


def test_invalid_requests_and_missing_review_objects(client, evaluation, key):
    assert client.get("/api/evaluations").status_code == 422
    assert (
        client.post(
            "/api/imports", content="{broken", headers={"Content-Type": "application/json"}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/imports", json={"source": "upload", "group_id": "SYNTH"}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/evaluations", json={"conversation_key": key, "checklist_version_id": "missing"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/evaluations/{evaluation['id']}/appeals",
            json={"criterion_id": "C06", "comment": " "},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/evaluations/{evaluation['id']}/appeals",
            json={"criterion_id": "unknown", "comment": "Review"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/evaluations/{evaluation['id']}/appeals/C06/decision",
            json={"action": "confirm", "reason": "Review"},
        ).status_code
        == 404
    )
    assert client.get("/api/health").headers["cache-control"] == "no-store"


def test_request_limit(client):
    response = client.post(
        "/api/imports", content=b" " * 25_000_001, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_input"


@pytest.mark.parametrize("body", [b"\xff", b'{"source":"upload"}\xff'])
def test_invalid_json_encoding_uses_validation_error(client, body):
    response = client.post(
        "/api/imports", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_input"
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/conversations").json() == {"items": []}


def test_optional_built_frontend_and_api_precedence(settings, tmp_path):
    (tmp_path / "index.html").write_text("<!DOCTYPE html><title>Synthetic frontend build</title>")
    with TestClient(create_app(replace(settings, frontend_dir=tmp_path))) as client:
        assert "Synthetic frontend build" in client.get("/").text
        assert client.get("/api/health").json() == {"status": "ok"}
        response = client.get("/api/not-found")
        assert response.status_code == 404
        assert "error" in response.json()
