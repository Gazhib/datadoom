import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.jobs import Jobs
from backend.main import create_app
from backend.tests.test_evaluations import evaluate


@pytest.fixture
def queued_client(settings):
    with TestClient(create_app(settings, start_workers=False)) as client:
        yield client


def import_keys(client, records, count=3):
    batch = [dict(records[0], conversation_id=f"synthetic-{i}") for i in range(count)]
    assert (
        client.post(
            "/api/imports", json={"source": "upload", "group_id": "SYNTH", "records": batch}
        ).status_code
        == 200
    )
    return [c["key"] for c in client.get("/api/conversations").json()["items"]]


def enqueue(client, key, version="default-v1", **options):
    return client.post(
        "/api/evaluation-jobs",
        json={"conversation_key": key, "checklist_version_id": version, **options},
    )


def test_fifo_positions_cancel_and_error_envelope(queued_client, records):
    client = queued_client
    keys = import_keys(client, records)
    jobs = [enqueue(client, key).json() for key in keys]
    assert [j["queue_position"] for j in jobs] == [1, 2, 3]
    manager = Jobs(client.app.state.service)
    assert manager.claim().id == jobs[0]["id"]
    assert client.post(f"/api/evaluation-jobs/{jobs[0]['id']}/cancel").status_code == 409
    cancelled = client.post(f"/api/evaluation-jobs/{jobs[1]['id']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["finished_at"] and cancelled["queue_position"] is None
    assert manager.get(jobs[2]["id"]).queue_position == 1
    assert manager.claim().id == jobs[2]["id"]
    assert manager.claim() is None
    assert len(client.get("/api/evaluation-jobs?active=true").json()["items"]) == 2
    assert client.get("/api/evaluation-jobs").json()["items"][0]["id"] == jobs[2]["id"]
    for response in [
        enqueue(client, "missing"),
        enqueue(client, keys[0], "missing"),
        client.get("/api/evaluation-jobs/missing"),
        client.post("/api/evaluation-jobs/missing/cancel"),
    ]:
        assert response.status_code == 404
        assert set(response.json()["error"]) == {"code", "message"}


def test_failure_preserves_runs_restart_recovers_and_batch_resumes(
    queued_client, settings, records, stub
):
    client = queued_client
    keys = import_keys(client, records)
    fixture = evaluate(client, keys[0]).json()
    stub.mode = "live"
    live = evaluate(client, keys[1]).json()
    request = {"group_id": "SYNTH", "checklist_version_id": "default-v1", "reason_locale": "kk"}
    batch = client.post("/api/evaluation-jobs/batch", json=request)
    assert batch.status_code == 202
    jobs = batch.json()["items"]
    assert [j["conversation_key"] for j in jobs] == [keys[0], keys[2]]
    assert client.post("/api/evaluation-jobs/batch", json=request).json()["items"] == jobs
    manager = Jobs(client.app.state.service)
    stub.status = 503
    assert manager.run_one()
    assert manager.get(jobs[0]["id"]).error.code == "upstream_failure"
    assert stub.requests[-1][2]["reason_locale"] == "kk"
    assert client.get(f"/api/evaluations?conversation_key={keys[0]}").json()["items"] == [fixture]
    assert client.get(f"/api/evaluations/{live['id']}").status_code == 200
    running = manager.claim()
    queued = enqueue(client, keys[1], reason_locale="ru").json()
    with TestClient(create_app(settings, start_workers=False)) as restarted:
        assert (
            restarted.get(f"/api/evaluation-jobs/{running.id}").json()["error"]["code"]
            == "interrupted"
        )
        assert restarted.get(f"/api/evaluation-jobs/{queued['id']}").json()["status"] == "queued"
        stub.status = 200
        assert Jobs(restarted.app.state.service).run_one()
        assert restarted.get(f"/api/evaluation-jobs/{queued['id']}").json()["status"] == "succeeded"
        assert stub.requests[-1][2]["reason_locale"] == "ru"


def test_batch_reuses_only_jobs_in_the_requested_language(queued_client, records):
    import_keys(queued_client, records, 1)
    request = {"group_id": "SYNTH", "checklist_version_id": "default-v1"}
    route = "/api/evaluation-jobs/batch"
    russian = queued_client.post(route, json={**request, "reason_locale": "ru"}).json()["items"]
    kazakh = queued_client.post(route, json={**request, "reason_locale": "kk"}).json()["items"]
    assert russian[0]["id"] != kazakh[0]["id"]
    repeated = queued_client.post(route, json={**request, "reason_locale": "ru"}).json()["items"]
    assert repeated == russian


def test_unexpected_worker_failure_logs_only_type(queued_client, records, monkeypatch, caplog):
    key = import_keys(queued_client, records, 1)[0]
    job = enqueue(queued_client, key).json()
    service = queued_client.app.state.service

    def fail(*args, **kwargs):
        raise RuntimeError("private transcript should not be logged")

    monkeypatch.setattr(service, "evaluate", fail)
    assert Jobs(service).run_one()
    failed = Jobs(service).get(job["id"])
    assert failed.error.code == "internal_error"
    assert not service.list_evaluations(key)
    assert "RuntimeError" in caplog.text
    assert "private transcript" not in caplog.text


def test_sync_and_worker_calls_share_process_limit(queued_client, records, stub):
    keys = import_keys(queued_client, records)
    stub.delay = 0.06
    manager = Jobs(queued_client.app.state.service)
    enqueue(queued_client, keys[0])
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(manager.run_one)] + [
            pool.submit(evaluate, queued_client, k) for k in keys[1:]
        ]
        results = [future.result() for future in futures]
    assert results[0] is True
    assert all(r.status_code == 201 for r in results[1:])
    assert stub.max_active == 1


def test_three_parallel_posts_never_overlap(client, key, stub):
    stub.delay = 0.05
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: evaluate(client, key), range(3)))
    assert all(r.status_code == 201 for r in results)
    assert stub.max_active == 1


def test_real_workers_run_in_order_and_stop(settings, records, stub):
    stub.delay = 0.08
    with TestClient(create_app(settings)) as client:
        keys = import_keys(client, records)
        jobs = client.post(
            "/api/evaluation-jobs/batch",
            json={"group_id": "SYNTH", "checklist_version_id": "default-v1"},
        ).json()["items"]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            active = client.get("/api/evaluation-jobs?active=true").json()["items"]
            assert sum(j["status"] == "running" for j in active) <= 1
            if not active:
                break
            Event().wait(0.02)
        else:
            pytest.fail("Workers did not drain the queue")
        assert all(
            client.get(f"/api/evaluation-jobs/{j['id']}").json()["status"] == "succeeded"
            for j in jobs
        )
        assert [r[2]["conversation"]["key"] for r in stub.requests] == keys
    assert stub.max_active == 1


def test_latest_is_opt_in_and_tracks_post_appeal_total(client, key, evaluation):
    assert "latest" not in client.get("/api/conversations").json()["items"][0]
    latest = client.get("/api/conversations?include=latest").json()["items"][0]["latest"]
    assert latest == {
        "evaluation_id": evaluation["id"],
        "checklist_version_id": "default-v1",
        "mode": "fixture",
        "total": 77.69,
        "serious_error": False,
    }
    assert client.get("/api/conversations?include=invalid").status_code == 422


def test_judges_proxy_and_unavailable(client, stub):
    assert client.get("/api/judges").json() == stub.judges_payload
    stub.status = 503
    response = client.get("/api/judges")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "evaluator_unavailable"
