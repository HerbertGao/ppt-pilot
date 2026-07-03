## 上下文

Phase 6 落地了 `project.presentation`（过 `validatePresentation` 的完整 `Presentation`，`slides[].elements[]` 携绝对几何 `x/y/width/height/zIndex`、`theme` 为 `ThemeTokens`），并用 `packages/ppt-engine` 的纯函数渲染器证明该模型可一致渲染。`Element` 几何是 **px，画布约 1280×720（16:9）**（物化基础布局 token：标题 `x80 y60 w1120 h120`、正文 `x80 y220 w1120 h400`、视觉 `x740 y220 w460 h400`；渲染器 `geometryCss` 按 px 落 `left/top/width/height`）。

现状缺口：`ExportArtifact` 在 shared-schema **不存在**（`ENTITY_NAMES` 无此项）；`EVENT_TYPES` 最新到 `SLIDES_MATERIALIZED`；`TRANSITION_EDGES` 止于 `SLIDE_GENERATION→SLIDE_PLAN_REVIEW`，`EXPORT_READY`/`EXPORTED` 虽在 `WORKFLOW_STATES` 但无边；`packages/exporter` 为空占位；后端无 `python-pptx`。后端 `presentation.py` 是可仿的范式（无 LLM、None-safe 前置、validate-before-persist、确定性时间戳、整体覆盖/重放安全、错误复用既有 group base）。Python→node 子进程桥仅存在于 `shared_schema_adapter`（回传 JSON 文本）。

## 目标 / 非目标

**目标：**

- 从**已持久化**的 `Presentation` **确定性、无 LLM、无网络**生成 `.pptx`，产出 `ExportArtifact` 并可下载。
- 导出器**消费同一 `Presentation` 模型**（与渲染器同源，读 `element` 几何/类型/内容/主题）。
- 补齐 `SLIDE_GENERATION→EXPORT_READY→EXPORTED` 最小前向边与 None-safe 回退边。
- `ExportArtifact` 落地 shared-schema（类型 + 校验 + 四处登记）；单个 `PRESENTATION_EXPORTED` 事件（fail-closed）。
- 以**结构不变量**表达确定性（重开 pptx 断言），不追求二进制字节级 golden。

**非目标：**

- PDF/HTML 导出；真实图表/图片/图示可视化（占位框）；`EDITING`/`REVIEW` 实现；锁定/版本运行时；对象存储/云上传/分享链接；前端导出 UI。

## 决策

### D1：引擎 = `python-pptx`（后端进程内），导出落 `apps/api/app/export.py`

API 为 FastAPI；`python-pptx` 成熟、纯 Python（lxml，无网络）、hermetic，直接返回 `bytes` 供下载，无需为「产出二进制」再起 node 子进程（现有桥只回传 JSON 文本，二进制管道更脆）。`Element` 几何已是绝对值，导出直接读 `element.{x,y,width,height}`，不依赖 ppt-engine 布局。`packages/exporter` 保留占位（后续若要 TS/pptxgenjs 再启用）。`ARCHITECTURE.md §7`「python-pptx 或 pptxgenjs」皆许可。

### D2：前置（None-safe）——`state==EXPORT_READY` 且 `project.presentation is not None`

`materialize` 不推进状态（停在 `SLIDE_GENERATION`）；导出前用户经显式 `transitions` 走 `SLIDE_GENERATION→EXPORT_READY`（结构边，无内容守卫）。`POST export` 服务层再校验内容前置（与 Phase 6「转移结构化、服务查内容」一致），**分两个错误码（仿 Phase 6 `materialize` 的 `_wrong_state` / `SlidesNotMaterializable` 二分）**：`project.state != EXPORT_READY` → `INVALID_STATE_TRANSITION`(409，抛出点清 `field="to"`)；`state==EXPORT_READY` 但 `project.presentation is None` → `EXPORT_NOT_READY`(409)。均 dict 访问、绝不解引用 None、零持久化、不追加事件。此外 `presentation.get("slides")` 必须非空（持久化 presentation 是 **dict**——用 `.get` 而非属性访问；`materialize` 保证 ≥1 页，仍加防御性守卫，空 deck → `EXPORT_NOT_READY`）。错误基类：`EXPORT_NOT_READY` ← `StateError`(409)、错误状态复用既有 `InvalidStateTransitionError`(StateError,409)、`EXPORT_ARTIFACT_NOT_FOUND` ← `NotFoundError`(404)、`EXPORT_VALIDATION_ERROR` ← `ValidationError`(400)——全部落既有 group base，`_STATUS_BY_ERROR` 零改动。

### D3：几何映射——导出器自有画布常量 1280×720 px → 精确 16:9 EMU，按比例缩放

**`1280×720` 不是 shared-schema/渲染器契约**（渲染器 `render.ts` 用裸 px、无声明画布）；因此在导出器**显式定义** `CANVAS_W = 1280`、`CANVAS_H = 720` 常量（带 `ponytail:` 注释说明这是导出映射约定，非模型不变量；Phase 6 物化坐标恰落此域，最大 `x+w≈1200`、`y+h≈620`）。幻灯片尺寸用**精确 16:9 EMU 常量** `SLIDE_W_EMU = 12192000`、`SLIDE_H_EMU = 6858000`（**不使用 `Inches(13.333)`——它不精确等于 12192000 EMU**）。缩放 `sx = SLIDE_W_EMU / CANVAS_W`、`sy = SLIDE_H_EMU / CANVAS_H`；每个 `Element` 落一个 shape 于 `left=round(x*sx)`、`top=round(y*sy)`、`width=round(width*sx)`、`height=round(height*sy)`（`Emu` 整数、确定性）。`zIndex` 决定**添加顺序**（升序添加，高 z 后添加 = 视觉在上，与渲染器 z 语义一致）。几何值经 finite 守卫（NaN/inf → 0，仿渲染器 `num()`）；**超出画布的几何允许溢出到幻灯片外**（python-pptx 接受任意 EMU，不 clamp、不崩溃）。

### D4：`ElementType` → pptx shape（**全覆盖**占位策略，沿用渲染器）

映射必须**对全部 8 个 `ELEMENT_TYPES`（`text/image/shape/icon/chart/table/diagram/group`）全覆盖**——渲染器已把「非文本一律占位」，导出器同构：

- `text` → `add_textbox`，写 **`str(content.get("text") or "")`**（`content.text` 不受 `validateElement` 约束、可能缺失或非字符串；强制转字符串避免 python-pptx 抛错——仿 D3 finite 守卫哲学）；空文本落空框。
- **其余所有类型（`image`/`shape`/`icon`/`chart`/`table`/`diagram`/`group`，即一个 `else` 分支）** → `add_shape(MSO_SHAPE.RECTANGLE)` **带类型标注占位文本**（如 `[chart]`、`[icon]`）。用 `else` 而非枚举 6 个，**未来新增 `ElementType` 不会 KeyError→500**（CR/Codex：`icon`/`group` 是合法但此前遗漏的类型）。
- `content` 意图仅作标注；**本期不做真实可视化**（无 Asset、无图表引擎）。锁字段（`locked` 等）存在但**导出不强制锁语义**（非目标）；所有元素一律渲染。`width==0`/`height==0` → 退化为 `Emu(0)` shape（合法但不可见的 pptx，接受）。

### D5：`theme`（`ThemeTokens`）→ 颜色/字体（确定性）

背景填充取 `theme.palette.background`；文本色取 `theme.palette.text`；占位框描边/填充取 `palette.primary`/`surface`；字体取 `theme.fonts.heading`/`body`。缺键回退到确定性默认。**颜色解析必须逐色 try 包裹并剥离前导 `#`**：物化主题色存为 `"#0B1F3A"`（带 `#`），而 `RGBColor.from_string` 要 6 位十六进制**不带 `#`**——因此 `_rgb(value)` 先 `lstrip("#")`、`from_string` 失败或非 6-hex（如 `"red"`）逐色回退确定性默认（**不抛**，避免 500）。

### D6：`ExportArtifact` 形态与不变量（过 `validateEntity("ExportArtifact")`）

字段：`id`（**确定性**：`f"{presentation.id}_export_{n}"`，`n = len(project.exports)+1`，追加单调、跨重复导出不撞）、`projectId == project.projectId`、`format == "pptx"`、`bytesBase64`（pptx 二进制 base64）、`byteSize`（正整数）、`sourcePresentationId`、`createdBy == "ai"`、`createdAt` **确定性 sentinel**（非 wall-clock）。`ExportArtifact` 新增进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`/`runtimeValidationEntrypoints`（`satisfies Record<EntityName,string>`，缺键 typecheck 失败）。

**`validateExportArtifact` 校验边界（不在校验器里解码大 payload）**：校验器只做结构校验——`format=="pptx"`、`byteSize` 为整数 `≥1`、`bytesBase64` 非空且匹配 base64 字符集正则（**不做 full decode**——ExportArtifact 只由服务构造、非客户端输入，无不可信路径）。**`byteSize == len(pptx_bytes)` 等式是服务侧不变量**（服务用同一份 bytes 同时设 `byteSize` 与 `bytesBase64`，二者按构造相等），由导出 pytest 断言，**不在 TS 校验器里 decode 校验**（避免每次 `validateEntity` 解码兆级 base64）。

`sourcePresentationId` 记录导出时的 `presentation.id`（`= pres_{projectId}`，**项目级稳定、非修订唯一**）：见 D10 的诚实边界——它是最佳努力溯源，产物字节才是权威自包含交付物。

### D7：validate-before-persist（零持久化）+ **不自行推进状态** + **无新 500 基类**

顺序（仿 Phase 6 `materialize`「全部校验 → 再写」）：组装 pptx → `pptx_bytes`；构造 `ExportArtifact` → `validate_shared_schema_entity("ExportArtifact")`；构造 `PRESENTATION_EXPORTED` 事件 → `validate_event`；**任一校验失败 → 零持久化、不追加事件、不推进状态**。校验全过后才写（`append_event` → 追加 `ExportArtifact` 到 `project.exports`）——校验先于任何写，故失败即零写。

**错误映射（复用既有 group base，无状态表改动——`_STATUS_BY_ERROR` 无 500 业务码，Phase 6 刻意规避）**：

- 组装出的 `ExportArtifact` 未过 `validateExportArtifact` → `EXPORT_VALIDATION_ERROR`（**继承 `ValidationError` base → 400**，仿 Phase 6 `SlideValidationError`），零持久化。
- `python-pptx` 组装真的抛异常（should-never-happen 服务 bug）→ 不新增业务码，**落既有 catch-all `handle_unexpected_error` → 500 `INTERNAL_ERROR`**（`main.py`），零持久化（写在全部校验之后，故未写）。
- `PRESENTATION_EXPORTED` 事件未过 `validate_event`（`EventValidationError` 属 `RuntimeError`）→ 同落 catch-all 500（与 Phase 6 `materialize` 的事件校验失败一致；纯服务构造、should-never-happen）。

**导出动作不自行推进工作流状态**（与 `materialize`/所有动作端点一致：动作端点绝不推进状态、只有 `/transitions` 推进）：`export` 成功后**停在 `EXPORT_READY`**，`PRESENTATION_EXPORTED` 事件 `nextState == EXPORT_READY`（当前态，非 `EXPORTED`）、只追加**这一条**事件（不追加 `WORKFLOW_STATE_CHANGED`）。到达 `EXPORTED` 由用户随后显式 `POST /transitions {to:"EXPORTED"}` 走新的前向边完成（该转移经 `commit_state_change` 原子提交）。由此**避免** Codex 指出的「artifact + 导出事件 + 状态事件」跨多写的部分持久化风险——导出动作只写「一条事件 + 一个 artifact」，与 `materialize` 写「一条事件 + presentation」同构。

### D8：单个事件 `PRESENTATION_EXPORTED`（fail-closed）

`EVENT_TYPES += "PRESENTATION_EXPORTED"`（仅此一个）；`validateEventPayload` 加 case 校验 `{artifactId:string, format:"pptx", byteSize:int(min 1), nextState∈WORKFLOW_STATES}`，保持 fail-closed default。既有事件不变。

### D9：确定性 = 结构不变量（非字节级）

pptx 是 zip 二进制（含 zip 目录/可能的时间戳），**无法保证字节级可复现**。因此确定性以**结构不变量**表达并测试：以 `python-pptx` 重开产物断言——幻灯片数 `== len(presentation.slides)`；每页 shape 数/类型与 `elements` 对应（**幻灯片必须用 python-pptx 空白版式（无 title/body 占位符的 layout，通常 index 6）新建**——否则版式自带占位符 shape 会污染 shape 计数、破坏「shape 数 == 元素数」不变量）；文本 shape 内容 `== str(element.content.text or "")`；几何缩放正确。**核心文档属性必须显式覆盖为确定性 sentinel**：python-pptx 默认 `core_properties.created`/`modified` 为 `datetime.now()`（wall-clock，非确定）——导出服务必须显式将其（及 `title`/`author` 等）设为确定性常量（仿 `MATERIALIZED_TIMESTAMP`），否则重开断言核心属性会 flaky。**诚实边界**：不断言两次导出字节相等（zip 层不保证），只断言结构相等 + 被显式覆盖的核心属性确定。

### D10：工作流边与回退（`project.exports` 为追加式历史，回退不清）

前向：`SLIDE_GENERATION→EXPORT_READY`、`EXPORT_READY→EXPORTED`（结构边，无内容守卫；`EXPORT_READY→EXPORTED` 由用户在 `export` 动作**之后**显式 `/transitions` 走，见 D7——动作不自行推进）。回退：`EXPORT_READY→SLIDE_GENERATION`、`EXPORTED→EXPORT_READY`（None-safe，纯状态回退，**不加 `_clear_downstream_on_rollback` 分支**——回退不清 exports）。**`ExportArtifact` 是自包含、内嵌自身字节的历史交付物**——回退**不删除** `project.exports`（即便回退后 `presentation` 变化，既有导出仍是有效可下载文件）；重复导出**追加**新 `ExportArtifact`。（备选：回退清空 exports——**否决**：与「PPTX 非真相源、产物为历史」原则相悖，且删除用户已生成的可下载文件是破坏性行为。）

**诚实边界（Codex：深层回退后 `sourcePresentationId` 指向不同 presentation）**：`presentation.id = pres_{projectId}` 项目级稳定；若用户 `EXPORTED→…→SLIDE_GENERATION→SLIDE_PLAN_REVIEW`（Phase 6 回退边清空 `presentation`）再重新物化，新 presentation 复用**同一 id**，于是旧 `ExportArtifact.sourcePresentationId` 会指向一个「已被替换」的 presentation。**本期不追踪修订唯一性**（版本/修订属 Phase 8+ 非目标）：`sourcePresentationId` 明确为**最佳努力溯源、非修订唯一引用**；产物**字节**才是权威自包含交付物（下载仍有效）。spec 与 `DATA_MODEL` 显式写明此限制，避免被误读为强引用。

`StoredProject` 增 `exports: list[Any]`（默认 `[]`），`repository` 增读取。`main.py --selfcheck` 断言新边可走 + 越界边（如 `EXPORTED→EDITING`）仍非法；**并须把现有 selfcheck 里「`SLIDE_GENERATION→EXPORT_READY` 为 `INVALID_STATE_TRANSITION`(409)」的断言改为合法前向**（该边本期起合法）。

### D11：hermetic

`python-pptx` 纯本地（lxml），无网络；无 LLM。测试用内存仓 + TestClient，全链路无外呼。

## 风险 / 权衡

- **pptx 二进制非确定**（D9）：以结构不变量测试规避；诚实边界写入 spec（不承诺字节级可复现）。
- **新依赖 `python-pptx`**：成熟、纯 Python、广泛使用；加入后端 `pyproject.toml`，CI API 门覆盖。
- **占位可视化**：`chart`/`image`/`diagram`/`table` 为标注矩形；真实可视化留待后续（需 Asset/图表引擎）。可接受——本期证明「模型→PPTX」链路。
- **固定 16:9 尺寸**：不同 scene/尺寸偏好本期不参数化；后续可从 spec/theme 推导画布比例。
- **内存字节**：大 deck 的 pptx 字节驻留内存仓——里程碑可接受；生产走对象存储（非目标）。
- **锁语义不强制导出**：与 Phase 6 一致（锁运行时属后续）；导出渲染全部元素。
- **`sourcePresentationId` 非修订唯一**（D10）：深层回退+重新物化后旧产物的 `sourcePresentationId` 会指向替换后的同 id presentation；本期以「字节自包含 + 明确文档为最佳努力溯源」规避，修订唯一性留待版本阶段（非目标）。
- **空 deck / 0 面积元素**：`presentation.slides` 空由 `EXPORT_NOT_READY` 防御性拒绝（`materialize` 本就保证 ≥1 页）；`width/height==0` 落 `Emu(0)` 退化 shape（合法 pptx、不可见），皆已在 D2/D4 定义，不留未定义行为。
