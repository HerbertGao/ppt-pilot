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

### REQUIREMENT_DISCOVERY

The system parses the initial user request and asks clarifying questions.

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

### REVIEW

Review Agent checks the deck.

Allowed actions:

- accept issue suggestion
- reject issue suggestion
- regenerate affected page
- return to editing

### EXPORT_READY

The deck is ready for export.

### EXPORTED

An export artifact has been generated.

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

## 5. Human Approval Gates

Required approval gates:

- Presentation Spec approval
- Outline approval
- Slide Plan approval
- Final export approval

Optional approval gates:

- Per-slide generation approval
- Per-asset approval

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

## 7. Why Workflow Matters

The workflow is the product moat.

One-shot generation can be copied by every model provider. Human-in-the-loop structured creation, locking, partial regeneration, versioning, and review are harder to copy and more valuable for real work.
