# web-workflow-shell 规范

## 目的
待定 - 由归档变更 phase-4-frontend-workflow-shell 创建。归档后请更新目的。
## 需求
### 需求:同源 API 客户端与统一错误/加载态

Web 应用必须通过一个类型安全的 API 客户端访问后端，所有请求走同源 `/api/*`（由 Next rewrites 代理到后端），请求/响应类型必须来自 `@ppt-pilot/shared-schema`（canonical 实体）或前端本地类型（Phase 3 瞬时响应，如问题卡/置信度视图）。非 2xx 响应必须按 Phase 2/3 统一错误信封 `{error,code,details}` 解析为结构化错误；UI 必须按 `code` 呈现可读信息，对未知 `code` 有兜底展示（显示 `error` / `details.message`），禁止白屏或抛未捕获异常。每个异步调用必须有可见的加载态。

#### 场景:错误信封被结构化呈现

- **当** 任一后端调用返回非 2xx 的 `{error,code,details}`
- **那么** 界面必须按 `code` 展示可读提示（未知 code 走兜底展示 `details.message`），且不崩溃、不白屏

#### 场景:LLM 上游失败可读且可重试

- **当** 某次调用返回 `code=LLM_PROVIDER_ERROR`（HTTP 502）
- **那么** 界面必须提示「AI 服务暂不可用」并允许用户重试，而非显示原始错误

#### 场景:后端不可达

- **当** `/api` 代理目标不可达（后端未启动/网络失败）
- **那么** 界面必须以统一方式提示「后端不可达」，不崩溃

### 需求:前端驱动工作流前向转移

后端 `discover`/`answer`/`skip`/`confirm`/`generate`/`update`/`confirm`/`materialize`/`export` 等**动作端点一律不推进工作流状态**，前向推进**只能**经显式 `POST /api/projects/{id}/transitions`（无跨级边、无自环）。**注意响应形状差异**：Phase 3 需求端点（`discover`/`answer`/`skip`/`requirements/confirm`）返回含 `nextState` 字段的会话/确认视图；而 Phase 5–7 动作端点（`outline`/`slides` 的 generate/update/confirm、`materialize`、`export`）**返回裸领域对象（`Outline` / `{slidePlans,slidePlansConfirmed}` / `Presentation` / 导出 metadata），响应体不含 `nextState` 字段**——前端不得从这些响应读 `nextState`，推进后的真实状态经 `POST /transitions` 的响应或 `useProject.refresh()` 重读。前端驱动前向转移必须遵循以下规则，**避免任何页面在 mount 时因后端状态而自动推进到一个「必失败动作」的态**：

1. **`NEW_PROJECT → REQUIREMENT_DISCOVERY`**：可在需求澄清页 mount 时**自动**驱动（仅当为 `NEW_PROJECT`；幂等，已在 DISCOVERY 则跳过）。
2. **`REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`**：**只能由用户在需求澄清页的显式动作驱动**，前置 `state==REQUIREMENT_DISCOVERY`；若已是 `REQUIREMENT_REVIEW` 则只导航不转移；**禁止**复核页 mount 时自动驱动。
3. **`REQUIREMENT_REVIEW → OUTLINE_GENERATION`**：由 Spec 复核页确认后的「生成大纲」CTA 驱动（见 `web-outline-review`），是「转移 → generate → 转移」链式的第一步；前置 Spec 已确认。
4. **`OUTLINE_GENERATION → OUTLINE_REVIEW`**：由大纲生成链式动作在 `POST /outline/generate` 成功后驱动（非用户直接点转移按钮）。
5. **`OUTLINE_REVIEW → SLIDE_PLANNING`**：由大纲复核页确认后的「生成幻灯片规划」CTA 驱动，是规划生成链式的第一步；前置大纲已确认。
6. **`SLIDE_PLANNING → SLIDE_PLAN_REVIEW`**：由规划生成链式动作在 `POST /slides/plans/generate` 成功后驱动。
7. **`SLIDE_PLAN_REVIEW → SLIDE_GENERATION`**：由规划复核页确认后的「物化幻灯片」CTA 驱动（前置规划已确认）；本转移只进入生成态，物化由预览页触发。
8. **`SLIDE_GENERATION → EXPORT_READY`**：由预览页的「进入导出」CTA 驱动（前置 presentation 已物化）。
9. **`EXPORT_READY → EXPORTED`**：由导出页的「标记为已导出」CTA 驱动（前置至少一个导出产物）。

每条前向转移必须以**当前态匹配**为前置（如第 3 条要求 `state==REQUIREMENT_REVIEW`），转移失败（`INVALID_STATE_TRANSITION`）按统一错误呈现。生成类链式动作（3-4、5-6）中间态对用户表现为 loading；链式部分失败时 state 留在生成态，前端导航到目标页显示错误 + 重试。**禁止**任何步骤页在 mount 时自动驱动前向转移（复核/生成/预览/导出页均不自动推进），挂载守卫只做重定向不做转移。回退转移（rollback）本期前端不主动驱动（profile 改动的 rollback-first 已在 Phase 4 落地，其余回退属后续 UX）。

#### 场景:进入澄清前自动推进到 DISCOVERY

- **当** 用户从立项进入需求澄清、项目仍为 `NEW_PROJECT`
- **那么** 需求澄清页必须先 `POST .../transitions {to:"REQUIREMENT_DISCOVERY"}`（幂等，已在 DISCOVERY 则跳过），成功后再按 discover 规则处理

#### 场景:进入复核由显式动作驱动，复核页不自动转移

- **当** 用户在需求澄清页点击「进入复核」、项目处于 `REQUIREMENT_DISCOVERY`
- **那么** 前端必须先 `POST .../transitions {to:"REQUIREMENT_REVIEW"}` 成功后再导航到复核页；复核页自身 mount 时不得驱动该转移

#### 场景:复核页在非 REVIEW 态 mount 重定向而非自动推进

- **当** 复核页 mount 时项目 `state != REQUIREMENT_REVIEW`
- **那么** 前端必须重定向到 `currentStepPath(state)` 返回的路径，**禁止**自动推进或展示确认按钮

#### 场景:生成大纲链式驱动两段转移

- **当** 用户在 Spec 复核页点「生成大纲」、项目处于 `REQUIREMENT_REVIEW` 且 Spec 已确认
- **那么** 前端必须依次 `POST /transitions {to:"OUTLINE_GENERATION"}` → `POST /outline/generate` → `POST /transitions {to:"OUTLINE_REVIEW"}` → 导航到 outline 页

#### 场景:确认规划后转移进入 SLIDE_GENERATION

- **当** 用户在规划复核页点「物化幻灯片」、项目处于 `SLIDE_PLAN_REVIEW` 且规划已确认
- **那么** 前端必须 `POST /transitions {to:"SLIDE_GENERATION"}` → 导航到预览页（物化由预览页触发）

#### 场景:预览页进入导出转移

- **当** 用户在预览页点「进入导出」、presentation 已物化
- **那么** 前端必须 `POST /transitions {to:"EXPORT_READY"}` → 导航到导出页

#### 场景:步骤页 mount 不自动转移

- **当** 用户直接访问任一步骤页（outline/slide-plans/preview/export）URL、state 不匹配该页
- **那么** 前端必须重定向到 `currentStepPath(state)`，**禁止**自动发起任何前向转移

#### 场景:状态栏反映真实推进

- **当** 前端驱动了前向转移
- **那么** 工作流状态栏显示的 `WorkflowState` 必须随之更新

### 需求:工作流状态展示与页面可达性

Web 应用必须展示项目当前 `WorkflowState`（取自后端 `GET /api/projects/{id}`），并据此约束页面可达性。**Spec 确认前**不得暴露 outline 及之后阶段入口；**Spec 确认后**按当前态暴露对应步骤页入口。进入与当前后端状态不符的页面时，必须经 `currentStepPath(state)` 重定向到正确阶段，禁止基于前端臆测状态执行破坏性操作。

步骤页可达性映射（`currentStepPath`）：

```text
NEW_PROJECT, REQUIREMENT_DISCOVERY → /projects/{id}/discovery
REQUIREMENT_REVIEW                 → /projects/{id}/review
OUTLINE_GENERATION, OUTLINE_REVIEW → /projects/{id}/outline
SLIDE_PLANNING, SLIDE_PLAN_REVIEW  → /projects/{id}/slide-plans
SLIDE_GENERATION                   → /projects/{id}/preview
EXPORT_READY, EXPORTED             → /projects/{id}/export
EDITING, REVIEW                    → /projects/{id}/preview (Phase 8 前不可达；防御性映射)
```

每态唯一目标、互斥谓词，**对所有当前可达态不产生重定向环**。`currentStepPath` 是 state 的纯函数，可独立单测。**已知边界**：`EDITING`/`REVIEW` 映射到 `/preview` 但不在 `preview` 接受集内，若可达会形成 `guardPreviewMount → /preview → guardPreviewMount` 自环；此二态在 Phase 8 前无 `TRANSITION_EDGES`、不可达，故该自环是死路（当前无害）。`// ponytail: EDITING/REVIEW 防御性映射；Phase 8 给它们加边使其可达时，须把二态并入 preview 接受集以保持无环不变式`。

#### 场景:展示当前工作流状态

- **当** 用户打开某个项目
- **那么** 界面必须显示其当前 `WorkflowState`（如 `REQUIREMENT_REVIEW` / `OUTLINE_REVIEW` / `EXPORT_READY`）

#### 场景:Spec 确认前不暴露后续阶段

- **当** 项目尚未确认 Spec（`state < OUTLINE_GENERATION`）
- **那么** 界面禁止提供 outline / slide-plans / preview / export 页入口；直接访问这些 URL 时重定向到 `currentStepPath(state)`

#### 场景:Spec 确认后按态暴露步骤页

- **当** 项目已确认 Spec 并推进到 `OUTLINE_REVIEW`
- **那么** 界面必须提供大纲复核页入口，且当前态对应的步骤页可达

#### 场景:错位 URL 重定向到当前步骤

- **当** 用户在 `SLIDE_PLAN_REVIEW` 态直接访问 `/projects/{id}/outline`
- **那么** 前端必须重定向到 `currentStepPath(SLIDE_PLAN_REVIEW)` 返回的规划页（本期步骤页不做跨步骤只读旁路，与 `guardOutlineMount`/`guardSlidePlansMount` 接受集自洽——见 `web-outline-review`/`web-slide-plan-review` 挂载守卫需求）

### 需求:场景/风格控件基座

Web 应用必须提供场景（`scene` ∈ default/education/corporate）与风格（`styleProfileId`）的选择控件，取值约束与默认回退与后端一致（省略 `styleProfileId` 走 scene 默认 profile）。控件在立项与 profile 更新处复用。

#### 场景:场景默认风格

- **当** 用户选择 `scene` 但不选 `styleProfileId`
- **那么** 界面必须按后端语义使用该 scene 的默认 profile（不强制用户选风格）

### 需求:步骤路由函数与全链挂载守卫

前端必须提供纯函数 `currentStepPath(projectId, state): string` 把每个 `WorkflowState` 映射到唯一步骤页路径（映射见「工作流状态展示与页面可达性」需求）。每个步骤页必须实现挂载守卫 `guard<Page>Mount(projectId, state): string | null`：若 `state` 属于该页接受集返回 `null`（留在本页），否则返回 `currentStepPath(projectId, state)`（重定向目标）。守卫必须与 Phase 4 既有 `guardReviewMount`/`guardDiscoveryMount` 同构（纯函数、互斥谓词、无副作用）。接受集：

```
outline     : {OUTLINE_GENERATION, OUTLINE_REVIEW}
slide-plans : {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}
preview     : {SLIDE_GENERATION, EXPORT_READY, EXPORTED}
export      : {EXPORT_READY, EXPORTED}
```

`preview` 与 `export` 的接受集在 `EXPORT_READY`/`EXPORTED` 重叠——这两个态两个页都接受（预览页只读展示 + 链到导出；导出页展示导出操作）。守卫不得发起任何 API 调用或状态转移（纯重定向决策）。

#### 场景:currentStepPath 是纯函数

- **当** 给定任意 `WorkflowState` 调 `currentStepPath(projectId, state)`
- **那么** 返回唯一对应路径，无副作用、无 API 调用，可独立单测

#### 场景:outline 页守卫接受生成与复核态

- **当** `state` 为 `OUTLINE_GENERATION` 或 `OUTLINE_REVIEW`
- **那么** `guardOutlineMount` 返回 `null`（留在 outline 页）

#### 场景:outline 页守卫拒绝其他态

- **当** `state` 为 `REQUIREMENT_REVIEW`（Spec 未确认）或 `SLIDE_PLANNING`（已过）
- **那么** `guardOutlineMount` 返回 `currentStepPath(projectId, state)`（重定向到对应页）

#### 场景:export 页守卫接受导出态

- **当** `state` 为 `EXPORT_READY` 或 `EXPORTED`
- **那么** `guardExportMount` 返回 `null`（留在导出页）

#### 场景:守卫无副作用

- **当** 任一 `guard<Page>Mount` 被调用
- **那么** 不得发起 API 请求、不得驱动转移，只返回路径或 null

