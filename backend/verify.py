"""Check organizer access and source shape without saving or printing official data."""

import argparse
import json
import logging
import re
from collections import Counter
from datetime import datetime
from time import monotonic
from typing import Any

import httpx

from .config import Settings
from .errors import APIError
from .models import RawRecord
from .upstream import Upstream

DEV_CHANNELS = {"agent chat": 60, "voice call": 5}
DEV_LANGUAGES = {"RU": 35, "KZ": 15, "EN": 15}


def timestamp_format(value: str) -> str:
    if re.fullmatch(r"\d+:\d{2}(?::\d{2})?(?:\.\d+)?", value):
        return "relative"
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return "other"
    return "iso8601"


def summarize_records(group_id: str, records: list[RawRecord]) -> dict[str, Any]:
    """Only operational aggregates leave this function; no source text, IDs or links."""
    channels = Counter(record.channel for record in records)
    languages = Counter(record.language for record in records)
    speakers: Counter[str] = Counter()
    timestamps: Counter[str] = Counter()
    calls_with_audio = calls_without_audio = 0
    unique_ids = {record.conversation_id for record in records}
    for record in records:
        speakers.update(turn.speaker for turn in record.transcript)
        timestamps.update(timestamp_format(turn.timestamp) for turn in record.transcript)
        if record.channel == "voice call":
            if record.audio_url:
                calls_with_audio += 1
            else:
                calls_without_audio += 1
    report: dict[str, Any] = {
        "event": "organizer_verification",
        "group_id": group_id,
        "records": len(records),
        "unique_conversations": len(unique_ids),
        "channels": dict(channels),
        "languages": dict(languages),
        "turns": sum(speakers.values()),
        "speakers": dict(speakers),
        "timestamp_formats": dict(timestamps),
        "calls_with_audio": calls_with_audio,
        "calls_without_audio": calls_without_audio,
        "recording_access_checked": False,
        "dev_counts_match": None,
        "passed": len(unique_ids) == len(records) and calls_without_audio == 0,
    }
    if group_id == "DEV":
        matches = channels == DEV_CHANNELS and languages == DEV_LANGUAGES
        report.update(
            expected_channels=DEV_CHANNELS,
            expected_languages=DEV_LANGUAGES,
            dev_counts_match=matches,
            passed=report["passed"] and matches,
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group-id", default="DEV")
    args = parser.parse_args()
    if not args.group_id.strip():
        parser.error("Group must be nonblank")

    # HTTPX INFO and HTTPCore DEBUG logs can expose signed query parameters.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    started = monotonic()
    try:
        config = Settings.from_env()
        with httpx.Client(trust_env=False) as client:
            records = Upstream(config, client).organizer_records(args.group_id)
        report = summarize_records(args.group_id, records)
        report["elapsed_seconds"] = round(monotonic() - started, 3)
    except APIError as exc:
        report = {"event": "error", "code": exc.code, "message": exc.message}
    except (ValueError, OSError):
        report = {
            "event": "error",
            "code": "configuration_unavailable",
            "message": "Check local organizer configuration.",
        }
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
