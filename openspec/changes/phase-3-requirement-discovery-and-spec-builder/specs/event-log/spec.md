## 新增需求

### 需求:Phase 3 需求/Spec 动作事件的运行时追加

Phase 2 的 event-log 运行时只产生 `WORKFLOW_STATE_CHANGED`，并明确「本期不产生 Phase 3+ 的需求发现事件」。本期解除该边界：需求发现与 Spec 构建的状态改变类动作必须在运行时追加对应事件，事件类型限于 shared-schema `EVENT_TYPES` 中已存在的 `SCENE_STYLE_PROFILE_UPDATED`、`QUESTION_POLICY_APPLIED`、`REQUIREMENT_QUESTION_ASKED`、`REQUIREMENT_QUESTION_SKIPPED`、`PRESENTATION_SPEC_CONFIRMED`。

这些事件类型的 **schema 校验（`validateEvent` / `validateEventPayload`）与负载字段契约在 shared-schema 与 `docs/DATA_MODEL.md` 中已存在**（Phase 1 已实现），本期**不改 shared-schema 源**，仅新增运行时生产方。后端作为唯一事件生产者，追加前必须以 `validateEvent` 校验，负载字段必须完整满足已存在的契约（见 `docs/DATA_MODEL.md` 事件负载清单，例如 `QUESTION_POLICY_APPLIED` 必含 `mode/sceneThreshold/maxQuestions/confidence/thresholdReached`；`REQUIREMENT_QUESTION_ASKED` 必含 `questionId/prompt/kind/options/confidenceBefore`；`REQUIREMENT_QUESTION_SKIPPED` 必含 `questionId/reason/confidenceAfter/riskNote`；`PRESENTATION_SPEC_CONFIRMED` 必含 `presentationSpecId/scene/styleProfileId/questionPolicy/riskNotes/nextState`；`SCENE_STYLE_PROFILE_UPDATED` 必含 `previousScene/previousStyleProfileId/scene/styleProfileId`）。动作发起者一律以 `Event` 顶层 `actor`（∈ `ACTOR_TYPES`）表达，不入 payload。校验失败必须拒绝该动作且不追加事件（复用 `api-error-and-validation-contract` 的无副作用不变量）。

#### 场景:提问追加合法事件

- **当** 需求发现生成一个问题
- **那么** 系统必须追加一条 `type=REQUIREMENT_QUESTION_ASKED`、顶层 `actor="ai"`、负载完整满足既有契约的事件，并先经 `validateEvent` 校验通过

#### 场景:确认追加 spec 事件

- **当** 用户确认已校验的 `PresentationSpec`
- **那么** 系统必须追加一条 `type=PRESENTATION_SPEC_CONFIRMED` 事件，其 `nextState` 为项目确认后保持的状态 `REQUIREMENT_REVIEW`（不推进），负载其余字段满足既有契约

#### 场景:负载不完整不追加

- **当** 后端将要追加的事件负载缺失既有契约的必需字段（如 `QUESTION_POLICY_APPLIED` 缺 `confidence`）
- **那么** `validateEvent` 必须拒绝，系统不得追加该事件，且不改动项目状态
