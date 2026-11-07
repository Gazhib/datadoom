import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

from .config import JudgeConfig
from .contracts import ProviderName


GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models"


@dataclass(frozen=True)
class ProviderDefaults:
    model: str
    model_variable: str
    url: str
    url_variable: str | None
    suffix: str
    schemes: tuple[str, ...]
    key_variables: tuple[str, ...] = ()


# Judge settings win, then these provider-wide variables, then the built-in values.
DEFAULTS: dict[ProviderName, ProviderDefaults] = {
    "llama.cpp": ProviderDefaults(
        "Qwen3-1.7B-Q4_K_M", "LLAMA_CPP_MODEL", "http://127.0.0.1:8080", "LLAMA_CPP_URL",
        "/v1/chat/completions", ("http", "https"),
    ),
    "ollama": ProviderDefaults(
        "qwen3:1.7b", "OLLAMA_MODEL", "http://127.0.0.1:11434", "OLLAMA_URL", "/api/chat", ("http", "https"),
    ),
    "openai": ProviderDefaults(
        "gpt-5.4-mini", "OPENAI_MODEL", "https://api.openai.com/v1", None, "/chat/completions", ("https",),
        ("OPENAI_API_KEY",),
    ),
    "qwen": ProviderDefaults(
        "qwen-plus", "QWEN_MODEL", "", "QWEN_BASE_URL", "/chat/completions", ("https",), ("DASHSCOPE_API_KEY",),
    ),
    "gemini": ProviderDefaults(
        "gemini-3.1-flash-lite", "GEMINI_MODEL", GEMINI_API, None, "", ("https",),
        ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    ),
}


@dataclass(frozen=True)
class Completion:
    model: str
    content: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    thinking_tokens: int | None = None


@dataclass(frozen=True)
class Provider:
    name: ProviderName
    model: str
    endpoint: httpx.URL
    api_key: str = field(default="", repr=False)
    temperature: float | None = None

    @property
    def local(self) -> bool:
        return self.name in {"llama.cpp", "ollama"}

    def headers(self) -> dict[str, str]:
        if self.name == "gemini":
            return {"x-goog-api-key": self.api_key}
        if self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

    def sampling(self) -> dict[str, float]:
        # Local judges decode greedily unless configured. Hosted APIs keep their own default,
        # since some models only accept their default temperature.
        if self.temperature is not None:
            return {"temperature": self.temperature}
        return {"temperature": 0} if self.local else {}

    def payload(self, messages: list[dict[str, str]], schema: dict, max_tokens: int) -> dict:
        if self.name == "gemini":
            system, transcript = messages
            return {
                "systemInstruction": {"parts": [{"text": system["content"]}]},
                "contents": [{"role": "user", "parts": [{"text": transcript["content"]}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseJsonSchema": schema,
                    "maxOutputTokens": max(1024, max_tokens),
                    **self.sampling(),
                },
            }

        payload = {"model": self.model, "messages": messages, "stream": False}
        if self.name == "ollama":
            return {
                **payload,
                "format": schema,
                "think": False,
                "options": {**self.sampling(), "num_predict": max_tokens},
            }
        if self.name == "openai":
            return {
                **payload,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "evaluation_grades", "strict": True, "schema": schema},
                },
                "max_completion_tokens": max(1024, max_tokens),
                "store": False,
                **self.sampling(),
            }
        if self.name == "qwen":
            return {
                **payload,
                "response_format": {"type": "json_object"},
                "enable_thinking": False,
                "max_tokens": max_tokens,
                **self.sampling(),
            }
        return {
            **payload,
            "response_format": {"type": "json_object", "schema": schema},
            "chat_template_kwargs": {"enable_thinking": False},
            "max_tokens": max_tokens,
            **self.sampling(),
        }

    def read_completion(self, response: dict) -> Completion:
        if self.name == "ollama":
            content = None
            if response.get("done") is True and response.get("done_reason") == "stop":
                content = response["message"]["content"]
            return Completion(
                model=response["model"],
                content=content,
                prompt_tokens=token_count(response, "prompt_eval_count"),
                completion_tokens=token_count(response, "eval_count"),
            )
        if self.name == "gemini":
            candidates = response.get("candidates") or []
            candidate = candidates[0] if candidates else {}
            content = None
            if candidate.get("finishReason") == "STOP":
                content = "".join(
                    part.get("text", "")
                    for part in candidate["content"]["parts"]
                    if not part.get("thought")
                )
            usage = response.get("usageMetadata")
            return Completion(
                model=response["modelVersion"],
                content=content,
                prompt_tokens=token_count(usage, "promptTokenCount"),
                completion_tokens=token_count(usage, "candidatesTokenCount"),
                thinking_tokens=token_count(usage, "thoughtsTokenCount"),
            )

        choices = response.get("choices") or []
        choice = choices[0] if choices else {}
        content = None
        if choice.get("finish_reason") == "stop":
            message = choice["message"]
            if not message.get("refusal"):
                content = message["content"]
        usage = response.get("usage")
        return Completion(
            model=response["model"],
            content=content,
            prompt_tokens=token_count(usage, "prompt_tokens"),
            completion_tokens=token_count(usage, "completion_tokens"),
        )


def token_count(usage: object, key: str) -> int | None:
    value = usage.get(key) if isinstance(usage, dict) else None
    return value if type(value) is int else None


def build_provider(judge: JudgeConfig, env: Mapping[str, str] | None = None) -> Provider:
    env = os.environ if env is None else env
    defaults = DEFAULTS[judge.provider]
    model = judge.model or env.get(defaults.model_variable, "").strip() or defaults.model
    key_variables = (judge.api_key_env,) if judge.api_key_env else defaults.key_variables
    key = api_key(env, *key_variables) if key_variables else ""
    endpoint = provider_endpoint(judge, defaults, model, env)
    return Provider(judge.provider, model, endpoint, key, judge.temperature)


def provider_endpoint(
    judge: JudgeConfig, defaults: ProviderDefaults, model: str, env: Mapping[str, str]
) -> httpx.URL:
    if judge.provider == "gemini":
        if judge.url:
            raise ValueError("Gemini judges use the Gemini API. Remove the url setting.")
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", model):
            raise ValueError("Set the Gemini model to a model ID without a path.")
        return httpx.URL(f"{defaults.url}/{model}:generateContent")

    variable_base = env.get(defaults.url_variable, "") if defaults.url_variable else ""
    base = judge.url or variable_base.strip() or defaults.url
    setting = "url" if judge.url or not defaults.url_variable else f"url or {defaults.url_variable}"
    return endpoint_url(base, defaults.suffix, setting, defaults.schemes)


def api_key(env: Mapping[str, str], *variables: str) -> str:
    for variable in variables:
        key = env.get(variable, "").strip()
        if key:
            if not all(33 <= ord(char) <= 126 for char in key):
                raise ValueError(f"Set {variable} to a valid API key.")
            return key
    raise ValueError(f"Set {' or '.join(variables)} for the selected provider.")


def endpoint_url(base: str, suffix: str, setting: str, schemes: tuple[str, ...]) -> httpx.URL:
    try:
        url = httpx.URL(base.strip())
        if url.scheme not in schemes or not url.host or url.userinfo or url.query or url.fragment:
            raise ValueError
        return url.copy_with(path=f"{url.path.rstrip('/')}{suffix}")
    except (ValueError, httpx.InvalidURL):
        raise ValueError(f"Set {setting} to a valid model server base URL.") from None
