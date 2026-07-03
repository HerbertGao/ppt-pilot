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

Phases 1–7 are implemented and archived. What exists today:

- Monorepo with a canonical `packages/shared-schema` contract (types, validators, fixtures) consumed by the API and renderer.
- FastAPI backend (`apps/api`) implementing the full workflow: requirement discovery -> Presentation Spec -> outline -> slide plan -> materialize -> PPTX export, with a 12-state workflow state machine and an event log.
- Deterministic HTML preview renderer in `packages/ppt-engine` (pure functions, theme-to-CSS, placeholder thumbnails).
- PPTX export in the backend via `python-pptx` (charts/images/diagrams render as labeled placeholder shapes).
- Next.js frontend (`apps/web`) at the Phase 4 shell: create project, requirement discovery, spec review, and workflow status. Preview and export UI pages are not built yet.

Requirement Discovery, Outline, and Slide Planner run behind an `LLMProvider` interface (OpenRouter/DeepSeek, text-only); materialize and export are deterministic and require no LLM or network. Canvas editing, element locking, partial regeneration, image generation, and the Review Agent are not built (Roadmap Phases 8–10).

Start here:

- [PRODUCT.md](./PRODUCT.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/AGENTS.md](./docs/AGENTS.md)
- [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)
- [docs/ROADMAP.md](./docs/ROADMAP.md)
- [docs/TASKS.md](./docs/TASKS.md)

## Development Commands

Prerequisites:

- Node.js 24+
- pnpm 9+
- Python 3.13+
- Optional: `openspec-cn` for strict OpenSpec validation

Install the pnpm workspace plus the API into a local `.venv`:

```bash
corepack enable
pnpm run install:deps
```

CI installs with `--no-frozen-lockfile` (as does `install:deps`).

Run the full repository validation gate:

```bash
pnpm run validate
```

Per-package checks:

```bash
# shared-schema
pnpm --filter @ppt-pilot/shared-schema typecheck
pnpm --filter @ppt-pilot/shared-schema build
pnpm --filter @ppt-pilot/shared-schema validate:fixtures

# ppt-engine (HTML preview renderer)
pnpm --filter @ppt-pilot/ppt-engine typecheck
pnpm --filter @ppt-pilot/ppt-engine test

# web shell
pnpm --filter @ppt-pilot/web typecheck
pnpm --filter @ppt-pilot/web test
```

Backend (`apps/api`) checks, from the repository root:

```bash
.venv/bin/python -m pytest apps/api/tests
PYTHONPATH=apps/api .venv/bin/python -m app.main --selfcheck
```

Start the Web shell locally:

```bash
pnpm --filter @ppt-pilot/web dev
```

Start the API locally:

```bash
python3 -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000
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
