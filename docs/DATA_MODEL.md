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

## 6. Slide Plan

```json
{
  "objective": "",
  "keyMessage": "",
  "contentIntent": "",
  "visualIntent": "diagram",
  "layoutSuggestion": "two-column",
  "requiredAssets": [],
  "riskNotes": []
}
```

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
```

Minimum event payloads:

```text
SCENE_STYLE_PROFILE_UPDATED: { previousScene, previousStyleProfileId, scene, styleProfileId }
QUESTION_POLICY_APPLIED: { mode, sceneThreshold, maxQuestions, confidence, thresholdReached }
REQUIREMENT_QUESTION_ASKED: { questionId, prompt, kind, options, confidenceBefore }
REQUIREMENT_QUESTION_SKIPPED: { questionId, reason, confidenceAfter, riskNote }
PRESENTATION_SPEC_CONFIRMED: { presentationSpecId, scene, styleProfileId, questionPolicy, riskNotes, nextState }
WORKFLOW_STATE_CHANGED: { previousState, nextState }  (initiator via top-level Event.actor, not payload)
```

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
