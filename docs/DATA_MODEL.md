# Data Model

## 1. Principle

PPTX is not the source of truth.

The source of truth is a structured Presentation JSON model plus assets and version history.

## 2. Core Entities

```text
Workspace
Project
Presentation
Slide
Element
Asset
Version
Event
ExportArtifact
```

## 3. Presentation

```json
{
  "id": "pres_001",
  "projectId": "proj_001",
  "title": "AI Agent Enterprise Applications",
  "spec": {},
  "theme": {},
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children",
  "slides": [],
  "createdAt": "",
  "updatedAt": ""
}
```

### 3.1 ThemeTokens (Phase 6)

`Presentation.theme` holds a `ThemeTokens` object — the base design tokens a renderer
turns into CSS:

```json
{
  "palette": { "background": "#0B1F3A", "primary": "#4F9CF9", "text": "#F5F7FA" },
  "fonts": { "heading": "Inter, sans-serif", "body": "Inter, sans-serif" },
  "spacing": { "sm": 8, "md": 16, "gutter": "5%" }
}
```

- `palette`: `Record<string,string>`; `fonts`: `Record<string,string>`;
  `spacing`: `Record<string,number|string>`. All three groups must be present and
  non-empty (`validateThemeTokens`).
- `ThemeTokens` is registered as its own entity (`ENTITY_NAMES` / `EntityMap` /
  `validateEntity` / `runtimeValidationEntrypoints`). `validatePresentation` treats
  `theme` **loosely** (any object), so the materializer validates the theme
  explicitly via `validateEntity("ThemeTokens", theme)` **before** persisting — a
  loose `theme` is not enough to guarantee the token contract.

## 4. Presentation Spec

```json
{
  "topic": "",
  "audience": "executives",
  "purpose": "internal sharing",
  "durationMinutes": 20,
  "slideCountTarget": 12,
  "language": "zh-CN",
  "tone": "professional",
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children",
  "style": {
    "visualStyle": "modern",
    "density": "medium",
    "chineseFriendly": true,
    "chinaStyleFriendly": true
  },
  "questionPolicy": {
    "mode": "fast | thorough",
    "sceneThreshold": 0.82,
    "maxQuestions": 3
  },
  "riskNotes": [],
  "constraints": [],
  "sourceMaterials": [],
  "confirmedByUser": false
}
```

### Presentation Spec 最小约束

```text
scene: "education" | "corporate" | "default"
styleProfileId: string | null
questionPolicy:
  mode: "fast" | "thorough"
  sceneThreshold: number (0.0 ~ 1.0)
  maxQuestions: integer >= 1
```

`questionPolicy` 应同时满足：

- 未传 `maxQuestions` 时使用模式默认值：`fast=3`, `thorough=5`
- 未传 `sceneThreshold` 时按 `scene + mode` 映射计算默认值
  - `education`+`fast` -> `0.82`
  - `corporate`+`fast` -> `0.75`
  - `default`+`fast` -> `0.78`
  - `thorough` -> 不低于 `0.85`（按场景策略可覆盖时再调整）

## 5. Slide

```json
{
  "id": "slide_001",
  "presentationId": "pres_001",
  "index": 1,
  "title": "",
  "status": "draft",
  "locked": false,
  "plan": {},
  "elements": [],
  "notes": "",
  "createdAt": "",
  "updatedAt": ""
}
```

Slide status:

```text
draft
planned
generated
reviewed
locked
```

### 5.0 Slide / Element materialization (Phase 6)

Phase 6 deterministically materializes a confirmed `SlidePlan[]` + confirmed
`PresentationSpec` into a `Presentation` that passes `validateEntity("Presentation")`.
No LLM, no network, no Asset this phase. Materialization semantics:

- `presentation.id = pres_{projectId}`; `presentation.spec` embeds the confirmed
  `PresentationSpec`; `presentation.scene == spec.scene`; `presentation.assets = []`.
- Per slide: `slide.id == plan.slideId`, `slide.index` is 1-based, `slide.status =
  "planned"`, `slide.title = plan.title ?? plan.keyMessage` (top-level non-empty), and
  `slide.plan` is a **copy** of the source plan with `requiredAssets = []`.
- Each slide carries a `title` text element, a `body` text placeholder, and — unless
  the visual intent is `text` — one **visual placeholder** element whose `ElementType`
  is mapped from `visualIntent`:

  ```text
  chart      -> chart
  diagram    -> diagram
  comparison -> shape
  timeline   -> shape
  image      -> shape   (image placeholder — see below)
  text       -> (no visual element)
  ```

- **`image` maps to `shape` this phase** (`image -> shape` placeholder convention):
  `validateElement` forces an `image` element to carry `content.assetId`, and there
  are no Assets yet, so an `image` element would fail `validateSlide`. The placeholder
  is a `shape` whose `content` annotates the intent (e.g. `placeholderFor: "image"`).
  `image -> image` is reserved for the later Image-Agent phase that actually produces
  Assets.
- **`requiredAssets = []` / `assets = []` this phase.** The materialized `slide.plan`
  copy empties `requiredAssets` (a non-empty value would fail the
  `validatePresentation` `requiredAssets <-> $.assets` cross-check while `assets` is
  empty). The **source** plan on `project.slidePlans` keeps its original
  `requiredAssets` for a later Image phase.
- Geometry comes from `layoutSuggestion` -> a base-layout token template; an unknown
  layout falls to the default template with a soft note (never a hard failure).
- `createdAt` / `updatedAt` are **deterministic** (a fixed sentinel, never wall-clock)
  so repeat materialization is byte-identical and golden fixtures stay lockable.

The whole `Presentation` (and the `ThemeTokens`) are validated **before** any
persistent write; a failed validation persists nothing and appends no event.

## 5.1 Outline (Phase 5)

Canonical shared-schema entity (registered in `ENTITY_NAMES` / `EntityMap` /
`validateEntity`, consumed by the backend via `validateEntity("Outline", ...)`).
The confirmable, editable structure produced from a confirmed `PresentationSpec`.

```json
{
  "id": "outline_001",
  "sections": [
    { "title": "", "purpose": "", "estimatedSlides": 3 }
  ],
  "confirmedByUser": false,
  "riskNotes": []
}
```

`validateOutline` constraints: `sections` has **at least 1** item, each section
`estimatedSlides >= 1`, and section count `<=` the cap in
`validation-constants`. `OutlineSection` holds **no `slideId` list** — slide
identity's single source of truth is `SlidePlan.slideId`. `confirmedByUser` is
runtime-owned (service-injected).

## 6. Slide Plan

```json
{
  "slideId": "slide-0001",
  "title": "",
  "objective": "",
  "keyMessage": "",
  "contentIntent": "",
  "visualIntent": "diagram",
  "layoutSuggestion": "two-column",
  "requiredAssets": [],
  "riskNotes": []
}
```

`visualIntent` is constrained to the **`VisualIntent` enum** (Phase 5) — a
semantic tightening of the previously free-`string` field, propagated through
`validateSlide` / `validatePresentation`:

```text
VisualIntent: diagram | image | chart | text | comparison | timeline
```

`slideId` is **assigned by the service layer** (deterministic `slide-0001` in
order, unique across the set), never by the LLM — it is the key for the
single-page `PUT /slides/{slideId}/plan` edit. Slide-plan confirmation is tracked
at project level (`slidePlansConfirmed`), since `SlidePlan` has no schema-level
confirmation field.

## 6.1 Style Profile

```json
{
  "id": "style_museum_children",
  "name": "museum-children",
  "scene": "education",
  "vocabulary": "kid-friendly, playful, visual-first",
  "defaultTone": "curious",
  "defaultDensity": "medium",
  "allowedRegenerateScopes": ["text_only", "image_only", "layout_only"],
  "imageGuidance": {
    "mood": "friendly",
    "color": "warm"
  }
}
```

### StyleProfile 最小结构

```text
id: string
name: string
scene: "education" | "corporate" | "default"
```

关系约束：

- `Presentation.scene` 与 `PresentationSpec.scene` 必须是 `education | corporate | default`。
- `Presentation.styleProfileId`、`PresentationSpec.styleProfileId` 必须引用到与该 `scene` 相同 `scene` 的 `StyleProfile`。
- 若 `styleProfileId` 缺省，系统必须按 `scene` 回退到内置默认 id。
- 无效的 `scene`/`styleProfileId` 归属组合必须拒绝入库（失败返回校验错误）。

Built-in default profile IDs:

```text
default -> style_default
education -> style_education_default
corporate -> style_corporate_default
```

If a project omits `styleProfileId`, the system applies the built-in default for the effective `scene`.

## 7. Element

```json
{
  "id": "el_001",
  "slideId": "slide_001",
  "type": "text",
  "content": {},
  "imageVariantsPolicy": {
    "count": 3,
    "selectedAssetId": "asset_img_001"
  },
  "x": 80,
  "y": 60,
  "width": 960,
  "height": 120,
  "rotation": 0,
  "zIndex": 1,
  "style": {},
  "locked": false,
  "metadata": {}
}
```

`imageVariantsPolicy` is optional and belongs to Phase 6 image regeneration. Phase 1 does not require this field.

Element types:

```text
text
image
shape
icon
chart
table
diagram
group
```

## 8. Text Element Content

```json
{
  "kind": "title | subtitle | bullet | paragraph | caption",
  "text": "",
  "richText": null
}
```

## 9. Image Element Content

```json
{
  "assetId": "asset_001",
  "alt": "",
  "crop": {
    "x": 0,
    "y": 0,
    "width": 1,
    "height": 1
  }
}
```

## 10. Asset

```json
{
  "id": "asset_001",
  "type": "image",
  "source": "ai | stock | upload | generated_diagram",
  "url": "",
  "prompt": "",
  "license": {
    "name": "",
    "url": "",
    "attributionRequired": false
  },
  "metadata": {}
}
```

## 11. Version

```json
{
  "id": "ver_001",
  "projectId": "proj_001",
  "scope": "presentation | slide | element",
  "targetId": "slide_001",
  "parentVersionId": null,
  "snapshot": {},
  "diff": {},
  "createdBy": "user | ai",
  "createdAt": ""
}
```

## 12. Event

```json
{
  "id": "evt_001",
  "projectId": "proj_001",
  "type": "SCENE_STYLE_PROFILE_UPDATED",
  "actor": "user | ai | system",
  "payload": {
    "scene": "education",
    "styleProfileId": "style_museum_children",
    "questionPolicy": {
      "mode": "fast",
      "sceneThreshold": 0.82,
      "maxQuestions": 3
    },
    "confidence": 0.72,
    "skippedQuestionIds": []
  },
  "createdAt": ""
}
```

Event types:

```text
SCENE_STYLE_PROFILE_UPDATED
QUESTION_POLICY_APPLIED
REQUIREMENT_QUESTION_ASKED
REQUIREMENT_QUESTION_SKIPPED
PRESENTATION_SPEC_CONFIRMED
WORKFLOW_STATE_CHANGED
OUTLINE_GENERATED       (Phase 5)
OUTLINE_UPDATED         (Phase 5)
OUTLINE_CONFIRMED       (Phase 5)
SLIDE_PLAN_GENERATED    (Phase 5)
SLIDE_PLAN_UPDATED      (Phase 5)
SLIDE_PLAN_CONFIRMED    (Phase 5)
SLIDES_MATERIALIZED     (Phase 6)
PRESENTATION_EXPORTED   (Phase 7)
```

`validateEventPayload` is **fail-closed**: an `EVENT_TYPES` member with no
explicit payload case fails validation (no fail-open pass-through).

Minimum event payloads:

```text
SCENE_STYLE_PROFILE_UPDATED: { previousScene, previousStyleProfileId, scene, styleProfileId }
QUESTION_POLICY_APPLIED: { mode, sceneThreshold, maxQuestions, confidence, thresholdReached }
REQUIREMENT_QUESTION_ASKED: { questionId, prompt, kind, options, confidenceBefore }
REQUIREMENT_QUESTION_SKIPPED: { questionId, reason, confidenceAfter, riskNote }
PRESENTATION_SPEC_CONFIRMED: { presentationSpecId, scene, styleProfileId, questionPolicy, riskNotes, nextState }
WORKFLOW_STATE_CHANGED: { previousState, nextState }  (initiator via top-level Event.actor, not payload)
OUTLINE_GENERATED: { sectionCount, nextState }
OUTLINE_UPDATED: { sectionCount, nextState }
OUTLINE_CONFIRMED: { sectionCount, nextState }
SLIDE_PLAN_GENERATED: { slideCount, slideIds, nextState }
SLIDE_PLAN_UPDATED: { slideId, nextState }
SLIDE_PLAN_CONFIRMED: { slideCount, nextState }
SLIDES_MATERIALIZED: { slideCount (int, min 1), nextState }
PRESENTATION_EXPORTED: { artifactId, format ("pptx"), byteSize (int, min 1), nextState }
```

Phase 7 adds **only** `PRESENTATION_EXPORTED` (the sole emitter is `export`).
`nextState == EXPORT_READY` (the current state): export does **not** advance the
workflow, so it appends no `WORKFLOW_STATE_CHANGED`. The event is validated before it
is appended (validate-before-append, fail-closed), so a rejected export appends nothing.

Phase 6 adds **only** `SLIDES_MATERIALIZED` (no `PRESENTATION_UPDATED` this phase —
there is no emitter for it yet; edit/regenerate emitters arrive with Phase 8).
`nextState` equals the current state because materialization does not advance the
workflow. The event is validated before it is appended (validate-before-append,
fail-closed), so a rejected materialization appends nothing.

## 12.1 ExportArtifact (Phase 7)

Canonical shared-schema entity (registered in `ENTITY_NAMES` / `EntityMap` /
`validateEntity` / `runtimeValidationEntrypoints`). A downloadable, self-contained
deliverable produced by deterministically exporting a persisted `Presentation` to a
`.pptx`. The exporter consumes the **same `Presentation` model** the renderer does.

```json
{
  "id": "pres_proj_001_export_1",
  "projectId": "proj_001",
  "format": "pptx",
  "bytesBase64": "UEsDBBQ...",
  "byteSize": 30219,
  "sourcePresentationId": "pres_proj_001",
  "createdBy": "ai",
  "createdAt": ""
}
```

`validateExportArtifact` is a **structural** check only: `format == "pptx"`, `byteSize`
an integer `>= 1`, `bytesBase64` non-empty and matching the base64 charset, and all of
`id`/`projectId`/`sourcePresentationId`/`createdBy`/`createdAt` present. It does **not**
decode the base64 (an `ExportArtifact` is only ever service-constructed, never untrusted
client input, and decoding megabytes on every `validateEntity` is wasteful). The
`byteSize == len(decoded)` equality is a **service-side invariant** (the service sets
`byteSize` and `bytesBase64` from the same bytes) asserted by export pytest, not the
validator.

- `id` is **deterministic**: `f"{presentation.id}_export_{n}"`, `n = len(project.exports)
  + 1` (append-monotonic, no collision across repeat exports). `createdAt` is a
  deterministic sentinel (never wall-clock) so repeat exports stay structurally identical.
- **Geometry / placeholder mapping**: each `Element` maps to one pptx shape. Geometry
  scales from the exporter's canvas convention `1280×720 px` (an **export mapping
  convention, not a shared-schema/renderer contract**) to the **exact 16:9 EMU** slide
  `12192000×6858000` (never `Inches(13.333)`), integer `Emu`, `zIndex` ascending add order,
  off-canvas allowed to overflow, `width/height == 0` → a degenerate `Emu(0)` shape.
  `text` → textbox (`str(content.text or "")`); **all 8 `ElementType`s are covered** —
  every non-text type (`image`/`shape`/`icon`/`chart`/`table`/`diagram`/`group`, one
  `else` branch) → a labeled placeholder rectangle. No real charts/images this phase.
- **`sourcePresentationId` is best-effort provenance, not a revision-unique reference.**
  `presentation.id = pres_{projectId}` is project-level stable, not revision-unique: after
  a deep rollback that clears `presentation` and a re-materialization, a new presentation
  reuses the **same id**, so an older `ExportArtifact.sourcePresentationId` then points at a
  replaced presentation. Revision uniqueness is a later-phase (versioning) concern; the
  artifact **bytes** are the authoritative, self-contained deliverable (the download stays
  valid). `project.exports` is append-only history — workflow rollback never clears it.

## 13. Lock Model

Locks should exist on both slides and elements.

```json
{
  "locked": true,
  "lockedBy": "user",
  "lockedAt": "",
  "lockReason": "approved by user"
}
```

## 14. Schema Strategy

Use shared schemas in `packages/shared-schema`.

Generate:

- TypeScript types
- Python Pydantic models
- JSON Schema for validation

Do not duplicate schema logic manually.
