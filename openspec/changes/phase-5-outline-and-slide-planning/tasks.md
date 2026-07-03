## 1. 共享 schema 扩展（shared-schema-contract）

- [x] 1.1 `packages/shared-schema/src/types.ts` 新增 canonical `Outline { id?, sections: OutlineSection[], confirmedByUser: boolean, riskNotes?: string[] }` 与 `OutlineSection { title, purpose, estimatedSlides }`（**不含 slideId 列表**，slide 身份唯一来源为 `SlidePlan.slideId`；不改其它既有类型）
- [x] 1.2 `enums.ts` 新增 `VisualIntent` 枚举（`diagram|image|chart|text|comparison|timeline`）；**将 `SlidePlan.visualIntent` 由自由 `string` 收紧为该枚举——语义收紧（非加法），以 shared-schema-contract 的 MODIFIED 需求表达**；新增 `EVENT_TYPES`：`OUTLINE_GENERATED`/`OUTLINE_UPDATED`/`OUTLINE_CONFIRMED`/`SLIDE_PLAN_GENERATED`/`SLIDE_PLAN_UPDATED`/`SLIDE_PLAN_CONFIRMED`（与 1.3 的 payload case **同批提交**，避免 fail-open 漏写）
- [x] 1.3 `validation.ts` 新增 `validateOutline`（结构 + **`sections` 至少 1 项** + 每 section `estimatedSlides≥1` + section 数 ≤ 上限）并**登记 `Outline` 进 `ENTITY_NAMES`（`validation-constants.ts`）/ `EntityMap` / `validateEntity` 分发 / `runtimeValidationEntrypoints`**（后者 `satisfies Record<EntityName,string>`，`ENTITY_NAMES` 加 `Outline` 会拓宽 `EntityName`、缺 `Outline: "validateOutline"` 键会 typecheck 失败）；`validateSlidePlan` 加 `visualIntent ∈ VisualIntent`（注意此收紧经 `validateSlide`/`validatePresentation` 传递，改变既有实体校验行为）；`validateEventPayload` 加 6 个事件 case 并改为 **fail-closed**（`EVENT_TYPES` 中无 case 的类型返回失败，禁止空过）
- [x] 1.4 `validation-constants.ts` 暴露 section 上限与总 slide 上限，供 Node 常量桥/后端消费（禁止 Python 手抄）
- [x] 1.5 新增 fixtures：`Outline` valid/invalid、大纲/规划事件 valid/invalid、**`invalid/*` 越界 `visualIntent`（锁定收紧后被拒）**；纳入 `schema-validation-fixtures`；确认除刻意收紧的 visualIntent 外 Phase 1–4 既有 fixtures 仍通过
- [x] 1.6 验收：`pnpm --filter @ppt-pilot/shared-schema typecheck` 与 fixtures 校验通过

## 2. 工作流边表与回退清空（workflow-state-machine）

- [x] 2.1 `apps/api/app/workflow.py` 向 `TRANSITION_EDGES` 加入 Phase 5 前向边（`REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW`）与回退边（`OUTLINE_GENERATION→REQUIREMENT_REVIEW`、`OUTLINE_REVIEW→OUTLINE_GENERATION`、`SLIDE_PLANNING→OUTLINE_REVIEW`、`SLIDE_PLAN_REVIEW→SLIDE_PLANNING`）；`SLIDE_PLAN_REVIEW` 之后仍不加
- [x] 2.2 `execute_transition` 内实现 **None-safe「回退清空下游」**：回 `REQUIREMENT_REVIEW` 清 `outline`+`slidePlans`+`slidePlansConfirmed=false`；回 `OUTLINE_GENERATION`（`outline` 存在时）置 `outline["confirmedByUser"]=False`（dict 访问，见 design D7）+清 `slidePlans`+`slidePlansConfirmed=false`；回 `OUTLINE_REVIEW` 清 `slidePlans`+`slidePlansConfirmed=false`；回 `SLIDE_PLANNING` 置 `slidePlansConfirmed=false`。产物为 `None` 时清空为 no-op（禁止解引用 `None`）；为提交后对内存对象的属性写（不宣称由 `commit_state_change` 原子携带）
- [x] 2.3 `repository.py`/`StoredProject` 增字段 `outline: Outline|None`、`slidePlans: list[SlidePlan]|None`、`slidePlansConfirmed: bool=False`（默认空/False）
- [x] 2.4 保持边表 LLM-free 且结构化（前向边不加内容守卫）；`assert_state_machine_consistent` 仍成立（引用状态 ⊆ WORKFLOW_STATES）
- [x] 2.5 `main.py --selfcheck` 增断言：新前向/回退链可走且各追加事件；**「只转移不生成」到达空产物态后，回退 None-safe 不崩溃、该态动作端点返回稳定拒绝码**；跨级跳转（`REQUIREMENT_REVIEW→SLIDE_PLANNING`）与 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 仍 `INVALID_STATE_TRANSITION` 且无副作用

## 3. Outline Agent（outline-agent）

- [x] 3.1 `apps/api/app/agents/outline.py`（+ `prompts`/`policy`/`models` 视需要）：从确认的 `PresentationSpec` 生成 `{sections:[{title,purpose,estimatedSlides}]}`（section 无 slideId 列表），经 `LLMProvider` 文本接口运行
- [x] 3.2 **仿 `spec_builder.py::build_spec` 自有有界修复循环**（`for attempt in range(max_repair+1)`：`provider.generate → parse → 注入 confirmedByUser=false（仿 candidate.update）→ 内联 validateOutline`，校验完整 `Outline` 非裸 `{sections}`），**不用 `generate_validated`**；耗尽后抛 `OutlineValidationError`→`OUTLINE_VALIDATION_ERROR`(400)；Provider 传输异常从循环传播→`LLM_PROVIDER_ERROR`(502)，两路径分开
- [x] 3.3 `MockLLMProvider` 增决定性大纲响应（CI 无网络）；`LLM_PROVIDER=openrouter` 走真实
- [x] 3.4 单测：决定性 mock 输出、有界修复、Provider 失败 → `LLM_PROVIDER_ERROR`、校验失败零持久化

## 4. Outline API（outline-api）

- [x] 4.1 `apps/api/app/outline.py` 服务层（仿 `requirements.py`）：`generate`（前置 `state==OUTLINE_GENERATION` + **`spec is not None and spec.get("confirmedByUser")`**，dict 访问、None-safe 否则 `OUTLINE_NOT_CONFIRMABLE`）、`update`（`state∈{OUTLINE_GENERATION,OUTLINE_REVIEW}` + 校验）、`confirm`（`state==OUTLINE_REVIEW` + outline 存在，不推进状态）
- [x] 4.2 `routes.py` 挂载 `POST /outline/generate`、`PUT /outline`、`POST /outline/confirm`、`GET /outline`（读持久化 outline）
- [x] 4.3 事件 validate-before-append：`OUTLINE_GENERATED`/`OUTLINE_UPDATED`/`OUTLINE_CONFIRMED`（payload 含 `sectionCount`+`nextState`；失败零持久化）
- [x] 4.4 错误分层：**错误状态调用→`INVALID_STATE_TRANSITION`(409；抛出点清除默认 `field="to"`，见 7.1)**；`OUTLINE_NOT_CONFIRMABLE` 仅指「已在 OUTLINE_GENERATION 但 spec 未确认或为 None」；`OUTLINE_NOT_FOUND`（confirm/GET 无大纲）；`OUTLINE_VALIDATION_ERROR`（编辑/生成校验不过）
- [x] 4.5 单测：三态成功、GET 读回、各前置拒绝、错误状态→状态错误、重复确认重放安全、事件序列正确

## 5. Slide Planner Agent（slide-planner-agent）

- [x] 5.1 `apps/api/app/agents/slide_planner.py`：从确认的大纲逐页产出 `SlidePlan`（`visualIntent ∈ VisualIntent`），经 `LLMProvider` 运行；**`slideId` 由服务层（非 LLM）确定性赋唯一值（如 `slide-0001` 按序）**
- [x] 5.2 **仿 `build_spec` 自有有界修复循环**（不用 `generate_validated`）：`provider.generate → parse → 逐条内联 validateSlidePlan + 集合级 slideId 唯一性 + 总页数 ≤ 上限`；耗尽后抛 `SlidePlanValidationError`→`SLIDE_PLAN_VALIDATION_ERROR`(400)；Provider 传输异常→502；`estimatedSlides` 与某 section 实际页数不符时，生成期向该 section 首页追加软 `riskNote`，不硬失败、不事后重算
- [x] 5.3 `MockLLMProvider` 增决定性规划响应
- [x] 5.4 单测：决定性输出、`visualIntent` 越界修复/拒绝、超上限拒绝、Provider 失败处理

## 6. Slide Plan API（slide-plan-api）

- [x] 6.1 `apps/api/app/slide_plan.py` 服务层：`generate`（前置 `state==SLIDE_PLANNING` + **`outline is not None and outline.get("confirmedByUser")`**，dict 访问、None-safe 否则 `SLIDE_PLAN_NOT_CONFIRMABLE`；服务赋 slideId、**整体覆盖** `slidePlans`、置 `slidePlansConfirmed=false`）、`update`（单页，前置 `state∈{SLIDE_PLANNING,SLIDE_PLAN_REVIEW}` 且路径 `slideId` 存在+校验；**服务强制该页 slideId=路径值、忽略 body id、覆盖后重校验集合唯一性**；置 `slidePlansConfirmed=false`）、`confirm`（`state==SLIDE_PLAN_REVIEW`+**非空**规划；置 `slidePlansConfirmed=true`，不推进状态）
- [x] 6.2 `routes.py` 挂载 `POST /slides/plans/generate`、`PUT /slides/{slideId}/plan`、`POST /slides/plans/confirm`、`GET /slides/plans`
- [x] 6.3 事件 validate-before-append：`SLIDE_PLAN_GENERATED`（payload 含 `slideCount`+`slideIds`+`nextState`）/`SLIDE_PLAN_UPDATED`（`slideId`+`nextState`）/`SLIDE_PLAN_CONFIRMED`（`slideCount`+`nextState`）
- [x] 6.4 错误分层：错误状态→`INVALID_STATE_TRANSITION`（抛出点清除默认 `field="to"`，见 7.1）；`SLIDE_PLAN_NOT_CONFIRMABLE`（大纲未确认或为 None）、`SLIDE_PLAN_NOT_FOUND`（未知 slideId / confirm/GET 无规划或为空）、`SLIDE_PLAN_VALIDATION_ERROR`
- [x] 6.5 单测：三态成功、GET 读回、各前置拒绝、未知 slideId 拒绝、**重新生成整体覆盖并作废确认/编辑**、重复确认重放安全、事件序列正确

## 7. 错误约定（errors.py）

- [x] 7.1 `apps/api/app/errors.py` 新增 `OUTLINE_NOT_FOUND`/`OUTLINE_NOT_CONFIRMABLE`/`OUTLINE_VALIDATION_ERROR`/`SLIDE_PLAN_NOT_FOUND`/`SLIDE_PLAN_NOT_CONFIRMABLE`/`SLIDE_PLAN_VALIDATION_ERROR`，**均作为既有基类的子类**（`*_VALIDATION_ERROR`←`ValidationError`/400、`*_NOT_FOUND`←`NotFoundError`/404、`*_NOT_CONFIRMABLE`←`StateError`/409）；HTTP 状态经 `main.py::_STATUS_BY_ERROR` 按 `DomainError.error` 分组映射，**复用既有分组、无需改 `main.py` 状态表**；复用 `LLM_PROVIDER_ERROR`(502)。**动作端点错误状态复用 `InvalidStateTransitionError`——因其类默认 `field="to"`（`DomainError.__init__` 仅在 `field is not None` 时赋值，故 `field=None` 不会覆盖类默认），抛出点须显式清除**（构造后置 `err.field=None`，或加一个不带 `field` 的 `StateError` 子类）——一行调整
- [x] 7.2 单测：每个新码经统一 `{error,code,details}` 信封与正确 HTTP 状态返回

## 8. 测试、文档与验证

- [x] 8.1 端到端 pytest（mock LLM）：全链路 `确认 Spec →[transition]→ OUTLINE_GENERATION → generate → [transition]→ OUTLINE_REVIEW → confirm →[transition]→ SLIDE_PLANNING → plans/generate →[transition]→ SLIDE_PLAN_REVIEW → confirm`；并断言 **None-safe 回退**（只转移不生成到达空态后回退不崩溃）、**回退清空下游 + `slidePlansConfirmed` 重置**、**重新生成整体覆盖作废确认/编辑**、**重复确认重放安全**、错误状态→状态错误、事件序列与 payload
- [x] 8.2 `docs/API.md`（大纲/规划端点含 GET，从 Draft 落为已实现）、`docs/AGENTS.md`（Outline/Slide Planner 输入输出 + slideId 由服务赋值）、`docs/WORKFLOW.md`（新增前向/回退边与 None-safe 清空）、`docs/DATA_MODEL.md`（6 个新事件类型及其 payload 字段）更新
- [x] 8.3 `docs/ROADMAP_PROGRESS.md` 更新 Phase 5 状态
- [x] 8.4 `pnpm --filter @ppt-pilot/shared-schema` 校验 + `apps/api` pytest + `main.py --selfcheck` 全绿；无 Phase 1–4 回归
- [x] 8.5 运行 `openspec-cn validate phase-5-outline-and-slide-planning` 确认产物一致，准备实现/归档
