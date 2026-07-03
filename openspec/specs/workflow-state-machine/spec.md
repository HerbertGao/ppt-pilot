# workflow-state-machine 规范

## 目的
待定 - 由归档变更 phase-2-api-skeleton-and-workflow-state 创建。归档后请更新目的。
## 需求
### 需求:工作流状态集合唯一来源

工作流的**已知状态集合**必须完全等于 shared-schema `WORKFLOW_STATES`（`NEW_PROJECT` → `REQUIREMENT_DISCOVERY` → `REQUIREMENT_REVIEW` → `OUTLINE_GENERATION` → `OUTLINE_REVIEW` → `SLIDE_PLANNING` → `SLIDE_PLAN_REVIEW` → `SLIDE_GENERATION` → `EDITING` → `REVIEW` → `EXPORT_READY` → `EXPORTED`）。后端禁止定义 shared-schema 之外的工作流状态字符串。后端可接受的状态集合必须从 shared-schema 产物派生（见 `shared-schema-contract` 的常量消费需求），禁止在 Python 手抄枚举。已知状态集合与"本期可执行转移"是两个独立概念：前者用于识别未知状态字符串，后者见下一需求。

#### 场景:状态集合与 shared-schema 对齐

- **当** 后端加载工作流状态机
- **那么** 其可识别的状态字符串集合必须与 shared-schema `WORKFLOW_STATES` 完全一致，不多不少

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

### 需求:拒绝非法状态转移

系统必须区分两类非法转移并返回不同的稳定错误：目标状态字符串不在 `WORKFLOW_STATES` 内时，返回 `VALIDATION_ERROR`（`code=INVALID_WORKFLOW_STATE`）；目标是已知状态但 `(from, to)` 不在本期合法邻接边表内时，返回 `INVALID_STATE_TRANSITION`。两类情形都禁止改动项目已存状态、禁止追加事件。

#### 场景:已知状态间的非法边被拒绝

- **当** 项目当前状态为 `NEW_PROJECT`，请求直接转移到已知状态 `EXPORTED`
- **那么** 系统必须返回 `INVALID_STATE_TRANSITION` 错误，且项目状态保持 `NEW_PROJECT`、不追加任何事件

#### 场景:未知目标状态字符串被拒绝

- **当** 请求将项目转移到不在 `WORKFLOW_STATES` 中的状态字符串
- **那么** 系统必须返回 `VALIDATION_ERROR`（`code=INVALID_WORKFLOW_STATE`），且项目状态保持不变、不追加事件

### 需求:状态转移 API 接口

系统必须提供一个最小的状态转移接口（`POST /api/projects/{projectId}/transitions`，请求体含目标状态 `to`），使非法状态转移可在 API 层被契约测试覆盖（满足 ROADMAP Phase 2 "API contract tests for invalid state transitions"）。该接口仅驱动本期合法邻接边表内的无内容转移；命中未知状态字符串、非法邻接边或不存在的项目时，必须返回对应统一错误且无持久副作用。本期不实现 `PATCH /api/projects/{projectId}/profile` 等 Phase 3 语义接口。

#### 场景:通过 API 执行合法转移

- **当** 客户端对状态为 `NEW_PROJECT` 的项目 `POST .../transitions` 请求 `to=REQUIREMENT_DISCOVERY`
- **那么** 系统必须推进状态、追加事件并返回新状态

#### 场景:通过 API 请求非法转移

- **当** 客户端对状态为 `NEW_PROJECT` 的项目请求 `to=EXPORTED`
- **那么** 系统必须返回 `INVALID_STATE_TRANSITION`，项目状态与事件序列保持不变

#### 场景:通过 API 请求未知状态字符串

- **当** 客户端对已存在项目请求 `to` 为不在 `WORKFLOW_STATES` 中的字符串
- **那么** 系统必须返回 `VALIDATION_ERROR`（`code=INVALID_WORKFLOW_STATE`），项目状态与事件序列保持不变（这正是转移端点相对纯服务层函数需要存在的原因）

#### 场景:转移请求体缺失 to

- **当** 客户端 `POST .../transitions` 的请求体缺失 `to` 或为空 `{}`
- **那么** 系统必须返回 `INVALID_REQUEST_BODY`（按错误优先级先于 `PROJECT_NOT_FOUND` 与状态校验），且无持久副作用

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

### 需求:确认后更改 Profile 必须经回退边

当项目已确认 Spec 后需要更改 `scene` / `styleProfileId`，系统必须要求项目先经既有回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回到需求发现/复核，才允许 profile 变更；直接在已确认态更改 profile 必须被拒绝且无持久副作用。**已确认项目经该回退边回退时，必须把 `confirmedByUser` 重置为 false 并作废旧 Spec 快照**，使其在重新确认前不被视为已确认（防止遗留 scene/styleProfile 已过期却仍标记已确认的 Spec）。本需求复用 Phase 2 既有回退边，不新增工作流边。

#### 场景:确认后经回退边改 profile

- **当** 已确认 Spec 的项目先转移回 `REQUIREMENT_DISCOVERY`（此时 `confirmedByUser` 被重置为 false、旧 Spec 快照作废），再更改 profile
- **那么** 系统必须允许 profile 变更并追加 `SCENE_STYLE_PROFILE_UPDATED`，且该项目须重新确认才再次视为已确认

#### 场景:确认态直接改 profile 被拒绝

- **当** 已确认 Spec 的项目未回退即请求更改 profile
- **那么** 系统必须拒绝变更，状态与事件序列保持不变

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

### 需求:幻灯片生成阶段回退必须 None-safe 清空演示模型

执行回退边 `SLIDE_GENERATION → SLIDE_PLAN_REVIEW` 时，系统必须 **None-safe 清空** `project.presentation`（产物已为 `None` 则为 no-op，绝不解引用 `None`），使回退后重新物化产生全新演示模型、不残留旧模型（与 Phase 5 回退清空下游同构）。清空为 `execute_transition` 内、状态提交后对同一内存对象的属性写。`slidePlans`/`slidePlansConfirmed` 在此回退中保留（规划本身未作废，回到 `SLIDE_PLAN_REVIEW` 仍是已确认规划）。

#### 场景:回退到规划复核清空演示模型

- **当** 项目处于 `SLIDE_GENERATION`（已物化 `presentation`）回退到 `SLIDE_PLAN_REVIEW`
- **那么** 系统必须清空 `project.presentation`、保留 `slidePlans`/`slidePlansConfirmed` 并追加状态变更事件

#### 场景:未物化时回退不崩溃（None-safe）

- **当** 项目经「只转移不生成」到达 `SLIDE_GENERATION`（`presentation` 为 `None`）后回退到 `SLIDE_PLAN_REVIEW`
- **那么** 系统必须成功回退、对 `None` 的 `presentation` 清空为 no-op、不崩溃、不追加错误

### 需求:导出阶段回退必须 None-safe 且不破坏已生成产物

`EXPORT_READY → SLIDE_GENERATION` 与 `EXPORTED → EXPORT_READY` 的回退必须 None-safe（不解引用 `None`、不崩溃）。`ExportArtifact` 是自包含（内嵌自身字节）的历史交付物：导出阶段的回退**禁止删除** `project.exports`（既有导出仍是有效可下载文件），仅回退结构化状态；重复导出**追加**新产物。`project.presentation` 在导出阶段回退中**保留**（导出不改动 presentation）。

#### 场景:从 EXPORTED 回退保留已生成的导出产物

- **当** 已导出（`project.exports` 非空）的项目从 `EXPORTED` 回退到 `EXPORT_READY`
- **那么** 系统必须仅回退状态、**保留** `project.exports` 全部产物与 `project.presentation`，且 None-safe 不崩溃

#### 场景:未导出时从 EXPORT_READY 回退 None-safe

- **当** 项目 `state==EXPORT_READY` 但从未导出（`project.exports` 为空）就回退到 `SLIDE_GENERATION`
- **那么** 系统必须稳定回退状态、不解引用 `None`、不崩溃，`presentation` 保留

