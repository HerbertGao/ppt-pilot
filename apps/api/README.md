# apps/api

FastAPI backend for PPTPilot. Implements the project lifecycle, the workflow
state machine, the event log, the requirement/outline/slide-plan agents, and the
deterministic slide-materialization and PPTX-export services (Phases 2–7).

## Start entrypoint

From the repository root:

```bash
python3 -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 18000
```

Or from this directory:

```bash
python3 -m app.main
```

The default port is **18000** (an uncommon five-digit port; `8000` is frequently
grabbed by Docker/OrbStack). Override with `API_PORT` for `python3 -m app.main`, or
`--port` for the uvicorn command. The web dev server proxies `/api` to
`http://127.0.0.1:18000` by default (override with `BACKEND_URL`).

`GET /health` returns a liveness payload. The full API surface (project lifecycle,
transitions, requirement discovery, outline, slide plans, materialize, presentation,
export/download) is documented in [`docs/API.md`](../../docs/API.md).

## What's implemented

- **Workflow state machine** (`app/workflow.py`): a 12-state machine
  (`NEW_PROJECT → … → SLIDE_GENERATION → EXPORT_READY → EXPORTED`) with an explicit
  legal-adjacency edge table and None-safe rollback edges. Transitions are
  **LLM-free / structural**; `EDITING`/`REVIEW` have no edges yet (Phase 8).
- **Agents** (behind an `LLMProvider`, OpenRouter/DeepSeek, text-only): Requirement
  Discovery (Phase 3), Outline (Phase 5), Slide Planner (Phase 5).
- **Deterministic services** (no LLM, no network): slide materialization
  (`app/presentation.py`, Phase 6) and PPTX export (`app/export.py` via
  `python-pptx`, Phase 7).
- **Event log** with validate-before-append, and a group-based error convention
  (`app/errors.py` / `app/main.py`): `ValidationError`→400, `StateError`→409,
  `NotFoundError`→404, `UpstreamError`→502, unhandled→500.

Not built here yet: content/image/layout generation, canvas editing, slide/element
lock runtime, version history, Review Agent (Phases 8–10).

## Shared-schema consumption (canonical contract)

`packages/shared-schema` is the **single source of truth** for entity shapes,
enums, defaults, and validation. The API must **not** duplicate enum/default/
profile rules (scenes, style profiles, workflow states, event payloads); it
validates through `app/shared_schema_adapter.py`, which calls Node in a subprocess,
loads `packages/shared-schema/dist/index.js`, and invokes the shared-schema
`validateEntity` / event-payload validators. This is the runtime validation path
for every persisted entity and event (materialize and export both validate their
output against shared-schema before persisting).

The build artifact must exist before validation runs. If
`packages/shared-schema/dist/index.js` is missing:

```bash
pnpm --filter @ppt-pilot/shared-schema build
```

(or the root `pnpm run validate` flow, which builds shared-schema first).

## Tests & self-check

```bash
# from the repo root, using the API venv
apps/api/.venv/bin/python -m pytest apps/api            # backend suite (193)
cd apps/api && .venv/bin/python -m app.main --selfcheck # state-machine + routes consistency
```

The suite is hermetic: the LLM provider is mocked and there is no network access.
