# event-log 规范

## 目的
待定 - 由归档变更 phase-2-api-skeleton-and-workflow-state 创建。归档后请更新目的。
## 需求
### 需求:状态变更追加事件

每一次成功的状态转移，系统必须向该项目的事件序列追加一个 `Event`，其 `type` 必须为 shared-schema 新增的 `WORKFLOW_STATE_CHANGED`（见 `shared-schema-contract` 增量），`payload` 为 `{ previousState, nextState }`。动作发起者只记录在 `Event` 顶层 `actor` 字段（不在 payload 中重复，避免顶层与 payload 的 actor 冲突）；由于 `validateEvent` 不拒绝 payload 中的额外键，此非重复由后端作为唯一事件生产者在生产侧保证（生产侧不变量），而非校验器强制。API 触发的转移其 `actor` 必须为 `user`。事件结构必须符合 shared-schema `Event`（含 `id`、`projectId`、`type`、`actor`、`payload`、`createdAt`），`actor` 取值必须来自 shared-schema `ACTOR_TYPES`。事件在追加前必须通过 shared-schema 校验（`validateEvent`）。本期只记录工作流状态变更事件，不产生 Phase 3+ 的需求发现事件。

#### 场景:合法状态转移写入事件

- **当** 一个项目成功完成一次合法状态转移
- **那么** 系统必须追加一条 `type=WORKFLOW_STATE_CHANGED`、顶层 `actor=user`、`payload={previousState, nextState}` 的事件，且该事件通过 shared-schema 校验

#### 场景:事件负载不合法时拒绝

- **当** 待追加的事件负载无法通过 shared-schema 校验
- **那么** 系统必须拒绝该次动作、禁止追加事件，并且禁止改动项目状态

### 需求:按项目读取事件序列

系统必须能在服务/仓储层按 `projectId` 返回该项目已记录的事件序列，并保持追加顺序，供契约测试与内部逻辑消费。读取事件禁止改动任何持久状态。本期不暴露事件读取的 HTTP 端点，面向客户端的事件读取接口留待后续阶段。

#### 场景:按项目读取事件序列

- **当** 服务/仓储层读取某个已产生若干次状态变更的项目事件序列
- **那么** 系统必须按追加先后顺序返回全部已记录事件

#### 场景:失败动作不产生事件

- **当** 某次状态变更因非法转移或校验失败被拒绝
- **那么** 该项目的事件序列长度必须与动作前一致，不得出现新事件

