## 为什么

Phase 1 建立了共享 schema，Phase 2 建立了后端项目生命周期、工作流状态机（当前合法边仅覆盖 `NEW_PROJECT↔REQUIREMENT_DISCOVERY↔REQUIREMENT_REVIEW`）、事件模型与统一错误约定，但迄今**没有任何真实 AI 行为**：项目能在早期状态间流转，却无法把用户的模糊请求变成可确认的结构化 `PresentationSpec`。

本变更实现 PPTPilot 的**首个 AI 工作流**：需求澄清（Requirement Discovery + Gap 分类 + 场景感知问题策略）与 Spec Builder，落地在 Phase 2 的状态机与事件模型之上。这是产品「先问再生成、AI 输出必须先过 schema 校验」核心主张第一次真正兑现，也是后续 Outline/Slide/导出全链路的前置输入。

本期同时确立**文本 LLM 的 provider 边界**：引入 `LLMProvider` 接口 + OpenRouter 适配器 + 确定性 mock provider，所有 agent 只走文本补全。文生图（`ImageProvider`）按 `docs/ARCHITECTURE.md` §5 明确推迟到 Phase 9，本期不实现。

## 变更内容

- 新增 **`LLMProvider` 文本生成接口**（输入 prompt/消息 → 结构化 JSON 输出），提供：
  - OpenRouter 适配器（模型/密钥经配置与环境变量注入，不硬编码，CI 不发真实网络请求）。
  - 确定性 **mock provider**，作为契约测试与本地默认实现，保证 agent 行为可测、可复现。
  - agent 只消费文本能力；**不引入任何 image / 文生图 provider**（本期非目标）。
- 新增 **Requirement Discovery 工作流**：
  - Requirement Discovery Agent：从初始请求抽取已知字段（topic/audience/purpose/duration/language/tone/style/format/materials/constraints）与未知字段，输出置信度。
  - Requirement Gap 分类：把缺失字段分为 `MUST_ASK` / `SHOULD_ASK` / `DO_NOT_ASK`，按 `scene` 调整优先级（education 优先受众年龄/趣味/互动，corporate 优先决策目标/时长/风险边界）。
  - Question Agent：把 gap 转成面向用户的问题，优先多选 + 可选自由文本。
  - **场景感知问题策略**：`fast` / `thorough` 模式；按 `scene` 的置信度阈值（`education 0.82` / `corporate 0.75` / `default 0.78`，thorough 抬升到 ≥0.85）与提问上限（fast 3 / thorough 5）自适应停止；应用策略时记录 `QUESTION_POLICY_APPLIED`。
  - **跳过与风险记录**：用户可跳过剩余问题；跳过/低置信字段进入 `PresentationSpec.riskNotes`；提问记 `REQUIREMENT_QUESTION_ASKED`，跳过记 `REQUIREMENT_QUESTION_SKIPPED`。
  - 需求发现的会话态（草稿、问题、已答/已跳过、置信度）为**后端瞬时状态**，随 Phase 2 的 `StoredProject` 承载，不进 shared-schema 核心实体（沿用 Phase 2「session state 不入 canonical schema」约定）。
- 新增 **Spec Builder Agent 与 Spec 确认**：
  - 从请求与回答产出规范化 `PresentationSpec`（快照 `scene` / `styleProfileId` / `questionPolicy` / `riskNotes`）。
  - **生成前 schema 校验**：agent 输出先经 shared-schema 校验桥校验，非法输出被拒且不写持久状态、不追加事件（兑现「AI 输出必须先过 schema 校验」）。
  - 确认动作在 `REQUIREMENT_REVIEW` 内把 `confirmedByUser` 置真并追加 `PRESENTATION_SPEC_CONFIRMED`，**不推进到 `OUTLINE_GENERATION`**（该前向边与出边后置内容由 Phase 5 拥有；本期只把 `confirmedByUser` 作为 Phase 5 前向边将来消费的守卫置位）。
- 新增 **Requirement/Spec HTTP 表面**（落地 `docs/API.md` §3 由 Roadmap Draft 转为已实现）：
  - `POST /api/projects/{projectId}/requirements/discover`：启动/继续需求发现，返回问题、置信度、阈值、是否达阈。
  - `POST /api/projects/{projectId}/requirements/questions/{questionId}/answer`：作答并更新置信度。
  - `POST /api/projects/{projectId}/requirements/questions/{questionId}/skip`：跳过并写风险。
  - `POST /api/projects/{projectId}/requirements/confirm`：构建并确认 `PresentationSpec`。
  - `PATCH /api/projects/{projectId}/profile`：更新 `scene` / `styleProfileId`（落地 Phase 2 明确后置到本期的接口）；**Spec 确认后再改 profile 必须先回到 requirement review/discovery**（复用 Phase 2 的 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回退边），成功记 `SCENE_STYLE_PROFILE_UPDATED`。
  - 所有新接口沿用 Phase 2 统一错误约定与「校验失败无持久副作用」不变量。

非目标：

- 不实现 Outline / Slide Planner / Content / Layout / Image / Review 任何后续 agent，不生成大纲、slide plan、slide、HTML preview 或 PPTX。
- 不新增 `REQUIREMENT_REVIEW → OUTLINE_GENERATION` 及其后的任何工作流边（归属 Phase 5+），确认 Spec 不改变工作流状态。
- **不引入任何文生图 / `ImageProvider` / 图片候选逻辑**；本期 LLM 只用文本能力。
- 不实现锁定写保护、版本快照、局部再生、Review Agent 运行时。
- 不引入 PostgreSQL / Redis / Celery / S3，不做鉴权与多租户；会话态继续用 Phase 2 内存仓储。
- 不在前端实现需求澄清 UI（归属 Phase 4）。

## 功能 (Capabilities)

### 新增功能

- `llm-provider`: `LLMProvider` 文本生成接口、OpenRouter 适配器、确定性 mock provider；显式限定文本能力、排除文生图；prompt 模板可版本化、可测试。
- `requirement-discovery`: Requirement Discovery Agent、Gap 分类、Question Agent、场景感知问题策略（fast/thorough 阈值与上限）、停止条件、跳过与风险记录，以及对应问题类事件。
- `spec-builder`: Spec Builder Agent、生成前 schema 校验拒绝非法输出、`PresentationSpec` 快照与 `confirmedByUser` + `PRESENTATION_SPEC_CONFIRMED` 确认语义（不越出 `REQUIREMENT_REVIEW`）。
- `requirement-spec-api`: discover / answer / skip / confirm / profile 的 HTTP 表面、错误优先级与无持久副作用不变量。

### 修改功能

- `event-log`: 解除 Phase 2「本期不产生 Phase 3+ 需求发现事件」的边界，新增需求/Spec 动作的运行时事件追加（`SCENE_STYLE_PROFILE_UPDATED`、`QUESTION_POLICY_APPLIED`、`REQUIREMENT_QUESTION_ASKED`、`REQUIREMENT_QUESTION_SKIPPED`、`PRESENTATION_SPEC_CONFIRMED`）。这些事件类型的 schema 校验与负载契约在 shared-schema 与 `docs/DATA_MODEL.md` **已存在（Phase 1 已实现）**，本期**不改 shared-schema 源**，只新增运行时生产方并按既有契约完整填充负载。
- `workflow-state-machine`: 明确 Spec 确认是 `REQUIREMENT_REVIEW` 内的审批门（置 `confirmedByUser`、不推进状态）；「确认后改 profile 须经 review→discovery 回退边」，且回退必须重置 `confirmedByUser` 并要求重新确认；本期仍不加入 `OUTLINE_GENERATION` 及之后的前向边。
- `api-error-and-validation-contract`: 为需求发现与 Spec 构建新增稳定错误码（如 spec 校验失败、问题不存在、确认前置未满足、LLM 上游失败），并复用「失败无持久副作用」不变量。

## 影响

- 模式（schema）
  - **不改 shared-schema 源**：5 个 Phase-3 事件类型的负载校验（`validation.ts`）、类型与 `docs/DATA_MODEL.md` 清单在 Phase 1 已实现；本期只在后端按既有负载契约完整填充并追加事件（见 `event-log` 增量），复用现有 `PresentationSpec` 等类型，不新增核心实体。
  - 会话态（草稿 / 问题 / 作答 / 置信度）与非 canonical 的 agent 中间输出为后端 Pydantic 瞬时模型，用后端结构校验，不进 canonical schema、不走 shared-schema 校验；仅 `PresentationSpec` 与 `Event` 走 shared-schema 校验。
  - 补充 shared-schema 事件 fixtures（4 个缺失事件的 valid/invalid 样例；并修正既有 `event-minimal.json` 的 `PRESENTATION_SPEC_CONFIRMED` fixture `nextState`），属回归 hygiene，不改校验逻辑。
- 后端路由（API）
  - `apps/api` 新增需求发现与 Spec 服务、agent 运行时与 `LLMProvider`（含 OpenRouter 适配器与 mock），经 Phase 2 已有的校验桥 / 常量桥消费 shared-schema，禁止手抄枚举。
  - `apps/api/app/routes.py` 新增 discover / answer / skip / confirm / `PATCH .../profile` 五个入口。
  - `docs/API.md` §3 由 Roadmap Draft 转为 Phase 3 已实现；`PATCH .../profile` 由 Draft 转为已实现。
- 代理（agent）与 provider
  - 首次落地 agent 运行时：Requirement Discovery / Gap / Question / Spec Builder，均藏在 `LLMProvider` 后，只用文本能力。
  - `packages/ai-workflow` 作为版本化 prompt 模板 / agent I/O 契约的来源（非第二套运行时），不被并入 `apps/web` 或直接塞进 API 路由。
  - 明确不引入 `ImageProvider`；文生图选型留到 Phase 9。
- 网页端（web）
  - 不改动；Phase 4 前端工作流壳消费本期接口。
- 导出模块（exporter）
  - 不涉及。
- 事件（event）、版本（version）、锁定（lock）
  - 事件：本期扩展运行时以追加需求/Spec 类事件；版本与锁定不实现运行时。
- 验证方式
  - schema validation：agent 输出与事件负载写入前经校验，非法即拒且无持久副作用。
  - 事件：问题、跳过、策略应用、profile 更新、Spec 确认各追加对应事件；失败不追加。
  - 契约测试：覆盖发现启动 / 作答置信度更新 / 跳过写风险 / 场景阈值停止 / Spec 校验拒绝 / 确认不改状态 / 确认后改 profile 的回退 / 各错误码无副作用；LLM 走 mock provider，CI 不发真实网络请求。
  - 文档同步：`docs/API.md`、`docs/ROADMAP_PROGRESS.md` 更新 Phase 3 状态。
