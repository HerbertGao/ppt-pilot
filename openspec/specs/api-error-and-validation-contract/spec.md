# api-error-and-validation-contract 规范

## 目的
待定 - 由归档变更 phase-2-api-skeleton-and-workflow-state 创建。归档后请更新目的。
## 需求
### 需求:统一错误响应结构

所有业务 API 的错误响应必须使用统一结构：顶层 `error`（错误分类）、`code`（稳定的机器可读错误码）、以及 `details`（含 `field` / `message` 等定位信息）。`error` 与 `code` 的映射必须稳定且明确：`VALIDATION_ERROR` 覆盖 `{INVALID_SCENE, STYLE_PROFILE_MISMATCH, INVALID_WORKFLOW_STATE, INVALID_REQUEST_BODY}`；`STATE_ERROR` 覆盖 `{INVALID_STATE_TRANSITION}`；`NOT_FOUND` 覆盖 `{PROJECT_NOT_FOUND}`。同一类错误必须使用同一稳定 `error`/`code`，禁止用裸文本或不稳定字符串代替。框架原生的请求体校验错误（FastAPI 对畸形请求体 / 缺失字段 / 类型错误抛出的 `RequestValidationError`，默认 422 `detail` 结构）必须经异常处理器映射为 `error=VALIDATION_ERROR`、`code=INVALID_REQUEST_BODY`，禁止让框架默认错误体绕过统一约定。框架路由级 `HTTPException`（路由未命中 / 方法不允许等）按下方"框架级路由未命中不复用业务错误码"场景映射为中性错误码，禁止复用业务码。当多种错误条件同时成立时，判定优先级为：框架级请求体校验（`INVALID_REQUEST_BODY`，因框架在进入处理器前解析请求体）优先于路径资源存在性（`PROJECT_NOT_FOUND`）优先于目标状态校验（`INVALID_WORKFLOW_STATE` / `INVALID_STATE_TRANSITION`）。任何未被上述处理器捕获的意外异常必须经统一的 catch-all 处理器映射为 `error=INTERNAL_ERROR`、`code=INTERNAL_ERROR` 的 500 响应（并记录日志），禁止泄漏框架默认的纯文本 500。

#### 场景:校验错误返回稳定结构

- **当** 任一业务接口因输入校验失败而拒绝请求
- **那么** 响应必须包含 `error`、`code` 与 `details`，且 `code` 对该类错误保持稳定

#### 场景:畸形请求体返回统一结构

- **当** 客户端向 `POST /api/projects` 发送畸形 JSON 或字段类型错误的请求体，触发框架原生 `RequestValidationError`
- **那么** 响应必须被映射为统一 `{error, code, details}` 结构，而非 FastAPI 默认的 `detail` 数组，且不写入任何持久状态

#### 场景:资源不存在返回稳定结构

- **当** 客户端访问不存在的项目
- **那么** 响应必须使用 `code=PROJECT_NOT_FOUND` 的统一错误结构

#### 场景:意外异常返回统一 500

- **当** 处理请求时发生未被领域/框架处理器捕获的意外异常
- **那么** catch-all 处理器必须返回 `error=INTERNAL_ERROR`、`code=INTERNAL_ERROR` 的 500 统一结构，而非框架默认纯文本 500

#### 场景:框架级路由未命中不复用业务错误码

- **当** 客户端请求一个不存在的路由（框架 404）或不被允许的方法（405）
- **那么** 响应必须使用中性错误码（404 → `error=NOT_FOUND`/`code=RESOURCE_NOT_FOUND`；其它 → `code=HTTP_ERROR`，`error` 由状态派生），禁止复用业务 `PROJECT_NOT_FOUND`，且 `error` 类与返回状态码保持一致

### 需求:校验失败不产生副作用

任何因校验失败、非法状态转移或资源不存在而被拒绝的请求，禁止改动任何持久状态，包括禁止创建/更新项目、禁止推进工作流状态、禁止追加事件。该保护约定对所有 Phase 2 业务接口生效。

#### 场景:非法创建请求不留痕

- **当** 一次 `POST /api/projects` 因非法 `scene` 被拒绝
- **那么** 系统持久层中禁止出现该项目，事件序列也不得因此产生任何记录

#### 场景:非法转移不改动状态

- **当** 一次状态转移因非法 `(from, to)` 被拒绝
- **那么** 目标项目的当前状态与事件序列必须与请求前完全一致

