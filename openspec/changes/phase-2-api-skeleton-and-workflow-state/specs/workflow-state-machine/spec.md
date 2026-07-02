## 新增需求

### 需求:工作流状态集合唯一来源

工作流的**已知状态集合**必须完全等于 shared-schema `WORKFLOW_STATES`（`NEW_PROJECT` → `REQUIREMENT_DISCOVERY` → `REQUIREMENT_REVIEW` → `OUTLINE_GENERATION` → `OUTLINE_REVIEW` → `SLIDE_PLANNING` → `SLIDE_PLAN_REVIEW` → `SLIDE_GENERATION` → `EDITING` → `REVIEW` → `EXPORT_READY` → `EXPORTED`）。后端禁止定义 shared-schema 之外的工作流状态字符串。后端可接受的状态集合必须从 shared-schema 产物派生（见 `shared-schema-contract` 的常量消费需求），禁止在 Python 手抄枚举。已知状态集合与"本期可执行转移"是两个独立概念：前者用于识别未知状态字符串，后者见下一需求。

#### 场景:状态集合与 shared-schema 对齐

- **当** 后端加载工作流状态机
- **那么** 其可识别的状态字符串集合必须与 shared-schema `WORKFLOW_STATES` 完全一致，不多不少

### 需求:合法状态转移与本期可执行范围

系统必须为工作流定义一张显式的合法邻接转移边表。仅当 `(from, to)` 是表中允许的邻接边时，系统才可推进项目状态；转移成功必须更新项目当前状态并追加事件（见 `event-log`）。**Phase 2 的合法邻接边表只包含无需内容生成的早期转移**：前向 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`，以及人工回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY`。进入 `OUTLINE_GENERATION` 及其之后的所有转移，其前置内容由后续阶段（Phase 3+/5+）拥有，本期**不纳入合法邻接边表**、不驱动、契约测试不走完整链路；这些边由其归属阶段在实现对应内容逻辑时再加入。转移入口禁止触发任何 Agent 或 LLM 调用。

#### 场景:执行一次合法前向转移

- **当** 项目当前状态为 `NEW_PROJECT`，请求转移到相邻合法状态 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将项目状态更新为 `REQUIREMENT_DISCOVERY`、返回新状态并追加一条状态变更事件

#### 场景:执行一次合法回退转移

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求回退到 `REQUIREMENT_DISCOVERY`
- **那么** 系统必须将状态更新为 `REQUIREMENT_DISCOVERY` 并追加状态变更事件（对应 WORKFLOW.md 的 "return to discovery"）

#### 场景:多步早期前向序列

- **当** 项目依次请求 `NEW_PROJECT → REQUIREMENT_DISCOVERY → REQUIREMENT_REVIEW`
- **那么** 每一步都必须成功推进并各追加一条事件，最终状态为 `REQUIREMENT_REVIEW`

#### 场景:转移不调用 AI

- **当** 系统执行任意一次合法状态转移
- **那么** 转移过程禁止调用任何 Requirement/Outline/Slide Agent 或真实 LLM，仅更新结构化状态

#### 场景:进入需要内容的后段状态不属于本期合法边

- **当** 项目当前状态为 `REQUIREMENT_REVIEW`，请求转移到 `OUTLINE_GENERATION`
- **那么** 系统必须以 `INVALID_STATE_TRANSITION` 拒绝（该边不在 Phase 2 合法邻接边表内），项目状态保持不变、不追加事件

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
