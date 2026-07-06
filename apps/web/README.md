# apps/web

Next.js / React / TypeScript Web shell for PPTPilot. Phase 4 lands the workflow
shell pages: project creation (`/`), requirement discovery
(`/projects/[id]/discovery`), and Spec review (`/projects/[id]/review`).

## Scripts

On a fresh checkout, build the workspace deps first — `typecheck`/`test`/`build`
need `@ppt-pilot/shared-schema` and `@ppt-pilot/ppt-engine` `dist/`. From the repo
root, `pnpm run typecheck` chains `shared-schema build → ppt-engine build → web
typecheck` for you.

- `pnpm --filter @ppt-pilot/web dev`
- `pnpm --filter @ppt-pilot/web typecheck`
- `pnpm --filter @ppt-pilot/web test` — Vitest component/interaction tests; all
  `/api` calls are mocked, no real backend/LLM.
- `pnpm --filter @ppt-pilot/web build`
- `pnpm --filter @ppt-pilot/web smoke-start`

The shell imports `@ppt-pilot/shared-schema` through the pnpm workspace and displays a small contract summary on `/`.

## Styling / UI stack

- Tailwind CSS v4 (`@tailwindcss/postcss`), base styles in `src/app/globals.css`.
- shadcn/ui atomic components (button/input/textarea/select/card/label/radio-group) under `src/components/ui`, with the `cn` helper in `src/lib/utils.ts`. Config in `components.json`; the `@/*` import alias maps to `src/*`.

## Backend proxy (`BACKEND_URL`)

`next.config.mjs` rewrites `/api/:path*` to `${BACKEND_URL}/api/:path*`, so the browser always calls same-origin `/api/...` and no backend CORS change is needed.

- `BACKEND_URL` — base URL of the running Phase 3 API. Defaults to `http://127.0.0.1:18000`.

Local dev against the API:

```sh
# terminal 1 — backend (from the repo root)
python3 -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 18000

# terminal 2 — web (BACKEND_URL defaults to http://127.0.0.1:18000)
pnpm --filter @ppt-pilot/web dev
# or point at another backend:
BACKEND_URL=http://127.0.0.1:9000 pnpm --filter @ppt-pilot/web dev
```

Phase 4 stops at Spec confirmation (project stays in `REQUIREMENT_REVIEW`). It
intentionally does not implement HTML preview, Canvas, Konva, PPTX export, AI
generation, or lock-aware regeneration — those belong to later phases.
