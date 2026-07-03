## 修改需求

### 需求:合法状态转移与本期可执行范围

系统必须为工作流定义一张显式的合法邻接转移边表。仅当 `(from, to)` 是表中允许的邻接边时，系统才可推进项目状态；转移成功必须更新项目当前状态并追加事件（见 `event-log`）。**Phase 5 在 Phase 2 早期边的基础上加入大纲与规划阶段的前向与回退边**：前向 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW`；回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY`、`OUTLINE_GENERATION → REQUIREMENT_REVIEW`、`OUTLINE_REVIEW → OUTLINE_GENERATION`、`SLIDE_PLANNING → OUTLINE_REVIEW`、`SLIDE_PLAN_REVIEW → SLIDE_PLANNING`。**`SLIDE_PLAN_REVIEW` 之后（`SLIDE_GENERATION`/`EDITING`/`REVIEW`/`EXPORT_READY`/`EXPORTED`）的所有前向边其内容前置由 Phase 6+ 拥有，本期仍不纳入合法邻接边表**、不驱动。

边表只做**结构邻接**判定，转移入口**保持 LLM-free**（禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM），且**不给前向边加内容守卫**。由此「只转移不生成」可把项目推进到 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`/`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW` 而其产物为空——**此类无内容态是可达的，但被设计为无害（inert）**：该态下可用的动作端点各自守卫内容前置（见 `outline-api`/`slide-plan-api`），只会返回稳定的 `*_NOT_CONFIRMABLE`/`*_NOT_FOUND`，绝不产出错误结果；且所有回退的下游清空必须 None-safe（见「回退清空下游产物」需求）。所有被引用状态必须 ⊆ shared-schema `WORKFLOW_STATES`（`assert_state_machine_consistent` 仍成立）。

#### 场景:执行一次合法前向转移

- **当** 项目当前状态为 `NEW_PROJECT`，请求转移到相邻合法状态 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将项目状态更新为 `REQUIREMENT_DISCOVERY`、返回新状态并追加一条状态变更事件

#### 场景:执行一次合法回退转移

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求回退到 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将状态更新为 `REQUIREMENT_DISCOVERY` 并追加状态变更事件（Phase 2 既有回退边，Phase 5 保留）

#### 场景:大纲/规划阶段的多步前向序列

- **当** 项目依次请求 `REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW`
- **那么** 每一步都必须成功推进并各追加一条事件，最终状态为 `SLIDE_PLAN_REVIEW`

#### 场景:大纲阶段的合法回退

- **当** 项目当前状态为 `OUTLINE_REVIEW`，请求回退到 `OUTLINE_GENERATION`
- **那么** 系统必须更新状态为 `OUTLINE_GENERATION` 并追加状态变更事件（下游清空见「回退清空下游产物」需求）

#### 场景:转移不调用 AI

- **当** 系统执行任意一次合法状态转移（含新增的大纲/规划边）
- **那么** 转移过程禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM，仅更新结构化状态

#### 场景:无内容态可达但动作端点安全拒绝

- **当** 用户只做转移不做生成，把项目推进到 `SLIDE_PLAN_REVIEW`（`outline`/`slidePlans` 均为空）
- **那么** 转移本身必须成功（边合法），而该态下的动作（如 `slides/plans/confirm`）必须以 `SLIDE_PLAN_NOT_FOUND` 稳定拒绝，绝不产出错误结果或崩溃

#### 场景:跨级前向跳转仍非法

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求直接转移到 `SLIDE_PLANNING`（跨过 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`）
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝，状态保持不变、不追加事件

#### 场景:SLIDE_PLAN_REVIEW 之后的前向边仍不属于本期

- **当** 项目当前状态为 `SLIDE_PLAN_REVIEW`，请求转移到 `SLIDE_GENERATION`
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝（该边由 Phase 6+ 归属），状态保持不变、不追加事件

### 需求:Spec 确认为 REQUIREMENT_REVIEW 内审批门（不推进状态）

Spec 确认必须实现为 `REQUIREMENT_REVIEW` 状态内的审批门：把 `PresentationSpec.confirmedByUser` 置真并追加 `PRESENTATION_SPEC_CONFIRMED` 事件，但**禁止推进工作流状态**。自 Phase 5 起，`REQUIREMENT_REVIEW → OUTLINE_GENERATION` 已是合法前向边，但确认动作本身**仍不驱动**该转移——进入 `OUTLINE_GENERATION` 必须由独立的显式 `POST /transitions` 完成；且 `confirmedByUser` 作为大纲生成的内容前置由 `outline/generate` 服务端点消费（未确认则拒绝生成），而非由边表消费。确认动作禁止触发任何后续 agent 或 LLM 生成。

#### 场景:确认不改变工作流状态

- **当** 项目处于 `REQUIREMENT_REVIEW`，用户确认已校验的 Spec
- **那么** 系统必须置 `confirmedByUser=true`、追加 `PRESENTATION_SPEC_CONFIRMED`，且工作流状态保持 `REQUIREMENT_REVIEW`

#### 场景:确认后前向边存在但需显式转移

- **当** 已确认 Spec 的项目请求 `to=OUTLINE_GENERATION`
- **那么** 系统必须接受该转移（自 Phase 5 起为合法边）并推进到 `OUTLINE_GENERATION`；确认动作本身不会自动推进

#### 场景:确认动作自身不推进到大纲阶段

- **当** 用户仅调用 Spec 确认、未再发起转移
- **那么** 项目必须仍停留在 `REQUIREMENT_REVIEW`，不得因确认而自动进入 `OUTLINE_GENERATION`

## 新增需求

### 需求:大纲/规划阶段回退必须 None-safe 清空下游产物

执行大纲/规划阶段的回退边时，系统必须清空该回退作废的下游产物，且清空必须 **None-safe**（对应产物已为 `None`/空时为 no-op，绝不解引用 `None` 或抛异常）。具体：`OUTLINE_GENERATION → REQUIREMENT_REVIEW` 必须清空 `project.outline` 与 `project.slidePlans` 并置 `project.slidePlansConfirmed=false`；`OUTLINE_REVIEW → OUTLINE_GENERATION` 必须（`outline` 存在时）置 `outline["confirmedByUser"]=False`（outline 为规范化 dict，dict 访问）、清空 `project.slidePlans` 并置 `slidePlansConfirmed=false`；`SLIDE_PLANNING → OUTLINE_REVIEW` 必须清空 `project.slidePlans` 并置 `slidePlansConfirmed=false`；`SLIDE_PLAN_REVIEW → SLIDE_PLANNING` 保留 plans 但置 `slidePlansConfirmed=false`。清空为 `execute_transition` 内、状态提交后对同一内存对象的属性写（与 Phase 2 回退清 `spec` 同构，仅在同步/内存仓库模型下成立，不宣称由 `commit_state_change` 原子携带）。

#### 场景:回退到需求复核清空大纲与规划

- **当** 项目处于 `OUTLINE_GENERATION`（已有大纲/规划）回退到 `REQUIREMENT_REVIEW`
- **那么** 系统必须清空 `project.outline` 与 `project.slidePlans`、置 `slidePlansConfirmed=false` 并追加状态变更事件

#### 场景:回退到大纲生成在无大纲时不崩溃（None-safe）

- **当** 项目经「只转移不生成」到达 `OUTLINE_REVIEW`（`outline` 为 `None`）后回退到 `OUTLINE_GENERATION`
- **那么** 系统必须成功回退、对 `None` 的 `outline` 不做解引用（清空为 no-op）、不崩溃、不追加错误

#### 场景:回退到大纲生成作废其确认并清空规划

- **当** 项目处于 `OUTLINE_REVIEW`（大纲已确认、已有规划）回退到 `OUTLINE_GENERATION`
- **那么** 系统必须置 `outline["confirmedByUser"]=False`、清空 `project.slidePlans`、置 `slidePlansConfirmed=false` 并追加状态变更事件

#### 场景:回退到大纲复核清空规划

- **当** 项目处于 `SLIDE_PLANNING`（已生成规划）回退到 `OUTLINE_REVIEW`
- **那么** 系统必须清空 `project.slidePlans`、置 `slidePlansConfirmed=false` 并追加状态变更事件
