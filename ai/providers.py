import os
import re
from dataclasses import dataclass, field

import httpx

from .contracts import ProviderName


DEFAULT_LLAMA_URL = "http://127.0.0.1:8080"
DEFAULT_LLAMA_MODEL = "Qwen3-1.7B-Q4_K_M"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:1.7b"


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

    def headers(self) -> dict[str, str]:
        if self.name == "gemini":
            return {"x-goog-api-key": self.api_key}
        if self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

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
                },
            }

        payload = {"model": self.model, "messages": messages, "stream": False}
        if self.name == "ollama":
            return {
                **payload,
                "format": schema,
                "think": False,
                "options": {"temperature": 0, "num_predict": max_tokens},
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
            }
        if self.name == "qwen":
            return {
                **payload,
                "response_format": {"type": "json_object"},
                "enable_thinking": False,
                "max_tokens": max_tokens,
            }
        return {
            **payload,
            "response_format": {"type": "json_object", "schema": schema},
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0,
            "max_tokens": max_tokens,
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


def configured_provider() -> Provider:
    name = os.environ.get("EVALUATOR_PROVIDER", "llama.cpp").strip().lower()
    if name == "llama.cpp":
        model = model_name("LLAMA_CPP_MODEL", DEFAULT_LLAMA_MODEL)
        base = os.environ.get("LLAMA_CPP_URL", DEFAULT_LLAMA_URL)
        endpoint = endpoint_url(base, "/v1/chat/completions", "LLAMA_CPP_URL", ("http", "https"))
        return Provider(name, model, endpoint)
    if name == "ollama":
        model = model_name("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)
        base = os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA_URL)
        endpoint = endpoint_url(base, "/api/chat", "OLLAMA_URL", ("http", "https"))
        return Provider(name, model, endpoint)
    if name == "openai":
        model = model_name("OPENAI_MODEL", "gpt-5.4-mini")
        endpoint = httpx.URL("https://api.openai.com/v1/chat/completions")
        return Provider(name, model, endpoint, api_key("OPENAI_API_KEY"))
    if name == "qwen":
        model = model_name("QWEN_MODEL", "qwen-plus")
        base = os.environ.get("QWEN_BASE_URL", "")
        endpoint = endpoint_url(base, "/chat/completions", "QWEN_BASE_URL", ("https",))
        return Provider(name, model, endpoint, api_key("DASHSCOPE_API_KEY"))
    if name == "gemini":
        model = model_name("GEMINI_MODEL", "gemini-3.1-flash-lite")
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", model):
            raise ValueError("Set GEMINI_MODEL to a model ID without a path.")
        endpoint = httpx.URL(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent")
        return Provider(name, model, endpoint, api_key("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    raise ValueError("Set EVALUATOR_PROVIDER to llama.cpp, ollama, openai, qwen, or gemini.")


def model_name(variable: str, default: str) -> str:
    model = os.environ.get(variable, default).strip()
    if not model:
        raise ValueError(f"Set {variable} to a model ID.")
    return model


def api_key(*variables: str) -> str:
    for variable in variables:
        key = os.environ.get(variable, "").strip()
        if key:
            if not all(33 <= ord(char) <= 126 for char in key):
                raise ValueError(f"Set {variable} to a valid API key.")
            return key
    raise ValueError(f"Set {' or '.join(variables)} for the selected provider.")


def endpoint_url(base: str, suffix: str, variable: str, schemes: tuple[str, ...]) -> httpx.URL:
    try:
        url = httpx.URL(base.strip())
        if url.scheme not in schemes or not url.host or url.userinfo or url.query or url.fragment:
            raise ValueError
        return url.copy_with(path=f"{url.path.rstrip('/')}{suffix}")
    except (ValueError, httpx.InvalidURL):
        raise ValueError(f"Set {variable} to a valid model server base URL.") from None
