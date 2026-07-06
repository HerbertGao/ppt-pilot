## 上下文

Phase 4（前端工作流壳，PR #12）落地了 `apps/web` 的立项 → 需求澄清 → Spec 复核三页，确立了前端驱动转移的范式（`apps/web/src/lib/workflow.ts`）：

- **动作端点不推进状态**——只有 `POST /transitions` 推进（`discover`/`answer`/`skip`/`confirm` 均停在当前态）。
- **挂载守卫**——`guardReviewMount`（非 REVIEW 即重定向到 discovery）、`guardDiscoveryMount`（REVIEW 时重定向到 review），互斥谓词避免重定向环。
- **纯规划器与异步助手分离**——`planEnterReview`（纯分支决策，trivially checkable）+ `enterReview`（组合 API）；profile 改动 rollback-first。
- **`ApiError` 统一错误**——`{code, errorClass, status, field, detailMessage}`，`NETWORK_ERROR` 合成码覆盖网络失败。
- **`useProject` hook**——`GET /api/projects/{id}` 拉取 `ProjectSummary`（`projectId/title/scene/styleProfileId/status`），server-state 单源、无 Zustand 镜像。

后端 Phase 5–7 已落地但前端未消费的端点（`apps/api/app/routes.py`）：

| 端点 | 前置状态 | 行为 |
| --- | --- | --- |
| `POST /outline/generate` | `OUTLINE_GENERATION` + spec.confirmedByUser | 生成大纲（停 `OUTLINE_GENERATION`） |
| `PUT /outline` | `OUTLINE_REVIEW` | 整体替换大纲（停 `OUTLINE_REVIEW`） |
| `POST /outline/confirm` | `OUTLINE_REVIEW` + outline 存在 | 确认（停 `OUTLINE_REVIEW`） |
| `GET /outline` | 任意 | 读**裸 `Outline`**；无大纲 → 404 `OUTLINE_NOT_FOUND` |
| `POST /slides/plans/generate` | `SLIDE_PLANNING` + outline.confirmedByUser | 生成规划（停 `SLIDE_PLANNING`） |
| `PUT /slides/{slideId}/plan` | `SLIDE_PLAN_REVIEW` | 编辑单页 plan（停 `SLIDE_PLAN_REVIEW`） |
| `POST /slides/plans/confirm` | `SLIDE_PLAN_REVIEW` + plans 非空 | 确认（停 `SLIDE_PLAN_REVIEW`） |
| `GET /slides/plans` | 任意 | 读 `{slidePlans, slidePlansConfirmed}`；无/空规划 → 404 `SLIDE_PLAN_NOT_FOUND` |
| `POST /slides/materialize` | `SLIDE_GENERATION` + spec 确认 + plans 确认非空 | 物化 Presentation（停 `SLIDE_GENERATION`） |
| `GET /presentation` | 任意 | 读**裸 `Presentation`**；未物化 → **404 `PRESENTATION_NOT_FOUND`（非 `null`、无 `{presentation}` 包裹）** |
| `POST /export` | `EXPORT_READY` + presentation 非空 | 生成 pptx（停 `EXPORT_READY`） |
| `GET /export/{id}` | 任意 | 流式下载 pptx 字节 |
| `GET /exports` | 任意 | 元数据列表（无 `bytesBase64`） |

工作流边（`apps/api/app/workflow.py` `TRANSITION_EDGES`）：前向 `REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW→SLIDE_GENERATION→EXPORT_READY→EXPORTED`，回退对称（None-safe 清下游）。

`packages/ppt-engine` 已导出 `renderPresentation(presentation)` / `renderSlide(slide, theme)`（纯函数，返回 HTML 字符串，已做上下文感知转义 + CSS 白名单 + 缩略图占位）；web 当前**未依赖**此包。

## 目标 / 非目标

**目标：**

- 把 Phase 5–7 后端端点映射为 4 个 Next.js 步骤页（outline / slide-plans / preview / export），用户可从 Web UI 走完确认 Spec → 导出 PPTX 全链。
- 沿用 Phase 4 的转移驱动 / 挂载守卫 / `ApiError` 范式，扩展规划器覆盖全态。
- 预览消费 `@ppt-pilot/ppt-engine`（同源模型渲染），不新增后端 HTML 端点。
- 纯前端、零后端改动；Vitest 覆盖全链交互。

**非目标：**

- 画布编辑 / 锁定 UI / 局部再生 / 版本历史 / Review Agent（Phase 8–10）。
- 改后端任何代码。
- 重生成入口（regenerate）——本期只首次生成。
- 真实图片/图表可视化（沿用占位）。
- 移动端画布编辑。

## 决策

### D1：纯前端，零后端改动

所有端点已在 Phase 5–7 落地并经 pytest 覆盖。本期不新增后端路由、不改 schema、不加事件、不动状态机边。`GET /presentation` 已返回结构化 `Presentation`；`GET /exports` 已返回元数据；`GET /export/{id}` 已流式返回字节。前端只需消费。

### D2：转移驱动沿用 Phase 4——动作端点不推进状态，显式 `/transitions` 推进

与 Phase 4 完全一致：`generate`/`update`/`confirm`/`materialize`/`export` 均停在当前态，前向推进只经 `POST /transitions`。扩展 `workflow.ts` 的纯规划器覆盖 `REQUIREMENT_REVIEW` 之后的全链，保持「纯分支决策 + 异步组合」分离。

### D3：生成动作链式——转移 → generate → 转移，中间态 loading

后端要求 `generate_outline` 在 `OUTLINE_GENERATION` 态调用、`generate_slide_plans` 在 `SLIDE_PLANNING` 态、`materialize` 在 `SLIDE_GENERATION` 态。而用户在前一步复核页点「生成 X」CTA 时项目还在前一态。因此 CTA 动作必须**链式**：

```
[REQUIREMENT_REVIEW] 确认 Spec
  → POST /transitions {to:OUTLINE_GENERATION}     (1) 进入生成态
  → POST /outline/generate                         (2) 生成（停 OUTLINE_GENERATION）
  → POST /transitions {to:OUTLINE_REVIEW}          (3) 进入复核态
  → navigate /projects/[id]/outline                (4) 展示大纲
```

- (1) 成功 (2) 失败：state 留在 `OUTLINE_GENERATION`，导航到 outline 页显示错误 + 重试（重试只重调 (2)+(3)，不重复 (1)——已在生成态）。
- (1) 失败（如状态错误）：留在当前页显示错误（不应发生，因 CTA 只在正确态显示）。
- 链式中间态对用户表现为 loading（避免用户在 `OUTLINE_GENERATION` 态看到空白复核页）。

**为什么不在复核页直接调 generate（跳过转移）**：后端 `generate_outline` 强制 `state==OUTLINE_GENERATION`，在 `REQUIREMENT_REVIEW` 调会被 `INVALID_STATE_TRANSITION`(409) 拒。

**为什么不把「转移」和「生成」合并成一个后端端点**：违反 Phase 4 既定范式（动作端点不推进状态），且后端已刻意分离（`generate` 不推进、`/transitions` 推进）。前端组合即可。

slide-plans 生成与 materialize 同构（各自的前驱态 → 生成态 → 复核/终态）。

### D4：挂载守卫——`state → 期望页` 映射，错位重定向

扩展 Phase 4 的 `guardReviewMount`/`guardDiscoveryMount` 到全链。定义 `currentStepPath(state)` 步骤路由：

```
NEW_PROJECT, REQUIREMENT_DISCOVERY → /discovery
REQUIREMENT_REVIEW                 → /review
OUTLINE_GENERATION, OUTLINE_REVIEW → /outline
SLIDE_PLANNING, SLIDE_PLAN_REVIEW  → /slide-plans
SLIDE_GENERATION                   → /preview
EXPORT_READY, EXPORTED             → /export
EDITING, REVIEW                    → /preview (Phase 8 前 EDITING/REVIEW 无边，不可达；防御性映射)
```

每页 mount 时调 `guard<Page>Mount(state)`：若 state 不属于该页的接受集，`redirect(currentStepPath(state))`。与 Phase 4 互斥谓词一致——**对所有可达态不会环**（`currentStepPath` 是 state 的纯函数，每态唯一目标）；`EDITING`/`REVIEW` 的防御性 `/preview` 映射不在 preview 接受集内、若可达会自环，但 Phase 8 前不可达（见 `web-workflow-shell` 步骤路由需求的已知边界）。

**为什么不强制每页只接受一个态**：`OUTLINE_GENERATION`（loading）与 `OUTLINE_REVIEW`（编辑器）共享 outline 页；`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW` 共享 slide-plans 页——loading 与复核在同一页切换，避免导航抖动。

### D5：预览消费 `@ppt-pilot/ppt-engine`（前端 import，同源模型）

`POST /slides/materialize` 与 `GET /presentation` 都**直接返回裸 `Presentation`**（含 `slides[].elements[]` + `theme`），**不是 `{presentation: ...}` 包裹**。未物化时 `GET /presentation` **返回 404 `PRESENTATION_NOT_FOUND`（而非 `null`）**——预览页据「捕获 `ApiError.code === "PRESENTATION_NOT_FOUND"`」判定未物化，物化成功后可直接用 `materialize` 的返回值渲染（无需再 `GET`）。前端新增 `@ppt-pilot/ppt-engine` workspace 依赖，调 `renderPresentation(presentation)`（传入裸对象本身）得 HTML 字符串，经 `dangerouslySetInnerHTML` 注入页面。

**安全性**：ppt-engine 渲染器已做上下文感知转义——文本经 `escapeText`、属性经 `escapeAttr`、`ThemeTokens`/`element.style` 经 CSS 属性白名单 + 值 sanitizer（剥 `expression()`/`url()`/`</style>`）。因此 `dangerouslySetInnerHTML` 在此**安全由渲染器保证**（与 Phase 6 golden fixture 同源逻辑）。前端不自行拼接 HTML。

**为什么不在后端渲染 HTML 再返回**：(1) 增加后端端点（违反纯前端）；(2) ppt-engine 是 TS 包，后端是 Python，无法直接调；(3) 前端渲染零额外网络往返，确定性同源。

缩略图：`renderThumbnail` / `thumbnailSvg`（ppt-engine 已导出）生成确定性 SVG 占位，用于幻灯片列表缩略图。

### D6：导出下载——`fetch` + `Blob` + `<a download>`，不用 `window.location`

`GET /export/{id}` 返回 pptx 二进制流（`application/vnd.openxmlformats-officedocument.presentationml.presentation`）。前端用 `fetch` 拿 `Response.blob()`，创建 `ObjectURL`，构造 `<a download="{artifactId}.pptx">` 点击触发下载，随后 `revokeObjectURL`。

**为什么不用 `window.location.href = url` 或 `<a href>` 直跳**：(1) 直跳会离开 SPA、丢失页面状态；(2) 下载失败（404/网络）无法在页面内提示（浏览器只显示导航错误）；(3) `fetch` + Blob 可在页面内捕获错误、显示下载状态、支持多文件顺序下载。`Content-Disposition: attachment` 由后端已设，`<a download>` 与之协同。

### D7：错误处理——复用 `ApiError`，按 code 映射提示

复用 `apps/web/src/lib/api.ts` 的 `ApiError`（`code`/`errorClass`/`status`/`field`/`detailMessage`）。新增端点的错误经同一 `apiFetch` 包装，自动解析 `{error, code, details}` 信封。**映射逻辑落在既有中央映射器 `apps/web/src/lib/errors.ts` 的 `MAPPINGS`（Phase 4 范式），而非各页各写一套**——但该表当前**只覆盖 Phase 2/3 码，未覆盖任何 Phase 5–7 码**，因此本期必须扩展它（见 tasks 1.6，并把 `errors.ts` 列入影响面）。页面统一经 `presentError(err)` 呈现。按 `code` 映射：

- `INVALID_STATE_TRANSITION` → 「状态不匹配，请刷新页面重试」（并发或 mount 守卫竞态；已在 `errors.ts` 覆盖）。
- `OUTLINE_NOT_CONFIRMABLE` / `SLIDE_PLAN_NOT_CONFIRMABLE` → 「请先确认前置步骤」。**注意：这两码是 generate 步（前驱未确认）抛出，不是 confirm 步的失败码**。
- `OUTLINE_NOT_FOUND` / `SLIDE_PLAN_NOT_FOUND` / `PRESENTATION_NOT_FOUND` → 分别是「无大纲 / 无规划 / 未物化」。其中 **`PRESENTATION_NOT_FOUND` 在预览页表示「未物化」空态、就地显示物化按钮，不当错误横幅**（其余两码通常仅在守卫竞态/硬刷新时序下出现，呈现为相应缺失提示）。
- `OUTLINE_VALIDATION_ERROR` / `SLIDE_PLAN_VALIDATION_ERROR` / `SLIDE_VALIDATION_ERROR` / `SLIDES_NOT_MATERIALIZABLE` → 「内容校验失败：{detailMessage}」。**`SLIDE_VALIDATION_ERROR`（单数）由 `materialize` 对 theme/presentation/plan 校验失败抛出**，与 outline/slide-plan 的校验码是不同码，须单列。
- `LLM_PROVIDER_ERROR` → 「AI 服务暂时不可用，请重试」（生成端点；已在 `errors.ts` 覆盖）。
- `EXPORT_NOT_READY` → 「请先物化幻灯片」；`EXPORT_VALIDATION_ERROR` → 「导出校验失败：{detailMessage}」；`EXPORT_ARTIFACT_NOT_FOUND` → 「产物不存在」。
- `NETWORK_ERROR` → 「网络连接失败」（已在 `errors.ts` 覆盖）。
- 其他 → 通用 fallback（`presentError` 回退到 `detailMessage`）。

不新增错误类；`ApiError` 已覆盖全部需求，缺的是 `errors.ts` 的 `MAPPINGS` 条目。

### D8：大纲/规划编辑模型——前端本地态 + 整体保存

大纲编辑：`GET /outline` 拉取后存入页面本地 state（`useState<Outline>`）；用户编辑 section（增删改重排）操作本地数组；「保存」调 `PUT /outline`（整体替换，后端 `update_outline` 接受完整 Outline 对象）。不在每次按键时调 API（避免请求风暴 + 后端每次 `OUTLINE_UPDATED` 事件污染）。

规划编辑：`GET /slides/plans` 拉取 `{slidePlans, slidePlansConfirmed}`；逐页卡片编辑本地 state；单页保存调 `PUT /slides/{slideId}/plan`（后端按 `slideId` 定位单页）。单页保存而非整体——后端 `PUT /slides/{slideId}/plan` 是单页端点（`slideId` 是规划主键）。

**编辑即 un-confirm（关键约束）**：后端 `update_outline` 保存时把 `confirmedByUser` 置回 `false`，`update_slide_plan` 把 `slidePlansConfirmed` 置回 `false`（编辑需重新确认）。因此**下一步 CTA（「生成规划」/「物化」）的可见性必须由刷新后的 `confirmedByUser`/`slidePlansConfirmed` 派生，而非一次性布尔**——确认后若用户再编辑保存，CTA 必须隐藏直到重新确认。否则会踩下述**滞留陷阱**：CTA 链 ① 转移成功（`TRANSITION_EDGES` 的边不带内容守卫），但链 ② `generate_*`/`materialize` 因前驱未确认抛 `*_NOT_CONFIRMABLE`/`SLIDES_NOT_MATERIALIZABLE`，项目滞留在生成态；而「重试只重调 ②+③」无法恢复（重新确认在前一态，本期无回退 UI）。据确认标志派生 CTA 可见性即可从源头杜绝在未确认态发起链式。

### D9：无新运行时依赖

`@ppt-pilot/ppt-engine` 是 workspace 包（Phase 6 已建，纯 TS、无外部依赖），加到 web `dependencies` 即可，`pnpm install` 解析 workspace 符号链接。无新 npm 包、无新 Python 包。CI web 门已跑 `typecheck` + `build` + Vitest，覆盖新代码。

## 风险 / 权衡

- **链式动作的部分失败**（D3）：转移成功但 generate 失败 → state 留在生成态。前端导航到目标页显示 loading→错误+重试。重试只重调 generate + 后续转移（不重复前驱转移，因已在生成态）。可接受——不留下「转移了但无内容」的死态（目标页的 loading/错误态处理）。
- **硬刷新丢失本地编辑**（D8）：大纲/规划编辑存本地 state，硬刷新丢失。缓解：编辑中提示「未保存」；保存后 `refresh()` 重读。可接受——与 Phase 4 review 页会话本地态退化同构。
- **`GET /presentation` 未物化时 404**（D5）：未物化时后端**抛 404 `PRESENTATION_NOT_FOUND`（不返回 `null`）**。预览页据捕获该码判定「未物化 → 显示物化按钮」，把它当空态而非错误横幅；已物化时返回裸 `Presentation`，直接渲染，不解引用不存在的 `presentation` 字段。
- **`dangerouslySetInnerHTML` 安全**（D5）：由 ppt-engine 渲染器的上下文感知转义 + CSS 白名单保证（Phase 6 已验证，golden fixture 锁定）。前端不自行拼 HTML。可接受——这是渲染器的设计契约。
- **导出 Blob 内存**（D6）：大 pptx 下载全量入浏览器内存。里程碑可接受（deck 不大）；生产可改流式（非目标）。
- **重生成误清确认**（非目标）：后端 `generate` 端点支持覆盖式重生成（会清 `confirmedByUser`），但前端本期不暴露「重新生成已确认大纲/规划」入口——只首次生成。避免用户误点清掉已确认态。regenerate 属 Phase 9。
- **EDITING/REVIEW 不可达**（D4）：`currentStepPath` 防御性映射到 `/preview`，但 Phase 8 前这两态无边、不可达。无害。
