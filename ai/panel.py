"""Shared scheduling and aggregation for the evaluator engines."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from time import monotonic

import httpx

from .config import JudgesConfig
from .consensus import Ballot, decide, guaranteed_value
from .contracts import EvaluationRequest, EvaluationResult, JudgeReport, JudgeStatus, Model, PanelReport, VoteReport
from .errors import EvaluationError
from .judge import Verdict, grade
from .providers import Provider
from .scheduler import MIN_START_SECONDS, Probe, Route, Seat, Slots, all_providers, probe_cache, resolve


logger = logging.getLogger("uvicorn.error")
Emit = Callable[[dict], None]
JudgeCall = Callable[[httpx.AsyncClient, Provider, EvaluationRequest, str], Awaitable[Verdict]]


@dataclass(frozen=True)
class JudgeOutcome:
    route: Route
    status: JudgeStatus
    seconds: float | None = None
    verdict: Verdict | None = None
    error: EvaluationError | None = None

    @property
    def name(self) -> str:
        return self.route.name

    @property
    def error_code(self) -> str | None:
        return self.error.code if self.error else None

    def report(self) -> JudgeReport:
        return JudgeReport(
            name=self.name, provider=self.route.provider.name,
            model=self.verdict.model if self.verdict else self.route.provider.model,
            host=self.route.provider.host, fallback=self.route.fallback, status=self.status,
            error_code=self.error_code, seconds=self.seconds,
        )


Observe = Callable[[JudgeOutcome], None]


@dataclass
class PanelRun:
    client: httpx.AsyncClient
    config: JudgesConfig
    routes: list[Route]
    slots: Slots
    started: float
    deadline: float
    observe: Observe | None = None
    finished: dict[str, JudgeOutcome] = field(default_factory=dict)

    def finish(self, outcome: JudgeOutcome, emit: Emit | None) -> JudgeOutcome:
        self.finished[outcome.name] = outcome
        if self.observe:
            self.observe(outcome)
        if emit:
            emit({"event": "judge_finished", "judge": outcome.name, "status": outcome.status,
                  "seconds": outcome.seconds, "error_code": outcome.error_code})
        return outcome


async def prepare_run(
    client: httpx.AsyncClient, config: JudgesConfig, seats: Sequence[Seat], *, observe: Observe | None = None,
) -> PanelRun:
    started = monotonic()
    deadline = asyncio.get_running_loop().time() + config.panel.timeout_seconds
    try:
        async with asyncio.timeout_at(deadline):
            probes = await probe_cache.many(client, all_providers(seats))
    except TimeoutError:
        # The shared deadline elapsed during preflight. All seats are now skipped.
        probes = dict.fromkeys(all_providers(seats), Probe(False, error="timeout"))
    routes = [resolve(seat, probes) for seat in seats]
    return PanelRun(client, config, routes, Slots(config.panel, routes), started, deadline, observe)


def timed_out() -> EvaluationError:
    return EvaluationError(504, "provider_timeout", "Model inference timed out.")


def can_skip(run: PanelRun, route: Route, data: EvaluationRequest) -> bool:
    if (not run.config.panel.early_exit or route.name not in run.slots.gates
            or not route.provider.local or route.provider.host not in run.slots.shared_hosts):
        return False
    valid = [item.verdict for item in run.finished.values() if item.verdict is not None]
    remaining = len(run.routes) - len(run.finished)
    return len(valid) >= run.config.quorum and all(
        guaranteed_value([ballot.grades[index].value for ballot in valid], remaining)
        for index in range(len(data.checklist.criteria))
    )


async def run_judge(
    run: PanelRun, route: Route, data: EvaluationRequest, *, call: JudgeCall = grade, emit: Emit | None = None
) -> JudgeOutcome:
    loop = asyncio.get_running_loop()
    cutoff = run.deadline - MIN_START_SECONDS
    if loop.time() >= cutoff:
        return run.finish(JudgeOutcome(route, "skipped", error=timed_out()), emit)
    if not route.probe.reachable:
        error = EvaluationError(503, "provider_unavailable", "The selected model server is unavailable.")
        return run.finish(JudgeOutcome(route, "failed", error=error), emit)

    try:
        async with run.slots.acquire(route.name, cutoff):
            now = loop.time()
            if now >= cutoff:
                return run.finish(JudgeOutcome(route, "skipped", error=timed_out()), emit)
            if can_skip(run, route, data):
                return run.finish(JudgeOutcome(route, "skipped"), emit)
            expires = min(run.deadline, now + run.config.panel.judge_timeout_seconds)
            if emit:
                emit({"event": "judge_started", "judge": route.name})
            try:
                async with asyncio.timeout_at(expires):
                    verdict = await call(run.client, route.provider, data, route.name)
                outcome = JudgeOutcome(route, "ok", round(loop.time() - now, 3), verdict)
            except TimeoutError:
                outcome = JudgeOutcome(route, "failed", round(loop.time() - now, 3), error=timed_out())
            except EvaluationError as error:
                outcome = JudgeOutcome(route, "failed", round(loop.time() - now, 3), error=error)
            return run.finish(outcome, emit)
    except TimeoutError:
        return run.finish(JudgeOutcome(route, "skipped", error=timed_out()), emit)


def aggregate(run: PanelRun, data: EvaluationRequest, outcomes: Sequence[JudgeOutcome], emit_panel: bool) -> EvaluationResult:
    by_name = {outcome.name: outcome for outcome in outcomes}
    ordered = [by_name[route.name] for route in run.routes]
    ballots = [
        Ballot(item.name, item.route.provider.name, item.verdict.model,
               {grade.criterion_id: grade for grade in item.verdict.grades})
        for item in ordered if item.verdict is not None
    ]
    failures = [item for item in ordered if item.error is not None]
    for item in failures:
        logger.warning("judge=%s host=%s status=%s code=%s", item.name, item.route.provider.host,
                       item.status, item.error_code)
    if len(ballots) < run.config.quorum:
        kinds = {(item.error.status, item.error.code) for item in failures}
        status, code = next(iter(kinds)) if len(kinds) == 1 else (502, "quorum_not_met")
        detail = ", ".join(f"{item.name}: {item.error_code}" for item in failures)
        raise EvaluationError(
            status, code, f"{len(ballots)} of {len(ordered)} judges returned valid grades; "
                          f"{run.config.quorum} required ({detail})."
        )

    decisions = [decide(criterion, ballots) for criterion in data.checklist.criteria]
    agreement = sum(decision.agreement for decision in decisions) / len(decisions)
    split = [decision for decision in decisions if decision.agreement < 1]
    logger.info(
        "panel judges=%d/%d mean_agreement=%.2f split_criteria=%d duration_ms=%.0f",
        len(ballots), len(ordered), agreement, len(split), (monotonic() - run.started) * 1000,
    )
    for decision in split:
        logger.info("panel criterion=%s result=%s votes=%s", json.dumps(decision.grade.criterion_id),
                    json.dumps(decision.grade.value), json.dumps(decision.votes))
    panel = PanelReport(
        quorum=run.config.quorum,
        agreement=agreement,
        judges=[item.report() for item in ordered],
        votes=[VoteReport(criterion_id=item.grade.criterion_id, value=item.grade.value,
                          agreement=item.agreement, ballots=item.votes) for item in decisions],
    ) if emit_panel else None
    members = " + ".join(f"{ballot.provider}/{ballot.model}" for ballot in ballots)
    return EvaluationResult(mode="live", model=Model(provider="panel", model=members),
                            grades=[d.grade for d in decisions], **({"panel": panel} if panel else {}))


async def run_panel(
    client: httpx.AsyncClient, config: JudgesConfig, seats: Sequence[Seat], data: EvaluationRequest,
    *, emit_panel: bool = False, observe: Observe | None = None,
) -> EvaluationResult:
    run = await prepare_run(client, config, seats, observe=observe)
    async with asyncio.TaskGroup() as group:
        tasks = [group.create_task(run_judge(run, route, data)) for route in run.routes]
    return aggregate(run, data, [task.result() for task in tasks], emit_panel)
