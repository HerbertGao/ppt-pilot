## 新增需求

### 需求:触发 PPTX 导出

导出页在 `state==EXPORT_READY` 且 `presentation` 已物化时必须提供「导出 PPTX」按钮调 `POST /api/projects/{id}/export`（停 `EXPORT_READY`，不推进状态）。导出成功后必须 `refresh()` 并把新产物加入导出列表。导出失败（`EXPORT_NOT_READY`/`EXPORT_VALIDATION_ERROR`/状态错误）必须显示错误 + 重试，不导航。导出进行中显示 loading。重复导出**追加**新产物（后端 `id` 递增），前端不崩溃、列表追加重放安全。

#### 场景:导出成功后列表追加

- **当** 用户在 `EXPORT_READY` 点「导出 PPTX」成功
- **那么** 前端必须把新 `ExportArtifact` 元数据加入列表，显示可下载

#### 场景:未物化时导出失败

- **当** `POST /export` 返回 `EXPORT_NOT_READY`(409)
- **那么** 前端必须显示「请先物化幻灯片」+ 返回预览页的链接，不导航

#### 场景:重复导出追加产物

- **当** 用户在已导出后再次点「导出 PPTX」
- **那么** 前端必须追加一个新产物到列表（`id` 递增），不崩溃

### 需求:列举导出元数据

导出页必须 `GET /api/projects/{id}/exports` 拉取导出列表，**仅元数据**——即 `ExportArtifactMetadata = Omit<ExportArtifact, "bytesBase64">`，后端 `_METADATA_KEYS` 实际含 `id`/`projectId`/`format`/`byteSize`/`sourcePresentationId`/`createdBy`/`createdAt`（**含 `projectId`**）。前端**不得**期望或请求 `bytesBase64` 字段（后端列表端点禁止返回字节）。列表按 `createdAt` 或追加顺序展示，每项显示文件大小（`byteSize` 人类可读格式）与格式。

#### 场景:列表仅展示元数据

- **当** 用户进入导出页且有已生成产物
- **那么** 前端必须展示每项的 `id`/`format`/`byteSize`/`createdAt`，不请求或展示 `bytesBase64`

#### 场景:空列表显示空态

- **当** 项目无导出产物
- **那么** 前端必须显示空态提示 + 「导出 PPTX」按钮

### 需求:下载导出产物

导出列表每项必须提供下载入口，点击后用 `fetch` 请求 `GET /api/projects/{id}/export/{artifactId}`，把响应转为 `Blob`，创建 `ObjectURL` 并经 `<a download="{artifactId}.pptx">` 触发浏览器下载，下载后 `revokeObjectURL`。**禁止用 `window.location.href` 直跳**（会离开 SPA、丢失页面状态、无法页面内提示错误）。下载失败（`EXPORT_ARTIFACT_NOT_FOUND`/网络错误）必须在页面内提示，不崩溃。下载进行中显示加载态。

#### 场景:点击下载触发浏览器下载

- **当** 用户点击某产物的下载按钮
- **那么** 前端必须 `fetch` 字节 → Blob → `<a download>` 触发下载，下载后释放 ObjectURL

#### 场景:下载不存在产物

- **当** `GET /export/{artifactId}` 返回 `EXPORT_ARTIFACT_NOT_FOUND`(404)
- **那么** 前端必须在页面内提示「产物不存在」，不崩溃、不离开页面

#### 场景:下载失败网络错误

- **当** 下载请求网络失败（`NETWORK_ERROR`）
- **那么** 前端必须提示「下载失败，请重试」，保留页面状态

### 需求:标记为已导出

导出页在 `state==EXPORT_READY` 且至少有一个导出产物时必须提供「标记为已导出」CTA，执行 `POST /api/projects/{id}/transitions {to:"EXPORTED"}` → `refresh()`。转移失败（状态错误）显示错误。`state==EXPORTED` 时显示已导出态 + 回退提示（可回退到 `EXPORT_READY` 继续导出，后端非破坏回退保留产物）。

#### 场景:标记为已导出

- **当** 用户在 `EXPORT_READY` 且有产物，点「标记为已导出」
- **那么** 前端必须执行 `POST /transitions {to:"EXPORTED"}` → 刷新状态为 `EXPORTED`

#### 场景:已导出态显示完成

- **当** `state==EXPORTED`
- **那么** 前端必须显示已导出完成态，保留下载列表，可回退继续导出

### 需求:挂载守卫——错位 state 重定向

导出页 mount 时必须检查 `state`：若属于 `{EXPORT_READY, EXPORTED}` 则留在本页；否则重定向到 `currentStepPath(state)`。`state<EXPORT_READY` 必须重定向到对应前序页。

#### 场景:在 EXPORT_READY 态进入导出页

- **当** 用户在 `EXPORT_READY` 态进入导出页
- **那么** 前端必须 `GET /exports` 拉取列表并展示导出按钮

#### 场景:state 过前重定向

- **当** 用户在 `SLIDE_GENERATION`（未进入导出态）进入导出页
- **那么** 前端必须重定向到 `currentStepPath(SLIDE_GENERATION)` 返回的预览页

### 需求:错误映射与用户可读提示

导出页必须复用 `ApiError`，按 `code` 映射：`INVALID_STATE_TRANSITION` → 刷新提示；`EXPORT_NOT_READY` → 请先物化幻灯片；`EXPORT_VALIDATION_ERROR` → 导出校验失败 + `detailMessage`；`EXPORT_ARTIFACT_NOT_FOUND` → 产物不存在；`NETWORK_ERROR` → 网络失败。不得暴露原始异常。

#### 场景:导出校验失败

- **当** `POST /export` 返回 `EXPORT_VALIDATION_ERROR`(400)
- **那么** 前端必须显示「导出校验失败」+ `detailMessage`，不导航、不留半持久化态
