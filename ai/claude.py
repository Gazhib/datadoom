"""Claude judges call the Messages API through the official Anthropic SDK.

The other providers share the evaluator's httpx client. The SDK brings its own HTTP stack,
retries and stream handling, so each Claude call opens an SDK client for its duration.
"""

import anthropic

from .config import MAX_TIMEOUT_SECONDS
from .errors import EvaluationError
from .providers import DEFAULTS, Completion, Provider


# Recent Claude models think before answering, and thinking shares max_tokens with the grades.
THINKING_TOKENS = 16_000
# The SDK retries rate limits, overloads and dropped connections; the judge timeout still bounds the call.
MAX_RETRIES = 2
TIMEOUT = anthropic.Timeout(MAX_TIMEOUT_SECONDS, connect=3)


def http_client() -> anthropic.DefaultAsyncHttpxClient:
    # Like the evaluator's own client, ignore proxy settings from the environment.
    return anthropic.DefaultAsyncHttpxClient(trust_env=False)


def request(messages: list[dict[str, str]], schema: dict, max_tokens: int) -> dict:
    system, transcript = messages
    return {
        "max_tokens": max_tokens + THINKING_TOKENS,
        # Instructions and checklist repeat across conversations; the transcript follows the cached prefix.
        "system": [{"type": "text", "text": system["content"], "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": transcript["content"]}],
        # The SDK moves constraints the API does not enforce, such as the grade count, into descriptions.
        # validate_grades still checks them.
        "output_config": {"format": {"type": "json_schema", "schema": anthropic.transform_schema(schema)}},
    }


async def complete(provider: Provider, messages: list[dict[str, str]], schema: dict, max_tokens: int) -> Completion:
    base_url = str(provider.endpoint).removesuffix(DEFAULTS["anthropic"].suffix)
    try:
        async with anthropic.AsyncAnthropic(
            api_key=provider.api_key, base_url=base_url, timeout=TIMEOUT, max_retries=MAX_RETRIES,
            http_client=http_client(),
        ) as client:
            # Streaming keeps a long thinking phase from idling out the connection.
            async with client.messages.stream(model=provider.model, **request(messages, schema, max_tokens)) as stream:
                message = await stream.get_final_message()
    except anthropic.APITimeoutError:
        raise EvaluationError(504, "provider_timeout", "Model inference timed out.") from None
    except anthropic.APIConnectionError:
        raise EvaluationError(503, "provider_unavailable", "The selected model server is unavailable.") from None
    except anthropic.AnthropicError:
        raise EvaluationError(502, "provider_error", "The model server could not evaluate the dialogue.") from None
    return read_message(message)


def read_message(message: anthropic.types.Message) -> Completion:
    if not message.model.strip():
        raise EvaluationError(502, "provider_error", "The model server returned an invalid response.")
    content = None
    if message.stop_reason == "end_turn":
        content = "".join(block.text for block in message.content if block.type == "text")
    usage = message.usage
    return Completion(
        model=message.model,
        content=content,
        # Cache writes and reads are still prompt tokens.
        prompt_tokens=usage.input_tokens
        + (usage.cache_creation_input_tokens or 0)
        + (usage.cache_read_input_tokens or 0),
        # Output tokens include thinking; the API does not report it separately.
        completion_tokens=usage.output_tokens,
        truncated=message.stop_reason == "max_tokens",
    )
