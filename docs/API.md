# API Draft

## 1. API Style

Use REST for MVP.

Phase 1 implements only the FastAPI shell health endpoint plus the command-line
shared-schema smoke check. Project creation, scene/style profile selection,
requirement discovery, Presentation Spec confirmation, and the other business
APIs below are roadmap drafts for later phases unless their OpenSpec change is
active and implemented.

Implemented in Phase 1:

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "service": "ppt-pilot-api",
  "phase": "phase-1-foundation"
}
```

Shared-schema API bridge smoke is validated by command, not by an HTTP route:

```bash
PYTHONPATH=apps/api python3 -m app.shared_schema_smoke
```

Future options:

- WebSocket for long-running generation progress
- Server-Sent Events for streaming agent logs
- GraphQL is not necessary for MVP

## 2. Project APIs (Roadmap Draft)

### Create Project

```http
POST /api/projects
```

Request:

```json
{
  "title": "AI Agent Enterprise Applications",
  "initialRequest": "做一个面向管理层的 AI Agent 企业应用 PPT",
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children"
}
```

场景与风格的默认值：

- `scene` 未传时默认 `default`。
- `styleProfileId` 未传时，按 `scene` 应用内置默认 profile（见 Data Model）。

Response:

```json
{
  "projectId": "proj_001",
  "status": "REQUIREMENT_DISCOVERY"
}
```

### Get Project

```http
GET /api/projects/{projectId}
```

### Update Project Scene/Profile

```http
PATCH /api/projects/{projectId}/profile
```

Request:

```json
{
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children"
}
```

Notes:

- Allowed only before Presentation Spec confirmation. After confirmation, the user must return to requirement review/discovery before changing scene/style.
- `scene` must be one of `education`, `corporate`, or `default`.
- `styleProfileId` must exist and belong to the selected `scene`; omitted value falls back to the scene default profile.
- Successful updates record `SCENE_STYLE_PROFILE_UPDATED`.
- 当 `scene` 或 `styleProfileId` 校验失败时返回 400，并且不得写入任何持久状态（包括更新事件）。

无效场景/无效风格归属时的错误示例：

```json
{
  "error": "VALIDATION_ERROR",
  "code": "INVALID_SCENE",
  "details": {
    "field": "scene",
    "value": "education2",
    "message": "scene must be one of education, corporate, default"
  }
}
```

```json
{
  "error": "VALIDATION_ERROR",
  "code": "STYLE_PROFILE_MISMATCH",
  "details": {
    "field": "styleProfileId",
    "value": "style_corporate_default",
    "scene": "education",
    "message": "styleProfileId does not belong to scene"
  }
}
```

## 3. Requirement APIs (Roadmap Draft)

### Start Requirement Discovery

```http
POST /api/projects/{projectId}/requirements/discover
```

Request:

```json
{
  "mode": "fast | thorough",
  "maxQuestions": 3,
  "scene": "education | corporate | default",
  "styleProfileId": "style_museum_children"
}
```

Notes:

- `mode` defaults to `fast`.
- `maxQuestions` defaults to `3` in `fast` mode and `5` in `thorough` mode.
- `scene` 与 `styleProfileId` 为可选，未提供时使用项目已保存的上下文（fallback to project defaults）。
- `scene` 不合法、或 `styleProfileId` 不属于当前 `scene` 时返回 400 校验错误，不进入需求发现流程。

Response:

```json
{
  "questions": [
    {
      "questionId": "q_001",
      "kind": "multiple_choice",
      "prompt": "这份演示主要给谁看？",
      "options": ["小朋友", "家长", "内部同事", "其它"],
      "freeTextAllowed": true
    }
  ],
  "confidence": 0.72,
  "threshold": 0.82,
  "thresholdReached": false,
  "skippedQuestionIds": [],
  "nextState": "REQUIREMENT_DISCOVERY"
}
```

### Answer Question

```http
POST /api/projects/{projectId}/requirements/questions/{questionId}/answer
```

Request:

```json
{
  "answer": "面向公司高管，20分钟，偏商业价值"
}
```

Response:

```json
{
  "confidence": 0.84,
  "threshold": 0.82,
  "thresholdReached": true,
  "skippedQuestionIds": [],
  "nextState": "REQUIREMENT_REVIEW"
}
```

### Confirm Spec

```http
POST /api/projects/{projectId}/requirements/confirm
```

Request:

```json
{
  "styleProfileId": "style_museum_children",
  "allowSkip": true
}
```

Response:

```json
{
  "presentationSpecId": "spec_001",
  "confirmed": true,
  "scene": "education",
  "styleProfileId": "style_museum_children",
  "questionPolicy": {
    "mode": "fast",
    "sceneThreshold": 0.82,
    "maxQuestions": 3
  },
  "riskNotes": [],
  "nextState": "OUTLINE_GENERATION"
}
```

Notes:

- Confirmation snapshots the effective `scene`, `styleProfileId`, and `questionPolicy` into `PresentationSpec`.
- Successful confirmation records `PRESENTATION_SPEC_CONFIRMED`.

## 4. Outline APIs (Roadmap Draft)

### Generate Outline

```http
POST /api/projects/{projectId}/outline/generate
```

### Update Outline

```http
PUT /api/projects/{projectId}/outline
```

### Confirm Outline

```http
POST /api/projects/{projectId}/outline/confirm
```

## 5. Slide Plan APIs (Roadmap Draft)

### Generate Slide Plans

```http
POST /api/projects/{projectId}/slides/plans/generate
```

### Update Slide Plan

```http
PUT /api/projects/{projectId}/slides/{slideId}/plan
```

## 6. Slide Generation APIs

These APIs are roadmap drafts for later phases. They are not part of Phase 1 requirement discovery.

### Generate Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/generate
```

### Regenerate Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/regenerate
```

Request:

```json
{
  "scope": "text_only | image_only | layout_only | full_slide",
  "instruction": "保持结构不变，让表达更适合高管",
  "imageVariants": 3
}
```

Response:

```json
{
  "jobId": "job_001",
  "status": "queued"
}
```

Successful job result for image regeneration may include generated variants:

```json
{
  "jobId": "job_001",
  "status": "succeeded",
  "imageVariants": [
    {
      "assetId": "asset_img_001",
      "thumbUrl": "https://.../thumb1.png",
      "prompt": "..."
    }
  ]
}
```

### Regenerate Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/regenerate
```

Request:

```json
{
  "scope": "text_only | image_only | layout_only | full",
  "preserveLocked": true,
  "imageVariants": 3
}
```

Notes:

- `scope` 为元素级枚举，`full` 表示仅该元素全量重生（即替换该元素全部可生成项）；`full_slide` 仅用于 `/slides/{slideId}/regenerate`。

### Choose Image Variant

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/image-variants/{assetId}/select
```

Request:

```json
{
  "assetId": "asset_img_001"
}
```

## 7. Editing APIs (Roadmap Draft)

### Update Element

```http
PATCH /api/projects/{projectId}/slides/{slideId}/elements/{elementId}
```

### Lock Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/lock
```

### Unlock Element

```http
POST /api/projects/{projectId}/slides/{slideId}/elements/{elementId}/unlock
```

### Lock Slide

```http
POST /api/projects/{projectId}/slides/{slideId}/lock
```

## 8. Review APIs

Review APIs are later-phase drafts after slide generation exists.

### Run Review

```http
POST /api/projects/{projectId}/review
```

Response:

```json
{
  "score": 0.82,
  "issues": []
}
```

### Run Duplicate Rate Check

```http
POST /api/projects/{projectId}/review/duplicate-check
```

Response:

```json
{
  "duplicateRate": 0.21,
  "level": "warning",
  "items": []
}
```

## 9. Export APIs (Roadmap Draft)

### Export

```http
POST /api/projects/{projectId}/export
```

Request:

```json
{
  "format": "pptx | pdf | html"
}
```

Response:

```json
{
  "artifactId": "export_001",
  "status": "processing"
}
```

### Download Export

```http
GET /api/exports/{artifactId}/download
```

## 10. Async Job Model

Generation and export should return job IDs.

```json
{
  "jobId": "job_001",
  "status": "queued"
}
```

Job statuses:

```text
queued
running
succeeded
failed
cancelled
```

## 11. Streaming Logs Later

Use SSE:

```http
GET /api/jobs/{jobId}/events
```

Event examples:

```text
agent.started
agent.question.generated
agent.question.stopped_by_threshold
agent.output.validated
asset.generated
asset.variants.generated
slide.rendered
slide.duplicate.check
export.completed
```
