## 1. 共享 schema 扩展（shared-schema-contract）

- [x] 1.1 `packages/shared-schema/src/types.ts` 新增 canonical `ExportArtifact { id, projectId, format:"pptx", bytesBase64, byteSize, sourcePresentationId, createdBy: ActorType, createdAt }`（基础字段；不改既有类型）
- [x] 1.2 `enums.ts` 新增 `EVENT_TYPES`：**仅 `PRESENTATION_EXPORTED`**（不加其他——本期唯一发射方 `export`；与 1.3 payload case 同批提交，避免 fail-open 漏写）；如需 `EXPORT_FORMATS` 常量（`["pptx"]`）可一并加
- [x] 1.3 `validation.ts` 新增 `validateExportArtifact`（**结构校验**：`format=="pptx"`、`byteSize` 整数 `≥1`、`bytesBase64` 非空且匹配 base64 字符集正则、必填齐备；**不在校验器里 decode base64**——`byteSize==解码长度` 是服务侧不变量非校验器职责）并登记 `ExportArtifact` 进 `ENTITY_NAMES`（`validation-constants.ts`）/ `EntityMap` / `validateEntity` 分发 / **`runtimeValidationEntrypoints`**（`satisfies Record<EntityName,string>`，缺键 typecheck 失败）；`validateEventPayload` 加 `PRESENTATION_EXPORTED` case（`{artifactId:string, format:"pptx", byteSize:int min 1, nextState∈WORKFLOW_STATES}`）并保持 **fail-closed** default；**复用**既有 `validatePresentation` 等不改行为
- [x] 1.4 新增 fixtures：`ExportArtifact` valid/invalid（缺字段 / `byteSize<1` / `bytesBase64` 空或含非 base64 字符）、`PRESENTATION_EXPORTED` 事件 valid（`nextState:"EXPORT_READY"`）/invalid（缺 `artifactId`/`byteSize`）；纳入 `schema-validation-fixtures`；确认 Phase 1–6 既有 fixtures 零回归
- [x] 1.5 验收：`pnpm --filter @ppt-pilot/shared-schema typecheck` 与 `validate:fixtures` 通过

## 2. 工作流边表与回退（workflow-state-machine）

- [x] 2.1 `apps/api/app/workflow.py` 向 `TRANSITION_EDGES` 加入前向边 `SLIDE_GENERATION→EXPORT_READY`、`EXPORT_READY→EXPORTED` 与回退边 `EXPORT_READY→SLIDE_GENERATION`、`EXPORTED→EXPORT_READY`；`EDITING`/`REVIEW` 边仍不加
- [x] 2.2 `execute_transition` 内导出阶段回退 **None-safe 且非破坏**：`EXPORTED→EXPORT_READY`、`EXPORT_READY→SLIDE_GENERATION` 仅回退状态，**保留** `project.exports` 与 `project.presentation`（不删产物、不解引用 None）
- [x] 2.3 `repository.py`/`StoredProject` 增字段 `exports: list[Any]`（默认 `[]`，经 `validateEntity` 规范化的 dict 列表）
- [x] 2.4 保持边表 LLM-free 且结构化（前向边不加内容守卫）；`assert_state_machine_consistent` 仍成立
- [x] 2.5 `main.py --selfcheck`：**先把现有「`SLIDE_GENERATION→EXPORT_READY` 为 `INVALID_STATE_TRANSITION`(409)」的断言改为合法前向**（该边本期起合法；改时 `EDITING` 仍须留在非法集，且不得破坏其后（`main.py:285+`）依赖 `SLIDE_GENERATION` 态的下游回退链断言）；再增断言 `SLIDE_GENERATION→EXPORT_READY→EXPORTED` 可走且追加事件；「只转移不导出」到达空 `presentation` 的 `EXPORT_READY` 后 `export` 以 `EXPORT_NOT_READY` 拒绝；`EXPORTED→EDITING` 仍 `INVALID_STATE_TRANSITION`；导出阶段回退保留 exports/presentation 不崩溃

## 3. 后端导出服务 + API + 错误（pptx-export）

- [x] 3.1 后端加 `python-pptx` 依赖（`apps/api/pyproject.toml`），锁定版本；确认纯本地无网络
- [x] 3.2 `apps/api/app/export.py` 服务层（仿 `presentation.py`，**无 agent/LLM**）：`export` 前置**二分**——`state != EXPORT_READY` → `_wrong_state`/`INVALID_STATE_TRANSITION`(409 清 `field`)；`EXPORT_READY` 但 `presentation is None` 或 `slides` 空 → `EXPORT_NOT_READY`(409)；均 None-safe。从持久化 `Presentation` 确定性生成 pptx `bytes`
- [x] 3.3 几何/类型映射（design D3/D4）：**导出器常量 `CANVAS_W=1280`/`CANVAS_H=720` + 精确 `SLIDE_W_EMU=12192000`/`SLIDE_H_EMU=6858000`**（不用 `Inches(13.333)`）整数 `Emu` 缩放、`zIndex` 升序添加、finite 守卫、超画布允许溢出；`text`→文本框写 **`str(content.get("text") or "")`**、**其余全部类型（含 `icon`/`group`，一个 `else`）→带类型标注占位矩形（全覆盖 8 类，禁止只枚举部分）**；`theme`→背景/字体/描边色（**逐色 `lstrip("#")`+try 回退默认不抛**）；`width/height==0`→`Emu(0)` 退化 shape；锁不强制、全部元素渲染；**`core_properties.created/modified/title` 等显式置确定性 sentinel**（否则确定性断言 flaky）
- [x] 3.4 组装 `ExportArtifact`（`id=f"{presentation.id}_export_{n}"`、`n=len(project.exports)+1`、`byteSize=len(bytes)`、`sourcePresentationId`、确定性 `createdAt`）；**持久化前先 `validate_shared_schema_entity("ExportArtifact")`** → 不过 → `EXPORT_VALIDATION_ERROR`(400，继承 `ValidationError` base) 零持久化；`python-pptx` 真抛错 → 落既有 `INTERNAL_ERROR`(500) catch-all（**不新增 500 业务码、不改 `_STATUS_BY_ERROR`**）
- [x] 3.5 事件 validate-before-append：`PRESENTATION_EXPORTED` payload `{artifactId, format, byteSize, nextState}`，**`nextState=EXPORT_READY`（当前态）**；全部校验先于写故失败零持久化；通过则 append 事件 → 追加 `ExportArtifact` 到 `project.exports`；**导出动作不推进状态**（停在 `EXPORT_READY`，不追加 `WORKFLOW_STATE_CHANGED`；`EXPORTED` 由独立 `/transitions` 完成）
- [x] 3.6 `routes.py` 挂 `POST /projects/{id}/export`、`GET /projects/{id}/export/{artifactId}`（正确 PPTX MIME 流式下载、`Content-Length==byteSize`，无则 `EXPORT_ARTIFACT_NOT_FOUND`/404）、`GET /projects/{id}/exports`（**仅元数据，禁止含 `bytesBase64`**）
- [x] 3.7 `errors.py` 新增 `EXPORT_NOT_READY`(←StateError/409)、`EXPORT_ARTIFACT_NOT_FOUND`(←NotFoundError/404)、`EXPORT_VALIDATION_ERROR`(←ValidationError/400)；错误状态调用复用既有 `InvalidStateTransitionError`(409)；**不新增 500 业务码、不改 `main.py` 状态表**（`python-pptx` 崩溃走既有 catch-all 500）
- [x] 3.8 单测：导出成功（**重开 pptx 断言**幻灯片数/ shape 与 `elements` 对应/文本内容/几何缩放/`core_properties` sentinel）+ 产物过 `validateEntity("ExportArtifact")` + **服务侧断言 `byteSize==len(bytes)`**、下载读回（MIME/Content-Length）、列举**仅元数据不含 base64**、错误状态→`INVALID_STATE_TRANSITION`(409)、未物化/空 slides→`EXPORT_NOT_READY`(409)、产物校验失败→`EXPORT_VALIDATION_ERROR`(400) 零持久化、重复导出追加重放安全、**`icon`/`group`→占位矩形不 KeyError**、导出不推进状态（停 `EXPORT_READY`）、`EXPORTED` 经独立转移、导出阶段回退保留 exports

## 4. 测试、文档与验证

- [x] 4.1 端到端 pytest（无 LLM/网络）：`确认规划 → materialize →[transition]→ EXPORT_READY → export（停 EXPORT_READY）→ GET download →[transition]→ EXPORTED` 全链，断言产物结构不变量、事件序列（`PRESENTATION_EXPORTED` `nextState=EXPORT_READY`，随后独立 `WORKFLOW_STATE_CHANGED` 到 `EXPORTED`）、下载 MIME/大小、`EXPORT_READY→SLIDE_GENERATION`/`EXPORTED→EXPORT_READY` 回退保留 presentation/exports、错误状态 export→`INVALID_STATE_TRANSITION`、未就绪 export→`EXPORT_NOT_READY`、下载不存在→404
- [x] 4.2 `docs/ARCHITECTURE.md`（导出服务落地：python-pptx、消费同一模型、结构不变量确定性）、`docs/DATA_MODEL.md`（`ExportArtifact` + `PRESENTATION_EXPORTED` 事件 + 几何映射与占位约定）、`docs/WORKFLOW.md`（`SLIDE_GENERATION→EXPORT_READY→EXPORTED` 前向/回退 + 非破坏 exports）更新
- [x] 4.3 `docs/ROADMAP_PROGRESS.md` 更新 Phase 7 状态
- [x] 4.4 `pnpm --filter @ppt-pilot/shared-schema` 校验 + `apps/api` pytest + `main.py --selfcheck` 全绿；无 Phase 1–6 回归
- [x] 4.5 运行 `openspec-cn validate phase-7-pptx-export` 确认产物一致，准备实现/归档
