## 1. 后端骨架与仓储

- [x] 1.1 在 `apps/api/app` 建立业务模块结构（如 `services/`、`repository.py`、`schemas.py` 或等价划分），保持模块小、边界清晰
- [x] 1.2 定义 `Repository` 抽象接口：`create_project` / `get_project` / `update_state` / `append_event` / `list_events`，并提供进程内内存实现
- [x] 1.3 定义后端 `StoredProject` 状态记录（`projectId`/`title`/`initialRequest`/`scene`/`styleProfileId`/`state`/事件序列），作为 ROADMAP "Presentation state model" 的后端载体，不冒充 shared-schema `Presentation` 实体
- [x] 1.4 确保状态更新与事件追加只能通过仓储/服务层成对提交，任一步失败整体不提交（不留副作用）
- [x] 1.5 确认本期不引入 PostgreSQL/Redis/Celery/RQ/S3、不引入鉴权依赖

## 2. shared-schema 增量与消费

- [x] 2.1 向 shared-schema `EVENT_TYPES` 新增 `WORKFLOW_STATE_CHANGED`，并在 `validateEventPayload` 新增其 switch case，校验负载 `{previousState∈WORKFLOW_STATES, nextState∈WORKFLOW_STATES}`；发起者用 `Event` 顶层 `actor∈ACTOR_TYPES`，不放入 payload
- [x] 2.2 同步该事件类型到 TypeScript 类型、JSON Schema 校验产物与 `docs/DATA_MODEL.md` 的 Event 类型清单；补合法/非法 payload fixture；编辑源后重建 `dist`（build-missing 守卫不覆盖陈旧 dist）
- [x] 2.3 新增后端常量桥 `load_shared_schema_constants()`，复用 `shared_schema_adapter` 的子进程 + `dist/index.js` 前置模式，读取 `SCENES`/`WORKFLOW_STATES`/`ACTOR_TYPES`（`EVENT_TYPES` 非必需，前向用途可选），并将 `BUILT_IN_STYLE_PROFILES`/`DEFAULT_STYLE_PROFILE_ID_BY_SCENE` 序列化为 profile→scene 映射在 Python 侧查表；`dist` 未构建时复用 build-missing 错误语义
- [x] 2.4 实现 `scene` 默认（未传→`default`）与 `styleProfileId` 按场景回退（未传→内置默认 id）
- [x] 2.5 实现创建项目的场景/风格归属校验，基于序列化的 profile→scene 映射在 Python 侧查表：`scene∉SCENES`→`INVALID_SCENE`；映射中 `styleProfileId` 对应 scene≠`scene` 或映射无此项（未知 id）→`STYLE_PROFILE_MISMATCH`；禁止在 Python 手抄枚举

## 3. 工作流状态机

- [x] 3.1 定义 Phase 2 合法邻接边表：前向 `NEW_PROJECT→REQUIREMENT_DISCOVERY→REQUIREMENT_REVIEW` + 回退边 `REQUIREMENT_REVIEW→REQUIREMENT_DISCOVERY`；`OUTLINE_GENERATION` 及之后的边不纳入本期表，代码注释标明留待归属阶段
- [x] 3.2 实现纯函数式转移校验与转移执行入口，转移过程禁止调用任何 Agent 或 LLM
- [x] 3.3 区分两类非法转移：未知状态字符串→`VALIDATION_ERROR`(`code=INVALID_WORKFLOW_STATE`)；已知状态但非法邻接边→`INVALID_STATE_TRANSITION`；两者都不改状态、不追加事件
- [x] 3.4 从常量桥派生后端已知状态集合，断言其与 shared-schema `WORKFLOW_STATES` 完全一致（不多不少），与"可执行边表"解耦

## 4. 事件模型

- [x] 4.1 每次成功转移构造 `type=WORKFLOW_STATE_CHANGED` 事件，顶层 `actor`（API 触发为 `user`），`payload={previousState,nextState}`，结构符合 shared-schema `Event`
- [x] 4.2 事件追加前经 shared-schema `validateEvent` 校验；校验失败拒绝动作、不追加事件、不改状态
- [x] 4.3 实现按 `projectId` 读取事件序列，保持追加顺序，读取无副作用

## 5. 项目生命周期与转移 API

- [x] 5.1 实现 `POST /api/projects`：校验 `scene`/`styleProfileId` 归属，落地初始 `WorkflowState`，返回 `projectId` 与 `status`
- [x] 5.2 实现 `GET /api/projects/{projectId}`：返回当前 `status`/`scene`/`styleProfileId`/标识，读取无副作用
- [x] 5.3 实现 `POST /api/projects/{projectId}/transitions`（body `{to}`）：仅驱动本期合法边，非法转移/未知状态/不存在项目返回对应统一错误且无副作用；`to` 与 `scene` 以原始 `str` 接收并在领域层校验（禁止 pydantic 枚举类型，否则未知值被误判为 `INVALID_REQUEST_BODY`）；本期不实现 `PATCH /profile`
- [x] 5.4 在 `apps/api/app/main.py` 挂载业务路由，保留既有 `/health` 行为不变

## 6. 统一错误约定

- [x] 6.1 定义领域异常（`ValidationError`/`InvalidStateTransition`/`ProjectNotFound`）
- [x] 6.2 用 FastAPI 异常处理器统一映射为 `{error, code, details}`，稳定码：`INVALID_SCENE`/`STYLE_PROFILE_MISMATCH`/`INVALID_WORKFLOW_STATE`/`INVALID_STATE_TRANSITION`/`PROJECT_NOT_FOUND`/`INVALID_REQUEST_BODY`，并按 error 类映射 `VALIDATION_ERROR`/`STATE_ERROR`/`NOT_FOUND`
- [x] 6.3 为框架原生 `RequestValidationError`/`HTTPException` 注册处理器，映射为统一结构（畸形请求体不得返回 FastAPI 默认 422 `detail` 数组）
- [x] 6.4 验证所有失败路径均无持久副作用（不建/不改项目、不推进状态、不追加事件）

## 7. 契约测试

- [x] 7.1 项目创建/读取：合法创建、默认场景回退、读取存在与不存在项目（`PROJECT_NOT_FOUND`）
- [x] 7.2 非法创建：非法 `scene`、风格归属不匹配、未知 `styleProfileId` → 对应错误码且仓储项目数/事件序列长度不变
- [x] 7.3 状态机：早期合法前向序列（多步）与回退边成功并各写入事件；未知状态字符串→`INVALID_WORKFLOW_STATE`、已知状态非法边→`INVALID_STATE_TRANSITION`，均无副作用
- [x] 7.4 转移 API：经 `POST .../transitions` 覆盖合法转移与非法转移——对已存在项目发未知状态字符串 `to` 应返回 `INVALID_WORKFLOW_STATE`、发已知非法边应返回 `INVALID_STATE_TRANSITION`；并覆盖错误优先级——对不存在项目发非法 `to` 应返回 `PROJECT_NOT_FOUND`，缺失/畸形请求体应先返回 `INVALID_REQUEST_BODY`
- [x] 7.5 事件：转移写入 `WORKFLOW_STATE_CHANGED` 且通过 `validateEvent`；失败动作后事件序列长度不变
- [x] 7.6 错误约定：畸形请求体经处理器返回统一结构而非默认 422，并断言 `error=VALIDATION_ERROR`、`code=INVALID_REQUEST_BODY`
- [x] 7.7 将测试接入 `apps/api` 的 Python 检查路径，符合 Phase 1 已建的 API CI gate

## 8. 文档与验收

- [x] 8.1 更新 `docs/API.md`：`POST /api/projects`、`GET /api/projects/{id}` 标为 Phase 2 已实现，新增 `POST .../transitions`，补充统一错误约定与错误码；并将 `POST /api/projects` 响应示例的 `status` 由 `REQUIREMENT_DISCOVERY` 改为 `NEW_PROJECT`，与创建落地的初始状态一致
- [x] 8.2 更新 `docs/DATA_MODEL.md`：补 `WORKFLOW_STATE_CHANGED` 事件类型与负载；将 "Phase 1 event types" 小节改名为 "Event types" 或新增 "Phase 2 event types" 子节，避免把 Phase 2 类型挂在 Phase 1 标题下
- [x] 8.3 更新 `docs/ROADMAP_PROGRESS.md`：Phase 2 状态推进
- [x] 8.4 运行 `openspec-cn validate phase-2-api-skeleton-and-workflow-state --strict` 通过
- [x] 8.5 代码审查清单项（非测试）：确认本期未提前实现 Agent、真实 LLM、outline/slide/preview/export、锁定写保护或版本快照运行时逻辑
