# Initial Tasks

This file is optimized for Claude Code, Codex, Gemini CLI, and other AI coding agents.

## Task 0: Read Before Coding

Read these documents first:

1. `README.md`
2. `PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/AGENTS.md`
5. `docs/DATA_MODEL.md`
6. `docs/WORKFLOW.md`

Do not start by scaffolding random UI.

## Task 1: Initialize Monorepo

Create a monorepo structure:

```text
apps/web
apps/api
packages/shared-schema
packages/ai-workflow
packages/ppt-engine
packages/exporter
```

Recommended tools:

- pnpm workspace for TypeScript packages
- Python uv or Poetry for API
- Docker Compose for local services

## Task 2: Shared Schema Package

Create schemas for:

- PresentationSpec
- Presentation
- Slide
- SlidePlan
- Element
- Asset
- Version
- Event
- ExportArtifact

Outputs:

- TypeScript types
- JSON Schema
- Python Pydantic models later

## Task 3: API Skeleton

Create FastAPI app with routes:

- project create/get
- requirement discovery
- spec confirm
- outline generate/update/confirm
- slide plan generate/update
- slide generate/regenerate
- export

For MVP, use in-memory storage or SQLite before PostgreSQL.

## Task 4: Web Skeleton

Create Next.js app with pages:

- project creation
- requirement discovery
- spec review
- outline review
- slide plan review
- deck preview

Do not implement full canvas editor in the first pass.

## Task 5: Requirement Discovery Agent

Implement the first real agent.

Input:

- initial user request
- previous answers

Output:

- known fields
- missing fields
- questions
- confidence

Use mocked LLM provider first, then create adapter interface.

## Task 6: Outline Agent

Generate outline from confirmed spec.

Output must be structured JSON and validated by schema.

## Task 7: Slide Planner Agent

Generate SlidePlan for each slide.

Must not generate final copy or visual assets.

## Task 8: Preview Renderer

Render slides as HTML from Presentation JSON.

This proves the structured data model before building PPTX export.

## Task 9: Export MVP

Export to PPTX from Presentation JSON.

Use a minimal theme and simple layouts.

## Task 10: Lock System

Add:

- slide lock
- element lock
- validation to prevent AI writes to locked targets

## Important Constraints

- Do not store PPTX as source of truth.
- Do not generate full deck before spec confirmation.
- Do not edit locked elements.
- Do not merge agent responsibilities into one giant prompt.
- Keep schema validation strict.
