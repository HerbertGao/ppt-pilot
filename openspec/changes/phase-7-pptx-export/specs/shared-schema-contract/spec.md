## 新增需求

### 需求:shared-schema 必须定义导出产物类型

shared-schema 必须新增 canonical `ExportArtifact` 类型（基础字段：`id`、`projectId`、`format`（本期取值 `"pptx"`）、`bytesBase64`（导出二进制的 base64）、`byteSize`（正整数）、`sourcePresentationId`、`createdBy`（`ActorType`）、`createdAt`），作为导出产物结构化取值的唯一契约源，禁止后端重复定义。`validateExportArtifact` 必须做**结构校验**：`format=="pptx"`、`byteSize` 为整数 `≥1`、`bytesBase64` 非空且匹配 base64 字符集、必填齐备；**禁止在 TS 校验器里 decode base64**——`byteSize == bytesBase64` 解码后字节数的等式是**服务侧不变量**（服务用同一份 bytes 同时设二者、按构造相等），由后端导出测试断言，不进校验器（避免每次 `validateEntity` 解码兆级 payload、且 `ExportArtifact` 只由服务构造无不可信输入路径）。`ExportArtifact` 必须登记进 `ENTITY_NAMES`、`EntityMap`、`validateEntity` 分发与 `runtimeValidationEntrypoints`（`satisfies Record<EntityName,string>`——加 `ExportArtifact` 会拓宽 `EntityName`，缺键会 typecheck 失败）。以上为**加法**，禁止改动 Phase 1–6 既有类型/枚举/校验的行为（`validatePresentation` 等复用不变）。

#### 场景:定义导出产物契约

- **当** 后端导出服务引用导出产物结构
- **那么** 必须来自 shared-schema 的 `ExportArtifact`，不存在重复定义，且 `validateEntity("ExportArtifact", …)` 可用

#### 场景:合法/非法导出产物校验

- **当** 校验一个结构完整（`format=="pptx"`、`byteSize>=1`、`bytesBase64` 非空合法 base64、必填齐备）的 `ExportArtifact`，以及非法样例（缺必填字段 / `byteSize<1` / `bytesBase64` 空或含非 base64 字符）
- **那么** 前者必须通过、后者必须失败并返回字段路径

#### 场景:既有实体校验不回归

- **当** 新增 `ExportArtifact` 与导出事件后运行 Phase 1–6 的 schema 校验样例
- **那么** 全部既有 fixture（含 `Presentation`/`Slide`/`Element`/`ThemeTokens`）必须仍通过，无行为变更

### 需求:导出事件类型及 payload 校验（fail-closed）

`EVENT_TYPES` 必须新增 `PRESENTATION_EXPORTED`（**仅此一个**——本期唯一发射方是 `export`），并在 `validateEventPayload` 新增其 `case` 校验必填 payload `{ artifactId:string, format:"pptx", byteSize:int(min 1), nextState∈WORKFLOW_STATES }`。`validateEventPayload` 必须保持 **fail-closed**（`EVENT_TYPES` 中无显式 `case` 的类型返回失败）。既有事件类型与其校验保持不变。

#### 场景:合法导出事件通过校验

- **当** 校验一个 `type=PRESENTATION_EXPORTED`、payload `{artifactId:"…_export_1", format:"pptx", byteSize:12345, nextState:"EXPORT_READY"}` 的事件（导出动作发射 `nextState==EXPORT_READY` 当前态；`case` 仅校验 `nextState∈WORKFLOW_STATES`，不锁定具体值）
- **那么** 事件校验必须通过

#### 场景:缺必填 payload 的导出事件被拒绝

- **当** 校验一个 `PRESENTATION_EXPORTED` 但缺 `artifactId` 或 `byteSize` 的事件
- **那么** 事件校验必须失败，禁止被追加（validate-before-append 零持久化）
