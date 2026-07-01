# packages/shared-schema

Canonical shared schema contract for PPTPilot structured presentation data.

## Phase 1 scope

- Defines TypeScript contract types for `PresentationSpec`, `Presentation`, `Slide`, `SlidePlan`, `Element`, `Asset`, `Version`, and `Event`.
- Exports enum contracts for `Scene`, `QuestionMode`, `WorkflowState`, `SlideStatus`, `ElementType`, `ActorType`, and `RegenerateScope`.
- Provides runtime validation entrypoints from `src/index.ts`; this is the Phase 1 equivalent of JSON Schema validation and returns field-path errors.
- Provides fixtures under `fixtures/valid`, `fixtures/invalid`, and `fixtures/defaults`.
- Keeps `fixtures/reference/later-phase/locked-write-reference.json` outside Phase 1 gating because runtime lock write protection is not implemented in this phase.

## Commands

```bash
pnpm --filter @ppt-pilot/shared-schema typecheck
pnpm --filter @ppt-pilot/shared-schema validate:fixtures
```

The fixture validator builds the TypeScript package, then validates:

- all `fixtures/valid/*.json` must pass;
- all `fixtures/defaults/*.json` must pass and normalize the expected scene default `styleProfileId`;
- all `fixtures/invalid/*.json` must fail;
- later-phase reference fixtures are not loaded from `fixtures/reference/**`.

## Python / Pydantic consumption strategy

`packages/shared-schema` is the source of truth. FastAPI / Pydantic code must not create incompatible hand-written core entity models.

Phase 1 uses exported runtime validation as the executable schema contract. Python consumers should use one of these compatible paths:

1. consume generated JSON-compatible schema artifacts from this package when that export is added;
2. generate Pydantic models from this package's contract artifacts;
3. call a thin schema-validation adapter that delegates to the built shared-schema package before accepting API or Agent payloads.

Any backend model introduced later must be generated from, or mechanically checked against, this package. If a local Pydantic model is needed for FastAPI ergonomics, it must remain an adapter around the shared contract and must be covered by a smoke check against these fixtures.
