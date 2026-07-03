# Workflow

## 1. High-Level Workflow

```text
NEW_PROJECT
  -> REQUIREMENT_DISCOVERY
  -> REQUIREMENT_REVIEW
  -> OUTLINE_GENERATION
  -> OUTLINE_REVIEW
  -> SLIDE_PLANNING
  -> SLIDE_PLAN_REVIEW
  -> SLIDE_GENERATION
  -> EDITING
  -> REVIEW
  -> EXPORT_READY
  -> EXPORTED
```

## 2. State Definitions

### NEW_PROJECT

Project has been created but no requirement has been processed.
- User can choose a scene preset and style profile (`education` / `corporate` / `default`) at creation time.
- Style profile can be switched until Presentation Spec confirmation. After confirmation, switching returns the user to requirement review/discovery.

### REQUIREMENT_DISCOVERY

The system parses the initial user request and asks clarifying questions.
- Adaptive strategy: ask only minimal high-value questions.
- Stop at scene-aware confidence threshold or when the user skips.
- Keep low-friction fast-first interaction by default.

Allowed actions:

- answer question
- skip question
- upload material
- modify initial request

### REQUIREMENT_REVIEW

The system shows the Presentation Spec back to the user.

Allowed actions:

- confirm spec
- edit spec
- return to discovery

### OUTLINE_GENERATION

The system generates a deck outline from the confirmed spec.

### OUTLINE_REVIEW

The user reviews and edits sections, slide count, order, and narrative flow.

Allowed actions:

- reorder sections
- add section
- delete section
- rename section
- regenerate outline
- approve outline

### SLIDE_PLANNING

The system generates one SlidePlan for each slide.

### SLIDE_PLAN_REVIEW

The user reviews slide titles, objectives, visual intent, and layout suggestions.

Allowed actions:

- edit slide plan
- split slide
- merge slides
- regenerate selected slide plans
- approve slide plans

### SLIDE_GENERATION

The system generates slide elements and assets from slide plans.
- Regenerate only unlocked elements.
- Preserve locked element position/size/style as hard constraints.
- This is a later-phase rule, not part of Phase 1 requirement discovery.

### EDITING

The user edits slide content, positions, assets, and locks.

Allowed actions:

- edit text
- drag element
- resize element
- replace image
- lock element
- lock slide
- regenerate selected element
- regenerate selected slide
- choose generated image variant (Phase 6)

### REVIEW

Review Agent checks the deck.

Allowed actions:

- accept issue suggestion
- reject issue suggestion
- regenerate affected page
- return to editing
- duplicate-rate warning / quality hint (soft warning, not hard block)
- Review and duplicate-rate checks are later-phase behavior after slide generation exists.

### EXPORT_READY

The deck is ready for export.

### EXPORTED

An export artifact has been generated.

## 2.1 Implemented Transition Edges (Phase 2 + Phase 5)

The backend `TRANSITION_EDGES` are LLM-free and structural: `validate_transition`
only checks structural adjacency (no Agent/LLM call, no content guard on forward
edges). Implemented edges:

```text
forward:
  NEW_PROJECT          -> REQUIREMENT_DISCOVERY   (Phase 2)
  REQUIREMENT_DISCOVERY-> REQUIREMENT_REVIEW       (Phase 2)
  REQUIREMENT_REVIEW   -> OUTLINE_GENERATION       (Phase 5)
  OUTLINE_GENERATION   -> OUTLINE_REVIEW           (Phase 5)
  OUTLINE_REVIEW       -> SLIDE_PLANNING           (Phase 5)
  SLIDE_PLANNING       -> SLIDE_PLAN_REVIEW        (Phase 5)
  SLIDE_PLAN_REVIEW    -> SLIDE_GENERATION         (Phase 6)

rollback:
  REQUIREMENT_REVIEW   -> REQUIREMENT_DISCOVERY    (Phase 2)
  OUTLINE_GENERATION   -> REQUIREMENT_REVIEW       (Phase 5)
  OUTLINE_REVIEW       -> OUTLINE_GENERATION       (Phase 5)
  SLIDE_PLANNING       -> OUTLINE_REVIEW           (Phase 5)
  SLIDE_PLAN_REVIEW    -> SLIDE_PLANNING           (Phase 5)
  SLIDE_GENERATION     -> SLIDE_PLAN_REVIEW        (Phase 6)
```

Edges past `SLIDE_GENERATION` (into `EDITING` / `REVIEW` / `EXPORT_READY` /
`EXPORTED`) are left to Phase 7+.

Because forward edges have no content guard, a "transition-only" path can reach
`OUTLINE_GENERATION` / `OUTLINE_REVIEW` / `SLIDE_PLANNING` / `SLIDE_PLAN_REVIEW` /
`SLIDE_GENERATION` with **empty products**. Such content-free states are reachable
but **inert**: each action endpoint guards its own content precondition (returning a
stable `*_NOT_CONFIRMABLE` / `*_NOT_FOUND` / `SLIDES_NOT_MATERIALIZABLE`), and every
rollback clears downstream products **None-safe** (an already-`None` product is a
no-op, never dereferenced). In particular, `slides/materialize` in an empty
`SLIDE_GENERATION` state rejects with `SLIDES_NOT_MATERIALIZABLE` rather than
producing a bad model.

Rollback downstream clearing (post-commit, in-memory attribute writes):

```text
OUTLINE_GENERATION -> REQUIREMENT_REVIEW : clear outline + slidePlans, slidePlansConfirmed=false
OUTLINE_REVIEW     -> OUTLINE_GENERATION : if outline exists, confirmedByUser=false; clear slidePlans, slidePlansConfirmed=false
SLIDE_PLANNING     -> OUTLINE_REVIEW     : clear slidePlans, slidePlansConfirmed=false
SLIDE_PLAN_REVIEW  -> SLIDE_PLANNING     : keep slidePlans (regenerate overwrites), slidePlansConfirmed=false
SLIDE_GENERATION   -> SLIDE_PLAN_REVIEW   : clear presentation (None-safe); keep slidePlans + slidePlansConfirmed (plans not voided)
```

The `SLIDE_GENERATION -> SLIDE_PLAN_REVIEW` rollback clears `project.presentation`
None-safe so re-materialization starts from a fresh model. The confirmed plans are
**kept** (rolling back the presentation does not void the plans — the project is still
a confirmed-plan state), unlike the deeper rollbacks that reset
`slidePlansConfirmed`.

Each successful transition appends one `WORKFLOW_STATE_CHANGED` event. Outline /
slide-plan action endpoints (generate / update / confirm) **do not advance the
workflow state** — forward transitions are driven explicitly via
`POST /projects/{id}/transitions`.

## 3. Locking Rules

### Slide lock

If a slide is locked:

- AI cannot regenerate it
- AI cannot edit its elements
- export can still read it

### Element lock

If an element is locked:

- AI cannot modify content
- AI cannot modify style
- AI cannot modify position
- AI can use it as context

## 4. Regeneration Scopes

```text
DECK_REGENERATE
SECTION_REGENERATE
SLIDE_REGENERATE
ELEMENT_REGENERATE
TEXT_ONLY_REGENERATE
IMAGE_ONLY_REGENERATE
LAYOUT_ONLY_REGENERATE
```

For IMAGE_ONLY_REGENERATE and image-target ELEMENT_REGENERATE, return multiple image variants for user selection (default to multiple images when supported). This belongs to Phase 6 partial regeneration.

## 5. Human Approval Gates

Required approval gates:

- Presentation Spec approval
- Outline approval
- Slide Plan approval
- Final export approval

Optional approval gates:

- Per-slide generation approval
- Per-asset approval
- Initial style-profile confirmation

## 6. Event Model

Every major action should be stored as an event.

Example events:

```json
{
  "eventId": "evt_001",
  "projectId": "p_001",
  "type": "SLIDE_ELEMENT_LOCKED",
  "actor": "user",
  "createdAt": "2026-07-01T00:00:00Z",
  "payload": {
    "slideId": "s_001",
    "elementId": "e_001"
  }
}
```

Later-phase requirement-discovery events:

```text
SCENE_STYLE_PROFILE_UPDATED
QUESTION_POLICY_APPLIED
REQUIREMENT_QUESTION_ASKED
REQUIREMENT_QUESTION_SKIPPED
PRESENTATION_SPEC_CONFIRMED
```

Suggested later events:

```text
IMAGE_VARIANTS_GENERATED
IMAGE_VARIANTS_SELECTED
DUPLICATE_RATE_WARNING
```

## 7. Why Workflow Matters

The workflow is the product moat.

One-shot generation can be copied by every model provider. Human-in-the-loop structured creation, locking, partial regeneration, versioning, and review are harder to copy and more valuable for real work.
