## 新增需求

### 需求:新增工作流状态变更事件类型

shared-schema `EVENT_TYPES` 必须新增一个 `WORKFLOW_STATE_CHANGED` 事件类型，用于表示一次工作流状态转移；`validateEvent` / `validateEventPayload` 必须为该类型新增 switch case 并校验其负载结构 `{ previousState, nextState }`，其中 `previousState`、`nextState` 必须 ∈ `WORKFLOW_STATES`。动作发起者以 `Event` 顶层 `actor`（∈ `ACTOR_TYPES`）表达，不放入 payload。此新增必须同步反映到 TypeScript 类型、JSON Schema 校验产物与 `docs/DATA_MODEL.md` 的 Event 类型清单。这是本期唯一对 shared-schema 源的改动，不新增核心实体。

#### 场景:合法的状态变更事件通过校验

- **当** 以 `type=WORKFLOW_STATE_CHANGED`、顶层 `actor="user"`、`payload={previousState:"NEW_PROJECT", nextState:"REQUIREMENT_DISCOVERY"}` 调用 `validateEvent`
- **那么** 校验必须通过

#### 场景:非法状态值的状态变更事件被拒绝

- **当** 状态变更事件的 `previousState` 或 `nextState` 不在 `WORKFLOW_STATES` 内
- **那么** `validateEvent` 必须返回字段路径错误

### 需求:Python 端可消费 shared-schema 常量

除既有的整实体校验桥（`validateEntity`）外，`apps/api` 必须能通过一个 shared-schema 消费入口读取运行时常量与派生映射，至少覆盖 `SCENES`、`WORKFLOW_STATES`、`ACTOR_TYPES`，以及 profile→scene 映射（`SCENES` 供 `INVALID_SCENE` 校验、`WORKFLOW_STATES` 供状态集合断言、映射供风格归属校验）。`EVENT_TYPES` 本期无后端本地消费方（事件类型由 `validateEvent` 校验桥强制），仅作为可选/前向用途，不纳入必需消费集合。profile→scene 映射必须以可序列化形式跨桥传递——由 `BUILT_IN_STYLE_PROFILES` / `DEFAULT_STYLE_PROFILE_ID_BY_SCENE` 序列化为映射后在 Python 侧查表（`getStyleProfileScene` 是函数，不能直接经打印常量的桥序列化）。这些符号均已由 `dist/index.js` 导出，消费入口以子进程桥形式读取，禁止在 Python 手抄这些常量。消费入口以 shared-schema 已构建产物（`dist/index.js`）为前置条件；由于 build-missing 守卫只覆盖 `dist` 缺失、不覆盖 `dist` 陈旧，编辑 shared-schema 源（新增事件类型）后必须重建 `dist` 再运行后端消费。

#### 场景:后端读取场景、状态与角色常量

- **当** `apps/api` 请求 shared-schema 常量
- **那么** 必须返回与 shared-schema 源一致的 `SCENES`、`WORKFLOW_STATES`、`ACTOR_TYPES` 数组与可序列化的 profile→scene 映射

#### 场景:构建产物缺失时给出明确前置错误

- **当** `dist/index.js` 未构建即请求常量
- **那么** 消费入口必须返回明确的构建前置错误（复用既有校验桥的 build-missing 语义），而非返回空集合或静默通过
