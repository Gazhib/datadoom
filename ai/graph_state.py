"""State passed between the panel and its judge subgraph."""

from operator import add
from typing import Annotated, NotRequired, TypedDict

import httpx

from .config import JudgesConfig
from .contracts import EvaluationRequest, EvaluationResult
from .errors import EvaluationError
from .judge import Attempt, Usage, Verdict
from .panel import JudgeOutcome, Observe, PanelRun
from .providers import Completion, Provider
from .scheduler import Route, Seat


class JudgeState(TypedDict):
    client: httpx.AsyncClient
    provider: Provider
    data: EvaluationRequest
    name: str
    attempt: NotRequired[Attempt]
    completion: NotRequired[Completion]
    usage: NotRequired[Usage]
    problem: NotRequired[ValueError | None]
    error: NotRequired[EvaluationError]
    verdict: NotRequired[Verdict]


class JudgeBranch(TypedDict):
    data: EvaluationRequest
    run: PanelRun
    route: Route


class PanelState(TypedDict):
    data: EvaluationRequest
    client: httpx.AsyncClient
    emit_panel: bool
    observe: NotRequired[Observe]
    config: NotRequired[JudgesConfig]
    seats: NotRequired[list[Seat]]
    run: NotRequired[PanelRun]
    outcomes: Annotated[list[JudgeOutcome], add]
    result: NotRequired[EvaluationResult]
