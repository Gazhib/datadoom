from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Nonblank = Annotated[str, Field(min_length=1, pattern=r"\S")]
StrictInteger = Annotated[int, Field(strict=True)]
Speaker = Literal["client", "operator", "bot", "system"]
ReasonLocale = Literal["en", "ru", "kk"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RawTurn(Contract):
    timestamp: Nonblank
    speaker: Speaker
    text: str


class Turn(RawTurn):
    id: str


class RawRecord(Contract):
    conversation_id: Nonblank
    channel: Literal["agent chat", "voice call"]
    language: Literal["RU", "KZ", "EN"]
    transcript: Annotated[list[RawTurn], Field(min_length=1)]
    audio_url: str | None

    @model_validator(mode="after")
    def validate_record(self) -> Self:
        if not any(turn.text.strip() for turn in self.transcript):
            raise ValueError("A transcript needs at least one nonblank turn")
        if self.audio_url is not None:
            if not self.audio_url.strip() and self.channel == "agent chat":
                self.audio_url = None
            else:
                parts = urlsplit(self.audio_url)
                if parts.scheme not in {"https", "http"} or not parts.netloc:
                    raise ValueError("Audio links must be HTTP or HTTPS URLs")
        return self


class ConversationSummary(Contract):
    key: str
    group_id: str
    conversation_id: str
    channel: Literal["agent chat", "voice call"]
    language: Literal["RU", "KZ", "EN"]
    audio_url: str | None


class Conversation(ConversationSummary):
    turns: list[Turn]


class LatestEvaluation(Contract):
    evaluation_id: str
    checklist_version_id: str
    mode: Literal["live", "fixture"]
    total: float | None
    serious_error: bool


class ConversationWithLatest(ConversationSummary):
    latest: LatestEvaluation | None


class Criterion(Contract):
    id: Nonblank
    label: Nonblank
    instruction: Nonblank
    kind: Literal["binary", "scale", "flag"]
    weight: Annotated[int, Field(strict=True, ge=0, le=100)]
    scale: list[StrictInteger]
    allow_na: Annotated[bool, Field(strict=True)]
    na_rule: str | None
    section: Nonblank | None

    @model_validator(mode="after")
    def validate_rules(self) -> Self:
        if self.kind == "flag":
            if self.weight != 0 or self.allow_na:
                raise ValueError("Flags must have zero weight and disallow N/A")
        elif self.weight < 1:
            raise ValueError("Weighted criteria require weight 1–100")
        if self.kind == "scale":
            if (
                len(self.scale) < 2
                or self.scale[0] != 0
                or self.scale[-1] <= 0
                or sorted(set(self.scale)) != self.scale
            ):
                raise ValueError(
                    "Scale steps must ascend distinctly from zero to a positive maximum"
                )
        elif self.scale:
            raise ValueError("Only scale criteria may specify scale steps")
        if self.allow_na:
            if not self.na_rule or not self.na_rule.strip():
                raise ValueError("N/A requires a nonblank applicability rule")
        elif self.na_rule is not None:
            raise ValueError("N/A rule must be null when N/A is disabled")
        return self


class ChecklistCreate(Contract):
    name: Nonblank
    criteria: Annotated[list[Criterion], Field(min_length=1)]

    @field_validator("criteria")
    @classmethod
    def validate_criteria(cls, criteria: list[Criterion]) -> list[Criterion]:
        if len({criterion.id for criterion in criteria}) != len(criteria):
            raise ValueError("Criterion IDs must be unique")
        if not any(criterion.kind != "flag" for criterion in criteria):
            raise ValueError("At least one weighted criterion is required")
        return criteria


class Checklist(ChecklistCreate):
    version_id: str


class Grade(Contract):
    criterion_id: Nonblank
    value: Literal["yes", "no", "na"] | StrictInteger
    reason: Nonblank
    evidence_turn_ids: Annotated[list[Nonblank], Field(min_length=1)]


class Model(Contract):
    provider: Nonblank
    model: Nonblank


GradeValue = Literal["yes", "no", "na"] | StrictInteger


class PanelData(BaseModel):
    model_config = ConfigDict(extra="ignore")


class PanelJudge(PanelData):
    name: Nonblank
    provider: Nonblank
    model: Nonblank
    host: str
    fallback: bool
    status: Literal["ok", "failed", "skipped"]
    error_code: str | None
    seconds: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None
    # Older evaluations and failed judges have no per-judge grades.
    grades: list[Grade] | None = None


class PanelVote(PanelData):
    criterion_id: Nonblank
    value: GradeValue
    agreement: Annotated[float, Field(ge=0, le=1)]
    ballots: dict[str, GradeValue]


class Panel(PanelData):
    quorum: Annotated[int, Field(strict=True, ge=1)]
    agreement: Annotated[float, Field(ge=0, le=1)]
    judges: list[PanelJudge]
    votes: list[PanelVote]


class EvaluatorResult(Contract):
    mode: Literal["live", "fixture"]
    model: Model
    grades: list[Grade]
    panel: Panel | None = None


class ScoreItem(Grade):
    weight: int
    effective_weight: float | None
    points: float | None


class SectionScore(Contract):
    name: str
    points: float | None
    possible: float | None


class Score(Contract):
    items: list[ScoreItem]
    total: float | None
    serious_error: bool
    sections: list[SectionScore]


class Decision(Contract):
    action: Literal["confirm", "change"]
    reason: Nonblank
    replacement: Grade | None = None

    @model_validator(mode="after")
    def validate_replacement(self) -> Self:
        if self.action == "change" and self.replacement is None:
            raise ValueError("A changed decision requires a replacement grade")
        if self.action == "confirm" and self.replacement is not None:
            raise ValueError("Confirmation cannot replace the grade")
        return self


class AppealCreate(Contract):
    criterion_id: Nonblank
    comment: Nonblank


class Appeal(AppealCreate):
    status: Literal["open", "resolved"]
    decision: Decision | None


class Evaluation(Contract):
    id: str
    conversation_key: str
    checklist: Checklist
    mode: Literal["live", "fixture"]
    model: Model
    original: Score
    final: Score
    appeals: list[Appeal]
    panel: Panel | None = None


class EvaluationCreate(Contract):
    conversation_key: Nonblank
    checklist_version_id: Nonblank
    reason_locale: ReasonLocale | None = None


class JobBatch(Contract):
    group_id: Nonblank
    checklist_version_id: Nonblank
    skip_existing: bool = True
    reason_locale: ReasonLocale | None = None


class JobError(Contract):
    code: Nonblank
    message: Nonblank


class JudgeProgress(Contract):
    name: Nonblank
    status: Literal["pending", "running", "ok", "failed", "skipped"]
    host: str | None = None
    seconds: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None
    error_code: Nonblank | None = None
    grades: list[Grade] | None = None


class JobProgress(Contract):
    judges: list[JudgeProgress]


class EvaluationJob(Contract):
    id: str
    conversation_key: str
    checklist_version_id: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    created_at: str
    started_at: str | None
    finished_at: str | None
    queue_position: int | None
    progress: JobProgress | None
    evaluation_id: str | None
    error: JobError | None
    reason_locale: ReasonLocale | None = Field(default=None, exclude=True)


class JobList(Contract):
    items: list[EvaluationJob]


class ImportRequest(Contract):
    source: Literal["organizer", "upload"]
    group_id: Nonblank
    records: list[RawRecord] | None = None

    @model_validator(mode="after")
    def validate_source(self) -> Self:
        if self.source == "upload" and self.records is None:
            raise ValueError("Upload requires a records array")
        if self.source == "organizer" and self.records is not None:
            raise ValueError("Organizer import cannot include uploaded records")
        return self


class ImportResult(Contract):
    group_id: str
    imported: int
    skipped: int


class ConversationList(Contract):
    items: list[ConversationSummary]


class ConversationLatestList(Contract):
    items: list[ConversationWithLatest]


class ChecklistList(Contract):
    items: list[Checklist]


class EvaluationList(Contract):
    items: list[Evaluation]
