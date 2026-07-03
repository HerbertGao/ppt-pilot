## 新增需求

### 需求:Slide Plan 生成/编辑/确认端点与状态前置

系统必须提供 slide plan 的四个端点，均遵循统一 `{error,code,details}` 信封与 HTTP 映射：

- `POST /api/projects/{projectId}/slides/plans/generate`：要求 `state==SLIDE_PLANNING` 且 **`outline is not None and outline.get("confirmedByUser")`**（outline 为规范化 dict，dict 访问；None-safe，产物为 `None` 时按 `SLIDE_PLAN_NOT_CONFIRMABLE` 拒绝、不解引用）；调用 Slide Planner Agent，由**服务层为每页确定性赋唯一 `slideId`**，**整体覆盖** `project.slidePlans` 并置 `project.slidePlansConfirmed=false`（重生成显式丢弃此前 `PUT` 编辑，非静默），追加经校验的 `SLIDE_PLAN_GENERATED` 事件（payload 含 `slideIds`）；返回全部规划。
- `PUT /api/projects/{projectId}/slides/{slideId}/plan`：人工编辑单页规划，要求 `state ∈ {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}` 且**路径** `slideId` 存在于当前规划集；提交体经 `SlidePlan` 校验，**服务必须强制该页 `slideId` 等于路径值（忽略/覆盖提交体内的 `slideId`，客户端不得借 body 改动服务所有的 id）并在覆盖后重校验集合级 slideId 唯一性**；通过则覆盖该页规划、置 `slidePlansConfirmed=false` 并追加 `SLIDE_PLAN_UPDATED`。
- `POST /api/projects/{projectId}/slides/plans/confirm`：要求 `state==SLIDE_PLAN_REVIEW` 且存在**非空**规划；置 `project.slidePlansConfirmed=true`、追加 `SLIDE_PLAN_CONFIRMED`，**不推进工作流状态**（停留 `SLIDE_PLAN_REVIEW`，作为 Phase 5 终态）。
- `GET /api/projects/{projectId}/slides/plans`：读取持久化的完整 `project.slidePlans`（含 `slidePlansConfirmed`）；不存在/为空时 `SLIDE_PLAN_NOT_FOUND`。

**规划确认态存于项目级 `slidePlansConfirmed`**（`SlidePlan` 无 schema 级确认字段）：`confirm` 置真，`generate`/`PUT`/相关回退置假。内容前置：大纲未确认调 generate 必须 `SLIDE_PLAN_NOT_CONFIRMABLE`；错误状态调用（如未转移进 `SLIDE_PLANNING` 就 generate）以 `INVALID_STATE_TRANSITION` 拒绝（抛出点须清除 `InvalidStateTransitionError` 默认的无意义 `field="to"`）；未知/缺失 `slideId` 或规划为空必须 `SLIDE_PLAN_NOT_FOUND`；校验不过必须 `SLIDE_PLAN_VALIDATION_ERROR`。所有事件 validate-before-append。

#### 场景:大纲已确认时生成逐页规划

- **当** 项目 `state==SLIDE_PLANNING`、大纲已确认，客户端 `POST .../slides/plans/generate`
- **那么** 系统必须持久化逐页 `SlidePlan`、追加 `SLIDE_PLAN_GENERATED` 并返回全部规划，状态保持 `SLIDE_PLANNING`

#### 场景:大纲未确认时拒绝生成规划

- **当** 项目 `state==SLIDE_PLANNING` 但大纲未确认（`outline["confirmedByUser"]` 为 false），客户端 `POST .../slides/plans/generate`
- **那么** 系统必须以 `SLIDE_PLAN_NOT_CONFIRMABLE` 拒绝，不持久化规划、不追加事件

#### 场景:无大纲的 SLIDE_PLANNING 生成 None-safe 拒绝

- **当** 项目经「只转移不生成」到达 `SLIDE_PLANNING` 而 `project.outline is None`，客户端 `POST .../slides/plans/generate`
- **那么** 系统必须以 `SLIDE_PLAN_NOT_CONFIRMABLE` 稳定拒绝、**不解引用 `None`**、不崩溃、不追加事件

#### 场景:PUT 强制路径 slideId 忽略 body id

- **当** 客户端对存在的路径 `slideId=slide-0002` `PUT .../plan`，但提交体内 `slideId` 写成别的值
- **那么** 系统必须以路径 `slide-0002` 为准（覆盖/忽略 body id）、覆盖该页并重校验集合唯一性，客户端不得借此改动服务所有的 id

#### 场景:人工编辑单页规划

- **当** 项目处于 `SLIDE_PLAN_REVIEW`，客户端对存在的 `slideId` `PUT .../plan` 提交通过校验的 `SlidePlan`
- **那么** 系统必须覆盖该页规划并追加 `SLIDE_PLAN_UPDATED`

#### 场景:编辑未知 slideId 被拒绝

- **当** `PUT .../slides/{slideId}/plan` 的 `slideId` 不在当前规划集内
- **那么** 系统必须以 `SLIDE_PLAN_NOT_FOUND` 拒绝，规划集与事件序列保持不变

#### 场景:编辑提交非法规划被拒绝

- **当** `PUT .../plan` 提交体未通过 `SlidePlan` 校验（如 `visualIntent` 越界）
- **那么** 系统必须以 `SLIDE_PLAN_VALIDATION_ERROR` 拒绝，不覆盖、不追加事件

#### 场景:确认规划置确认标志且不推进状态

- **当** 项目处于 `SLIDE_PLAN_REVIEW` 且存在规划，客户端 `POST .../slides/plans/confirm`
- **那么** 系统必须置 `project.slidePlansConfirmed=true`、追加 `SLIDE_PLAN_CONFIRMED`，工作流状态保持 `SLIDE_PLAN_REVIEW`（Phase 5 终态，后续前向边归属 Phase 6）

#### 场景:重新生成整体覆盖并作废确认与编辑

- **当** 已有规划（可能含 `PUT` 编辑、`slidePlansConfirmed=true`）的项目在 `SLIDE_PLANNING` 再次 `POST .../slides/plans/generate`
- **那么** 系统必须整体覆盖 `project.slidePlans` 为新赋 slideId 的规划集、置 `slidePlansConfirmed=false`（显式丢弃旧编辑，非静默），并追加 `SLIDE_PLAN_GENERATED`

#### 场景:读取持久化规划

- **当** 存在规划的项目 `GET .../slides/plans`
- **那么** 系统必须返回完整规划集与 `slidePlansConfirmed`；若无规划则 `SLIDE_PLAN_NOT_FOUND`

#### 场景:重复确认规划重放安全（非严格幂等）

- **当** 已确认规划的项目（仍在 `SLIDE_PLAN_REVIEW`）再次 `POST .../slides/plans/confirm`
- **那么** 系统必须不崩溃、不产生错误态、保持 `slidePlansConfirmed=true` 与 `SLIDE_PLAN_REVIEW`；允许再追加一条 `SLIDE_PLAN_CONFIRMED`（重放安全，非严格幂等）
