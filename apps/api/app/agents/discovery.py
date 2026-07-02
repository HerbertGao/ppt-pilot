"""Requirement Discovery Agent (task 3.2).

Extracts known/unknown fields + a confidence score from the initial request,
through the injected `LLMProvider` text interface. The parsed result is a
transient `DiscoveryDraft` (structural check only, never shared-schema).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..errors import LLMProviderError
from ..llm import LLMProvider
from ._generate import generate_validated
from .models import DiscoveryDraft, parse_json_object
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}


def run_discovery(
    provider: LLMProvider,
    *,
    initial_request: str | None,
    scene: str,
    context: Mapping[str, Any] | None = None,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
) -> DiscoveryDraft:
    system = load_prompt("requirement_discovery", prompt_version)
    user_payload: dict[str, Any] = {
        "initialRequest": initial_request or "",
        "scene": scene,
    }
    if context:
        user_payload["context"] = dict(context)

    def parse(text: str) -> DiscoveryDraft:
        try:
            obj = parse_json_object(text)
            known_raw = obj.get("known") or {}
            unknowns_raw = obj.get("unknowns") or []
            if not isinstance(known_raw, dict) or not isinstance(unknowns_raw, list):
                raise ValueError("known must be an object and unknowns a list")
            confidence = float(obj["confidence"])
        except (ValueError, KeyError, TypeError) as exc:
            # Model returned unusable output -> reject as an upstream failure with
            # no side effect (caller persists nothing).
            raise LLMProviderError(
                f"discovery agent returned invalid output: {exc}"
            ) from exc

        if not 0.0 <= confidence <= 1.0:
            raise LLMProviderError(
                f"discovery confidence out of range [0, 1]: {confidence}"
            )

        return DiscoveryDraft(
            known=dict(known_raw),
            unknowns=[str(item) for item in unknowns_raw],
            confidence=confidence,
        )

    # Bounded repair retry (<=1) before rejection, per the llm-provider spec.
    return generate_validated(
        provider,
        [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        model=model,
        parse=parse,
        response_format=_JSON_RESPONSE_FORMAT,
    )
