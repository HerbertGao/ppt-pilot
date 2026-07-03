# ROADMAP 实施进度（按技术实现分期）

> 说明：本仓库的 OpenSpec 配置为中文语境，按 `openspec-cn` 流程推进。分期以技术依赖顺序为准，不以最终产品体验顺序为准。

## 1. 当前判断

- 已完成：`Phase 0`（文档与架构理解）
- 已完成并归档：`Phase 1`（工程底座、monorepo、shared schema），归档件位于 `openspec/changes/archive/2026-07-02-phase-1-foundation-monorepo-and-shared-schema`
- 已完成并归档：`Phase 2`（后端 API 与工作流状态机），归档件位于 `openspec/changes/archive/2026-07-02-phase-2-api-skeleton-and-workflow-state`；已合并 PR #9
- 已完成并归档：`Phase 3`（需求澄清与 Spec Builder），归档件位于 `openspec/changes/archive/2026-07-02-phase-3-requirement-discovery-and-spec-builder`；已合并 PR #10。需求发现/作答/跳过/确认与 `PATCH .../profile` 已实现，确认停留在 `REQUIREMENT_REVIEW`（不推进状态），真实 LLM 链路已验证（OpenRouter/DeepSeek）
- 已完成并归档：`Phase 4`（前端工作流壳），归档件位于 `openspec/changes/archive/2026-07-02-phase-4-frontend-workflow-shell`；已合并 PR #12。Next.js 立项、需求澄清、Spec review 页与状态壳已落地，前端工作流规则（前向转移驱动、复核页非 REVIEW 即重定向、改 profile rollback-first）与 mock `/api` 的组件/交互测试（Vitest 40 项）均已实现
- 已完成并归档：`Phase 5`（大纲与 Slide Plan），归档件位于 `openspec/changes/archive/2026-07-03-phase-5-outline-and-slide-planning`；已合并 PR #20。Outline Agent、Slide Planner Agent、大纲/规划 HTTP 端点（generate/update/confirm/get）、`REQUIREMENT_REVIEW→OUTLINE_GENERATION→OUTLINE_REVIEW→SLIDE_PLANNING→SLIDE_PLAN_REVIEW` 前向链与回退边（None-safe 清空下游）、6 个新事件类型、`Outline` 实体与 `VisualIntent` 枚举均已落地；后端 pytest（156）与 `--selfcheck` 全绿，shared-schema fixtures（30）通过
- 实现完成待评审/归档：`Phase 6`（HTML 预览与 Slide Model），change 位于 `openspec/changes/phase-6-html-preview-and-slide-model`。确定性 Slide 物化服务（`POST .../slides/materialize`、`GET .../presentation`）、`SLIDE_PLAN_REVIEW→SLIDE_GENERATION` 前向边与 `SLIDE_GENERATION→SLIDE_PLAN_REVIEW` None-safe 回退清空、`SLIDES_MATERIALIZED` 事件、`ThemeTokens` 类型与校验、`packages/ppt-engine` 纯函数 HTML 渲染器（`renderSlide`/`renderPresentation` + 主题→CSS 白名单 + 缩略图占位 + golden fixtures）、跨语言共享 golden 均已落地；无 LLM、无网络、本期无 Asset（`image` 意图落 `shape`）。分层 CI 新增 ppt-engine gate。后端 pytest 与 `--selfcheck`、shared-schema fixtures、ppt-engine typecheck/test 全绿
- 实现完成待评审/归档：`Phase 7`（PPTX 导出），change 位于 `openspec/changes/phase-7-pptx-export`。后端 `python-pptx` 进程内导出服务（`apps/api/app/export.py`，无 LLM/无网络，消费同一 `Presentation` 模型）、`POST .../export`（不推进状态，停 `EXPORT_READY`）/`GET .../export/{id}` 下载（PPTX MIME + `Content-Length==byteSize`）/`GET .../exports`（仅元数据不含字节）、`SLIDE_GENERATION→EXPORT_READY→EXPORTED` 前向边与 `EXPORT_READY→SLIDE_GENERATION`/`EXPORTED→EXPORT_READY` None-safe 非破坏回退（保留 exports/presentation）、`ExportArtifact` 类型与结构校验（四处登记）、`PRESENTATION_EXPORTED` 事件（validate-before-append，`nextState==EXPORT_READY`）、几何 1280×720→精确 16:9 EMU 缩放与全 8 类 `ElementType` 占位全覆盖、`core_properties` 确定性 sentinel 均已落地；确定性以「重开 pptx 结构不变量」表达（非字节级 golden）。后端 pytest（193）与 `--selfcheck`、shared-schema typecheck/fixtures 全绿
- 当前后续：`Phase 6`、`Phase 7` 主控评审通过后归档
- AI 首次进入：`Phase 3`（文本 LLM，走 OpenRouter，藏在 `LLMProvider` 接口后）；Phase 3–8 只需文本 LLM
- 文生图（`ImageProvider`，第三方 API）推迟到 `Phase 9`，与 `LLMProvider` 并列，选型到 Phase 9 再定。详见 `docs/ARCHITECTURE.md` §5 Model Providers
- 已废弃：旧 `phase-1-requirement-discovery-mvp` 提案
- 原因：需求澄清依赖共享 schema、API 状态机、事件模型与基础工程结构，不应作为技术实现第一期

## 2. 技术分期状态

| 阶段 | 名称 | 技术目标 | 状态 | 建议 OpenSpec 变更 | 关键验收 |
| --- | --- | --- | --- | --- | --- |
| Phase 0 | 文档与架构 | 建立产品、架构、数据模型、工作流与 OpenSpec 语境 | 已完成 | - | 文档可指导 AI agent 与人工协作 |
| Phase 1 | 工程底座与共享契约 | 建立 monorepo、前后端空壳、`packages/shared-schema`、schema 校验、Dependabot 与分层 CI | 已完成并归档 | `phase-1-foundation-monorepo-and-shared-schema` | 仓库可安装/启动；共享 schema 可生成类型并校验样例；文档 PR 不触发全量 CI |
| Phase 2 | 后端 API 与工作流状态机 | FastAPI、项目生命周期、状态流转、事件写入、错误约定 | 已完成并归档 | `phase-2-api-skeleton-and-workflow-state` | 创建项目与状态推进可运行；非法状态不写持久状态 |
| Phase 3 | 需求澄清与 Spec Builder | Requirement Discovery Agent、问题策略、跳过风险、Spec 确认 | 已完成并归档 | `phase-3-requirement-discovery-and-spec-builder` | 模糊输入可生成可确认的 `PresentationSpec` |
| Phase 4 | 前端工作流壳 | Next.js 立项、需求澄清、Spec review、状态展示 | 已完成并归档 | `phase-4-frontend-workflow-shell` | 用户可在 Web 中完成创建、问答与 Spec 确认 |
| Phase 5 | 大纲与 Slide Plan | Outline Agent、Slide Planner Agent、可编辑结构 | 已完成并归档 | `phase-5-outline-and-slide-planning` | 确认 Spec 后可生成并编辑 outline/slide plan |
| Phase 6 | HTML 预览与 Slide Model | 结构化 slide JSON、主题 token、HTML preview renderer | 实现完成待评审/归档 | `phase-6-html-preview-and-slide-model` | 同一结构化模型可渲染预览 |
| Phase 7 | PPTX 导出 MVP | PPTX export、下载、结构不变量确定性 | 实现完成待评审/归档 | `phase-7-pptx-export` | 可从结构化数据导出 PPTX |
| Phase 8 | Canvas 编辑与锁定 | 画布编辑、元素编辑、slide/element lock、锁定写保护 | 未启动 | `phase-8-canvas-editing-and-lock-model` | 用户可微调；AI 写入不能修改锁定目标 |
| Phase 9 | 局部再生与图片候选 | text/image/layout scope 再生、图片多候选、版本快照 | 未启动 | `phase-9-partial-regeneration-and-image-variants` | 只修改用户允许的未锁定范围 |
| Phase 10 | 版本、审阅与质量 | version history、diff、Review Agent、重复率告警 | 未启动 | `phase-10-versioning-review-and-quality` | 可回退、可审阅、可发现质量问题 |

## 3. 当前 OpenSpec 状态

- 当前不应继续旧提案：`phase-1-requirement-discovery-mvp`
- 已归档提案：`phase-1-foundation-monorepo-and-shared-schema`、`phase-2-api-skeleton-and-workflow-state`、`phase-3-requirement-discovery-and-spec-builder`、`phase-4-frontend-workflow-shell`、`phase-5-outline-and-slide-planning`
- 进行中的 change：`phase-6-html-preview-and-slide-model`、`phase-7-pptx-export`（均实现完成，待主控评审与归档）
- 下一提案：`phase-8-canvas-editing-and-lock-model`
- 旧提案中的场景、风格、fast/thorough、跳过问题等内容保留为产品方向，但实现归属调整到 Phase 3

## 4. Phase 1 推荐 TODO

- [x] 初始化 monorepo 目录：`apps/web`、`apps/api`、`packages/shared-schema`、`packages/ai-workflow`、`packages/ppt-engine`、`packages/exporter`
- [x] 建立 TypeScript workspace 与基础脚本
- [x] 建立 FastAPI 空壳与健康检查接口
- [x] 在 `packages/shared-schema` 定义第一版核心实体：`PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`StyleProfile`、`Version`、`Event`
- [x] 为 shared schema 准备 JSON Schema 输出或等价校验入口
- [x] 补充 fixtures：默认项目、无效 scene、无效 styleProfile 归属、无效实体引用、默认 profile 回退、最小 slide plan
- [x] 补充最小测试或验证命令，证明 schema 校验可运行
- [x] 添加 Dependabot 配置，覆盖 npm/pnpm、Python、GitHub Actions
- [x] 添加分层 CI，明确 docs/OpenSpec、shared-schema、Web、API、Dependabot PR 的准入标准
- [x] 用 OpenSpec 新建 `phase-1-foundation-monorepo-and-shared-schema`
- [x] 完成 `phase-1-foundation-monorepo-and-shared-schema` 实现评审/验收准备
- [x] 完成 `phase-1-foundation-monorepo-and-shared-schema` 主控验收并归档
- [ ] 后续 DX：单独评估格式化策略、format check 与提交前钩子（例如 Prettier / lint-staged / simple-git-hooks），不要混入阶段实现修复

## 5. 执行规则

1. 每个阶段先创建独立 OpenSpec change。
2. 涉及数据模型、API、agent 输出、锁定、导出一致性的改动必须写 specs。
3. 每个阶段只实现当前技术依赖，不提前把后续产品能力塞进本期。
4. 阶段完成后再 archive，不用 “完成文档产物” 代替实现完成。
