# Architecture

## 1. System Overview

PPTPilot should be built as a structured presentation engine with an AI workflow layer and a visual editing layer.

```text
Web IDE / Mobile Companion
  -> API Gateway
  -> Project Service
  -> Agent Orchestrator
  -> Asset Service
  -> Export Service
  -> Storage
```

## 2. Recommended Monorepo Structure

```text
apps/
  web/                 # Next.js desktop IDE and mobile companion
  api/                 # FastAPI backend

packages/
  shared-schema/       # Shared JSON schema and TypeScript types
  ppt-engine/          # Slide model, layout model, rendering helpers
  ai-workflow/         # Agent workflow definitions
  exporter/            # PPTX/PDF/HTML export logic

docs/
  PRODUCT.md
  ARCHITECTURE.md
  AGENTS.md
  WORKFLOW.md
  DATA_MODEL.md
  API.md
  UI.md
  ROADMAP.md
  PROMPTS.md
  TASKS.md
```

## 3. Frontend Architecture

### Desktop Web IDE

Use Next.js + React + TypeScript.

Main areas:

- Left panel: outline and slide thumbnails
- Center: canvas editor
- Right panel: properties and AI actions
- Bottom panel: version history and generation logs

Recommended libraries:

- Canvas: Konva / React-Konva
- State: Zustand
- UI: shadcn/ui + Tailwind CSS
- Drag sorting: dnd-kit
- Collaborative editing later: Yjs

### 3.1 Workflow step pages (Phase 4 / 4b)

The as-built frontend is a workflow-driven step shell, not yet the canvas IDE
above. `apps/web/src/app/projects/[id]/` hosts one page per workflow stage —
`discovery`, `review`, `outline`, `slide-plans`, `preview`, `export` — each
consuming the existing Phase 3–7 API endpoints. This is a **pure-frontend**
layer: no backend route, schema, event, or state-machine edge changes.

- **Step routing is centralized** in `apps/web/src/lib/workflow.ts`:
  `currentStepPath(projectId, state)` maps every `WorkflowState` to its single
  canonical step page, and per-page mount guards
  (`guardOutlineMount`/`guardSlidePlansMount`/`guardPreviewMount`/`guardExportMount`,
  alongside the existing discovery/review guards) redirect a mis-placed state to
  that path — so a page never renders for a state it does not own.
- **Forward progress is transition-driven** (same rule as Phase 4): action
  endpoints (generate/update/confirm/materialize/export) never advance state;
  only an explicit `POST /transitions` moves forward. Generation is chained —
  `chainGenerateOutline`/`chainGenerateSlidePlans` run "transition → generate →
  transition" (enter the generation state, call the generate endpoint, enter the
  review state), and a mid-chain failure stays in the generation state for
  retry. Step-page mount only redirects; it never auto-transitions.
- **The preview page consumes `@ppt-pilot/ppt-engine` directly**: once
  `POST /slides/materialize` (or `GET /presentation`) returns a bare
  `Presentation`, it calls `renderPresentation`/`renderSlide`/`renderThumbnail`
  to produce the preview HTML and thumbnails in-browser (no new backend render
  endpoint).
- **The export page** lists `GET /exports` metadata and downloads each artifact
  via `fetch` → `Blob` → `<a download>` (never `window.location`). Every Phase
  3–7 error code routes through the central `presentError` map in
  `apps/web/src/lib/errors.ts`, so pages never hand-roll error copy.

This closes the loop the backend opened in Phases 5–7: a user can now complete
confirm-spec → outline → slide plans → materialized preview → PPTX export
entirely from the Web UI.

### Mobile Companion

Mobile should not attempt to be a full PPT editor.

Mobile features:

- Requirement chat
- Voice input later
- Outline review
- Slide preview
- Comments
- Regeneration requests
- Export/share links

## 4. Backend Architecture

Recommended backend: FastAPI.

Core services:

- Project Service
- Requirement Service
- Agent Orchestrator
- Slide Service
- Asset Service
- Export Service
- Version Service

Async jobs:

- Celery or RQ
- Redis as broker/cache

Storage:

- PostgreSQL for project/slide/element data
- S3/MinIO for images and generated assets
- Redis for generation sessions and locks

## 5. AI Workflow Architecture

The AI layer should be orchestrated as agents, not as one giant prompt.

```text
Requirement Agent
  -> Gap Finder
  -> Question Agent
  -> Spec Builder
  -> Outline Agent
  -> Slide Planner
  -> Content Agent
  -> Layout Agent
  -> Image Agent
  -> Review Agent
```

Each agent must have:

- Explicit input schema
- Explicit output schema
- Confidence score
- Stop condition
- Escalation condition
- Versioned prompt template

### Model Providers

Two independent provider interfaces, both swappable:

- `LLMProvider` — text agents (Requirement, Gap, Question, Spec Builder, Outline, Slide Planner, Content, Layout, Review). Backed by OpenRouter first. This is the only provider needed from Phase 3 through Phase 8.
- `ImageProvider` — text-to-image for the Image Agent. A separate third-party API (OpenRouter's image coverage is not sufficient). Introduced in Phase 9, not before.

Notes:

- The Image Agent has four asset modes (AI-generated, open-license stock, icons, diagrams). Only the first needs `ImageProvider`; diagrams/charts/icons go through the renderer or a stock library.
- Before Phase 9 no text-to-image code is written. `ImageProvider` selection is deferred to Phase 9 when real quality/cost/style-consistency needs are known.

## 6. Source of Truth

The source of truth is not PPTX.

The source of truth is:

```text
Presentation JSON + Asset References + Version History
```

PPTX/PDF/HTML are export targets.

## 7. Export Architecture

Exporters should consume the same structured presentation model.

Supported targets:

- PPTX via python-pptx or pptxgenjs
- PDF via browser rendering or LibreOffice later
- HTML via custom renderer or Reveal.js style renderer

### 7.1 ppt-engine HTML preview renderer (Phase 6)

`packages/ppt-engine` is the first consumer of the shared `Presentation`/`Slide`/`Element`
model. It is a pure-function TypeScript renderer — no I/O, no DOM, no network, fully
deterministic — so the same model always yields the same HTML and golden fixtures stay
lockable:

- `renderSlide(slide, theme)` and `renderPresentation(presentation)` walk the model by
  `Element` type / geometry / `zIndex` / `style` and emit HTML fragments plus one theme
  CSS block.
- Trust-boundary escaping is context-aware: text goes through HTML text escaping,
  attribute values through attribute escaping, and `ThemeTokens` / `element.style` values
  through a **CSS property allowlist + value sanitizer** (strips `expression(...)`,
  `url(...)`, `</style>`, etc.) — arbitrary CSS is never passed through. Object keys are
  walked in a fixed/sorted order so fixture output is stable.
- Thumbnails are deterministic placeholders (inline SVG / data-uri, no headless browser);
  materialized visual elements render as typed placeholder boxes and request no external
  assets.

This is the same structured model Phase 7 PPTX export reads — the renderer proves a
confirmed plan materializes into a previewable, export-shareable model.

### 7.2 PPTX export service (Phase 7)

The PPTX exporter lands in the backend as `apps/api/app/export.py` (not
`packages/exporter`, which stays an empty placeholder for a later TS/pptxgenjs path):
`python-pptx` is mature, pure-Python (lxml), hermetic, and returns `bytes` in-process,
so no Node subprocess is needed to produce a binary. It is **deterministic, LLM-free,
network-free** and consumes the **same persisted `Presentation`** the renderer does:

- `POST /projects/{id}/export` reads the materialized `project.presentation`, maps each
  `Slide` to one pptx slide (built on the blank layout so no template placeholder shapes
  pollute the shape count) and each `Element` to one shape. Geometry scales from the
  export canvas convention `1280×720 px` to the **exact 16:9 EMU** slide
  (`12192000×6858000`, never the imprecise `Inches(13.333)`), integer `Emu`, `zIndex`
  ascending add order, finite-guarded, off-canvas allowed to overflow. `text` → textbox
  (`str(content.text or "")`); **every other type (one `else`) → a labeled placeholder
  rectangle** (full 8-type coverage, no real charts/images this phase); `theme` → colors
  (`lstrip("#")` + try, deterministic fallback, never raises).
- **Determinism is expressed as structural invariants, not byte-level reproducibility**
  (pptx is a zip binary): `core_properties` are pinned to deterministic sentinels, and
  the produced deck is asserted by reopening it (slide count == `slides`, shape count ==
  elements, text content, geometry scaling).
- The bytes live in the in-memory repository as a base64 `ExportArtifact`;
  `GET /projects/{id}/export/{artifactId}` streams them with the PPTX MIME and
  `Content-Length == byteSize`, while `GET /projects/{id}/exports` lists **metadata only**
  (never the unbounded `bytesBase64`). No disk, no object storage this phase.
- The export action **does not advance the workflow state** (like every action endpoint):
  it stays in `EXPORT_READY` and appends a single `PRESENTATION_EXPORTED` event; reaching
  `EXPORTED` is a separate explicit `/transitions` step. Assembled artifact and event are
  validated **before** any persistent write, so a rejection persists nothing.

## 8. Future Enterprise Layer

Future enterprise capabilities:

- Workspace
- Organization
- Brand Kit
- Template Library
- Knowledge Base
- SSO
- Audit log
- Role-based permissions
- Private deployment

Do not hard-code consumer-only assumptions in the MVP.
