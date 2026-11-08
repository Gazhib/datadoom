"""Accuracy, error direction and chance-corrected agreement for the synthetic harness.

Employee scoring needs more than accuracy: a harsh grade is a false accusation against the
operator, a lenient one is a missed failure, and raw agreement overstates reliability when one
value dominates. Kappa and alpha correct for chance agreement.
"""

import math
from collections import Counter
from collections.abc import Hashable, Iterable, Sequence
from dataclasses import dataclass, field
from statistics import mean, median

from ai.contracts import Criterion, Grade, GradeValue
from ai.judge import Usage


def severity(criterion: Criterion, value: GradeValue) -> int:
    """How strongly a non-N/A value counts against the operator."""
    if criterion.kind == "scale":
        return criterion.scale[-1] - value
    return int(value == ("yes" if criterion.kind == "flag" else "no"))


def error_kind(criterion: Criterion, expected: GradeValue, observed: GradeValue | None) -> str | None:
    """Classify a mismatch. On a scale, any lower score is harsher and any higher one more lenient."""
    if observed == expected:
        return None
    if observed is None:
        return "no_verdict"
    if "na" in (expected, observed):
        return "applicability"
    if severity(criterion, observed) > severity(criterion, expected):
        return "false_accusation"
    return "missed_failure"


def cohen_kappa(pairs: Sequence[tuple[Hashable, Hashable]]) -> float | None:
    """Agreement with the labels beyond chance. None when chance agreement is certain: every label
    and vote share one value, so even perfect agreement says nothing beyond chance."""
    if not pairs:
        return None
    count = len(pairs)
    observed = sum(left == right for left, right in pairs) / count
    labels = Counter(left for left, _ in pairs)
    votes = Counter(right for _, right in pairs)
    chance = sum(labels[value] * votes[value] for value in labels) / count**2
    return None if chance == 1 else (observed - chance) / (1 - chance)


def krippendorff_alpha(units: Iterable[Sequence[Hashable]]) -> float | None:
    """Nominal Krippendorff's alpha between judges. Units may have different numbers of votes."""
    coincidences: Counter = Counter()
    for values in units:
        if len(values) < 2:
            continue
        weight = 1 / (len(values) - 1)
        for i, left in enumerate(values):
            for j, right in enumerate(values):
                if i != j:
                    coincidences[left, right] += weight
    totals: Counter = Counter()
    for (value, _), weight in coincidences.items():
        totals[value] += weight
    pairable = sum(totals.values())
    if pairable <= 1:
        return None
    disagreement = sum(weight for (left, right), weight in coincidences.items() if left != right) / pairable
    expected = (pairable**2 - sum(total**2 for total in totals.values())) / (pairable * (pairable - 1))
    return None if expected == 0 else 1 - disagreement / expected


@dataclass
class Accuracy:
    labels: int = 0
    correct_value: int = 0
    correct_evidence: int = 0
    correct: int = 0
    errors: Counter = field(default_factory=Counter)
    pairs: list[tuple[GradeValue, GradeValue | None]] = field(default_factory=list)

    def add(self, criterion: Criterion, expected: GradeValue, anchors: Sequence[str], observed: Grade | None) -> bool:
        vote = observed.value if observed is not None else None
        value = vote == expected
        evidence = observed is not None and bool(set(anchors).intersection(observed.evidence_turn_ids))
        self.labels += 1
        self.correct_value += value
        self.correct_evidence += evidence
        self.correct += value and evidence
        self.pairs.append((expected, vote))
        if kind := error_kind(criterion, expected, vote):
            self.errors[kind] += 1
        return value and evidence

    def report(self) -> dict:
        return {
            "labels": self.labels, "correct": self.correct, "accuracy": self.correct / self.labels,
            "value_accuracy": self.correct_value / self.labels,
            "evidence_accuracy": self.correct_evidence / self.labels,
            # A missing verdict counts as disagreement, as it does for accuracy.
            "kappa": cohen_kappa(self.pairs),
            "false_accusations": self.errors["false_accusation"],
            "missed_failures": self.errors["missed_failure"],
            "applicability_errors": self.errors["applicability"],
            "no_verdicts": self.errors["no_verdict"],
        }


def latency(values: list[float]) -> dict:
    if not values:
        return {"p50_seconds": None, "p95_seconds": None}
    return {"p50_seconds": round(median(values), 3),
            "p95_seconds": round(sorted(values)[math.ceil(len(values) * .95) - 1], 3)}


def tokens(rows: list[Usage]) -> dict:
    """Mean tokens per successful judge evaluation, repairs included. None marks an unreported count."""
    if not rows:
        return {"evaluations": 0}
    report: dict = {"evaluations": len(rows)}
    for name in ("prompt_tokens", "completion_tokens", "thinking_tokens"):
        values = [getattr(row, name) for row in rows]
        report[name] = None if None in values else round(mean(values), 1)
    billed = report["prompt_tokens"], report["completion_tokens"]
    report["per_1000_evaluations"] = (
        None if None in billed else round(1000 * (sum(billed) + (report["thinking_tokens"] or 0)))
    )
    return report
