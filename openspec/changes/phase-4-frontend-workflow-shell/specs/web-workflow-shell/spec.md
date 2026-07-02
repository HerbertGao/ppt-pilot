## 新增需求

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

后端 `discover`/`answer`/`skip`/`confirm` **不推进工作流状态**（返回 `nextState = 当前 state`），而 `confirm` 硬性要求项目处于 `REQUIREMENT_REVIEW`，进入该状态的唯一路径是显式 `POST /api/projects/{id}/transitions`（`NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`，无跨级边、无 `REVIEW→REVIEW` 自环）。`transitions`（前向）属于本能力消费的端点。前端驱动前向转移必须遵循两条规则，**避免任何页面在 mount 时因后端状态而自动推进到一个「必失败动作」的态**（后端无会话读端点，前端无法从 `GET project` 区分「有会话的 DISCOVERY」与「被清空会话的 DISCOVERY」）：

1. **`NEW_PROJECT → REQUIREMENT_DISCOVERY`**：可在需求澄清页 mount 时**自动**驱动（仅当为 `NEW_PROJECT`；幂等，已在 DISCOVERY 则跳过）。这是安全入口，`NEW_PROJECT` 不存在「被清空的会话」态。
2. **`REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`**：**只能由用户在需求澄清页的显式动作（如「进入复核」按钮）驱动**，且该动作**必须以 `state==REQUIREMENT_DISCOVERY` 为前置**——仅当处于 DISCOVERY 才 `POST .../transitions {to:"REQUIREMENT_REVIEW"}`、成功后导航到复核页；**若已是 `REQUIREMENT_REVIEW`（SPA 重入 / 导航滞后双击）则只导航、不再发起转移**（避免非法 `REVIEW→REVIEW`）。**禁止**复核页在 mount 时自动驱动此转移。两侧对称重定向：**复核页 mount 时若 `state != REQUIREMENT_REVIEW` 必须重定向回澄清页**；**澄清页 mount 时若 `state == REQUIREMENT_REVIEW`（back/手动 URL）应重定向到复核页**（复核态改需求须走 rollback-first）。由此复核页永远只在「已是 REVIEW」时渲染确认，杜绝「从被清空会话的 DISCOVERY 自动推进出无会话 REVIEW」。

确认动作的可用性由「项目是否处于 `REQUIREMENT_REVIEW`」决定。转移失败（`INVALID_STATE_TRANSITION` 等）按统一错误呈现。

#### 场景:进入澄清前自动推进到 DISCOVERY

- **当** 用户从立项进入需求澄清、项目仍为 `NEW_PROJECT`
- **那么** 需求澄清页必须先 `POST .../transitions {to:"REQUIREMENT_DISCOVERY"}`（幂等，已在 DISCOVERY 则跳过），成功后再按 discover 规则处理

#### 场景:进入复核由显式动作驱动，复核页不自动转移

- **当** 用户在需求澄清页点击「进入复核」、项目处于 `REQUIREMENT_DISCOVERY`
- **那么** 前端必须先 `POST .../transitions {to:"REQUIREMENT_REVIEW"}` 成功后再导航到复核页；复核页自身 mount 时不得驱动该转移

#### 场景:复核页在非 REVIEW 态 mount 重定向而非自动推进

- **当** 复核页 mount 时项目 `state != REQUIREMENT_REVIEW`（如直接访问 URL、或 profile 重置窗口内刷新落到复核页）
- **那么** 前端必须重定向回需求澄清页，**禁止**自动 `DISCOVERY→REVIEW` 转移或展示确认按钮

#### 场景:已在 REVIEW 重入复核正常确认

- **当** 项目已处于 `REQUIREMENT_REVIEW`，用户（刷新/回退前进）重新进入复核页
- **那么** 前端不发起任何转移，因当前即 `REQUIREMENT_REVIEW` 正常提供确认动作

#### 场景:进入复核在已 REVIEW 时只导航不转移

- **当** 项目已是 `REQUIREMENT_REVIEW`，用户在澄清页（SPA 重入/导航滞后）再次触发「进入复核」
- **那么** 前端必须**只导航到复核页、不发起 `transitions`**（避免非法 `REVIEW→REVIEW`）

#### 场景:澄清页在 REVIEW 态 mount 重定向到复核

- **当** 澄清页 mount 时项目 `state == REQUIREMENT_REVIEW`（back/手动 URL 直达）
- **那么** 前端必须重定向到复核页（复核态改需求须走 rollback-first），不在澄清页自动 `discover` 覆盖会话

#### 场景:状态栏反映真实推进

- **当** 前端驱动了前向转移
- **那么** 工作流状态栏显示的 `WorkflowState` 必须随之更新（不得停留在 `NEW_PROJECT`）

### 需求:工作流状态展示与页面可达性

Web 应用必须展示项目当前 `WorkflowState`（取自后端），并据此约束页面可达性：未确认 Spec 前不得暴露后续阶段（outline 及之后）入口。进入与当前后端状态不符的页面时，必须按后端返回的状态/错误提示并引导用户回到正确阶段，禁止基于前端臆测状态执行破坏性操作。

#### 场景:展示当前工作流状态

- **当** 用户打开某个项目
- **那么** 界面必须显示其当前 `WorkflowState`（如 `REQUIREMENT_DISCOVERY` / `REQUIREMENT_REVIEW`）

#### 场景:不越权暴露后续阶段

- **当** 项目尚未确认 Spec
- **那么** 界面禁止提供 outline / slide / 导出等后续阶段入口（本期这些页面也不存在）

### 需求:场景/风格控件基座

Web 应用必须提供场景（`scene` ∈ default/education/corporate）与风格（`styleProfileId`）的选择控件，取值约束与默认回退与后端一致（省略 `styleProfileId` 走 scene 默认 profile）。控件在立项与 profile 更新处复用。

#### 场景:场景默认风格

- **当** 用户选择 `scene` 但不选 `styleProfileId`
- **那么** 界面必须按后端语义使用该 scene 的默认 profile（不强制用户选风格）
