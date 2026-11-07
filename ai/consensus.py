"""Deterministic grading consensus. Ballots must be in configured judge order."""

from collections import Counter
from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from typing import TypeVar

from .contracts import Criterion, Grade, GradeValue, ProviderName


Vote = TypeVar("Vote", bound=Hashable)


@dataclass(frozen=True)
class Ballot:
    judge: str
    provider: ProviderName
    model: str
    grades: dict[str, Grade]


@dataclass(frozen=True)
class Decision:
    grade: Grade
    votes: dict[str, GradeValue]
    agreement: float


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


def guaranteed_value(values: Sequence[GradeValue], remaining: int) -> bool:
    """A strict majority stays decisive even if all remaining judges vote differently.

    This covers yes/no/N/A plurality, the N/A applicability vote, and both middle
    positions of a numeric scale. It deliberately keeps running on weaker bounds.
    """
    counts = Counter(values)
    return max(counts.values(), default=0) * 2 > len(values) + remaining
