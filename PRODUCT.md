# PRODUCT.md

# PPTPilot

AI Presentation IDE for controllable PPT creation.

Version: 0.1

---

## 1. Vision

PPTPilot is an AI-native Presentation IDE. It should feel closer to Cursor or Claude Code than to PowerPoint.

The product must not generate a full deck from one vague sentence and force the user to fix hallucinated structure. It should first understand the user, ask high-value questions, create a structured plan, allow human review, then generate slide content and assets page by page.

## 2. Product Positioning

### One-liner

An AI Presentation IDE that asks, plans, generates, edits, locks, regenerates, and exports controllable PPTs.

### What it is

- A presentation planning workspace
- A slide-level AI generation system
- A structured slide editor
- A human-in-the-loop workflow engine
- A future enterprise brand-compliance platform

### What it is not

- Not a one-shot AI PPT generator
- Not a PowerPoint clone
- Not a pure template marketplace
- Not a chat-only PPT bot

## 3. Target Users

### Phase 1: Individual / small team users

- Developers making technical presentations
- Product managers making product reviews
- Startup founders making pitch decks
- Consultants making client decks
- Trainers making course materials
- Museum educators and interest-education teachers creating child-friendly explanation slides (e.g. exhibit demos for butterflies)

### Phase 2: Team / enterprise users

- Marketing teams
- Sales enablement teams
- Internal strategy teams
- Consulting firms
- Training organizations

## 4. Core Workflow

```text
User Request
  -> Requirement Discovery Agent
  -> Requirement Gap Analysis
  -> Clarifying Questions
  -> Presentation Specification
  -> Outline Planner
  -> Human Review
  -> Slide Planner
  -> Human Review
  -> Slide Generation
  -> Manual Editing
  -> Lock Elements / Pages
  -> Partial Regeneration
  -> Final Review
  -> Export
```

## 5. Core User Stories

### Requirement discovery

As a user, I want the AI to ask me about audience, duration, purpose, tone, style, materials, and output format before generating a deck, so the result does not randomly guess my intent.

### Outline review

As a user, I want to review and edit the outline before slide generation, so the deck structure is correct before visual work begins.

### Slide-level planning

As a user, I want every slide to have a clear objective, key message, visual intent, and layout suggestion before generation.

### Page-level regeneration

As a user, I want to regenerate one page without affecting other pages.

### Element-level regeneration

As a user, I want to lock the title or image while asking AI to rewrite only the bullets, or keep the text while changing layout.

### Style profile selection

As a user, I want to choose a project-level style profile at creation time so that output matches use context (teaching, internal reporting, etc.).

### Image variant choice

As a user, I want to generate multiple image candidates and choose the best one, so regeneration is practical and controlled.

### Export

As a user, I want to export PPTX, PDF, and HTML preview from the same structured deck.

## 6. MVP Scope

> Status (as of writing): the backend pipeline **requirement discovery → outline
> → slide plan → materialize → HTML preview → PPTX export** is built (Phases 3–7;
> the LLM agents run behind an `LLMProvider`, materialize and export are
> deterministic services). The frontend is at the Phase 4 workflow shell
> (create → discovery → spec review). Canvas editing, partial/element
> regeneration, image variants, versioning, and the Review Agent are **future**
> (Phases 8–10). The tiers below are the original roadmap, not current status.

### MVP v0.1

- Requirement discovery chat
- Presentation Spec JSON
- Scene-aware, low-friction requirement questioning (adaptive confidence)
- Outline generation
- Slide plan generation
- HTML preview
- Basic export placeholder
- Initial style profile selection (`education` / `corporate`)

### MVP v0.2

- Slide content generation
- Basic theme system
- AI image prompt generation
- PPTX export
- Duplicate-rate lightweight quality warning

### MVP v0.3

- Canvas editor
- Element selection
- Text editing
- Image replacement
- Page locking
- Element locking
- Element lock-aware image/text regeneration groundwork

### MVP v0.4

- Partial regeneration
- Image variant choice
- Version history
- Diff / accept / reject
- Review Agent

## 7. Design Principles

1. Never generate immediately when requirements are underspecified.
2. Ask only high-value questions.
3. The user must be able to skip questions.
4. Every generated artifact must be structured.
5. Every slide must be independently editable.
6. AI must not modify locked content.
7. PPTX is an export artifact, not the source of truth.
8. The mobile experience is for review and chat, not full canvas editing.

## 8. Key Differentiation

Most AI PPT products follow:

```text
Prompt -> Generate Deck -> User fixes everything
```

PPTPilot follows:

```text
Prompt -> Understand -> Ask -> Spec -> Plan -> Review -> Generate -> Edit -> Lock -> Regenerate -> Export
```

## 9. Product Motto

Build the Cursor for Presentation.
