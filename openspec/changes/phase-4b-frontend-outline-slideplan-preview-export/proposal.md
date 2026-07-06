## 为什么

Phase 5–7 已把后端管线贯通：outline（`POST /outline/generate`、`PUT /outline`、`POST /outline/confirm`、`GET /outline`）、slide plan（`POST /slides/plans/generate`、`PUT /slides/{id}/plan`、`POST /slides/plans/confirm`、`GET /slides/plans`）、materialize + 预览（`POST /slides/materialize`、`GET /presentation`）、PPTX 导出（`POST /export`、`GET /export/{id}`、`GET /exports`）全部落地并经 193 个 pytest 覆盖。

但前端停在 Phase 4：`apps/web/src/app/projects/[id]/` 只有 `discovery` 与 `review` 两个页面。**用户无法从 Web UI 走完「确认 Spec → 生成大纲 → 复核大纲 → 生成规划 → 复核规划 → 物化预览 → 导出 PPTX」链路**——后端能力对用户不可达。`PRODUCT.md` §6 MVP v0.1 明列「Outline generation / Slide plan generation / HTML preview / Basic export」为 MVP 必备项，当前前端缺位。

本变更是 Phase 8（画布编辑与锁定）的**前置依赖**：没有预览页就没有可编辑对象，没有物化链路就无法承载锁定/再生。本期纯前端，**零后端改动**（所有 API 已存在），把 Phase 5–7 后端能力映射为可用的 Next.js 工作流页面。

## 设计决策（本提案已定，`/review-loop` 前可改）

- **D1-纯前端**：不新增/不改任何后端路由、schema、事件、状态机边。所有数据来自既有 Phase 5–7 端点。
- **D2-转移驱动沿用 Phase 4**：动作端点（generate/update/confirm/materialize/export）**不推进状态**，前向推进**只**经显式 `POST /transitions`。扩展 `workflow.ts` 的 planner 覆盖 `REQUIREMENT_REVIEW → … → EXPORTED` 全链。
- **D3-生成动作链式**：「进入生成态 → 调生成端点 → 进入复核态」三步链式，中间态（`OUTLINE_GENERATION`/`SLIDE_PLANNING`/`SLIDE_GENERATION`）对用户表现为 loading；生成失败留在生成态、页面显示错误 + 重试（重试只重调生成端点 + 后续转移，不重复前驱转移）。
- **D4-挂载守卫**：每个步骤页 mount 时按 `state → 期望页` 映射重定向（与 Phase 4 `guardReviewMount`/`guardDiscoveryMount` 同构），错位时导航到当前态对应页，避免无会话/无内容的死页面。
- **D5-预览消费 ppt-engine**：前端新增 `@ppt-pilot/ppt-engine` 依赖，`GET /presentation` 拿结构化 `Presentation`，调 `renderPresentation(presentation)` 得 HTML 字符串注入页面（渲染器已做上下文感知转义 + CSS 白名单，注入安全由渲染器保证）。
- **D6-导出下载**：`GET /export/{id}` 返回 pptx 二进制流，前端用 `fetch` + `Blob` + `<a download>` 触发浏览器下载（不用 window.location，避免离开页面）；`GET /exports` 仅元数据列表，点击单项下载。
- **D7-错误处理**：复用既有 `ApiError`（`apps/web/src/lib/api.ts`），按 `code` 映射用户可读提示；网络错误已有 `NETWORK_ERROR` 合成码。

## 变更内容

- **大纲复核页（新，`apps/web/src/app/projects/[id]/outline/page.tsx`）**：
  - `state==OUTLINE_GENERATION`：显示 loading（链式生成进行中）或错误 + 重试（重调 `POST /outline/generate` → `POST /transitions {to:OUTLINE_REVIEW}`）。
  - `state==OUTLINE_REVIEW`：`GET /outline` 拉取已生成大纲，渲染 section 列表（title / purpose / estimatedSlides）支持就地编辑、增删 section、重排（前端数组操作，保存调 `PUT /outline` 整体替换）；「确认大纲」调 `POST /outline/confirm`（停在 `OUTLINE_REVIEW`）；确认后显示「生成幻灯片规划」CTA → 链式转移 → 导航到 `/slide-plans`。
  - `state>OUTLINE_REVIEW`：守卫接受集不含这些态 → 重定向到 `currentStepPath(state)`（本期不做只读大纲旁路）。
- **规划复核页（新，`apps/web/src/app/projects/[id]/slide-plans/page.tsx`）**：
  - `state==SLIDE_PLANNING`：loading / 错误 + 重试（重调 `POST /slides/plans/generate` → `POST /transitions {to:SLIDE_PLAN_REVIEW}`）。
  - `state==SLIDE_PLAN_REVIEW`：`GET /slides/plans` 拉取 plan 列表，逐页卡片（slideId / title / objective / keyMessage / contentIntent / visualIntent / layoutSuggestion）支持编辑单页（`PUT /slides/{slideId}/plan`）；「确认规划」调 `POST /slides/plans/confirm`；确认后显示「物化幻灯片」CTA → 链式转移 → 导航到 `/preview`。
  - `state>SLIDE_PLAN_REVIEW`：守卫接受集不含这些态 → 重定向到 `currentStepPath(state)`（本期不做只读规划旁路）。
- **预览页（新，`apps/web/src/app/projects/[id]/preview/page.tsx`）**：
  - `state==SLIDE_GENERATION`：**未物化的判定是 `GET /presentation` 抛 404 `PRESENTATION_NOT_FOUND`（后端不返回 `null`）**——据此显示「物化」按钮调 `POST /slides/materialize`（停 `SLIDE_GENERATION`，**直接返回裸 `Presentation`**）；物化成功即用返回的裸对象调 `renderPresentation` 渲染 HTML 预览（幻灯片列表 + 缩略图，无需再 `GET`）；显示「进入导出」CTA → `POST /transitions {to:EXPORT_READY}` → 导航到 `/export`。
  - `state>=EXPORT_READY`：只读预览 + 链到导出页。
- **导出页（新，`apps/web/src/app/projects/[id]/export/page.tsx`）**：
  - `state==EXPORT_READY`：显示「导出 PPTX」按钮调 `POST /export`（停 `EXPORT_READY`）；导出后 `GET /exports` 列元数据，每项可点击下载（`GET /export/{id}` → Blob → `<a download>`）；显示「标记为已导出」CTA → `POST /transitions {to:EXPORTED}`。
  - `state==EXPORTED`：导出列表 + 下载 + 回退提示。
- **API 客户端扩展（改，`apps/web/src/lib/api.ts`）**：新增 `generateOutline`/`updateOutline`/`confirmOutline`/`getOutline`、`generateSlidePlans`/`updateSlidePlan`/`confirmSlidePlans`/`getSlidePlans`、`materialize`/`getPresentation`、`exportPptx`/`listExports`/`downloadExport` 共 13 个端点函数 + 对应响应类型。canonical 字段复用 `@ppt-pilot/shared-schema` 的 `Outline`/`SlidePlan`/`Presentation` 类型；**`materialize`/`getPresentation` 返回裸 `Presentation`（非 `{presentation}`）；导出列表/`POST /export` 返回 `ExportArtifactMetadata = Omit<ExportArtifact, "bytesBase64">`（含 `projectId`），不复用要求 `bytesBase64` 的 `ExportArtifact`**。`downloadExport` 走原始 `fetch`（需 `Response.blob()`），须导出 `api.ts` 的 `toApiError`（当前私有）或加导出的 `blobFetch` helper 复用它。
- **工作流规划器扩展（改，`apps/web/src/lib/workflow.ts`）**：扩展 `planEnterReview` 之后的链路——新增 `planEnterOutline`/`planEnterSlidePlans`/`planEnterPreview`/`planEnterExport` 纯规划器 + `guardOutlineMount`/`guardSlidePlansMount`/`guardPreviewMount`/`guardExportMount` 挂载守卫 + `currentStepPath(state)` 步骤路由函数；`WORKFLOW_STATE_LABELS` 已覆盖全态（无需改）。
- **web 依赖（改，`apps/web/package.json`）**：新增 `@ppt-pilot/ppt-engine: "workspace:*"`。
- **测试（改，`apps/web/src/__tests__/`）**：扩展 mock server（`server.ts`）覆盖新端点；新增 outline / slide-plans / preview / export 页面交互测试（Vitest + Testing Library，沿用 Phase 4 模式）。

## 功能 (Capabilities)

### 新增功能

- `web-outline-review`: 大纲复核页——链式生成（转移→generate→转移）、section 就地编辑/增删/重排、`PUT /outline` 整体保存、`POST /outline/confirm` 确认、挂载守卫、loading/错误/重试。
- `web-slide-plan-review`: 规划复核页——链式生成、逐页 plan 卡片编辑（`PUT /slides/{slideId}/plan`）、`POST /slides/plans/confirm` 确认、挂载守卫、loading/错误/重试。
- `web-deck-preview`: 预览页——`POST /slides/materialize` 物化、`GET /presentation` 读取、`renderPresentation`（ppt-engine）渲染 HTML 预览 + 缩略图、挂载守卫。
- `web-pptx-export`: 导出页——`POST /export` 触发、`GET /exports` 元数据列表、`GET /export/{id}` Blob 下载、`POST /transitions {to:EXPORTED}` 收尾、挂载守卫。

### 修改功能

- `web-workflow-shell`: 扩展转移规划器与挂载守卫覆盖 `REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW → SLIDE_GENERATION → EXPORT_READY → EXPORTED` 全链；新增 `currentStepPath(state)` 步骤路由。

## 影响

- 网页端（apps/web）
  - 新增页面：`src/app/projects/[id]/{outline,slide-plans,preview,export}/page.tsx`。
  - 新增组件：`src/components/{outline-editor,slide-plan-editor,deck-preview,export-list}.tsx`（命名待定，可能合并到页面）。
  - 扩展 `src/lib/api.ts`（13 个新端点函数 + 类型，并导出 `toApiError`/加 `blobFetch`）、`src/lib/workflow.ts`（4 个规划器 + 4 个守卫 + `currentStepPath`）、**`src/lib/errors.ts`（扩展 `MAPPINGS` 覆盖 Phase 5–7 错误码）**。
  - `package.json` 加 `@ppt-pilot/ppt-engine`。
  - 测试：`src/__tests__/server.ts` 扩展 + 新测试文件。
- 模式（schema）/ 后端（apps/api）/ 引擎（exporter）
  - **零改动**（所有 API、schema、事件、状态机边已在 Phase 5–7 落地）。
- CI / 依赖
  - 分层 CI 的 web 门覆盖新 Vitest；无新 Python / 无新 node 运行时依赖（`ppt-engine` 已是 workspace 包）。
- 文档
  - 实现后更新 `docs/ROADMAP_PROGRESS.md`（Phase 4b 前端补齐）、`docs/ARCHITECTURE.md`（前端工作流页落地）、`PRODUCT.md` §6 状态注记（前端链路贯通）。
- 验证方式
  - `pnpm --filter @ppt-pilot/web typecheck` + `build` + Vitest 全绿；mock server 覆盖全链端点；`pnpm validate` 顶层脚本通过；无后端回归（后端零改动）。

非目标：

- **不做画布编辑 / 元素拖拽 / 文本编辑 / 缩放**（Phase 8）。
- **不做 slide/element 锁定 UI 与锁定写保护**（Phase 8；锁字段在 schema 已存在但本期前端不暴露交互）。
- **不做局部再生 / 图片候选**（Phase 9）。
- **不做版本历史 / diff / Review Agent**（Phase 10）。
- **不改后端任何路由、schema、事件、状态机**（纯前端）。
- **不做移动端画布编辑适配**（移动端只做复核/预览/导出，与桌面同页面响应式即可）。
- **不做大纲/规划的重生成（regenerate）按钮**——本期生成是首次生成；regenerate 属 Phase 9 scope（虽然后端 `generate` 端点支持覆盖式重生成，但前端本期不暴露「重新生成已确认大纲」入口，避免误清确认态）。
- **不做真实图片/图表可视化**——预览沿用 Phase 6 占位策略（ppt-engine 渲染带类型标注占位框）。
