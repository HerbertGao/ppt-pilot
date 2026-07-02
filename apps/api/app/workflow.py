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

# Phase 2 legal adjacency edges — only early, content-free transitions:
# forward NEW_PROJECT -> REQUIREMENT_DISCOVERY -> REQUIREMENT_REVIEW, plus the
# manual rollback REQUIREMENT_REVIEW -> REQUIREMENT_DISCOVERY.
#
# ponytail: OUTLINE_GENERATION and every later edge are deliberately absent.
# Their prerequisite content (outline / slide plans / slides) is owned by
# Phase 3+/5+; the owning phase adds its edges when it implements that content
# logic. Driving them now would fabricate content-less "impossible" states.
TRANSITION_EDGES: dict[str, set[str]] = {
    "NEW_PROJECT": {"REQUIREMENT_DISCOVERY"},
    "REQUIREMENT_DISCOVERY": {"REQUIREMENT_REVIEW"},
    "REQUIREMENT_REVIEW": {"REQUIREMENT_DISCOVERY"},
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
    validate_transition(project.state, to_state, backend_known_states(constants))
    event = build_state_change_event(project_id, project.state, to_state, actor=actor)
    validate_state_change_event(event)  # raises before any write
    return repository.commit_state_change(project_id, to_state, event)
