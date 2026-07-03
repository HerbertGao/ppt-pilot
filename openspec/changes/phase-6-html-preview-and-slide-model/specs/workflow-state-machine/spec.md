## 修改需求

### 需求:合法状态转移与本期可执行范围

系统必须为工作流定义一张显式的合法邻接转移边表。仅当 `(from, to)` 是表中允许的邻接边时，系统才可推进项目状态；转移成功必须更新项目当前状态并追加事件（见 `event-log`）。**Phase 6 在 Phase 5 边的基础上加入幻灯片生成阶段的前向与回退边**：前向 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW → SLIDE_GENERATION`；回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY`、`OUTLINE_GENERATION → REQUIREMENT_REVIEW`、`OUTLINE_REVIEW → OUTLINE_GENERATION`、`SLIDE_PLANNING → OUTLINE_REVIEW`、`SLIDE_PLAN_REVIEW → SLIDE_PLANNING`、`SLIDE_GENERATION → SLIDE_PLAN_REVIEW`。**`SLIDE_GENERATION` 之后（`EDITING`/`REVIEW`/`EXPORT_READY`/`EXPORTED`）的所有前向边其内容前置由 Phase 7+ 拥有，本期仍不纳入合法邻接边表**、不驱动。

边表只做**结构邻接**判定，转移入口**保持 LLM-free**（禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM），且**不给前向边加内容守卫**。由此「只转移不生成」可把项目推进到 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`/`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW`/`SLIDE_GENERATION` 而其产物为空——**此类无内容态是可达的，但被设计为无害（inert）**：该态下可用的动作端点各自守卫内容前置（见 `outline-api`/`slide-plan-api`/`slide-materialization`），只会返回稳定的 `*_NOT_CONFIRMABLE`/`*_NOT_FOUND`/`*_NOT_MATERIALIZABLE`，绝不产出错误结果；且所有回退的下游清空必须 None-safe（见回退清空需求）。所有被引用状态必须 ⊆ shared-schema `WORKFLOW_STATES`（`assert_state_machine_consistent` 仍成立）。

#### 场景:执行一次合法前向转移

- **当** 项目当前状态为 `NEW_PROJECT`，请求转移到相邻合法状态 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将项目状态更新为 `REQUIREMENT_DISCOVERY`、返回新状态并追加一条状态变更事件

#### 场景:执行一次合法回退转移

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求回退到 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将状态更新为 `REQUIREMENT_DISCOVERY` 并追加状态变更事件（Phase 2 既有回退边，后续保留）

#### 场景:大纲/规划阶段的多步前向序列

- **当** 项目依次请求 `REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW`
- **那么** 每一步都必须成功推进并各追加一条事件，最终状态为 `SLIDE_PLAN_REVIEW`

#### 场景:大纲阶段的合法回退

- **当** 项目当前状态为 `OUTLINE_REVIEW`，请求回退到 `OUTLINE_GENERATION`
- **那么** 系统必须更新状态为 `OUTLINE_GENERATION` 并追加状态变更事件（下游清空见回退清空需求）

#### 场景:转移不调用 AI

- **当** 系统执行任意一次合法状态转移（含新增的大纲/规划/幻灯片生成边）
- **那么** 转移过程禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM，仅更新结构化状态

#### 场景:无内容态可达但动作端点安全拒绝

- **当** 用户只做转移不做生成，把项目推进到 `SLIDE_GENERATION`（`presentation` 为空）
- **那么** 转移本身必须成功（边合法），而该态下的动作（`slides/materialize`）必须以 `SLIDES_NOT_MATERIALIZABLE` 稳定拒绝，绝不产出错误结果或崩溃

#### 场景:跨级前向跳转仍非法

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求直接转移到 `SLIDE_PLANNING`（跨过 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`）
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝，状态保持不变、不追加事件

#### 场景:进入幻灯片生成的前向边现为合法

- **当** 项目当前状态为 `SLIDE_PLAN_REVIEW`，请求转移到 `SLIDE_GENERATION`
- **那么** 系统必须接受该转移（自 Phase 6 起为合法边）并推进到 `SLIDE_GENERATION`（是否可物化由 `slides/materialize` 的内容前置裁定）

#### 场景:SLIDE_GENERATION 之后的前向边仍不属于本期

- **当** 项目当前状态为 `SLIDE_GENERATION`，请求转移到 `EDITING`（或 `EXPORT_READY`）
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝（该边由 Phase 7+ 归属），状态保持不变、不追加事件

## 新增需求

### 需求:幻灯片生成阶段回退必须 None-safe 清空演示模型

执行回退边 `SLIDE_GENERATION → SLIDE_PLAN_REVIEW` 时，系统必须 **None-safe 清空** `project.presentation`（产物已为 `None` 则为 no-op，绝不解引用 `None`），使回退后重新物化产生全新演示模型、不残留旧模型（与 Phase 5 回退清空下游同构）。清空为 `execute_transition` 内、状态提交后对同一内存对象的属性写。`slidePlans`/`slidePlansConfirmed` 在此回退中保留（规划本身未作废，回到 `SLIDE_PLAN_REVIEW` 仍是已确认规划）。

#### 场景:回退到规划复核清空演示模型

- **当** 项目处于 `SLIDE_GENERATION`（已物化 `presentation`）回退到 `SLIDE_PLAN_REVIEW`
- **那么** 系统必须清空 `project.presentation`、保留 `slidePlans`/`slidePlansConfirmed` 并追加状态变更事件

#### 场景:未物化时回退不崩溃（None-safe）

- **当** 项目经「只转移不生成」到达 `SLIDE_GENERATION`（`presentation` 为 `None`）后回退到 `SLIDE_PLAN_REVIEW`
- **那么** 系统必须成功回退、对 `None` 的 `presentation` 清空为 no-op、不崩溃、不追加错误
