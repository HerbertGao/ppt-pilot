## 1. Workspace 与工程骨架

- [x] 1.1 在仓库根目录建立 `pnpm-workspace.yaml`、根 `package.json` 与基础脚本（install/typecheck/validate），覆盖 `apps/*` 与 `packages/*`
- [x] 1.2 创建 `apps/web`、`apps/api`、`packages/shared-schema` 目录，并为 `packages/ai-workflow`、`packages/ppt-engine`、`packages/exporter` 保留占位说明或清晰边界
- [x] 1.3 添加根级 TypeScript 配置或共享配置入口，确保后续包可复用同一基础编译约定
- [x] 1.4 确认 Phase 1 依赖不引入 PostgreSQL、Redis、Celery/RQ、S3/MinIO、真实 LLM、PPTX exporter 或 Konva canvas 运行时

## 2. Shared Schema 契约包

- [x] 2.1 在 `packages/shared-schema` 初始化包结构，提供统一导出入口（例如 `src/index.ts`）
- [x] 2.2 定义基础枚举：`Scene`、`QuestionMode`、`WorkflowState`、`SlideStatus`、`ElementType`、`ActorType`、`RegenerateScope`（仅作为契约枚举，不实现再生流程）
- [x] 2.3 定义核心实体 schema/type：`PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`Version`、`Event`
- [x] 2.4 为 `scene/styleProfileId/questionPolicy` 定义最小字段约束与默认 profile ID 关系，保留 Phase 3 使用边界
- [x] 2.5 为 `locked`、`Version`、`Event` 定义基础结构，保留后续锁定、版本和事件链路边界，但不实现运行时写保护
- [x] 2.6 输出 JSON Schema 或等价运行时校验入口，使合法对象可验证、非法对象可返回字段路径错误
- [x] 2.7 记录 Python / Pydantic 消费策略：生成模型、JSON Schema 适配，或等价说明，禁止后端另建不兼容实体模型
- [x] 2.8 添加 Python 侧 smoke check：`apps/api` 必须能加载 shared-schema 产物或生成模型，并校验至少一个合法 fixture 与一个非法 fixture

## 3. Fixtures 与校验命令

- [x] 3.1 在 `packages/shared-schema/fixtures/valid` 添加合法最小 `PresentationSpec`、`Presentation`、`SlidePlan`、`Event` 样例
- [x] 3.2 在 `packages/shared-schema/fixtures/invalid` 添加非法 `scene`、非法 `styleProfileId` 归属、缺失必填字段、错误字段类型、无效实体引用样例
- [x] 3.3 添加默认 profile 回退 fixtures，覆盖 `default -> style_default`、`education -> style_education_default`、`corporate -> style_corporate_default`
- [x] 3.4 可选添加 locked write 参考样例，但必须标记为 later-phase reference，且不得纳入 Phase 1 gating 非法校验
- [x] 3.5 实现 fixtures 校验脚本：合法样例必须全部通过，Phase 1 gating 非法样例必须全部失败
- [x] 3.6 将 fixtures 校验脚本接入根级 `validate` 或等价命令，并保证失败输出包含 fixture 文件名或字段路径

## 4. Web 最小空壳

- [x] 4.1 在 `apps/web` 初始化 Next.js / React / TypeScript 最小应用
- [x] 4.2 让 `apps/web` 能通过 workspace 引用 `packages/shared-schema` 的类型或 schema 导出
- [x] 4.3 添加最小页面或启动入口，仅用于证明 Web 壳可运行，不实现 Requirement Discovery、Spec Review、Canvas 或 Slide Preview
- [x] 4.4 将 Web 类型检查接入根级 `typecheck` 或等价命令
- [x] 4.5 添加 Web smoke-start 验收：CI 或本地验证必须能启动 Web 壳并请求根页面成功

## 5. API 最小空壳

- [x] 5.1 在 `apps/api` 初始化 FastAPI 应用结构，提供明确启动入口
- [x] 5.2 实现 health check（健康检查）接口，证明 API 壳可启动
- [x] 5.3 在 `apps/api` 中记录或接入 shared-schema 消费方式，避免手写不兼容核心实体模型
- [x] 5.4 确认 API 壳不实现项目生命周期、需求澄清、Outline、Slide Plan、HTML preview、PPTX export 或真实状态机 API

## 6. 验收与文档同步

- [x] 6.1 更新 README 或开发文档，说明 Phase 1 的安装、启动、typecheck 与 fixtures 校验命令
- [x] 6.2 记录 CI 准入标准：docs/OpenSpec、shared-schema、Web、API、Dependabot PR 分别触发哪些检查、哪些检查可跳过
- [x] 6.3 更新 `docs/ROADMAP_PROGRESS.md`，将 Phase 1 状态标记为 OpenSpec 提案已创建、待实现
- [x] 6.4 验证 `openspec-cn validate phase-1-foundation-monorepo-and-shared-schema --strict` 通过
- [x] 6.5 验收时确认 Phase 1 未提前实现真实 AI Agent、业务状态机、HTML preview、PPTX export、Canvas、局部再生或 Review Agent

## 7. Dependabot 与 CI

- [x] 7.1 添加 `.github/dependabot.yml`，覆盖 npm/pnpm、Python 与 GitHub Actions 依赖更新
- [x] 7.2 为 Dependabot 配置按生态或目录分组更新，降低基础工具链依赖 PR 噪声
- [x] 7.3 添加 GitHub Actions workflow，至少包含 docs/OpenSpec、shared-schema、Web、API、CI config 五类准入检查
- [x] 7.4 为 CI 配置路径过滤或等价 job 条件：文档/OpenSpec-only PR 只运行文档/OpenSpec 校验，不运行 Web/API/shared-schema 全量检查
- [x] 7.5 为 shared-schema 改动配置必跑检查：类型检查、JSON Schema 或等价校验、fixtures 验证
- [x] 7.6 为 Web 改动配置必跑检查：Web install/typecheck/build 与 smoke-start 根页面请求，且不强制运行 API 专属检查
- [x] 7.7 为 API 改动配置必跑检查：Python 依赖安装、静态检查或最小测试、health check 或等价启动路径
- [x] 7.8 为根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 TypeScript 配置变更配置 JavaScript workspace gates，至少覆盖 shared-schema 与 Web 检查
- [x] 7.9 为 `.github/workflows/**` 与 `.github/dependabot.yml` 变更配置 CI config gate，并确认 always-on 汇总 required check 存在
- [x] 7.10 验证 Dependabot PR 遵循影响范围匹配的 CI 准入标准；root lockfile 无法精确归类时运行 shared-schema 与 Web gates；Actions 更新运行 CI config gate
