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

This is the same structured model Phase 7 PPTX export will read — the renderer proves a
confirmed plan materializes into a previewable, export-shareable model.

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
