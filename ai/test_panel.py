import unittest

from ai.contracts import Criterion, Grade
from ai.panel import Ballot, decide


def criterion(kind="binary", *, allow_na=False) -> Criterion:
    return Criterion(
        id="c1",
        label="Label",
        instruction="Instruction",
        kind=kind,
        weight=0 if kind == "flag" else 10,
        scale=[0, 5, 10, 15, 20] if kind == "scale" else [],
        allow_na=allow_na,
        na_rule="Not applicable rule" if allow_na else None,
        section=None,
    )


def ballots(*votes) -> list[Ballot]:
    """Each vote is (value, evidence) in judge priority order."""
    return [
        Ballot(
            judge=f"judge-{index}",
            provider="ollama",
            model=f"model-{index}",
            grades={
                "c1": Grade(
                    criterion_id="c1",
                    value=value,
                    reason=f"reason from judge-{index}",
                    evidence_turn_ids=evidence,
                )
            },
        )
        for index, (value, evidence) in enumerate(votes, start=1)
    ]


class ConsensusTests(unittest.TestCase):
    def test_majority_wins_and_agreeing_judges_supply_reason_and_evidence(self):
        decision = decide(criterion(), ballots(("no", ["t1"]), ("yes", ["t3", "t2"]), ("yes", ["t2"])))
        self.assertEqual(decision.grade.value, "yes")
        self.assertEqual(decision.grade.reason, "reason from judge-2")
        # Turns cited by more agreeing judges come first; dissenting evidence is dropped.
        self.assertEqual(decision.grade.evidence_turn_ids, ["t2", "t3"])
        self.assertAlmostEqual(decision.agreement, 2 / 3)
        self.assertEqual(decision.votes, {"judge-1": "no", "judge-2": "yes", "judge-3": "yes"})

    def test_ties_go_to_the_first_listed_judge(self):
        three_way = decide(criterion(allow_na=True), ballots(("na", ["t1"]), ("yes", ["t2"]), ("no", ["t3"])))
        self.assertEqual(three_way.grade.value, "na")
        two_judges = decide(criterion("flag"), ballots(("no", ["t1"]), ("yes", ["t2"])))
        self.assertEqual(two_judges.grade.value, "no")
        self.assertEqual(two_judges.agreement, 0.5)

    def test_scale_uses_lower_median_of_numeric_votes(self):
        cases = (
            ((0, 20, 10), 10),
            ((15, 20), 15),
            ((10, 15, "na"), 10),
            ((20, 20, 0), 20),
        )
        for values, expected in cases:
            with self.subTest(values=values):
                decision = decide(criterion("scale", allow_na=True), ballots(*((v, ["t1"]) for v in values)))
                self.assertEqual(decision.grade.value, expected)

    def test_scale_is_na_only_when_na_wins_the_applicability_vote(self):
        scale = criterion("scale", allow_na=True)
        self.assertEqual(decide(scale, ballots(("na", ["t1"]), ("na", ["t2"]), (10, ["t3"]))).grade.value, "na")
        self.assertEqual(decide(scale, ballots(("na", ["t1"]), (10, ["t3"]))).grade.value, "na")
        self.assertEqual(decide(scale, ballots((10, ["t3"]), ("na", ["t1"]))).grade.value, 10)

    def test_unanimous_panel_has_full_agreement(self):
        decision = decide(criterion(), ballots(("yes", ["t2"]), ("yes", ["t2"]), ("yes", ["t2", "t4"])))
        self.assertEqual(decision.agreement, 1)
        self.assertEqual(decision.grade.evidence_turn_ids, ["t2", "t4"])
