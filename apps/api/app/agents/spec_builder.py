"""Spec Builder Agent (task 3.6).

Builds a canonical `PresentationSpec` from the discovery session via the LLM,
snapshots the authoritative scene / styleProfileId / questionPolicy / riskNotes
onto the output, then validates through the shared-schema `validateEntity` bridge
(design D2: the Spec is canonical, so it goes through shared-schema — unlike the
transient discovery outputs). Invalid output triggers a bounded repair retry
(<=1); still invalid -> `SpecValidationError`, and nothing is returned/persisted.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..errors import SpecValidationError
from ..llm import LLMProvider
from ..shared_schema_adapter import validate_shared_schema_entity
from .models import MUST_ASK, Answer, DiscoverySession, parse_json_object
from .prompts import DEFAULT_PROMPT_VERSION, load_prompt
from .question import question_id_for

_JSON_RESPONSE_FORMAT: Mapping[str, Any] = {"type": "json_object"}

# Fields the runtime owns authoritatively; the LLM must not set them (any value
# it emits is overwritten by the snapshot before validation).
_SNAPSHOT_KEYS = ("scene", "styleProfileId", "questionPolicy", "riskNotes", "confirmedByUser")


def build_risk_notes(session: DiscoverySession) -> list[str]:
    """Skipped questions + low-confidence signal -> riskNotes (task 3.5/3.6)."""

    notes: list[str] = []
    for question in session.questions:
        if question.questionId in session.skipped:
            notes.append(f"Skipped question '{question.field}': {question.prompt}")
    # A remaining-skip that never materialised as a question is still a risk.
    known_qids = {q.questionId for q in session.questions}
    for qid in session.skipped:
        if qid not in known_qids:
            notes.append(f"Skipped: {qid}")
    # A MUST_ASK gap dropped by the maxQuestions cap has no question at all; it is
    # not covered by the skipped/low-confidence notes above, so itemise it here.
    capped_seen: set[str] = set()
    for gap in session.gaps:
        if (
            gap.classification == MUST_ASK
            and question_id_for(gap.field) not in known_qids
            and gap.field not in capped_seen
        ):
            capped_seen.add(gap.field)
            notes.append(f"Unasked must-ask field '{gap.field}' (capped by maxQuestions)")
    if session.confidence < session.policy.sceneThreshold:
        notes.append(
            f"Low confidence {session.confidence:.2f} below scene threshold "
            f"{session.policy.sceneThreshold:.2f}"
        )
    return notes


def _answers_payload(answers: Mapping[str, Answer]) -> list[dict[str, Any]]:
    return [
        {
            "questionId": ans.questionId,
            "selectedOptions": ans.selectedOptions,
            "freeText": ans.freeText,
        }
        for ans in answers.values()
    ]


def build_spec(
    provider: LLMProvider,
    session: DiscoverySession,
    *,
    model: str | None = None,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
    max_repair: int = 1,
) -> dict[str, Any]:
    """Return a validated (normalized) PresentationSpec dict, or raise.

    Pure with respect to persistence: it never writes to the repository, so a
    raised `SpecValidationError` inherently leaves no half-written state.
    """

    system = load_prompt("spec_builder", prompt_version)
    snapshot: dict[str, Any] = {
        "scene": session.scene,
        "styleProfileId": session.styleProfileId,
        "questionPolicy": session.policy.as_question_policy(),
        "riskNotes": build_risk_notes(session),
        "confirmedByUser": False,
    }
    user_payload = {
        "initialRequest": session.initialRequest or "",
        "known": session.draft.known if session.draft else {},
        "answers": _answers_payload(session.answers),
    }
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
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
            # Authoritative snapshot overwrites anything the model emitted.
            candidate.update(snapshot)
            result = validate_shared_schema_entity("PresentationSpec", candidate)
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
                        + ". Return a corrected PresentationSpec JSON object only."
                    ),
                },
            ]

    raise SpecValidationError(
        "spec builder output invalid after bounded repair: " + "; ".join(last_errors)
    )
