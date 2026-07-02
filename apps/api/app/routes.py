"""Phase 2 business HTTP surface: project create/read + workflow transitions.

Request bodies are parsed by hand into plain `str` fields (never pydantic
enum/Literal types) so unknown `scene` / `styleProfileId` / `to` values reach the
domain layer and yield `INVALID_SCENE` / `INVALID_WORKFLOW_STATE` rather than a
framework `INVALID_REQUEST_BODY`. Empty `{}` succeeds; missing / non-JSON bodies
are rejected as `INVALID_REQUEST_BODY`.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from .errors import InvalidRequestBodyError
from .projects import create_project
from .repository import InMemoryRepository, Repository
from .shared_schema_constants import SharedSchemaConstants, load_shared_schema_constants
from .workflow import execute_transition

router = APIRouter(prefix="/api", tags=["projects"])

# Process-memory singletons (Phase 2 has no PostgreSQL/Redis/queue).
_repository: Repository = InMemoryRepository()
_constants: SharedSchemaConstants | None = None


def get_repository() -> Repository:
    return _repository


def get_constants() -> SharedSchemaConstants:
    # Lazily loaded once: the constants bridge spawns a Node subprocess.
    global _constants
    if _constants is None:
        _constants = load_shared_schema_constants()
    return _constants


async def _json_object_body(request: Request) -> dict[str, Any]:
    """Parse the request body as a JSON object.

    Empty / non-JSON / non-object bodies -> `INVALID_REQUEST_BODY`. An empty
    JSON object `{}` is valid and returned as `{}`.
    """

    raw = await request.body()
    if not raw or not raw.strip():
        raise InvalidRequestBodyError("request body must be a JSON object")
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidRequestBodyError("request body must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise InvalidRequestBodyError("request body must be a JSON object")
    return parsed


def _optional_str(body: dict[str, Any], key: str) -> str | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidRequestBodyError(f"{key} must be a string", field=key)
    return value


@router.post("/projects")
async def create_project_route(request: Request) -> dict[str, str]:
    body = await _json_object_body(request)
    project = create_project(
        get_repository(),
        get_constants(),
        title=_optional_str(body, "title"),
        initial_request=_optional_str(body, "initialRequest"),
        scene=_optional_str(body, "scene"),
        style_profile_id=_optional_str(body, "styleProfileId"),
    )
    return {"projectId": project.projectId, "status": project.state}


@router.get("/projects/{project_id}")
async def get_project_route(project_id: str) -> dict[str, str]:
    project = get_repository().get_project(project_id)  # ProjectNotFoundError
    return {
        "projectId": project.projectId,
        "title": project.title,
        "scene": project.scene,
        "styleProfileId": project.styleProfileId,
        "status": project.state,
    }


@router.post("/projects/{project_id}/transitions")
async def create_transition_route(project_id: str, request: Request) -> dict[str, str]:
    # Precedence: body parse (INVALID_REQUEST_BODY) BEFORE project existence
    # (PROJECT_NOT_FOUND) BEFORE target-state validation.
    body = await _json_object_body(request)
    to_state = body.get("to")
    if not isinstance(to_state, str) or not to_state:
        raise InvalidRequestBodyError(
            "request body must include a non-empty 'to' state string", field="to"
        )
    project = execute_transition(get_repository(), get_constants(), project_id, to_state)
    return {"projectId": project.projectId, "status": project.state}
