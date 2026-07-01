## 上下文

PPTPilot 的核心约束是“结构化 JSON 是真实源，PPTX 只是导出产物”。当前仓库已有产品、架构、数据模型、工作流和 OpenSpec 配置，但还没有可运行的工程骨架，也没有真正可执行的共享 schema 契约。

前一版把 Requirement Discovery（需求澄清）作为 Phase 1 的思路已经废弃。新的技术分期先建立可验证的契约层，再逐步实现 API 状态机、需求澄清、前端流程、渲染与导出。

## 目标 / 非目标

**目标：**

- 建立最小 monorepo 工程结构，使后续前端、后端和共享包有明确边界。
- 建立 `packages/shared-schema`，作为核心实体结构和校验规则的唯一来源。
- 让合法/非法 fixtures 可以通过命令验证，证明 schema 校验链路可运行。
- 建立最小 Web / API 空壳，证明仓库可以安装、类型检查和启动。
- 为后续 HTML 预览与 PPTX 导出保留同一结构化模型入口。
- 建立 Dependabot 与分层 CI，保证基础质量门存在，同时避免文档改动 PR 承担无关的全量检查成本。

**非目标：**

- 不实现 Requirement Discovery、Outline、Slide Planner 或任何真实 AI Agent。
- 不实现项目生命周期、工作流状态机、事件追加 API 或持久化仓库。
- 不实现 HTML preview、PPTX export、Konva canvas、局部再生、图片候选或 Review Agent。
- 不引入 PostgreSQL、Redis、Celery/RQ、S3/MinIO 等运行时基础设施。
- 不在 Phase 1 建立复杂代码生成流水线；可以先定义生成策略和最小可执行输出。
- 不建立部署、发布、E2E（End-to-End，端到端）测试或完整安全扫描流水线。

## 决策

1. **Phase 1 只做工程底座与共享契约**
   - 决策：Phase 1 范围收敛为 monorepo、Web/API 空壳、shared schema、fixtures、校验脚本。
   - 备选：继续实现需求澄清 MVP。备选被否：需求澄清依赖 schema 校验、项目状态与错误处理，否则会变成 prompt demo。

2. **以 `packages/shared-schema` 作为跨端契约源**
   - 决策：核心实体先在共享包内定义，并输出 TypeScript 类型与 JSON Schema 校验入口；Python/Pydantic 端通过生成或适配消费同一契约。
   - 备选：前端 TypeScript 和后端 Pydantic 分别手写模型。备选被否：后续 Agent、渲染器、导出器会出现字段漂移。

3. **Phase 1 的 Python 模型采用“生成策略 + smoke check”**
   - 决策：本期必须明确 Python 端如何消费共享契约，并提供可执行 smoke check。可接受方式包括 API 侧加载 shared-schema 生成的 JSON Schema 校验一个 fixture、生成最小 Pydantic 模型并跑样例校验，或等价的自动化验证命令。
   - 备选：先不考虑 Python。备选被否：后端是 FastAPI/Pydantic，若不在 Phase 1 固定契约方向，Phase 2 会被迫重构。

4. **前后端只建立可启动空壳**
   - 决策：`apps/web` 只需 Next.js 可启动壳；`apps/api` 只需 FastAPI app 与 health check。
   - 备选：同时实现项目创建与需求发现 API。备选被否：这属于 Phase 2/Phase 3，会扩大本期验收面。

5. **fixtures 是 Phase 1 的核心验收物**
   - 决策：用合法/非法 fixtures 验证 schema 行为，包括最小 PresentationSpec、SlidePlan、Event、非法 scene、非法 styleProfile 归属、默认 profile 回退、无效实体引用、缺失字段和错误类型。locked write 只作为后续锁定写保护参考样例，不纳入 Phase 1 必过非法校验。
   - 备选：只做类型定义不做样例。备选被否：类型存在不等于契约可运行。

6. **导出一致性只建立模型边界，不实现导出**
   - 决策：本期在 schema 中保留导出、渲染未来需要的几何、样式、资产引用字段，但不实现 HTML/PPTX。
   - 备选：提前做 PPTX export。备选被否：导出必须依赖稳定 slide model 和 renderer。

7. **CI 采用路径过滤与分层准入**
   - 决策：Phase 1 建立 GitHub Actions 基础 CI，但按变更路径分层执行：文档/OpenSpec-only 只跑文档/OpenSpec 校验；`packages/shared-schema` 改动跑 schema/typecheck/fixtures；`apps/web` 改动跑 Web typecheck/build；`apps/api` 改动跑 API 基础检查和 health check；根 `package.json`、lockfile、workspace 与 TypeScript 配置变更必须运行受影响的 JavaScript workspace gates；`.github/workflows/**` 和 `.github/dependabot.yml` 变更必须运行 CI 配置自检与 OpenSpec/docs gate。
   - Required check 策略：使用一个 always-on 汇总 job 作为分支保护 required check；被路径过滤跳过的子 job 不应单独作为 required check，避免 docs-only PR 卡在 pending。
   - 备选：所有 PR 全量运行所有 CI。备选被否：早期仓库会频繁改文档与 OpenSpec，全量 CI 会降低协作速度。

8. **Dependabot 按生态分组并受 CI 路径门控约束**
   - 决策：配置 `.github/dependabot.yml` 覆盖 npm/pnpm、Python、GitHub Actions，按生态或目录分组更新，避免每个依赖产生孤立 PR。
   - 备选：暂不启用 Dependabot。备选被否：Phase 1 会引入基础工具链，早期锁定依赖更新节奏有利于减少后续技术债。

## 风险 / 权衡

- **风险：shared schema 选型过早锁死** -> 先实现最小实体和校验出口，避免在 Phase 1 引入复杂生成流水线。
- **风险：TypeScript 与 Python 模型仍然双写** -> 任务中必须包含“单一契约源与 Python 消费策略”，验收时检查后端不得另建不兼容模型。
- **风险：Phase 1 变成脚手架堆砌** -> 以 fixtures 校验和 typecheck 作为验收，不以目录存在作为完成标准。
- **风险：锁定、再生、事件等字段提前过度建模** -> 本期只定义必要基础字段和非法样例；运行时行为进入后续 Phase。
- **风险：前端设计过早发散** -> Web 空壳只验证启动和共享类型引用，不实现完整 IDE UI。
- **风险：CI 配置过度导致文档 PR 变慢** -> 使用 path filter 或等价条件拆分 workflow job，只对受影响区域运行准入检查。
- **风险：路径过滤 job 被分支保护误设为 required 后变成 pending** -> 只将 always-on 汇总 job 设为 required check，子 job 结果由汇总 job 采集。
- **风险：Dependabot PR 噪声过多** -> 按包生态和目录分组，设置合理频率，并要求只运行匹配影响面的 CI。

## 迁移计划

1. 创建 monorepo 目录与基础包管理文件。
2. 创建 `packages/shared-schema` 与核心实体 schema。
3. 添加 JSON Schema 输出或校验入口，以及 fixtures 验证命令。
4. 创建 `apps/web` 最小 Next.js 壳，并引用共享类型或 schema 包。
5. 创建 `apps/api` 最小 FastAPI 壳与 health check，并记录 Python 端消费 schema 的方式。
6. 创建 Dependabot 配置与分层 CI workflow，定义路径过滤与准入标准。
7. 运行最小验收：安装、类型检查、schema fixture 校验、Python smoke check、API health check、OpenSpec 校验与 CI 路径门控自检。

回滚策略：

- 因本期不引入持久化和业务数据，回滚可通过移除新增目录与 workspace 配置完成。
- 若 schema 选型不合适，保留 fixtures 作为行为基准，替换实现工具后仍需通过同一 fixtures。
- 若 CI 路径过滤误伤，可临时降级为手动 workflow 或单一基础 workflow，但必须保留 OpenSpec 校验与 shared-schema fixtures 校验。

## Open Questions

- `packages/shared-schema` 的具体实现工具待实现阶段确认，候选包括 Zod + JSON Schema 输出、TypeBox、或直接维护 JSON Schema 并生成 TypeScript 类型。
- Python/Pydantic 模型是本期生成最小模型，还是 Phase 2 通过 JSON Schema 适配，需在实现时根据工具成本决定。
- CI path filter 使用 GitHub Actions 原生 `paths`/job condition，还是引入轻量路径过滤 action，需在实现时按复杂度选择；无论选型如何，必须保留 always-on 汇总 required check。
