# PPTPilot

AI Presentation IDE for controllable PPT creation.

PPTPilot is not a one-shot AI PPT generator. It is an AI-native presentation workspace designed around requirement discovery, outline planning, slide-level generation, human review, element locking, partial regeneration, and export.

## Core Idea

Most AI PPT tools start generating too early. PPTPilot starts by understanding the user.

```text
Requirement Discovery
  -> Presentation Spec
  -> Outline Plan
  -> Slide Plans
  -> Slide Generation
  -> Human Editing
  -> Lock / Regenerate
  -> Export
```

## Product Principles

- Ask before guessing.
- Plan before generating.
- Treat every slide as structured data.
- Allow page-level and element-level locking.
- Never modify locked content.
- Keep generation history and versions.
- Export PPTX/PDF/HTML from structured slide data.

## Repository Status

This repository currently contains product and technical initialization documents intended for Claude Code, Codex, Gemini CLI, and other AI coding agents.

Start here:

- [PRODUCT.md](./PRODUCT.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/AGENTS.md](./docs/AGENTS.md)
- [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)
- [docs/TASKS.md](./docs/TASKS.md)

## Phase 1 Development Commands

Phase 1 establishes the monorepo shell, shared schema contract, fixtures, Web
shell, and API shell. It intentionally does not implement real AI agents,
workflow state machines, HTML preview, PPTX export, canvas editing, partial
regeneration, or a Review Agent.

Prerequisites:

- Node.js 20+
- pnpm 9+
- Python 3.11+
- Optional: `openspec-cn` for strict OpenSpec validation

Install JavaScript workspace and API dependencies:

```bash
corepack enable
pnpm run install:deps
```

There is currently no `pnpm-lock.yaml`; use `--no-frozen-lockfile` until a
lockfile is introduced. After the lockfile exists, CI and local verification
should switch to frozen lockfile installs.

After dependencies are installed, run the Phase 1 repository validation gate:

```bash
pnpm run validate
```

Equivalent gate steps:

```bash
pnpm --filter @ppt-pilot/shared-schema typecheck
pnpm --filter @ppt-pilot/shared-schema build
pnpm --filter @ppt-pilot/shared-schema validate:fixtures
pnpm --filter @ppt-pilot/web typecheck
pnpm --filter @ppt-pilot/web build
pnpm --filter @ppt-pilot/web smoke-start
python3 -m compileall apps/api/app
PYTHONPATH=apps/api python3 -m app.shared_schema_smoke
PYTHONPATH=apps/api python3 -c "from app.main import health_check; assert health_check()['status'] == 'ok'"
```

Start the Web shell locally:

```bash
pnpm --filter @ppt-pilot/web dev
```

Install and smoke-check the API shell:

```bash
python3 -m pip install -e apps/api
python3 -m compileall apps/api/app
PYTHONPATH=apps/api python3 -m app.shared_schema_smoke
PYTHONPATH=apps/api python3 -c "from app.main import health_check; assert health_check()['status'] == 'ok'"
```

Start the API shell locally:

```bash
PYTHONPATH=apps/api python3 -m app.main
```

Check the active Phase 1 OpenSpec artifact shape. If `openspec-cn` is
available, also run strict validation:

```bash
test -f openspec/changes/phase-1-foundation-monorepo-and-shared-schema/proposal.md
test -f openspec/changes/phase-1-foundation-monorepo-and-shared-schema/design.md
test -f openspec/changes/phase-1-foundation-monorepo-and-shared-schema/tasks.md
```

```bash
openspec-cn validate phase-1-foundation-monorepo-and-shared-schema --strict
```

CI gate details are documented in [docs/CI_GATES.md](./docs/CI_GATES.md).

## Recommended Stack

- Frontend: Next.js, React, TypeScript, Konva, Zustand, Tailwind, shadcn/ui
- Backend: FastAPI, PostgreSQL, Redis, Celery/RQ, S3/MinIO
- AI: OpenAI-compatible APIs, Anthropic, Gemini, local model adapters
- Export: python-pptx, HTML, PDF

## Long-Term Positioning

Build the Cursor for Presentation.

Not another AI PPT generator.
