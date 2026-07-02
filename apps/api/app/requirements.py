"""Phase 3 requirement-discovery + Spec HTTP service layer (group E).

Thin orchestration over the group-D agent runtime (`app.agents`) and the group-B
error/event surface. It owns NO agent or LLM logic: it calls the agent callables,
snapshots the transient `DiscoverySession` onto `StoredProject.discovery`, and
emits the Phase-3 events (validated by the shared-schema `validateEvent` bridge).

No-side-effect invariant: every action validates fully BEFORE any persistent
write. The transient session is mutated only on a fresh local object (discover)
or after the (pure) agent call succeeds (answer); events are built + validated
before any append, so a rejected request leaves state and events untouched.
"""

from __future__ import annotations

import uuid
from typing import Any

from .agents import (
    Answer,
    DiscoverySession,
    build_spec,
    classify_gaps,
    evaluate_stop,
    generate_questions,
    open_session,
    run_discovery,
)
from .errors import QuestionNotFoundError, SpecNotConfirmableError
from .events import build_event, validate_event
from .llm import LLMProvider
from .projects import resolve_scene_and_style
from .repository import Repository, StoredProject
from .shared_schema_constants import SharedSchemaConstants

REQUIREMENT_REVIEW = "REQUIREMENT_REVIEW"


# --------------------------------------------------------------------------- #
# Views + helpers
# --------------------------------------------------------------------------- #


def _threshold_reached(session: DiscoverySession) -> bool:
    return session.confidence >= session.policy.sceneThreshold


def _question_view(question: Any) -> dict[str, Any]:
    return {
        "questionId": question.questionId,
        "kind": question.kind,
        "prompt": question.prompt,
        "options": question.options,
        "freeTextAllowed": question.freeTextAllowed,
    }


def _session_view(session: DiscoverySession, state: str) -> dict[str, Any]:
    return {
        "confidence": session.confidence,
        "threshold": session.policy.sceneThreshold,
        "thresholdReached": _threshold_reached(session),
        "skippedQuestionIds": list(session.skipped),
        "nextState": state,
    }


def _discovery_context(
    session: DiscoverySession, extra_answer: Answer | None = None
) -> dict[str, Any] | None:
    answers = list(session.answers.values())
    if extra_answer is not None:
        answers.append(extra_answer)
    context: dict[str, Any] = {}
    if session.draft is not None:
        context["known"] = session.draft.known
    if answers:
        context["answers"] = [
            {
                "questionId": a.questionId,
                "selectedOptions": a.selectedOptions,
                "freeText": a.freeText,
            }
            for a in answers
        ]
    return context or None


def _run_discovery_pipeline(
    provider: LLMProvider, session: DiscoverySession
) -> list[Any]:
    """Discovery -> gap -> question over the injected provider (may raise
    LLMProviderError). Mutates only the given session; the caller keeps it
    unattached until events validate, so a failure leaves nothing persisted."""

    draft = run_discovery(
        provider,
        initial_request=session.initialRequest,
        scene=session.scene,
        context=_discovery_context(session),
    )
    session.draft = draft
    session.confidence = draft.confidence
    session.gaps = classify_gaps(provider, draft, scene=session.scene)
    # Cap to maxQuestions (gaps are already MUST_ASK->SHOULD_ASK by scene
    # priority, and generate_questions preserves that order, so a slice keeps the
    # highest-priority questions). Both the returned list and the per-question
    # events discover emits then respect the cap.
    generated = generate_questions(provider, session.gaps)
    session.questions = generated[: session.policy.maxQuestions]
    session.stopReason = evaluate_stop(
        confidence=session.confidence,
        policy=session.policy,
        questions_asked=len(session.questions),
        must_ask_remaining=session.must_ask_remaining(),
        user_skipped_remaining=False,
    )
    session.stopped = session.stopReason is not None
    return session.questions


def _find_question(session: DiscoverySession | None, question_id: str) -> Any:
    if session is None:
        return None
    return next((q for q in session.questions if q.questionId == question_id), None)


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


def discover(
    repository: Repository,
    constants: SharedSchemaConstants,
    provider: LLMProvider,
    project_id: str,
    *,
    mode: str = "fast",
    max_questions: int | None = None,
    scene: str | None = None,
    style_profile_id: str | None = None,
) -> dict[str, Any]:
    """Start/continue requirement discovery. Emits QUESTION_POLICY_APPLIED plus
    one REQUIREMENT_QUESTION_ASKED per generated question (actor=ai)."""

    project = repository.get_project(project_id)  # ProjectNotFoundError

    # scene/styleProfileId are optional: fall back to the project's saved context.
    if scene is None and style_profile_id is None:
        eff_scene, eff_style = project.scene, project.styleProfileId
    else:
        base_scene = scene if scene is not None else project.scene
        # style omitted -> scene default; ownership/scene validated here.
        eff_scene, eff_style = resolve_scene_and_style(
            base_scene, style_profile_id, constants
        )

    # Fresh session (open_session validates mode/overrides -> ValidationError).
    session = open_session(
        constants,
        scene=eff_scene,
        style_profile_id=eff_style,
        initial_request=project.initialRequest,
        mode=mode,
        max_questions_override=max_questions,
    )
    questions = _run_discovery_pipeline(provider, session)

    events = [
        build_event(
            project_id,
            "QUESTION_POLICY_APPLIED",
            {
                "mode": session.policy.mode,
                "sceneThreshold": session.policy.sceneThreshold,
                "maxQuestions": session.policy.maxQuestions,
                "confidence": session.confidence,
                "thresholdReached": _threshold_reached(session),
            },
            actor="ai",
        )
    ]
    for question in questions:
        events.append(
            build_event(
                project_id,
                "REQUIREMENT_QUESTION_ASKED",
                {
                    "questionId": question.questionId,
                    "prompt": question.prompt,
                    "kind": question.kind,
                    "options": question.options,
                    "confidenceBefore": session.confidence,
                },
                actor="ai",
            )
        )
    for event in events:
        validate_event(event)  # raises before any persistent write

    # Commit: attach session + append events only after everything validated.
    project.discovery = session
    for event in events:
        repository.append_event(project_id, event)

    result = _session_view(session, project.state)
    result["questions"] = [_question_view(q) for q in questions]
    return result


def answer(
    repository: Repository,
    constants: SharedSchemaConstants,
    provider: LLMProvider,
    project_id: str,
    question_id: str,
    *,
    answer_text: str | None = None,
    selected_options: list[str] | None = None,
) -> dict[str, Any]:
    """Record an answer and update confidence. No dedicated event type (design
    D3 / event-log): answering only re-scores confidence."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    session = project.discovery
    if _find_question(session, question_id) is None:
        raise QuestionNotFoundError(f"unknown questionId: {question_id!r}")

    new_answer = Answer(
        questionId=question_id,
        selectedOptions=selected_options or [],
        freeText=answer_text,
    )
    # Re-score via the discovery agent with the new answer folded into context.
    # Pure w.r.t. the session until it returns, so a provider failure records
    # nothing (no half-written answer, no confidence change).
    draft = run_discovery(
        provider,
        initial_request=session.initialRequest,
        scene=session.scene,
        context=_discovery_context(session, new_answer),
    )
    session.answers[question_id] = new_answer
    session.draft = draft
    session.confidence = draft.confidence
    return _session_view(session, project.state)


def skip(
    repository: Repository,
    constants: SharedSchemaConstants,
    project_id: str,
    question_id: str,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    """Skip a question: record the risk and append REQUIREMENT_QUESTION_SKIPPED
    (actor=user). No LLM involved."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    session = project.discovery
    question = _find_question(session, question_id)
    if question is None:
        raise QuestionNotFoundError(f"unknown questionId: {question_id!r}")

    risk_note = f"Skipped question '{question.field}': {question.prompt}"
    event = build_event(
        project_id,
        "REQUIREMENT_QUESTION_SKIPPED",
        {
            "questionId": question_id,
            "reason": reason or "user_skipped",
            "confidenceAfter": session.confidence,
            "riskNote": risk_note,
        },
        actor="user",
    )
    validate_event(event)  # raises before any persistent write

    if question_id not in session.skipped:
        session.skipped.append(question_id)
    repository.append_event(project_id, event)
    return _session_view(session, project.state)


def confirm(
    repository: Repository,
    constants: SharedSchemaConstants,
    provider: LLMProvider,
    project_id: str,
) -> dict[str, Any]:
    """Build + validate + confirm the Spec. Sets confirmedByUser=true and appends
    PRESENTATION_SPEC_CONFIRMED; keeps the project in REQUIREMENT_REVIEW (D3)."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != REQUIREMENT_REVIEW:
        raise SpecNotConfirmableError(
            "spec can only be confirmed while the project is in REQUIREMENT_REVIEW"
        )
    session = project.discovery
    if session is None:
        raise SpecNotConfirmableError(
            "no discovery session to confirm; run requirements/discover first"
        )

    # build_spec validates through shared-schema; invalid -> SpecValidationError
    # (no persistent write happens before this returns).
    spec = build_spec(provider, session)
    spec_id = spec.get("id") or f"spec_{uuid.uuid4().hex}"
    spec["id"] = spec_id
    spec["confirmedByUser"] = True

    event = build_event(
        project_id,
        "PRESENTATION_SPEC_CONFIRMED",
        {
            "presentationSpecId": spec_id,
            "scene": spec["scene"],
            "styleProfileId": spec["styleProfileId"],
            "questionPolicy": spec["questionPolicy"],
            "riskNotes": spec.get("riskNotes", []),
            "nextState": REQUIREMENT_REVIEW,
        },
        actor="user",
    )
    validate_event(event)  # raises before any persistent write

    project.spec = spec
    repository.append_event(project_id, event)
    return {
        "presentationSpecId": spec_id,
        "confirmed": True,
        "scene": spec["scene"],
        "styleProfileId": spec["styleProfileId"],
        "questionPolicy": spec["questionPolicy"],
        "riskNotes": spec.get("riskNotes", []),
        "nextState": REQUIREMENT_REVIEW,
    }


def update_profile(
    repository: Repository,
    constants: SharedSchemaConstants,
    project_id: str,
    *,
    scene: str | None = None,
    style_profile_id: str | None = None,
) -> dict[str, Any]:
    """Update scene/styleProfileId and append SCENE_STYLE_PROFILE_UPDATED.

    After confirmation the project must first roll back
    REQUIREMENT_REVIEW -> REQUIREMENT_DISCOVERY (which resets confirmedByUser and
    voids the Spec snapshot); a direct change on a confirmed project is rejected
    with SPEC_NOT_CONFIRMABLE.
    """

    project = repository.get_project(project_id)  # ProjectNotFoundError

    base_scene = scene if scene is not None else project.scene
    # style omitted -> scene default; scene/ownership validated here.
    eff_scene, eff_style = resolve_scene_and_style(base_scene, style_profile_id, constants)

    if project.spec is not None and project.spec.get("confirmedByUser"):
        raise SpecNotConfirmableError(
            "spec is confirmed; roll back REQUIREMENT_REVIEW -> REQUIREMENT_DISCOVERY "
            "before changing the profile"
        )

    event = build_event(
        project_id,
        "SCENE_STYLE_PROFILE_UPDATED",
        {
            "previousScene": project.scene,
            "previousStyleProfileId": project.styleProfileId,
            "scene": eff_scene,
            "styleProfileId": eff_style,
        },
        actor="user",
    )
    validate_event(event)  # raises before any persistent write

    project.scene = eff_scene
    project.styleProfileId = eff_style
    # build_spec snapshots the session's scene/styleProfileId, so a stale session
    # would confirm a spec disagreeing with the changed profile. Void it (and any
    # spec snapshot): a profile change forces re-discovery (confirm then rejects
    # with SPEC_NOT_CONFIRMABLE until a fresh session exists).
    project.discovery = None
    project.spec = None
    repository.append_event(project_id, event)
    return {
        "projectId": project_id,
        "scene": eff_scene,
        "styleProfileId": eff_style,
        "status": project.state,
    }
