"""`WORKFLOW_STATE_CHANGED` event construction + shared-schema validation.

The backend is the sole producer of these events. The action initiator lives ONLY
in the top-level `actor` (never duplicated inside `payload`) — a producer-side
invariant, since `validateEvent` does not reject extra payload keys.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from .shared_schema_adapter import validate_shared_schema_entity

EVENT_TYPE = "WORKFLOW_STATE_CHANGED"


class EventValidationError(RuntimeError):
    """A backend-produced event failed shared-schema validation.

    This signals a backend bug (not user input), so it is not part of the
    domain error contract. It is raised BEFORE any commit, so a failed
    validation leaves state and the event sequence untouched.
    """


def build_event(
    project_id: str,
    event_type: str,
    payload: dict[str, Any],
    *,
    actor: str,
) -> dict[str, Any]:
    """Build any shared-schema `Event`. Action initiator lives ONLY in `actor`."""

    return {
        "id": uuid.uuid4().hex,
        "projectId": project_id,
        "type": event_type,
        "actor": actor,
        "payload": payload,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


def validate_event(event: dict[str, Any]) -> None:
    """Validate any `Event` via shared-schema `validateEvent`.

    Raises `EventValidationError` on failure; the caller must not append.
    """

    result = validate_shared_schema_entity("Event", event)
    if not result.ok:
        raise EventValidationError("; ".join(result.errors) or "event rejected by shared-schema")


def build_state_change_event(
    project_id: str,
    previous_state: str,
    next_state: str,
    *,
    actor: str = "user",
) -> dict[str, Any]:
    """Build an `Event` matching shared-schema for a workflow state change."""

    return {
        "id": uuid.uuid4().hex,
        "projectId": project_id,
        "type": EVENT_TYPE,
        "actor": actor,
        "payload": {"previousState": previous_state, "nextState": next_state},
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


def validate_state_change_event(event: dict[str, Any]) -> None:
    """Validate via shared-schema `validateEvent` (routed through `validateEntity`).

    Raises `EventValidationError` on failure; the caller must not commit.
    """

    result = validate_shared_schema_entity("Event", event)
    if not result.ok:
        raise EventValidationError("; ".join(result.errors) or "event rejected by shared-schema")
