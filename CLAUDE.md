# CLAUDE.md

## Project

PPTPilot is an AI Presentation IDE for controllable PPT creation.

The product should feel closer to Cursor for presentations than to a one-shot AI PPT generator.

## Before Coding

Read:

- `PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/AGENTS.md`
- `docs/DATA_MODEL.md`
- `docs/WORKFLOW.md`
- `docs/TASKS.md`

## Implementation Guidance

Start with the workflow and schema, not visual polish.

Recommended first milestone:

1. Create monorepo structure.
2. Implement shared schemas.
3. Implement FastAPI skeleton.
4. Implement mocked Requirement Discovery Agent.
5. Implement Outline Agent with mocked LLM provider.
6. Implement basic Next.js screens for requirement/spec/outline flow.

## Product Constraints

- Never generate a deck directly from a vague prompt.
- Always create/confirm Presentation Spec first.
- AI outputs must be schema validated.
- Locked slides/elements must not be modified.
- PPTX is not the source of truth.

## Coding Style

- Keep modules small.
- Prefer explicit types.
- Add tests around schema validation and lock behavior.
- Keep LLM providers behind interfaces.
- Make it easy to swap OpenAI/Anthropic/Gemini/local models.
