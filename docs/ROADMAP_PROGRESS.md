# ROADMAP 实施进度（按技术实现分期）

> 说明：本仓库的 OpenSpec 配置为中文语境，按 `openspec-cn` 流程推进。分期以技术依赖顺序为准，不以最终产品体验顺序为准。

## 1. 当前判断

- 已完成：`Phase 0`（文档与架构理解）
- 已完成并归档：`Phase 1`（工程底座、monorepo、shared schema），归档件位于 `openspec/changes/archive/2026-07-02-phase-1-foundation-monorepo-and-shared-schema`
- 已完成并归档：`Phase 2`（后端 API 与工作流状态机），归档件位于 `openspec/changes/archive/2026-07-02-phase-2-api-skeleton-and-workflow-state`；已合并 PR #9
- 当前后续：启动 `Phase 3`（需求澄清与 Spec Builder），先创建 `phase-3-requirement-discovery-and-spec-builder` OpenSpec 提案
- 已废弃：旧 `phase-1-requirement-discovery-mvp` 提案
- 原因：需求澄清依赖共享 schema、API 状态机、事件模型与基础工程结构，不应作为技术实现第一期

## 2. 技术分期状态

| 阶段 | 名称 | 技术目标 | 状态 | 建议 OpenSpec 变更 | 关键验收 |
| --- | --- | --- | --- | --- | --- |
| Phase 0 | 文档与架构 | 建立产品、架构、数据模型、工作流与 OpenSpec 语境 | 已完成 | - | 文档可指导 AI agent 与人工协作 |
| Phase 1 | 工程底座与共享契约 | 建立 monorepo、前后端空壳、`packages/shared-schema`、schema 校验、Dependabot 与分层 CI | 已完成并归档 | `phase-1-foundation-monorepo-and-shared-schema` | 仓库可安装/启动；共享 schema 可生成类型并校验样例；文档 PR 不触发全量 CI |
| Phase 2 | 后端 API 与工作流状态机 | FastAPI、项目生命周期、状态流转、事件写入、错误约定 | 已完成并归档 | `phase-2-api-skeleton-and-workflow-state` | 创建项目与状态推进可运行；非法状态不写持久状态 |
| Phase 3 | 需求澄清与 Spec Builder | Requirement Discovery Agent、问题策略、跳过风险、Spec 确认 | 未启动 | `phase-3-requirement-discovery-and-spec-builder` | 模糊输入可生成可确认的 `PresentationSpec` |
| Phase 4 | 前端工作流壳 | Next.js 立项、需求澄清、Spec review、状态展示 | 未启动 | `phase-4-frontend-workflow-shell` | 用户可在 Web 中完成创建、问答与 Spec 确认 |
| Phase 5 | 大纲与 Slide Plan | Outline Agent、Slide Planner Agent、可编辑结构 | 未启动 | `phase-5-outline-and-slide-planning` | 确认 Spec 后可生成并编辑 outline/slide plan |
| Phase 6 | HTML 预览与 Slide Model | 结构化 slide JSON、主题 token、HTML preview renderer | 未启动 | `phase-6-html-preview-and-slide-model` | 同一结构化模型可渲染预览 |
| Phase 7 | PPTX 导出 MVP | PPTX export、下载、HTML/PPTX 一致性检查 | 未启动 | `phase-7-pptx-export-mvp` | 可从结构化数据导出 PPTX |
| Phase 8 | Canvas 编辑与锁定 | 画布编辑、元素编辑、slide/element lock、锁定写保护 | 未启动 | `phase-8-canvas-editing-and-lock-model` | 用户可微调；AI 写入不能修改锁定目标 |
| Phase 9 | 局部再生与图片候选 | text/image/layout scope 再生、图片多候选、版本快照 | 未启动 | `phase-9-partial-regeneration-and-image-variants` | 只修改用户允许的未锁定范围 |
| Phase 10 | 版本、审阅与质量 | version history、diff、Review Agent、重复率告警 | 未启动 | `phase-10-versioning-review-and-quality` | 可回退、可审阅、可发现质量问题 |

## 3. 当前 OpenSpec 状态

- 当前不应继续旧提案：`phase-1-requirement-discovery-mvp`
- 已归档提案：`phase-1-foundation-monorepo-and-shared-schema`、`phase-2-api-skeleton-and-workflow-state`
- 无进行中的 change
- 下一提案：`phase-3-requirement-discovery-and-spec-builder`
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
