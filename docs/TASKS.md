# Initial Tasks

This file is optimized for Claude Code, Codex, Gemini CLI, and other AI coding agents.

These tasks follow the technical roadmap in `docs/ROADMAP.md`. Product capabilities such as scene-aware requirement discovery, image variants, partial regeneration, and review are important, but they should be implemented only after their technical prerequisites exist.

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
- Dependabot for dependency update PRs
- GitHub Actions with path-aware CI gates

## Task 2: Shared Schema Package

Create schemas for:

- PresentationSpec
- Presentation
- Slide
- SlidePlan
- Element
- Asset
- StyleProfile
- Version
- Event
- ExportArtifact

Outputs:

- TypeScript types
- JSON Schema
- Python Pydantic models later

## Task 2.1: Phase 1 CI and Dependency Automation

Add after the initial workspace scripts exist:

- Dependabot configuration for npm/pnpm, Python, and GitHub Actions.
- Path-aware CI gates for docs/OpenSpec, shared-schema, Web, and API changes.
- Explicit admission criteria so docs-only PRs do not run unrelated full CI.

## Task 3: API Skeleton

Create FastAPI app with routes:

- project create/get
- requirement discovery
- spec confirm
- outline generate/update/confirm
- slide plan generate/update
- slide generate/regenerate
- export
- create/get style profile and scene profile on project

For MVP, use in-memory storage or SQLite before PostgreSQL.

## Task 3.1: Scene and Style Profile Control

Do this after the shared schema and backend workflow state exist.

- Add `scene` and `styleProfileId` in project/presentation creation and update APIs.
- Allow profile switch before Presentation Spec confirmation.
- Persist default preset in shared schema.
- Treat this as part of the requirement discovery / spec-builder phase, not the initial repository foundation phase.

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

Do this after:

- shared schema exists
- backend project state exists
- schema validation can reject invalid agent output

Input:

- initial user request
- previous answers

Output:

- known fields
- missing fields
- questions
- confidence

Use mocked LLM provider first, then create adapter interface.
- Add scene-aware question policy:
  - fast vs thorough mode
  - scene-specific confidence threshold
  - max-question cap

## Task 6: Outline Agent

Generate outline from confirmed spec.

Output must be structured JSON and validated by schema.

## Task 7: Slide Planner Agent

Generate SlidePlan for each slide.

Must not generate final copy or visual assets.

## Later Task (Phase 6): Image Variant Regeneration

- Add `image_only` regenerate flow that returns multiple image candidates.
- Add variant selection API and variant persistence for replay.
- Ensure geometry is preserved when only image is regenerated and text is locked.

## Task 8: Preview Renderer

Render slides as HTML from Presentation JSON.

This proves the structured data model before building PPTX export.

Render from the same slide model used for PPTX planning (single source of truth for layout semantics).

## Task 9: Export MVP

Export to PPTX from Presentation JSON.

Use a minimal theme and simple layouts.

Add consistency checks to keep key slide geometry and style aligned with HTML preview.

## Task 10: Lock System

Add:

- slide lock
- element lock
- validation to prevent AI writes to locked targets

Duplicate-rate checks are a later quality/review task after slide generation exists.

## Important Constraints

- Do not store PPTX as source of truth.
- Do not generate full deck before spec confirmation.
- Do not edit locked elements.
- Do not merge agent responsibilities into one giant prompt.
- Keep schema validation strict.
