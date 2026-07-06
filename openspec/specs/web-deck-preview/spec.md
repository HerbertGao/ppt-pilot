# web-deck-preview 规范

## 目的
待定 - 由归档变更 phase-4b-frontend-outline-slideplan-preview-export 创建。归档后请更新目的。
## 需求
### 需求:物化幻灯片并渲染 HTML 预览

预览页在 `state==SLIDE_GENERATION` 且**未物化**时必须提供「物化幻灯片」按钮调 `POST /api/projects/{id}/slides/materialize`（停 `SLIDE_GENERATION`，不推进状态；**成功直接返回裸 `Presentation` 对象**）。「未物化」的判定方式：`GET /api/projects/{id}/presentation` 在未物化时**返回 404 `PRESENTATION_NOT_FOUND`（而非 `null`，也无 `{presentation}` 包裹键）**——前端据「捕获到 `ApiError.code === "PRESENTATION_NOT_FOUND"`」判定未物化并显示物化按钮，**不得依赖 `presentation == null` 字段判定**（该字段不存在）。物化成功后可直接用 `materialize` 返回的裸 `Presentation` 渲染（无需再 `GET`），调 `renderPresentation(presentation)`（`@ppt-pilot/ppt-engine`，**传入裸对象本身**）得 HTML 字符串，经 `dangerouslySetInnerHTML` 注入页面渲染幻灯片预览。**前端不自行拼接 HTML**——所有 HTML 由 ppt-engine 渲染器产生（上下文感知转义 + CSS 白名单由渲染器保证）。物化失败（`SLIDES_NOT_MATERIALIZABLE` 前置未确认 / `SLIDE_VALIDATION_ERROR` 内容校验失败 / 状态错误）必须显示错误 + 重试，绝不把物化响应/`getPresentation` 结果当 `null` 解引用。物化进行中显示 loading。

#### 场景:物化后渲染预览

- **当** 用户在 `SLIDE_GENERATION` 态点「物化幻灯片」成功
- **那么** 前端必须用 `materialize` 返回的裸 `Presentation`（或已物化时 `GET /presentation` 返回的裸 `Presentation`）调 `renderPresentation` 渲染 HTML 预览，显示幻灯片列表

#### 场景:未物化时显示物化按钮

- **当** `state==SLIDE_GENERATION` 但尚未物化，`GET /presentation` 返回 404 `PRESENTATION_NOT_FOUND`
- **那么** 前端必须把该 404 当作「未物化」空态、显示「物化幻灯片」按钮（**不是错误横幅**），不解引用不存在的 `presentation` 字段

#### 场景:物化失败显示重试

- **当** `POST /slides/materialize` 返回 `SLIDES_NOT_MATERIALIZABLE` 或 `SLIDE_VALIDATION_ERROR`
- **那么** 前端必须显示错误 + 重试按钮，不导航、不留半持久化态

### 需求:幻灯片缩略图与导航

预览页渲染的幻灯片列表必须为每页提供确定性缩略图（调 `renderThumbnail`/`thumbnailSvg`，ppt-engine 已导出），支持点击切换到该页大图预览。缩略图是确定性 SVG 占位（无外部资源、无 headless 浏览器），与 Phase 6 渲染器策略一致。

#### 场景:缩略图列表点击切换

- **当** 用户点击某页缩略图
- **那么** 前端必须把主预览区切换到该页的 `renderSlide` 输出

### 需求:进入导出——显式转移

预览页在 `presentation` 已物化时必须提供「进入导出」CTA，执行 `POST /api/projects/{id}/transitions {to:"EXPORT_READY"}` → 导航到 `/projects/{id}/export`。转移失败（状态错误）显示错误、不导航。`state>=EXPORT_READY` 时预览页只读展示 + 链到导出页。

#### 场景:物化后进入导出

- **当** 用户在 `SLIDE_GENERATION` 态、presentation 已物化，点「进入导出」
- **那么** 前端必须执行 `POST /transitions {to:"EXPORT_READY"}` → 导航到 `/projects/{id}/export`

#### 场景:已导出态只读预览

- **当** `state==EXPORT_READY` 或 `EXPORTED` 时进入预览页
- **那么** 前端必须只读展示预览 + 链到导出页，不显示物化按钮

### 需求:挂载守卫——错位 state 重定向

预览页 mount 时必须检查 `state`：若属于 `{SLIDE_GENERATION, EXPORT_READY, EXPORTED}` 则留在本页；否则重定向到 `currentStepPath(state)`。`state<SLIDE_GENERATION` 必须重定向到对应前序页。

#### 场景:在 SLIDE_GENERATION 态进入预览页

- **当** 用户在 `SLIDE_GENERATION` 态进入预览页
- **那么** 前端必须检查 presentation 是否已物化，未物化显示物化按钮，已物化显示预览

#### 场景:state 过前重定向

- **当** 用户在 `SLIDE_PLAN_REVIEW`（规划未确认）进入预览页
- **那么** 前端必须重定向到 `currentStepPath(SLIDE_PLAN_REVIEW)` 返回的规划页

### 需求:错误映射与用户可读提示

预览页必须复用 `ApiError`（经 `apps/web/src/lib/errors.ts` 的 `presentError` 中央映射），按 `code` 映射：`PRESENTATION_NOT_FOUND` → **不是错误，是「未物化」空态**（就地显示物化按钮，见上）；`SLIDES_NOT_MATERIALIZABLE` → 请先确认规划 + `detailMessage`；`SLIDE_VALIDATION_ERROR` → 内容校验失败 + `detailMessage`（`materialize` 对 theme/presentation/plan 校验失败时抛此码）；`INVALID_STATE_TRANSITION` → 刷新提示；`NETWORK_ERROR` → 网络失败。不得暴露原始异常。

#### 场景:未确认规划时物化失败

- **当** `POST /slides/materialize` 返回 `SLIDES_NOT_MATERIALIZABLE`
- **那么** 前端必须显示「请先确认幻灯片规划」+ 错误详情，提供返回规划页的链接

#### 场景:物化内容校验失败

- **当** `POST /slides/materialize` 返回 `SLIDE_VALIDATION_ERROR`(400)
- **那么** 前端必须显示「内容校验失败」+ `detailMessage`，不导航、不留半持久化态

