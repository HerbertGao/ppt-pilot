"""Workflow state machine: pure transition validation + a commit orchestrator.

No Agent or LLM is ever touched here — transitions only move structured state.
The *known state set* (which strings are recognised) is decoupled from the
*executable edge table* (which transitions Phase 2 actually drives).
"""

from __future__ import annotations

from .errors import InvalidStateTransitionError, InvalidWorkflowStateError
from .events import build_state_change_event, validate_state_change_event
from .repository import Repository, StoredProject
from .shared_schema_constants import SharedSchemaConstants

# Legal adjacency edges — structural only, content-free (no Agent/LLM here).
# Phase 2: NEW_PROJECT -> REQUIREMENT_DISCOVERY -> REQUIREMENT_REVIEW (+ rollback).
# Phase 5 adds the outline/slide-planning forward chain and its rollbacks. Edges
# carry NO content guard: "transition-only, no generate" can reach an empty-artifact
# state, which is reachable but inert — action endpoints guard their own content
# preconditions and rollbacks clear downstream None-safe (design D4/D5).
#
# ponytail: EDITING/REVIEW edges are still owned by Phase 8 — SLIDE_GENERATION
# jumps straight to EXPORT_READY, skipping them until that content logic lands.
TRANSITION_EDGES: dict[str, set[str]] = {
    "NEW_PROJECT": {"REQUIREMENT_DISCOVERY"},
    "REQUIREMENT_DISCOVERY": {"REQUIREMENT_REVIEW"},
    "REQUIREMENT_REVIEW": {"REQUIREMENT_DISCOVERY", "OUTLINE_GENERATION"},
    "OUTLINE_GENERATION": {"OUTLINE_REVIEW", "REQUIREMENT_REVIEW"},
    "OUTLINE_REVIEW": {"SLIDE_PLANNING", "OUTLINE_GENERATION"},
    "SLIDE_PLANNING": {"SLIDE_PLAN_REVIEW", "OUTLINE_REVIEW"},
    "SLIDE_PLAN_REVIEW": {"SLIDE_PLANNING", "SLIDE_GENERATION"},
    "SLIDE_GENERATION": {"SLIDE_PLAN_REVIEW", "EXPORT_READY"},
    "EXPORT_READY": {"SLIDE_GENERATION", "EXPORTED"},
    "EXPORTED": {"EXPORT_READY"},
}


def backend_known_states(constants: SharedSchemaConstants) -> frozenset[str]:
    """Backend's recognised workflow-state set, derived from the shared-schema
    constants bridge (never hand-copied). Decoupled from `TRANSITION_EDGES`."""

    return frozenset(constants.workflow_states)


def assert_state_machine_consistent(constants: SharedSchemaConstants) -> None:
    """Assert the edge table only references known states (edges are a subset
    of the shared-schema-derived known set)."""

    known = backend_known_states(constants)
    edge_states = set(TRANSITION_EDGES) | {
        target for targets in TRANSITION_EDGES.values() for target in targets
    }
    unknown = edge_states - known
    assert not unknown, f"edge table references non-WORKFLOW_STATES: {sorted(unknown)}"


def validate_transition(
    from_state: str, to_state: str, known_states: frozenset[str]
) -> None:
    """Pure transition check (no mutation, no Agent/LLM).

    - `to_state` not in `known_states` -> `InvalidWorkflowStateError`.
    - known state but `(from_state, to_state)` not a Phase 2 edge
      -> `InvalidStateTransitionError`.
    """

    if to_state not in known_states:
        raise InvalidWorkflowStateError(f"unknown workflow state: {to_state!r}")
    if to_state not in TRANSITION_EDGES.get(from_state, set()):
        raise InvalidStateTransitionError(
            f"illegal transition {from_state!r} -> {to_state!r}"
        )


def execute_transition(
    repository: Repository,
    constants: SharedSchemaConstants,
    project_id: str,
    to_state: str,
    *,
    actor: str = "user",
) -> StoredProject:
    """Validate-then-commit a transition; commits nothing on any failure.

    Order enforces the error precedence: project existence (`ProjectNotFound`)
    before target-state validation. The event is built and validated before the
    atomic `commit_state_change`, so a rejected action leaves state + events
    untouched.
    """

    project = repository.get_project(project_id)  # ProjectNotFoundError
    from_state = project.state
    validate_transition(from_state, to_state, backend_known_states(constants))
    event = build_state_change_event(project_id, from_state, to_state, actor=actor)
    validate_state_change_event(event)  # raises before any write
    result = repository.commit_state_change(project_id, to_state, event)
    _clear_downstream_on_rollback(result, from_state, to_state)
    return result


def _clear_downstream_on_rollback(
    project: StoredProject, from_state: str, to_state: str
) -> None:
    """None-safe post-commit clear of downstream artifacts on a rollback edge.

    Attribute writes on the same in-memory object (like the Phase 2 spec=None),
    only sound under the sync/in-memory model — NOT carried atomically by
    commit_state_change. Every clear is None-safe: an already-None artifact is a
    no-op, never dereferenced (design D5).
    """

    edge = (from_state, to_state)
    if edge == ("REQUIREMENT_REVIEW", "REQUIREMENT_DISCOVERY"):
        # Phase 2/3: rolling out of REVIEW invalidates the confirmed Spec snapshot.
        project.spec = None
    elif edge == ("OUTLINE_GENERATION", "REQUIREMENT_REVIEW"):
        project.outline = None
        project.slidePlans = None
        project.slidePlansConfirmed = False
    elif edge == ("OUTLINE_REVIEW", "OUTLINE_GENERATION"):
        if project.outline is not None:
            project.outline["confirmedByUser"] = False
        project.slidePlans = None
        project.slidePlansConfirmed = False
    elif edge == ("SLIDE_PLANNING", "OUTLINE_REVIEW"):
        project.slidePlans = None
        project.slidePlansConfirmed = False
    elif edge == ("SLIDE_PLAN_REVIEW", "SLIDE_PLANNING"):
        # Keep plans (regenerate overwrites); just void the confirmation.
        project.slidePlansConfirmed = False
    elif edge == ("SLIDE_GENERATION", "SLIDE_PLAN_REVIEW"):
        # Void the materialized presentation so re-materialize starts fresh; keep
        # the confirmed plans (rolling back the presentation does not void them).
        project.presentation = None
    # EXPORT_READY->SLIDE_GENERATION and EXPORTED->EXPORT_READY intentionally have
    # no branch: export-stage rollback is pure state, non-destructive. exports is an
    # append-only history of self-contained artifacts and presentation is untouched
    # by export, so both are retained (design D10) — the missing branch is the no-op.
