from fractions import Fraction

from .models import Checklist, Conversation, Criterion, Grade, Score, ScoreItem, SectionScore


def validate_grade(grade: Grade, criterion: Criterion, conversation: Conversation) -> None:
    if grade.criterion_id != criterion.id:
        raise ValueError("Grade must reference the selected criterion")
    if not set(grade.evidence_turn_ids) <= {turn.id for turn in conversation.turns}:
        raise ValueError("Evidence must reference turns in this conversation")
    value = grade.value
    if value == "na":
        if not criterion.allow_na:
            raise ValueError("This criterion does not allow N/A")
    elif criterion.kind == "scale":
        if type(value) is not int or value not in criterion.scale:
            raise ValueError("Grade must be a configured scale step")
    elif value not in ("yes", "no"):
        raise ValueError("Binary and flag grades must be yes or no")


def validate_grades(grades: list[Grade], checklist: Checklist, conversation: Conversation) -> None:
    if len(grades) != len(checklist.criteria) or {g.criterion_id for g in grades} != {
        c.id for c in checklist.criteria
    }:
        raise ValueError("Exactly one grade per configured criterion is required")
    criteria = {criterion.id: criterion for criterion in checklist.criteria}
    for grade in grades:
        validate_grade(grade, criteria[grade.criterion_id], conversation)


def half_up(value: Fraction) -> float:
    # Exact rational arithmetic, rounded as decimal ROUND_HALF_UP to two places.
    # Keep contributions unrounded until summing the total and each section.
    whole, remainder = divmod(value.numerator * 100, value.denominator)
    return (whole + (2 * remainder >= value.denominator)) / 100


def calculate_score(checklist: Checklist, grades: list[Grade]) -> Score:
    by_id = {grade.criterion_id: grade for grade in grades}
    applicable_weight = sum(
        criterion.weight
        for criterion in checklist.criteria
        if criterion.kind != "flag" and by_id[criterion.id].value != "na"
    )
    total = Fraction(0)
    sections: dict[str, tuple[Fraction, Fraction]] = {}
    items: list[ScoreItem] = []
    serious_error = False
    for criterion in checklist.criteria:
        grade = by_id[criterion.id]
        weight = points = None
        if criterion.kind == "flag":
            serious_error |= grade.value == "yes"
        elif grade.value != "na":
            weight = Fraction(100 * criterion.weight, applicable_weight)
            factor = (
                Fraction(int(grade.value), criterion.scale[-1])
                if criterion.kind == "scale"
                else Fraction(grade.value == "yes")
            )
            points = weight * factor
            total += points
        items.append(
            ScoreItem(
                **grade.model_dump(),
                weight=criterion.weight,
                effective_weight=half_up(weight) if weight is not None else None,
                points=half_up(points) if points is not None else None,
            )
        )
        if criterion.section is not None:
            earned, possible = sections.setdefault(criterion.section, (Fraction(0), Fraction(0)))
            sections[criterion.section] = (earned + (points or 0), possible + (weight or 0))
    return Score(
        items=items,
        total=half_up(total) if applicable_weight else None,
        serious_error=serious_error,
        sections=[
            SectionScore(
                name=name,
                points=half_up(earned) if possible else None,
                possible=half_up(possible) if possible else None,
            )
            for name, (earned, possible) in sections.items()
        ],
    )
