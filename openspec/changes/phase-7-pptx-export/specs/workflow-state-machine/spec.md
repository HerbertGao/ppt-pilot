## 修改需求

### 需求:合法状态转移与本期可执行范围

系统必须为工作流定义一张显式的合法邻接转移边表。仅当 `(from, to)` 是表中允许的邻接边时，系统才可推进项目状态；转移成功必须更新项目当前状态并追加事件（见 `event-log`）。**Phase 6 在 Phase 5 边的基础上加入幻灯片生成阶段的前向与回退边；Phase 7 进一步加入导出阶段的前向与回退边**：前向 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW → OUTLINE_GENERATION → OUTLINE_REVIEW → SLIDE_PLANNING → SLIDE_PLAN_REVIEW → SLIDE_GENERATION → EXPORT_READY → EXPORTED`；回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY`、`OUTLINE_GENERATION → REQUIREMENT_REVIEW`、`OUTLINE_REVIEW → OUTLINE_GENERATION`、`SLIDE_PLANNING → OUTLINE_REVIEW`、`SLIDE_PLAN_REVIEW → SLIDE_PLANNING`、`SLIDE_GENERATION → SLIDE_PLAN_REVIEW`、`EXPORT_READY → SLIDE_GENERATION`、`EXPORTED → EXPORT_READY`。**`EDITING`/`REVIEW` 的所有前向边其内容前置由 Phase 8 拥有，本期仍不纳入合法邻接边表**、不驱动（即 `SLIDE_GENERATION` 直接邻接 `EXPORT_READY`，跳过未实现的 `EDITING`/`REVIEW`）。

边表只做**结构邻接**判定，转移入口**保持 LLM-free**（禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM），且**不给前向边加内容守卫**。由此「只转移不生成」可把项目推进到 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`/`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW`/`SLIDE_GENERATION`/`EXPORT_READY` 而其产物为空——**此类无内容态是可达的，但被设计为无害（inert）**：该态下可用的动作端点各自守卫内容前置（见 `outline-api`/`slide-plan-api`/`slide-materialization`/`pptx-export`），只会返回稳定的 `*_NOT_CONFIRMABLE`/`*_NOT_FOUND`/`*_NOT_MATERIALIZABLE`/`EXPORT_NOT_READY`，绝不产出错误结果；且所有回退的下游清空必须 None-safe（见回退清空需求）。所有被引用状态必须 ⊆ shared-schema `WORKFLOW_STATES`（`assert_state_machine_consistent` 仍成立）。

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

- **当** 系统执行任意一次合法状态转移（含新增的大纲/规划/幻灯片生成/导出边）
- **那么** 转移过程禁止调用任何 Requirement/Outline/Slide Planner Agent 或真实 LLM，仅更新结构化状态

#### 场景:无内容态可达但动作端点安全拒绝

- **当** 用户只做转移不做生成，把项目推进到 `EXPORT_READY`（`presentation` 为空）
- **那么** 转移本身必须成功（边合法），而该态下的动作（`export`）必须以 `EXPORT_NOT_READY` 稳定拒绝，绝不产出错误结果或崩溃

#### 场景:跨级前向跳转仍非法

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求直接转移到 `SLIDE_PLANNING`（跨过 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`）
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝，状态保持不变、不追加事件

#### 场景:进入幻灯片生成的前向边现为合法

- **当** 项目当前状态为 `SLIDE_PLAN_REVIEW`，请求转移到 `SLIDE_GENERATION`
- **那么** 系统必须接受该转移（自 Phase 6 起为合法边）并推进到 `SLIDE_GENERATION`（是否可物化由 `slides/materialize` 的内容前置裁定）

#### 场景:进入导出阶段的前向边现为合法

- **当** 项目当前状态为 `SLIDE_GENERATION`，请求转移到 `EXPORT_READY`
- **那么** 系统必须接受该转移（自 Phase 7 起为合法边）并推进到 `EXPORT_READY`（是否可导出由 `export` 的内容前置裁定）

#### 场景:导出后进入 EXPORTED 的前向边现为合法

- **当** 项目当前状态为 `EXPORT_READY`，请求转移到 `EXPORTED`
- **那么** 系统必须接受该转移（自 Phase 7 起为合法边）并推进到 `EXPORTED`

#### 场景:导出阶段之后的越界前向边仍非法

- **当** 项目当前状态为 `EXPORTED`，请求转移到 `EDITING`（或任何非相邻状态）
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝，状态保持不变、不追加事件（`EDITING`/`REVIEW` 边属 Phase 8）

## 新增需求

### 需求:导出阶段回退必须 None-safe 且不破坏已生成产物

`EXPORT_READY → SLIDE_GENERATION` 与 `EXPORTED → EXPORT_READY` 的回退必须 None-safe（不解引用 `None`、不崩溃）。`ExportArtifact` 是自包含（内嵌自身字节）的历史交付物：导出阶段的回退**禁止删除** `project.exports`（既有导出仍是有效可下载文件），仅回退结构化状态；重复导出**追加**新产物。`project.presentation` 在导出阶段回退中**保留**（导出不改动 presentation）。

#### 场景:从 EXPORTED 回退保留已生成的导出产物

- **当** 已导出（`project.exports` 非空）的项目从 `EXPORTED` 回退到 `EXPORT_READY`
- **那么** 系统必须仅回退状态、**保留** `project.exports` 全部产物与 `project.presentation`，且 None-safe 不崩溃

#### 场景:未导出时从 EXPORT_READY 回退 None-safe

- **当** 项目 `state==EXPORT_READY` 但从未导出（`project.exports` 为空）就回退到 `SLIDE_GENERATION`
- **那么** 系统必须稳定回退状态、不解引用 `None`、不崩溃，`presentation` 保留
