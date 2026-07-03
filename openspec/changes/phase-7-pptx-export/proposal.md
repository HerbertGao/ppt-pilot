## 为什么

Phase 6 把确认的 `SlidePlan[]` 确定性物化为结构化 `Presentation`（`slides`/`elements`/`theme`，过 `validatePresentation`），并证明该模型能渲染出一致的 HTML 预览。产品链的收尾一环——**把这套唯一真相源导出为可交付的 `.pptx`**——尚缺。`PRODUCT.md`/`ARCHITECTURE.md` 明确：**PPTX 不是真相源**，导出器必须**消费同一结构化 `Presentation` 模型**（与渲染器同源），PPTX 只是导出目标之一。

`packages/exporter` 目前是空占位（README 声明「预留 export logic，不引入 PPTX 运行时依赖」）；`ExportArtifact` 在 `DATA_MODEL.md` 是概念实体但**尚未在 shared-schema 落地**；`WORKFLOW_STATES` 已含 `EXPORT_READY`/`EXPORTED` 但 `SLIDE_GENERATION` 之后**没有任何转移边**。

本变更实现 Phase 7：从已物化的 `Presentation` **确定性、无 LLM、无网络**地生成 `.pptx`，产出可下载的 `ExportArtifact`，并补齐通往 `EXPORTED` 的工作流边。**本期不做真实图表/图片/图示渲染**（沿用 Phase 6 渲染器的「带类型标注占位框」策略），证明「结构化模型能导出为 PPTX」。

## 设计决策（本提案已定，`/review-loop` 前可改）

- **D-引擎：`python-pptx` 在后端进程内导出**（非 `packages/exporter` 的 TS `pptxgenjs`）。理由：API 是 FastAPI（Python），`python-pptx` 成熟、hermetic、无需为「产出二进制」再起 node 子进程（现有 `shared_schema_adapter` 的 node 桥只回传 JSON 文本，管道二进制更脆）；`Element` 几何已是绝对值，导出直接读 `element.{x,y,width,height}` 即可，不依赖 ppt-engine 的布局函数。导出代码落 `apps/api/app/export.py`；`packages/exporter` 继续保留（后续若要 TS/pptxgenjs 再启用）。`ARCHITECTURE.md §7` 明确「python-pptx 或 pptxgenjs」皆可。
- **D-路径：最小前向边** `SLIDE_GENERATION→EXPORT_READY→EXPORTED`（跳过未实现的 `EDITING`/`REVIEW`，属 Phase 8），配 None-safe 回退边。沿用 Phase 6「只加本期所需的边」。
- **D-交付：内存字节 + GET 下载**。`ExportArtifact` 在内存仓持有 pptx 字节（base64），GET 端点流式下载。hermetic、可测、与内存仓一致；不落盘、不接对象存储。

## 变更内容

- **PPTX 导出（新，后端 Python，无 LLM/无网络）**：`POST /projects/{id}/export`——读**已持久化**的 `project.presentation`（Phase 6 物化产物）确定性生成 `.pptx`：每页 `Slide` → 一张 pptx 幻灯片；每个 `Element` → 一个 shape，几何由**导出器画布常量 1280×720 px**（导出映射约定，非模型契约）按比例映射到**精确 16:9 EMU 幻灯片（12192000×6858000，不用不精确的 `Inches(13.333)`）**；`text` → 文本框（`str(content.text or "")`）；**其余全部类型（含 `icon`/`group`，一个 `else` 分支）→ 带类型标注的占位矩形**（**全覆盖 8 个 `ELEMENT_TYPES`**，避免未映射类型 KeyError→500；本期不做真实可视化）；`theme`（`ThemeTokens`）→ 背景/字体色（逐色 `lstrip("#")`+try 回退）。前置（均 None-safe，仿 Phase 6 二分）：`state != EXPORT_READY` → `INVALID_STATE_TRANSITION`(409，清 `field`)；`EXPORT_READY` 但 `presentation is None`（或 `slides` 空）→ `EXPORT_NOT_READY`(409)。生成成功则创建经 `validateEntity("ExportArtifact")` 校验的 `ExportArtifact`（不过 → `EXPORT_VALIDATION_ERROR`/400，复用 `ValidationError` base；`python-pptx` 真抛错 → 既有 500 `INTERNAL_ERROR` catch-all——无新 500 基类）、追加经校验的 `PRESENTATION_EXPORTED` 事件（`nextState==EXPORT_READY` 当前态，validate-before-append 零持久化）、追加 `ExportArtifact` 到 `project.exports`；**导出动作不自行推进状态**（停在 `EXPORT_READY`；到 `EXPORTED` 由随后独立 `POST /transitions` 完成，与所有动作端点一致）；重复导出**追加**新 `ExportArtifact`、重放安全。**pptx 是 zip 二进制，无法字节级确定**——因此**确定性以结构不变量表达**：以 `python-pptx` 重开产物断言（幻灯片数 == `presentation.slides` 数、每页 shape 与 `elements` 对应、文本内容一致、`core_properties` 显式置确定性 sentinel）；不追求字节级 golden。
- **下载端点**：`GET /projects/{id}/export/{artifactId}` → 200 `application/vnd.openxmlformats-officedocument.presentationml.presentation` 流式下载（`Content-Length == byteSize`）；`GET /projects/{id}/exports` **仅列元数据（`id/format/byteSize/sourcePresentationId/createdAt/createdBy`，禁止含 `bytesBase64`——否则 N 次导出返回无界 JSON）**，字节只经下载端点；不存在 → `EXPORT_ARTIFACT_NOT_FOUND`(404)。
- **共享 schema 扩展（改）**：新增 canonical `ExportArtifact` 类型与 `validateExportArtifact`（结构校验：`format=="pptx"`、`byteSize` 整数 `≥1`、`bytesBase64` 非空且匹配 base64 字符集；`id`/`projectId`/`sourcePresentationId`/`createdAt`/`createdBy` 齐备。**不在 TS 校验器里 decode base64**——`byteSize==解码长度` 是**服务侧不变量**由 pytest 断言，非校验器职责；登记进 `ENTITY_NAMES`/`EntityMap`/`validateEntity`/`runtimeValidationEntrypoints`）+ **单个**导出事件 `PRESENTATION_EXPORTED`（fail-closed payload 校验：`{artifactId, format, byteSize, nextState∈WORKFLOW_STATES}`）；**复用**既有 `Presentation` 校验不改其行为。
- **工作流状态机扩展（改）**：向 `TRANSITION_EDGES` 加入前向边 `SLIDE_GENERATION→EXPORT_READY`、`EXPORT_READY→EXPORTED` 与回退边 `EXPORT_READY→SLIDE_GENERATION`、`EXPORTED→EXPORT_READY`（回退 **None-safe 且非破坏**：只回退状态，**保留** `project.exports`（自包含历史产物）与 `presentation`，不加 `_clear_downstream_on_rollback` 分支）；`EDITING`/`REVIEW` 边仍不加（Phase 8）。**须更新 `main.py --selfcheck` 里现有「`SLIDE_GENERATION→EXPORT_READY` 为 409」断言为合法前向。**
- **错误约定扩展**：`INVALID_STATE_TRANSITION`(409，错误状态调用导出，复用既有)、`EXPORT_NOT_READY`(409，未物化/`slides` 空)、`EXPORT_ARTIFACT_NOT_FOUND`(←`NotFoundError`/404)、`EXPORT_VALIDATION_ERROR`(←`ValidationError`/400，**仅**组装产物校验失败，零持久化)。**不新增 500 业务码**——`python-pptx` 真抛错**及事件校验失败**（`EventValidationError` 属 `RuntimeError`，仿 Phase 6）落既有 `INTERNAL_ERROR` 500 catch-all（无 `_STATUS_BY_ERROR` 改动）。`EXPORT_NOT_READY` ←`StateError`、`INVALID_STATE_TRANSITION` 复用既有。

## 功能 (Capabilities)

### 新增功能

- `pptx-export`: 后端从已持久化 `Presentation` 确定性生成 `.pptx`（元素→**全覆盖**占位 shape + 文本 + 主题色 + 几何比例映射）、`ExportArtifact` 产物与内存字节、`POST export`/`GET download`/`GET exports(元数据)` 端点、**导出动作不推进状态**（`EXPORTED` 经独立 `/transitions`）、导出事件（validate-before-append）、前置二分与错误映射（复用既有 base，无新 500）、结构不变量确定性。无 LLM/无网络。

### 修改功能

- `shared-schema-contract`: 新增 `ExportArtifact` 类型与校验、`PRESENTATION_EXPORTED` 事件与 fail-closed payload 校验；复用既有 `Presentation` 校验（不改行为）。
- `workflow-state-machine`: 加入 `SLIDE_GENERATION→EXPORT_READY`、`EXPORT_READY→EXPORTED` 前向边与 `EXPORT_READY→SLIDE_GENERATION`、`EXPORTED→EXPORT_READY` 回退边（None-safe）。

## 影响

- 后端（apps/api）
  - 新增 `export.py`（导出服务，仿 `presentation.py`，**无 agent/LLM**）；`routes.py` 挂 `export`/`download`/`exports`；`workflow.py` 扩边表 + None-safe 回退；`errors.py` 新错误码；`repository.py`/`StoredProject` 增 `exports` 字段。
  - 新依赖：`python-pptx`（后端 Python）。
- 模式（schema）
  - `packages/shared-schema/src`：`types.ts` 加 `ExportArtifact`；`enums.ts` 加 `PRESENTATION_EXPORTED`（单个）；`validation.ts` 加 `validateExportArtifact` + 事件 case（fail-closed）+ 登记入四处；fixtures 增补（`ExportArtifact` valid/invalid、事件 valid/invalid）；**复用** `validatePresentation`。
- 引擎（exporter）
  - `packages/exporter` 保留占位（本期不启用；TS/pptxgenjs 留待后续）。
- 工作流 / 锁定 / 版本
  - 扩前向/回退边；锁定与版本运行时仍不实现（导出不强制锁语义）。
- CI / 依赖
  - 分层 CI 的 API 门覆盖新 pytest；后端加 `python-pptx`；无新 TS 依赖。
- 文档
  - 实现后更新 `docs/ROADMAP_PROGRESS.md`、`docs/ARCHITECTURE.md`（导出服务落地）、`docs/DATA_MODEL.md`（`ExportArtifact` + 导出事件）、`docs/WORKFLOW.md`（新增边）。
- 验证方式
  - shared-schema 类型 + fixtures 通过；`apps/api` pytest 覆盖导出成功（重开 pptx 断言结构）/前置/回退/事件/错误；`main.py --selfcheck` 断言新边一致性；全程无 LLM、无网络。

非目标：

- **不做 PDF/HTML 导出**（仅 PPTX）。
- **不做真实图表/图片/图示可视化**（占位框，沿用 Phase 6 渲染器）。
- **不实现 `EDITING`/`REVIEW`**（Phase 8 画布编辑/审查代理）。
- **不实现锁定/版本运行时**（导出不强制锁语义；锁字段随 schema 存在但不驱动）。
- **不接对象存储/云上传/分享链接**（内存字节 + 下载端点）。
- **不做前端导出 UI**（后端 + 测试为交付物）。
