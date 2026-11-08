import logging
import sqlite3
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from .database import Database
from .errors import APIError
from .models import (
    Appeal,
    AppealCreate,
    Checklist,
    ChecklistCreate,
    Conversation,
    ConversationSummary,
    ConversationWithLatest,
    Decision,
    Evaluation,
    Grade,
    ImportRequest,
    ImportResult,
    LatestEvaluation,
    ReasonLocale,
    Turn,
)
from .scoring import calculate_score, validate_grade, validate_grades
from .upstream import Upstream


def missing(name: str) -> APIError:
    return APIError(404, "not_found", f"{name} was not found.")


class Service:
    def __init__(self, database: Database, upstream: Upstream) -> None:
        self.database = database
        self.upstream = upstream

    def import_records(self, request: ImportRequest) -> ImportResult:
        records = (
            self.upstream.organizer_records(request.group_id)
            if request.source == "organizer"
            else request.records
        )
        assert records is not None
        imported = skipped = 0
        # This operation owns the transaction; a conflict rolls back the entire batch.
        with self.database.transaction(write=True) as connection:
            for record in records:
                source_json = record.model_dump_json()
                existing = connection.execute(
                    "SELECT source_json FROM conversations "
                    "WHERE group_id = ? AND conversation_id = ?",
                    (request.group_id, record.conversation_id),
                ).fetchone()
                if existing is not None:
                    if existing["source_json"] != source_json:
                        raise APIError(
                            409,
                            "import_conflict",
                            "A conversation already exists with different source data.",
                        )
                    skipped += 1
                    continue
                conversation = Conversation(
                    key=uuid4().hex,
                    group_id=request.group_id,
                    conversation_id=record.conversation_id,
                    channel=record.channel,
                    language=record.language,
                    audio_url=record.audio_url,
                    turns=[
                        Turn(id=f"t{index}", **turn.model_dump())
                        for index, turn in enumerate(record.transcript, start=1)
                    ],
                )
                connection.execute(
                    """INSERT INTO conversations
                        (key, group_id, conversation_id, source_json, payload)
                        VALUES (?, ?, ?, ?, ?)""",
                    (
                        conversation.key,
                        request.group_id,
                        record.conversation_id,
                        source_json,
                        conversation.model_dump_json(),
                    ),
                )
                imported += 1
        return ImportResult(group_id=request.group_id, imported=imported, skipped=skipped)

    def list_conversations(self, group_id: str | None = None) -> list[ConversationSummary]:
        with self.database.transaction() as connection:
            rows = connection.execute(
                "SELECT payload FROM conversations ORDER BY rowid"
                if group_id is None
                else "SELECT payload FROM conversations WHERE group_id = ? ORDER BY rowid",
                () if group_id is None else (group_id,),
            ).fetchall()
        return [
            ConversationSummary.model_validate(
                Conversation.model_validate_json(row["payload"]).model_dump(exclude={"turns"})
            )
            for row in rows
        ]

    def get_conversation(self, key: str) -> Conversation:
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT payload FROM conversations WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            raise missing("Conversation")
        return Conversation.model_validate_json(row["payload"])

    def list_checklists(self) -> list[Checklist]:
        with self.database.transaction() as connection:
            rows = connection.execute(
                "SELECT payload FROM checklists ORDER BY rowid DESC"
            ).fetchall()
        return [Checklist.model_validate_json(row["payload"]) for row in rows]

    def get_checklist(self, version_id: str) -> Checklist:
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT payload FROM checklists WHERE version_id = ?", (version_id,)
            ).fetchone()
        if row is None:
            raise missing("Checklist version")
        return Checklist.model_validate_json(row["payload"])

    def create_checklist(self, request: ChecklistCreate) -> Checklist:
        checklist = Checklist(version_id=uuid4().hex, **request.model_dump())
        with self.database.transaction(write=True) as connection:
            connection.execute(
                "INSERT INTO checklists(version_id, payload) VALUES (?, ?)",
                (checklist.version_id, checklist.model_dump_json()),
            )
        return checklist

    def list_conversations_latest(self, group_id: str | None) -> list[ConversationWithLatest]:
        summaries = self.list_conversations(group_id)
        with self.database.transaction() as connection:
            latest: dict[str, LatestEvaluation | None] = {}
            for summary in summaries:
                row = connection.execute(
                    "SELECT payload FROM evaluations WHERE conversation_key = ? "
                    "ORDER BY rowid DESC LIMIT 1",
                    (summary.key,),
                ).fetchone()
                latest[summary.key] = None
                if row:
                    run = Evaluation.model_validate_json(row["payload"])
                    latest[summary.key] = LatestEvaluation(
                        evaluation_id=run.id,
                        checklist_version_id=run.checklist.version_id,
                        mode=run.mode,
                        total=run.final.total,
                        serious_error=run.final.serious_error,
                    )
        return [ConversationWithLatest(**s.model_dump(), latest=latest[s.key]) for s in summaries]

    def evaluate(
        self,
        conversation_key: str,
        checklist_version_id: str,
        progress: Callable[[dict[str, Any]], None] | None = None,
        *,
        reason_locale: ReasonLocale | None = None,
    ) -> Evaluation:
        conversation = self.get_conversation(conversation_key)
        checklist = self.get_checklist(checklist_version_id)
        # Network I/O and validation happen before opening the write transaction.
        result = self.upstream.evaluate(
            conversation, checklist, progress=progress, reason_locale=reason_locale
        )
        try:
            validate_grades(result.grades, checklist, conversation)
        except ValueError:
            raise APIError(
                502,
                "invalid_evaluator_response",
                "Evaluator grades or evidence do not match this conversation and checklist.",
            ) from None
        score = calculate_score(checklist, result.grades)
        if result.panel is not None:
            ids = [vote.criterion_id for vote in result.panel.votes]
            if len(ids) != len(checklist.criteria) or set(ids) != {
                c.id for c in checklist.criteria
            }:
                logging.getLogger(__name__).warning("Dropped panel with mismatched criterion IDs")
                result.panel = None
        evaluation = Evaluation(
            id=uuid4().hex,
            conversation_key=conversation_key,
            checklist=checklist,
            mode=result.mode,
            model=result.model,
            original=score,
            final=score.model_copy(deep=True),
            appeals=[],
            panel=result.panel,
        )
        with self.database.transaction(write=True) as connection:
            connection.execute(
                """INSERT INTO evaluations
                    (id, conversation_key, checklist_version_id, mode, payload)
                    VALUES (?, ?, ?, ?, ?)""",
                (
                    evaluation.id,
                    conversation_key,
                    checklist_version_id,
                    evaluation.mode,
                    evaluation.model_dump_json(),
                ),
            )
        return evaluation

    @staticmethod
    def _evaluation(connection: sqlite3.Connection, evaluation_id: str) -> Evaluation:
        row = connection.execute(
            "SELECT payload FROM evaluations WHERE id = ?", (evaluation_id,)
        ).fetchone()
        if row is None:
            raise missing("Evaluation")
        evaluation = Evaluation.model_validate_json(row["payload"])
        appeals = connection.execute(
            "SELECT * FROM appeals WHERE evaluation_id = ? ORDER BY rowid", (evaluation_id,)
        ).fetchall()
        evaluation.appeals = [
            Appeal(
                criterion_id=row["criterion_id"],
                comment=row["comment"],
                status="resolved" if row["decision_json"] else "open",
                decision=Decision.model_validate_json(row["decision_json"])
                if row["decision_json"]
                else None,
            )
            for row in appeals
        ]
        return evaluation

    def get_evaluation(self, evaluation_id: str) -> Evaluation:
        with self.database.transaction() as connection:
            return self._evaluation(connection, evaluation_id)

    def list_evaluations(self, conversation_key: str) -> list[Evaluation]:
        self.get_conversation(conversation_key)
        with self.database.transaction() as connection:
            rows = connection.execute(
                "SELECT id FROM evaluations WHERE conversation_key = ? ORDER BY rowid DESC",
                (conversation_key,),
            ).fetchall()
            return [self._evaluation(connection, row["id"]) for row in rows]

    def has_live_run(self, conversation_key: str, checklist_version_id: str) -> bool:
        with self.database.transaction() as connection:
            row = connection.execute(
                """SELECT 1 FROM evaluations
                    WHERE conversation_key = ? AND checklist_version_id = ?
                    AND mode = 'live' LIMIT 1""",
                (conversation_key, checklist_version_id),
            ).fetchone()
        return row is not None

    def create_appeal(self, evaluation_id: str, request: AppealCreate) -> Evaluation:
        with self.database.transaction(write=True) as connection:
            evaluation = self._evaluation(connection, evaluation_id)
            if request.criterion_id not in {c.id for c in evaluation.checklist.criteria}:
                raise missing("Criterion")
            if any(appeal.criterion_id == request.criterion_id for appeal in evaluation.appeals):
                raise APIError(409, "appeal_conflict", "This criterion already has an appeal.")
            connection.execute(
                "INSERT INTO appeals(evaluation_id, criterion_id, comment) VALUES (?, ?, ?)",
                (evaluation_id, request.criterion_id, request.comment),
            )
            return self._evaluation(connection, evaluation_id)

    def decide(self, evaluation_id: str, criterion_id: str, decision: Decision) -> Evaluation:
        # Serialize competing reviewers, overlay every resolved change, and commit once.
        with self.database.transaction(write=True) as connection:
            evaluation = self._evaluation(connection, evaluation_id)
            appeal = next((a for a in evaluation.appeals if a.criterion_id == criterion_id), None)
            if appeal is None:
                raise missing("Appeal")
            if appeal.status != "open":
                raise APIError(409, "decision_conflict", "This appeal has already been resolved.")
            if decision.replacement is not None:
                row = connection.execute(
                    "SELECT payload FROM conversations WHERE key = ?",
                    (evaluation.conversation_key,),
                ).fetchone()
                conversation = Conversation.model_validate_json(row["payload"])
                criterion = next(c for c in evaluation.checklist.criteria if c.id == criterion_id)
                try:
                    validate_grade(decision.replacement, criterion, conversation)
                except ValueError as exc:
                    raise APIError(422, "invalid_grade", str(exc)) from None
            appeal.status = "resolved"
            appeal.decision = decision
            grades = {
                item.criterion_id: Grade.model_validate(
                    item.model_dump(include=set(Grade.model_fields))
                )
                for item in evaluation.original.items
            }
            for resolved in evaluation.appeals:
                if resolved.decision and resolved.decision.replacement:
                    grades[resolved.criterion_id] = resolved.decision.replacement
            evaluation.final = calculate_score(evaluation.checklist, list(grades.values()))
            connection.execute(
                "UPDATE appeals SET decision_json = ? WHERE evaluation_id = ? AND criterion_id = ?",
                (decision.model_dump_json(exclude_none=True), evaluation_id, criterion_id),
            )
            connection.execute(
                "UPDATE evaluations SET payload = ? WHERE id = ?",
                (evaluation.model_copy(update={"appeals": []}).model_dump_json(), evaluation_id),
            )
            return evaluation
