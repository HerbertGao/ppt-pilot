# packages/ppt-engine

Pure-function HTML preview renderer for the canonical `Slide`/`Presentation` model
from `@ppt-pilot/shared-schema` — the same structural model PPTX export will consume.

- `renderSlide(slide, theme)` / `renderPresentation(presentation)` → deterministic HTML.
- Context-aware escaping (text/attribute) plus a CSS property allowlist with
  dangerous-value sanitization — a trust boundary, not cosmetic.
- Deterministic key ordering so golden fixtures stay stable.
- Thumbnail placeholders are deterministic inline SVG (no headless browser).

Not in this phase: real content generation, layout/image agents, canvas editing,
lock-aware runtime, and raster thumbnails.
