# apps/api

Phase 1 FastAPI backend shell for PPTPilot.

## Start entrypoint

From the repository root:

```bash
python3 -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000
```

Or from this directory:

```bash
python3 -m app.main
```

The shell exposes only:

```text
GET /health
```

Expected health response:

```json
{
  "status": "ok",
  "service": "ppt-pilot-api",
  "phase": "phase-1-foundation"
}
```

## Shared-schema consumption

`packages/shared-schema` is the canonical contract source. The API shell does not
define Pydantic core entity models in Phase 1, because that would risk drifting
from the shared TypeScript/runtime contract.

The smoke check in `app/shared_schema_adapter.py` and
`app/shared_schema_smoke.py` is a thin Phase 1 compatibility proof. It calls
Node in a subprocess, loads `packages/shared-schema/dist/index.js`, invokes the
shared-schema `validateEntity` export, validates one legal `PresentationSpec`
fixture, and confirms one illegal `PresentationSpec` fixture is rejected.

The build artifact must exist before running the smoke check. If
`packages/shared-schema/dist/index.js` is missing, run:

```bash
pnpm --filter @ppt-pilot/shared-schema build
```

or use the root validate/typecheck flow that builds shared-schema first.

Run it from the repository root:

```bash
python3 apps/api/scripts/smoke_shared_schema.py
```

This is intentionally only a Phase 1 smoke check, not an independent backend
core entity model. The API side must not maintain duplicated enum/default/profile
rules such as scenes or style profile mappings. Later API validation must be
driven by generated JSON Schema, generated Pydantic models, or a
shared-schema-backed adapter that is mechanically checked against
`packages/shared-schema`.

## Explicit Phase 1 non-goals

This API shell must not implement project lifecycle APIs, requirement
clarification, Outline APIs, Slide Plan APIs, HTML preview, PPTX export, AI
agent orchestration, persistence, or a real workflow state machine.
