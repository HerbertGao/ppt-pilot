## 新增需求

### 需求:链式生成大纲——转移 → generate → 转移

首次「生成大纲」入口位于 **Spec 复核页（前驱页，`state==REQUIREMENT_REVIEW` 且 Spec 已确认时可用）**——大纲页自身的挂载守卫只接受 `{OUTLINE_GENERATION, OUTLINE_REVIEW}`，在 `REQUIREMENT_REVIEW` 会被重定向到 `/review`，故首次生成入口不能放在大纲页（tasks 7.1 已把 `chainGenerateOutline` 放在 review 页）。大纲页只承载**生成态 `OUTLINE_GENERATION` 的 loading/错误+重试**（链式部分失败落入此态时）。该入口必须按**链式次序**执行：① `POST /api/projects/{id}/transitions {to:"OUTLINE_GENERATION"}` ② `POST /api/projects/{id}/outline/generate` ③ `POST /api/projects/{id}/transitions {to:"OUTLINE_REVIEW"}` ④ 导航到 `/projects/{id}/outline`。链式执行期间必须显示 loading，禁止在中间态展示空白复核界面。**步骤 ① 成功但 ② 失败**时，state 留在 `OUTLINE_GENERATION`，前端必须导航到 outline 页显示错误 + 重试入口；**重试只重调 ② + ③**（不重复 ①——已在 `OUTLINE_GENERATION` 态）。**步骤 ② 失败**（`LLM_PROVIDER_ERROR`/`OUTLINE_VALIDATION_ERROR`）不得导航到复核态、不得持久化前端编辑态。链式执行必须可中断（`AbortSignal`），中断后不留半持久化前端状态。

#### 场景:确认 Spec 后链式生成大纲

- **当** 项目 `state==REQUIREMENT_REVIEW` 且 Spec 已确认，用户在 **Spec 复核页**点「生成大纲」
- **那么** 前端必须依次执行 转移→generate→转移→导航，期间显示 loading，最终停在 `OUTLINE_REVIEW` 并展示生成的大纲

#### 场景:生成失败留在生成态并支持重试

- **当** 链式步骤 ② `POST /outline/generate` 失败（如 `LLM_PROVIDER_ERROR`）
- **那么** 前端必须导航到 outline 页显示错误 + 重试按钮，重试只重调 generate + 后续转移，不重复前驱转移

#### 场景:链式执行可中断

- **当** 用户在链式执行期间离开页面或取消
- **那么** 前端必须经 `AbortSignal` 中断进行中的请求，不留半持久化前端状态

### 需求:大纲 section 就地编辑与整体保存

大纲复核页在 `state==OUTLINE_REVIEW` 时必须 `GET /api/projects/{id}/outline` 拉取已生成大纲，渲染 section 列表（每项展示 `title`/`purpose`/`estimatedSlides`），支持就地编辑字段、增加 section、删除 section、重排 section 顺序。编辑必须存入页面本地 state（`useState`），**不在每次按键时调 API**。「保存」按钮调 `PUT /api/projects/{id}/outline`（请求体是完整的 `Outline` 对象——后端整体替换）。保存成功后必须 `refresh()` 重读项目状态并提示已保存；保存失败（`OUTLINE_VALIDATION_ERROR`/`INVALID_STATE_TRANSITION`）必须保持本地编辑态、显示错误、不清空用户输入。未保存时离开页面必须提示「未保存」。

#### 场景:编辑 section 后整体保存

- **当** 用户在 `OUTLINE_REVIEW` 编辑 section 字段后点「保存」
- **那么** 前端必须调 `PUT /outline` 发送完整 Outline，成功后重读状态并提示已保存

#### 场景:增删与重排 section

- **当** 用户增加/删除/重排 section 后保存
- **那么** 前端必须把变更后的完整 section 数组随 `PUT /outline` 提交，后端整体替换

#### 场景:保存失败保留本地编辑

- **当** `PUT /outline` 返回 `OUTLINE_VALIDATION_ERROR`
- **那么** 前端必须保持用户本地编辑态、显示错误，不清空输入

#### 场景:未保存离开提示

- **当** 用户有未保存编辑时尝试离开页面
- **那么** 前端必须提示「未保存」，由用户确认是否离开

### 需求:确认大纲并进入下一步

大纲复核页在 `state==OUTLINE_REVIEW` 且大纲存在时必须提供「确认大纲」按钮调 `POST /api/projects/{id}/outline/confirm`（返回裸 `Outline`，含 `confirmedByUser=true`）。确认成功后必须反映项目仍停留在 `OUTLINE_REVIEW`（确认不推进状态），并显示「生成幻灯片规划」CTA。**CTA 可见性必须由 `outline.confirmedByUser` 派生**：后端 `update_outline`（保存编辑）会把 `confirmedByUser` 置回 `false`，故用户在确认后再编辑保存即回到未确认态，此时**必须隐藏「生成规划」CTA 直到重新确认**——否则链 ① 转移成功但链 ② `generate_slide_plans` 因大纲未确认抛 `SLIDE_PLAN_NOT_CONFIRMABLE`，项目滞留 `SLIDE_PLANNING` 且「只重试 ②+③」无法恢复。该 CTA 执行链式：`POST /transitions {to:"SLIDE_PLANNING"}` → `POST /slides/plans/generate` → `POST /transitions {to:"SLIDE_PLAN_REVIEW"}` → 导航到 `/projects/{id}/slide-plans`。**确认失败的真实错误码是 `INVALID_STATE_TRANSITION`（非 `OUTLINE_REVIEW` 态）或 `OUTLINE_NOT_FOUND`（无大纲可确认）**——`OUTLINE_NOT_CONFIRMABLE` 是 generate 步（Spec 未确认）才抛的码，**不由 confirm 抛出**。确认失败必须显示错误、不导航。重复确认**重放安全**（后端幂等追加事件），前端不崩溃。

#### 场景:确认大纲后展示下一步 CTA

- **当** 用户在 `OUTLINE_REVIEW` 点「确认大纲」成功
- **那么** 前端必须显示已确认态 + 「生成幻灯片规划」CTA，不自行推进状态

#### 场景:确认后链式生成规划

- **当** 用户点「生成幻灯片规划」CTA
- **那么** 前端必须执行 转移→generate→转移→导航 到 slide-plans 页

#### 场景:确认失败不导航

- **当** `POST /outline/confirm` 失败
- **那么** 前端必须显示错误、保持未确认态、不导航

### 需求:挂载守卫——错位 state 重定向

大纲页 mount 时必须检查项目 `state`：**当且仅当** `state` 属于 `{OUTLINE_GENERATION, OUTLINE_REVIEW}` 留在本页，否则一律重定向到 `currentStepPath(state)`。因 `guardOutlineMount` 接受集只含这两态，`state==SLIDE_PLANNING` 或之后态会被**重定向到当前步骤页**——本期大纲页**不做「只读大纲」旁路**（与接受集自洽，避免「守卫重定向 vs 页面只读展示」自相矛盾；跨步骤只读回看属后续 UX）。`state<OUTLINE_GENERATION`（如 `REQUIREMENT_REVIEW` 未确认）同样重定向到对应页。

#### 场景:在 OUTLINE_GENERATION 态显示 loading

- **当** 用户在 `OUTLINE_GENERATION` 态进入大纲页
- **那么** 前端必须显示 loading（链式生成进行中）或错误 + 重试，不展示空白编辑器

#### 场景:在 OUTLINE_REVIEW 态显示编辑器

- **当** 用户在 `OUTLINE_REVIEW` 态进入大纲页
- **那么** 前端必须 `GET /outline` 拉取并展示可编辑的 section 列表

#### 场景:state 过前重定向

- **当** 用户在 `REQUIREMENT_REVIEW`（Spec 未确认）进入大纲页
- **那么** 前端必须重定向到 `currentStepPath(REQUIREMENT_REVIEW)` 返回的复核页

### 需求:错误映射与用户可读提示

大纲页必须复用 `ApiError` 处理全部端点错误，经 `apps/web/src/lib/errors.ts` 的 `presentError` 中央映射（需先按 tasks 1.6 补齐这些 Phase 5 码），按 `code` 映射用户可读提示：`INVALID_STATE_TRANSITION` → 状态不匹配提示刷新；`OUTLINE_NOT_CONFIRMABLE` → 请先确认 Spec（**此码来自 generate 步：Spec 未确认时 `POST /outline/generate` 抛出，不是 confirm 步的失败码**）；`OUTLINE_NOT_FOUND` → 无大纲（`GET /outline` 或 `POST /outline/confirm` 在无大纲时抛 404）；`OUTLINE_VALIDATION_ERROR` → 内容校验失败 + `detailMessage`；`LLM_PROVIDER_ERROR` → AI 服务不可用请重试；`NETWORK_ERROR` → 网络连接失败。不得向用户暴露原始异常或堆栈。

#### 场景:LLM 错误显示可重试提示

- **当** `POST /outline/generate` 返回 `LLM_PROVIDER_ERROR`(502)
- **那么** 前端必须显示「AI 服务暂时不可用，请重试」+ 重试按钮

#### 场景:状态错误提示刷新

- **当** 端点返回 `INVALID_STATE_TRANSITION`(409)
- **那么** 前端必须提示「状态不匹配，请刷新页面重试」
