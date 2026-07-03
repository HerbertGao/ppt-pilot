## 上下文

Phase 3 交付需求澄清 + Spec Builder（`LLMProvider` 文本接口、`agents/_generate.generate_validated` 有界修复、`build_spec` 的**内联校验**、事件 validate-before-append、`resolve_scene_and_style`），确认后项目停在 `REQUIREMENT_REVIEW`。Phase 4 是其前端壳。Phase 2 的 `workflow.py` 把 `TRANSITION_EDGES` 限定为 `NEW→DISCOVERY→REVIEW`（+ 回退），并留注释「后续阶段前向边由归属阶段加入」。schema 侧：`SlidePlan` 已是 canonical 类型（`visualIntent` 目前为自由 `string`），但**无 `Outline` 类型**、无 `VisualIntent` 枚举、`EVENT_TYPES` 无大纲/规划事件、`validateEntity`/`ENTITY_NAMES` 未含 `Outline`。

Phase 5 在确认的 Spec 之上加两级结构产物（大纲 → 逐页规划），是纯**后端 + 共享 schema** 期，复用 Phase 3 全部基座，不含前端。

约束：不改 `LLMProvider` 接口；不改 Phase 3 契约；CI 无网络（默认 mock）；事件先校验后追加。

## 目标 / 非目标

**目标：** 确认 Spec → 可编辑/可确认的结构化**大纲** → 逐页 `SlidePlan`；打通 `REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW` 前向 + 回退边（回退 None-safe 清空下游）；两 agent 隐藏在 `LLMProvider` 后、schema 校验、有界修复、决定性 mock。

**非目标：** 前端界面、HTML 预览/Slide 元素模型/缩略图（Phase 6）、内容/文生图/导出（Phase 7+）、`SlideStatus` 的 generated/reviewed/locked、锁定/版本运行时。

## 决策

### D1：`Outline` 作为 canonical shared-schema 实体 + 读端点

新增 `Outline { id?, sections: OutlineSection[], confirmedByUser: boolean, riskNotes?: string[] }` 与 `OutlineSection { title, purpose, estimatedSlides }`（**不含 `slides` 回填字段**——见 D8，slide 身份唯一来源是 `SlidePlan.slideId`）。理由：大纲要被人工编辑 + 确认 + 回退作废并持久化。为兑现「可读」承诺并避免 Phase 4「无读端点」痛点，本期**同时提供读端点** `GET /outline` 与 `GET /slides/plans`（返回持久化的完整产物），不是只写不读。
- `Outline` 必须完整接入 shared-schema 校验：`types.ts` 类型、`validation.ts` 的 `validateOutlineAt`（含 **`sections` 至少 1 项** + 每 section `estimatedSlides≥1` + section 数 ≤ 上限），并登记进 `ENTITY_NAMES` / `EntityMap` / `validateEntity` 分发与入口、以及 **`runtimeValidationEntrypoints`**（`satisfies Record<EntityName,string>`——`ENTITY_NAMES` 加 `Outline` 会拓宽 `EntityName`，缺对应入口键会 typecheck 失败），后端经 `validateEntity("Outline", ...)` 消费，与 `SlidePlan` 一致。

### D2：后端 + schema，不做前端（延续 3/4 分工）

只提供 API + agent + schema + 工作流边；转移由显式 `POST /transitions` 驱动，**动作端点不自行推进状态**（沿用 Phase 2/3）。

### D3：复用 Phase 3 基座

- 两 agent 的 LLM 调用 + 有界修复 + 内联校验采用 **`spec_builder.py::build_spec` 同款自有循环**（见 **D6**），**不复用 `agents/_generate.generate_validated`**——后者把一切修复耗尽的失败归为 `LLMProviderError`(502)，而本处「产物结构非法」需要 `*_VALIDATION_ERROR`(400)，故走 `build_spec` 式自有循环内联校验（`build_spec` 正因此不走 `generate_validated`）。
- `LLMProvider` 原样复用（默认 mock）；事件经既有 event-log validate-before-append；错误经既有 `DomainError` 层。

### D4：转移保持 LLM-free 且结构化；内容前置在动作端点；无内容态可达但**无害**

`validate_transition` 仍只做结构邻接校验、**不调用任何 Agent/LLM**（维持 Phase 2 不变量与 `assert_state_machine_consistent`）。**不给前向边加内容守卫**——因此「只转移不生成」可把项目推进到 `OUTLINE_GENERATION`/`OUTLINE_REVIEW`/`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW` 而其产物为空。**此类无内容态是可达的，但被设计为无害（inert）**：

- 每个动作端点各自守卫其内容前置（下方 D5 表），空产物态下可用的动作只会返回稳定的 `*_NOT_CONFIRMABLE` / `*_NOT_FOUND`，绝不产出错误结果；
- 所有回退的下游清空必须 **None-safe**（产物为 `None` 时清空为 no-op，绝不解引用 `None`）；
- 因此「无内容态可达但无害」取代早期「无内容非法态不可达」的过强表述（后者与 content-free 边表自相矛盾）。

动作端点内容前置：

| 端点 | 状态前置 | 内容前置（服务层，失败错误码） |
|---|---|---|
| `outline/generate` | `state==OUTLINE_GENERATION` | **`spec is not None and spec.get("confirmedByUser")`**（否则 `OUTLINE_NOT_CONFIRMABLE`/409；**None-safe**，不解引用 `None`；spec 是 dict，见 D7） |
| `outline` PUT | `state ∈ {OUTLINE_GENERATION, OUTLINE_REVIEW}` | 提交体过 `Outline` 校验（否则 `OUTLINE_VALIDATION_ERROR`/400） |
| `outline/confirm` | `state==OUTLINE_REVIEW` | 存在 `outline`（否则 `OUTLINE_NOT_FOUND`/404） |
| `slides/plans/generate` | `state==SLIDE_PLANNING` | **`outline is not None and outline.get("confirmedByUser")`**（否则 `SLIDE_PLAN_NOT_CONFIRMABLE`/409；**None-safe**；outline 是 dict，见 D7） |
| `slides/{id}/plan` PUT | `state ∈ {SLIDE_PLANNING, SLIDE_PLAN_REVIEW}` | `slideId` 存在（否则 `SLIDE_PLAN_NOT_FOUND`/404）+ 过 `SlidePlan` 校验（否则 `SLIDE_PLAN_VALIDATION_ERROR`/400）；**服务强制 `slideId=path`（忽略 body id）并重校验集合唯一性** |
| `slides/plans/confirm` | `state==SLIDE_PLAN_REVIEW` | 存在**非空**规划（否则 `SLIDE_PLAN_NOT_FOUND`/404） |

**所有内容前置（含 `generate` 的 `confirmedByUser` 检查）必须 None-safe**：产物为 `None` 时按其 `*_NOT_CONFIRMABLE`/`*_NOT_FOUND` 稳定拒绝，绝不解引用 `None`——与回退清空的 None-safe 对称，共同兑现「无内容态可达但无害/绝不崩溃」。「错误状态下调用动作端点」判为 `INVALID_STATE_TRANSITION`；因 `InvalidStateTransitionError` 默认 `field="to"`（对无 `to` 的动作端点无意义），抛出点须清除该 `field`（见 task 7.1）。

「错误的状态下调用动作端点」（如在 `REQUIREMENT_REVIEW` 调 `outline/generate`）由**状态前置**判为 `INVALID_STATE_TRANSITION` 同族的状态错误，与「在 `OUTLINE_GENERATION` 但 spec 未确认」的 `OUTLINE_NOT_CONFIRMABLE` **分开**（后者仅指内容前置）。

### D5：前向 + 回退边与 None-safe「回退清空下游」

`TRANSITION_EDGES` 增补：

| from | forward to | rollback to |
|---|---|---|
| `REQUIREMENT_REVIEW` | `OUTLINE_GENERATION` | （已有 `→REQUIREMENT_DISCOVERY`） |
| `OUTLINE_GENERATION` | `OUTLINE_REVIEW` | `REQUIREMENT_REVIEW` |
| `OUTLINE_REVIEW` | `SLIDE_PLANNING` | `OUTLINE_GENERATION` |
| `SLIDE_PLANNING` | `SLIDE_PLAN_REVIEW` | `OUTLINE_REVIEW` |
| `SLIDE_PLAN_REVIEW` | （Phase 6） | `SLIDE_PLANNING` |

回退时清空对应下游产物（**均 None-safe**：产物已为 `None` 则为 no-op）：
- `OUTLINE_GENERATION→REQUIREMENT_REVIEW`：清 `project.outline` 与 `project.slidePlans`、置 `project.slidePlansConfirmed=false`。
- `OUTLINE_REVIEW→OUTLINE_GENERATION`：**若 `outline is not None`** 置 `outline["confirmedByUser"]=False`；清 `project.slidePlans`、置 `slidePlansConfirmed=false`。
- `SLIDE_PLANNING→OUTLINE_REVIEW`：清 `project.slidePlans`、置 `slidePlansConfirmed=false`。
- `SLIDE_PLAN_REVIEW→SLIDE_PLANNING`：保留 plans（回去重生成会覆盖，并重置 `slidePlansConfirmed=false`）。

清空是 `execute_transition` 内、`commit_state_change` 返回后对同一内存对象的属性写（与 Phase 2 回退清 `spec` 同构，仅在同步/内存仓库模型下成立——不宣称由 `commit_state_change` 原子携带）。

### D6：Agent 输出契约、校验与错误码分层（仿 `build_spec`，不用 `generate_validated`）

- Outline Agent 输出 `{sections:[{title,purpose,estimatedSlides}]}`（**section 无 slideId 列表**）；Slide Planner 逐页输出 `SlidePlan`（`visualIntent ∈ VisualIntent`）。
- 每个 agent 采用 **`spec_builder.py::build_spec` 同款自有有界修复循环**（`for attempt in range(max_repair+1)`：`provider.generate` → parse → **注入 runtime 拥有字段**（Outline 的 `confirmedByUser=False` 及可选 `id`/`riskNotes`，仿 `build_spec` 的 `candidate.update(snapshot)`）→ **内联** `validateOutline`/`validateSlidePlan`；不过则附修复提示重试一次），**耗尽后抛 `OutlineValidationError`/`SlidePlanValidationError` → `*_VALIDATION_ERROR`(400)**。注：`validateOutline` 校验的是注入后的完整 `Outline`（含必填 `confirmedByUser`），非裸 `{sections}`。**不复用 `agents/_generate.generate_validated`**——它把「校验失败」也归为 `LLMProviderError`(502)，与本处「结构非法应有界修复后产 400」冲突（`build_spec` 正因此才用自有循环、不走 `generate_validated`）。
- **Provider 传输层异常**（`provider.generate` 内的 URLError/超时等）作为 `LLMProviderError` 从循环中传播 → `LLM_PROVIDER_ERROR`(502)（循环只捕获校验类异常重试，不吞 Provider 传输异常）。两类错误由不同分支产生，无自相矛盾。

### D7：持久化模型与 slide-plan 确认标志

`StoredProject` 增字段：`outline: Any | None`（经 `validateEntity` 规范化的 **dict**，与既有 `spec: Any`-持-dict 精度一致，`repository.py`）、`slidePlans: list[Any] | None`、`slidePlansConfirmed: bool = False`（进程内内存仓库）。**确认标志经 dict 访问**（与 `requirements.py:364` 的 `project.spec.get("confirmedByUser")` 惯例一致）：读 `spec.get("confirmedByUser")` / `outline.get("confirmedByUser")`，写 `outline["confirmedByUser"] = True/False`；本文其余处的 `.confirmedByUser` 为该 dict 键的简写。大纲的确认态存于 `outline["confirmedByUser"]`；**规划无 schema 级确认字段，故用项目级 `slidePlansConfirmed`** 承载「规划已确认」——`slides/plans/confirm` 置真、`generate`/`PUT`/相关回退置假。读经 `GET /outline`、`GET /slides/plans`（本期不再向 `GET /projects/{id}` 加 `hasOutline` 等回显，避免无消费者的接口膨胀）。

### D8：slideId 生命周期（服务层权威）

`SlidePlan.slideId` 是单页编辑 `PUT /slides/{slideId}/plan` 的键，故其存在性/唯一性/稳定性**不能交给 LLM**：`slides/plans/generate` 由**服务层**为每页确定性赋 `slideId`（如 `slide-0001` 按序），生成后的规划集必须两两 `slideId` 唯一（集合级校验）；`SlidePlan.slideId` 在服务采纳时视为必填。重新 `generate` **整体覆盖** `project.slidePlans`（丢弃此前 `PUT` 编辑并重置 `slidePlansConfirmed=false`）——这是显式且被 spec 声明的语义，非静默。`OutlineSection` 不持有 slideId 列表（D1），避免与 `SlidePlan.slideId` 的一致性负担。

### D9：新事件 payload 契约

六个新事件的必填 payload 字段（供 `validateEventPayload` 逐类型校验，并更新 `docs/DATA_MODEL.md`）：

| 事件 | 必填 payload |
|---|---|
| `OUTLINE_GENERATED` | `sectionCount`（int），`nextState`（当前 state） |
| `OUTLINE_UPDATED` | `sectionCount`，`nextState` |
| `OUTLINE_CONFIRMED` | `sectionCount`，`nextState` |
| `SLIDE_PLAN_GENERATED` | `slideCount`（int），`slideIds`（string[]），`nextState` |
| `SLIDE_PLAN_UPDATED` | `slideId`（被编辑页），`nextState` |
| `SLIDE_PLAN_CONFIRMED` | `slideCount`，`nextState` |

`validateEventPayload` 必须**fail-closed**：对 `EVENT_TYPES` 中无显式 `case` 的类型返回校验失败（禁止 fail-open 空过），使「加了 `EVENT_TYPES` 却忘写 payload case」在测试中显性失败。

## 风险 / 权衡

- [无内容态可达] → 见 D4：可达但无害（动作端点各自守卫、回退 None-safe）；`--selfcheck` 断言无内容态下动作只返回稳定拒绝码、回退不崩溃。
- [visualIntent 收紧是破坏性变更] → 见 shared-schema-contract 的 **MODIFIED**：明确这是对既有 `SlidePlan`/`Presentation` 校验行为的语义收紧（**非纯加法**）；既有 fixtures 恰用 `"image"`（枚举内）故存活，但新增 `invalid/*` fixture 锁定「越界 visualIntent 现被拒」。
- [slide-plan 无 schema 确认字段] → 用项目级 `slidePlansConfirmed`（D7），生命周期在 generate/update/confirm/rollback 明确置位。
- [错误码路径] → D6 分层：内联校验产 400、Provider 传输产 502，避免「一个只会 502 的函数被要求产 400」的矛盾。
- [LLM 非确定性破坏 CI] → 默认 `MockLLMProvider` 决定性输出。
- [schema 破坏既有 fixtures] → 除 visualIntent 收紧外均为加法；`Outline`/事件为新增；`schema-validation-fixtures` 增补 valid + invalid 样例。
- [confirm 非幂等重放（承 Phase 4 教训）] → 大纲/规划 confirm 显式「重放安全 + 非严格幂等」并在 spec 的「重复确认」场景写明。

## 迁移计划

纯增量 + 一处 schema 收紧（visualIntent）：新增后端模块 + schema 加法 + 边表加法；`StoredProject` 新字段默认空/False。无数据迁移（内存仓库）。回滚本变更即恢复 Phase 4 终态。

## 待解决问题

- `estimatedSlides` 与实际规划页数不一致：本期定为**软提示**——规划生成时若两者不符，服务层向 `SlidePlan.riskNotes` 追加一条提示，不硬失败（spec 以一条 riskNote 需求固化，不留空白）。
- Outline Agent 是否需要章节级追问：本期一次性生成 + 人工 `PUT` 编辑，不做追问。
- `Slide` 实体（`SlideStatus=planned`）实体化：本期仅存 `SlidePlan[]`，`Slide` 实体化留给 Phase 6。
