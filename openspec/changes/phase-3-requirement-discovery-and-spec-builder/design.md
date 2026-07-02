## 上下文

Phase 2 交付了 `apps/api` 的项目生命周期、工作流状态机（合法边仅到 `REQUIREMENT_REVIEW`）、事件模型、统一错误约定与 shared-schema 消费桥（校验桥 `validateEntity` + 常量桥）。Phase 3 是第一次引入真实 AI：需求澄清与 Spec Builder。它跨越 schema 与 API 两个包边界（**事件负载校验 Phase 1 已存在、本期不改 shared-schema 源**，只新增需求/Spec 事件的运行时生产方与 fixtures + 新的 agent 运行时与 HTTP 表面），并引入新的外部依赖（OpenRouter），因此需要 design.md 固定关键决策。

约束：不将 PPTX 作源；AI 输出必须先过 schema 校验；agent 不合并为单一 prompt；不动锁定内容；会话态不进 canonical schema；CI 不发真实网络请求；改动最小可逆（内存仓储、无数据迁移）。

## 目标 / 非目标

**目标：**

- 把模糊请求经需求澄清变成一个 schema 合法、用户确认的 `PresentationSpec`。
- 确立文本 `LLMProvider` 边界（接口 + OpenRouter 适配器 + 确定性 mock），agent 只用文本能力。
- 场景感知、最小提问、可跳过；跳过与低置信进入 `riskNotes`。
- 全部生成/确认动作有事件、有 schema 校验、失败无持久副作用。

**非目标：**

- 不做 Outline/Slide/Content/Layout/Image/Review agent，不做文生图 / `ImageProvider`。
- 不新增 `REQUIREMENT_REVIEW → OUTLINE_GENERATION` 及之后的工作流边。
- 不做前端 UI、不引入 PostgreSQL/Redis/队列、不做鉴权。

## 决策

### D1：运行时在 apps/api，agent 定义（prompt 模板）在 packages/ai-workflow

划清「运行时」与「定义」两层，消除与 `packages/ai-workflow/README.md` 边界的冲突：

- **`apps/api`（app/agents、app/llm）**：agent 执行运行时与 `LLMProvider` 网络适配器（OpenRouter/mock），经 Phase 2 已有的校验桥/常量桥消费 shared-schema。ARCHITECTURE §4 把 Agent Orchestrator 定义为后端服务，Phase 2 全部业务逻辑在 Python。
- **`packages/ai-workflow`**：本期承载**版本化 prompt 模板 + agent I/O 契约**（`docs/PROMPTS.md` 的落地位置），以语言中立的数据/文本形式存在、由后端运行时加载；**不承载运行时**。这正是 README「reserved for … agent orchestration definitions / 不得并入 apps/api」所指的边界——定义留在 ai-workflow，运行时在 apps/api，二者不合并。本变更同步给该 README 增加一行 Phase-3 边界说明。
- 备选：把 agent 运行时也用 TS 实现在 `packages/ai-workflow` → 否决：制造第二套跨语言运行时，API 需 shell-out 到 Node，重且脆。
- 备选：prompt 也放 `apps/api` → 否决：与 README 的「定义」边界冲突，且 Phase 4 前端若需同款契约会重复。

### D2：`LLMProvider` 只暴露文本能力，结构化输出在 agent 层解析 + 校验

`LLMProvider` 接口形如 `generate(messages, *, model, response_format=json) -> text`。结构化性由 agent 层负责：解析 JSON → 校验 → 非法则有界重试/修复（默认 ≤1 次），仍非法则拒绝且不持久化。**校验分两类，避免把瞬时输出硬塞进 canonical schema**：canonical 产物（`PresentationSpec`、要追加的 `Event` 负载）走 shared-schema `validateEntity` / `validateEvent`；需求发现的瞬时中间输出（草稿 / 问题 / gap 分类 / 置信度）走**后端结构（Pydantic）校验**，不走 shared-schema。
- OpenRouter 适配器：模型 ID、API key 经配置/环境变量注入，不硬编码；超时与错误映射到统一错误信封。
- mock provider：确定性、可编程返回，作为契约测试与本地默认；CI 只用 mock，不发真实请求。
- 显式不定义 `ImageProvider`（Phase 9）。参见 `docs/ARCHITECTURE.md` §5。

### D3：确认 Spec 不越出 `REQUIREMENT_REVIEW`

确认动作把 `PresentationSpec.confirmedByUser` 置真、快照 `scene/styleProfileId/questionPolicy/riskNotes`、追加 `PRESENTATION_SPEC_CONFIRMED`，**不推进工作流状态**。
- 备选：确认即推进到 `OUTLINE_GENERATION`（`docs/API.md` §3 旧草稿）→ 否决：Phase 5 才拥有 outline 生成，提前推进会把项目停在无处理器的空状态，违反 Phase 2「后段边由归属阶段加入」原则。`confirmedByUser` 作为 Phase 5 前向边将来消费的守卫。
- `docs/API.md` §3 的 confirm 响应 `nextState` 相应改为 `REQUIREMENT_REVIEW`。
- **既有 fixture 冲突**：`packages/shared-schema/fixtures/valid/event-minimal.json` 是一个 `PRESENTATION_SPEC_CONFIRMED` fixture，其 `nextState` 仍为旧行为的 `OUTLINE_GENERATION`；本变更必须把它改为 `REQUIREMENT_REVIEW`（schema 仍合法，只是与新确认语义对齐）。
- **确认是可撤销的**：`confirmedByUser=true` 后若经 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回退（改 profile 或重做发现），必须重置 `confirmedByUser=false` 并作废旧 Spec 快照，要求重新确认——否则会遗留一个 scene/styleProfile 已过期却仍标记已确认的 Spec（与 `docs/WORKFLOW.md`「confirmation 后切换风格须回到 review/discovery」一致）。

### D4：需求会话态是后端瞬时状态，不进 shared-schema

草稿、问题列表、已答/已跳过集合、置信度挂在 Phase 2 的 `StoredProject`（内存仓储）。沿用 Phase 2「session state 不入 canonical schema」。**本期不改 shared-schema 源**：5 个 Phase-3 事件类型的负载校验与 `docs/DATA_MODEL.md` 清单在 Phase 1 已实现（`validation.ts:1215-1277`），后端只按既有契约填充负载并追加事件（`event-log` 增量）。仅补充 fixtures（回归用），不改校验逻辑、不需为此重建 `dist`。

### D5：问题策略是可标定的后端配置

`scene → sceneThreshold`（education 0.82 / corporate 0.75 / default 0.78；thorough ≥0.85）与 `mode → maxQuestions`（fast 3 / thorough 5）作为后端单一策略模块，`questionPolicy` 快照进 spec。阈值可调（标定旋钮），因为置信度评分是启发式的。

## 风险 / 权衡

- [LLM 不确定性使测试不稳] → 契约测试全走 mock provider；真实 OpenRouter 只在显式配置下启用；agent 层做有界 JSON 修复重试。
- [OpenRouter 超时/失败/计费] → 适配器设超时，失败映射为统一错误码（如 `LLM_PROVIDER_ERROR`，5xx），拒绝时不写任何持久状态、不追加事件。
- [置信度评分粗糙、阈值可能误停/多问] → 阈值按 scene 可配置，作为标定旋钮，不写死。
- [TS/Python schema 漂移] → 复用 Phase 2 校验桥/常量桥消费既有事件负载契约与阈值常量，不在 Python 手抄；本期不改 shared-schema 源，无需为校验重建 `dist`。
- [agent 输出违约] → canonical 产物（`PresentationSpec` / `Event` 负载）先经 shared-schema 校验，瞬时中间输出经后端结构校验；非法即拒，绝不半写。
- [与 HTML 预览 / PPTX 导出一致性] → 本期不产出 slide/preview/PPTX，无导出一致性面；确保 `PresentationSpec` 为后续 Outline/渲染/导出唯一结构化输入即满足前向一致性验证点。

## 迁移计划

- 纯增量：新能力仅经新端点可达，`LLMProvider` 默认 mock，无数据迁移（内存仓储）。
- 部署：不改 shared-schema 源；后端加 agent/llm 模块与新路由；补事件 fixtures 后跑 `validate-fixtures`。
- 回滚：回退本变更即可，无持久数据需清理；已存项目仍可用 Phase 2 早期状态流转。

## 待解决问题

- OpenRouter 具体默认模型 ID 与计费在实现阶段按配置确定，不写入契约。
- prompt 模板存 `packages/ai-workflow`、由后端加载（D1 已定）；是否额外产出前端可用的 TS 契约副本留待 Phase 4 前端需求确定时再评估。
