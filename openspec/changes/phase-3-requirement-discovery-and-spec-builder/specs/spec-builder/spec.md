## 新增需求

### 需求:Spec Builder Agent 产出规范化 PresentationSpec

系统必须提供 Spec Builder Agent，从初始请求与用户回答构建 `PresentationSpec`。构建结果必须快照有效 `scene`、`styleProfileId`、`questionPolicy`（mode / sceneThreshold / maxQuestions）与 `riskNotes`。agent 必须经 `LLMProvider` 文本接口运行，禁止编造业务事实，未知可选字段留空/null。构建产出必须是结构化 JSON。

#### 场景:构建快照场景与策略

- **当** 需求发现完成并触发 Spec 构建
- **那么** 系统必须产出包含 `scene`、`styleProfileId`、`questionPolicy` 与 `riskNotes` 快照的 `PresentationSpec`

### 需求:生成前 schema 校验拒绝非法 Spec

系统必须在接受 Spec Builder 输出前经 shared-schema 校验入口校验为合法 `PresentationSpec`；校验失败必须拒绝该输出、禁止写入持久状态、禁止追加事件（可触发 `llm-provider` 定义的有界修复重试）。只有校验通过的 Spec 才可作为可确认对象存储。

#### 场景:非法 Spec 被拒绝且无副作用

- **当** Spec Builder 输出缺失必填字段或含非法 `scene`
- **那么** 系统必须拒绝该 Spec、不写入持久状态、不追加事件

#### 场景:合法 Spec 通过校验后可确认

- **当** Spec Builder 输出通过 shared-schema 校验
- **那么** 系统必须将其作为待确认 `PresentationSpec` 存储，供用户确认

### 需求:确认 Spec 是 REQUIREMENT_REVIEW 内的审批门

系统必须提供确认动作：把 `PresentationSpec.confirmedByUser` 置为真并追加 `PRESENTATION_SPEC_CONFIRMED` 事件。确认动作**禁止推进工作流状态**（项目保持 `REQUIREMENT_REVIEW`），也不得加入 `OUTLINE_GENERATION` 及之后的任何边（归属 Phase 5）。`confirmedByUser` 仅作为后续阶段前向边将来消费的守卫。确认必须以合法、已校验的 Spec 为前置；不存在已校验 Spec 时确认必须被拒绝且无副作用。

#### 场景:确认置位但不改状态

- **当** 项目处于 `REQUIREMENT_REVIEW` 且存在已校验 Spec，用户确认
- **那么** 系统必须把 `confirmedByUser` 置真、追加 `PRESENTATION_SPEC_CONFIRMED`，且工作流状态保持 `REQUIREMENT_REVIEW`

#### 场景:无已校验 Spec 时确认被拒绝

- **当** 项目尚无通过校验的 `PresentationSpec` 却请求确认
- **那么** 系统必须拒绝确认，且不置位、不追加事件
