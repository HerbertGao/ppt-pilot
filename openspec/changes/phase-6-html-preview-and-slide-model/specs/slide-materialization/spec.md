## 新增需求

### 需求:从确认的规划确定性物化演示模型

系统必须提供 `POST /api/projects/{projectId}/slides/materialize`，从**已确认**的 `SlidePlan[]` 与**已确认**的 `PresentationSpec` **确定性、无 LLM、本期无 Asset**地物化一个 `Presentation`。前置（均 None-safe）：`state==SLIDE_GENERATION` 且 `spec is not None and spec.get("confirmedByUser")` 且 `slidePlans` 非空且 `slidePlansConfirmed`——任一不满足以 `SLIDES_NOT_MATERIALIZABLE`(409) 拒绝、不解引用 None、不持久化、不追加事件。

物化必须满足既有校验器（`validateSlide`/`validateElement`/`validatePresentation`，本期不改动它们）的**所有跨字段不变量**：`presentation.spec` 嵌入已确认的 `PresentationSpec`（`project.spec`——`validatePresentation` 强制 `spec` 为完整合法 `PresentationSpec`）；`presentation.scene == spec.scene`；`presentation.id` 确定性、每个 `slide.presentationId == presentation.id`；每个 `slide.id == plan.slideId`、每个 `element.slideId == slide.id`；`slide.index` 从 **1** 递增（整数）；`slide.status = "planned"`；`slide.title = plan.title ?? plan.keyMessage`（顶层非空）；`slide.plan` 为源规划副本但 **`requiredAssets` 置 `[]`**（本期无 Asset，`presentation.assets = []`）；`createdAt`/`updatedAt` **确定性**（非 wall-clock）。视觉占位元素 `ElementType` 由 `visualIntent` 确定性映射：`chart→chart`/`diagram→diagram`/`comparison`|`timeline`|**`image`→`shape`**（`image` 本期落 `shape`——`validateElement` 强制 image 元素带 `content.assetId` 而本期无 Asset）/`text→无视觉元素`；几何由 `layoutSuggestion`→基础布局 token 确定性给定，未知落默认模板 + 软提示不失败。`theme` 为 scene 派生的 `ThemeTokens`（styleProfile 记于 `presentation.styleProfileId`，主题化留待后续样式阶段）。

**持久化前必须先 `validateEntity("ThemeTokens", theme)`、再 `validateEntity("Presentation", presentation)`**（后者校验完整跨引用一致性；`validatePresentation` 对 theme 松散故 ThemeTokens 需单独显式校验）；任一不过 → `SLIDE_VALIDATION_ERROR`(400)，**零持久化、不追加事件**。通过则**整体覆盖** `project.presentation`、追加经校验的 `SLIDES_MATERIALIZED` 事件（payload `{slideCount, nextState}`）、**不推进工作流状态**。重复物化整体覆盖、重放安全。

#### 场景:确认的规划物化为通过全量校验的演示模型

- **当** 项目 `state==SLIDE_GENERATION`、Spec 与规划均已确认，客户端 `POST .../slides/materialize`
- **那么** 系统必须物化一个通过 `validateEntity("Presentation")` 与 `validateEntity("ThemeTokens")` 的 `Presentation`（`scene==spec.scene`、逐页 `slide.id==plan.slideId`、`element.slideId==slide.id`、1-based `index`、`status="planned"`、`requiredAssets=[]`、`assets=[]`、确定性时间戳），持久化并追加 `SLIDES_MATERIALIZED`，状态保持 `SLIDE_GENERATION`

#### 场景:image 视觉意图本期映射为 shape 而非 image

- **当** 某页 `visualIntent=="image"`
- **那么** 该页视觉占位元素的 `ElementType` 必须为 `shape`（不为 `image`，因本期无 Asset、`validateElement` 会拒绝无 `assetId` 的 image 元素），`content` 标注占位意图

#### 场景:Spec 未确认或为 None 时 None-safe 拒绝物化

- **当** 项目 `state==SLIDE_GENERATION` 但 `spec` 为 `None` 或 `spec.get("confirmedByUser")` 为假
- **那么** 系统必须以 `SLIDES_NOT_MATERIALIZABLE`(409) 稳定拒绝、不解引用 `None`、不持久化、不追加事件

#### 场景:规划未确认或为空时拒绝物化

- **当** 项目 `state==SLIDE_GENERATION` 但 `slidePlans` 为空或 `slidePlansConfirmed==false`
- **那么** 系统必须以 `SLIDES_NOT_MATERIALIZABLE`(409) 拒绝、不持久化、不追加事件

#### 场景:错误状态调用物化按状态错误拒绝

- **当** 项目仍处于 `SLIDE_PLAN_REVIEW`（未转移进 `SLIDE_GENERATION`）就 `POST .../slides/materialize`
- **那么** 系统必须以 `INVALID_STATE_TRANSITION`(409，抛出点清除默认 `field="to"`) 拒绝，不持久化、不追加事件

#### 场景:物化产物校验失败零持久化

- **当** 物化装配的 `theme` 未过 `validateThemeTokens` 或 `Presentation` 未过 `validatePresentation`
- **那么** 系统必须以 `SLIDE_VALIDATION_ERROR`(400) 失败，不持久化任何 `presentation`、不追加事件

#### 场景:重复物化整体覆盖且重放安全

- **当** 已物化的项目再次 `POST .../slides/materialize`
- **那么** 系统必须整体覆盖 `project.presentation` 为新物化结果、不崩溃、可再追加一条 `SLIDES_MATERIALIZED`

### 需求:读取物化的演示模型

系统必须提供 `GET /api/projects/{projectId}/presentation` 读取持久化的完整 `Presentation`（含 `slides`/`elements`/`theme`/`assets`）；不存在时以 `PRESENTATION_NOT_FOUND`(404) 拒绝。

#### 场景:读取已物化演示模型

- **当** 已物化的项目 `GET .../presentation`
- **那么** 系统必须返回完整 `Presentation`（含逐页 `Slide` 与其 `Element[]` 及 `theme`）

#### 场景:未物化时读取被拒绝

- **当** 尚未物化（`project.presentation` 为 None）的项目 `GET .../presentation`
- **那么** 系统必须以 `PRESENTATION_NOT_FOUND`(404) 拒绝，不崩溃
