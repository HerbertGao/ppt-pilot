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

## Recommended Stack

- Frontend: Next.js, React, TypeScript, Konva, Zustand, Tailwind, shadcn/ui
- Backend: FastAPI, PostgreSQL, Redis, Celery/RQ, S3/MinIO
- AI: OpenAI-compatible APIs, Anthropic, Gemini, local model adapters
- Export: python-pptx, HTML, PDF

## Long-Term Positioning

Build the Cursor for Presentation.

Not another AI PPT generator.
