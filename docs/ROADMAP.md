# Roadmap

This roadmap is organized by technical implementation dependency, not by product marketing milestones.

PPTPilot's product workflow is still:

```text
Requirement Discovery
  -> Presentation Spec
  -> Outline
  -> Slide Plan
  -> HTML Preview
  -> Export
  -> Editing / Lock / Regeneration
```

But implementation must start from the engineering foundation that makes those stages reliable.

## Phase 0: Documentation and Architecture

Goal: make the project understandable for humans and AI coding agents.

Deliverables:

- Product documentation
- Architecture documentation
- Agent protocol
- Data model
- API draft
- UI draft
- Task list
- OpenSpec configuration

Status: completed.

## Phase 1: Foundation, Monorepo, and Shared Schema

Goal: establish the project skeleton and canonical contract layer before building product behavior.

Deliverables:

- Monorepo structure
- Frontend app shell
- Backend app shell
- `packages/shared-schema`
- Canonical TypeScript types
- JSON Schema validation artifacts
- Python Pydantic model plan or initial generated models
- Fixture examples for `Presentation`, `PresentationSpec`, `SlidePlan`, `StyleProfile`, `Event`
- Basic validation tests for schema defaults and invalid input
- Dependabot configuration for package ecosystems introduced in Phase 1
- Path-aware CI with separate gates for docs/OpenSpec, shared-schema, Web, and API changes

Success criteria:

- The repository can be installed and started in a predictable way.
- Shared schema is the source of truth for API, agents, renderer, and exporter.
- Invalid schema input fails before any agent output is accepted.
- Documentation-only changes do not run unrelated full Web/API/schema CI.
- Dependency update PRs run the checks matching their affected ecosystem.

Suggested OpenSpec change:

```text
phase-1-foundation-monorepo-and-shared-schema
```

## Phase 2: Backend API Skeleton and Workflow State

Goal: create the minimal backend surface and state machine that later agents can use.

Deliverables:

- FastAPI app structure
- Project create/get APIs
- Presentation state model
- Workflow state transitions
- In-memory repository or SQLite adapter
- Event append/read model
- Error response convention
- API contract tests for project lifecycle and invalid state transitions

Success criteria:

- A project can move through early workflow states without real AI generation.
- Events are recorded for state-changing actions.
- API validation errors do not mutate stored state.

Suggested OpenSpec change:

```text
phase-2-api-skeleton-and-workflow-state
```

## Phase 3: Requirement Discovery and Spec Builder

Goal: implement the first useful AI workflow on top of the schema and backend foundation.

Deliverables:

- Requirement Discovery Agent
- Gap classification
- Scene-aware question policy
- `fast` / `thorough` question mode
- User skip handling with risk notes
- Spec Builder Agent
- `PresentationSpec` confirmation API
- Schema validation before accepting generated specs

Success criteria:

- A vague request can become a validated, user-confirmed `PresentationSpec`.
- The system asks only high-value questions and can proceed when the user skips.
- Scene/style profile choices are captured as part of the spec snapshot.

Suggested OpenSpec change:

```text
phase-3-requirement-discovery-and-spec-builder
```

## Phase 4: Frontend Workflow Shell

Goal: provide a usable web flow for the early backend capabilities.

Deliverables:

- Next.js project creation page
- Requirement discovery page
- Spec review page
- Workflow status display
- Scene/style profile controls
- `fast` / `thorough` mode switch
- Error and loading states for API calls

Success criteria:

- A user can create a project, answer questions, and confirm a spec from the web UI.
- The UI displays current workflow state and validation errors clearly.

Suggested OpenSpec change:

```text
phase-4-frontend-workflow-shell
```

## Phase 5: Outline and Slide Planning

Goal: generate deck structure before any final slide content or visual asset generation.

Deliverables:

- Outline Agent
- Outline review/update APIs
- Slide Planner Agent
- Slide plan review/update APIs
- Schema validation for outline and slide plan output

Success criteria:

- A confirmed spec can produce an editable outline.
- Each planned slide has objective, key message, visual intent, and layout suggestion.

Suggested OpenSpec change:

```text
phase-5-outline-and-slide-planning
```

## Phase 6: HTML Preview Renderer and Slide Model

Goal: prove the structured presentation model can render a coherent deck preview.

Deliverables:

- Slide JSON model implementation
- Basic theme tokens
- HTML preview renderer
- Slide thumbnail generation path or placeholder
- Renderer fixtures

Success criteria:

- Approved slide plans can become previewable structured slides.
- HTML preview consumes the same structured model intended for export.

Suggested OpenSpec change:

```text
phase-6-html-preview-and-slide-model
```

## Phase 7: PPTX Export MVP

Goal: export from structured presentation data without making PPTX the source of truth.

Deliverables:

- PPTX export service
- Export job API
- Download API
- Basic geometry/style consistency checks between HTML preview and PPTX export

Success criteria:

- A generated deck can be downloaded as PPTX.
- Export reads structured presentation data and does not become the editable source.

Suggested OpenSpec change:

```text
phase-7-pptx-export-mvp
```

## Phase 8: Canvas Editing and Lock Model

Goal: allow manual adjustment and establish locked-content protection.

Deliverables:

- Canvas editor foundation
- Element selection
- Text editing
- Move/resize
- Slide lock
- Element lock
- Backend validation that blocks AI writes to locked targets

Success criteria:

- Users can manually adjust slides.
- Locked slides and elements cannot be modified by regeneration or agent writes.

Suggested OpenSpec change:

```text
phase-8-canvas-editing-and-lock-model
```

## Phase 9: Partial Regeneration and Image Variants

Goal: regenerate only user-approved scopes.

Deliverables:

- Slide-level regeneration
- Element-level regeneration
- Text-only regeneration
- Image-only regeneration
- Layout-only regeneration
- Multiple image variants with explicit user selection
- Version snapshot before regeneration

Success criteria:

- AI modifies only the requested unlocked scope.
- Image regeneration preserves locked text and element geometry.

Suggested OpenSpec change:

```text
phase-9-partial-regeneration-and-image-variants
```

## Phase 10: Versioning, Review, and Quality Checks

Goal: make experimentation reviewable and recoverable.

Deliverables:

- Version history
- Diff / accept / reject flow
- Review Agent
- Duplicate-rate warning
- Export readiness checks

Success criteria:

- Users can compare and recover previous versions.
- Review produces actionable issues without blocking normal editing.

Suggested OpenSpec change:

```text
phase-10-versioning-review-and-quality
```

Execution tracking is maintained at [ROADMAP_PROGRESS.md](ROADMAP_PROGRESS.md).
