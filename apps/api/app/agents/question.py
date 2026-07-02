"""Question Agent (task 3.4).

Turns MUST_ASK / SHOULD_ASK gaps into user-facing questions: multiple choice
with an optional free-text answer. DO_NOT_ASK gaps produce no question.

`questionId` is assigned deterministically in Python (`q_<field>`) so it is
STABLE across regenerations regardless of LLM output — not taken from the model.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from ..errors import LLMProviderError
from ..llm import LLMProvider
from ._generate import generate_validated
from .models import (
    MUST_ASK,
    SHOULD_ASK,
    Gap,
    Question,
    parse_json_object,
)
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}
_ASKABLE = (MUST_ASK, SHOULD_ASK)


def question_id_for(field: str) -> str:
    """Stable questionId derived from the gap field."""

    return f"q_{field}"


def generate_questions(
    provider: LLMProvider,
    gaps: Sequence[Gap],
    *,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
) -> list[Question]:
    askable = [g for g in gaps if g.classification in _ASKABLE]
    if not askable:
        return []

    system = load_prompt("question", prompt_version)
    user_payload = {
        "gaps": [
            {"field": g.field, "classification": g.classification} for g in askable
        ]
    }
    def parse(text: str) -> list[Question]:
        try:
            obj = parse_json_object(text)
            raw_questions = obj["questions"]
            if not isinstance(raw_questions, list):
                raise ValueError("questions must be a list")
        except (ValueError, KeyError, TypeError) as exc:
            raise LLMProviderError(
                f"question agent returned invalid output: {exc}"
            ) from exc

        by_field: dict[str, Any] = {}
        for item in raw_questions:
            if isinstance(item, dict) and "field" in item:
                by_field[str(item["field"])] = item

        questions: list[Question] = []
        for gap in askable:
            raw = by_field.get(gap.field)
            if raw is None:
                # Model produced no question for this askable gap: reject rather
                # than silently drop a MUST_ASK/SHOULD_ASK gap.
                raise LLMProviderError(
                    f"question agent omitted a question for {gap.field!r}"
                )
            opts = raw.get("options")
            options = [str(o) for o in opts] if isinstance(opts, list) else []
            prompt = str(raw.get("prompt") or f"Please provide: {gap.field}")
            free_text_allowed = bool(raw.get("freeTextAllowed", True))
            questions.append(
                Question(
                    questionId=question_id_for(gap.field),
                    field=gap.field,
                    prompt=prompt,
                    options=options,
                    freeTextAllowed=free_text_allowed,
                    kind="multiple_choice" if options else "free_text",
                )
            )
        return questions

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
