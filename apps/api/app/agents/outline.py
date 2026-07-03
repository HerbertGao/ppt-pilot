"""Outline Agent (task 3.1/3.2).

Builds a canonical `Outline` from a confirmed `PresentationSpec` via the LLM text
interface, then validates through the shared-schema `validateEntity` bridge.

This mirrors `spec_builder.py::build_spec`'s OWN bounded-repair loop (it does NOT
use `agents/_generate.generate_validated`): the loop injects the runtime-owned
`confirmedByUser=False` onto the candidate (mirroring build_spec's
`candidate.update(snapshot)`) and validates the FULL `Outline` inline. Exhausted
invalidity -> `OutlineValidationError` (-> 400). Provider transport exceptions
raised by `provider.generate` propagate out as `LLMProviderError` (-> 502); the
loop only retries validation failures, so the two error paths never cross.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..errors import OutlineValidationError
from ..llm import LLMProvider
from ..shared_schema_adapter import validate_shared_schema_entity
from .models import parse_json_object
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}

# Fields the runtime owns authoritatively; whatever the model emits is overwritten
# before validation (mirrors build_spec's snapshot).
_SNAPSHOT: dict[str, Any] = {"confirmedByUser": False}


def build_outline(
    provider: LLMProvider,
    spec: Mapping[str, Any],
    *,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
    max_repair: int = 1,
) -> dict[str, Any]:
    """Return a validated (normalized) `Outline` dict, or raise.

    Pure with respect to persistence: it never writes to the repository, so a
    raised `OutlineValidationError` inherently leaves no half-written state. A
    provider transport failure propagates as `LLMProviderError`.
    """

    system = load_prompt("outline", prompt_version)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(dict(spec), ensure_ascii=False)},
    ]

    last_errors: tuple[str, ...] = ("no attempt made",)
    for attempt in range(max_repair + 1):
        text = provider.generate(
            messages, model=model, response_format=_JSON_RESPONSE_FORMAT
        )
        try:
            candidate = parse_json_object(text)
        except ValueError as exc:
            last_errors = (f"unparseable JSON: {exc}",)
        else:
            # Authoritative snapshot overwrites anything the model emitted; the
            # full Outline (with required confirmedByUser) is what gets validated.
            candidate.update(_SNAPSHOT)
            result = validate_shared_schema_entity("Outline", candidate)
            if result.ok:
                return result.normalized if result.normalized is not None else candidate
            last_errors = result.errors

        if attempt < max_repair:
            messages = [
                *messages,
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": (
                        "Your previous output was rejected: "
                        + "; ".join(last_errors)
                        + ". Return a corrected outline JSON object only."
                    ),
                },
            ]

    raise OutlineValidationError(
        "outline agent output invalid after bounded repair: " + "; ".join(last_errors)
    )
