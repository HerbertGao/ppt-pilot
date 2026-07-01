# AGENTS.md

This repository is intended to be developed with AI coding agents such as Claude Code, Codex, Gemini CLI, and similar tools.

## Read Order

Before coding, read:

1. `README.md`
2. `PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/AGENTS.md`
5. `docs/DATA_MODEL.md`
6. `docs/WORKFLOW.md`
7. `docs/TASKS.md`

## Project Goal

Build PPTPilot: an AI Presentation IDE for controllable PPT creation.

Do not build a one-shot AI PPT generator.

## Core Rules

- Ask before guessing.
- Plan before generating.
- Use structured JSON as the source of truth.
- PPTX is export only.
- Never modify locked slides or locked elements.
- Keep agent responsibilities separate.
- Validate AI outputs with schemas.

## Preferred First Implementation Order

1. Shared schemas
2. Backend API skeleton
3. Requirement Discovery Agent
4. Outline Agent
5. Slide Planner Agent
6. HTML preview renderer
7. PPTX export
8. Canvas editor
9. Lock and partial regeneration
10. Review and versioning

## Tech Preferences

Frontend:

- Next.js
- React
- TypeScript
- Zustand
- Tailwind
- shadcn/ui
- Konva later

Backend:

- FastAPI
- Python type hints
- Pydantic
- PostgreSQL later
- Redis later

## Do Not

- Do not start with a complicated canvas editor.
- Do not hard-code prompt output without schema validation.
- Do not make mobile a full PPT editor.
- Do not mix all agents into one function.
- Do not store generated PPTX as canonical data.

## MVP Definition

A successful first MVP lets the user:

1. Enter a vague presentation request.
2. Answer AI clarification questions.
3. Confirm a structured Presentation Spec.
4. Generate and edit an outline.
5. Generate slide plans.
6. Preview the deck as HTML.

PPTX export can come immediately after this.
