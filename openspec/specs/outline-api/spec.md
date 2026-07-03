# outline-api 规范

## 目的
待定 - 由归档变更 phase-5-outline-and-slide-planning 创建。归档后请更新目的。
## 需求
### 需求:大纲生成/编辑/确认端点与状态前置

系统必须提供大纲的四个端点，均遵循统一 `{error,code,details}` 信封与 HTTP 映射：

- `POST /api/projects/{projectId}/outline/generate`：要求 `state==OUTLINE_GENERATION` 且 **`spec is not None and spec.get("confirmedByUser")`**（spec 为规范化 dict，dict 访问；None-safe，`spec` 为 `None` 时按 `OUTLINE_NOT_CONFIRMABLE` 拒绝、不解引用）；调用 Outline Agent 生成并持久化 `project.outline`（`outline["confirmedByUser"]=False`），追加经校验的 `OUTLINE_GENERATED` 事件；返回完整大纲。
- `PUT /api/projects/{projectId}/outline`：人工整体替换/编辑大纲，要求 `state ∈ {OUTLINE_GENERATION, OUTLINE_REVIEW}`；提交体经 `Outline` 校验，通过则覆盖 `project.outline`（保持未确认）并追加 `OUTLINE_UPDATED`。
- `POST /api/projects/{projectId}/outline/confirm`：要求 `state==OUTLINE_REVIEW` 且存在 `project.outline`；置 `outline["confirmedByUser"]=True`、追加 `OUTLINE_CONFIRMED`，**不推进工作流状态**（停留 `OUTLINE_REVIEW`，与 Spec 确认语义一致）。
- `GET /api/projects/{projectId}/outline`：读取持久化的完整 `project.outline`（含 `confirmedByUser`）；不存在时 `OUTLINE_NOT_FOUND`。（兑现 design D1 的「可读」承诺，避免 Phase 4 无读端点之痛。）

错误码分层：**「状态前置」与「内容前置」分开**——在错误的状态调用动作端点（如项目在 `REQUIREMENT_REVIEW` 就调 `outline/generate`，尚未转移进 `OUTLINE_GENERATION`）必须以状态错误 `INVALID_STATE_TRANSITION`(409) 拒绝（抛出点须清除 `InvalidStateTransitionError` 默认的无意义 `field="to"`，见 task 7.1）；`OUTLINE_NOT_CONFIRMABLE` **仅**指「已在 `OUTLINE_GENERATION` 但 spec 未确认或为 `None`」这一内容前置。大纲缺失调 confirm/GET 必须 `OUTLINE_NOT_FOUND`；大纲校验不过必须 `OUTLINE_VALIDATION_ERROR`。所有事件必须 validate-before-append（校验失败零持久化）。

#### 场景:在 OUTLINE_GENERATION 且 Spec 已确认时生成大纲

- **当** 项目 `state==OUTLINE_GENERATION`、Spec 已确认，客户端 `POST .../outline/generate`
- **那么** 系统必须持久化大纲、追加 `OUTLINE_GENERATED` 并返回完整大纲，工作流状态保持 `OUTLINE_GENERATION`

#### 场景:Spec 未确认时拒绝生成大纲

- **当** 项目转移到 `OUTLINE_GENERATION` 但 Spec `confirmedByUser==false`，客户端 `POST .../outline/generate`
- **那么** 系统必须以 `OUTLINE_NOT_CONFIRMABLE` 拒绝，不持久化大纲、不追加事件

#### 场景:无 Spec 的 OUTLINE_GENERATION 生成 None-safe 拒绝

- **当** 项目经「只转移不生成」到达 `OUTLINE_GENERATION` 而 `project.spec is None`，客户端 `POST .../outline/generate`
- **那么** 系统必须以 `OUTLINE_NOT_CONFIRMABLE` 稳定拒绝、**不解引用 `None`**、不崩溃、不追加事件

#### 场景:人工编辑大纲

- **当** 项目处于 `OUTLINE_REVIEW`，客户端 `PUT .../outline` 提交通过校验的大纲
- **那么** 系统必须覆盖大纲（保持未确认）并追加 `OUTLINE_UPDATED`

#### 场景:编辑提交非法大纲被拒绝

- **当** `PUT .../outline` 的提交体未通过 `Outline` 校验
- **那么** 系统必须以 `OUTLINE_VALIDATION_ERROR` 拒绝，`project.outline` 与事件序列保持不变

#### 场景:确认大纲不推进状态

- **当** 项目处于 `OUTLINE_REVIEW` 且存在大纲，客户端 `POST .../outline/confirm`
- **那么** 系统必须置 `outline["confirmedByUser"]=True`、追加 `OUTLINE_CONFIRMED`，工作流状态保持 `OUTLINE_REVIEW`

#### 场景:无大纲时确认被拒绝

- **当** 项目处于 `OUTLINE_REVIEW` 但 `project.outline` 为空，客户端 `POST .../outline/confirm`
- **那么** 系统必须以 `OUTLINE_NOT_FOUND` 拒绝，不追加事件

#### 场景:错误状态调用大纲端点按状态错误拒绝

- **当** 项目处于 `REQUIREMENT_REVIEW`（尚未转移进 `OUTLINE_GENERATION`）却直接 `POST .../outline/generate`
- **那么** 系统必须以 `INVALID_STATE_TRANSITION`(409) 状态错误拒绝（非 `OUTLINE_NOT_CONFIRMABLE`），不持久化、不追加事件

#### 场景:读取持久化大纲

- **当** 存在大纲的项目 `GET .../outline`
- **那么** 系统必须返回完整 `Outline`（含 `confirmedByUser`）；若无大纲则 `OUTLINE_NOT_FOUND`

#### 场景:重复确认大纲重放安全（非严格幂等）

- **当** 已确认大纲的项目（仍在 `OUTLINE_REVIEW`）再次 `POST .../outline/confirm`
- **那么** 系统必须不崩溃、不产生错误态、保持大纲已确认（`outline["confirmedByUser"]` 为 true）与 `OUTLINE_REVIEW`；允许再追加一条 `OUTLINE_CONFIRMED`（重放安全，非严格幂等，与 confirm 不推进状态一致）

