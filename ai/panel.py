"""Run the configured judges in parallel and combine their grades per criterion."""

import asyncio
import json
import logging
from collections import Counter
from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from time import perf_counter
from typing import TypeVar

import httpx

from .config import JudgesConfig
from .contracts import Criterion, EvaluationRequest, EvaluationResult, Grade, GradeValue, Model, ProviderName
from .errors import EvaluationError
from .judge import grade
from .providers import Provider, build_provider


logger = logging.getLogger("uvicorn.error")
Vote = TypeVar("Vote", bound=Hashable)


@dataclass(frozen=True)
class Seat:
    name: str
    provider: Provider


@dataclass(frozen=True)
class Ballot:
    judge: str
    provider: ProviderName
    model: str
    grades: dict[str, Grade]


@dataclass(frozen=True)
class Failure:
    judge: str
    error: EvaluationError


@dataclass(frozen=True)
class Decision:
    grade: Grade
    votes: dict[str, GradeValue]
    agreement: float


def configured_seats(config: JudgesConfig) -> list[Seat]:
    seats = []
    for judge in config.judges:
        try:
            seats.append(Seat(judge.name, build_provider(judge)))
        except ValueError as error:
            raise ValueError(f"Judge {judge.name}: {error}") from None
    return seats


def plurality(values: Sequence[Vote]) -> Vote:
    """The most common value. Ties go to the value whose first vote came from the earliest judge."""
    counts = Counter(values)
    top = max(counts.values())
    return next(value for value in values if counts[value] == top)


def consensus(criterion: Criterion, values: Sequence[GradeValue]) -> GradeValue:
    if criterion.kind != "scale":
        return plurality(values)
    if plurality(["na" if value == "na" else "graded" for value in values]) == "na":
        return "na"
    # The lower median is always a submitted step and never credits more than half the judges gave.
    numeric = sorted(value for value in values if value != "na")
    return numeric[(len(numeric) - 1) // 2]


def rank_evidence(votes: Sequence[Grade]) -> list[str]:
    """Turns cited by more agreeing judges first, then in judge order."""
    support = Counter(turn for vote in votes for turn in set(vote.evidence_turn_ids))
    ordered = dict.fromkeys(turn for vote in votes for turn in vote.evidence_turn_ids)
    return sorted(ordered, key=lambda turn: -support[turn])


def decide(criterion: Criterion, ballots: Sequence[Ballot]) -> Decision:
    votes = [ballot.grades[criterion.id] for ballot in ballots]
    value = consensus(criterion, [vote.value for vote in votes])
    agreeing = [vote for vote in votes if vote.value == value]
    combined = Grade(
        criterion_id=criterion.id,
        value=value,
        reason=agreeing[0].reason,
        evidence_turn_ids=rank_evidence(agreeing),
    )
    return Decision(
        grade=combined,
        votes={ballot.judge: vote.value for ballot, vote in zip(ballots, votes, strict=True)},
        agreement=len(agreeing) / len(votes),
    )


def collect(seats: Sequence[Seat], tasks: Sequence[asyncio.Task]) -> tuple[list[Ballot], list[Failure]]:
    ballots, failures = [], []
    for seat, task in zip(seats, tasks, strict=True):
        if task.cancelled():
            failures.append(Failure(seat.name, EvaluationError(504, "provider_timeout", "Model inference timed out.")))
            continue
        error = task.exception()
        if error is None:
            verdict = task.result()
            grades = {item.criterion_id: item for item in verdict.grades}
            ballots.append(Ballot(seat.name, seat.provider.name, verdict.model, grades))
        elif isinstance(error, EvaluationError):
            failures.append(Failure(seat.name, error))
        else:
            raise error
    return ballots, failures


def quorum_error(ballots: Sequence[Ballot], failures: Sequence[Failure], quorum: int) -> EvaluationError:
    # One shared failure keeps its own status, so a down server stays 503 and a slow one 504.
    kinds = {(failure.error.status, failure.error.code) for failure in failures}
    status, code = next(iter(kinds)) if len(kinds) == 1 else (502, "quorum_not_met")
    detail = ", ".join(f"{failure.judge}: {failure.error.code}" for failure in failures)
    total = len(ballots) + len(failures)
    return EvaluationError(
        status, code, f"{len(ballots)} of {total} judges returned valid grades; {quorum} required ({detail})."
    )


def log_panel(
    ballots: Sequence[Ballot], failures: Sequence[Failure], decisions: Sequence[Decision], started: float
) -> None:
    for failure in failures:
        logger.warning("judge=%s failed status=%d code=%s", failure.judge, failure.error.status, failure.error.code)
    split = [decision for decision in decisions if decision.agreement < 1]
    logger.info(
        "panel judges=%d/%d mean_agreement=%.2f split_criteria=%d duration_ms=%.0f",
        len(ballots),
        len(ballots) + len(failures),
        sum(decision.agreement for decision in decisions) / len(decisions),
        len(split),
        (perf_counter() - started) * 1000,
    )
    for decision in split:
        # JSON-encode submitted IDs so they cannot forge log lines.
        logger.info(
            "panel criterion=%s result=%s votes=%s",
            json.dumps(decision.grade.criterion_id),
            json.dumps(decision.grade.value),
            json.dumps(decision.votes),
        )


async def run_panel(
    client: httpx.AsyncClient, config: JudgesConfig, seats: Sequence[Seat], data: EvaluationRequest
) -> EvaluationResult:
    started = perf_counter()
    tasks = [asyncio.create_task(grade(client, seat.provider, data, seat.name)) for seat in seats]
    try:
        await asyncio.wait(tasks, timeout=config.panel.timeout_seconds)
    finally:
        unfinished = [task for task in tasks if not task.done()]
        for task in unfinished:
            task.cancel()
        await asyncio.gather(*unfinished, return_exceptions=True)

    ballots, failures = collect(seats, tasks)
    if len(ballots) < config.quorum:
        raise quorum_error(ballots, failures, config.quorum)
    decisions = [decide(criterion, ballots) for criterion in data.checklist.criteria]
    log_panel(ballots, failures, decisions, started)
    members = " + ".join(f"{ballot.provider}/{ballot.model}" for ballot in ballots)
    return EvaluationResult(model=Model(provider="panel", model=members), grades=[d.grade for d in decisions])
