"""Generate and check the organizer's results document without transcript text."""

import argparse
import json
import logging
import os
import re
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import Field, StrictBool, ValidationError, field_validator, model_validator

from .config import Settings
from .database import Database
from .errors import APIError
from .models import Checklist, Contract, Conversation, Evaluation, Nonblank, StrictInteger
from .service import missing

DEFAULT_MAP = dict(
    zip(
        [f"C{i:02}" for i in range(1, 9)],
        [
            "contact",
            "discovery",
            "identification",
            "consultation",
            "empathy",
            "dialogue",
            "closure",
            "critical",
        ],
        strict=True,
    )
)
CODES = set(DEFAULT_MAP.values())
LOCAL_PROVIDERS = {"ollama", "llama.cpp"}


class ExportCriterion(Contract):
    criterion_id: str
    value: StrictBool | StrictInteger | None
    rationale: Nonblank
    evidence_turns: Annotated[list[Annotated[int, Field(strict=True, ge=1)]], Field(min_length=1)]

    @model_validator(mode="after")
    def check_value(self) -> Self:
        code, value = self.criterion_id, self.value
        if code not in CODES:
            raise ValueError("Unknown criterion code")
        nullable = {"discovery", "identification", "consultation", "closure"}
        if value is None:
            if code not in nullable:
                raise ValueError("Criterion cannot be null")
        elif code in {"consultation", "dialogue"}:
            allowed = {0, 5, 10, 15, 20} if code == "consultation" else {0, 4, 7, 10}
            if type(value) is not int or value not in allowed:
                raise ValueError("Invalid scale grade")
        elif type(value) is not bool:
            raise ValueError("Criterion requires a boolean")
        return self


class ExportScore(Contract):
    final_score: Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)] | None
    critical_flag: StrictBool

    @field_validator("final_score")
    @classmethod
    def two_decimals(cls, value: float | None) -> float | None:
        if value is not None and Decimal(str(value)) * 100 % 1:
            raise ValueError("Scores have at most two decimals")
        return value


class ExportRow(Contract):
    conversation_id: Nonblank
    status: Literal["ok", "error"]
    criteria: list[ExportCriterion]
    score: ExportScore | None
    error: Nonblank | None = None

    @model_validator(mode="after")
    def check_row(self) -> Self:
        if self.status == "error":
            if self.criteria or self.score is not None or self.error is None:
                raise ValueError("Error rows require empty criteria, null score and an error")
        else:
            if (
                len(self.criteria) != 8
                or {c.criterion_id for c in self.criteria} != CODES
                or self.score is None
                or self.error is not None
            ):
                raise ValueError("Successful rows require all eight criteria and a score")
            critical = next(c.value for c in self.criteria if c.criterion_id == "critical")
            if self.score.critical_flag != critical:
                raise ValueError("Critical flag does not match the criterion")
        return self


class ExportModel(Contract):
    mode: Literal["local", "external_api", "hybrid"]
    name: Nonblank


class ResultsDocument(Contract):
    schema_version: Literal["1.0"]
    team_name: Nonblank
    model: ExportModel
    results: list[ExportRow]

    @field_validator("results")
    @classmethod
    def unique_ids(cls, rows: list[ExportRow]) -> list[ExportRow]:
        if len({r.conversation_id for r in rows}) != len(rows):
            raise ValueError("Conversation IDs must be unique")
        return rows


def check_document(body: Any, expect_count: int | None = None) -> ResultsDocument:
    try:
        document = ResultsDocument.model_validate(body)
        if expect_count is not None and len(document.results) != expect_count:
            raise ValueError
        return document
    except (ValidationError, ValueError):
        raise APIError(
            422, "invalid_results", "Results do not match schema 1.0 or expected count."
        ) from None


def check_file(path: Path, expect_count: int | None = None) -> ResultsDocument:
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise APIError(422, "invalid_results", "Results must be readable UTF-8 JSON.") from None
    return check_document(body, expect_count)


def criterion_mapping(checklist: Checklist, supplied: dict[str, str] | None) -> dict[str, str]:
    mapping = DEFAULT_MAP | (supplied or {})
    ids = [c.id for c in checklist.criteria]
    unmapped = [key for key in ids if key not in mapping or mapping[key] not in CODES]
    if unmapped:
        raise APIError(422, "unmapped_criteria", "Unmapped criterion IDs: " + ", ".join(unmapped))
    if len(ids) != 8 or {mapping[key] for key in ids} != CODES:
        raise APIError(
            422,
            "unmapped_criteria",
            "Map the checklist IDs to each of the eight export codes exactly once.",
        )
    return mapping


def build_results(
    database: Database,
    group_id: str,
    version_id: str,
    team_name: str,
    *,
    use_final: bool = False,
    criterion_map: dict[str, str] | None = None,
    expect_count: int | None = None,
) -> ResultsDocument:
    # One read snapshot fixes selection and post-appeal totals for the entire document.
    with database.transaction() as connection:
        row = connection.execute(
            "SELECT payload FROM checklists WHERE version_id = ?", (version_id,)
        ).fetchone()
        if row is None:
            raise missing("Checklist version")
        mapping = criterion_mapping(Checklist.model_validate_json(row["payload"]), criterion_map)
        rows = connection.execute(
            "SELECT c.payload AS conversation, e.payload AS evaluation FROM conversations c "
            "LEFT JOIN evaluations e ON e.rowid = (SELECT e2.rowid FROM evaluations e2 "
            "WHERE e2.conversation_key = c.key AND e2.checklist_version_id = ? "
            "AND e2.mode = 'live' ORDER BY e2.rowid DESC LIMIT 1) "
            "WHERE c.group_id = ? ORDER BY c.rowid",
            (version_id, group_id),
        ).fetchall()
    results: list[dict[str, Any]] = []
    models: dict[str, None] = {}
    providers: list[str] = []
    for row in rows:
        conversation = Conversation.model_validate_json(row["conversation"])
        if row["evaluation"] is None:
            results.append(
                {
                    "conversation_id": conversation.conversation_id,
                    "status": "error",
                    "criteria": [],
                    "score": None,
                    "error": "No successful live evaluation for this checklist version.",
                }
            )
            continue
        evaluation = Evaluation.model_validate_json(row["evaluation"])
        if evaluation.panel and evaluation.panel.judges:
            for judge in evaluation.panel.judges:
                models[judge.model] = None
                providers.append(judge.provider.lower())
        else:
            for name in evaluation.model.model.split(" + "):
                provider, separator, model = name.strip().partition("/")
                models[model if separator else provider] = None
                providers.append(
                    provider.lower() if separator else evaluation.model.provider.lower()
                )
        score = evaluation.final if use_final else evaluation.original
        criteria = []
        for item in score.items:
            value: bool | int | None
            if type(item.value) is int:
                value = item.value
            else:
                value = {"yes": True, "no": False, "na": None}[str(item.value)]
            evidence = []
            for turn_id in item.evidence_turn_ids:
                match = re.fullmatch(r"t([1-9]\d*)", turn_id)
                if match is None:
                    raise APIError(
                        422, "invalid_results", "Evidence cannot be mapped to transcript positions."
                    )
                evidence.append(int(match[1]))
            criteria.append(
                {
                    "criterion_id": mapping[item.criterion_id],
                    "value": value,
                    "rationale": item.reason,
                    "evidence_turns": evidence,
                }
            )
        results.append(
            {
                "conversation_id": conversation.conversation_id,
                "status": "ok",
                "criteria": criteria,
                "score": {"final_score": score.total, "critical_flag": score.serious_error},
            }
        )
    local = [p in LOCAL_PROVIDERS for p in providers]
    mode = "local" if all(local) else "hybrid" if any(local) else "external_api"
    return check_document(
        {
            "schema_version": "1.0",
            "team_name": team_name,
            "model": {"mode": mode, "name": " + ".join(models) or "unavailable"},
            "results": results,
        },
        expect_count,
    )


def write_results(
    document: ResultsDocument, path: Path, expect_count: int | None = None
) -> dict[str, Any]:
    check_document(document.model_dump(), expect_count)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".results-",
            suffix=".json",
            delete=False,
        ) as handle:
            temporary = handle.name
            json.dump(
                document.model_dump(exclude_none=False),
                handle,
                ensure_ascii=False,
                indent=2,
                allow_nan=False,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        check_file(Path(temporary), expect_count)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
    return summary(document)


def summary(document: ResultsDocument) -> dict[str, Any]:
    return {
        "event": "results_checked",
        "count": len(document.results),
        "ok": sum(r.status == "ok" for r in document.results),
        "errors": sum(r.status == "error" for r in document.results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", type=Path)
    parser.add_argument("--group-id")
    parser.add_argument("--checklist-version-id")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--team-name")
    parser.add_argument("--use-final", action="store_true")
    parser.add_argument("--criterion-map", type=Path)
    parser.add_argument("--expect-count", type=int)
    args = parser.parse_args()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        if args.expect_count is not None and args.expect_count < 0:
            parser.error("Expected count must be nonnegative")
        if args.check:
            result = summary(check_file(args.check, args.expect_count))
        else:
            config = Settings.from_env()
            team = args.team_name or config.results_team_name
            if not args.group_id or not args.checklist_version_id or not args.out or not team:
                parser.error("Export requires group, checklist version, output and team name")
            mapping = (
                json.loads(args.criterion_map.read_text(encoding="utf-8"))
                if args.criterion_map
                else None
            )
            if mapping is not None and (
                not isinstance(mapping, dict)
                or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items())
            ):
                raise APIError(
                    422,
                    "unmapped_criteria",
                    "Criterion map must be a JSON string-to-string object.",
                )
            database = Database(config.database_path)
            database.initialize()
            document = build_results(
                database,
                args.group_id,
                args.checklist_version_id,
                team,
                use_final=args.use_final,
                criterion_map=mapping,
                expect_count=args.expect_count,
            )
            result = write_results(document, args.out, args.expect_count)
    except APIError as exc:
        result = {"event": "error", "code": exc.code, "message": exc.message}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return 1
    except (ValueError, OSError):
        print(
            json.dumps(
                {
                    "event": "error",
                    "code": "configuration_unavailable",
                    "message": "Check configuration and file access.",
                }
            ),
            flush=True,
        )
        return 1
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
