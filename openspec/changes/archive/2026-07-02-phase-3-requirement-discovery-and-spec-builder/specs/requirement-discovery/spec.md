## 新增需求

### 需求:Requirement Discovery Agent 抽取已知与未知

系统必须提供 Requirement Discovery Agent，从项目初始请求与已有上下文抽取已知需求字段（至少 topic、audience、purpose、duration、language、tone、style preference、target format、source materials、constraints）与未知字段，并输出置信度。抽取结果必须为结构化 JSON 并经 schema/结构校验；该结果属于后端瞬时会话态，随项目存储，不进 shared-schema 核心实体。agent 必须经 `LLMProvider` 文本接口运行。

#### 场景:从初始请求抽取字段

- **当** 一个处于 `REQUIREMENT_DISCOVERY` 的项目启动需求发现
- **那么** 系统必须返回已知字段、未知字段与一个置信度分值，结构化且可校验

#### 场景:抽取结果不进 canonical schema

- **当** 需求发现产生会话草稿
- **那么** 该草稿必须作为后端瞬时状态存储，禁止写入 shared-schema 核心实体

### 需求:Gap 分类按场景排序

系统必须把未知字段分类为 `MUST_ASK` / `SHOULD_ASK` / `DO_NOT_ASK`，并按 `scene` 调整优先级：`education` 优先受众年龄段/趣味度/互动程度，`corporate` 优先决策目标/汇报时长/风险边界。分类必须只把高价值缺失项列为 `MUST_ASK`，可用默认值的列为 `DO_NOT_ASK`。

#### 场景:education 场景优先受众相关问题

- **当** 项目 `scene=education` 且 audience 未知
- **那么** audience 相关缺口必须被分类为 `MUST_ASK` 并优先于低价值缺口

#### 场景:可默认字段不追问

- **当** 某缺失字段存在合理默认值（如个人项目的公司 logo）
- **那么** 系统必须将其分类为 `DO_NOT_ASK`，不生成对应问题

### 需求:Question Agent 产出可作答问题

系统必须把 `MUST_ASK` / `SHOULD_ASK` 缺口转成面向用户的问题，优先多选（提供选项）并允许可选自由文本。每个问题必须有稳定的 `questionId`。生成一批问题时必须记录 `QUESTION_POLICY_APPLIED`，每个被提出的问题必须记录 `REQUIREMENT_QUESTION_ASKED`。

#### 场景:生成多选加自由文本问题

- **当** 存在需要追问的缺口
- **那么** 系统必须返回带 `questionId`、选项与 `freeTextAllowed` 的问题，并追加 `REQUIREMENT_QUESTION_ASKED` 事件

### 需求:场景感知问题策略与停止条件

系统必须按 `questionPolicy` 自适应控制提问：`mode ∈ {fast, thorough}`；每个 `scene` 有置信度阈值（`education 0.82` / `corporate 0.75` / `default 0.78`；`thorough` 模式阈值必须 ≥0.85）；提问数上限 `fast=3` / `thorough=5`。系统必须在下列任一条件满足时停止追问：置信度达到有效阈值、达到有效提问上限、所有 `MUST_ASK` 已答、或用户选择跳过剩余问题。阈值必须可配置（作为标定旋钮）。生效的 `questionPolicy` 必须能快照进 `PresentationSpec`。

#### 场景:达到场景阈值即停止

- **当** `scene=education`、`mode=fast`，作答后置信度达到 0.82
- **那么** 系统必须停止追问并标记已达阈值

#### 场景:达到提问上限即停止

- **当** `mode=fast` 且已提出 3 个问题仍未达阈值
- **那么** 系统必须停止追问（不超过上限）

### 需求:用户可跳过并记录风险

系统必须允许用户跳过剩余问题或单个问题。跳过后系统必须能继续流程，并把被跳过项与低置信字段写入 `PresentationSpec.riskNotes`。每次跳过必须记录 `REQUIREMENT_QUESTION_SKIPPED`。

#### 场景:跳过后继续并写风险

- **当** 用户在未达阈值时选择跳过剩余问题
- **那么** 系统必须允许流程继续，把跳过项记入 `riskNotes`，并追加 `REQUIREMENT_QUESTION_SKIPPED` 事件

#### 场景:跳过不阻塞 Spec 构建

- **当** 存在被跳过的 `SHOULD_ASK` 问题
- **那么** 系统必须仍能构建带风险标注的 `PresentationSpec`，不因跳过而失败
