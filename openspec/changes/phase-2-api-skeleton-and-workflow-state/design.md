## 上下文

Phase 1 交付了 monorepo、`packages/shared-schema`（TypeScript 类型 + JSON Schema + `validateEntity` 运行时校验）与前后端空壳。`apps/api` 目前仅有 `/health`，并通过 `app/shared_schema_adapter.py` 以子进程桥接 Node 端 `validateEntity` 完成 schema 校验（Phase 1 smoke 已验证此路径可用）。

Phase 2 要在同一后端里长出最小业务表面：项目创建/读取、工作流状态机、事件模型、统一错误约定。约束：不引入运行时基础设施（PostgreSQL/Redis/队列），不实现任何 Agent 或 LLM 调用，shared-schema 仍是唯一核心模型来源。跨包边界（Python 后端消费 TS schema）与新持久化契约（内存仓储 + 事件序列）触及，故需要本设计文档。

## 目标 / 非目标

**目标：**

- 让项目可创建、可读取、可按合法规则推进 `WorkflowState`，全程不调用 AI。
- 状态变更类动作产生符合 shared-schema `Event` 的事件，可按项目读取。
- 建立"校验/非法转移失败不写持久状态、不追加事件"的统一保护约定与稳定错误码。
- 复用 Phase 1 的 shared-schema 校验桥，禁止后端另建不兼容核心模型。

**非目标：**

- 不实现 Requirement/Outline/Slide 等 Agent、不调用 LLM。
- 不实现 outline/slide plan/slide 生成、HTML preview、PPTX export 业务逻辑。
- 不落地 `PATCH /profile`、需求发现、Spec 确认的业务处理（状态机只需容纳其未来转移边）。
- 不引入 PostgreSQL/Redis/Celery/RQ/S3、鉴权、多租户。
- 不实现版本快照与锁定写保护运行时逻辑。

## 决策

**决策 1：持久层用进程内内存仓储 + 后端 `StoredProject` 状态记录，抽象 `Repository` 协议，暂不接 SQLite。**
shared-schema 无 `Project` 实体，本期也不新增（新增核心实体超出 Phase 2 且 review 判定为不必要）。后端定义一个轻量 `StoredProject` 状态记录（`projectId` / `title` / `initialRequest` / `scene` / `styleProfileId` / `state` / 事件序列），仅作为后端持久化状态载体，不是 shared-schema 核心契约实体——它承载 ROADMAP 的 "Presentation state model" 而不冒充 `Presentation`。仓储接口（`create_project` / `get_project` / `update_state` / `append_event` / `list_events`）便于后续无痛替换 SQLite/Postgres。
- 备选：新增 shared-schema `Project` 实体。否决——本期只需后端状态载体，新增核心实体是更大的契约变更，YAGNI。
- 备选：直接上 SQLite。否决——Phase 2 无并发/持久化需求。

**决策 2：状态机用显式邻接边表驱动，且本期边表只含早期无内容转移。**
边表 `dict[WorkflowState, set[WorkflowState]]`。**本期合法边表 = 前向 `NEW_PROJECT→REQUIREMENT_DISCOVERY→REQUIREMENT_REVIEW` + 回退边 `REQUIREMENT_REVIEW→REQUIREMENT_DISCOVERY`**。进入 `OUTLINE_GENERATION` 及之后的边**不在本期表内**——它们的前置内容（outline/slide 等）由 Phase 3+/5+ 拥有，由归属阶段在实现内容逻辑时再加入。这样避免"逐边空走到 EXPORTED、伪造后段状态"的问题（Codex 指出的 impossible states）。`WORKFLOW_STATES` 全集仍用于识别未知状态字符串，与"可执行边"解耦。
- 备选：边表覆盖整条链。否决——本期无内容逻辑，允许走到后段会产生无内容的假状态。
- 备选：按枚举顺序 +1。否决——无法表达回退边。

**决策 3：后端经子进程常量桥读取 shared-schema 已导出的常量与派生映射（解决原 Open Q1）。**
`dist/index.js` 已 `export *` 出 `SCENES`/`WORKFLOW_STATES`/`EVENT_TYPES`/`ACTOR_TYPES` 与 `BUILT_IN_STYLE_PROFILES`/`DEFAULT_STYLE_PROFILE_ID_BY_SCENE`/`getStyleProfileScene`。新增一个 `load_shared_schema_constants()` 桥函数，复用现有 `shared_schema_adapter` 的子进程 + `dist/index.js` 前置模式，import 并打印这些常量供后端消费。`SCENES` 供创建项目的 `INVALID_SCENE` 校验；profile→scene 映射经 `BUILT_IN_STYLE_PROFILES`/`DEFAULT_STYLE_PROFILE_ID_BY_SCENE` 序列化为可跨桥的 map，在 Python 侧查表（`getStyleProfileScene` 是函数，不能直接被打印常量的桥序列化）。无需改 shared-schema 源即可满足 B2/B3。构建前置：`dist/index.js` 未构建时复用既有 build-missing 错误语义；注意该守卫只覆盖 dist 缺失、不覆盖 dist 陈旧，故决策 7 新增事件类型后必须重建 dist 再运行后端消费/测试。
- 备选：Python 手抄枚举。否决——违反唯一来源、易漂移。
- 备选：解析生成的 JSON Schema 文件。否决——常量已由 index 导出，复用现有桥路径更省。

**决策 4：错误约定用 FastAPI 异常处理器集中实现，并覆盖框架原生错误。**
领域异常（`ValidationError` / `InvalidStateTransition` / `ProjectNotFound`）+ **框架原生 `RequestValidationError` / `HTTPException`** 都经 exception handler 映射为统一 `{error, code, details}`，避免 FastAPI 默认 422 `detail` 数组绕过约定。错误码方案：未知状态字符串→`VALIDATION_ERROR`(`code=INVALID_WORKFLOW_STATE`)；已知状态但非法邻接边→`INVALID_STATE_TRANSITION`；`INVALID_SCENE` / `STYLE_PROFILE_MISMATCH` / `PROJECT_NOT_FOUND` 同理。副作用保护靠"先校验后写入" + 内存仓储只在校验全通过后提交。
- 备选：每路由各自拼错误体。否决——码不一致、重复。

**决策 5：事件与状态更新在服务层同一步骤成对提交。**
转移成功 → 构造 `WORKFLOW_STATE_CHANGED` 事件（顶层 `actor`，payload `{previousState,nextState}`）并经 shared-schema `validateEvent` 校验 → 通过后同时写入新状态与事件；任一步失败整体不提交。保证"失败动作事件序列长度不变"。

**决策 6：新增最小状态转移 HTTP 端点 `POST /api/projects/{projectId}/transitions`（解决原 Open Q2）。**
ROADMAP Phase 2 要求 "API contract tests for invalid state transitions"，纯服务层函数无法在 API 层承接非法状态字符串这类输入。故暴露一个最小端点（body `{to}`），只驱动本期合法边、并让非法转移在 API 层可测。本期不实现 `PATCH /profile` 等 Phase 3 语义接口（[out-of-scope]，仅在文档说明其未来会触发 review/discovery 回退）。
- 备选：仅服务层 + 单测。否决——无法覆盖 ROADMAP 明列的 invalid-transition API 契约测试，且非法状态字符串无 HTTP 承接面。

**决策 7：向 shared-schema `EVENT_TYPES` 新增唯一一个 `WORKFLOW_STATE_CHANGED` 事件类型 + 负载校验。**
现有 5 个 `EVENT_TYPES` 全是 Phase 3 需求发现语义，`validateEvent` 拒绝集合外 `type`，且 `validateEventPayload` 是无 default 分支的 switch，故必须同时新增枚举 arm 与 payload case。新增 `WORKFLOW_STATE_CHANGED`（payload `{previousState,nextState}`，发起者用 `Event` 顶层 `actor` 表达、不在 payload 重复以免两处 actor 冲突）是记录状态变更这一 Phase 2 交付物的最小必要契约面，属 Phase 2 事件交付物的实质、非范围外扩张。这是本期对 shared-schema 源的**唯一**改动（详见 `shared-schema-contract` 增量），不新增核心实体。
- 备选：Phase 2 不为转移记事件。否决——直接违反 ROADMAP success criterion "events recorded for state-changing actions"。
- 备选：用现有某个 Phase-3 类型凑数。否决——伪造 Phase 3 语义，是不诚实的绿。

## 风险 / 权衡

- [内存仓储进程重启即丢失] → Phase 2 明确不承诺持久化，契约测试针对单进程；后续换 SQLite 时仓储接口不变。
- [每次校验/读常量起 Node 子进程有延迟] → 沿用 Phase 1 已验证路径，Phase 2 QPS 无压力；成瓶颈再评估 Python 端直读，属独立优化。
- [`WORKFLOW_STATE_CHANGED` 增改 shared-schema 需同步 TS 类型/JSON Schema/DATA_MODEL] → 由 `shared-schema-contract` 增量的场景校验兜底（合法/非法 payload 各一）；改动限于一个枚举 arm + 一段 payload 校验，回滚面小。
- [常量桥/事件类型依赖 `dist/index.js` 已构建] → 复用既有 build-missing 前置错误语义，未构建时明确报错而非静默通过。
- [与 HTML 预览 / PPTX 导出的一致性] → 本期不产出可渲染 slide 或导出物，无渲染/导出一致性验证点；一致性靠"所有事件/状态均过 shared-schema 校验、不新建核心实体"边界保证，使 Phase 6/7 消费结构与本期落库同源。

## 迁移计划

- 增量为主：`apps/api` 新增服务/仓储/路由/常量桥模块并扩展 `main.py`；shared-schema 仅新增一个 `WORKFLOW_STATE_CHANGED` 事件类型 + 校验（含 TS 类型 / JSON Schema / DATA_MODEL 同步）。
- 回滚：还原 `apps/api` 改动回到 health-only 空壳；shared-schema 的事件类型新增为纯增量 arm，移除即回滚，无数据迁移。
- 文档：`docs/API.md` 将 `POST /api/projects`、`GET /api/projects/{id}` 及新增 `POST .../transitions` 标为 Phase 2 已实现并补错误约定；`docs/DATA_MODEL.md` 补 `WORKFLOW_STATE_CHANGED`；`docs/ROADMAP_PROGRESS.md` 更新 Phase 2 状态。

## 待解决问题

- 无（原两项已在决策 3 与决策 6 定案）。
