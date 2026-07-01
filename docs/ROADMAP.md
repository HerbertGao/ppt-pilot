# Roadmap

## Phase 0: Documentation and Architecture

Goal: make the project easy for AI coding agents and humans to understand.

Deliverables:

- Product documentation
- Architecture documentation
- Agent protocol
- Data model
- API draft
- UI draft
- Task list

## Phase 1: Requirement Discovery MVP

Goal: prove that asking before generating improves deck quality.

Features:

- Create project
- Initial request input
- Requirement Discovery Agent
- Gap detection
- Clarifying questions
- Presentation Spec JSON
- Spec review screen

Success criteria:

- User can go from vague request to confirmed spec.
- Agent asks useful questions instead of annoying questions.

## Phase 2: Outline and Slide Planning

Features:

- Outline Agent
- Outline review/editing
- Slide Planner Agent
- Slide plan review/editing

Success criteria:

- User can approve the deck structure before generation.
- Each slide has objective, key message, visual intent, and layout suggestion.

## Phase 3: Basic Slide Generation

Features:

- Text content generation
- Simple layout generation
- HTML preview
- Basic theme
- Slide thumbnails

Success criteria:

- User can generate a coherent deck preview from approved slide plans.

## Phase 4: Export MVP

Features:

- PPTX export
- HTML export
- PDF export later

Success criteria:

- Generated deck can be downloaded as PPTX.

## Phase 5: Canvas Editor

Features:

- Konva canvas
- Element selection
- Text editing
- Move / resize
- Lock slide
- Lock element

Success criteria:

- User can manually adjust generated slides.

## Phase 6: Partial Regeneration

Features:

- Regenerate selected slide
- Regenerate selected element
- Text-only regeneration
- Image-only regeneration
- Layout-only regeneration
- Locked content protection

Success criteria:

- AI modifies only what the user allows.

## Phase 7: Versioning and Review

Features:

- Event log
- Version snapshots
- Diff / accept / reject
- Review Agent

Success criteria:

- User can safely experiment without losing good versions.

## Phase 8: Team / Enterprise Readiness

Features:

- Workspace
- Brand kit
- Template library
- Knowledge base
- Permission model
- Audit log

Success criteria:

- Product can be sold to teams, not just individuals.
