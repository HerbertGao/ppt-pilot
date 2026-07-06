## 1. API 客户端扩展（apps/web/src/lib/api.ts）

- [x] 1.1 新增 outline 端点函数：`generateOutline(projectId)` → `POST /outline/generate`、`updateOutline(projectId, outline)` → `PUT /outline`、`confirmOutline(projectId)` → `POST /outline/confirm`、`getOutline(projectId)` → `GET /outline`；成功响应是**裸 `Outline` 对象**（复用 `@ppt-pilot/shared-schema` 的 `Outline`：`{id?, sections, confirmedByUser, riskNotes?}`，`OutlineSection = {title, purpose, estimatedSlides}`）；**大纲缺失时 `GET /outline`/`POST /outline/confirm` 抛 404 `OUTLINE_NOT_FOUND`**（不是空体）
- [x] 1.2 新增 slide-plan 端点函数：`generateSlidePlans(projectId)` → `POST /slides/plans/generate`、`updateSlidePlan(projectId, slideId, plan)` → `PUT /slides/{slideId}/plan`、`confirmSlidePlans(projectId)` → `POST /slides/plans/confirm`、`getSlidePlans(projectId)` → `GET /slides/plans`；响应类型 `{slidePlans: SlidePlan[], slidePlansConfirmed: boolean}`（`SlidePlan` 复用 schema 类型，含 `visualIntent` 枚举）；**plans 缺失/空时 `GET /slides/plans`/`POST /slides/plans/confirm` 抛 404 `SLIDE_PLAN_NOT_FOUND`；`PUT /slides/{slideId}/plan` 对不存在的 slideId 抛 404 `SLIDE_PLAN_NOT_FOUND`**
- [x] 1.3 新增 presentation 端点函数：`materialize(projectId)` → `POST /slides/materialize`（成功返回**裸 `Presentation` 对象**）、`getPresentation(projectId)` → `GET /presentation`（成功返回**裸 `Presentation`**，复用 schema 类型）；**未物化时后端不返回 `null`，而是 404 `PRESENTATION_NOT_FOUND`**——`getPresentation` 抛 `ApiError(code="PRESENTATION_NOT_FOUND")`，调用方据此判定「未物化」。**禁止把响应建模为 `{presentation: Presentation | null}`**（既无该包裹键，也无 null 分支）
- [x] 1.4 新增 export 端点函数：`exportPptx(projectId)` → `POST /export`（返回**不含字节的 metadata 形状**，非 `ExportArtifact`）、`listExports(projectId)` → `GET /exports`（返回 `{exports: ExportArtifactMetadata[]}`，**不含 `bytesBase64`**）、`downloadExport(projectId, artifactId)` → `GET /export/{id}` 返回 `Response`（用于 `blob()`）；定义 `ExportArtifactMetadata = Omit<ExportArtifact, "bytesBase64">`（后端 `_METADATA_KEYS` 实际含 `id/projectId/format/byteSize/sourcePresentationId/createdBy/createdAt`——**含 `projectId`**；用 `Omit` 派生自动对齐，**勿手抄字段清单漏 `projectId`**）
- [x] 1.5 验收：`pnpm --filter @ppt-pilot/web typecheck` 通过；既有 Phase 4 端点函数零回归；返回 JSON 的新函数（含 `exportPptx`——返回 metadata JSON）经 `apiFetch` 包装；**仅 `downloadExport` 走原始 `fetch`（因需 `Response.blob()`），其非 2xx 仍经 `toApiError` 处理——须先把 `apps/web/src/lib/api.ts` 的 `toApiError` 导出（当前模块私有），或新增一个导出的 `blobFetch` helper 复用它**
- [x] 1.6 扩展中央错误映射 `apps/web/src/lib/errors.ts` 的 `MAPPINGS`：现仅覆盖 Phase 2/3 码，**未覆盖任何 Phase 5–7 码**。补齐 `OUTLINE_NOT_CONFIRMABLE`/`SLIDE_PLAN_NOT_CONFIRMABLE`（generate 步前驱未确认码，规格映射为「请先确认 Spec / 大纲」，`kind:"rollback"`）/`OUTLINE_VALIDATION_ERROR`/`OUTLINE_NOT_FOUND`/`SLIDE_PLAN_VALIDATION_ERROR`/`SLIDE_PLAN_NOT_FOUND`/`SLIDES_NOT_MATERIALIZABLE`/`SLIDE_VALIDATION_ERROR`/`PRESENTATION_NOT_FOUND`/`EXPORT_NOT_READY`/`EXPORT_VALIDATION_ERROR`/`EXPORT_ARTIFACT_NOT_FOUND`（各带 `kind`/`retryable`，如 validation 类 `kind:"validation"`、LLM 类沿用既有 `llm-retry`）——**须覆盖各页规格 error-map 引用的全部码，勿漏**；页面统一经 `presentError` 呈现（沿用 Phase 4 中央映射范式，勿在页面各写一套）。**例外**：`PRESENTATION_NOT_FOUND` 在预览页表示「未物化」空态而非错误，由预览页就地判定，不当错误横幅弹出

## 2. 工作流规划器与挂载守卫扩展（apps/web/src/lib/workflow.ts）

- [x] 2.1 新增纯函数 `currentStepPath(projectId, state): string`——按 `state → 步骤页` 映射返回唯一路径（`NEW_PROJECT`/`REQUIREMENT_DISCOVERY`→discovery、`REQUIREMENT_REVIEW`→review、`OUTLINE_GENERATION`/`OUTLINE_REVIEW`→outline、`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW`→slide-plans、`SLIDE_GENERATION`→preview、`EXPORT_READY`/`EXPORTED`→export、`EDITING`/`REVIEW`→preview 防御性映射）；纯函数无副作用
- [x] 2.2 新增挂载守卫 `guardOutlineMount`/`guardSlidePlansMount`/`guardPreviewMount`/`guardExportMount`——各按接受集（outline:{OUTLINE_GENERATION,OUTLINE_REVIEW}、slide-plans:{SLIDE_PLANNING,SLIDE_PLAN_REVIEW}、preview:{SLIDE_GENERATION,EXPORT_READY,EXPORTED}、export:{EXPORT_READY,EXPORTED}）返回 `null` 或 `currentStepPath(projectId, state)`；与既有 `guardReviewMount`/`guardDiscoveryMount` 同构（纯函数、互斥、无 API）
- [x] 2.3 新增纯规划器 `planEnterOutline`/`planEnterSlidePlans`/`planEnterPreview`/`planEnterExport`——各返回 `{transitionTo, navigate}` 分支决策（前置态匹配才转移，已目标态只导航，否则不动作）；与 `planEnterReview` 同构
- [x] 2.4 新增异步助手 `enterOutline`/`enterSlidePlans`/`enterPreview`/`enterExport`——组合规划器 + `api.transition`，返回导航意图给调用者（调用者执行导航）；支持 `AbortSignal`
- [x] 2.5 新增链式生成助手 `chainGenerateOutline`/`chainGenerateSlidePlans`——各按「转移→generate→转移」链式执行：① `POST /transitions {to:生成态}` ② `POST /generate` ③ `POST /transitions {to:复核态}`；步骤 ② 失败时不再执行 ③、返回错误 + 当前态（留生成态）；支持 `AbortSignal`；调用者据结果导航 + 显示 loading/错误
- [x] 2.6 验收：`pnpm --filter @ppt-pilot/web typecheck` 通过；纯规划器/守卫/`currentStepPath` 有单测（state 全态覆盖、互斥谓词、无副作用）；既有 Phase 4 规划器/守卫零回归

## 3. 大纲复核页（apps/web/src/app/projects/[id]/outline/page.tsx）

- [x] 3.1 页面骨架 + `useProject` 拉取状态 + `guardOutlineMount` 挂载守卫（错位重定向）
- [x] 3.2 `state==OUTLINE_GENERATION` 态：显示 loading（链式生成进行中）；若有错误（链式 ② 失败落入此态）显示错误 + 重试按钮（重调 `generateOutline` + `POST /transitions {to:OUTLINE_REVIEW}`）
- [x] 3.3 `state==OUTLINE_REVIEW` 态：`GET /outline` 拉取大纲，渲染 section 列表（title/purpose/estimatedSlides），支持就地编辑、增删 section、重排；编辑存 `useState`，不在按键时调 API
- [x] 3.4 「保存」按钮调 `PUT /outline`（完整 Outline 对象）；成功 `refresh()` + 提示已保存；失败（`OUTLINE_VALIDATION_ERROR`）保持本地编辑 + 显示错误。**注意：后端 `update_outline` 保存即把 `confirmedByUser` 置回 `false`（编辑需重新确认）**——保存成功后必须据返回/刷新后的 `confirmedByUser` 收起「生成规划」CTA（见 3.5）
- [x] 3.5 「确认大纲」按钮调 `POST /outline/confirm`（返回裸 `Outline`，含 `confirmedByUser=true`）；成功显示已确认态 + 「生成幻灯片规划」CTA；失败（`INVALID_STATE_TRANSITION` / `OUTLINE_NOT_FOUND`）显示错误。**「生成规划」CTA 的可见性必须由 `outline.confirmedByUser` 派生，而非一次性布尔**——确认后若用户再编辑保存（un-confirm），CTA 必须隐藏直到重新确认，**防止在未确认态触发链式生成**（否则链 ① 转移成功但链 ② `generate_slide_plans` 抛 `SLIDE_PLAN_NOT_CONFIRMABLE`，项目滞留 `SLIDE_PLANNING` 且「只重试 ②+③」无法恢复——重新确认在前一态、本期无回退 UI）
- [x] 3.6 「生成幻灯片规划」CTA 调 `chainGenerateSlidePlans`（转移→generate→转移）→ 导航到 `/slide-plans`；链式期间 loading；失败留生成态 + 错误
- [x] 3.7 `state>OUTLINE_REVIEW` 态：`guardOutlineMount` 接受集不含这些态 → **重定向到 `currentStepPath(state)`**（本期不做跨步骤只读大纲旁路，与守卫自洽）
- [x] 3.8 错误映射（经 tasks 1.6 中央 `presentError`）：`INVALID_STATE_TRANSITION`/`OUTLINE_NOT_CONFIRMABLE`（generate 步）/`OUTLINE_NOT_FOUND`（confirm/GET 无大纲）/`OUTLINE_VALIDATION_ERROR`/`LLM_PROVIDER_ERROR`/`NETWORK_ERROR` 各按可读提示呈现；未保存离开提示
- [x] 3.9 验收：Vitest 交互测试覆盖——链式生成成功、生成失败留态+重试、编辑+保存成功/失败、确认+CTA、挂载守卫重定向、错误提示；mock server 覆盖 outline 端点

## 4. 规划复核页（apps/web/src/app/projects/[id]/slide-plans/page.tsx）

- [x] 4.1 页面骨架 + `useProject` + `guardSlidePlansMount` 挂载守卫
- [x] 4.2 `state==SLIDE_PLANNING` 态：loading / 错误 + 重试（重调 `generateSlidePlans` + 转移到 `SLIDE_PLAN_REVIEW`）
- [x] 4.3 `state==SLIDE_PLAN_REVIEW` 态：`GET /slides/plans` 拉取 `{slidePlans, slidePlansConfirmed}`，渲染逐页卡片（slideId/title/objective/keyMessage/contentIntent/visualIntent/layoutSuggestion/requiredAssets/riskNotes）
- [x] 4.4 每页卡片支持就地编辑；`visualIntent` 用 select 约束为枚举（`diagram|image|chart|text|comparison|timeline`）；编辑存 `useState`
- [x] 4.5 单页「保存」按钮调 `PUT /slides/{slideId}/plan`（该页完整 SlidePlan）；成功提示 + `refresh()`；失败（`SLIDE_PLAN_VALIDATION_ERROR` / `SLIDE_PLAN_NOT_FOUND` 若 slideId 失效）保持编辑 + 错误。**注意：后端 `update_slide_plan` 保存即把 `slidePlansConfirmed` 置回 `false`**——保存成功后据刷新后的 `slidePlansConfirmed` 收起「物化」CTA（见 4.6）
- [x] 4.6 「确认规划」按钮调 `POST /slides/plans/confirm`；成功显示已确认态 + 「物化幻灯片」CTA；失败（`INVALID_STATE_TRANSITION` / `SLIDE_PLAN_NOT_FOUND`）显示错误。**「物化」CTA 可见性必须由 `slidePlansConfirmed` 派生**——确认后再编辑保存（un-confirm）须隐藏 CTA 直到重新确认，**防止在未确认态触发进入 `SLIDE_GENERATION` 后 `materialize` 抛 `SLIDES_NOT_MATERIALIZABLE` 而滞留**
- [x] 4.7 「物化幻灯片」CTA 调 `POST /transitions {to:"SLIDE_GENERATION"}` → 导航到 `/preview`（物化由预览页触发）
- [x] 4.8 `state>SLIDE_PLAN_REVIEW` 态：`guardSlidePlansMount` 接受集不含这些态 → **重定向到 `currentStepPath(state)`**（本期不做跨步骤只读规划旁路，与守卫自洽）
- [x] 4.9 错误映射（经 tasks 1.6 中央 `presentError`）：`INVALID_STATE_TRANSITION`/`SLIDE_PLAN_NOT_CONFIRMABLE`（generate 步）/`SLIDE_PLAN_NOT_FOUND`（confirm/GET/PUT 失效 slideId）/`SLIDE_PLAN_VALIDATION_ERROR`/`LLM_PROVIDER_ERROR`/`NETWORK_ERROR`
- [x] 4.10 验收：Vitest 交互测试覆盖——链式生成、逐页编辑+保存、visualIntent 枚举约束、确认+CTA、挂载守卫、错误提示；mock server 覆盖 slide-plan 端点

## 5. 预览页（apps/web/src/app/projects/[id]/preview/page.tsx）

- [x] 5.1 `apps/web/package.json` 新增依赖 `@ppt-pilot/ppt-engine: "workspace:*"`；`pnpm install` 解析 workspace 链接
- [x] 5.2 页面骨架 + `useProject` + `guardPreviewMount` 挂载守卫
- [x] 5.3 `state==SLIDE_GENERATION` 且**未物化**（判定方式：`getPresentation` 抛 404 `PRESENTATION_NOT_FOUND`，**不是** `presentation==null`）：显示「物化幻灯片」按钮调 `POST /slides/materialize`；loading；失败（`SLIDES_NOT_MATERIALIZABLE` 前置未确认 / `SLIDE_VALIDATION_ERROR` 内容校验）显示错误 + 重试 + 返回规划页链接
- [x] 5.4 物化成功（`materialize` **直接返回裸 `Presentation`**，可直接渲染，无需再 `GET`）或已物化（`getPresentation` 返回裸 `Presentation`）：调 `renderPresentation(presentation)`（**传入裸对象本身，不是 `res.presentation`**）得 HTML，经 `dangerouslySetInnerHTML` 注入；为每页调 `renderThumbnail`/`thumbnailSvg` 生成缩略图列表
- [x] 5.5 缩略图点击切换主预览区到该页（`renderSlide`）；主预览区默认显示第一页
- [x] 5.6 「进入导出」CTA 调 `POST /transitions {to:"EXPORT_READY"}` → 导航到 `/export`；失败显示错误
- [x] 5.7 `state>=EXPORT_READY` 态：只读预览 + 链到导出页（不显示物化按钮）
- [x] 5.8 错误映射（经 tasks 1.6 中央 `presentError`）：`PRESENTATION_NOT_FOUND`（未物化空态，非错误横幅）/`SLIDES_NOT_MATERIALIZABLE`/`SLIDE_VALIDATION_ERROR`（materialize 内容校验）/`INVALID_STATE_TRANSITION`/`NETWORK_ERROR`
- [x] 5.9 验收：Vitest 交互测试覆盖——物化+渲染、缩略图切换、进入导出、挂载守卫、错误提示；mock server 覆盖 materialize/presentation 端点；确认 `renderPresentation` 输出注入安全（不自行拼 HTML）

## 6. 导出页（apps/web/src/app/projects/[id]/export/page.tsx）

- [x] 6.1 页面骨架 + `useProject` + `guardExportMount` 挂载守卫
- [x] 6.2 `state==EXPORT_READY`：`GET /exports` 拉取元数据列表，渲染列表（id/format/byteSize 人类可读/createdAt）；空列表显示空态 + 「导出 PPTX」按钮
- [x] 6.3 「导出 PPTX」按钮调 `POST /export`；loading；成功 `refresh()` + 列表追加；失败（`EXPORT_NOT_READY`/`EXPORT_VALIDATION_ERROR`）显示错误 + 重试
- [x] 6.4 每项下载按钮：`fetch GET /export/{id}` → `Response.blob()` → `ObjectURL` → `<a download="{id}.pptx">` 点击 → `revokeObjectURL`；下载中 loading；失败（`EXPORT_ARTIFACT_NOT_FOUND`/网络）页面内提示
- [x] 6.5 「标记为已导出」CTA 调 `POST /transitions {to:"EXPORTED"}` → `refresh()`；失败显示错误
- [x] 6.6 `state==EXPORTED`：显示已导出完成态 + 保留下载列表 + 回退提示
- [x] 6.7 错误映射：`INVALID_STATE_TRANSITION`/`EXPORT_NOT_READY`/`EXPORT_VALIDATION_ERROR`/`EXPORT_ARTIFACT_NOT_FOUND`/`NETWORK_ERROR`
- [x] 6.8 验收：Vitest 交互测试覆盖——导出+列表追加、下载（mock fetch Blob）、标记已导出、挂载守卫、错误提示；mock server 覆盖 export 端点；确认列表**不含 `bytesBase64`**

## 7. Spec 复核页衔接（apps/web/src/app/projects/[id]/review/page.tsx）

- [x] 7.1 Spec 确认成功后显示「生成大纲」CTA，调用 `chainGenerateOutline`（转移→generate→转移）→ 导航到 `/outline`；链式期间 loading；失败留 `OUTLINE_GENERATION` 态 + 导航到 outline 页显示错误
- [x] 7.2 验收：既有 Phase 4 review 测试零回归；新增「确认后生成大纲 CTA」交互测试

## 8. 测试、文档与验证

- [x] 8.1 扩展 `apps/web/src/__tests__/server.ts` mock handler 覆盖全部新端点（outline generate/update/confirm/get、slide-plan generate/update/confirm/get、materialize、presentation get、export post、exports list、export download）；各端点含成功 + 关键错误码 mock。**mock 必须忠实后端契约（防 false-green）**：成功返回**裸实体**（`GET /outline`→裸 `Outline`；`GET /slides/plans`→`{slidePlans, slidePlansConfirmed}`；`GET /presentation` 与 `materialize`→裸 `Presentation`；`POST /export`/`GET /exports`→含 `projectId` 的 metadata），数据缺失返回**真实 404 `{error, code, details}` 信封**（`PRESENTATION_NOT_FOUND`/`OUTLINE_NOT_FOUND`/`SLIDE_PLAN_NOT_FOUND`）。**严禁把 `GET /presentation` mock 成 `{presentation:null}` 或把缺失 GET mock 成空体**——那会让测试对着不存在的后端行为变绿，掩盖契约漂移。预览页「未物化」用例必须 mock 成 404 `PRESENTATION_NOT_FOUND`
- [x] 8.2 新增 Vitest 测试文件：`outline.test.tsx`、`slide-plans.test.tsx`、`preview.test.tsx`、`export.test.tsx`、`workflow-extended.test.ts`（`currentStepPath` + 新守卫/规划器纯函数）
- [x] 8.3 `docs/ROADMAP_PROGRESS.md` 更新——新增 Phase 4b 前端补齐条目（状态：已完成并归档）
- [x] 8.4 `docs/ARCHITECTURE.md` 更新——前端工作流页落地（outline/slide-plans/preview/export 页 + `currentStepPath` 步骤路由）
- [x] 8.5 `PRODUCT.md` §6 状态注记更新——前端链路贯通（确认 Spec → 导出 PPTX 全链可用）
- [x] 8.6 验收：`pnpm --filter @ppt-pilot/web typecheck` + `build` + Vitest 全绿（121/121，`fileParallelism:false` 后确定性）；后端零改动（`apps/api` 零 diff）。注：`pnpm validate` 前端/schema 全段通过，末尾内联 FastAPI 健康检查在未锁定 FastAPI 0.139 下报 `_IncludedRouter` 无 `.path`（既有根脚本脆弱性，非本变更；在已锁定 venv 中通过——留待本地核实）
- [x] 8.7 运行 `openspec-cn validate phase-4b-frontend-outline-slideplan-preview-export --strict` 确认产物一致（本仓用 `openspec-cn`——规格用中文 delta 头 `## 新增需求`/`## 修改需求`，英文 `openspec` CLI 不识别会误报），准备实现/归档
