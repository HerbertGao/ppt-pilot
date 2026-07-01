# apps/web

Next.js / React / TypeScript minimal Web shell for PPTPilot Phase 1.

## Scripts

- `pnpm --filter @ppt-pilot/web dev`
- `pnpm --filter @ppt-pilot/web typecheck`
- `pnpm --filter @ppt-pilot/web build`
- `pnpm --filter @ppt-pilot/web smoke-start`

The shell imports `@ppt-pilot/shared-schema` through the pnpm workspace and displays a small contract summary on `/`.

This task group intentionally does not implement Requirement Discovery, Spec Review, HTML preview, Canvas, Konva, PPTX export, AI generation, or lock-aware regeneration.
