# requirement-spec-api 规范

## 目的
待定 - 由归档变更 phase-3-requirement-discovery-and-spec-builder 创建。归档后请更新目的。
## 需求
### 需求:需求发现 HTTP 接口

系统必须提供 `POST /api/projects/{projectId}/requirements/discover` 启动或继续需求发现。请求体可选 `mode`（默认 `fast`）、`maxQuestions`（`fast` 默认 3 / `thorough` 默认 5）、`scene`、`styleProfileId`（未提供则用项目已存上下文）。响应必须返回问题列表、当前置信度、有效阈值与是否达阈。非法 `scene` / `styleProfileId` 归属错误必须返回统一校验错误且不进入发现流程、无持久副作用。接口调用必须由 `LLMProvider` 驱动（测试用 mock）。

#### 场景:启动需求发现返回问题与置信度

- **当** 客户端对处于 `REQUIREMENT_DISCOVERY` 的项目 `POST .../requirements/discover`
- **那么** 系统必须返回问题、`confidence`、`threshold` 与 `thresholdReached`

#### 场景:非法 scene 被拒绝且无副作用

- **当** 请求体含不在 `SCENES` 内的 `scene`
- **那么** 系统必须返回 `INVALID_SCENE` 统一错误，不进入发现流程、不追加事件

### 需求:作答与跳过接口

系统必须提供 `POST /api/projects/{projectId}/requirements/questions/{questionId}/answer` 与 `POST /api/projects/{projectId}/requirements/questions/{questionId}/skip`。作答必须更新置信度并返回是否达阈；跳过必须把该问题写入风险并追加 `REQUIREMENT_QUESTION_SKIPPED`。对不存在的 `questionId` 必须返回稳定的未找到错误且无持久副作用。

#### 场景:作答更新置信度

- **当** 客户端对有效 `questionId` 提交 `answer`
- **那么** 系统必须更新 `confidence` 并返回新的 `thresholdReached`

#### 场景:跳过写风险并记录事件

- **当** 客户端对有效 `questionId` 请求 skip
- **那么** 系统必须把该问题记入 `riskNotes` 并追加 `REQUIREMENT_QUESTION_SKIPPED`

#### 场景:未知 questionId 被拒绝

- **当** 客户端对不存在的 `questionId` 作答或跳过
- **那么** 系统必须返回稳定的未找到错误，且不更新置信度、不追加事件

### 需求:Spec 确认接口

系统必须提供 `POST /api/projects/{projectId}/requirements/confirm`，触发 Spec 构建（若尚未构建）、schema 校验与确认。成功响应必须返回快照的 `scene`、`styleProfileId`、`questionPolicy`、`riskNotes` 与 `confirmed=true`，且 `nextState` 必须为 `REQUIREMENT_REVIEW`（本期确认不推进状态）。Spec 校验失败必须返回统一错误且无持久副作用。

#### 场景:确认返回快照且状态不变

- **当** 客户端对存在已校验 Spec 的项目 `POST .../requirements/confirm`
- **那么** 系统必须返回 `confirmed=true`、快照字段与 `nextState=REQUIREMENT_REVIEW`，并追加 `PRESENTATION_SPEC_CONFIRMED`

#### 场景:Spec 校验失败确认被拒绝

- **当** 构建出的 Spec 未通过 schema 校验
- **那么** 系统必须返回统一校验错误，不置位确认、不追加事件

### 需求:更新场景/风格 Profile 接口

系统必须提供 `PATCH /api/projects/{projectId}/profile` 更新 `scene` / `styleProfileId`。`styleProfileId` 必须存在且属于所选 `scene`（省略则回退到 scene 默认 profile）；成功更新必须追加 `SCENE_STYLE_PROFILE_UPDATED`。**Spec 确认之后**再改 profile 必须要求项目先经 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回退边回到需求发现/复核（复用工作流状态机既有回退边）后才允许变更；该回退必须**重置 `confirmedByUser=false` 并作废旧 Spec 快照**，改 profile 后须重新确认，避免遗留 scene/styleProfile 已过期却仍标记已确认的 Spec。校验失败必须返回统一错误且无持久副作用。

#### 场景:确认前更新 profile 成功

- **当** 项目尚未确认 Spec，客户端 `PATCH .../profile` 提交合法 `scene`/`styleProfileId`
- **那么** 系统必须更新 profile 并追加 `SCENE_STYLE_PROFILE_UPDATED`

#### 场景:styleProfileId 不属于 scene 被拒绝

- **当** `styleProfileId` 不属于所选 `scene`
- **那么** 系统必须返回 `STYLE_PROFILE_MISMATCH` 统一错误，且不更新、不追加事件

#### 场景:确认后改 profile 需先回退

- **当** 项目已确认 Spec，客户端直接请求改 profile 而未回到需求发现/复核
- **那么** 系统必须返回 `SPEC_NOT_CONFIRMABLE` 统一错误并提示需先回退到需求 review/discovery，且无持久副作用

#### 场景:回退后改 profile 作废旧确认

- **当** 已确认 Spec 的项目回退到 `REQUIREMENT_DISCOVERY` 并成功改 profile
- **那么** 系统必须已把 `confirmedByUser` 重置为 false、作废旧 Spec 快照，且该项目在重新确认前不得被视为已确认

### 需求:新接口沿用无副作用不变量

系统的所有 Phase 3 需求/Spec 接口必须沿用 Phase 2 统一错误约定与错误优先级（请求体校验 > 项目存在性 > 领域校验），并保证任何被拒绝的请求禁止改动持久状态、禁止追加事件。

#### 场景:任意被拒请求不留痕

- **当** 任一 Phase 3 接口因校验失败被拒绝
- **那么** 项目状态、Spec 与事件序列必须与请求前完全一致

