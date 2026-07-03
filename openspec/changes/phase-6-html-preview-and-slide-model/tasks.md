## 1. 共享 schema 扩展（shared-schema-contract）

- [x] 1.1 `packages/shared-schema/src/types.ts` 新增 canonical `ThemeTokens { palette: Record<string,string>, fonts: Record<string,string>, spacing: Record<string,number|string> }`（基础 token；不改既有类型）
- [x] 1.2 `enums.ts` 新增 `EVENT_TYPES`：**仅 `SLIDES_MATERIALIZED`**（不加 `PRESENTATION_UPDATED`——本期无发射方；与 1.3 的 payload case 同批提交，避免 fail-open 漏写）
- [x] 1.3 `validation.ts` 新增 `validateThemeTokens`（palette/fonts/spacing 齐备）并登记 `ThemeTokens` 进 `ENTITY_NAMES`（`validation-constants.ts`）/ `EntityMap` / `validateEntity` 分发 / **`runtimeValidationEntrypoints`**（`satisfies Record<EntityName,string>`，缺键 typecheck 失败）；`validateEventPayload` 加 `SLIDES_MATERIALIZED` case（`{slideCount:int min 1, nextState∈WORKFLOW_STATES}`）并保持 **fail-closed** default；**复用**既有 `validatePresentation`/`validateSlide`/`validateElement`，不改其行为（注意 `validatePresentation` 对 theme 松散——不改它）
- [x] 1.4 新增 fixtures：`ThemeTokens` valid/invalid、**一份「物化输出形态」的完整 `Presentation`（`assets=[]`、每页 `requiredAssets=[]`、`slide.id==plan.slideId`、`element.slideId==slide.id`、1-based `index`、无 image 元素、确定性时间戳）valid**（同时用作 §4.6 跨语言共享 golden）、`SLIDES_MATERIALIZED` 事件 valid/invalid；纳入 `schema-validation-fixtures`；确认 Phase 1–5 既有 fixtures 零回归
- [x] 1.5 验收：`pnpm --filter @ppt-pilot/shared-schema typecheck` 与 fixtures 校验通过

## 2. 工作流边表与回退清空（workflow-state-machine）

- [x] 2.1 `apps/api/app/workflow.py` 向 `TRANSITION_EDGES` 加入前向边 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 与回退边 `SLIDE_GENERATION→SLIDE_PLAN_REVIEW`；`SLIDE_GENERATION` 之后仍不加
- [x] 2.2 `execute_transition` 内 None-safe 回退清空：`SLIDE_GENERATION→SLIDE_PLAN_REVIEW` 清 `project.presentation`（`None` 时 no-op，禁止解引用）；**保留** `slidePlans`/`slidePlansConfirmed`（规划未作废）
- [x] 2.3 `repository.py`/`StoredProject` 增字段 `presentation: Any|None=None`（经 `validateEntity` 规范化的 dict）
- [x] 2.4 保持边表 LLM-free 且结构化（前向边不加内容守卫）；`assert_state_machine_consistent` 仍成立
- [x] 2.5 `main.py --selfcheck` 增断言：`SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 可走且追加事件；「只转移不物化」到达空 `presentation` 态后回退 None-safe 不崩溃；`SLIDE_GENERATION→EDITING`（及 `→EXPORT_READY`）仍 `INVALID_STATE_TRANSITION` 无副作用

## 3. 后端物化服务 + API + 错误（slide-materialization）

- [x] 3.1 `apps/api/app/presentation.py` 服务层（仿 `slide_plan.py`，**无 agent/LLM**）：`materialize`（前置 `state==SLIDE_GENERATION` 且 **`spec is not None and spec.get("confirmedByUser")`**（None-safe，物化需 spec 的 scene/style 且 `scene==spec.scene`）且 `slidePlans` 非空 + `slidePlansConfirmed`，否则 `SLIDES_NOT_MATERIALIZABLE`）从确认 `SlidePlan[]`+确认 spec 确定性物化 `Presentation`（逐页 `Slide` + title/body/视觉占位 `Element[]` + 基础布局 token 几何 + `ThemeTokens` 主题）
- [x] 3.2 视觉意图→`ElementType` 确定性映射（chart/diagram→同名，**comparison/timeline/image→shape**（image 本期落 shape，无 Asset），text→无视觉元素）；`layoutSuggestion`→基础布局模板（有限模板→确定性 x/y/width≥0/height≥0/zIndex 整数），未知 → 默认模板 + 软提示不失败；`Element` 必填字段确定性填全；**满足 `validateSlide`/`validatePresentation` 跨字段不变量：`presentation.spec` 嵌入已确认 `PresentationSpec`（`project.spec`）、`slide.id==plan.slideId`、每个 `element.slideId==slide.id`、`index` 从 1 递增、`status="planned"`、`slide.title=plan.title??plan.keyMessage`（顶层非空）、`slide.plan` 副本置 `requiredAssets=[]`、`presentation.assets=[]`、`presentationId==presentation.id`、`scene==spec.scene`、确定性时间戳（非 wall-clock）**
- [x] 3.3 **持久化前先 `validateEntity("ThemeTokens", theme)` 再 `validateEntity("Presentation", presentation)`**（全量跨引用校验；theme 松散故单独显式校验）（任一不过 → `SLIDE_VALIDATION_ERROR`/400，零持久化）；**整体覆盖** `project.presentation`；不推进状态；重复物化重放安全
- [x] 3.4 `routes.py` 挂 `POST /slides/materialize`、`GET /presentation`（读持久化，无则 `PRESENTATION_NOT_FOUND`）
- [x] 3.5 事件 validate-before-append：`SLIDES_MATERIALIZED`（payload `{slideCount, nextState}`）；失败零持久化
- [x] 3.6 `errors.py` 新增 `PRESENTATION_NOT_FOUND`(←NotFoundError/404)、`SLIDES_NOT_MATERIALIZABLE`(←StateError/409)、`SLIDE_VALIDATION_ERROR`(←ValidationError/400)；错误状态调用→`INVALID_STATE_TRANSITION`（抛出点清 `field="to"`）；无需改 `main.py` 状态表
- [x] 3.7 单测：物化成功（逐页元素/主题/事件）、GET 读回、规划未确认/为空/None-safe 拒绝、错误状态→状态错误、`Slide` 校验失败零持久化、重复物化整体覆盖重放安全、回退清空 presentation

## 4. ppt-engine 渲染器（html-preview-renderer）

- [x] 4.1 `packages/ppt-engine` 建成 TS 包：`package.json`（`@ppt-pilot/ppt-engine`，依赖 `@ppt-pilot/shared-schema`，`typecheck`/`test`/`build` 脚本）、`tsconfig`
- [x] 4.2 `src/render.ts`：纯函数 `renderSlide(slide, theme)` / `renderPresentation(presentation)` → HTML，按 `Element` 类型/几何/`zIndex`/`style` 布局；无 I/O、无 DOM、无网络、确定性
- [x] 4.3 **上下文感知转义**（信任边界，不止文本）：文本上下文 HTML 转义（`< > & " '`）、属性上下文属性转义；含特殊字符/危险构造样例
- [x] 4.4 `src/theme.ts`：`ThemeTokens`/`element.style`→CSS 经 **CSS 属性白名单 + 值清洗**（拒绝/剥离 `expression(...)`/`url(...)`/`</style>` 等，不透传任意 CSS）；**对象键确定性顺序**遍历（固定/排序）保证 fixtures 稳定；视觉占位元素渲染为带类型标注的占位框（不请求外部资源）
- [x] 4.5 `src/thumbnail.ts`：每页确定性缩略图占位（内联 SVG/data-uri，含尺寸/页码/标题占位），**不引 headless browser**
- [x] 4.6 renderer golden fixtures + runner（零重依赖，`node --test` 或 mjs 断言）：模型→期望 HTML/结构确定性、token 可区分、含特殊字符转义 + CSS 危险值清洗样例、缩略图占位、**两次渲染同一模型输出一致（确定性 key 序）**；**其中一份 golden 使用 shared-schema 里那份「物化输出形态」的完整 `Presentation`（跨语言共享 golden，捕获 Python 物化↔TS 渲染的字段/形状漂移）**
- [x] 4.7 验收：`pnpm --filter @ppt-pilot/ppt-engine typecheck` 与 renderer fixtures/test 通过

## 5. 测试、文档与验证

- [x] 5.1 端到端 pytest（无 LLM/网络）：`确认规划 →[transition]→ SLIDE_GENERATION → materialize → GET presentation`，断言**物化的 `Presentation` 通过 `validateEntity("Presentation")` 全量校验**（逐页 `Slide`/`Element`/`theme`、id 链、`scene==spec.scene`、`requiredAssets=[]`/`assets=[]`）、image 意图落 shape、事件序列、Spec 未确认/None-safe 拒绝、回退清空 presentation、错误状态→状态错误、未物化 GET→404
- [x] 5.2 分层 CI 加 **ppt-engine gate**（typecheck + renderer fixtures/test），或并入既有 TS/shared-schema 门；`Detect changed areas` 覆盖 `packages/ppt-engine`
- [x] 5.3 `docs/ARCHITECTURE.md`（ppt-engine 渲染器落地）、`docs/DATA_MODEL.md`（`ThemeTokens` + 物化事件 + Slide/Element 物化语义 + 占位约定）、`docs/WORKFLOW.md`（`SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 前向/回退 + None-safe 清空）更新
- [x] 5.4 `docs/ROADMAP_PROGRESS.md` 更新 Phase 6 状态
- [x] 5.5 `pnpm --filter @ppt-pilot/shared-schema` 校验 + `pnpm --filter @ppt-pilot/ppt-engine` typecheck/test + `apps/api` pytest + `main.py --selfcheck` 全绿；无 Phase 1–5 回归
- [x] 5.6 运行 `openspec-cn validate phase-6-html-preview-and-slide-model` 确认产物一致，准备实现/归档
