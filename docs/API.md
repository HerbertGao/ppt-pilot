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

## 2. Project APIs

Phase 2 (implemented): `POST /api/projects`, `GET /api/projects/{projectId}`, and
`POST /api/projects/{projectId}/transitions`. `PATCH /api/projects/{projectId}/profile`
is implemented in **Phase 3** (see the Update Project Scene/Profile section below).

All Phase 2/3 business errors follow the unified error convention in §2.4.

### Create Project (Phase 2 implemented)

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
  "status": "NEW_PROJECT"
}
```

创建落地的初始状态为 `NEW_PROJECT`。创建时的 `scene`/`styleProfileId` 归属校验失败返回统一错误（`INVALID_SCENE` / `STYLE_PROFILE_MISMATCH`，见 §2.4），且不写入任何持久状态。

### Get Project (Phase 2 implemented)

```http
GET /api/projects/{projectId}
```

Response:

```json
{
  "projectId": "proj_001",
  "title": "...",
  "scene": "default",
  "styleProfileId": "style_default",
  "status": "NEW_PROJECT"
}
```

- 项目不存在时返回 `code=PROJECT_NOT_FOUND`（见 §2.4）。
- 读取无副作用。

### Transition Workflow State (Phase 2 implemented)

```http
POST /api/projects/{projectId}/transitions
```

Request:

```json
{
  "to": "REQUIREMENT_DISCOVERY"
}
```

Response:

```json
{
  "projectId": "proj_001",
  "status": "REQUIREMENT_DISCOVERY"
}
```

Notes:

- 合法边：前向 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`（Phase 2），Phase 5 追加 `REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW` 前向链及各自的回退边（见 §4/§5 与 `docs/WORKFLOW.md`）。`SLIDE_PLAN_REVIEW` 之后的边留待 Phase 6。转移保持 LLM-free 且结构化（前向边不加内容守卫）；回退边 None-safe 清空对应下游产物。
- 每次成功转移追加一条 `WORKFLOW_STATE_CHANGED` 事件（`actor=user`，`payload={previousState, nextState}`，见 Data Model）。
- 错误码：未知状态字符串 → `INVALID_WORKFLOW_STATE`；已知状态但非法邻接边 → `INVALID_STATE_TRANSITION`；项目不存在 → `PROJECT_NOT_FOUND`；缺失/畸形请求体或缺 `to` → `INVALID_REQUEST_BODY`（见 §2.4）。
- 任一失败路径都不改状态、不追加事件。

### Update Project Scene/Profile (Phase 3 implemented)

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

- `scene` must be one of `education`, `corporate`, or `default`.
- `styleProfileId` must exist and belong to the selected `scene`; omitted value falls back to the scene default profile.
- Successful updates record `SCENE_STYLE_PROFILE_UPDATED`.
- Allowed freely before Presentation Spec confirmation. **After confirmation**, changing scene/style is rejected with `SPEC_NOT_CONFIRMABLE`（见 §2.4）until the project is first rolled back `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY`（复用工作流状态机既有回退边）。That rollback resets `confirmedByUser=false` and voids the confirmed `PresentationSpec` snapshot, so the Spec must be re-confirmed after the profile change.
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

### 2.4 Unified Error Convention (Phase 2, extended in Phase 3)

所有业务 API 的错误响应使用统一结构 `{error, code, details}`：`error` 为错误分类，`code` 为稳定的机器可读错误码，`details` 含 `field` / `message` 等定位信息。

错误分类 → 错误码映射（稳定且明确）：

```text
VALIDATION_ERROR -> INVALID_SCENE | STYLE_PROFILE_MISMATCH | INVALID_WORKFLOW_STATE | INVALID_REQUEST_BODY | SPEC_VALIDATION_ERROR | OUTLINE_VALIDATION_ERROR | SLIDE_PLAN_VALIDATION_ERROR   (HTTP 400)
STATE_ERROR      -> INVALID_STATE_TRANSITION | SPEC_NOT_CONFIRMABLE | OUTLINE_NOT_CONFIRMABLE | SLIDE_PLAN_NOT_CONFIRMABLE                                                                          (HTTP 409)
NOT_FOUND        -> PROJECT_NOT_FOUND | QUESTION_NOT_FOUND | OUTLINE_NOT_FOUND | SLIDE_PLAN_NOT_FOUND                                                                                                (HTTP 404)
UPSTREAM_ERROR   -> LLM_PROVIDER_ERROR                                                                                                                                                             (HTTP 502)
```

Phase 3 新增码：`SPEC_VALIDATION_ERROR`（Spec 未过 schema 校验）、`QUESTION_NOT_FOUND`（未知 `questionId`）、`SPEC_NOT_CONFIRMABLE`（确认前置状态不满足，或确认后未回退即改 profile）、`LLM_PROVIDER_ERROR`（`LLMProvider` 上游/超时失败，映射为 HTTP 502，不泄漏框架默认体）。

Phase 5 新增码（均为既有基类子类，复用既有分组映射）：`OUTLINE_VALIDATION_ERROR` / `SLIDE_PLAN_VALIDATION_ERROR`（产物未过 schema 校验，400）、`OUTLINE_NOT_CONFIRMABLE`（已在 `OUTLINE_GENERATION` 但 Spec 未确认或为 None，409）、`SLIDE_PLAN_NOT_CONFIRMABLE`（大纲未确认或为 None，409）、`OUTLINE_NOT_FOUND` / `SLIDE_PLAN_NOT_FOUND`（confirm/GET 无产物，或规划为空，404）。**在错误的状态下调用大纲/规划动作端点**（与内容前置无关）判为 `INVALID_STATE_TRANSITION`（409）；动作端点没有 `to` 语义，故抛出点清除默认 `details.field="to"`（该字段返回为空）。

框架原生错误（畸形 JSON / 字段类型错误触发的 `RequestValidationError`，以及 `HTTPException`）经异常处理器映射为同一结构（`error=VALIDATION_ERROR`、`code=INVALID_REQUEST_BODY`），不返回 FastAPI 默认的 `detail` 数组。

当多种错误条件同时成立时的判定优先级：

```text
INVALID_REQUEST_BODY  >  PROJECT_NOT_FOUND  >  目标状态校验 (INVALID_WORKFLOW_STATE / INVALID_STATE_TRANSITION)
```

任何被拒绝的请求都不产生持久副作用（不创建/更新项目、不推进状态、不追加事件）。错误结构示例：

```json
{
  "error": "STATE_ERROR",
  "code": "INVALID_STATE_TRANSITION",
  "details": {
    "field": "to",
    "message": "..."
  }
}
```

## 3. Requirement APIs (Phase 3 implemented)

需求发现由 `LLMProvider` 驱动（CI 与本地默认走确定性 mock）。所有接口沿用 §2.4 统一错误约定与错误优先级；被拒绝的请求不改状态、不追加事件。新增错误码见 §2.4（`SPEC_VALIDATION_ERROR`、`QUESTION_NOT_FOUND`、`SPEC_NOT_CONFIRMABLE`、`LLM_PROVIDER_ERROR`）。

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

Notes:

- 作答仅更新置信度，**不追加事件**（无对应事件类型；仅当因此重新提问才会再触发 `REQUIREMENT_QUESTION_ASKED`）。
- 未知 `questionId` 返回 `QUESTION_NOT_FOUND`（见 §2.4），不更新置信度、不追加事件。

### Skip Question

```http
POST /api/projects/{projectId}/requirements/questions/{questionId}/skip
```

Response:

```json
{
  "confidence": 0.72,
  "threshold": 0.82,
  "thresholdReached": false,
  "skippedQuestionIds": ["q_001"],
  "nextState": "REQUIREMENT_DISCOVERY"
}
```

Notes:

- 跳过把该问题记入 `riskNotes` 并追加 `REQUIREMENT_QUESTION_SKIPPED`。
- 未知 `questionId` 返回 `QUESTION_NOT_FOUND`（见 §2.4），无持久副作用。

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
  "nextState": "REQUIREMENT_REVIEW"
}
```

Notes:

- Confirmation snapshots the effective `scene`, `styleProfileId`, and `questionPolicy` into `PresentationSpec`, sets `confirmedByUser=true`, and records `PRESENTATION_SPEC_CONFIRMED`（payload `nextState=REQUIREMENT_REVIEW`）。
- **确认不推进工作流状态**（D3）：项目停留在 `REQUIREMENT_REVIEW`，不进入 `OUTLINE_GENERATION`（outline 生成属 Phase 5，前向边由归属阶段加入）。
- confirm 仅在 `state == REQUIREMENT_REVIEW` 时允许，否则返回 `SPEC_NOT_CONFIRMABLE`（见 §2.4）。
- Spec 未通过 schema 校验时返回 `SPEC_VALIDATION_ERROR`（见 §2.4），不置位确认、不追加事件。

## 4. Outline APIs (Phase 5 implemented)

大纲由 Outline Agent（隐藏在 `LLMProvider` 后，CI 默认走确定性 mock）从**已确认**的 `PresentationSpec` 生成。动作端点**不自行推进工作流状态**（沿用 Phase 2/3，前向转移由 `POST /transitions` 驱动）。所有接口沿用 §2.4 统一错误约定；被拒绝的请求不改状态、不追加事件。

`Outline` 结构：`{ id?, sections: [{ title, purpose, estimatedSlides }], confirmedByUser, riskNotes? }`。section 至少 1 项，每 section `estimatedSlides ≥ 1`，section 数 ≤ 上限（`validation-constants` 暴露）。`confirmedByUser` 为 runtime 拥有字段（服务层注入，忽略请求体传入值）。

### Generate Outline

```http
POST /api/projects/{projectId}/outline/generate
```

- 前置：`state == OUTLINE_GENERATION` 且 `spec` 已确认（`spec is not None and spec.confirmedByUser`，None-safe）。
- 成功返回完整 `Outline`（`confirmedByUser=false`），追加 `OUTLINE_GENERATED`（payload `sectionCount` + `nextState`）。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；Spec 未确认或为 None → `OUTLINE_NOT_CONFIRMABLE`；生成产物校验不过（有界修复耗尽）→ `OUTLINE_VALIDATION_ERROR`；`LLMProvider` 上游失败 → `LLM_PROVIDER_ERROR`。

### Update Outline

```http
PUT /api/projects/{projectId}/outline
```

- 前置：`state ∈ {OUTLINE_GENERATION, OUTLINE_REVIEW}`；请求体过 `Outline` 校验。
- 人工整份替换大纲；服务强制 `confirmedByUser=false`（编辑作废确认）。成功追加 `OUTLINE_UPDATED`（payload `sectionCount` + `nextState`）。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；校验不过 → `OUTLINE_VALIDATION_ERROR`（无副作用）。

### Confirm Outline

```http
POST /api/projects/{projectId}/outline/confirm
```

- 前置：`state == OUTLINE_REVIEW` 且大纲存在。置 `confirmedByUser=true`，**不推进状态**，追加 `OUTLINE_CONFIRMED`（payload `sectionCount` + `nextState`）。
- 重复确认**重放安全**（非严格幂等）：再次调用仍 200 并再追加一条 `OUTLINE_CONFIRMED`。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；无大纲 → `OUTLINE_NOT_FOUND`。

### Get Outline

```http
GET /api/projects/{projectId}/outline
```

- 读回持久化的完整 `Outline`；无副作用。无大纲 → `OUTLINE_NOT_FOUND`。

## 5. Slide Plan APIs (Phase 5 implemented)

逐页 `SlidePlan` 由 Slide Planner Agent 从**已确认**的大纲生成。`slideId` 由**服务层**确定性赋值（`slide-0001` 按序、集合内唯一），非 LLM。规划确认态存于项目级 `slidePlansConfirmed`（`SlidePlan` 无 schema 确认字段）。动作端点不自行推进状态。

`SlidePlan` 结构：`{ slideId, title?, objective, keyMessage, contentIntent, visualIntent, layoutSuggestion, requiredAssets, riskNotes }`，其中 `visualIntent ∈ {diagram, image, chart, text, comparison, timeline}`（`VisualIntent` 枚举）。读接口返回 `{ slidePlans: SlidePlan[], slidePlansConfirmed }`。

### Generate Slide Plans

```http
POST /api/projects/{projectId}/slides/plans/generate
```

- 前置：`state == SLIDE_PLANNING` 且 `outline` 已确认（`outline is not None and outline.confirmedByUser`，None-safe）。
- 服务赋 `slideId`、**整体覆盖** `slidePlans`、置 `slidePlansConfirmed=false`（重新生成丢弃此前 `PUT` 编辑并作废确认——显式声明的语义）。追加 `SLIDE_PLAN_GENERATED`（payload `slideCount` + `slideIds` + `nextState`）。
- `estimatedSlides` 与某 section 实际页数不符时，向该 section 首页追加软 `riskNote`（不硬失败）。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；大纲未确认或为 None → `SLIDE_PLAN_NOT_CONFIRMABLE`；产物校验/唯一性/总页数上限不过 → `SLIDE_PLAN_VALIDATION_ERROR`；上游失败 → `LLM_PROVIDER_ERROR`。

### Update Slide Plan

```http
PUT /api/projects/{projectId}/slides/{slideId}/plan
```

- 前置：`state ∈ {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}` 且路径 `slideId` 存在；请求体过 `SlidePlan` 校验。
- 编辑单页；**服务强制该页 `slideId=路径值`（忽略请求体 id），覆盖后重校验集合唯一性**；置 `slidePlansConfirmed=false`。追加 `SLIDE_PLAN_UPDATED`（payload `slideId` + `nextState`）。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；未知 `slideId` → `SLIDE_PLAN_NOT_FOUND`；校验不过 → `SLIDE_PLAN_VALIDATION_ERROR`（无副作用）。

### Confirm Slide Plans

```http
POST /api/projects/{projectId}/slides/plans/confirm
```

- 前置：`state == SLIDE_PLAN_REVIEW` 且规划**非空**。置 `slidePlansConfirmed=true`，**不推进状态**，追加 `SLIDE_PLAN_CONFIRMED`（payload `slideCount` + `nextState`）。重复确认**重放安全**。
- 错误：错误状态 → `INVALID_STATE_TRANSITION`；无规划或规划为空 → `SLIDE_PLAN_NOT_FOUND`。

### Get Slide Plans

```http
GET /api/projects/{projectId}/slides/plans
```

- 读回 `{ slidePlans, slidePlansConfirmed }`；无副作用。无规划或规划为空 → `SLIDE_PLAN_NOT_FOUND`。

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
