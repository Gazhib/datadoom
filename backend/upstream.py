import json
from typing import Any
from urllib.parse import quote, unquote_plus, urlsplit, urlunsplit

import httpx
from pydantic import TypeAdapter, ValidationError

from .config import Settings
from .errors import APIError
from .models import Checklist, Conversation, EvaluatorResult, RawRecord


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
    ) -> Any:
        try:
            with self.client.stream(
                method,
                url,
                json=payload,
                timeout=self.settings.upstream_timeout,
                follow_redirects=False,
            ) as response:
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
        body = self.request_json("GET", organizer_url(self.settings.organizer_get_url, group_id))
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

    def evaluate(self, conversation: Conversation, checklist: Checklist) -> EvaluatorResult:
        url = self.settings.evaluator_url
        validate_service_url(url, "Evaluator")
        body = self.request_json(
            "POST",
            url.rstrip("/") + "/evaluate",
            payload={
                "conversation": conversation.model_dump(),
                "checklist": checklist.model_dump(),
            },
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
