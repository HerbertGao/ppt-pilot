"""Bounded-repair generate helper for the transient agents (llm-provider spec).

The llm-provider spec mandates that *any* validation-failing class triggers a
bounded repair retry (default <=1) before rejection. The canonical Spec Builder
implements this inline (it needs the `validateEntity` bridge + `SpecValidationError`
semantics); the transient discovery/gap/question agents share this helper instead.

`parse(text)` returns the validated transient object or raises `LLMProviderError`
on unusable model output. On the first failure we re-generate once (appending a
short repair hint); if it still fails the last `LLMProviderError` propagates,
mapped to the unified upstream-error contract with no persistent side effect.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypeVar

from ..errors import LLMProviderError
from ..llm import LLMProvider, Message

T = TypeVar("T")

_REPAIR_HINT = (
    "Your previous output was invalid and could not be used. Return a valid JSON "
    "object only, matching the requested shape, with no extra prose."
)


def generate_validated(
    provider: LLMProvider,
    messages: Sequence[Message],
    *,
    model: str | None,
    parse: Callable[[str], T],
    response_format: Mapping[str, Any] | None = None,
    max_repair: int = 1,
) -> T:
    """Generate -> parse/validate with a bounded repair retry (<=1); else raise."""

    convo: list[Message] = list(messages)
    for attempt in range(max_repair + 1):
        text = provider.generate(convo, model=model, response_format=response_format)
        try:
            return parse(text)
        except (LLMProviderError, ValueError, TypeError, KeyError, IndexError) as exc:
            # Any of these means the model output was malformed/unusable — treat it
            # as invalid output eligible for the bounded repair retry, then map to
            # LLMProviderError (->502). AttributeError/NameError etc. are code bugs,
            # NOT caught here, so they still surface as a raw 500.
            if attempt >= max_repair:
                if isinstance(exc, LLMProviderError):
                    raise
                raise LLMProviderError(
                    f"model output could not be parsed: {exc}"
                ) from exc
            convo = [
                *convo,
                {"role": "assistant", "content": text},
                {"role": "user", "content": _REPAIR_HINT},
            ]
    # Unreachable: the loop always returns or raises.
    raise AssertionError("generate_validated exhausted without returning or raising")
