"""Phase 2 business HTTP surface: project create/read + workflow transitions.

Request bodies are parsed by hand into plain `str` fields (never pydantic
enum/Literal types) so unknown `scene` / `styleProfileId` / `to` values reach the
domain layer and yield `INVALID_SCENE` / `INVALID_WORKFLOW_STATE` rather than a
framework `INVALID_REQUEST_BODY`. Empty `{}` succeeds; missing / non-JSON bodies
are rejected as `INVALID_REQUEST_BODY`.
"""

from __future__ import annotations

import base64
import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import Response

from .errors import InvalidRequestBodyError
from .config import load_env
from .export import (
    artifact_metadata,
    export,
    list_exports,
    read_export,
)
from .llm import LLMProvider, build_llm_provider
from .outline import (
    confirm_outline,
    generate_outline,
    read_outline,
    update_outline,
)
from .presentation import materialize, read_presentation
from .projects import create_project
from .repository import InMemoryRepository, Repository
from .requirements import answer, confirm, discover, skip, update_profile
from .slide_plan import (
    confirm_slide_plans,
    generate_slide_plans,
    read_slide_plans,
    update_slide_plan,
)
from .shared_schema_constants import SharedSchemaConstants, load_shared_schema_constants
from .workflow import execute_transition

router = APIRouter(prefix="/api", tags=["projects"])

# Process-memory singletons (Phase 2 has no PostgreSQL/Redis/queue).
_repository: Repository = InMemoryRepository()
_constants: SharedSchemaConstants | None = None
_llm_provider: LLMProvider | None = None


def get_repository() -> Repository:
    return _repository


def get_constants() -> SharedSchemaConstants:
    # Lazily loaded once: the constants bridge spawns a Node subprocess.
    global _constants
    if _constants is None:
        _constants = load_shared_schema_constants()
    return _constants


def get_llm_provider() -> LLMProvider:
    # Lazy singleton; default is the CI-safe MockLLMProvider (no network).
    global _llm_provider
    if _llm_provider is None:
        load_env()  # populate os.environ from the repo-root .env (real runs)
        _llm_provider = build_llm_provider()
    return _llm_provider


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


async def _json_object_body_lenient(request: Request) -> dict[str, Any]:
    """Like `_json_object_body` but an empty body means `{}` (all fields optional
    on the requirement/profile endpoints). Malformed / non-object bodies still
    reject as `INVALID_REQUEST_BODY`, preserving the body-parse precedence."""

    raw = await request.body()
    if not raw or not raw.strip():
        return {}
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


def _optional_int(body: dict[str, Any], key: str) -> int | None:
    value = body.get(key)
    if value is None:
        return None
    # bool is an int subclass; reject it explicitly.
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidRequestBodyError(f"{key} must be an integer", field=key)
    return value


def _optional_str_list(body: dict[str, Any], key: str) -> list[str] | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise InvalidRequestBodyError(f"{key} must be an array of strings", field=key)
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


# --------------------------------------------------------------------------- #
# Phase 3 requirement/Spec surface (group E). Body parse precedes project
# existence which precedes domain validation; any rejection has no side effect.
# --------------------------------------------------------------------------- #


@router.post("/projects/{project_id}/requirements/discover")
async def discover_route(project_id: str, request: Request) -> dict[str, Any]:
    body = await _json_object_body_lenient(request)
    mode = _optional_str(body, "mode") or "fast"
    return discover(
        get_repository(),
        get_constants(),
        get_llm_provider(),
        project_id,
        mode=mode,
        max_questions=_optional_int(body, "maxQuestions"),
        scene=_optional_str(body, "scene"),
        style_profile_id=_optional_str(body, "styleProfileId"),
    )


@router.post("/projects/{project_id}/requirements/questions/{question_id}/answer")
async def answer_route(
    project_id: str, question_id: str, request: Request
) -> dict[str, Any]:
    body = await _json_object_body_lenient(request)
    return answer(
        get_repository(),
        get_constants(),
        get_llm_provider(),
        project_id,
        question_id,
        answer_text=_optional_str(body, "answer"),
        selected_options=_optional_str_list(body, "selectedOptions"),
    )


@router.post("/projects/{project_id}/requirements/questions/{question_id}/skip")
async def skip_route(
    project_id: str, question_id: str, request: Request
) -> dict[str, Any]:
    body = await _json_object_body_lenient(request)
    return skip(
        get_repository(),
        get_constants(),
        project_id,
        question_id,
        reason=_optional_str(body, "reason"),
    )


@router.post("/projects/{project_id}/requirements/confirm")
async def confirm_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)  # parse precedes existence/domain
    return confirm(get_repository(), get_constants(), get_llm_provider(), project_id)


@router.patch("/projects/{project_id}/profile")
async def update_profile_route(project_id: str, request: Request) -> dict[str, Any]:
    body = await _json_object_body_lenient(request)
    return update_profile(
        get_repository(),
        get_constants(),
        project_id,
        scene=_optional_str(body, "scene"),
        style_profile_id=_optional_str(body, "styleProfileId"),
    )


# --------------------------------------------------------------------------- #
# Phase 5 outline surface. Action endpoints never advance state (explicit
# /transitions do). Any rejection has no side effect (validate-before-persist).
# --------------------------------------------------------------------------- #


@router.post("/projects/{project_id}/outline/generate")
async def outline_generate_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)  # parse precedes existence/domain
    return generate_outline(get_repository(), get_llm_provider(), project_id)


@router.put("/projects/{project_id}/outline")
async def outline_update_route(project_id: str, request: Request) -> dict[str, Any]:
    # The whole body IS the Outline object; a non-object/empty body rejects as
    # INVALID_REQUEST_BODY before the domain layer.
    body = await _json_object_body(request)
    return update_outline(get_repository(), project_id, body)


@router.post("/projects/{project_id}/outline/confirm")
async def outline_confirm_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)
    return confirm_outline(get_repository(), project_id)


@router.get("/projects/{project_id}/outline")
async def outline_get_route(project_id: str) -> dict[str, Any]:
    return read_outline(get_repository(), project_id)


# --------------------------------------------------------------------------- #
# Phase 5 slide-plan surface. Action endpoints never advance state; the service
# assigns/owns slideIds. Any rejection has no side effect (validate-before-persist).
# --------------------------------------------------------------------------- #


@router.post("/projects/{project_id}/slides/plans/generate")
async def slide_plans_generate_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)  # parse precedes existence/domain
    return generate_slide_plans(
        get_repository(),
        get_llm_provider(),
        project_id,
        max_total_slides=get_constants().max_total_slide_plans,
    )


@router.put("/projects/{project_id}/slides/{slide_id}/plan")
async def slide_plan_update_route(
    project_id: str, slide_id: str, request: Request
) -> dict[str, Any]:
    # The whole body IS the SlidePlan object; a non-object/empty body rejects as
    # INVALID_REQUEST_BODY before the domain layer.
    body = await _json_object_body(request)
    return update_slide_plan(get_repository(), project_id, slide_id, body)


@router.post("/projects/{project_id}/slides/plans/confirm")
async def slide_plans_confirm_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)
    return confirm_slide_plans(get_repository(), project_id)


@router.get("/projects/{project_id}/slides/plans")
async def slide_plans_get_route(project_id: str) -> dict[str, Any]:
    return read_slide_plans(get_repository(), project_id)


# --------------------------------------------------------------------------- #
# Phase 6 slide-materialization surface. Deterministic + LLM-free; the action
# never advances state. Any rejection has no side effect (validate-before-persist).
# --------------------------------------------------------------------------- #


@router.post("/projects/{project_id}/slides/materialize")
async def slides_materialize_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)  # parse precedes existence/domain
    return materialize(get_repository(), project_id)


@router.get("/projects/{project_id}/presentation")
async def presentation_get_route(project_id: str) -> dict[str, Any]:
    return read_presentation(get_repository(), project_id)


# --------------------------------------------------------------------------- #
# Phase 7 PPTX-export surface. Deterministic + LLM-free; the action never advances
# state (only /transitions does). Any rejection has no side effect (validate-
# before-persist). The list/POST responses expose metadata only — never the
# unbounded `bytesBase64`, which is served solely by the single-item download.
# --------------------------------------------------------------------------- #

_PPTX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


@router.post("/projects/{project_id}/export")
async def export_route(project_id: str, request: Request) -> dict[str, Any]:
    await _json_object_body_lenient(request)  # parse precedes existence/domain
    artifact = export(get_repository(), project_id)
    return artifact_metadata(artifact)


@router.get("/projects/{project_id}/export/{artifact_id}")
async def export_download_route(project_id: str, artifact_id: str) -> Response:
    artifact = read_export(get_repository(), project_id, artifact_id)
    raw = base64.b64decode(artifact["bytesBase64"])
    return Response(
        content=raw,
        media_type=_PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{artifact_id}.pptx"'},
    )


@router.get("/projects/{project_id}/exports")
async def exports_list_route(project_id: str) -> dict[str, Any]:
    return {"exports": list_exports(get_repository(), project_id)}
