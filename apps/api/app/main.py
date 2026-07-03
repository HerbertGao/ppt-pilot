"""PPTPilot API app: health probe + Phase 2 business routes.

Business errors follow a unified `{error, code, details}` contract. Domain errors
and framework-native errors (`RequestValidationError` / `HTTPException`) are all
mapped by the handlers below so no FastAPI default `detail` array leaks out.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .errors import DomainError
from .routes import router

logger = logging.getLogger("ppt_pilot_api")

app = FastAPI(
    title="PPTPilot API",
    summary="Phase 2 project lifecycle + workflow state API for PPTPilot.",
    version="0.2.0",
)

app.include_router(router)

# error class -> HTTP status.
_STATUS_BY_ERROR = {
    "VALIDATION_ERROR": 400,
    "STATE_ERROR": 409,
    "NOT_FOUND": 404,
    "UPSTREAM_ERROR": 502,
}

# HTTP status -> (error class, NEUTRAL code) for framework-native HTTPException.
# These are framework 404/400/409/etc. (e.g. unknown route), NOT business errors:
# they must never reuse a business code like PROJECT_NOT_FOUND. Business errors
# flow through the DomainError handler instead.
_HTTP_STATUS_MAP = {
    404: ("NOT_FOUND", "RESOURCE_NOT_FOUND"),
    400: ("VALIDATION_ERROR", "HTTP_ERROR"),
    409: ("STATE_ERROR", "HTTP_ERROR"),
}


def _error_response(
    status: int, error: str, code: str, message: str, field: str | None = None
) -> JSONResponse:
    details: dict[str, Any] = {"message": message}
    if field is not None:
        details["field"] = field
    return JSONResponse(
        status_code=status, content={"error": error, "code": code, "details": details}
    )


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    status = _STATUS_BY_ERROR.get(exc.error, 400)
    return _error_response(status, exc.error, exc.code, str(exc) or exc.code, exc.field)


@app.exception_handler(RequestValidationError)
async def handle_request_validation(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Malformed/typed request bodies never leak FastAPI's default `detail` array.
    return _error_response(
        400, "VALIDATION_ERROR", "INVALID_REQUEST_BODY", "request body is invalid"
    )


@app.exception_handler(StarletteHTTPException)
async def handle_http_exception(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    error, code = _HTTP_STATUS_MAP.get(
        exc.status_code, ("HTTP_ERROR", "HTTP_ERROR")
    )
    message = exc.detail if isinstance(exc.detail, str) else code
    return _error_response(exc.status_code, error, code, message)


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Catch-all so an unexpected error still honors the unified {error,code,details}
    # contract instead of leaking Starlette's plain-text 500.
    # %r so a CR/LF in the request path cannot forge log lines (CWE-117).
    logger.exception("unhandled error on %r %r", request.method, request.url.path)
    return _error_response(
        500, "INTERNAL_ERROR", "INTERNAL_ERROR", "internal server error"
    )


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    """Return API shell health without touching business state."""

    return {
        "status": "ok",
        "service": "ppt-pilot-api",
        "phase": "phase-2-api-skeleton-and-workflow-state",
    }


def run() -> None:
    """Run the API with a clear Python entrypoint."""

    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)


def _selfcheck() -> None:
    """End-to-end check over the ASGI app (no httpx): drives real routing and the
    registered exception handlers, asserting happy + error paths and zero side
    effects on failure. Also asserts state-machine consistency (task 3.4).
    """

    import asyncio
    import json as _json

    from .routes import get_constants, get_repository
    from .workflow import assert_state_machine_consistent

    assert_state_machine_consistent(get_constants())

    async def call(method: str, path: str, body: bytes | None = None):
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "scheme": "http",
            "headers": [(b"content-type", b"application/json")],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        }
        sent = {"done": False}

        async def receive():
            if sent["done"]:
                return {"type": "http.disconnect"}
            sent["done"] = True
            return {"type": "http.request", "body": body or b"", "more_body": False}

        captured: dict[str, Any] = {"status": None, "body": b""}

        async def send(message):
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
            elif message["type"] == "http.response.body":
                captured["body"] += message.get("body", b"")

        await app(scope, receive, send)
        text = captured["body"].decode() or "{}"
        return captured["status"], _json.loads(text)

    async def run_checks() -> None:
        # POST /projects with {} -> default scene, NEW_PROJECT.
        status, data = await call("POST", "/api/projects", b"{}")
        assert status == 200, (status, data)
        assert data["status"] == "NEW_PROJECT", data
        pid = data["projectId"]

        # GET existing project.
        status, data = await call("GET", f"/api/projects/{pid}")
        assert status == 200 and data["scene"] == "default", data
        assert data["styleProfileId"] == "style_default", data

        # GET missing project -> PROJECT_NOT_FOUND.
        status, data = await call("GET", "/api/projects/nope")
        assert status == 404 and data["code"] == "PROJECT_NOT_FOUND", data
        assert data["error"] == "NOT_FOUND", data

        # POST /projects invalid scene -> INVALID_SCENE, no project created.
        status, data = await call("POST", "/api/projects", b'{"scene":"education2"}')
        assert status == 400 and data["code"] == "INVALID_SCENE", data

        # POST /projects missing body -> INVALID_REQUEST_BODY (vs {} success).
        status, data = await call("POST", "/api/projects", b"")
        assert status == 400 and data["code"] == "INVALID_REQUEST_BODY", data
        assert data["error"] == "VALIDATION_ERROR", data

        # Legal transition writes exactly one event and advances state.
        assert len(get_repository().list_events(pid)) == 0
        status, data = await call(
            "POST", f"/api/projects/{pid}/transitions", b'{"to":"REQUIREMENT_DISCOVERY"}'
        )
        assert status == 200 and data["status"] == "REQUIREMENT_DISCOVERY", data
        events = get_repository().list_events(pid)
        assert len(events) == 1 and events[0]["type"] == "WORKFLOW_STATE_CHANGED", events
        assert events[0]["actor"] == "user", events
        assert events[0]["payload"] == {
            "previousState": "NEW_PROJECT",
            "nextState": "REQUIREMENT_DISCOVERY",
        }, events

        # Unknown target string -> INVALID_WORKFLOW_STATE, no side effect.
        status, data = await call(
            "POST", f"/api/projects/{pid}/transitions", b'{"to":"BOGUS_STATE"}'
        )
        assert status == 400 and data["code"] == "INVALID_WORKFLOW_STATE", data
        assert get_repository().get_project(pid).state == "REQUIREMENT_DISCOVERY"
        assert len(get_repository().list_events(pid)) == 1

        # Known state but illegal edge -> INVALID_STATE_TRANSITION, no side effect.
        status, data = await call(
            "POST", f"/api/projects/{pid}/transitions", b'{"to":"EXPORTED"}'
        )
        assert status == 409 and data["code"] == "INVALID_STATE_TRANSITION", data
        assert data["error"] == "STATE_ERROR", data
        assert len(get_repository().list_events(pid)) == 1

        # Missing `to` ({}) -> INVALID_REQUEST_BODY.
        status, data = await call("POST", f"/api/projects/{pid}/transitions", b"{}")
        assert status == 400 and data["code"] == "INVALID_REQUEST_BODY", data

        # Precedence: body-parse > project existence. Missing `to` on a missing
        # project still returns INVALID_REQUEST_BODY.
        status, data = await call("POST", "/api/projects/ghost/transitions", b"{}")
        assert status == 400 and data["code"] == "INVALID_REQUEST_BODY", data

        # Precedence: project existence > state validation. Illegal `to` on a
        # missing project returns PROJECT_NOT_FOUND.
        status, data = await call(
            "POST", "/api/projects/ghost/transitions", b'{"to":"EXPORTED"}'
        )
        assert status == 404 and data["code"] == "PROJECT_NOT_FOUND", data

        # Rollback edge REQUIREMENT_REVIEW -> REQUIREMENT_DISCOVERY works.
        await call(
            "POST", f"/api/projects/{pid}/transitions", b'{"to":"REQUIREMENT_REVIEW"}'
        )
        status, data = await call(
            "POST", f"/api/projects/{pid}/transitions", b'{"to":"REQUIREMENT_DISCOVERY"}'
        )
        assert status == 200 and data["status"] == "REQUIREMENT_DISCOVERY", data
        assert len(get_repository().list_events(pid)) == 3

        # Phase 5: the outline/slide-planning forward chain is walkable and each
        # step appends exactly one event (transition-only, no generate).
        p2_status, p2_data = await call("POST", "/api/projects", b"{}")
        assert p2_status == 200, p2_data
        p2 = p2_data["projectId"]
        for to in ("REQUIREMENT_DISCOVERY", "REQUIREMENT_REVIEW"):
            await call("POST", f"/api/projects/{p2}/transitions", _json.dumps({"to": to}).encode())
        chain = ["OUTLINE_GENERATION", "OUTLINE_REVIEW", "SLIDE_PLANNING", "SLIDE_PLAN_REVIEW"]
        for i, to in enumerate(chain):
            before = len(get_repository().list_events(p2))
            status, data = await call(
                "POST", f"/api/projects/{p2}/transitions", _json.dumps({"to": to}).encode()
            )
            assert status == 200 and data["status"] == to, (to, status, data)
            assert len(get_repository().list_events(p2)) == before + 1, (to, "event count")
        assert get_repository().get_project(p2).state == "SLIDE_PLAN_REVIEW"

        # Phase 6: SLIDE_PLAN_REVIEW -> SLIDE_GENERATION is now a legal forward edge
        # (transition-only, no materialize) and appends exactly one event.
        before = len(get_repository().list_events(p2))
        status, data = await call(
            "POST", f"/api/projects/{p2}/transitions", b'{"to":"SLIDE_GENERATION"}'
        )
        assert status == 200 and data["status"] == "SLIDE_GENERATION", data
        assert len(get_repository().list_events(p2)) == before + 1

        # Edges past SLIDE_GENERATION are Phase 7+; still illegal, no side effect.
        for to in ("EDITING", "EXPORT_READY"):
            before = len(get_repository().list_events(p2))
            status, data = await call(
                "POST", f"/api/projects/{p2}/transitions", _json.dumps({"to": to}).encode()
            )
            assert status == 409 and data["code"] == "INVALID_STATE_TRANSITION", (to, data)
            assert get_repository().get_project(p2).state == "SLIDE_GENERATION"
            assert len(get_repository().list_events(p2)) == before

        # None-safe rollback SLIDE_GENERATION -> SLIDE_PLAN_REVIEW: presentation was
        # never materialized (None), so the clear is a no-op and must not crash; the
        # confirmed plans (whatever they are) are retained across this rollback.
        plans_before = get_repository().get_project(p2).slidePlans
        confirmed_before = get_repository().get_project(p2).slidePlansConfirmed
        status, data = await call(
            "POST", f"/api/projects/{p2}/transitions", b'{"to":"SLIDE_PLAN_REVIEW"}'
        )
        assert status == 200 and data["status"] == "SLIDE_PLAN_REVIEW", data
        proj = get_repository().get_project(p2)
        assert proj.presentation is None, proj
        assert proj.slidePlans == plans_before, proj
        assert proj.slidePlansConfirmed == confirmed_before, proj

        # Continue rolling back down the chain; None artifacts must not crash and
        # slidePlansConfirmed resets.
        for to in ("SLIDE_PLANNING", "OUTLINE_REVIEW", "OUTLINE_GENERATION", "REQUIREMENT_REVIEW"):
            status, data = await call(
                "POST", f"/api/projects/{p2}/transitions", _json.dumps({"to": to}).encode()
            )
            assert status == 200 and data["status"] == to, (to, status, data)
        proj = get_repository().get_project(p2)
        assert proj.outline is None and proj.slidePlans is None, proj
        assert proj.slidePlansConfirmed is False, proj

        # Cross-level forward jump REQUIREMENT_REVIEW -> SLIDE_PLANNING is illegal.
        before = len(get_repository().list_events(p2))
        status, data = await call(
            "POST", f"/api/projects/{p2}/transitions", b'{"to":"SLIDE_PLANNING"}'
        )
        assert status == 409 and data["code"] == "INVALID_STATE_TRANSITION", data
        assert get_repository().get_project(p2).state == "REQUIREMENT_REVIEW"
        assert len(get_repository().list_events(p2)) == before

        # /health unchanged.
        status, data = await call("GET", "/health")
        assert status == 200 and data["status"] == "ok", data

    asyncio.run(run_checks())
    print("main + workflow + routes selfcheck OK")


if __name__ == "__main__":
    import sys

    if "--selfcheck" in sys.argv:
        _selfcheck()
    else:
        run()
