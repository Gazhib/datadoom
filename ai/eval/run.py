"""Measure panel and judge grades against synthetic labels. Offline results are stubs."""

import argparse
import asyncio
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median
from time import perf_counter

import httpx

from ai.config import MAX_TIMEOUT_SECONDS, JudgesConfig, load_judges
from ai.contracts import ContractModel, EvaluationRequest, Grade, GradeValue
from ai.errors import EvaluationError
from ai.graph import run_graph
from ai.panel import JudgeOutcome, run_panel
from ai.scheduler import configured_seats


ROOT = Path(__file__).parent


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


@dataclass
class Accuracy:
    labels: int = 0
    correct_value: int = 0
    correct_evidence: int = 0
    correct: int = 0

    def add(self, expected: Label, observed: Grade | None) -> bool:
        value = observed is not None and expected.value == observed.value
        evidence = observed is not None and bool(set(expected.evidence_turn_ids).intersection(observed.evidence_turn_ids))
        self.labels += 1
        self.correct_value += value
        self.correct_evidence += evidence
        self.correct += value and evidence
        return value and evidence

    def report(self) -> dict:
        return {
            "labels": self.labels, "correct": self.correct, "accuracy": self.correct / self.labels,
            "value_accuracy": self.correct_value / self.labels,
            "evidence_accuracy": self.correct_evidence / self.labels,
        }


def latency(values: list[float]) -> dict:
    if not values:
        return {"p50_seconds": None, "p95_seconds": None}
    return {"p50_seconds": round(median(values), 3),
            "p95_seconds": round(sorted(values)[math.ceil(len(values) * .95) - 1], 3)}


def offline_panel() -> JudgesConfig:
    return JudgesConfig.model_validate({
        "judges": [{"name": f"stub-{i}", "model": f"stub-{i}", "provider": "ollama",
                    "url": f"http://stub-{i}:11434"} for i in range(1, 4)],
    })


def offline_transport(case: Case) -> httpx.MockTransport:
    def reply(request):
        if request.method == "GET":
            return httpx.Response(200, json={"version": "stub"})
        model = json.loads(request.content)["model"]
        # The stub never reads labels. It exercises distinct ballots and local response validation.
        n = int(model.rsplit("-", 1)[-1])
        grades = [
            {"id": row.id, "v": row.allowed_values()[(n - 1) % len(row.allowed_values())],
             "r": "Stub response", "e": [case.request.conversation.turns[0].id]}
            for row in case.request.checklist.criteria
        ]
        return httpx.Response(200, json={"model": model, "done": True, "done_reason": "stop",
                                         "message": {"content": json.dumps({"grades": grades})}})
    return httpx.MockTransport(reply)


async def measure(cases: list[Case], config: JudgesConfig, engine: str, offline: bool) -> dict:
    seats = configured_seats(config)
    evaluator = run_graph if engine == "langgraph" else run_panel
    panel_total = Accuracy()
    panel_criteria = defaultdict(Accuracy)
    judge_totals = {seat.name: Accuracy() for seat in seats}
    judge_criteria = {seat.name: defaultdict(Accuracy) for seat in seats}
    judge_times = defaultdict(list)
    panel_times = []
    agreement = []
    details = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(MAX_TIMEOUT_SECONDS, connect=3), trust_env=False) as live:
        for case in cases:
            name = case.request.conversation.key
            outcomes: list[JudgeOutcome] = []
            start = perf_counter()
            panel_grades = {}
            error = None
            case_agreement = None
            try:
                if offline:
                    async with httpx.AsyncClient(transport=offline_transport(case)) as stub:
                        result = await evaluator(stub, config, seats, case.request, emit_panel=True, observe=outcomes.append)
                else:
                    result = await evaluator(live, config, seats, case.request, emit_panel=True, observe=outcomes.append)
                panel_grades = {grade.criterion_id: grade for grade in result.grades}
                if result.panel:
                    case_agreement = result.panel.agreement
                    agreement.append(case_agreement)
            except EvaluationError as failure:
                error = failure.code

            elapsed = perf_counter() - start
            panel_times.append(elapsed)
            observed = {}
            for criterion, label in case.expected.items():
                grade = panel_grades.get(criterion)
                passed = panel_total.add(label, grade)
                panel_criteria[criterion].add(label, grade)
                observed[criterion] = {
                    "expected": label.value, "value": grade.value if grade else None,
                    "evidence_turn_ids": grade.evidence_turn_ids if grade else [], "passed": passed,
                }

            by_name = {outcome.name: outcome for outcome in outcomes}
            judges = {}
            for seat in seats:
                outcome = by_name.get(seat.name)
                verdict = outcome.verdict if outcome else None
                grades = {grade.criterion_id: grade for grade in verdict.grades} if verdict else {}
                if outcome and outcome.seconds is not None:
                    judge_times[seat.name].append(outcome.seconds)
                # Skips are not model errors. Measure model quality only where a judge was tried.
                if outcome and outcome.status != "skipped":
                    for criterion, label in case.expected.items():
                        judge_totals[seat.name].add(label, grades.get(criterion))
                        judge_criteria[seat.name][criterion].add(label, grades.get(criterion))
                judges[seat.name] = {
                    "status": outcome.status if outcome else "missing", "seconds": outcome.seconds if outcome else None,
                    "model": verdict.model if verdict else outcome.route.provider.model if outcome else seat.provider.model,
                    "error": outcome.error_code if outcome else None,
                    "grades": {criterion: {"value": grade.value, "evidence_turn_ids": grade.evidence_turn_ids}
                               for criterion, grade in grades.items() if criterion in case.expected},
                }

            detail = {"case": name, "language": case.request.conversation.language, "error": error,
                      "seconds": round(elapsed, 3), "agreement": case_agreement, "panel": observed, "judges": judges}
            details.append(detail)
            print(json.dumps({"case": name, "seconds": detail["seconds"], "error": error,
                              "correct": sum(row["passed"] for row in observed.values()), "labels": len(observed)}),
                  flush=True)

    return {
        "mode": "offline-stub" if offline else "live", "engine": engine,
        "panel": {**panel_total.report(), **latency(panel_times),
                  "agreement": mean(agreement) if agreement else None,
                  "by_criterion": {criterion: accuracy.report() for criterion, accuracy in panel_criteria.items()}},
        "judges": {
            name: {**(accuracy.report() if accuracy.labels else {"labels": 0}), **latency(judge_times[name]),
                   "by_criterion": {key: value.report() for key, value in judge_criteria[name].items()}}
            for name, accuracy in judge_totals.items()
        },
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
