## 为什么

Phase 1 已建立 monorepo、`packages/shared-schema` 契约与前后端空壳，但 `apps/api` 目前只有 `/health`，没有任何业务表面。若直接进入 Phase 3 的 Requirement Discovery / Spec Builder Agent，会缺少承载它们的项目生命周期、工作流状态机、事件记录与统一错误约定，Agent 输出将无处落库、状态流转无从校验。

本变更先补齐后端最小业务骨架：项目创建/读取、以 `WorkflowState` 为核心的工作流状态机、事件追加/读取模型，以及"校验失败不写持久状态"的统一错误约定。目标是让一个项目在**不调用真实 AI** 的前提下，可被创建、可读取当前状态、可按合法规则推进工作流状态，并为每次状态变更留下事件。这为 Phase 3+ 的 Agent 与前端工作流壳提供可依赖的后端接口。

## 变更内容

- 在 `apps/api` 从"仅 health check 空壳"扩展为最小业务 API：
  - `POST /api/projects`：创建项目，落地初始 `WorkflowState`，返回 `projectId` 与状态。
  - `GET /api/projects/{projectId}`：读取项目当前状态、场景/风格上下文与工作流位置。
- 新增以 shared-schema `WORKFLOW_STATES` 为已知状态全集的**工作流状态机**：定义显式邻接转移边表与守卫；**本期合法边表只含无需内容生成的早期转移**（`NEW_PROJECT↔REQUIREMENT_DISCOVERY↔REQUIREMENT_REVIEW` 区间），进入 `OUTLINE_GENERATION` 及之后的边留待归属阶段加入，避免逐边空走伪造后段状态。非法转移返回错误且不改动已存状态、不追加事件，不实现 Agent 逻辑。
- 新增最小**状态转移接口** `POST /api/projects/{projectId}/transitions`，使非法状态转移可在 API 层被契约测试覆盖（满足 ROADMAP "API contract tests for invalid state transitions"）。
- 新增**事件模型**：每次成功状态转移追加 `type=WORKFLOW_STATE_CHANGED` 的 `Event`，提供按项目读取事件序列的能力。该事件类型为 shared-schema 现有 `EVENT_TYPES` 所无，故本期向 shared-schema **新增唯一一个** `WORKFLOW_STATE_CHANGED` 事件类型及其负载校验（详见修改功能）。
- 新增**统一错误响应约定**：校验错误 / 非法状态转移 / 资源不存在有稳定的错误结构（`error` / `code` / `details`），框架原生 `RequestValidationError` 亦映射为统一结构；任何校验失败都不得写入持久状态（含不追加事件）。
- 新增最小持久层：内存仓储与后端 `StoredProject` 状态记录（承载 ROADMAP "Presentation state model"，非 shared-schema 核心实体），预留 SQLite 适配边界；不引入 PostgreSQL。后端经子进程常量桥读取 shared-schema 已导出的 `WORKFLOW_STATES`/`ACTOR_TYPES` 与 profile→scene 映射，禁止手抄枚举。
- 新增项目生命周期与非法状态转移的契约测试。

非目标：

- 不实现 Requirement Discovery / Gap / Question / Spec Builder / Outline / Slide Planner 等任何 Agent，也不调用真实 LLM。
- 不实现 outline、slide plan、slide 生成、HTML preview、PPTX export 的业务逻辑。
- 不实现 `PATCH /projects/{id}/profile`、需求发现、Spec 确认等 Phase 3 语义（本期只保证状态机能容纳这些未来转移，不落地其业务处理）。
- 不实现锁定写保护、版本快照、局部再生、图片候选、Review Agent 运行时逻辑。
- 不引入 PostgreSQL、Redis、Celery/RQ、S3/MinIO 等运行时基础设施，不做鉴权与多租户。
- 不新增 CI 门类平台能力；沿用 Phase 1 已有的 API gate。

## 功能 (Capabilities)

### 新增功能

- `project-lifecycle-api`: 项目创建与读取接口、初始 `WorkflowState` 落地、项目当前状态与场景/风格上下文的读取契约。
- `workflow-state-machine`: 以 `WORKFLOW_STATES` 为唯一状态集合的合法转移边、转移守卫与非法转移拒绝规则（不含 AI 内容生成）。
- `event-log`: 状态变更类动作的事件追加与按项目读取模型，复用 shared-schema `Event` 与 `EVENT_TYPES`。
- `api-error-and-validation-contract`: 统一错误响应结构，以及"校验/非法转移失败不写持久状态、不追加事件"的保护约定。

### 修改功能

- `shared-schema-contract`: 向 `EVENT_TYPES` 新增唯一一个 `WORKFLOW_STATE_CHANGED` 事件类型及其负载校验（payload `{previousState,nextState}`，发起者用 `Event` 顶层 `actor`），并明确 Python 端可经常量桥消费 shared-schema 已导出常量（含 `SCENES`）与可序列化的 profile→scene 映射。此为记录状态变更这一 Phase 2 交付物所必需的最小契约面，不新增核心实体。

## 影响

- 模式（schema）
  - 不新增核心实体。向 shared-schema `EVENT_TYPES` 新增唯一一个 `WORKFLOW_STATE_CHANGED` 事件类型 + 负载校验（同步 TS 类型 / JSON Schema / `docs/DATA_MODEL.md`）。
  - 后端消费 Phase 1 的 `Event`、`WorkflowState`、`EVENT_TYPES`、`ActorType` 与 profile→scene 映射，经 `shared_schema_adapter` 校验桥及新增常量桥读取，禁止另建不兼容核心模型或手抄枚举。
- 后端路由（API）
  - `apps/api/app/main.py` 从单一 health 空壳扩展出 `POST /api/projects`、`GET /api/projects/{id}` 与 `POST /api/projects/{id}/transitions`。
  - 新增服务层（project service + workflow state machine + event log）、内存仓储与 shared-schema 常量桥模块。
  - `docs/API.md` 中 `POST /api/projects`、`GET /api/projects/{id}` 由"Roadmap Draft"转为 Phase 2 已实现，新增 `POST .../transitions`，并标注错误约定。
- 代理（agent）
  - 本期不实现 Agent；后续 Agent 的状态转移必须走本期状态机与事件模型。
- 网页端（web）
  - 不改动；Phase 4 前端工作流壳将消费本期项目/状态 API。
- 导出模块（exporter）
  - 不涉及。
- 事件（event）、版本（version）、锁定（lock）
  - 事件：本期实现追加/读取运行时逻辑，限于状态变更类事件。
  - 版本、锁定：本期不实现运行时逻辑，保持 Phase 1 的 schema 边界。
- 验证方式
  - schema validation：写入前经 shared-schema 校验，非法负载被拒且不入库。
  - 状态机：合法转移成功并记录事件；非法转移返回稳定错误码且不改动已存状态、不追加事件。
  - 契约测试：覆盖项目创建/读取、合法转移序列、非法转移拒绝、校验失败不产生副作用。
  - 文档同步：`docs/API.md` 与 `docs/ROADMAP_PROGRESS.md` 更新 Phase 2 状态。
