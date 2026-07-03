## 新增需求

### 需求:从已持久化的演示模型确定性导出 PPTX

系统必须提供 `POST /api/projects/{projectId}/export`，从**已持久化**的 `Presentation`（Phase 6 `slides/materialize` 产物）**确定性、无 LLM、无网络**地生成一个 `.pptx` 并产出 `ExportArtifact`。前置（均 None-safe，**分两码，仿 Phase 6 `materialize`**）：`state != EXPORT_READY` → `INVALID_STATE_TRANSITION`(409，抛出点清默认 `field="to"`)；`state==EXPORT_READY` 但 `project.presentation is None` 或 `presentation.slides` 为空 → `EXPORT_NOT_READY`(409)。任一前置不满足必须不解引用 None、不持久化、不追加事件。

导出必须**消费同一 `Presentation` 模型**（与渲染器同源）：每页 `Slide` 映射为一张 pptx 幻灯片；每个 `Element` 映射为一个 shape，几何由**导出器画布常量 1280×720 px**（导出映射约定，非模型契约）按比例映射到**精确 16:9 EMU 幻灯片（12192000×6858000）**（`left/top/width/height` 缩放为整数 `Emu`，几何值 finite 守卫，超画布允许溢出不 clamp）、`zIndex` 升序决定添加顺序。**`ElementType` 映射必须对全部 8 个 `ELEMENT_TYPES` 全覆盖**：`text` → 文本框（写 `str(content.get("text") or "")`，缺失或非字符串强制转空串）；**其余所有类型（`image`/`shape`/`icon`/`chart`/`table`/`diagram`/`group`，一个 `else` 分支）→ 带类型标注的占位矩形**（禁止只枚举部分类型——未映射类型会 KeyError；本期不做真实可视化，`content` 意图仅作标注）。`theme`（`ThemeTokens`）→ 背景/字体/描边颜色（**逐色 `lstrip("#")` + try，非法值回退确定性默认，禁止抛错**）。`width/height==0` 落退化 `Emu(0)` shape（合法 pptx）。锁字段存在但导出**不强制锁语义**，所有元素一律渲染。

持久化前必须先 `validateEntity("ExportArtifact", artifact)`、再 `validate_event(PRESENTATION_EXPORTED)`（**全部校验先于任何写**，故失败即零写）。组装出的 `ExportArtifact` 未过校验 → `EXPORT_VALIDATION_ERROR`(400，继承 `ValidationError` base，仿 Phase 6 `SlideValidationError`)，零持久化；`python-pptx` 真抛异常或事件校验失败（should-never-happen 服务 bug）→ 落既有 `INTERNAL_ERROR`(500) catch-all（**不新增 500 业务码、不改 `_STATUS_BY_ERROR`**），零持久化。全部通过则**追加** `ExportArtifact` 到 `project.exports`、追加经校验的 `PRESENTATION_EXPORTED` 事件（payload `{artifactId, format, byteSize, nextState}`，其中 **`nextState == EXPORT_READY`（当前态）**）。

**导出动作禁止自行推进工作流状态**（与所有动作端点一致——只有 `/transitions` 推进状态）：`export` 成功后**停在 `EXPORT_READY`**、只追加**这一条** `PRESENTATION_EXPORTED` 事件（不追加 `WORKFLOW_STATE_CHANGED`）；到达 `EXPORTED` 由客户端随后显式 `POST /transitions {to:"EXPORTED"}` 完成。`ExportArtifact.id` 必须**确定性**（`f"{presentation.id}_export_{n}"`，`n=len(project.exports)+1`，追加单调不撞）、`createdAt` 确定性（非 wall-clock）、`sourcePresentationId` 记录导出时的 `presentation.id`（`= pres_{projectId}`，**项目级稳定、非修订唯一**——最佳努力溯源，字节才是权威）。**`byteSize == 解码后字节数` 是服务侧不变量**（服务用同一份 bytes 同时设 `byteSize`/`bytesBase64`），由导出 pytest 断言、非 TS 校验器职责。重复导出**追加**新 `ExportArtifact`、重放安全。

**确定性以结构不变量表达**：pptx 为 zip 二进制，系统**不保证字节级可复现**；确定性必须以「重开产物断言幻灯片数/ shape 数与类型/文本内容/几何缩放一致，且 `core_properties` 被显式覆盖为确定性 sentinel」表达，禁止依赖字节级 golden。

#### 场景:已就绪的演示模型导出为可下载 PPTX（不推进状态）

- **当** 项目 `state==EXPORT_READY` 且 `presentation` 已物化，客户端 `POST .../export`
- **那么** 系统必须生成一个以 `python-pptx` 可重开的 `.pptx`（幻灯片数 == `presentation.slides` 数、每页 shape 与 `elements` 对应、文本 shape 内容 == `str(element.content.text or "")`），产出过 `validateEntity("ExportArtifact")` 的 `ExportArtifact`、追加**一条** `PRESENTATION_EXPORTED`（`nextState==EXPORT_READY`）、**状态保持 `EXPORT_READY`**（不自行推进到 `EXPORTED`）

#### 场景:到达 EXPORTED 经独立转移

- **当** 已导出的项目客户端 `POST .../transitions {to:"EXPORTED"}`
- **那么** 系统必须经新前向边 `EXPORT_READY→EXPORTED` 推进状态并追加一条 `WORKFLOW_STATE_CHANGED`（与导出动作解耦）

#### 场景:全部 ElementType 全覆盖为占位（含 icon/group）

- **当** 某页含 `chart`/`table`/`diagram`/`image`/`shape`/`icon`/`group` 任一非文本元素
- **那么** 该元素必须导出为一个带类型标注的占位矩形（`else` 分支全覆盖，未映射类型不得 KeyError/崩溃），几何按比例映射正确

#### 场景:错误状态调用导出按状态错误拒绝

- **当** 项目 `state` 不是 `EXPORT_READY`（如仍在 `SLIDE_GENERATION`）就 `POST .../export`
- **那么** 系统必须以 `INVALID_STATE_TRANSITION`(409，清默认 `field="to"`) 拒绝，不持久化、不追加事件

#### 场景:未物化或空 deck 时 None-safe 拒绝导出

- **当** 项目 `state==EXPORT_READY` 但 `presentation` 为 `None` 或 `presentation.slides` 为空
- **那么** 系统必须以 `EXPORT_NOT_READY`(409) 稳定拒绝、不解引用 None、不持久化、不追加事件

#### 场景:产物校验失败零持久化

- **当** 装配的 `ExportArtifact` 未过 `validateExportArtifact`
- **那么** 系统必须以 `EXPORT_VALIDATION_ERROR`(400) 失败，不追加任何 `ExportArtifact`、不追加事件、不推进状态

#### 场景:重复导出追加产物且重放安全

- **当** 已导出的项目再次（在 `EXPORT_READY`，或经回退回到 `EXPORT_READY` 后）`POST .../export`
- **那么** 系统必须追加一个新的 `ExportArtifact`（`id` 递增确定性）、不崩溃、可再追加一条 `PRESENTATION_EXPORTED`

### 需求:下载与列举导出产物

系统必须提供 `GET /api/projects/{projectId}/export/{artifactId}` 以 `application/vnd.openxmlformats-officedocument.presentationml.presentation` 流式返回该 `ExportArtifact` 的 pptx 字节（`Content-Length == byteSize`）；提供 `GET /api/projects/{projectId}/exports` 返回该项目全部 `ExportArtifact` 的**元数据**（`id`/`format`/`byteSize`/`sourcePresentationId`/`createdAt`/`createdBy`）——**禁止在列表中返回 `bytesBase64`**（exports 追加不清、字节驻内存，含 base64 会使列表随导出次数无界膨胀），字节只经单件下载端点。artifact 不存在 → `EXPORT_ARTIFACT_NOT_FOUND`(404)。

#### 场景:下载已生成的导出产物

- **当** 客户端 `GET .../export/{artifactId}` 且该 artifact 存在
- **那么** 系统必须以正确的 PPTX MIME 返回其字节，`Content-Length == byteSize`

#### 场景:列举仅返回元数据不含字节

- **当** 客户端 `GET .../exports`
- **那么** 系统必须返回各 `ExportArtifact` 的元数据且**不含 `bytesBase64`**

#### 场景:下载不存在的产物被拒绝

- **当** 客户端 `GET .../export/{unknownId}`
- **那么** 系统必须以 `EXPORT_ARTIFACT_NOT_FOUND`(404) 拒绝，不崩溃
