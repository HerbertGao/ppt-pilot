"""In-memory persistence for Phase 2 project state.

`StoredProject` is a backend state record (ROADMAP "Presentation state model"),
NOT the shared-schema `Presentation` entity — shared-schema has no `Project`
and this group does not add one.

No PostgreSQL/Redis/Celery/RQ/S3/auth: process-memory only. The `Repository`
abstraction keeps a future SQLite/Postgres swap painless.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from .errors import ProjectNotFoundError


@dataclass
class StoredProject:
    projectId: str
    title: str
    initialRequest: str | None
    scene: str
    styleProfileId: str
    state: str
    events: list[dict[str, Any]] = field(default_factory=list)
    # Transient Phase 3 requirement-discovery session (app.agents.DiscoverySession).
    # Typed Any to avoid a layering import of the agent runtime into this low-level
    # store; it never enters shared-schema (design D4).
    discovery: Any = None
    # Confirmed PresentationSpec snapshot (validated dict incl. confirmedByUser).
    # None until confirm; nulled by the REQUIREMENT_REVIEW->REQUIREMENT_DISCOVERY
    # rollback so a stale confirmed spec never survives a profile change.
    spec: Any = None
    # Phase 5 structured artifacts, held as validated dicts (matching `spec`).
    # `outline` carries its own confirmedByUser key; slide plans have no schema-level
    # confirm field, so `slidePlansConfirmed` carries "plans confirmed" at the project
    # level. All nulled/reset by the None-safe rollback clears in execute_transition.
    outline: Any | None = None
    slidePlans: list[Any] | None = None
    slidePlansConfirmed: bool = False
    # Phase 6 materialized Presentation, a validateEntity("Presentation")-normalized
    # dict (matching `outline`/`spec`). None until materialize; nulled by the
    # SLIDE_GENERATION->SLIDE_PLAN_REVIEW rollback so a stale model never survives.
    presentation: Any | None = None


class Repository(ABC):
    @abstractmethod
    def create_project(self, project: StoredProject) -> StoredProject: ...

    @abstractmethod
    def get_project(self, project_id: str) -> StoredProject: ...

    @abstractmethod
    def update_state(self, project_id: str, next_state: str) -> StoredProject: ...

    @abstractmethod
    def append_event(self, project_id: str, event: dict[str, Any]) -> StoredProject: ...

    @abstractmethod
    def list_events(self, project_id: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def commit_state_change(
        self, project_id: str, next_state: str, event: dict[str, Any]
    ) -> StoredProject:
        """Atomically apply a state update AND its event as one pair.

        validate-then-commit-both: the caller (workflow service, group C)
        validates the transition and the event BEFORE calling; this method
        applies both writes together and leaves the stored project untouched
        if it raises. Transitions must go through here rather than calling
        `update_state` + `append_event` separately, so a failure never leaves
        a state change without its event (or vice versa).
        """
        ...


class InMemoryRepository(Repository):
    def __init__(self) -> None:
        self._projects: dict[str, StoredProject] = {}

    def create_project(self, project: StoredProject) -> StoredProject:
        self._projects[project.projectId] = project
        return project

    def get_project(self, project_id: str) -> StoredProject:
        try:
            return self._projects[project_id]
        except KeyError as exc:
            raise ProjectNotFoundError(f"project not found: {project_id}") from exc

    def update_state(self, project_id: str, next_state: str) -> StoredProject:
        project = self.get_project(project_id)
        project.state = next_state
        return project

    def append_event(self, project_id: str, event: dict[str, Any]) -> StoredProject:
        project = self.get_project(project_id)
        project.events.append(event)
        return project

    def list_events(self, project_id: str) -> list[dict[str, Any]]:
        # Read-only: return a copy so callers cannot mutate stored order.
        return list(self.get_project(project_id).events)

    def commit_state_change(
        self, project_id: str, next_state: str, event: dict[str, Any]
    ) -> StoredProject:
        project = self.get_project(project_id)  # raises before any write
        # ponytail: single-process in-memory commit — atomic only under the sync no-await model; add a per-project lock + expected-state CAS when SQLite/concurrency lands (Phase 8+).
        # Both mutations are synchronous and in-memory: nothing can fail
        # between them, so the pair commits atomically.
        project.state = next_state
        project.events.append(event)
        return project
