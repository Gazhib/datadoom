import asyncio
import unittest

from ai.contracts import Criterion, Grade
from ai.eval.metrics import Accuracy, cohen_kappa, error_kind, krippendorff_alpha, tokens
from ai.eval.run import load_cases, measure, offline_panel
from ai.judge import Usage


def criterion(kind="binary", *, allow_na=False) -> Criterion:
    return Criterion(
        id="c1", label="Label", instruction="Instruction", kind=kind, weight=0 if kind == "flag" else 10,
        scale=[0, 5, 10] if kind == "scale" else [], allow_na=allow_na,
        na_rule="Rule" if allow_na else None, section=None,
    )


class ErrorDirectionTests(unittest.TestCase):
    def test_harsher_grades_are_false_accusations_and_lenient_ones_are_missed_failures(self):
        binary, flag, scale = criterion(allow_na=True), criterion("flag"), criterion("scale", allow_na=True)
        cases = (
            (binary, "yes", "no", "false_accusation"),
            (binary, "no", "yes", "missed_failure"),
            (flag, "no", "yes", "false_accusation"),
            (flag, "yes", "no", "missed_failure"),
            (scale, 10, 5, "false_accusation"),
            (scale, 0, 5, "missed_failure"),
            (binary, "na", "no", "applicability"),
            (scale, 5, "na", "applicability"),
            (binary, "yes", None, "no_verdict"),
            (scale, 5, 5, None),
        )
        for row, expected, observed, kind in cases:
            with self.subTest(kind=row.kind, expected=expected, observed=observed):
                self.assertEqual(error_kind(row, expected, observed), kind)

    def test_accuracy_reports_error_direction_and_kappa(self):
        accuracy = Accuracy()
        row = criterion()
        for expected, observed, evidence in (("yes", "yes", "t1"), ("yes", "yes", "t2"), ("no", "no", "t3"),
                                             ("no", "yes", "t4")):
            grade = Grade(criterion_id="c1", value=observed, reason="Reason", evidence_turn_ids=[evidence])
            accuracy.add(row, expected, ["t1", "t3", "t4"], grade)
        accuracy.add(row, "yes", ["t1"], None)
        report = accuracy.report()
        self.assertEqual((report["labels"], report["correct"], report["accuracy"]), (5, 2, 2 / 5))
        self.assertEqual((report["value_accuracy"], report["evidence_accuracy"]), (3 / 5, 3 / 5))
        self.assertEqual((report["false_accusations"], report["missed_failures"], report["no_verdicts"]), (0, 1, 1))
        self.assertAlmostEqual(report["kappa"], cohen_kappa([("yes", "yes"), ("yes", "yes"), ("no", "no"),
                                                             ("no", "yes"), ("yes", None)]))


class AgreementTests(unittest.TestCase):
    def test_cohen_kappa_corrects_for_chance(self):
        self.assertAlmostEqual(cohen_kappa([("y", "y"), ("y", "y"), ("n", "n"), ("n", "y")]), 0.5)
        self.assertEqual(cohen_kappa([("y", "y"), ("n", "n")]), 1)
        self.assertIsNone(cohen_kappa([("y", "y"), ("y", "y")]))
        self.assertIsNone(cohen_kappa([]))

    def test_krippendorff_alpha_handles_missing_votes(self):
        self.assertAlmostEqual(krippendorff_alpha([[1, 1], [2, 2], [1, 2]]), 4 / 9)
        # A unit with one valid vote has nothing to pair and is ignored.
        self.assertAlmostEqual(krippendorff_alpha([["yes", "yes", "yes"], ["no", "no"], ["na"]]), 1)
        self.assertIsNone(krippendorff_alpha([["yes", "yes"], ["yes", "yes", "yes"]]))
        self.assertIsNone(krippendorff_alpha([["yes"]]))

    def test_tokens_include_repairs_and_mark_unreported_counts(self):
        report = tokens([Usage(100, 20, None), Usage(300, 40, None)])
        self.assertEqual(report, {"evaluations": 2, "prompt_tokens": 200, "completion_tokens": 30,
                                  "thinking_tokens": None, "per_1000_evaluations": 230000})
        self.assertIsNone(tokens([Usage(100, None, 5)])["per_1000_evaluations"])
        self.assertEqual(tokens([]), {"evaluations": 0})


class HarnessTests(unittest.TestCase):
    def test_offline_report_breaks_down_reliability_by_language_channel_and_judge(self):
        cases = load_cases(["kz-bot-only", "en-system-verified"])
        report = asyncio.run(measure(cases, offline_panel(), "langgraph", offline=True))
        panel = report["panel"]
        self.assertEqual(panel["labels"], 3)
        self.assertEqual(set(panel["by_language"]), {"KZ", "EN"})
        self.assertTrue(set(panel["by_channel"]) <= {"agent chat", "voice call"})
        self.assertIn("judge_alpha", panel)
        for name, judge in report["judges"].items():
            with self.subTest(judge=name):
                # Stub votes cite a turn the attribution check accepts, so every stub judge stays valid.
                self.assertEqual(judge["statuses"], {"ok": 2})
                self.assertEqual(judge["repair_rate"], 0)
                self.assertEqual(judge["tokens"]["evaluations"], 2)
        rows = report["cases"][0]["panel"]
        self.assertTrue(all("mismatch" in row for row in rows.values()))


if __name__ == "__main__":
    unittest.main()
