"""Run/resume an imported group with the same service used by the public API."""

import argparse
import json
import logging
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from time import monotonic

import httpx

from .config import Settings
from .database import Database
from .errors import APIError
from .models import ImportRequest
from .service import Service
from .upstream import Upstream


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
) -> RunReport:
    service.get_checklist(version_id)
    conversations = service.list_conversations(group_id)
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--checklist-version-id", required=True)
    parser.add_argument(
        "--import-organizer", action="store_true", help="Import the group before running"
    )
    args = parser.parse_args()
    if not args.group_id.strip() or not args.checklist_version_id.strip():
        parser.error("Group and version must be nonblank")

    def emit(event: dict[str, object]) -> None:
        print(json.dumps(event, ensure_ascii=False), flush=True)

    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        # Control processing never opts into fixtures, even if the API does.
        config = replace(Settings.from_env(), allow_fixture=False)
        database = Database(config.database_path)
        database.initialize()
        with httpx.Client(trust_env=False) as client:
            service = Service(database, Upstream(config, client))
            if args.import_organizer:
                result = service.import_records(
                    ImportRequest(source="organizer", group_id=args.group_id)
                )
                emit({"event": "import", **result.model_dump()})
            report = run_group(service, args.group_id, args.checklist_version_id, emit)
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
