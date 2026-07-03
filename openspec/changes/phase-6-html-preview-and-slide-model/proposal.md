## 为什么

Phase 5 交付了确认的 `SlidePlan[]`（逐页 objective/keyMessage/contentIntent/visualIntent/layoutSuggestion），项目停在 `SLIDE_PLAN_REVIEW`。但「先结构、后内容」的产品链缺少下一环：把确认的规划变成**可预览的结构化幻灯片模型**，并证明这套结构化模型能渲染出一致的预览——这也是 Phase 7（PPTX 导出）与后续画布编辑要共同消费的**唯一真相源**（`Presentation`/`Slide`/`Element`，PPTX 不是源）。

shared-schema 已有 canonical `Presentation`/`Slide`/`Element` 类型与 `validatePresentation`/`validateSlide`/`validateElement` 校验（Phase 1 预留），但从未被消费；`packages/ppt-engine` 是空占位包（README 声明「预留 slide model / layout model / rendering helpers」）。

本变更实现 Phase 6：从确认的 `SlidePlan[]` **确定性地物化**结构化 `Slide[]`/`Presentation`（含基础主题 token 与基础布局），并在 `ppt-engine` 实现**消费同一模型的 HTML 预览渲染器**与缩略图占位、渲染器 fixtures。**本期不生成真实内容、不接 LLM**——物化产出的是从规划派生的**结构占位**（标题/正文占位/视觉占位框），证明「确认的规划能变成可预览的结构化幻灯片」。

## 变更内容

- **幻灯片物化（新，后端 Python，无 LLM、本期无 Asset）**：`POST /projects/{id}/slides/materialize`——从**已确认**的 `SlidePlan[]` + **已确认**的 `PresentationSpec` 确定性物化 `Presentation`：每页 `Slide` 携结构 `Element[]`（`title` 文本 ← plan.title/keyMessage；`body` 文本占位 ← objective/contentIntent；一个**视觉占位元素**，`ElementType` 按 `visualIntent` 映射：diagram→diagram / chart→chart / **comparison|timeline|image→shape**（`image` 本期落 `shape`——`validateElement` 强制 image 元素带 `content.assetId` 而本期无 Asset）/ text→无视觉元素）；几何由 `layoutSuggestion` 经**基础布局 token** 确定性给定；`Presentation.theme` = scene/styleProfile 派生的 `ThemeTokens`。**必须满足既有 `validateSlide`/`validatePresentation` 的所有跨字段不变量**（**`presentation.spec` 嵌入已确认 `PresentationSpec`（`project.spec`）**、`scene==spec.scene`、`slide.id==plan.slideId`、`element.slideId==slide.id`、`slide.title=plan.title??keyMessage`、1-based `index`、`status="planned"`、物化副本 `requiredAssets=[]`、`assets=[]`、**确定性时间戳**）；**持久化前先 `validateEntity("ThemeTokens", theme)` 再 `validateEntity("Presentation", presentation)`**（后者兜底全量跨引用校验；theme 松散故需单独显式校验），不过 → `SLIDE_VALIDATION_ERROR`/400 零持久化。前置：`state==SLIDE_GENERATION` 且 **`spec` 已确认（None-safe）** 且规划非空已确认，否则 `SLIDES_NOT_MATERIALIZABLE`。驱动 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION`（显式 `transitions`）；追加经校验的 `SLIDES_MATERIALIZED`；不推进状态；整体覆盖、重放安全。
- **HTML 预览渲染器（新，`packages/ppt-engine` TS）**：纯函数 `renderSlide(slide, theme) → HTML` 与 `renderPresentation(presentation) → HTML`，消费 shared-schema 的 `Slide`/`Presentation` 模型；主题 token → CSS（经**CSS 属性白名单 + 值清洗**）；**上下文感知转义**（文本上下文 HTML 转义、属性上下文属性转义、CSS 上下文白名单清洗——仅文本转义不足以护 CSS/属性）；**确定性 key 排序**保证 fixtures 稳定；**缩略图为确定性占位**（内联 SVG/data-uri，不引 headless browser）。**渲染器 fixtures**：golden「模型 → 期望 HTML/结构」锁定。这是「与导出共享的同一结构化模型」（Phase 7 PPTX 读同一 `Slide` 模型）。
- **读端点**：`GET /projects/{id}/presentation` 读物化的完整 `Presentation`（含 slides/elements/theme）；不存在时明确错误。
- **共享 schema 扩展（改）**：新增 `ThemeTokens` 类型与 `validateThemeTokens`（palette/font/spacing 基础 token，登记进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`/`runtimeValidationEntrypoints`）+ **单个**物化事件 `SLIDES_MATERIALIZED`（fail-closed payload 校验；**不加 `PRESENTATION_UPDATED`**——本期无发射方）；**复用**既有 `Presentation`/`Slide`/`Element` 校验，不改其行为（`validatePresentation` 对 theme 松散 → theme 的 ThemeTokens 合法性由物化服务显式校验）。
- **工作流状态机扩展（改）**：向 `TRANSITION_EDGES` 加入 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 前向边与回退边 `SLIDE_GENERATION→SLIDE_PLAN_REVIEW`（回退 None-safe 清空 `presentation`）；`SLIDE_GENERATION` 之后（`EDITING`/`REVIEW`/`EXPORT_READY`/`EXPORTED`）仍不加。
- **错误约定扩展**：`PRESENTATION_NOT_FOUND`(404)、`SLIDES_NOT_MATERIALIZABLE`(409，规划未确认/为空)、`SLIDE_VALIDATION_ERROR`(400)。

非目标：

- **不做真实内容生成**（Content Agent §9）、**不做 Layout Agent**（§10，本期仅确定性基础布局 token）、**不做 Image Agent / 文生图**（§11，视觉元素为占位框）。
- **不做真实缩略图光栅化**（headless browser/截图）——缩略图为确定性占位/路径。
- **不做前端预览页面**（渲染器 + fixtures 为交付物；把 `ppt-engine` 渲染器接进 Next.js 页面属后续前端阶段，如 Phase 4 承接 Phase 3）。
- **不做画布编辑/元素拖拽**（Phase 8）、**不做 PPTX 导出**（Phase 7）、**不实现锁定/版本运行时**（锁字段随 schema 存在但本期不驱动）。
- 不改 Phase 3/5 契约；`SlideStatus` 本期只到结构物化态，不驱动 `generated/reviewed/locked` 内容生命周期。

## 功能 (Capabilities)

### 新增功能

- `slide-materialization`: 后端从确认的 `SlidePlan[]` 确定性物化 `Presentation`/`Slide[]`（结构占位元素 + 基础布局 + 主题 token）、`materialize`/`GET presentation` 端点、`SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 前向转移、物化事件（validate-before-append）、确认前置与错误映射。无 LLM。
- `html-preview-renderer`: `packages/ppt-engine` 的纯 TS 渲染器（`renderSlide`/`renderPresentation` → HTML，消费同一 `Slide`/`Presentation` 模型）+ 主题 token → CSS + 缩略图占位 + 渲染器 golden fixtures。

### 修改功能

- `shared-schema-contract`: 新增 `ThemeTokens` 类型与校验、物化 `EVENT_TYPES` 与 fail-closed payload 校验；复用既有 `Presentation`/`Slide`/`Element` 校验（不改行为）。
- `workflow-state-machine`: 加入 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 前向 + `SLIDE_GENERATION→SLIDE_PLAN_REVIEW` 回退边（None-safe 清空 `presentation`）。

## 影响

- 后端路由（API）/ 代理（agent）
  - `apps/api/app`：新增 `presentation.py`（物化服务，仿 `slide_plan.py`，**无 agent/LLM**）；`routes.py` 挂 `materialize`/`GET presentation`；`workflow.py` 扩边表 + None-safe 回退清空；`errors.py` 新错误码；`repository.py`/`StoredProject` 增 `presentation` 字段。
- 引擎（ppt-engine）
  - `packages/ppt-engine`：从空占位建成 TS 包（package.json、渲染器、主题→CSS、缩略图占位、fixtures、typecheck/test 脚本）；消费 `@ppt-pilot/shared-schema` 类型。
- 模式（schema）
  - `packages/shared-schema/src`：`types.ts` 加 `ThemeTokens`；`enums.ts` 加 `SLIDES_MATERIALIZED`（单个）；`validation.ts` 加 `validateThemeTokens` + 事件 case（fail-closed）+ 登记 `ThemeTokens` 进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`/`runtimeValidationEntrypoints`；fixtures 增补（含一份**物化输出形态**的完整 `Presentation` 作跨语言共享 golden）；**复用** `validatePresentation`/`validateSlide`/`validateElement`。
- 工作流（workflow）/ 锁定 / 版本
  - 扩前向/回退边；锁定与版本运行时仍不实现。
- CI / 依赖
  - 分层 CI 新增 **ppt-engine gate**（typecheck + renderer fixtures/test），或并入 shared-schema/Web 层；后端无新依赖；ppt-engine 仅 TS + shared-schema。
- 文档
  - 实现后更新 `docs/ROADMAP_PROGRESS.md`、`docs/ARCHITECTURE.md`（ppt-engine 渲染器落地）、`docs/DATA_MODEL.md`（ThemeTokens + 物化事件 + Slide/Element 物化语义）、`docs/WORKFLOW.md`（新增边）。
- 验证方式
  - shared-schema 类型 + fixtures 通过；`apps/api` pytest 覆盖物化三态/前置/回退清空/事件/错误；ppt-engine typecheck + renderer golden fixtures（模型→HTML 确定性）通过；`main.py --selfcheck` 断言新边一致性；全程无 LLM、无网络。
