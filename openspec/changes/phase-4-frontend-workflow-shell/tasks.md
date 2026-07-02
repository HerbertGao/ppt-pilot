## 1. 前端栈与工程基座

- [x] 1.1 引入 Tailwind CSS（配置 `apps/web` 的 tailwind + postcss，迁移/替换 Phase 1 `globals.css`），保证现有 shell 页仍可渲染
- [x] 1.2 初始化 shadcn/ui（Next 16 App Router 方式），仅纳入本期用到的原子组件（button/input/textarea/select/radio/card 等），不整包铺开
- [x] 1.3 在 `apps/web/next.config.mjs` 配 `rewrites()`：`/api/:path*` → `${BACKEND_URL}/api/:path*`（`BACKEND_URL` 环境变量，默认 `http://localhost:8000`）；在 README/env 文档说明
- [x] 1.4 `package.json` 新增依赖（tailwind/postcss、shadcn/radix、测试库、可选 zustand）；确认 Dependabot 覆盖 `apps/web`
- [x] 1.5 验收：`pnpm --filter @ppt-pilot/web typecheck` 与 `smoke-start` 通过

## 2. web-workflow-shell：API 客户端 + 状态/错误/加载

- [x] 2.1 `apps/web/src/lib/api.ts`：类型安全 `fetch` 封装，请求/响应类型取自 `@ppt-pilot/shared-schema` + 前端本地类型（问题卡/置信度视图）；非 2xx 解析 `{error,code,details}` 抛结构化错误
- [x] 2.2 统一错误呈现：按 `code` 映射——Phase 3 码（`INVALID_SCENE`/`STYLE_PROFILE_MISMATCH`→字段错误、`QUESTION_NOT_FOUND`→会话失效、显式重启澄清（不自动 discover）、`SPEC_NOT_CONFIRMABLE`→回退引导、`SPEC_VALIDATION_ERROR`→校验未过、`LLM_PROVIDER_ERROR`→「AI 暂不可用，可重试」）+ 因驱动 transitions 会遇到的 Phase 2 码（`INVALID_STATE_TRANSITION`/`INVALID_WORKFLOW_STATE`→「状态不同步，请刷新」、`PROJECT_NOT_FOUND`、`INVALID_REQUEST_BODY`）；未知 code 兜底显示 `details.message`；全局加载态组件
- [x] 2.3 App Router 布局壳：顶部显示当前 `WorkflowState` 与场景/风格；未确认不暴露后续阶段入口
- [x] 2.3a **前向转移驱动**：`NEW→DISCOVERY` 在澄清页 mount 时自动驱动（仅当 NEW，幂等）；`DISCOVERY→REVIEW` **只由澄清页显式「进入复核」动作驱动**（transition 成功后再导航到复核页），**复核页 mount 不驱动任何转移**；复核页若 `state != REQUIREMENT_REVIEW` **一律重定向回澄清页**（不转移、不显示确认）。确认按钮可用性由「当前 `state==REQUIREMENT_REVIEW`」决定；转移失败按统一错误呈现
- [x] 2.4 场景/风格控件（scene ∈ default/education/corporate；styleProfile 省略走 scene 默认），供立项与 profile 更新复用
- [x] 2.5 状态策略：服务端状态 + URL(`projectId`) 驱动；**不引入 Zustand**，除非出现纯客户端跨组件状态（届时最小引入）

## 3. web-project-creation：立项页

- [x] 3.1 `/`（或 `/new`）立项页：初始请求输入 + 场景/风格选择，调 `POST /api/projects`
- [x] 3.2 成功后携 `projectId` 进入 `/projects/[id]/discovery`
- [x] 3.3 校验错误定位到字段（`INVALID_SCENE`/`STYLE_PROFILE_MISMATCH`），保留输入不清空

## 4. web-requirement-discovery：需求澄清页

- [x] 4.1 `/projects/[id]/discovery`：**mount 若为 `NEW_PROJECT` 先自动 `NEW→DISCOVERY` 再 `discover`；若已是 `REQUIREMENT_REVIEW`（back/手动 URL）重定向到复核页**（见 2.3a）；**`discover` 仅首次进入/用户显式重启时调用——重入用本地状态还原，硬刷新（本地态丢失、无会话读端点）时给「重新开始澄清」显式入口，禁止自动 re-`discover` 覆盖已答/已跳过**；fast/thorough 模式切换，调 `discover` 渲染结构化问题卡（多选 + 可选自由文本，用后端 `questionId`）
- [x] 4.2 逐题 `answer`/`skip`；**answer/skip 只返回置信度视图、不重发 `questions`**，UI 保留已渲染问题卡并用 `confidence`/`threshold`/`thresholdReached` 更新进度
- [x] 4.3 处理 `thresholdReached=true` 或 `questions=[]`：呈现「信息已足够，可进入复核」；**「进入复核」为显式动作且以 `state==DISCOVERY` 为前置——仅当 DISCOVERY 才 `POST transitions {to:REVIEW}` 再导航，已是 REVIEW 只导航不转移**（不假设总有问题）
- [x] 4.4 `QUESTION_NOT_FOUND` 作会话失效处理：显式「重新开始澄清」入口（用户确认后再 discover），**禁止自动 discover 刷新**（会覆盖会话），不卡死

## 5. web-spec-review：Spec review 页

- [x] 5.1 `/projects/[id]/review`：**mount 不驱动任何转移；若 `state != REQUIREMENT_REVIEW` 一律重定向回澄清页**（见 2.3a）；**确认前摘要卡只展示可得字段**（scene/styleProfile/mode/threshold/已答已跳过计数——后端无待确认 Spec 读端点，不虚构 questionPolicy/riskNotes）；mode/threshold/计数为会话本地态，**硬刷新丢失时降级为仅 scene/styleProfile，禁止为补数在复核页重新 `discover`**（会覆盖会话）
- [x] 5.2 确认调 `POST .../requirements/confirm`；成功后用 **confirm 响应**展示完整已确认 Spec（含 questionPolicy/riskNotes）、反映停留 `REQUIREMENT_REVIEW`、展示「已确认」；`SPEC_VALIDATION_ERROR` 提示未通过校验保持未确认
- [x] 5.3 改 profile 动作次序 **rollback-first**：①`REVIEW→DISCOVERY` 回退（复核页据「非 REVIEW 即重定向」把用户带回澄清页）→ ② 在 DISCOVERY 态 `PATCH .../profile` → ③ 重新 `discover` → ④ 用户显式「进入复核」。**`PATCH profile` 只在 DISCOVERY 态发生，禁止在 REVIEW 态 PATCH**。配合复核页「非 REVIEW 即重定向」，会话清空窗口内任何刷新都不产生必失败的确认按钮

## 6. 测试与文档

- [x] 6.1 组件/交互测试（Vitest + React Testing Library 或等价），全程 mock `/api`、不连真实后端/LLM：**全链路（create→[NEW→DISCOVERY 自动]→discover→[显式「进入复核」→DISCOVERY→REVIEW]→confirm，断言 confirm 在 REVIEW 成功）**、**复核页非 REVIEW 态 mount 一律重定向回澄清页、不自动转移、不显示确认**、问题卡渲染、answer/skip 不重发问题且更新置信度、达阈/空问题进入复核、确认前摘要卡只含可得字段/确认后展示完整 Spec、**改 profile rollback-first（PATCH 只在 DISCOVERY，断言 profile 重置窗口内刷新落到 /review 会被重定向、不出现必失败确认）**、**`QUESTION_NOT_FOUND`→显式重启入口而非自动 discover**、各错误态（400/404/409/502，含 `INVALID_STATE_TRANSITION`）不崩溃、立项字段错误定位
- [x] 6.2 `typecheck` + `smoke-start` 纳入 Web CI gate（沿用 Phase 1 分层 CI，不新增门类）
- [x] 6.3 `docs/ROADMAP_PROGRESS.md` 更新 Phase 4 状态；`docs/UI.md` 标注本期已落地页面；README 记 `BACKEND_URL` 与本地联调方式（`next dev` + 后端 `uvicorn`）
- [x] 6.4 运行 `openspec-cn validate` 确认变更产物一致，准备归档
