from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def require_nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("Must contain nonblank text.")
    return value


NonBlank = Annotated[str, AfterValidator(require_nonblank)]
GradeValue = Literal["yes", "no", "na"] | int
ProviderName = Literal["llama.cpp", "ollama", "openai", "qwen", "gemini", "anthropic"]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Turn(ContractModel):
    id: NonBlank
    timestamp: str
    speaker: Literal["client", "operator", "bot", "system"]
    text: str


class Conversation(ContractModel):
    key: NonBlank
    group_id: NonBlank
    conversation_id: NonBlank
    channel: Literal["agent chat", "voice call"]
    language: Literal["RU", "KZ", "EN"]
    audio_url: str | None
    turns: list[Turn] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_turns(self) -> Self:
        if not any(turn.text.strip() for turn in self.turns):
            raise ValueError("At least one turn must contain text.")
        if len({turn.id for turn in self.turns}) != len(self.turns):
            raise ValueError("Turn IDs must be unique.")
        return self


class Criterion(ContractModel):
    id: NonBlank
    label: NonBlank
    instruction: NonBlank
    kind: Literal["binary", "scale", "flag"]
    weight: int
    scale: list[int]
    allow_na: bool
    na_rule: NonBlank | None
    section: str | None

    @model_validator(mode="after")
    def validate_rules(self) -> Self:
        if self.allow_na != (self.na_rule is not None):
            raise ValueError("An N/A rule is required exactly when N/A is allowed.")
        if self.kind == "flag":
            if self.weight != 0 or self.allow_na:
                raise ValueError("Flags must have zero weight and disallow N/A.")
        elif not 1 <= self.weight <= 100:
            raise ValueError("Weighted criteria must have weight 1–100.")
        if self.kind == "scale":
            if (
                len(self.scale) < 2
                or self.scale[0] != 0
                or self.scale != sorted(set(self.scale))
            ):
                raise ValueError("A scale must start at zero and strictly increase.")
        elif self.scale:
            raise ValueError("Only scale criteria may define steps.")
        return self

    def allows(self, value: GradeValue) -> bool:
        return value in self.allowed_values()

    def allowed_values(self) -> list[GradeValue]:
        values: list[GradeValue] = list(self.scale) if self.kind == "scale" else ["yes", "no"]
        if self.allow_na:
            values.append("na")
        return values


class Checklist(ContractModel):
    version_id: NonBlank
    name: NonBlank
    criteria: list[Criterion] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_criteria(self) -> Self:
        if len({item.id for item in self.criteria}) != len(self.criteria):
            raise ValueError("Criterion IDs must be unique.")
        if not any(item.weight for item in self.criteria):
            raise ValueError("At least one weighted criterion is required.")
        return self


class EvaluationRequest(ContractModel):
    conversation: Conversation
    checklist: Checklist
    reason_locale: Literal["en", "ru", "kk"] = "en"


class Grade(ContractModel):
    criterion_id: NonBlank
    value: GradeValue
    reason: NonBlank
    evidence_turn_ids: list[NonBlank] = Field(min_length=1)


class ProviderGrade(Grade):
    # Short wire keys reduce decoding work. EvaluationResult serializes the public Grade fields.
    criterion_id: NonBlank = Field(alias="id")
    value: GradeValue = Field(alias="v")
    reason: NonBlank = Field(alias="r")
    evidence_turn_ids: list[NonBlank] = Field(alias="e", min_length=1)


class ProviderGrades(ContractModel):
    grades: list[ProviderGrade]


class Model(ContractModel):
    # "panel" marks grades combined from several judges; model lists each provider/model.
    provider: ProviderName | Literal["panel"]
    model: NonBlank


JudgeStatus = Literal["ok", "failed", "skipped"]


class JudgeReport(ContractModel):
    name: NonBlank
    provider: ProviderName
    model: NonBlank
    host: NonBlank
    fallback: bool
    status: JudgeStatus
    error_code: str | None
    seconds: float | None
    # This judge's own grades, kept so reviewers can compare reasons and cited turns per judge.
    grades: list[Grade] | None = None


class VoteReport(ContractModel):
    criterion_id: NonBlank
    value: GradeValue
    agreement: float
    ballots: dict[str, GradeValue]


class PanelReport(ContractModel):
    quorum: int
    agreement: float
    judges: list[JudgeReport]
    votes: list[VoteReport]


class EvaluationResult(ContractModel):
    mode: Literal["live"] = "live"
    model: Model
    grades: list[Grade]
    panel: PanelReport | None = None
