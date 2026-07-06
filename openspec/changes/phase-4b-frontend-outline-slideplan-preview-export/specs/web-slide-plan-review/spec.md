## 新增需求

### 需求:链式生成幻灯片规划——转移 → generate → 转移

首次「生成规划」入口位于**大纲复核页（前驱页，`state==OUTLINE_REVIEW` 且大纲已确认时可用）**的「生成幻灯片规划」CTA——slide-plans 页的挂载守卫只接受 `{SLIDE_PLANNING, SLIDE_PLAN_REVIEW}`，在 `OUTLINE_REVIEW` 会被重定向到 `/outline`，故首次入口不能放在 slide-plans 页。slide-plans 页只承载**生成态 `SLIDE_PLANNING` 的 loading/错误+重试**（链式部分失败落入此态时）。该入口必须按**链式次序**执行：① `POST /api/projects/{id}/transitions {to:"SLIDE_PLANNING"}` ② `POST /api/projects/{id}/slides/plans/generate` ③ `POST /api/projects/{id}/transitions {to:"SLIDE_PLAN_REVIEW"}` ④ 导航到 `/projects/{id}/slide-plans`。链式执行期间显示 loading。**步骤 ① 成功但 ② 失败**时 state 留在 `SLIDE_PLANNING`，导航到 slide-plans 页显示错误 + 重试（重试只重调 ② + ③）。失败不得导航到复核态。链式执行必须可中断（`AbortSignal`）。

#### 场景:确认大纲后链式生成规划

- **当** 项目 `state==OUTLINE_REVIEW` 且大纲已确认，用户触发「生成规划」
- **那么** 前端必须依次执行 转移→generate→转移→导航，期间 loading，最终停在 `SLIDE_PLAN_REVIEW` 并展示规划

#### 场景:生成失败留在规划态并支持重试

- **当** 链式步骤 ② `POST /slides/plans/generate` 失败
- **那么** 前端导航到 slide-plans 页显示错误 + 重试，重试只重调 generate + 后续转移

### 需求:逐页 plan 编辑与单页保存

规划复核页在 `state==SLIDE_PLAN_REVIEW` 时必须 `GET /api/projects/{id}/slides/plans` 拉取 `{slidePlans, slidePlansConfirmed}`，渲染逐页卡片（每页展示 `slideId`/`title`/`objective`/`keyMessage`/`contentIntent`/`visualIntent`/`layoutSuggestion`/`requiredAssets`/`riskNotes`）。每页卡片支持就地编辑字段，编辑存入页面本地 state。单页保存调 `PUT /api/projects/{id}/slides/{slideId}/plan`（请求体是该页完整 `SlidePlan` 对象，`slideId` 在 URL 路径中定位）。保存成功后提示已保存并 `refresh()`；失败（`SLIDE_PLAN_VALIDATION_ERROR`/状态错误）保持本地编辑、显示错误。`visualIntent` 编辑必须约束为枚举值（`diagram|image|chart|text|comparison|timeline`），用 select 而非自由文本。

#### 场景:编辑单页 plan 后保存

- **当** 用户在 `SLIDE_PLAN_REVIEW` 编辑某页 plan 字段后保存该页
- **那么** 前端必须调 `PUT /slides/{slideId}/plan` 发送该页完整 SlidePlan，成功后提示并重读状态

#### 场景:visualIntent 约束为枚举

- **当** 用户编辑 `visualIntent` 字段
- **那么** 前端必须提供 select 限定为 `diagram|image|chart|text|comparison|timeline`，禁止自由文本

#### 场景:单页保存失败保留编辑

- **当** `PUT /slides/{slideId}/plan` 返回 `SLIDE_PLAN_VALIDATION_ERROR`
- **那么** 前端必须保持该页本地编辑、显示错误，不清空

### 需求:确认规划并进入物化

规划复核页在 `state==SLIDE_PLAN_REVIEW` 且 plans 非空时必须提供「确认规划」按钮调 `POST /api/projects/{id}/slides/plans/confirm`。确认成功后反映项目仍停留在 `SLIDE_PLAN_REVIEW`，显示「物化幻灯片」CTA。**CTA 可见性必须由 `slidePlansConfirmed` 派生**：后端 `update_slide_plan`（单页保存）会把 `slidePlansConfirmed` 置回 `false`，故确认后再编辑保存即回到未确认态，此时**必须隐藏「物化」CTA 直到重新确认**——否则转移进 `SLIDE_GENERATION` 后 `materialize` 因规划未确认抛 `SLIDES_NOT_MATERIALIZABLE` 而滞留。该 CTA 执行 `POST /transitions {to:"SLIDE_GENERATION"}` → 导航到 `/projects/{id}/preview`（物化由预览页触发，不在本页链式调 `materialize`——预览页需要展示物化 loading 与结果）。**确认失败的真实错误码是 `INVALID_STATE_TRANSITION` 或 `SLIDE_PLAN_NOT_FOUND`（无规划可确认）**——`SLIDE_PLAN_NOT_CONFIRMABLE` 是 generate 步（大纲未确认）才抛的码，**不由 confirm 抛出**。确认失败显示错误、不导航。重复确认重放安全。

#### 场景:确认规划后展示物化 CTA

- **当** 用户在 `SLIDE_PLAN_REVIEW` 点「确认规划」成功
- **那么** 前端必须显示已确认态 + 「物化幻灯片」CTA，不自行推进状态

#### 场景:确认后转移进入 SLIDE_GENERATION

- **当** 用户点「物化幻灯片」CTA
- **那么** 前端必须执行 `POST /transitions {to:"SLIDE_GENERATION"}` → 导航到 `/projects/{id}/preview`

#### 场景:确认失败不导航

- **当** `POST /slides/plans/confirm` 失败
- **那么** 前端必须显示错误、保持未确认态、不导航

### 需求:挂载守卫——错位 state 重定向

规划页 mount 时必须检查 `state`：**当且仅当**属于 `{SLIDE_PLANNING, SLIDE_PLAN_REVIEW}` 留在本页，否则一律重定向到 `currentStepPath(state)`。因 `guardSlidePlansMount` 接受集只含这两态，`state==SLIDE_GENERATION` 或之后态会被**重定向到当前步骤页**——本期规划页**不做「只读规划」旁路**（与接受集自洽，避免守卫重定向与页面只读展示自相矛盾）。`state<SLIDE_PLANNING` 同样重定向。

#### 场景:在 SLIDE_PLANNING 态显示 loading

- **当** 用户在 `SLIDE_PLANNING` 态进入规划页
- **那么** 前端必须显示 loading 或错误 + 重试，不展示空白编辑器

#### 场景:在 SLIDE_PLAN_REVIEW 态显示编辑器

- **当** 用户在 `SLIDE_PLAN_REVIEW` 态进入规划页
- **那么** 前端必须 `GET /slides/plans` 拉取并展示可编辑的 plan 卡片

#### 场景:state 过前重定向

- **当** 用户在 `OUTLINE_REVIEW`（大纲未确认）进入规划页
- **那么** 前端必须重定向到 `currentStepPath(OUTLINE_REVIEW)` 返回的大纲页

### 需求:错误映射与用户可读提示

规划页必须复用 `ApiError`（经 `errors.ts` 的 `presentError` 中央映射，需先按 tasks 1.6 补齐），按 `code` 映射：`INVALID_STATE_TRANSITION` → 刷新提示；`SLIDE_PLAN_NOT_CONFIRMABLE` → 请先确认大纲（**此码来自 generate 步：大纲未确认时 `POST /slides/plans/generate` 抛出，不是 confirm 步的失败码**）；`SLIDE_PLAN_NOT_FOUND` → 无规划（`GET /slides/plans`、`POST /slides/plans/confirm` 无规划时、或 `PUT /slides/{slideId}/plan` slideId 失效时抛 404）；`SLIDE_PLAN_VALIDATION_ERROR` → 校验失败 + `detailMessage`；`LLM_PROVIDER_ERROR` → AI 服务不可用请重试；`NETWORK_ERROR` → 网络失败。不得暴露原始异常。

#### 场景:LLM 错误显示可重试提示

- **当** `POST /slides/plans/generate` 返回 `LLM_PROVIDER_ERROR`(502)
- **那么** 前端必须显示「AI 服务暂时不可用，请重试」+ 重试按钮
