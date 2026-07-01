## 目的

定义 Phase 1 依赖自动化与 CI 准入的长期规范，确保 Dependabot 覆盖关键生态，GitHub Actions 按变更路径执行必要且不过度的检查。

## 需求

### 需求:仓库必须配置 Dependabot 依赖更新
系统必须提供 `.github/dependabot.yml`，覆盖 Phase 1 引入的 JavaScript/TypeScript、Python 与 GitHub Actions 依赖生态，并按目录或生态分组降低 PR 噪声。

#### 场景:Dependabot 覆盖前端和共享包依赖
- **当** `apps/web` 或 `packages/shared-schema` 引入 npm/pnpm 依赖
- **那么** Dependabot 必须能为对应 package 生态创建分组更新 PR

#### 场景:Dependabot 覆盖后端依赖
- **当** `apps/api` 引入 Python 依赖
- **那么** Dependabot 必须能为 Python 依赖创建分组更新 PR

#### 场景:Dependabot 覆盖 GitHub Actions
- **当** `.github/workflows` 使用 GitHub Actions
- **那么** Dependabot 必须能跟踪 actions 版本更新

### 需求:CI 必须按变更路径分层执行
系统必须配置 GitHub Actions 或等价 CI，使不同路径的 PR 只运行相关准入检查，禁止文档更新 PR 默认触发全量 Web/API/schema CI。

#### 场景:文档和 OpenSpec-only PR
- **当** PR 只修改 `docs/**`、`README.md`、`PRODUCT.md`、`AGENTS.md` 或 `openspec/**`
- **那么** CI 必须只运行 markdown/OpenSpec 校验相关任务，禁止运行 Web install/typecheck、API test 或 shared-schema fixtures 全量检查

#### 场景:shared-schema 改动
- **当** PR 修改 `packages/shared-schema/**` 或根 workspace 依赖配置
- **那么** CI 必须运行 shared-schema 类型检查、JSON Schema 或等价校验、fixtures 验证，以及受影响的基础 workspace 校验

#### 场景:根 JavaScript 工具链改动
- **当** PR 修改根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 TypeScript 配置或影响 JavaScript workspace 的共享配置
- **那么** CI 必须运行 shared-schema 与 Web 的相关 install/typecheck/build 或等价检查，禁止只运行 shared-schema 单项检查

#### 场景:Web 改动
- **当** PR 修改 `apps/web/**` 或影响 Web 构建的配置
- **那么** CI 必须运行 Web 相关 install、typecheck、build，并执行 smoke-start 后请求根页面或等价页面入口；可跳过 API 专属检查

#### 场景:API 改动
- **当** PR 修改 `apps/api/**` 或 Python 依赖配置
- **那么** CI 必须运行 API 相关依赖安装、静态检查或最小测试，并验证 health check 或等价启动路径

#### 场景:CI 与 Dependabot 配置改动
- **当** PR 修改 `.github/workflows/**` 或 `.github/dependabot.yml`
- **那么** CI 必须运行 OpenSpec/docs gate 与 CI 配置自检，且必须确认 always-on 汇总 required check 仍存在

#### 场景:Required check 汇总
- **当** 任一 PR 触发路径过滤 CI
- **那么** CI 必须提供一个 always-on 汇总 job 作为分支保护 required check，子 job 可按路径跳过但不得作为唯一 required check 导致 PR pending

### 需求:CI 准入标准必须显式记录
系统必须在仓库文档或 workflow 注释中记录每类 CI job 的触发条件、必过标准和可跳过条件。

#### 场景:查看 CI 准入标准
- **当** 开发者查看 Phase 1 开发文档或 `.github/workflows`
- **那么** 必须能确认 docs/OpenSpec、shared-schema、Web、API、Dependabot PR 分别需要通过哪些检查

#### 场景:Dependabot PR 使用匹配准入
- **当** Dependabot 创建依赖更新 PR
- **那么** CI 必须根据更新影响的路径或生态运行匹配检查，禁止无条件运行所有项目检查

#### 场景:Dependabot root lockfile 更新
- **当** Dependabot PR 修改根 lockfile 或 workspace 依赖元数据
- **那么** CI 必须按受影响生态运行 JavaScript workspace 相关检查；无法精确归类时必须运行 shared-schema 与 Web 两类 JavaScript gates

#### 场景:Dependabot Actions 更新
- **当** Dependabot PR 更新 `.github/workflows/**` 中的 GitHub Actions 版本
- **那么** CI 必须运行 CI 配置自检与 OpenSpec/docs gate，并通过 always-on 汇总 required check 报告结果

#### 场景:CI 防止无关失败阻塞
- **当** 一个 PR 只影响文档或 OpenSpec
- **那么** Web/API/shared-schema 无关失败不得作为该 PR 的必过条件

