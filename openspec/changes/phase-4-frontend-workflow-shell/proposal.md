## 为什么

Phase 3 交付了需求澄清与 Spec Builder 的完整后端（`POST/GET /api/projects`、`.../transitions`、`.../requirements/discover|answer|skip|confirm`、`PATCH .../profile`），但 `apps/web` 仍停留在 Phase 1 的静态空壳（只读 shared-schema 导出、无任何业务页面）。用户目前只能用 curl/脚本走流程。

本变更提供**可用的 Next.js Web 流程**，让用户在浏览器里完成：立项（选场景/风格）→ 需求澄清（fast/thorough 问答、作答/跳过、置信度可见）→ 复核并确认 `PresentationSpec`。这是产品「先问再生成、结构化人机协作」第一次有真实界面，也是 Phase 5+（大纲/幻灯片/导出）前端的承载壳。

本期是**纯前端**：只消费 Phase 3 已实现的 API，不改后端、schema、agent。

## 变更内容

- 在 `apps/web` 从 Phase 1 静态空壳扩展出真实工作流页面（Next.js App Router）：
  - **立项页**：填初始请求、选 `scene`（default/education/corporate）与 `styleProfileId`（省略走默认），调 `POST /api/projects`，成功后进入流程；场景/风格控件贯穿。
  - **需求澄清页**：进入时若为 `NEW_PROJECT` 先驱动转移到 `REQUIREMENT_DISCOVERY`（`discover` 无状态守卫且覆盖会话，不能在 NEW 直接调）；`fast`/`thorough` 模式切换；调 `discover` 渲染结构化问题卡（多选 + 可选自由文本，见 `docs/UI.md` §7）；逐题 `answer`/`skip`（注意 answer/skip 只回置信度、不重发问题，UI 保留已渲染卡）；展示 `confidence` / `threshold` / `thresholdReached` 进度；达阈或跳过后进入复核。
  - **Spec review 页**：**进入复核是澄清页的显式动作**（点「进入复核」→先 `POST .../transitions {to:REVIEW}` 再导航到复核页）；**复核页自身 mount 不驱动任何转移，且 `state != REQUIREMENT_REVIEW` 时一律重定向回澄清页**（因后端无会话读端点、无法区分「有会话/被清空会话的 DISCOVERY」，自动推进会造出「无会话 REVIEW」并弹出必失败确认）；**确认前摘要卡只展示可得字段**（scene/style/mode/threshold/已答已跳过计数——完整 `questionPolicy`/`riskNotes` 仅在 `confirm` 响应里）；`confirm` 后用其响应展示完整已确认 Spec；**改 profile 一律 rollback-first**——含「未确认但在 REVIEW」也先回退到 `REQUIREMENT_DISCOVERY`、`PATCH profile` 只在 DISCOVERY 态、再重新澄清，配合复核页重定向使会话清空窗口内刷新不产生必失败确认。
  - **工作流状态展示与前向转移**：`discover/answer/skip/confirm` 均不推进状态，进入 `REQUIREMENT_REVIEW` 的唯一途径是显式 `POST .../transitions`；`NEW→DISCOVERY` 在澄清页 mount 时自动驱动，`DISCOVERY→REVIEW` **只由澄清页显式「进入复核」动作驱动（且仅当处于 DISCOVERY）**，复核页不自动转移；shell 显示当前 `WorkflowState`，未确认不暴露后续阶段入口。
- 新增**类型安全的 API 客户端**：以 `@ppt-pilot/shared-schema` 的 TS 类型描述请求/响应，统一处理 Phase 2/3 的错误信封（`{error,code,details}`）与 HTTP 状态（400/404/409/502）——含 Phase 3 码与因驱动 transitions 会遇到的 Phase 2 码（`INVALID_STATE_TRANSITION`/`INVALID_WORKFLOW_STATE`/`PROJECT_NOT_FOUND`/`INVALID_REQUEST_BODY`）+ 未知码兜底；提供全局**加载态/错误态**呈现（含 `LLM_PROVIDER_ERROR` 502 的友好提示）。
- 采用前端栈（按 `docs/ARCHITECTURE.md`）：Tailwind CSS + shadcn/ui 最小组件集；**状态管理优先用服务端状态 + URL 参数**（后端已持有会话态），仅在确有纯客户端跨组件状态时才引入 Zustand（由 design 裁定，避免过度引入）。
- 跨域：用 **Next.js rewrites 将 `/api/*` 代理到后端**（后端地址经环境变量注入），保持本期纯前端、不改后端 CORS。
- 新增前端校验：typecheck + 针对**被 mock 的 API** 的组件/交互测试（渲染问题卡、作答更新置信度、确认摘要、错误态呈现）；沿用 Phase 1 的 Web CI gate 与 `smoke-start`。

非目标：

- 不做画布编辑器（Konva/元素选择/拖拽/缩放）——归属 Phase 8。
- 不做 outline / slide plan / slide 预览 / PPTX 导出的任何界面——归属 Phase 5–7。
- 前端不含任何真实 AI 逻辑，只调 Phase 3 后端；不新增后端端点、schema、agent。
- 不做移动端完整编辑器（仅桌面流程；移动 review/chat 为后续，且不实现拖拽/缩放）。
- 不做鉴权/多租户；不做锁定、版本、局部再生、图片候选界面。
- 不改后端 CORS、不改 Phase 3 API 契约。

## 功能 (Capabilities)

### 新增功能

- `web-workflow-shell`: App Router 布局与导航、`WorkflowState` 状态展示、类型安全 API 客户端（消费 shared-schema 类型 + 统一错误信封/HTTP 状态映射 + 全局加载/错误态）、`/api` rewrite 代理、场景/风格控件基座。
- `web-project-creation`: 立项页——初始请求输入、scene/styleProfile 选择、`POST /api/projects`、结果与校验错误（`INVALID_SCENE`/`STYLE_PROFILE_MISMATCH`）呈现。
- `web-requirement-discovery`: 需求澄清页——fast/thorough 切换、`discover` 问题卡渲染、逐题 `answer`/`skip`、置信度/阈值进度、达阈/跳过后进入复核。
- `web-spec-review`: Spec review 页——Spec 摘要卡、`confirm` 确认（停留 `REQUIREMENT_REVIEW`）、改 profile 的 **rollback-first（一律先回退，含未确认在 REVIEW）** 处理、以及复核页「非 REVIEW 即重定向」与 `SPEC_NOT_CONFIRMABLE` 处理。

### 修改功能

（无。后端 API / schema / agent 均不改动；本期只在 `apps/web` 消费 Phase 3 契约。）

## 影响

- 网页端（web）
  - `apps/web`：新增 App Router 路由（立项/澄清/复核）、API 客户端模块、组件、样式（Tailwind + shadcn/ui）、可选 Zustand、`next.config.mjs` 的 `/api` rewrite、组件/交互测试。
  - `apps/web/package.json` 新增前端依赖（tailwind、shadcn/radix、可选 zustand、测试库）；由 Dependabot 覆盖。
- 模式（schema）
  - 只**消费** `@ppt-pilot/shared-schema` 的 TS 类型作为 API 请求/响应契约，不改 schema。
- 后端路由（API）/ 代理（agent）/ 导出模块（exporter）
  - 不涉及；前端仅调用 Phase 3 已实现端点。
- 事件（event）/ 版本（version）/ 锁定（lock）
  - 不实现运行时；事件由后端在既有端点内产生，前端不直接写事件。
- CI / 依赖
  - 沿用 Phase 1 的 Web gate（typecheck/build/test）与分层 CI；本期为其填充真实前端测试，不新增 CI 门类。
- 文档
  - `docs/UI.md` 为设计参考；实现后更新 `docs/ROADMAP_PROGRESS.md` 的 Phase 4 状态，并在 `docs/UI.md` 标注本期已落地的页面。
- 验证方式
  - typecheck 通过；组件/交互测试（mock API）覆盖问题卡渲染、作答置信度更新、确认摘要、各错误态（400/404/409/502）呈现无崩溃；`smoke-start` 保证 Next 应用可启动；后端契约由 Phase 3 契约测试保证，前端不重复测后端。
