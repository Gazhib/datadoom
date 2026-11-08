"""Durable SQLite jobs; network calls never hold a database transaction."""

from __future__ import annotations

import logging
import sqlite3
from datetime import UTC, datetime
from threading import Event, Thread
from time import monotonic
from typing import Any
from uuid import uuid4

import httpx

from .config import Settings
from .database import Database
from .errors import APIError
from .models import EvaluationCreate, EvaluationJob, JobBatch, JobError, JobProgress, ReasonLocale
from .service import Service, missing
from .upstream import Upstream


def now() -> str:
    return datetime.now(UTC).isoformat()


class Jobs:
    def __init__(self, service: Service) -> None:
        self.service = service
        self.database = service.database

    @staticmethod
    def _read(connection: sqlite3.Connection, job_id: str) -> EvaluationJob:
        row = connection.execute(
            "SELECT rowid, * FROM evaluation_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if row is None:
            raise missing("Evaluation job")
        position = None
        if row["status"] == "queued":
            position = connection.execute(
                "SELECT COUNT(*) FROM evaluation_jobs WHERE status = 'queued' AND rowid <= ?",
                (row["rowid"],),
            ).fetchone()[0]
        return EvaluationJob(
            **{
                k: row[k]
                for k in (
                    "id",
                    "conversation_key",
                    "checklist_version_id",
                    "status",
                    "created_at",
                    "started_at",
                    "finished_at",
                    "evaluation_id",
                    "reason_locale",
                )
            },
            queue_position=position,
            error=JobError.model_validate_json(row["error_json"]) if row["error_json"] else None,
            progress=JobProgress.model_validate_json(row["progress_json"])
            if row["progress_json"]
            else None,
        )

    def get(self, job_id: str) -> EvaluationJob:
        with self.database.transaction() as connection:
            return self._read(connection, job_id)

    def list_jobs(
        self, conversation_key: str | None = None, active: bool = False
    ) -> list[EvaluationJob]:
        clauses, values = [], []
        if conversation_key is not None:
            clauses.append("conversation_key = ?")
            values.append(conversation_key)
        if active:
            clauses.append("status IN ('queued', 'running')")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.database.transaction() as connection:
            rows = connection.execute(
                "SELECT id FROM evaluation_jobs" + where + " ORDER BY rowid DESC",
                values,
            ).fetchall()
            return [self._read(connection, row["id"]) for row in rows]

    @staticmethod
    def _insert(
        connection: sqlite3.Connection, key: str, version: str, reason_locale: ReasonLocale | None
    ) -> str:
        job_id = uuid4().hex
        connection.execute(
            "INSERT INTO evaluation_jobs "
            "(id, conversation_key, checklist_version_id, status, created_at, reason_locale) "
            "VALUES (?, ?, ?, 'queued', ?, ?)",
            (job_id, key, version, now(), reason_locale),
        )
        return job_id

    def enqueue(self, request: EvaluationCreate) -> EvaluationJob:
        self.service.get_conversation(request.conversation_key)
        self.service.get_checklist(request.checklist_version_id)
        with self.database.transaction(write=True) as connection:
            job_id = self._insert(
                connection,
                request.conversation_key,
                request.checklist_version_id,
                request.reason_locale,
            )
            return self._read(connection, job_id)

    def batch(self, request: JobBatch) -> list[EvaluationJob]:
        version = request.checklist_version_id
        locale = request.reason_locale
        self.service.get_checklist(version)
        conversations = self.service.list_conversations(request.group_id)
        with self.database.transaction(write=True) as connection:
            ids = []
            for conversation in conversations:
                if request.skip_existing:
                    completed = connection.execute(
                        "SELECT 1 FROM evaluations WHERE conversation_key = ? "
                        "AND checklist_version_id = ? AND mode = 'live' LIMIT 1",
                        (conversation.key, version),
                    ).fetchone()
                    if completed:
                        continue
                    # Reusing active work makes repeated batch requests safe during resume.
                    active = connection.execute(
                        "SELECT id FROM evaluation_jobs WHERE conversation_key = ? "
                        "AND checklist_version_id = ? AND COALESCE(reason_locale, 'en') = ? "
                        "AND status IN ('queued', 'running') "
                        "ORDER BY rowid LIMIT 1",
                        (conversation.key, version, locale or "en"),
                    ).fetchone()
                    if active:
                        ids.append(active["id"])
                        continue
                ids.append(self._insert(connection, conversation.key, version, locale))
            return [self._read(connection, job_id) for job_id in ids]

    def cancel(self, job_id: str) -> EvaluationJob:
        with self.database.transaction(write=True) as connection:
            if self._read(connection, job_id).status != "queued":
                raise APIError(409, "job_not_cancellable", "Only queued jobs can be cancelled.")
            connection.execute(
                "UPDATE evaluation_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?",
                (now(), job_id),
            )
            return self._read(connection, job_id)

    def recover(self) -> None:
        with self.database.transaction(write=True) as connection:
            connection.execute(
                "UPDATE evaluation_jobs SET status = 'failed', finished_at = ?, error_json = ? "
                "WHERE status = 'running'",
                (
                    now(),
                    JobError(
                        code="interrupted", message="Run interrupted by restart."
                    ).model_dump_json(),
                ),
            )

    def claim(self) -> EvaluationJob | None:
        with self.database.transaction(write=True) as connection:
            row = connection.execute(
                "SELECT id FROM evaluation_jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1",
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                "UPDATE evaluation_jobs SET status = 'running', started_at = ? WHERE id = ?",
                (now(), row["id"]),
            )
            return self._read(connection, row["id"])

    def progress(self, job_id: str, event: dict[str, Any]) -> None:
        with self.database.transaction(write=True) as connection:
            job = self._read(connection, job_id)
            if event["event"] == "started":
                progress = {"judges": [{"name": n, "status": "pending"} for n in event["judges"]]}
            else:
                if job.progress is None:
                    raise ValueError("Judge event before stream start")
                progress = job.progress.model_dump()
                judge = next(
                    (j for j in progress["judges"] if j["name"] == event.get("judge")), None
                )
                if judge is None:
                    raise ValueError("Unknown judge in stream")
                if event["event"] == "judge_started":
                    judge["status"] = "running"
                else:
                    if event.get("status") not in {"ok", "failed", "skipped"}:
                        raise ValueError("Invalid judge status")
                    judge.update(
                        status=event["status"],
                        seconds=event.get("seconds"),
                        error_code=event.get("error_code"),
                        grades=event.get("grades"),
                    )
            parsed = JobProgress.model_validate(progress)
            connection.execute(
                "UPDATE evaluation_jobs SET progress_json = ? WHERE id = ? AND status = 'running'",
                (parsed.model_dump_json(), job_id),
            )

    def run_one(self) -> bool:
        job = self.claim()
        if job is None:
            return False
        error = None
        evaluation_id = None
        try:
            evaluation = self.service.evaluate(
                job.conversation_key,
                job.checklist_version_id,
                progress=lambda event: self.progress(job.id, event),
                reason_locale=job.reason_locale,
            )
            evaluation_id = evaluation.id
        except APIError as exc:
            error = JobError(code=exc.code, message=exc.message)
        except Exception as exc:
            logging.getLogger(__name__).error("Job failed: %s", type(exc).__name__)
            error = JobError(code="internal_error", message="An internal error occurred.")
        with self.database.transaction(write=True) as connection:
            connection.execute(
                "UPDATE evaluation_jobs SET status = ?, finished_at = ?, "
                "evaluation_id = ?, error_json = ? WHERE id = ? AND status = 'running'",
                (
                    "failed" if error else "succeeded",
                    now(),
                    evaluation_id,
                    error.model_dump_json() if error else None,
                    job.id,
                ),
            )
        return True


class JobWorkers:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings
        self.stop_event = Event()
        self.threads: list[Thread] = []

    def start(self) -> None:
        for index in range(self.settings.evaluation_concurrency):
            thread = Thread(target=self._run, name=f"evaluation-worker-{index}", daemon=True)
            self.threads.append(thread)
            thread.start()

    def _run(self) -> None:
        # A draining worker owns its client even after the bounded shutdown join expires.
        with httpx.Client(trust_env=False) as client:
            jobs = Jobs(Service(self.database, Upstream(self.settings, client)))
            while not self.stop_event.is_set():
                try:
                    if jobs.run_one():
                        continue
                except Exception as exc:
                    logging.getLogger(__name__).error("Worker failed: %s", type(exc).__name__)
                self.stop_event.wait(0.1)

    def stop(self) -> None:
        self.stop_event.set()
        deadline = monotonic() + 5
        for thread in self.threads:
            thread.join(timeout=max(0, deadline - monotonic()))
