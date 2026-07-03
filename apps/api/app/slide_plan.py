"""Phase 5 slide-plan HTTP service layer (task 6.x), mirroring `outline.py`.

Thin orchestration over the Slide Planner Agent runtime and the group error/event
surface. No-side-effect invariant: every action validates fully (agent output, then
the event) BEFORE any persistent write, so a rejected request leaves the stored
plans and the event sequence untouched.

State vs content preconditions are layered (design D4): a wrong-state call raises
`InvalidStateTransitionError` (409) with its default `field="to"` cleared;
`SLIDE_PLAN_NOT_CONFIRMABLE` means only "in SLIDE_PLANNING but the outline is
unconfirmed/None" (None-safe, dict access). `slideId` is runtime-owned: the agent
assigns deterministic ids on generate, and `update` FORCES the path id (ignoring any
body id) then rechecks set uniqueness. Actions never advance the workflow state
(nextState == current state); confirm leaves the project in SLIDE_PLAN_REVIEW.
"""

from __future__ import annotations

from typing import Any

from .agents import plan_slides
from .errors import (
    InvalidStateTransitionError,
    SlidePlanNotConfirmableError,
    SlidePlanNotFoundError,
    SlidePlanValidationError,
)
from .events import build_event, validate_event
from .llm import LLMProvider
from .repository import Repository
from .shared_schema_adapter import validate_shared_schema_entity

SLIDE_PLANNING = "SLIDE_PLANNING"
SLIDE_PLAN_REVIEW = "SLIDE_PLAN_REVIEW"


def _wrong_state(message: str) -> InvalidStateTransitionError:
    """Wrong-state action call: reuse InvalidStateTransitionError but clear its
    default `field="to"` (no `to` on an action endpoint)."""

    err = InvalidStateTransitionError(message)
    err.field = None
    return err


def _read_payload(project: Any) -> dict[str, Any]:
    """The read shape shared by generate/update/confirm/GET responses."""

    return {
        "slidePlans": project.slidePlans or [],
        "slidePlansConfirmed": project.slidePlansConfirmed,
    }


def _append_event(
    repository: Repository,
    project_id: str,
    event_type: str,
    payload: dict[str, Any],
    *,
    actor: str,
) -> None:
    """Build -> validate -> append. Validation raises before any append, so a
    rejected event leaves the sequence untouched (zero persist on failure)."""

    event = build_event(project_id, event_type, payload, actor=actor)
    validate_event(event)  # raises before any persistent write
    repository.append_event(project_id, event)


def generate_slide_plans(
    repository: Repository,
    provider: LLMProvider,
    project_id: str,
    *,
    max_total_slides: int,
    model: str | None = None,
) -> dict[str, Any]:
    """Generate + persist per-page plans (overwriting any prior set) and append
    SLIDE_PLAN_GENERATED. Regeneration explicitly discards prior PUT edits and
    resets `slidePlansConfirmed=False`. Does not advance the workflow state."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != SLIDE_PLANNING:
        raise _wrong_state(
            "slide plans can only be generated while the project is in SLIDE_PLANNING"
        )
    outline = project.outline
    # None-safe content precondition (dict access): never dereference a None outline.
    if not (outline is not None and outline.get("confirmedByUser")):
        raise SlidePlanNotConfirmableError(
            "outline must be confirmed before generating slide plans"
        )

    # plan_slides validates inline + assigns deterministic slideIds; invalid ->
    # SlidePlanValidationError (400), provider transport failure -> LLMProviderError
    # (502). Nothing persisted yet.
    plans = plan_slides(
        provider,
        outline,
        project.spec or {},
        max_total_slides=max_total_slides,
        model=model,
    )

    _append_event(
        repository,
        project_id,
        "SLIDE_PLAN_GENERATED",
        {
            "slideCount": len(plans),
            "slideIds": [p["slideId"] for p in plans],
            "nextState": project.state,
        },
        actor="ai",
    )
    # Whole-set overwrite; regeneration voids any prior confirmation/edits.
    project.slidePlans = plans
    project.slidePlansConfirmed = False
    return _read_payload(project)


def update_slide_plan(
    repository: Repository,
    project_id: str,
    slide_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Human single-page edit. Forces the plan's slideId to the PATH value (ignoring
    any body slideId), rechecks set-level uniqueness, overwrites the page, resets
    `slidePlansConfirmed=False`, and appends SLIDE_PLAN_UPDATED."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state not in {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}:
        raise _wrong_state(
            "slide plans can only be edited while the project is in SLIDE_PLANNING "
            "or SLIDE_PLAN_REVIEW"
        )

    plans = project.slidePlans
    index = _index_of(plans, slide_id)
    if index is None:
        raise SlidePlanNotFoundError(f"no slide plan with slideId {slide_id!r}")

    result = validate_shared_schema_entity("SlidePlan", body)
    if not result.ok:
        raise SlidePlanValidationError("; ".join(result.errors) or "slide plan rejected")
    plan = result.normalized if result.normalized is not None else dict(body)
    # FORCE the path slideId; the client must not change a server-owned id via body.
    plan["slideId"] = slide_id

    # Recheck set-level uniqueness after the overwrite (defensive: forcing the path
    # id onto the page it replaces preserves uniqueness, but never assume it).
    ids = [slide_id if i == index else p.get("slideId") for i, p in enumerate(plans)]
    if len(set(ids)) != len(ids):
        raise SlidePlanValidationError("slideIds would not be unique after the edit")

    _append_event(
        repository,
        project_id,
        "SLIDE_PLAN_UPDATED",
        {"slideId": slide_id, "nextState": project.state},
        actor="user",
    )
    plans[index] = plan
    project.slidePlansConfirmed = False
    return _read_payload(project)


def confirm_slide_plans(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Confirm the plans (set slidePlansConfirmed=True) and append
    SLIDE_PLAN_CONFIRMED. Does NOT advance the workflow state (stays
    SLIDE_PLAN_REVIEW, the Phase 5 terminal state). Replay-safe: a repeat confirm
    keeps it confirmed and may append another SLIDE_PLAN_CONFIRMED."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if project.state != SLIDE_PLAN_REVIEW:
        raise _wrong_state(
            "slide plans can only be confirmed while the project is in SLIDE_PLAN_REVIEW"
        )
    plans = project.slidePlans
    if not plans:  # None or empty
        raise SlidePlanNotFoundError("no slide plans to confirm; generate them first")

    _append_event(
        repository,
        project_id,
        "SLIDE_PLAN_CONFIRMED",
        {"slideCount": len(plans), "nextState": project.state},
        actor="user",
    )
    project.slidePlansConfirmed = True
    return _read_payload(project)


def read_slide_plans(
    repository: Repository,
    project_id: str,
) -> dict[str, Any]:
    """Read the persisted plans (incl. slidePlansConfirmed); missing/empty -> 404."""

    project = repository.get_project(project_id)  # ProjectNotFoundError
    if not project.slidePlans:  # None or empty
        raise SlidePlanNotFoundError("no slide plans for this project")
    return _read_payload(project)


def _index_of(plans: list[Any] | None, slide_id: str) -> int | None:
    if not plans:
        return None
    for index, plan in enumerate(plans):
        if isinstance(plan, dict) and plan.get("slideId") == slide_id:
            return index
    return None
