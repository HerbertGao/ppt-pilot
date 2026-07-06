# CI 准入标准

> 范围：分层 CI 准入与 Dependabot / GitHub Actions 准入。workflow（仍名为 `Phase 1 CI`）已随后续阶段扩展，现含 shared-schema、ppt-engine（Phase 6 渲染器）、Web、API 等按路径触发的 gate。CI 安装统一使用 `pnpm install --no-frozen-lockfile`；若将 lockfile 纳入版本管理并要求可复现安装，可切换为 frozen lockfile 安装。

## 总体规则

- 分支保护只应要求 always-on 汇总检查：`required check`。
- 子检查可按路径跳过，不能单独作为 required check，否则 docs/OpenSpec-only PR 可能因 skipped job 变成 pending。
- docs/OpenSpec-only PR 只运行 docs/OpenSpec gate，不运行 Web、API、shared-schema 全量检查。
- 根 JavaScript workspace 文件改动会强制运行 shared-schema、ppt-engine、Web 与（经 `shared_schema → api`）API gates。
- CI 配置改动会运行 CI config gate，并同时运行 docs/OpenSpec gate。

## 路径触发矩阵

| 影响范围 | 触发路径 | 必跑检查 | 可跳过检查 |
| --- | --- | --- | --- |
| docs/OpenSpec | `README.md`、`PRODUCT.md`、`AGENTS.md`、`docs/**`、`openspec/**` | OpenSpec 配置与 Phase 1 artifact 存在性检查；若 CI runner 有 `openspec-cn`，运行 `openspec-cn validate --all --strict` | Web、API、shared-schema 全量 gates |
| shared-schema | `packages/shared-schema/**`；或根 JS workspace 文件 | `pnpm install --no-frozen-lockfile`、shared-schema typecheck、build、fixtures 验证、安装 API 依赖、build 后的 API `python3` shared-schema smoke；因 shared-schema 变更会连带触发 ppt-engine gate，并经 ppt-engine 级联触发 Web gate，且经 api job 的 `\|\| shared_schema` 触发完整 API gate（含 `pytest` 合约测试） | docs/OpenSpec 与 CI config gate（除非同一 PR 也改对应路径） |
| ppt-engine | `packages/ppt-engine/**`；或 shared-schema 变更；或根 JS workspace 文件 | `pnpm install --no-frozen-lockfile`、shared-schema build、ppt-engine typecheck、renderer fixtures（`pnpm --filter @ppt-pilot/ppt-engine test`）；因 web 消费 ppt-engine，ppt-engine 变更会级联触发 Web gate | API 专属检查 |
| Web | `apps/web/**`；或 `packages/ppt-engine/**`；或 shared-schema 变更；或根 JS workspace 文件（web 消费 `@ppt-pilot/ppt-engine` 渲染器与 `@ppt-pilot/shared-schema`，二者变更均级联触发 Web gate） | `pnpm install --no-frozen-lockfile`、shared-schema build、ppt-engine build、Web typecheck、Web test、Web build、Web smoke-start 根页面请求 | API 专属检查 |
| API | `apps/api/**`；或 shared-schema 变更（经 api job 的 `\|\| shared_schema` 条件，含根 JS workspace 文件） | `pnpm install`、shared-schema build（供 Python smoke）、安装 `apps/api[test]`、`python3 -m compileall` 静态/编译检查、API 合约测试 `python3 -m pytest apps/api/tests`、`python3` shared-schema smoke、health/start 路径检查 | Web 等 JS gates（apps/api-only 变更时） |
| CI config | `.github/workflows/**`、`.github/dependabot.yml` | CI 配置自检、Dependabot ecosystem 覆盖检查、always-on `required check` 存在性检查、docs/OpenSpec gate | Web/API/shared-schema 全量 gates，除非同一 PR 也改动对应路径 |
| Root JS workspace | `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json`、`tsconfig.base.json`、`.npmrc`、`.pnpmfile.cjs` | shared-schema gate、ppt-engine gate、Web gate 与（因 shared_schema=true）完整 API gate | docs/OpenSpec 与 CI config gate（除非同一 PR 也改对应路径） |

## Dependabot PR 准入

| Dependabot 更新类型 | 典型路径 | CI 准入 |
| --- | --- | --- |
| 根 npm/pnpm 工具链 | `/package.json`、`/pnpm-lock.yaml`、`/pnpm-workspace.yaml` | 运行 shared-schema、ppt-engine、Web 三个 JS gate 及（因 shared_schema=true）完整 API gate；lockfile 无法精确归类时也按此处理 |
| Web npm/pnpm 依赖 | `/apps/web/package.json` 及相关 lockfile | 运行 Web gate；如同时改根 lockfile，补跑 shared-schema、ppt-engine 与（因 shared_schema=true）完整 API gates |
| shared-schema npm/pnpm 依赖 | `/packages/shared-schema/package.json` 及相关 lockfile | 运行 shared-schema gate（包含 API 依赖安装后运行 Python shared-schema smoke）；因 shared-schema 级联触发 ppt-engine 与 Web gates，并经 api job 的 `\|\| shared_schema` 触发完整 API gate（含 `pytest` 合约测试），均随该更新一并运行 |
| Python 依赖 | `/apps/api/pyproject.toml` | 运行 API gate |
| GitHub Actions 依赖 | `.github/workflows/**` | 运行 CI config gate 与 docs/OpenSpec gate |

## 历史说明：Phase 1 禁止提前实现项

以下清单是 Phase 1 验收时的「禁止提前实现」项，仅作历史记录保留。多数条目已在后续阶段落地，验收时应以当前阶段的规格为准，不要再据此判断实现范围：

- 真实 AI Agent、Requirement Discovery、Outline Agent、Slide Planner Agent — 已实现（Phase 3 / Phase 5，走 `LLMProvider`）。Review Agent 仍未实现（Phase 10）。
- 业务状态机、项目生命周期 API、事件追加 API 或持久化流程 — 已实现（Phase 2+）。
- HTML preview（Phase 6，确定性渲染）、PPTX export（Phase 7，后端 python-pptx）已实现。Konva canvas 编辑（Phase 8）、局部再生与图片候选（Phase 9）仍未实现。
