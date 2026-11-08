import json
from collections.abc import Callable
from threading import Lock
from typing import Any
from urllib.parse import quote, unquote_plus, urlsplit, urlunsplit

import httpx
from pydantic import TypeAdapter, ValidationError

from .concurrency import evaluation_slots
from .config import Settings
from .errors import APIError
from .models import Checklist, Conversation, EvaluatorResult, JudgeProgress, RawRecord, ReasonLocale
from .scoring import validate_grades

_stream_lock = Lock()
_stream_unavailable: set[str] = set()


def validate_service_url(url: str, service: str) -> None:
    try:
        parts = urlsplit(url)
        valid = (
            parts.scheme in {"http", "https"}
            and bool(parts.hostname)
            and parts.port != 0
            and bool(httpx.URL(url).host)
        )
    except (ValueError, httpx.InvalidURL):
        valid = False
    if not valid:
        raise APIError(
            503, "configuration_unavailable", f"{service} URL is not configured correctly."
        )


def organizer_url(configured: str, group_id: str) -> str:
    validate_service_url(configured, "Organizer")
    parts = urlsplit(configured)
    # Do not parse and re-encode the signed parameters: even %20 vs + may matter.
    segments = parts.query.split("&") if parts.query else []
    replacement = "group_id=" + quote(group_id, safe="")
    found = False
    for index, segment in enumerate(segments):
        if unquote_plus(segment.partition("=")[0]) == "group_id":
            segments[index] = replacement
            found = True
    if not found:
        segments.append(replacement)
    return urlunsplit(parts._replace(query="&".join(segments)))


class Upstream:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self.settings = settings
        self.client = client

    def request_json(
        self,
        method: str,
        url: str,
        *,
        payload: dict[str, Any] | None = None,
        max_bytes: int = 25_000_000,
        timeout: float | None = None,
    ) -> Any:
        try:
            with self.client.stream(
                method,
                url,
                json=payload,
                timeout=self.settings.upstream_timeout if timeout is None else timeout,
                follow_redirects=False,
            ) as response:
                if response.status_code == 504:
                    raise APIError(
                        504, "upstream_timeout", "The upstream service timed out. Please retry."
                    )
                if response.status_code != 200:
                    raise APIError(
                        502, "upstream_failure", "The upstream service rejected the request."
                    )
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise APIError(
                            502, "invalid_upstream_response", "Upstream response is too large."
                        )
            return json.loads(body)
        except httpx.TimeoutException:
            raise APIError(
                504, "upstream_timeout", "The upstream service timed out. Please retry."
            ) from None
        except httpx.RequestError:
            raise APIError(
                502, "upstream_unavailable", "Cannot reach the upstream service. Please retry."
            ) from None
        except (ValueError, UnicodeError):
            raise APIError(
                502, "invalid_upstream_response", "Upstream returned invalid JSON."
            ) from None

    def organizer_records(self, group_id: str) -> list[RawRecord]:
        if not self.settings.organizer_get_url:
            raise APIError(503, "configuration_unavailable", "Organizer import is not configured.")
        upstream_group = self.settings.organizer_groups.get(group_id, group_id)
        body = self.request_json(
            "GET", organizer_url(self.settings.organizer_get_url, upstream_group)
        )
        if not isinstance(body, dict) or body.get("isSuccess") is not True:
            raise APIError(
                502, "invalid_upstream_response", "Organizer returned an unsuccessful response."
            )
        try:
            return TypeAdapter(list[RawRecord]).validate_python(body["data"]["records"])
        except (KeyError, TypeError, ValidationError):
            raise APIError(
                502,
                "invalid_upstream_response",
                "Organizer records do not match the import format.",
            ) from None

    def judges(self) -> dict[str, Any]:
        try:
            validate_service_url(self.settings.evaluator_url, "Evaluator")
            body = self.request_json(
                "GET",
                self.settings.evaluator_url.rstrip("/") + "/judges",
                timeout=3,
                max_bytes=100_000,
            )
            if not isinstance(body, dict) or not isinstance(body.get("judges"), list):
                raise ValueError
            return body
        except (APIError, ValueError):
            raise APIError(
                503, "evaluator_unavailable", "Evaluator status is unavailable."
            ) from None

    def evaluate(
        self,
        conversation: Conversation,
        checklist: Checklist,
        *,
        progress: Callable[[dict[str, Any]], None] | None = None,
        reason_locale: ReasonLocale | None = None,
    ) -> EvaluatorResult:
        url = self.settings.evaluator_url
        validate_service_url(url, "Evaluator")
        payload: dict[str, Any] = {
            "conversation": conversation.model_dump(), "checklist": checklist.model_dump()
        }
        if reason_locale is not None:
            payload["reason_locale"] = reason_locale
        # Only remote evaluation consumes a slot. No database transaction is open here.
        with evaluation_slots(self.settings.evaluation_concurrency):
            with _stream_lock:
                stream = self.settings.evaluator_stream and url not in _stream_unavailable
            body = self._stream(url, conversation, checklist, payload, progress) if stream else None
            if body is None:
                body = self.request_json(
                    "POST",
                    url.rstrip("/") + "/evaluate",
                    payload=payload,
                    timeout=self.settings.evaluator_timeout,
                    max_bytes=2_000_000,
                )
        try:
            result = EvaluatorResult.model_validate(body)
        except ValidationError:
            raise APIError(
                502, "invalid_evaluator_response", "Evaluator returned an invalid result."
            ) from None
        if result.mode == "fixture" and not self.settings.allow_fixture:
            raise APIError(
                502, "unexpected_fixture", "Synthetic results are disabled for this backend."
            )
        if result.mode == "live" and result.model.provider.lower() == "fixture":
            raise APIError(
                502, "invalid_evaluator_response", "Synthetic output cannot be labeled live."
            )
        return result

    def _stream(
        self,
        url: str,
        conversation: Conversation,
        checklist: Checklist,
        payload: dict[str, Any],
        progress: Callable[[dict[str, Any]], None] | None,
    ) -> Any:
        def invalid() -> APIError:
            return APIError(502, "invalid_evaluator_response", "Invalid evaluator stream.")

        final: dict[str, Any] | None = None
        started = False
        judges: set[str] = set()
        try:
            with self.client.stream(
                "POST",
                url.rstrip("/") + "/evaluate/stream",
                json=payload,
                timeout=self.settings.evaluator_timeout,
                follow_redirects=False,
            ) as response:
                if response.status_code in {404, 405}:
                    with _stream_lock:
                        _stream_unavailable.add(url)
                    return None
                if response.status_code == 504:
                    raise APIError(504, "upstream_timeout", "The evaluator timed out.")
                if response.status_code != 200:
                    raise APIError(502, "upstream_failure", "The evaluator rejected the request.")
                if "application/x-ndjson" not in response.headers.get("content-type", ""):
                    raise invalid()
                buffer = bytearray()
                total = 0

                def consume(line: bytes) -> None:
                    nonlocal final, started
                    if len(line) > 2_000_000 or not line.strip():
                        raise invalid()
                    event = json.loads(line)
                    if not isinstance(event, dict) or final is not None:
                        raise invalid()
                    kind = event.get("event")
                    if not started:
                        if kind != "started" or not isinstance(event.get("judges"), list):
                            raise invalid()
                        if not all(isinstance(n, str) and n.strip() for n in event["judges"]):
                            raise invalid()
                        judges.update(event["judges"])
                        if len(judges) != len(event["judges"]):
                            raise invalid()
                        started = True
                    elif kind in {"result", "error"}:
                        final = event
                        return
                    elif kind not in {"judge_started", "judge_finished"}:
                        raise invalid()
                    else:
                        name = event.get("judge")
                        if not isinstance(name, str) or name not in judges:
                            raise invalid()
                        status = "running" if kind == "judge_started" else event.get("status")
                        if kind == "judge_finished" and status not in {"ok", "failed", "skipped"}:
                            raise invalid()
                        update = JudgeProgress.model_validate(
                            {
                                "name": name,
                                "status": status,
                                "seconds": event.get("seconds"),
                                "error_code": event.get("error_code"),
                                "grades": event.get("grades"),
                            }
                        )
                        if update.grades is not None:
                            if update.status != "ok":
                                raise invalid()
                            validate_grades(update.grades, checklist, conversation)
                    if progress:
                        progress(event)

                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > 2_000_000:
                        raise invalid()
                    buffer.extend(chunk)
                    while b"\n" in buffer:
                        line, _, remaining = buffer.partition(b"\n")
                        buffer = bytearray(remaining)
                        consume(bytes(line))
                    if len(buffer) > 2_000_000:
                        raise invalid()
                if buffer:
                    consume(bytes(buffer))
            if final is None:
                raise invalid()
            if final["event"] == "error":
                error = final.get("error")
                status = final.get("status")
                if (
                    type(status) is not int
                    or not 400 <= status <= 599
                    or not isinstance(error, dict)
                    or not isinstance(error.get("code"), str)
                    or not error["code"].strip()
                    or not isinstance(error.get("message"), str)
                    or not error["message"].strip()
                ):
                    raise invalid()
                raise APIError(status, error["code"], "The evaluator could not complete the run.")
            if not isinstance(final.get("result"), dict):
                raise invalid()
            return final["result"]
        except httpx.TimeoutException:
            raise APIError(504, "upstream_timeout", "The evaluator timed out.") from None
        except httpx.RequestError:
            raise APIError(502, "upstream_unavailable", "Cannot reach the evaluator.") from None
        except (ValueError, UnicodeError, KeyError, TypeError):
            raise invalid() from None
