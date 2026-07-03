"""Phase 5 outline HTTP service layer (task 4.x), mirroring `requirements.py`.

Thin orchestration over the Outline Agent runtime and the group-B error/event
surface. No-side-effect invariant: every action validates fully (agent output,
then the event) BEFORE any persistent write, so a rejected request leaves the
stored outline and the event sequence untouched.

State vs content preconditions are layered (design D4): a wrong-state call raises
`InvalidStateTransitionError` (409) with its default `field="to"` cleared (it is
meaningless for an action endpoint that has no `to`); `OUTLINE_NOT_CONFIRMABLE`
means only "in OUTLINE_GENERATION but the spec is unconfirmed/None" (None-safe).
Actions never advance the workflow state (nextState == current state).
"""

from __future__ import annotations

from typing import Any

from .agents import build_outline
from .errors import (
    InvalidStateTransitionError,
    OutlineNotConfirmableError,
    OutlineNotFoundError,
    OutlineValidationError,
)
from .events import build_event, validate_event
from .llm import LLMProvider
from .repository import Repository
from .shared_schema_adapter import validate_shared_schema_entity

OUTLINE_GENERATION = "OUTLINE_GENERATION"
OUTLINE_REVIEW = "OUTLINE_REVIEW"


def _wrong_state(message: str) -> InvalidStateTransitionError:
    """Wrong-state action call: reuse InvalidStateTransitionError but clear its
    default `field="to"` (no `to` on an action endpoint). Passing field=None to
    the constructor won't override the class default, so reassign after (see the
    note on the error class)."""

    err = InvalidStateTransitionError(message)
    err.field = None
    return err


def _append_outline_event(
    repository: Repository,
    project: Any,
    project_id: str,
    event_type: str,
    outline: dict[str, Any],
    *,
    actor: str,
) -> None:
    """Build -> validate -> append. Validation raises before any append, so a
    rejected event leaves the sequence untouched (zero persist on failure)."""

    event = build_event(
        project_id,
        event_type,
        {"sectionCount": len(outline["sections"]), "nextState": project.state},
        actor=actor,
    )
    validate_event(event)  # raises before any persistent write
    repository.append_event(project_id, event)


def generate_outline(
    repository: Repository,
    provider: LLMProvider,
    project_id: str,
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Generate + persist the outline (unconfirmed) and append OUTLINE_GENERATED.
    Does not advance the workflow state."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != OUTLINE_GENERATION:
        raise _wrong_state(
            "outline can only be generated while the project is in OUTLINE_GENERATION"
        )
    spec = project.spec
    # None-safe content precondition: never dereference a None spec.
    if not (spec is not None and spec.get("confirmedByUser")):
        raise OutlineNotConfirmableError(
            "spec must be confirmed before generating an outline"
        )

    # build_outline validates inline; invalid -> OutlineValidationError (400),
    # provider transport failure -> LLMProviderError (502). Nothing persisted yet.
    outline = build_outline(provider, spec, model=model)
    outline["confirmedByUser"] = False

    _append_outline_event(
        repository, project, project_id, "OUTLINE_GENERATED", outline, actor="ai"
    )
    project.outline = outline
    return outline


def update_outline(
    repository: Repository,
    project_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Human whole-outline replace/edit. Overwrites `project.outline`, keeps it
    unconfirmed, and appends OUTLINE_UPDATED."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state not in {OUTLINE_GENERATION, OUTLINE_REVIEW}:
        raise _wrong_state(
            "outline can only be edited while the project is in OUTLINE_GENERATION "
            "or OUTLINE_REVIEW"
        )

    result = validate_shared_schema_entity("Outline", body)
    if not result.ok:
        raise OutlineValidationError("; ".join(result.errors) or "outline rejected")
    outline = result.normalized if result.normalized is not None else dict(body)
    # An edit always leaves the outline unconfirmed (re-confirmation required).
    outline["confirmedByUser"] = False

    _append_outline_event(
        repository, project, project_id, "OUTLINE_UPDATED", outline, actor="user"
    )
    project.outline = outline
    return outline


def confirm_outline(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Confirm the outline (set confirmedByUser=True) and append OUTLINE_CONFIRMED.
    Does NOT advance the workflow state (stays OUTLINE_REVIEW). Replay-safe: a
    repeat confirm keeps it confirmed and may append another OUTLINE_CONFIRMED."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != OUTLINE_REVIEW:
        raise _wrong_state(
            "outline can only be confirmed while the project is in OUTLINE_REVIEW"
        )
    outline = project.outline
    if outline is None:
        raise OutlineNotFoundError("no outline to confirm; generate one first")

    # Validate-before-append/zero-persist: append the validated event BEFORE mutating
    # the stored outline (mirrors confirm_slide_plans). The OUTLINE_CONFIRMED payload
    # does not depend on confirmedByUser, so the event is valid either way.
    _append_outline_event(
        repository, project, project_id, "OUTLINE_CONFIRMED", outline, actor="user"
    )
    outline["confirmedByUser"] = True
    return outline


def read_outline(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Read the persisted outline (incl. confirmedByUser); missing -> 404."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    outline = project.outline
    if outline is None:
        raise OutlineNotFoundError("no outline for this project")
    return outline
