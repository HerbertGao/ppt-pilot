"""Text-only `LLMProvider` boundary for Phase 3 agents (design D2).

The provider surface is deliberately TEXT-ONLY: `generate(...) -> str`. There is
no image / text-to-image method here (that is Phase 9, explicitly out of scope).
Parsing the returned text into structured objects and validating it is the AGENT
layer's job, NOT the provider's.

Three pieces live here:
- `LLMProvider`  — the text interface (a `Protocol`, so nothing is forced to
  subclass it; a class just needs a matching `generate`).
- `MockLLMProvider` — deterministic, programmable; the CI/test/local default.
- `OpenRouterProvider` — real adapter. Model / API key / base URL come from
  config or environment (never hardcoded). Upstream/timeout/HTTP failures map to
  `LLMProviderError` (-> UPSTREAM_ERROR -> 502 via `main.py`).

`build_llm_provider` assembles the provider from config; the default is mock, so
CI never instantiates a real OpenRouter or touches the network.
"""

from __future__ import annotations

import http.client
import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol, runtime_checkable

from ..errors import LLMProviderError

# A chat message, e.g. {"role": "user", "content": "..."}.
Message = Mapping[str, str]

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_TIMEOUT_SECONDS = 30.0


@runtime_checkable
class LLMProvider(Protocol):
    """Text generation is the ONLY capability. No image methods, ever."""

    def generate(
        self,
        messages: Sequence[Message],
        *,
        model: str,
        response_format: Mapping[str, Any] | None = None,
    ) -> str:
        """Return model output as text for the given chat messages."""
        ...


# A programmed mock response: a fixed string, an ordered list of strings, or a
# callable given the full call for full control.
MockScript = str | Sequence[str] | Callable[..., str]


class MockLLMProvider:
    """Deterministic, programmable `LLMProvider` for tests and local default.

    `responses` may be:
    - a `str`: every call returns it;
    - a `Sequence[str]`: returned in order, one per call (raises when exhausted so
      an under-programmed test fails loudly instead of silently repeating);
    - a callable `(messages, *, model, response_format) -> str`: full control.

    Deterministic: identical programming + identical call sequence -> identical
    output. `calls` records every invocation for assertions.
    """

    def __init__(self, responses: MockScript = "") -> None:
        self._responses = responses
        self._index = 0
        self.calls: list[dict[str, Any]] = []

    def generate(
        self,
        messages: Sequence[Message],
        *,
        model: str,
        response_format: Mapping[str, Any] | None = None,
    ) -> str:
        self.calls.append(
            {
                "messages": list(messages),
                "model": model,
                "response_format": response_format,
            }
        )
        responses = self._responses
        if callable(responses):
            return responses(
                messages, model=model, response_format=response_format
            )
        if isinstance(responses, str):
            return responses
        # Ordered sequence: consume one per call.
        if self._index >= len(responses):
            raise IndexError(
                f"MockLLMProvider exhausted after {len(responses)} response(s); "
                f"program more responses"
            )
        value = responses[self._index]
        self._index += 1
        return value


def mock_outline_response(
    messages: Sequence[Message] | None = None,
    *,
    model: str | None = None,
    response_format: Mapping[str, Any] | None = None,
) -> str:
    """Deterministic canned Outline Agent response for CI (no network).

    Returns only `{"sections": [...]}` — the runtime injects `confirmedByUser`.
    Wire it into `MockLLMProvider(mock_outline_response)` (or pass no args to get
    the raw JSON string). Additive: does not change any other agent's mock path or
    the real OpenRouter provider.
    """

    return json.dumps(
        {
            "sections": [
                {
                    "title": "Introduction",
                    "purpose": "Set context and state the goal",
                    "estimatedSlides": 2,
                },
                {
                    "title": "Core Content",
                    "purpose": "Explain the main ideas in order",
                    "estimatedSlides": 3,
                },
                {
                    "title": "Summary",
                    "purpose": "Recap and give a call to action",
                    "estimatedSlides": 1,
                },
            ]
        }
    )


def mock_slide_plan_response(
    messages: Sequence[Message] | None = None,
    *,
    model: str | None = None,
    response_format: Mapping[str, Any] | None = None,
) -> str:
    """Deterministic canned Slide Planner response for CI (no network).

    Reads the confirmed outline out of the user message and emits `estimatedSlides`
    pages per section, section-grouped (so counts match the outline and no mismatch
    riskNote is added by default) — deterministic given the same outline. The runtime
    assigns slideIds and validates. Additive: does not touch `mock_outline_response`
    or the real OpenRouter provider.
    """

    sections: list[dict[str, Any]] = []
    for message in messages or ():
        if message.get("role") != "user":
            continue
        try:
            payload = json.loads(message.get("content", ""))
        except (json.JSONDecodeError, TypeError):
            continue
        outline = payload.get("outline") if isinstance(payload, dict) else None
        if isinstance(outline, dict) and isinstance(outline.get("sections"), list):
            sections = outline["sections"]  # first payload-shaped user msg wins
            break

    out_sections: list[dict[str, Any]] = []
    for section_index, section in enumerate(sections):
        title = section.get("title", f"Section {section_index + 1}")
        count = section.get("estimatedSlides", 1)
        slides = [
            {
                "objective": f"Cover {title} (page {page_index + 1})",
                "keyMessage": f"Key point {page_index + 1} of {title}",
                "contentIntent": f"Explain {title}",
                "visualIntent": "text",
                "layoutSuggestion": "title-and-body",
                "requiredAssets": [],
                "riskNotes": [],
            }
            for page_index in range(count if isinstance(count, int) and count > 0 else 1)
        ]
        out_sections.append({"slides": slides})

    return json.dumps({"sections": out_sections})


class OpenRouterProvider:
    """`LLMProvider` backed by OpenRouter's chat-completions API.

    Credentials/model/base URL are injected (config or env), never hardcoded. A
    request timeout is always set. Missing credentials, timeouts, and upstream /
    HTTP / malformed-response failures all raise `LLMProviderError` (mapped to a
    502 by `main.py`) with no persistent side effect.
    """

    def __init__(
        self,
        *,
        api_key: str | None,
        default_model: str | None = None,
        base_url: str = DEFAULT_OPENROUTER_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        # Fail fast + explicit: a missing key is a configuration error surfaced as
        # the unified upstream-error contract, not a raw KeyError deeper in.
        if not api_key:
            raise LLMProviderError("OpenRouter API key is not configured")
        self._api_key = api_key
        self._default_model = default_model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "OpenRouterProvider":
        """Build from environment/config (`os.environ` by default)."""
        env = os.environ if env is None else env
        timeout_raw = env.get("OPENROUTER_TIMEOUT")
        try:
            timeout = float(timeout_raw) if timeout_raw else DEFAULT_TIMEOUT_SECONDS
        except ValueError as exc:
            raise LLMProviderError("OPENROUTER_TIMEOUT is not a number") from exc
        return cls(
            api_key=env.get("OPENROUTER_API_KEY"),
            # env-configured model wins; "auto" only when unset (agents pass
            # model=None so this default applies).
            default_model=env.get("OPENROUTER_MODEL") or "auto",
            base_url=env.get("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL),
            timeout=timeout,
        )

    def generate(
        self,
        messages: Sequence[Message],
        *,
        model: str | None = None,
        response_format: Mapping[str, Any] | None = None,
    ) -> str:
        effective_model = model or self._default_model
        if not effective_model:
            raise LLMProviderError("OpenRouter model is not configured")

        payload: dict[str, Any] = {
            "model": effective_model,
            "messages": list(messages),
        }
        if response_format is not None:
            payload["response_format"] = response_format

        try:
            request = urllib.request.Request(
                f"{self._base_url}/chat/completions",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=self._timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as exc:  # upstream returned non-2xx
            raise LLMProviderError(
                f"OpenRouter returned HTTP {exc.code}"
            ) from exc
        except (
            urllib.error.URLError,
            http.client.HTTPException,
            TimeoutError,
            OSError,
            ValueError,
        ) as exc:
            # URLError wraps socket.timeout / connection failures; HTTPException
            # (e.g. IncompleteRead from a truncated resp.read()) is NOT an
            # OSError/URLError subclass; TimeoutError / OSError catch the rest;
            # ValueError catches a malformed base_url ("unknown url type"). All
            # are upstream/config failures.
            raise LLMProviderError(f"OpenRouter request failed: {exc}") from exc

        return _extract_text(body)


def _extract_text(body: bytes) -> str:
    """Pull `choices[0].message.content` out of an OpenRouter response body."""
    try:
        data = json.loads(body)
        content = data["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, IndexError, TypeError) as exc:
        raise LLMProviderError("OpenRouter returned an unexpected response") from exc
    if not isinstance(content, str):
        raise LLMProviderError("OpenRouter returned non-string content")
    return content


def build_llm_provider(
    config: Mapping[str, str] | None = None,
) -> LLMProvider:
    """Assemble the configured provider. Default is mock (CI-safe: no network).

    `LLM_PROVIDER` selects the implementation (`mock` default, `openrouter`).
    Only when explicitly set to `openrouter` is a real network adapter built, so
    CI/tests that leave it unset never instantiate `OpenRouterProvider`.
    """
    config = os.environ if config is None else config
    selected = config.get("LLM_PROVIDER", "mock").lower()
    if selected == "mock":
        return MockLLMProvider(config.get("MOCK_LLM_RESPONSE", ""))
    if selected == "openrouter":
        return OpenRouterProvider.from_env(config)
    raise LLMProviderError(f"unknown LLM_PROVIDER: {selected!r}")


__all__ = [
    "LLMProvider",
    "Message",
    "MockLLMProvider",
    "OpenRouterProvider",
    "build_llm_provider",
    "mock_outline_response",
    "mock_slide_plan_response",
]
