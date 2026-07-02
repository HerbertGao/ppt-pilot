"""Requirement Gap Agent (task 3.3).

Classifies unknown fields into MUST_ASK / SHOULD_ASK / DO_NOT_ASK via the LLM,
then applies a deterministic, scene-aware priority ordering in Python (so the
ordering is stable and testable regardless of LLM output order):
- education prioritises audience age / engagement / interactivity
- corporate prioritises decision goal / report duration / risk boundary
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..errors import LLMProviderError
from ..llm import LLMProvider
from ._generate import generate_validated
from .models import GAP_CLASSES, DiscoveryDraft, Gap, parse_json_object
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}

# Scene-priority field groups. Higher index in the list -> higher priority.
# Fields not listed get priority 0 (still ordered after prioritised ones).
_SCENE_PRIORITY_FIELDS: dict[str, tuple[str, ...]] = {
    "education": ("interactivity", "engagement", "audienceAge", "audience"),
    "corporate": ("riskBoundary", "durationMinutes", "purpose"),
}

_CLASS_ORDER = {"MUST_ASK": 0, "SHOULD_ASK": 1, "DO_NOT_ASK": 2}


def _scene_priority(scene: str, field: str) -> int:
    fields = _SCENE_PRIORITY_FIELDS.get(scene, ())
    # index+1 so a matched field always outranks priority 0 (unlisted).
    return fields.index(field) + 1 if field in fields else 0


def classify_gaps(
    provider: LLMProvider,
    draft: DiscoveryDraft,
    *,
    scene: str,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
) -> list[Gap]:
    if not draft.unknowns:
        return []

    system = load_prompt("requirement_gap", prompt_version)
    user_payload = {
        "scene": scene,
        "known": sorted(draft.known.keys()),
        "unknowns": draft.unknowns,
    }
    def parse(text: str) -> list[Gap]:
        try:
            obj = parse_json_object(text)
            raw_gaps = obj["gaps"]
            if not isinstance(raw_gaps, list):
                raise ValueError("gaps must be a list")
        except (ValueError, KeyError, TypeError) as exc:
            raise LLMProviderError(f"gap agent returned invalid output: {exc}") from exc

        gaps: list[Gap] = []
        for item in raw_gaps:
            try:
                field = str(item["field"])
                classification = str(item["classification"])
            except (KeyError, TypeError) as exc:
                raise LLMProviderError(
                    f"gap entry missing field/classification: {exc}"
                ) from exc
            if classification not in GAP_CLASSES:
                raise LLMProviderError(f"invalid gap classification: {classification!r}")
            gaps.append(
                Gap(
                    field=field,
                    classification=classification,
                    priority=_scene_priority(scene, field),
                )
            )

        # MUST_ASK first, then SHOULD_ASK, DO_NOT_ASK last; within a class, higher
        # scene priority first, then field name for a stable tiebreak.
        gaps.sort(key=lambda g: (_CLASS_ORDER[g.classification], -g.priority, g.field))
        return gaps

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
