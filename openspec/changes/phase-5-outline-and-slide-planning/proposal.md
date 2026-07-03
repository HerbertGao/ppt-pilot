## 为什么

Phase 3 交付了需求澄清与 Spec Builder（可确认的 `PresentationSpec`），Phase 4 让用户在浏览器里走通到复核确认。但确认后项目**停留在 `REQUIREMENT_REVIEW`**：后端 `TRANSITION_EDGES` 只有 `NEW→DISCOVERY→REVIEW`（+ 回退），`OUTLINE_GENERATION`/`OUTLINE_REVIEW`/`SLIDE_PLANNING`/`SLIDE_PLAN_REVIEW` 这些状态在 enum 里存在但**无前向边**（Phase 2 刻意把「有内容前置的边」留给归属阶段）。产品「先结构、后内容」的核心——从确认的 Spec 生成**可编辑的大纲**、再逐页产出**结构化 Slide Plan**（objective / key message / visual intent / layout）——目前完全缺失。

本变更实现 Phase 5：在确认的 Spec 之上生成大纲与逐页规划，作为 Phase 6（HTML 预览渲染）与 Phase 7（内容/导出）的结构前置。**本期为后端 + 共享 schema**（延续 Phase 3 的 agent-behind-interface 模式，复用 `LLMProvider`、**`build_spec` 式自有有界修复 + 内联校验**、事件 validate-before-append）；不含前端界面（大纲/规划的 Web 消费归属后续阶段，见非目标）。

## 变更内容

- **Outline Agent（新）**：消费确认的 `PresentationSpec`（scene/style/questionPolicy/riskNotes/已知需求），经 `LLMProvider` 文本接口产出结构化大纲 `{sections:[{title,purpose,estimatedSlides}]}`（section 无 slideId 列表），经 shared-schema 校验；隐藏在接口后，默认 `MockLLMProvider`（CI 无网络）。
- **Slide Planner Agent（新）**：消费**已确认**的大纲，逐 section 产出 `SlidePlan[]`（`slideId/title/objective/keyMessage/contentIntent/visualIntent∈{diagram,image,chart,text,comparison,timeline}/layoutSuggestion/requiredAssets/riskNotes`），经 schema 校验。
- **Outline API（新）**：`POST /outline/generate`、`PUT /outline`（人工编辑）、`POST /outline/confirm`、`GET /outline`（读持久化产物）；驱动 `REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW`（前向转移由显式 `transitions` 驱动，沿用 Phase 2 边表语义）。生成/编辑/确认各追加经校验的事件。generate 要求 Spec 已确认（`confirmedByUser`）否则 `OUTLINE_NOT_CONFIRMABLE`。
- **Slide Plan API（新）**：`POST /slides/plans/generate`、`PUT /slides/{slideId}/plan`（人工编辑单页，`slideId` 由服务层赋值）、`POST /slides/plans/confirm`、`GET /slides/plans`；驱动 `OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW`。规划确认态存于项目级 `slidePlansConfirmed`（`SlidePlan` 无 schema 确认字段）。要求大纲先确认否则 `SLIDE_PLAN_NOT_CONFIRMABLE`。
- **共享 schema 扩展（改）**：新增 canonical `Outline`/`OutlineSection` 类型（当前缺失，需登记进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`）、`VisualIntent` 枚举、以及大纲/规划 `EVENT_TYPES`（`OUTLINE_GENERATED`/`OUTLINE_UPDATED`/`OUTLINE_CONFIRMED`/`SLIDE_PLAN_GENERATED`/`SLIDE_PLAN_UPDATED`/`SLIDE_PLAN_CONFIRMED`，含 payload 校验、`validateEventPayload` **fail-closed**）；`validation.ts` 增加 `Outline`/`SlidePlan`/新事件校验。**注意 `SlidePlan.visualIntent` 由自由 `string` 收紧为 `VisualIntent` 枚举——这是对既有校验的语义收紧（非纯加法），以 MODIFIED 需求表达并加 invalid fixture 锁定**；`validation-constants` 暴露 section/slide 数量上限。
- **工作流状态机扩展（改）**：向 `TRANSITION_EDGES` 加入 Phase 2 延后的前向边——`REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW`——及各自的回退边（`OUTLINE_GENERATION→REQUIREMENT_REVIEW`、`OUTLINE_REVIEW→OUTLINE_GENERATION`、`SLIDE_PLANNING→OUTLINE_REVIEW`、`SLIDE_PLAN_REVIEW→SLIDE_PLANNING`）；转移保持 LLM-free 且结构化，回退 **None-safe** 清空对应下游产物。无内容态可达但**无害**（动作端点各自守卫、回退 None-safe），取代早期「无内容非法态不可达」的过强表述。
- **错误约定扩展**：新增 `OUTLINE_NOT_FOUND`、`OUTLINE_NOT_CONFIRMABLE`、`SLIDE_PLAN_NOT_FOUND`、`SLIDE_PLAN_NOT_CONFIRMABLE`、`OUTLINE_VALIDATION_ERROR`/`SLIDE_PLAN_VALIDATION_ERROR`；沿用 `LLM_PROVIDER_ERROR`(502) 与统一 `{error,code,details}` 信封与 HTTP 映射。

非目标：

- **不做任何前端界面**（大纲/规划的 Web 编辑/展示归属后续前端阶段；本期与 Phase 3 一样是后端 + schema）。
- 不做 HTML 预览渲染 / Slide JSON 元素模型 / 缩略图（Phase 6）。
- 不做内容生成、文生图、导出（Phase 7+）。
- 不实现 `SlideStatus` 生命周期的 `generated/reviewed/locked` 流转（本期只到 `planned`）。
- 不改 Phase 3 的需求澄清/Spec 契约；不改 `LLMProvider` 接口（仅复用）。
- 不做锁定/版本/局部再生的运行时（锁字段随 schema 存在但本期不驱动）。

## 功能 (Capabilities)

### 新增功能

- `outline-agent`: Outline Agent——从确认的 `PresentationSpec` 生成结构化大纲（sections），经 `LLMProvider` 运行、schema 校验、有界修复；纯后端瞬时/持久产物。
- `outline-api`: 大纲 HTTP 端点（generate/update/confirm/**get**）+ `REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW` 前向转移 + 大纲事件发射（validate-before-append）+ 确认前置（Spec 已确认）与错误映射。
- `slide-planner-agent`: Slide Planner Agent——从确认的大纲逐页生成 `SlidePlan`（objective/keyMessage/visualIntent/layout/…），schema 校验、有界修复。
- `slide-plan-api`: Slide Plan HTTP 端点（generate/update/confirm/**get**）+ `OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW` 前向转移 + slide-plan 事件发射 + 大纲已确认前置与错误映射。

### 修改功能

- `shared-schema-contract`: 新增 `Outline`/`OutlineSection` 类型与 `VisualIntent` 枚举、大纲/规划 `EVENT_TYPES`；`validation` 增加 Outline/SlidePlan/新事件 payload 校验；constants 暴露相关约束上限。
- `workflow-state-machine`: 向 `TRANSITION_EDGES` 加入 Phase 2 延后的大纲/规划前向边与回退边；转移保持 LLM-free 且结构化，回退 None-safe 清空对应下游产物；无内容态可达但无害（动作端点各自守卫、回退与内容前置均 None-safe），状态机一致性断言仍成立。

## 影响

- 后端路由（API）
  - `apps/api/app`：新增 `outline.py`、`slide_plan.py`（服务层，仿 `requirements.py`）；`routes.py` 挂载新端点；`workflow.py` 扩充 `TRANSITION_EDGES` 与回退清空逻辑；`errors.py` 新增错误码与 HTTP 映射；`agents/` 新增 `outline`、`slide_planner`（+ prompts/policy/models），仿 `spec_builder.py::build_spec` 的自有有界修复+内联校验循环、复用 `llm`（不复用 `_generate.generate_validated`，其校验失败归 502 与本处需要的 400 冲突）。
- 代理（agent）
  - 新增 Outline / Slide Planner 两个 agent，隐藏在既有 `LLMProvider` 接口后；默认 mock，`LLM_PROVIDER=openrouter` 走真实。
- 模式（schema）
  - `packages/shared-schema/src`：`types.ts` 加 `Outline`/`OutlineSection`；`enums.ts` 加 `VisualIntent` 与新 `EVENT_TYPES`；`validation.ts` 加校验；`validation-constants.ts` 加上限；fixtures 增补样例并纳入 `schema-validation-fixtures` 校验。
- 事件（event）
  - 新增大纲/规划事件类型，运行时经既有 event-log「validate-before-append」发射；前端不直接写。
- 工作流（workflow）/ 锁定（lock）/ 版本（version）
  - 扩充前向/回退边；锁定与版本运行时仍不实现（非目标）。
- CI / 依赖
  - 沿用分层 CI：`shared-schema` gate（类型+fixtures）、`api` gate（pytest + selfcheck）、`docs/OpenSpec` gate；无新依赖（后端仅标准库 + 既有；schema 仅 TS）。
- 文档
  - 实现后更新 `docs/ROADMAP_PROGRESS.md`（Phase 5 状态）、`docs/API.md`（大纲/规划端点从 Draft 落为已实现）、`docs/AGENTS.md`（Outline/Slide Planner 输入输出契约）、`docs/WORKFLOW.md`（新增前向/回退边）。
- 验证方式
  - `shared-schema` 类型编译 + fixtures 通过；`api` pytest 覆盖两 agent 的 mock 决定性输出、有界修复、生成/编辑/确认三态、前向转移与前置校验、回退清空下游、各错误态；`main.py --selfcheck` 断言新边的状态机一致性；真实 LLM 冒烟（OpenRouter）可选。
