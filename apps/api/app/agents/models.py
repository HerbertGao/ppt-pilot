"""Transient requirement-discovery data shapes (design D4).

These are backend session state, NOT shared-schema canonical entities. They are
validated structurally here (plain dataclasses + explicit checks), never through
the shared-schema `validateEntity` bridge — only the final `PresentationSpec`
(spec_builder.py) is canonical and goes through that bridge.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ..shared_schema_constants import SharedSchemaConstants
from .policy import ResolvedPolicy, resolve_question_policy

# Gap classification labels.
MUST_ASK = "MUST_ASK"
SHOULD_ASK = "SHOULD_ASK"
DO_NOT_ASK = "DO_NOT_ASK"
GAP_CLASSES = (MUST_ASK, SHOULD_ASK, DO_NOT_ASK)

_FENCE_OPEN = re.compile(r"^```[a-zA-Z0-9]*\n?")
_FENCE_CLOSE = re.compile(r"\n?```$")


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse an LLM text response into a JSON object.

    Tolerates a single leading/trailing markdown code fence (models love to wrap
    JSON in ```json ... ```). Raises ValueError on anything that is not a JSON
    object so callers map it to the appropriate reject path (no half-write).
    """

    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = _FENCE_OPEN.sub("", stripped)
        stripped = _FENCE_CLOSE.sub("", stripped).strip()
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError(f"expected JSON, got unparseable text: {exc}") from exc
    if not isinstance(obj, dict):
        raise ValueError("expected a JSON object at the top level")
    return obj


@dataclass
class DiscoveryDraft:
    """Extracted known/unknown fields + confidence (transient)."""

    known: dict[str, Any]
    unknowns: list[str]
    confidence: float


@dataclass
class Gap:
    field: str
    classification: str
    priority: int = 0


@dataclass
class Question:
    questionId: str
    field: str
    prompt: str
    options: list[str]
    freeTextAllowed: bool
    kind: str


@dataclass
class Answer:
    questionId: str
    selectedOptions: list[str] = field(default_factory=list)
    freeText: str | None = None


@dataclass
class DiscoverySession:
    """Transient requirement-discovery state hung off `StoredProject`.

    A later HTTP group (E) reads/writes this; it never enters shared-schema.
    """

    scene: str
    styleProfileId: str
    policy: ResolvedPolicy
    initialRequest: str | None = None
    draft: DiscoveryDraft | None = None
    gaps: list[Gap] = field(default_factory=list)
    questions: list[Question] = field(default_factory=list)
    answers: dict[str, Answer] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)
    confidence: float = 0.0
    stopped: bool = False
    stopReason: str | None = None

    def must_ask_remaining(self) -> int:
        """MUST_ASK gaps whose question is neither answered nor skipped."""

        must_ask_fields = {g.field for g in self.gaps if g.classification == MUST_ASK}
        for question in self.questions:
            if question.field not in must_ask_fields:
                continue
            if question.questionId in self.answers or question.questionId in self.skipped:
                must_ask_fields.discard(question.field)
        return len(must_ask_fields)


def open_session(
    constants: SharedSchemaConstants,
    *,
    scene: str,
    style_profile_id: str,
    initial_request: str | None = None,
    mode: str = "fast",
    threshold_override: float | None = None,
    max_questions_override: int | None = None,
) -> DiscoverySession:
    """Create a fresh discovery session with a resolved question policy.

    Convenience for the HTTP group (E) to open a session off a `StoredProject`.
    """

    policy = resolve_question_policy(
        constants,
        scene=scene,
        mode=mode,
        threshold_override=threshold_override,
        max_questions_override=max_questions_override,
    )
    return DiscoverySession(
        scene=scene,
        styleProfileId=style_profile_id,
        policy=policy,
        initialRequest=initial_request,
    )
