## 上下文

Phase 5 交付确认的 `SlidePlan[]`（存于 `StoredProject.slidePlans`/`slidePlansConfirmed`），项目停在 `SLIDE_PLAN_REVIEW`。shared-schema 已有 canonical `Presentation`/`Slide`/`Element` 类型 + `validatePresentation`/`validateSlide`/`validateElement`（登记在 `ENTITY_NAMES`/`EntityMap`/`validateEntity`），本期首次消费它们。后端沿用 Phase 5 基座（`presentation.py` 仿 `slide_plan.py`）。`packages/ppt-engine` 是空占位包。

**关键：既有校验器的硬约束（本期物化必须满足，D8 禁止改动它们）**（truth: `validation.ts`）：
- `validateElement`：`type==="image"` **强制** `content.assetId` 非空字符串（`:858`）；必填 id/slideId/type/content/x/y/width(min0)/height(min0)/rotation/zIndex(int)/style/metadata + LockFields。
- `validateSlide`：`slide.id === plan.slideId`（`:971`）、每个 `element.slideId === slide.id`（`:979`）、`index` 整数 **≥1（1-based）**、必填 presentationId/status∈SLIDE_STATUSES/createdAt/updatedAt/嵌入完整 `plan`。
- `validatePresentation`：`scene === spec.scene`（`:1074`）、每个 `slide.presentationId === presentation.id`（`:1082`）、每个 `slide.plan.requiredAssets[i]` 必须存在于 `$.assets`（`:1098`）、image 元素 `content.assetId` 必须存在于 `$.assets`（`:1117`）；`theme` 仅 `readRequiredObject`（**松散 JsonObject，不校验为 ThemeTokens**，`:1066`）。`SlidePlan.requiredAssets` 为必填数组（可空）。

Phase 6 把确认的规划**确定性物化**为可预览模型，**无 LLM、无网络、本期无 Asset**，并在 ppt-engine 实现消费同一模型的 HTML 渲染器。

## 目标 / 非目标

**目标：** 确认的 `SlidePlan[]` → 确定性、**通过 `validateEntity("Presentation")` 与 `validateEntity("ThemeTokens")`** 的 `Presentation`（结构占位元素 + 基础布局 + 主题 token）；ppt-engine 纯函数 HTML 渲染器（**上下文感知转义**）+ 缩略图占位 + golden fixtures；打通 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION`（+ None-safe 回退）。

**非目标：** Content/Layout/Image Agent、真实 Asset/文生图、真实缩略图光栅化、前端预览页、画布编辑（Phase 8）、PPTX 导出（Phase 7）、锁定/版本运行时。

## 决策

### D1：视觉占位元素——`image` 意图本期映射为 `shape`（本期无 Asset）

视觉占位元素的 `ElementType` 由 `visualIntent` 确定性映射：`chart→chart`、`diagram→diagram`、`comparison`/`timeline`/**`image`→`shape`**、`text→无视觉元素`。**`image` 意图本期落 `shape`**——因 `validateElement` 强制 image 元素带 `content.assetId`，而本期不产 Asset（Image Agent 属后续），若落 `image` 则 `validateSlide` 必失败；落 `shape` 占位框、`content` 标注意图（如 `{placeholder:"image"}`）既合法又语义清晰。`image→image` 保留给后续 Image-Agent 阶段（那时真造 Asset）。
- 备选：为 image 占位合成假 `assetId` → 否决：制造悬挂 asset 引用，`validatePresentation` 的 `assetId↔$.assets` 交叉校验必失败。

### D2：渲染器在 `ppt-engine`（TS 纯函数 + golden fixtures），与导出共享同一模型

`renderSlide(slide, theme)`/`renderPresentation(presentation)` 为纯函数（无 I/O/DOM/网络、确定性），消费 shared-schema `Slide`/`Presentation`。这是 Phase 7 PPTX 导出将读的**同一模型**。渲染器不调后端。

### D3：主题 token 由 scene 确定性派生**并显式校验**（styleProfile 主题化后续接入）

`ThemeTokens { palette, fonts, spacing }` 由 scene + styleProfile 确定性映射，写入 `Presentation.theme`。**因 `validatePresentation` 对 `theme` 只做松散 `readRequiredObject`（不校验 ThemeTokens），物化必须在持久化前显式 `validateEntity("ThemeTokens", theme)`**（不过 → `SLIDE_VALIDATION_ERROR`/400）——否则 ThemeTokens 契约在写路径上无运行时约束。

### D4：工作流 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` + None-safe 回退

`TRANSITION_EDGES` 增前向 `SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 与回退 `SLIDE_GENERATION→SLIDE_PLAN_REVIEW`。转移 LLM-free、结构化、无内容守卫（沿用「无内容态可达但无害」）。内容前置在 `materialize`。回退 None-safe 清空 `project.presentation`、**保留** `slidePlans`/`slidePlansConfirmed`；`SLIDE_GENERATION` 之后不加边。

### D5：物化服务——前置（含 spec 已确认 None-safe）+ 持久化前校验完整 Presentation

- `POST /projects/{id}/slides/materialize` 前置：`state==SLIDE_GENERATION` 且 **`spec is not None and spec.get("confirmedByUser")`**（None-safe，否则 `SLIDES_NOT_MATERIALIZABLE`/409——物化依赖 spec 的 scene 派生 theme 且 `validatePresentation` 要求 `scene===spec.scene`）且 `slidePlans` 非空 + `slidePlansConfirmed`（None-safe）。
- 物化装配 `Presentation`（`scene = spec.scene`；逐页 `Slide`；`theme` = 派生 ThemeTokens）。**持久化前先 `validateEntity("ThemeTokens", theme)`，再 `validateEntity("Presentation", presentation)`**（校验完整跨引用一致性，见 D6/D7）；任一不过 → `SLIDE_VALIDATION_ERROR`/400，**零持久化**。通过则**整体覆盖** `project.presentation`、追加经校验的 `SLIDES_MATERIALIZED` 事件、**不推进状态**。重复物化重放安全。
- `GET /projects/{id}/presentation`：读持久化 `Presentation`；无则 `PRESENTATION_NOT_FOUND`/404。
- 错误分层：错误状态调用 → `INVALID_STATE_TRANSITION`（抛出点清 `field="to"`）；`SLIDES_NOT_MATERIALIZABLE`；`SLIDE_VALIDATION_ERROR`；`PRESENTATION_NOT_FOUND`。事件 validate-before-append（失败零持久化）。

### D6：物化必须满足既有 `validateSlide`/`validatePresentation` 的所有跨字段不变量

物化确定性填全并满足（否则上述校验 400）：
- `presentation.id` 确定性（如 `pres_{projectId}`）；每个 `slide.presentationId == presentation.id`；`presentation.scene == spec.scene`；**`presentation.spec` 必须嵌入已确认的 `PresentationSpec`（即 `project.spec`，本身已过校验）**——`validatePresentation` 内部 `validatePresentationSpecAt(record.spec)` 强制 `spec` 为完整合法 `PresentationSpec` 且 `scene===spec.scene`；`presentation.projectId/title/theme/createdAt/updatedAt` 齐备。
- 每个 `slide.id == plan.slideId`（复用规划的 slideId）；每个 `element.slideId == slide.id`；`slide.index` **从 1 递增（1-based，整数）**；`slide.status = "planned"`（结构物化态，非 `generated`）；**`slide.title = plan.title ?? plan.keyMessage`**（`validateSlide` 要求顶层 `slide.title` 非空，`SlidePlan.title` 可选故用必填的 `keyMessage` 兜底）；`slide.plan` 嵌入源规划的**副本**。
- **`slide.plan.requiredAssets` 在物化副本中置为 `[]`**（本期无 Asset，`$.assets` 为空，保留原 requiredAssets 会触发 `validatePresentation` 的 `requiredAssets↔$.assets` 交叉校验失败；源规划的 requiredAssets 仍原样存于 `project.slidePlans`，供后续 Image-Agent 阶段消费）。
- `presentation.assets` 为 `[]`（本期无 Asset）；无 image 元素（D1 image→shape），故无 `assetId↔$.assets` 交叉引用。
- 每个 `Element` 必填字段（id/slideId/type/content/x/y/width≥0/height≥0/rotation/zIndex 整数/style/metadata + LockFields）确定性填全；几何由 `layoutSuggestion`→基础布局 token（有限模板→确定性 x/y/width/height/zIndex），未知 layout 落默认模板 + 软提示不失败。

### D7：确定性时间戳（不可用 wall-clock）

`createdAt`/`updatedAt`（Slide/Presentation 必填）必须**确定性**：实现可用固定 sentinel 常量或从确定性来源派生，**禁止 `now()`/wall-clock**——否则重复物化输出不一致、golden fixtures 不可锁。

### D8：shared-schema——复用既有实体校验 + 新增 ThemeTokens 与单个物化事件

- **复用** `validatePresentation`/`validateSlide`/`validateElement`（已注册），不改其行为（含 `theme` 的松散性——由 D3 显式补校验）。
- 新增 `ThemeTokens` 类型 + `validateThemeTokens`，登记进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`/`runtimeValidationEntrypoints`。
- 新增 `EVENT_TYPES`：**仅 `SLIDES_MATERIALIZED`**（payload `{ slideCount:int(min 1), nextState }`）；`validateEventPayload` 加 case 保持 **fail-closed**。**不加 `PRESENTATION_UPDATED`**（本期无端点发射它——更新/再生成属 Phase 8 编辑，届时由其发射方引入）。
- fixtures：`ThemeTokens` valid/invalid、一个**物化输出形态**的完整 `Presentation`（valid，供 §5 跨语言共享 golden）、`SLIDES_MATERIALIZED` 事件 valid/invalid；既有零回归。

### D9：持久化与 dict-access

`StoredProject` 增 `presentation: Any | None = None`（经 `validateEntity("Presentation")` 规范化的 **dict**——由 D5 显式全量校验保证，非仅逐 Slide）。字段经 dict 访问（`.get(...)`/`[...]`，承 Phase 5 D7 惯例）。回退清空为提交后属性写（`project.presentation = None`，None-safe）。

### D10：ppt-engine 工程化 + 上下文感知转义

- `packages/ppt-engine` 建成 TS 包（`@ppt-pilot/ppt-engine`，依赖 shared-schema，`typecheck`/`test`/`build`）。
- **渲染安全（信任边界，不可省）**：文本写入 HTML **文本上下文**须 HTML 转义；写入 **属性上下文**（如 style 值）须属性转义；`element.style`/`theme` 值写入 **CSS 上下文**须经 **CSS 属性白名单 + 值清洗**（不透传任意 CSS，防 `expression()`/`url()`/注入）。**确定性 key 排序**（渲染 CSS/属性时按固定顺序或排序遍历对象键），保证 golden fixtures 稳定。
- 缩略图为确定性占位（inline SVG/data-uri，不引 headless）。

## 风险 / 权衡

- [物化违反既有 validateSlide/validatePresentation 硬约束] → D1/D6/D7 逐条对齐既有校验器（image→shape、id 链、1-based index、requiredAssets 置空、assets 空、确定性时间戳、显式 ThemeTokens 校验）；D5 持久化前 `validateEntity("Presentation")` 全量校验兜底。
- [theme 松散不校验] → D3 显式 `validateEntity("ThemeTokens", theme)`。
- [渲染 CSS/属性注入] → D10 上下文感知转义 + CSS 白名单（不止文本转义）。
- [跨语言模型漂移未测] → §5 一份**共享 golden**：materializer 产出的 `Presentation` 既过 shared-schema fixtures，又喂给 ppt-engine 渲染器 fixtures，捕获字段/形状漂移。
- [事件/错误分层] → 沿用 Phase 5：validate-before-append、fail-closed、`INVALID_STATE_TRANSITION` 清 field、错误子类复用既有分组；`SLIDES_MATERIALIZED` 的 `slideCount≥1` 由 NOT_MATERIALIZABLE 前置保证（500 分支不可达）。
- [重复物化] → 整体覆盖 + 重放安全。

## 迁移计划

纯增量：新增后端 `presentation.py` + `ppt-engine` 包 + schema 加法（ThemeTokens + 单事件）+ 边表加法；`StoredProject.presentation` 默认 None。无数据迁移。回滚即恢复 Phase 5 终态。

## 待解决问题

- 确定性时间戳的具体取值（固定 sentinel 常量 vs 派生）——实现阶段定，硬要求是「非 wall-clock、可复现」。
- 基础布局 token 模板集与 `layoutSuggestion` 到模板的映射粒度——实现阶段定，未知落默认 + 软提示。
- 渲染器输出粒度（整文档 vs 每页片段 + 一份 theme CSS）——实现阶段定，倾向每页片段 + 一份 CSS。
