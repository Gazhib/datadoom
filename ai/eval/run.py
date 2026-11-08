"""Measure panel and judge grades against synthetic labels. Offline results are stubs."""

import argparse
import asyncio
import json
from collections import Counter, defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from time import perf_counter

import httpx

from ai.config import MAX_TIMEOUT_SECONDS, JudgesConfig, load_judges
from ai.contracts import ContractModel, EvaluationRequest, EvaluationResult, Grade, GradeValue
from ai.errors import EvaluationError
from ai.eval.metrics import Accuracy, error_kind, krippendorff_alpha, latency, tokens
from ai.graph import run_graph
from ai.judge import Usage
from ai.panel import JudgeOutcome, run_panel
from ai.scheduler import Seat, configured_seats


ROOT = Path(__file__).parent
Evaluator = Callable[..., Awaitable[EvaluationResult]]


class Label(ContractModel):
    value: GradeValue
    evidence_turn_ids: list[str]


class Case(ContractModel):
    request: EvaluationRequest
    expected: dict[str, Label]


def load_cases(names: list[str]) -> list[Case]:
    files = {path.stem: path for path in sorted((ROOT / "cases").glob("*.json"))}
    if not files:
        raise ValueError("No synthetic cases found.")
    if unknown := set(names).difference(files):
        raise ValueError("Unknown cases: " + ", ".join(sorted(unknown)))
    cases = []
    for name in dict.fromkeys(names or files):
        case = Case.model_validate_json(files[name].read_text(encoding="utf-8"))
        criteria = {row.id: row for row in case.request.checklist.criteria}
        turns = {turn.id for turn in case.request.conversation.turns}
        if not case.expected or case.request.conversation.key != name:
            raise ValueError(f"{name}: expected at least one label and a matching conversation key.")
        for criterion, label in case.expected.items():
            if (criterion not in criteria or not criteria[criterion].allows(label.value)
                    or not label.evidence_turn_ids or not turns.issuperset(label.evidence_turn_ids)):
                raise ValueError(f"{name}: invalid label or evidence for {criterion}.")
        cases.append(case)
    return cases


def by_key() -> defaultdict:
    return defaultdict(Accuracy)


@dataclass
class Breakdown:
    """Accuracy overall and per criterion, language and channel. Each language and channel needs its
    own acceptance check: an aggregate can hide a weak language or noisy voice transcripts."""
    total: Accuracy = field(default_factory=Accuracy)
    criteria: defaultdict = field(default_factory=by_key)
    languages: defaultdict = field(default_factory=by_key)
    channels: defaultdict = field(default_factory=by_key)

    def add(self, case: Case, grades: dict[str, Grade]) -> dict[str, bool]:
        conversation = case.request.conversation
        criteria = {row.id: row for row in case.request.checklist.criteria}
        passed = {}
        for name, label in case.expected.items():
            scopes = (self.total, self.criteria[name], self.languages[conversation.language],
                      self.channels[conversation.channel])
            for accuracy in scopes:
                passed[name] = accuracy.add(criteria[name], label.value, label.evidence_turn_ids, grades.get(name))
        return passed

    def report(self) -> dict:
        if not self.total.labels:
            return {"labels": 0}
        return {
            **self.total.report(),
            "by_criterion": {name: accuracy.report() for name, accuracy in self.criteria.items()},
            "by_language": {name: accuracy.report() for name, accuracy in self.languages.items()},
            "by_channel": {name: accuracy.report() for name, accuracy in self.channels.items()},
        }


@dataclass
class JudgeStats:
    accuracy: Breakdown = field(default_factory=Breakdown)
    seconds: list[float] = field(default_factory=list)
    statuses: Counter = field(default_factory=Counter)
    error_codes: Counter = field(default_factory=Counter)
    repaired: int = 0
    usage: list[Usage] = field(default_factory=list)

    def add(self, case: Case, seat: Seat, outcome: JudgeOutcome | None) -> dict:
        """Record one judge's outcome for a case and return its row for the case details."""
        verdict = outcome.verdict if outcome else None
        grades = {grade.criterion_id: grade for grade in verdict.grades} if verdict else {}
        self.statuses[outcome.status if outcome else "missing"] += 1
        if outcome and outcome.error_code:
            self.error_codes[outcome.error_code] += 1
        if outcome and outcome.seconds is not None:
            self.seconds.append(outcome.seconds)
        if verdict:
            self.usage.append(verdict.usage)
            self.repaired += verdict.attempts > 1
        # Skips are not model errors. Measure model quality only where a judge was tried.
        if outcome and outcome.status != "skipped":
            self.accuracy.add(case, grades)
        return {
            "status": outcome.status if outcome else "missing", "seconds": outcome.seconds if outcome else None,
            "model": verdict.model if verdict else outcome.route.provider.model if outcome else seat.provider.model,
            "error": outcome.error_code if outcome else None, "attempts": verdict.attempts if verdict else None,
            "grades": {criterion: {"value": grade.value, "evidence_turn_ids": grade.evidence_turn_ids}
                       for criterion, grade in grades.items() if criterion in case.expected},
        }

    def report(self) -> dict:
        valid = self.statuses["ok"]
        return {
            **self.accuracy.report(), **latency(self.seconds), "statuses": dict(self.statuses),
            "error_codes": dict(self.error_codes), "repair_rate": self.repaired / valid if valid else None,
            "tokens": tokens(self.usage),
        }


def ballot_units(case: Case, outcomes: list[JudgeOutcome]) -> list[list[GradeValue]]:
    """One unit per submitted criterion with every valid judge's vote. Verdicts keep checklist order."""
    verdicts = [outcome.verdict for outcome in outcomes if outcome.verdict is not None]
    return [[verdict.grades[index].value for verdict in verdicts]
            for index in range(len(case.request.checklist.criteria))]


def offline_panel() -> JudgesConfig:
    return JudgesConfig.model_validate({
        "judges": [{"name": f"stub-{i}", "model": f"stub-{i}", "provider": "ollama",
                    "url": f"http://stub-{i}:11434"} for i in range(1, 4)],
    })


def stub_evidence(case: Case) -> str:
    """The first turn that can carry operator credit, so stub votes pass the attribution check."""
    turns = case.request.conversation.turns
    return next((turn.id for speaker in ("operator", "system") for turn in turns if turn.speaker == speaker),
                turns[0].id)


def offline_transport(case: Case) -> httpx.MockTransport:
    evidence = stub_evidence(case)

    def reply(request):
        if request.method == "GET":
            return httpx.Response(200, json={"version": "stub"})
        model = json.loads(request.content)["model"]
        # The stub never reads labels. It exercises distinct ballots and local response validation.
        n = int(model.rsplit("-", 1)[-1])
        grades = [
            {"id": row.id, "v": row.allowed_values()[(n - 1) % len(row.allowed_values())],
             "r": "Stub response", "e": [evidence]}
            for row in case.request.checklist.criteria
        ]
        return httpx.Response(200, json={"model": model, "done": True, "done_reason": "stop",
                                         "message": {"content": json.dumps({"grades": grades})}})
    return httpx.MockTransport(reply)


async def evaluate_case(
    evaluator: Evaluator, live: httpx.AsyncClient, config: JudgesConfig, seats: list[Seat], case: Case,
    offline: bool, observe: Callable[[JudgeOutcome], None],
) -> tuple[EvaluationResult | None, str | None]:
    try:
        if offline:
            async with httpx.AsyncClient(transport=offline_transport(case)) as stub:
                return await evaluator(stub, config, seats, case.request, emit_panel=True, observe=observe), None
        return await evaluator(live, config, seats, case.request, emit_panel=True, observe=observe), None
    except EvaluationError as failure:
        return None, failure.code


def panel_rows(case: Case, grades: dict[str, Grade], passed: dict[str, bool]) -> dict:
    criteria = {row.id: row for row in case.request.checklist.criteria}
    rows = {}
    for criterion, label in case.expected.items():
        grade = grades.get(criterion)
        value = grade.value if grade else None
        rows[criterion] = {
            "expected": label.value, "value": value, "evidence_turn_ids": grade.evidence_turn_ids if grade else [],
            "passed": passed[criterion], "mismatch": error_kind(criteria[criterion], label.value, value),
        }
    return rows


async def measure(cases: list[Case], config: JudgesConfig, engine: str, offline: bool) -> dict:
    seats = configured_seats(config)
    evaluator = run_graph if engine == "langgraph" else run_panel
    panel = Breakdown()
    judges = {seat.name: JudgeStats() for seat in seats}
    panel_times, agreement, units, details = [], [], [], []

    async with httpx.AsyncClient(timeout=httpx.Timeout(MAX_TIMEOUT_SECONDS, connect=3), trust_env=False) as live:
        for case in cases:
            outcomes: list[JudgeOutcome] = []
            start = perf_counter()
            result, error = await evaluate_case(evaluator, live, config, seats, case, offline, outcomes.append)
            elapsed = perf_counter() - start
            panel_times.append(elapsed)
            grades = {grade.criterion_id: grade for grade in result.grades} if result else {}
            case_agreement = result.panel.agreement if result and result.panel else None
            if case_agreement is not None:
                agreement.append(case_agreement)
            passed = panel.add(case, grades)
            units.extend(ballot_units(case, outcomes))
            by_name = {outcome.name: outcome for outcome in outcomes}
            conversation = case.request.conversation
            details.append({
                "case": conversation.key, "language": conversation.language, "channel": conversation.channel,
                "error": error, "seconds": round(elapsed, 3), "agreement": case_agreement,
                "panel": panel_rows(case, grades, passed),
                "judges": {seat.name: judges[seat.name].add(case, seat, by_name.get(seat.name)) for seat in seats},
            })
            print(json.dumps({"case": conversation.key, "seconds": round(elapsed, 3), "error": error,
                              "correct": sum(passed.values()), "labels": len(passed)}), flush=True)

    return {
        "mode": "offline-stub" if offline else "live", "engine": engine,
        "panel": {**panel.report(), **latency(panel_times), "agreement": mean(agreement) if agreement else None,
                  "judge_alpha": krippendorff_alpha(units)},
        "judges": {name: stats.report() for name, stats in judges.items()},
        "cases": details,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", choices=("legacy", "langgraph"), default="langgraph")
    parser.add_argument("--judges-file", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--case", action="append", default=[], help="Select a case by filename stem; may be repeated")
    args = parser.parse_args()
    if args.offline and args.judges_file:
        parser.error("--offline supplies its own stub panel")
    try:
        cases = load_cases(args.case)
        config = offline_panel() if args.offline else load_judges(args.judges_file)
        report = asyncio.run(measure(cases, config, args.engine, args.offline))
    except ValueError as error:
        parser.exit(1, f"Harness setup failed: {error}\n")
    directory = ROOT / "reports"
    directory.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = directory / f"{now}-{report['mode']}-{args.engine}.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": report["mode"], "panel": report["panel"], "judges": report["judges"],
                      "report": str(path)}, indent=2))
    return int(any(row["error"] is not None for row in report["cases"]))


if __name__ == "__main__":
    raise SystemExit(main())
