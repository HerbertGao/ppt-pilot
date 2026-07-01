## 为什么

当前仓库仍处于文档初始化阶段，尚未建立可运行的工程骨架与共享契约层。若直接进入 Requirement Discovery（需求澄清）或 Agent（代理）实现，会把产品行为建在未校验的数据模型之上，容易形成各端各写一套模型的分裂风险。

本变更先建立 Phase 1 技术底座：单体仓库（monorepo）、前后端最小空壳、`packages/shared-schema`、fixtures（样例数据）与校验命令，为后续 API、工作流状态机、Agent 输出校验、HTML 预览和 PPTX 导出提供统一结构来源。

## 变更内容

- 新增 monorepo 工程骨架，包含 `apps/web`、`apps/api`、`packages/shared-schema`，并为后续 `packages/ai-workflow`、`packages/ppt-engine`、`packages/exporter` 保留清晰边界。
- 新增最小 Frontend（前端）与 Backend（后端）空壳：
  - Web：Next.js / React / TypeScript 可启动壳。
  - API：FastAPI 可启动壳与 health check（健康检查）。
- 新增 `packages/shared-schema` 作为结构化 JSON（JavaScript Object Notation）契约源。
- 定义第一版核心实体 schema：`PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`StyleProfile`、`Version`、`Event`。
- 建立 TypeScript 类型、JSON Schema（模式）校验产物与 Python / Pydantic 模型生成策略或最小模型落点。
- 新增 fixtures（样例）与校验入口，覆盖合法最小数据、无效枚举、默认 profile 回退、无效引用和风格归属边界；锁定写保护仅保留为后续阶段参考样例，不作为 Phase 1 必过非法校验。
- 新增基础脚本，允许开发者执行安装、类型检查、schema 校验与 fixtures 验证。
- 新增 Dependabot 与分层 CI（Continuous Integration，持续集成）配置，按变更路径控制准入检查，避免文档更新 PR 触发全量 Web/API/schema CI。

非目标：

- 不实现 Requirement Discovery Agent、Gap Agent、Question Agent 或 Spec Builder Agent。
- 不实现 outline、slide plan、HTML preview、PPTX export、Konva canvas 或真实 LLM（大语言模型）调用。
- 不引入 PostgreSQL、Redis、Celery/RQ、S3/MinIO 等运行时基础设施。
- 不实现完整锁定流程、局部再生、图片候选或 Review Agent；本期只在 schema/fixtures 层保留必要字段和非法样例。
- 不建立发布流水线、部署流水线、端到端浏览器测试或完整安全扫描平台；本期 CI 只覆盖 Phase 1 的基础质量门。

## 功能 (Capabilities)

### 新增功能

- `project-foundation`: 定义 monorepo 目录、基础包管理、前端空壳、后端空壳与基础开发脚本。
- `shared-schema-contract`: 定义共享数据模型、类型产物、JSON Schema 校验与跨语言模型策略。
- `schema-validation-fixtures`: 定义合法/非法 fixtures 与校验命令，确保无效结构在进入 API 或 Agent 流程前失败。
- `ci-and-dependency-automation`: 定义 Dependabot 依赖更新与按路径分层的 CI 准入标准。

### 修改功能

- 无。

## 影响

- 模式（schema）
  - 新增 `packages/shared-schema`，作为 TypeScript 类型、JSON Schema 与 Python / Pydantic 模型的统一来源。
  - 首批覆盖实体：`PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`StyleProfile`、`Version`、`Event`。
- 代理（agent）
  - 本期不实现 Agent。
  - 后续 Agent 输出必须以本期 schema 为入库前校验依据。
- 后端路由（API）
  - 新增 `apps/api` 空壳与 health check。
  - 暂不实现项目生命周期、需求澄清或状态机 API；这些进入 Phase 2/Phase 3。
- 网页端（web）
  - 新增 `apps/web` 可启动空壳。
  - 暂不实现完整产品页面、需求澄清 UI 或画布编辑。
- 导出模块（exporter）
  - 本期不实现导出。
  - 仅通过 schema 边界确保未来 HTML/PPTX 导出消费同一结构化模型。
- 事件（event）、版本（version）、锁定（lock）
  - 本期仅在 schema/fixtures 层定义基础结构与非法样例。
  - 不实现事件追加、版本快照、锁定写保护运行时逻辑；这些进入后续阶段。
- 验证方式
  - schema validation（模式校验）：合法 fixtures 必须通过，非法 fixtures 必须失败。
  - typecheck（类型检查）：共享 schema 包和前端引用不应出现类型错误。
  - API health check：后端空壳可启动并返回健康状态。
  - CI gating（持续集成准入）：文档/OpenSpec-only PR 仅运行 markdown/OpenSpec 校验；Web/API/schema 相关改动才运行对应 install/typecheck/test/fixtures 检查；通过一个总控 required check 汇总结果，避免被跳过的 job 阻塞 PR。
- 依赖自动化（Dependabot）
  - 新增 `.github/dependabot.yml`，按 npm/pnpm、Python、GitHub Actions 生态分组。
  - Dependabot PR 必须触发与其影响路径或生态匹配的 CI，而不是默认全量执行所有检查；根 lockfile、workspace 配置、GitHub Actions 配置变更必须有明确准入路径。
