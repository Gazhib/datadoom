"""Judge panel configuration loaded from YAML with ${VAR} / ${VAR:-default} placeholders."""

import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .contracts import ProviderName


DEFAULT_JUDGES_FILE = Path(__file__).with_name("judges.yaml")
JUDGES_FILE_VARIABLE = "EVALUATOR_JUDGES_FILE"
MAX_TIMEOUT_SECONDS = 900
PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

JudgeName = Annotated[str, Field(pattern=r"^[A-Za-z0-9._-]{1,40}$")]
KeepAlive = Annotated[str, Field(pattern=r"^-?(?:\d+|\d+(?:\.\d+)?(?:ms|s|m|h))$")] | int
VariableName = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")]


class ConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class JudgeConfig(ConfigModel):
    name: JudgeName
    provider: ProviderName
    model: str | None = None
    url: str | None = None
    # The file names the variable that holds a key. Keys themselves never live in YAML.
    api_key_env: VariableName | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    fallback_url: str | None = None
    fallback_model: str | None = None
    keep_alive: KeepAlive | None = None

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_provider(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator(
        "model", "url", "api_key_env", "temperature", "fallback_url", "fallback_model", "keep_alive", mode="before"
    )
    @classmethod
    def blank_means_unset(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


    @model_validator(mode="after")
    def validate_fallback(self) -> Self:
        if self.fallback_url and self.provider not in {"ollama", "llama.cpp"}:
            raise ValueError("Fallback servers are supported for local judges only.")
        if self.temperature is not None and self.provider == "anthropic":
            # Current Claude models reject non-default sampling parameters.
            raise ValueError("Claude judges use the model's default temperature. Remove temperature.")
        return self


class PanelConfig(ConfigModel):
    # Unset means a simple majority of the configured judges.
    quorum: int | None = Field(default=None, ge=1)
    timeout_seconds: float = Field(default=540, gt=0, le=MAX_TIMEOUT_SECONDS)
    judge_timeout_seconds: float = Field(default=240, gt=0, le=MAX_TIMEOUT_SECONDS)
    execution: Literal["auto", "sequential", "parallel"] = "auto"
    host_concurrency: int = Field(default=1, ge=1)
    keep_alive: KeepAlive = "30m"
    early_exit: bool = True

    @field_validator("quorum", mode="before")
    @classmethod
    def blank_means_majority(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class JudgesConfig(ConfigModel):
    panel: PanelConfig = PanelConfig()
    judges: list[JudgeConfig] = Field(min_length=1)

    @property
    def quorum(self) -> int:
        return self.panel.quorum or len(self.judges) // 2 + 1

    @model_validator(mode="after")
    def validate_panel(self) -> Self:
        names = [judge.name for judge in self.judges]
        if len(set(names)) != len(names):
            raise ValueError("Judge names must be unique.")
        if self.quorum > len(self.judges):
            raise ValueError("panel.quorum cannot exceed the number of judges.")
        return self


def interpolate(value: object, env: Mapping[str, str]) -> object:
    """Expand placeholders inside parsed string values so they cannot change the YAML structure."""
    if isinstance(value, str):
        return PLACEHOLDER.sub(lambda match: env.get(match[1]) or (match[2] or ""), value)
    if isinstance(value, list):
        return [interpolate(item, env) for item in value]
    if isinstance(value, dict):
        return {key: interpolate(item, env) for key, item in value.items()}
    return value


def load_judges(path: Path | None = None, env: Mapping[str, str] | None = None) -> JudgesConfig:
    env = os.environ if env is None else env
    path = path or Path(env.get(JUDGES_FILE_VARIABLE) or DEFAULT_JUDGES_FILE)
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError:
        raise ValueError(f"Cannot read the judge configuration file {path.name}.") from None
    except yaml.YAMLError:
        raise ValueError(f"The judge configuration file {path.name} is not valid YAML.") from None
    try:
        return JudgesConfig.model_validate(interpolate(document, env))
    except ValidationError as error:
        raise ValueError(f"Invalid judge configuration: {describe(error)}") from None


def describe(error: ValidationError) -> str:
    # Report only locations and messages. Input values could contain a misplaced secret.
    first = error.errors(include_url=False, include_input=False, include_context=False)[0]
    location = ".".join(str(part) for part in first["loc"]) or "file"
    return f"{location}: {first['msg']}"
