# CI 准入标准

> 范围：分层 CI 准入与 Dependabot / GitHub Actions 准入。workflow（仍名为 `Phase 1 CI`）已随后续阶段扩展，现含 shared-schema、ppt-engine（Phase 6 渲染器）、Web、API 等按路径触发的 gate。CI 安装统一使用 `pnpm install --no-frozen-lockfile`；若将 lockfile 纳入版本管理并要求可复现安装，可切换为 frozen lockfile 安装。

## 总体规则

- 分支保护只应要求 always-on 汇总检查：`required check`。
- 子检查可按路径跳过，不能单独作为 required check，否则 docs/OpenSpec-only PR 可能因 skipped job 变成 pending。
- docs/OpenSpec-only PR 只运行 docs/OpenSpec gate，不运行 Web、API、shared-schema 全量检查。
- 根 JavaScript workspace 文件改动会强制运行 shared-schema 与 Web gates。
- CI 配置改动会运行 CI config gate，并同时运行 docs/OpenSpec gate。

## 路径触发矩阵

| 影响范围 | 触发路径 | 必跑检查 | 可跳过检查 |
| --- | --- | --- | --- |
| docs/OpenSpec | `README.md`、`PRODUCT.md`、`AGENTS.md`、`docs/**`、`openspec/**` | OpenSpec 配置与 Phase 1 artifact 存在性检查；若 CI runner 有 `openspec-cn`，运行 `openspec-cn validate phase-1-foundation-monorepo-and-shared-schema --strict` | Web、API、shared-schema 全量 gates |
| shared-schema | `packages/shared-schema/**`；或根 JS workspace 文件 | `pnpm install --no-frozen-lockfile`、shared-schema typecheck、build、fixtures 验证、安装 API 依赖、build 后的 API `python3` shared-schema smoke；因 shared-schema 变更会连带触发 ppt-engine gate | API 其它专属检查；Web 检查仅在根 JS workspace 文件变更时必跑 |
| ppt-engine | `packages/ppt-engine/**`；或 shared-schema 变更；或根 JS workspace 文件 | `pnpm install --no-frozen-lockfile`、shared-schema build、ppt-engine typecheck、renderer fixtures（`pnpm --filter @ppt-pilot/ppt-engine test`） | API 与 Web 专属检查 |
| Web | `apps/web/**`；或根 JS workspace 文件 | `pnpm install --no-frozen-lockfile`、shared-schema build、Web typecheck、Web build、Web smoke-start 根页面请求 | API 专属检查 |
| API | `apps/api/**` | `python3 -m pip install -e apps/api`、`python3 -m compileall` 最小静态/编译检查、shared-schema build 后的 `python3` shared-schema smoke、health/start 路径检查 | Web 专属检查 |
| CI config | `.github/workflows/**`、`.github/dependabot.yml` | CI 配置自检、Dependabot ecosystem 覆盖检查、always-on `required check` 存在性检查、docs/OpenSpec gate | Web/API/shared-schema 全量 gates，除非同一 PR 也改动对应路径 |
| Root JS workspace | `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.json`、`tsconfig.base.json`、`.npmrc`、`.pnpmfile.cjs` | shared-schema gate、ppt-engine gate 与 Web gate | API 专属检查 |

## Dependabot PR 准入

| Dependabot 更新类型 | 典型路径 | CI 准入 |
| --- | --- | --- |
| 根 npm/pnpm 工具链 | `/package.json`、`/pnpm-lock.yaml`、`/pnpm-workspace.yaml` | 运行 shared-schema gate 与 Web gate；lockfile 无法精确归类时也按这两类 JavaScript gates 处理 |
| Web npm/pnpm 依赖 | `/apps/web/package.json` 及相关 lockfile | 运行 Web gate；如同时改根 lockfile，补跑 shared-schema gate |
| shared-schema npm/pnpm 依赖 | `/packages/shared-schema/package.json` 及相关 lockfile | 运行 shared-schema gate（包含 API 依赖安装后运行 Python shared-schema smoke）；如同时改根 lockfile，补跑 Web gate |
| Python 依赖 | `/apps/api/pyproject.toml` | 运行 API gate |
| GitHub Actions 依赖 | `.github/workflows/**` | 运行 CI config gate 与 docs/OpenSpec gate |

## 历史说明：Phase 1 禁止提前实现项

以下清单是 Phase 1 验收时的「禁止提前实现」项，仅作历史记录保留。多数条目已在后续阶段落地，验收时应以当前阶段的规格为准，不要再据此判断实现范围：

- 真实 AI Agent、Requirement Discovery、Outline Agent、Slide Planner Agent — 已实现（Phase 3 / Phase 5，走 `LLMProvider`）。Review Agent 仍未实现（Phase 10）。
- 业务状态机、项目生命周期 API、事件追加 API 或持久化流程 — 已实现（Phase 2+）。
- HTML preview（Phase 6，确定性渲染）、PPTX export（Phase 7，后端 python-pptx）已实现。Konva canvas 编辑（Phase 8）、局部再生与图片候选（Phase 9）仍未实现。
