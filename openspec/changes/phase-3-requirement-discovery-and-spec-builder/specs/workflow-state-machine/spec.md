## 新增需求

### 需求:Spec 确认为 REQUIREMENT_REVIEW 内审批门（不推进状态）

Spec 确认必须实现为 `REQUIREMENT_REVIEW` 状态内的审批门：把 `PresentationSpec.confirmedByUser` 置真并追加 `PRESENTATION_SPEC_CONFIRMED` 事件，但**禁止推进工作流状态**。本期仍不得向合法邻接边表加入 `REQUIREMENT_REVIEW → OUTLINE_GENERATION` 或其之后的任何前向边（归属 Phase 5+）。`confirmedByUser` 仅作为后续阶段前向边将来消费的守卫，本期不消费。确认动作禁止触发任何后续 agent 或 LLM 生成。

#### 场景:确认不改变工作流状态

- **当** 项目处于 `REQUIREMENT_REVIEW`，用户确认已校验的 Spec
- **那么** 系统必须置 `confirmedByUser=true`、追加 `PRESENTATION_SPEC_CONFIRMED`，且工作流状态保持 `REQUIREMENT_REVIEW`

#### 场景:确认后前向边仍不存在

- **当** 已确认 Spec 的项目请求 `to=OUTLINE_GENERATION`
- **那么** 系统必须仍以 `INVALID_STATE_TRANSITION` 拒绝（该边不在本期合法邻接边表内），状态不变、不追加事件

### 需求:确认后更改 Profile 必须经回退边

当项目已确认 Spec 后需要更改 `scene` / `styleProfileId`，系统必须要求项目先经既有回退边 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回到需求发现/复核，才允许 profile 变更；直接在已确认态更改 profile 必须被拒绝且无持久副作用。**已确认项目经该回退边回退时，必须把 `confirmedByUser` 重置为 false 并作废旧 Spec 快照**，使其在重新确认前不被视为已确认（防止遗留 scene/styleProfile 已过期却仍标记已确认的 Spec）。本需求复用 Phase 2 既有回退边，不新增工作流边。

#### 场景:确认后经回退边改 profile

- **当** 已确认 Spec 的项目先转移回 `REQUIREMENT_DISCOVERY`（此时 `confirmedByUser` 被重置为 false、旧 Spec 快照作废），再更改 profile
- **那么** 系统必须允许 profile 变更并追加 `SCENE_STYLE_PROFILE_UPDATED`，且该项目须重新确认才再次视为已确认

#### 场景:确认态直接改 profile 被拒绝

- **当** 已确认 Spec 的项目未回退即请求更改 profile
- **那么** 系统必须拒绝变更，状态与事件序列保持不变
