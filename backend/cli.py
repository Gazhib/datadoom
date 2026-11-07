"""Run/resume an imported group with the same service used by the public API."""

import argparse
import json
import logging
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from time import monotonic, sleep
from typing import Any

import httpx

from .config import Settings
from .database import Database
from .errors import APIError
from .export import build_results, check_document, write_results
from .models import ImportRequest
from .service import Service
from .upstream import Upstream, validate_service_url


@dataclass
class RunReport:
    group_id: str
    checklist_version_id: str
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    elapsed_seconds: float = 0
    p95_seconds: float | None = None
    evaluations_per_second: float = 0
    retries: int = 0


def run_group(
    service: Service,
    group_id: str,
    version_id: str,
    emit: Callable[[dict[str, object]], None],
    *,
    limit: int | None = None,
    only: set[str] | None = None,
) -> RunReport:
    service.get_checklist(version_id)
    conversations = service.list_conversations(group_id)
    if only is not None:
        conversations = [c for c in conversations if c.conversation_id in only]
    if limit is not None:
        conversations = conversations[:limit]
    report = RunReport(group_id, version_id, total=len(conversations))
    started = monotonic()
    latencies: list[float] = []
    for conversation in conversations:
        if service.has_live_run(conversation.key, version_id):
            report.skipped += 1
            continue
        attempt_started = monotonic()
        try:
            evaluation = service.evaluate(conversation.key, version_id)
            if evaluation.mode != "live":
                raise APIError(
                    502, "unexpected_fixture", "Control runs require live evaluator output."
                )
        except APIError as exc:
            report.failed += 1
            emit({"event": "failure", "conversation_key": conversation.key, "code": exc.code})
        else:
            report.succeeded += 1
            latencies.append(monotonic() - attempt_started)
            emit(
                {
                    "event": "success",
                    "conversation_key": conversation.key,
                    "evaluation_id": evaluation.id,
                }
            )
    report.elapsed_seconds = round(monotonic() - started, 3)
    if latencies:
        report.p95_seconds = round(sorted(latencies)[math.ceil(len(latencies) * 0.95) - 1], 3)
        report.evaluations_per_second = round(
            report.succeeded / max(monotonic() - started, 0.001), 3
        )
    emit({"event": "summary", **asdict(report)})
    return report


def api_request(client: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
    try:
        response = client.request(method, path, **kwargs)
        if not response.is_success:
            raise APIError(
                response.status_code, "api_failure", "Backend rejected the control request."
            )
        return response.json()
    except httpx.TimeoutException:
        raise APIError(504, "upstream_timeout", "Backend request timed out.") from None
    except httpx.RequestError:
        raise APIError(503, "api_unavailable", "Cannot reach the backend API.") from None
    except ValueError:
        raise APIError(502, "invalid_upstream_response", "Backend returned invalid JSON.") from None


def run_group_api(
    client: httpx.Client,
    group_id: str,
    version_id: str,
    emit: Callable[[dict[str, object]], None],
    *,
    limit: int | None = None,
    only: set[str] | None = None,
    poll_seconds: float = 2,
) -> RunReport:
    conversations = api_request(client, "GET", "/api/conversations", params={"group_id": group_id})[
        "items"
    ]
    if only is not None:
        conversations = [c for c in conversations if c["conversation_id"] in only]
    if limit is not None:
        conversations = conversations[:limit]
    report = RunReport(group_id, version_id, total=len(conversations))
    started = monotonic()
    if only is None and limit is None:
        jobs = api_request(
            client,
            "POST",
            "/api/evaluation-jobs/batch",
            json={
                "group_id": group_id,
                "checklist_version_id": version_id,
                "skip_existing": True,
            },
        )["items"]
    else:
        jobs = []
        for conversation in conversations:
            runs = api_request(
                client, "GET", "/api/evaluations", params={"conversation_key": conversation["key"]}
            )["items"]
            if any(
                r["mode"] == "live" and r["checklist"]["version_id"] == version_id for r in runs
            ):
                continue
            active = api_request(
                client,
                "GET",
                "/api/evaluation-jobs",
                params={
                    "conversation_key": conversation["key"],
                    "active": "true",
                },
            )["items"]
            job = next(
                (j for j in reversed(active) if j["checklist_version_id"] == version_id), None
            )
            jobs.append(
                job
                or api_request(
                    client,
                    "POST",
                    "/api/evaluation-jobs",
                    json={
                        "conversation_key": conversation["key"],
                        "checklist_version_id": version_id,
                    },
                )
            )
    report.skipped = report.total - len(jobs)
    pending = {j["id"]: j for j in jobs}
    latencies = []
    while pending:
        for job_id in list(pending):
            job = api_request(client, "GET", f"/api/evaluation-jobs/{job_id}")
            if job["status"] in {"queued", "running"}:
                continue
            del pending[job_id]
            if job["status"] == "succeeded":
                evaluation = api_request(client, "GET", f"/api/evaluations/{job['evaluation_id']}")
                if evaluation["mode"] == "live":
                    report.succeeded += 1
                    if job["started_at"] and job["finished_at"]:
                        latencies.append(
                            (
                                datetime.fromisoformat(job["finished_at"])
                                - datetime.fromisoformat(job["started_at"])
                            ).total_seconds()
                        )
                    emit(
                        {
                            "event": "success",
                            "conversation_key": job["conversation_key"],
                            "evaluation_id": job["evaluation_id"],
                        }
                    )
                    continue
                code = "unexpected_fixture"
            else:
                code = (job.get("error") or {}).get("code", "cancelled")
            report.failed += 1
            emit({"event": "failure", "conversation_key": job["conversation_key"], "code": code})
        emit(
            {
                "event": "progress",
                "pending": len(pending),
                "succeeded": report.succeeded,
                "failed": report.failed,
                "skipped": report.skipped,
            }
        )
        if pending:
            sleep(poll_seconds)
    report.elapsed_seconds = round(monotonic() - started, 3)
    if latencies:
        report.p95_seconds = round(sorted(latencies)[math.ceil(len(latencies) * 0.95) - 1], 3)
    report.evaluations_per_second = round(report.succeeded / max(monotonic() - started, 0.001), 3)
    emit({"event": "summary", **asdict(report)})
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--checklist-version-id", required=True)
    parser.add_argument("--via-api")
    parser.add_argument("--export", type=Path)
    parser.add_argument("--team-name")
    parser.add_argument("--expect-count", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only", help="Comma-separated organizer conversation IDs")
    parser.add_argument(
        "--import-organizer", action="store_true", help="Import the group before running"
    )
    args = parser.parse_args()
    if not args.group_id.strip() or not args.checklist_version_id.strip():
        parser.error("Group and version must be nonblank")
    if args.limit is not None and args.limit < 1:
        parser.error("Limit must be positive")
    if args.expect_count is not None and args.expect_count < 0:
        parser.error("Expected count must be nonnegative")
    only = {s.strip() for s in args.only.split(",") if s.strip()} if args.only is not None else None
    if only == set():
        parser.error("Only must include at least one conversation ID")

    def emit(event: dict[str, object]) -> None:
        print(json.dumps(event, ensure_ascii=False), flush=True)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    try:
        # Control processing never opts into fixtures, even if the API does.
        config = replace(Settings.from_env(), allow_fixture=False)
        team = args.team_name or config.results_team_name
        if args.export and not team:
            parser.error("Export requires --team-name or RESULTS_TEAM_NAME")
        if args.via_api:
            validate_service_url(args.via_api, "Backend")
            with httpx.Client(
                base_url=args.via_api.rstrip("/"), trust_env=False, timeout=config.evaluator_timeout
            ) as client:
                if args.import_organizer:
                    imported = api_request(
                        client,
                        "POST",
                        "/api/imports",
                        json={"source": "organizer", "group_id": args.group_id},
                    )
                    emit({"event": "import", **imported})
                report = run_group_api(
                    client,
                    args.group_id,
                    args.checklist_version_id,
                    emit,
                    limit=args.limit,
                    only=only,
                )
                if args.export:
                    body = api_request(
                        client,
                        "GET",
                        "/api/exports/results",
                        params={
                            "group_id": args.group_id,
                            "checklist_version_id": args.checklist_version_id,
                            "team_name": team,
                        },
                    )
                    emit(
                        write_results(
                            check_document(body, args.expect_count), args.export, args.expect_count
                        )
                    )
                    return 0
            return 1 if report.failed else 0
        database = Database(config.database_path)
        database.initialize()
        with httpx.Client(trust_env=False) as client:
            service = Service(database, Upstream(config, client))
            if args.import_organizer:
                result = service.import_records(
                    ImportRequest(source="organizer", group_id=args.group_id)
                )
                emit({"event": "import", **result.model_dump()})
            report = run_group(
                service, args.group_id, args.checklist_version_id, emit, limit=args.limit, only=only
            )
            if args.export:
                document = build_results(
                    database,
                    args.group_id,
                    args.checklist_version_id,
                    team or "",
                    expect_count=args.expect_count,
                )
                emit(write_results(document, args.export, args.expect_count))
                return 0
    except APIError as exc:
        emit({"event": "error", "code": exc.code, "message": exc.message})
        return 1
    except (ValueError, OSError):
        emit(
            {
                "event": "error",
                "code": "configuration_unavailable",
                "message": "Check local configuration and database access.",
            }
        )
        return 1
    return 1 if report.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
