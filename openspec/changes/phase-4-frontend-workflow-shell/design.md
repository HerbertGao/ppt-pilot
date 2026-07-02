## 上下文

Phase 3 交付了需求澄清/Spec Builder 的后端 API（含真实 LLM），后端**持有会话态**（`StoredProject.discovery`、`.spec`）。`apps/web` 目前是 Phase 1 静态空壳（Next.js App Router + 纯 CSS，仅 react/next/shared-schema 三个依赖，无 Tailwind/shadcn/Zustand）。Phase 4 在这个壳上建真实工作流页面，纯前端消费 Phase 3 端点。

约束：不改后端/schema/agent；桌面优先（`docs/UI.md`）；错误信封复用 Phase 2/3 的 `{error,code,details}`；确认停留 `REQUIREMENT_REVIEW`、改 profile 需先回退等后端语义前端只**遵循与提示**、不绕过。

## 目标 / 非目标

**目标：**

- 浏览器内走通 立项 → 需求澄清（fast/thorough 问答、作答/跳过、置信度可见）→ 复核确认 Spec。
- 类型安全 API 客户端，统一错误/加载态；`WorkflowState` 驱动页面可达性。
- 前端栈落地（Tailwind + shadcn/ui 最小集），状态尽量交给服务端。

**非目标：**

- 画布编辑器、outline/slide/预览/导出界面、真实 AI、鉴权、锁定/版本/图片候选、移动端完整编辑（见 proposal 非目标）。

## 决策

### D1：纯前端 + Next rewrites 代理 `/api`，不改后端 CORS

`apps/web/next.config.mjs` 配 `rewrites()` 把 `/api/:path*` 代理到后端（地址经 `BACKEND_URL` 环境变量，默认 `http://localhost:8000`）。前端一律请求同源 `/api/...`。
- 备选：给 FastAPI 加 CORS 中间件 → 否决：那是后端改动，破坏本期「纯前端」边界；rewrite 让开发/部署都同源，更简单。

### D2：状态优先服务端 + URL，Zustand 按需

后端已是会话态的唯一真相源。前端页面以 `projectId`（URL 段）+ 每页拉取的服务端响应驱动：立项拿 `projectId`；澄清页用 `discover` 的返回（含 `confidence`/`threshold`/`thresholdReached`/`questions`）——注意 **`answer`/`skip` 只返回会话视图（`confidence`/`threshold`/`thresholdReached`），不返回 `questions`**，UI 保留已渲染的问题卡并按新置信度更新进度，不期待作答重发问题列表；复核页用 `confirm` 的响应（`GET project` 只有 scene/style/status）。
- 仅当出现「纯客户端、跨组件、服务端往返无法覆盖」的状态时才引入 Zustand（如乐观 UI 的本地草稿）。默认不引入，避免与后端会话态双源。
- 备选：一上来全局 Zustand store 镜像后端态 → 否决：制造双真相源与同步 bug，YAGNI。

### D3：路由/页面 + 前端必须驱动前向工作流转移

- `/`（或 `/new`）：立项页 → `POST /api/projects`（`NEW_PROJECT`）。
- `/projects/[id]/discovery`：需求澄清页。**进入时仅当为 `NEW_PROJECT` 才自动 `POST /api/.../transitions {to:"REQUIREMENT_DISCOVERY"}` 再按 discover 规则处理**（`discover` 无状态守卫且覆盖会话，不能在 `NEW_PROJECT` 直接调；`NEW_PROJECT` 是安全入口，无「被清空会话」态）。**「进入复核」是本页的显式用户动作**：点按后先 `POST transitions {to:"REQUIREMENT_REVIEW"}` 成功、再导航到复核页。
- `/projects/[id]/review`：Spec review 页。**不在 mount 时驱动任何转移**；mount 时若 `state != REQUIREMENT_REVIEW` **一律重定向回澄清页**（不转移、不显示确认）。只有已是 `REQUIREMENT_REVIEW` 才渲染确认。确认按钮由「当前 `state==REQUIREMENT_REVIEW`」决定。
- **关键约束 + 为何复核页不自动推进**：`discover`/`answer`/`skip`/`confirm` 都不推进状态，进入 `REVIEW` 的唯一途径是显式 `transitions`。由于后端无「会话读端点」，前端**无法**从 `GET project`（只有 `status`）区分「有会话的 DISCOVERY」与「profile 重置后被清空会话的 DISCOVERY」——若复核页在 mount 时自动 `DISCOVERY→REVIEW`，就会把后者推进成「无会话的 REVIEW」并弹出必被 `SPEC_NOT_CONFIRMABLE` 拒绝的确认按钮。故 `DISCOVERY→REVIEW` 只由澄清页的显式动作驱动、复核页非 REVIEW 一律重定向，从结构上杜绝该态（不依赖异步导航时序）。顶部 shell 显示 `WorkflowState`，未确认不暴露后续阶段入口。

### D4：类型安全 API 客户端 + 统一错误映射

`apps/web/src/lib/api.ts`：薄 `fetch` 封装，请求/响应类型取自 `@ppt-pilot/shared-schema`（`PresentationSpec`/`QuestionPolicy`/`Scene` 等）+ 前端本地类型描述瞬时响应（问题卡、置信度视图——这些是 Phase 3 的瞬时响应，非 canonical 实体）。非 2xx 一律解析 `{error,code,details}`，抛结构化错误；UI 层按 `code` 呈现。Phase 3 码：`INVALID_SCENE`/`STYLE_PROFILE_MISMATCH`→表单字段错误；`QUESTION_NOT_FOUND`→会话失效、显式重启澄清（不自动 discover 刷新，会覆盖会话）；`SPEC_NOT_CONFIRMABLE`→提示先回退；`SPEC_VALIDATION_ERROR`→Spec 未过校验；`LLM_PROVIDER_ERROR`(502)→「AI 服务暂不可用，可重试」。**因本期驱动 `transitions`，还会遇到 Phase 2 码**：`INVALID_STATE_TRANSITION`/`INVALID_WORKFLOW_STATE`（409/400）、`PROJECT_NOT_FOUND`(404)、`INVALID_REQUEST_BODY`(400)——这些至少走兜底展示，转移相关的两码给「状态不同步，请刷新」类可读提示。未知 code 一律兜底显示 `details.message`。全局加载态。

### D5：UI 栈——Tailwind + shadcn/ui 最小集

采用 Tailwind 做样式基线（迁移/替换 Phase 1 的 `globals.css`），shadcn/ui 仅引入本期用到的原子组件（button/input/select/card/radio 等），不整包铺开。
- 备选：手写全部组件 → 否决：可访问性（focus/aria）自己维护成本高，shadcn 是「已解决」的无头组件。
- 备选：引入更重的组件库（MUI 等）→ 否决：体量与定制成本不匹配一个 workflow 壳。

### D6：测试——mock API 的组件/交互测试

组件/交互测试（Vitest + React Testing Library，或等价）驱动 mock 过的 `/api`：渲染问题卡、作答后置信度更新、达阈进入复核、确认摘要、各错误态（400/404/409/502）不崩溃。**CI 不连真实后端、不发真实 LLM**。后端契约由 Phase 3 契约测试保证，前端不重复测。`smoke-start` 保证应用可启动。

## 风险 / 权衡

- [前向状态不推进 → confirm 必被拒] → `discover/answer/skip/confirm` 都不改状态，前端必须显式驱动 `transitions`：`NEW→DISCOVERY` **仅在澄清页 mount（NEW 态）自动**，`DISCOVERY→REVIEW` **仅由澄清页守卫过的「进入复核」动作**（复核页不自动转移、非 REVIEW 即重定向）；否则 review 页的 confirm 恒 `SPEC_NOT_CONFIRMABLE`、状态栏冻在 `NEW_PROJECT`（见 web-workflow-shell 前向转移需求 + D3）。
- [无「读取待确认 Spec」端点] → `GET project` 只有 scene/style/status，完整 `questionPolicy`/`riskNotes` 仅在 `confirm` 响应里。确认前摘要卡只展示可得字段（scene/style/mode/threshold/已答已跳过计数），完整 Spec 在确认后用 confirm 响应展示；本期不加后端读取端点（纯前端边界，见 web-spec-review）。
- [会话态易被清空/覆盖，且无读端点] → 后端两处会清/覆盖 `project.discovery`：`discover` 每次调用全新覆盖；`PATCH .../profile` 每次成功清空会话+spec 但**不改状态**。派生规则：①`discover` 只首次/显式重启调用，硬刷新给显式重启入口（不静默覆盖，见 web-requirement-discovery）；②**改 profile 一律 rollback-first**——先回退 `REVIEW→DISCOVERY` 再在 DISCOVERY 态 `PATCH profile` 再重新 discover，绝不在 REVIEW 态直接改（否则持久化「无会话的 REVIEW」，刷新后弹出必被 `SPEC_NOT_CONFIRMABLE` 拒绝的确认按钮，且 `GET project` 无法区分它与可确认 REVIEW），见 web-spec-review。本期不加会话读端点。
- [已确认态刷新不可恢复] → `GET project` 不返回 `confirmedByUser`，硬刷新后无法得知项目已确认，退化为可确认复核页；再次确认幂等安全（后端重建 spec、追加事件），本期接受此退化。
- [discover 可能返回 `questions: []`（置信度已达阈）] → 前端必须处理「无问题、直接可进复核」的分支，不能假设总有问题；澄清页据 `thresholdReached` 呈现「信息已足够，可复核」。
- [QUESTION_NOT_FOUND] → 作会话失效处理：显式「重新开始澄清」入口，禁止自动 `discover` 刷新（会覆盖会话）。
- [错误码映射不全 → 生硬报错] → API 客户端对未知 `code` 有兜底展示（显示 `error`/`details.message`），不白屏。
- [rewrite 后端地址缺失/后端未起] → 请求失败按网络错误统一呈现「后端不可达」，并在 README/env 文档说明 `BACKEND_URL`。
- [新增前端依赖体量] → 只引入本期用到的 shadcn 组件与 Tailwind；Zustand 默认不引入；Dependabot 覆盖。
- [与后续阶段一致性] → 本期不产出 slide/preview/导出，无导出一致性面；页面壳与状态模型为 Phase 5+ 复用而设计（路由与 `WorkflowState` 驱动可扩展到 outline/slide 阶段）。

## 迁移计划

- 纯增量：新增路由与模块，替换 Phase 1 占位页；无数据迁移、无后端改动。
- 部署：前端需 `BACKEND_URL` 指向运行中的 Phase 3 后端；本地 `next dev` + 后端 `uvicorn`。
- 回滚：回退本变更即恢复 Phase 1 空壳；后端不受影响。

## 待解决问题

- 测试框架选型（Vitest vs Jest）与 Next 16/React 19 的兼容细节，实现阶段确定，不写入契约。
- shadcn/ui 在 Next 16 App Router 下的初始化方式（组件目录、主题 token）实现阶段定。
