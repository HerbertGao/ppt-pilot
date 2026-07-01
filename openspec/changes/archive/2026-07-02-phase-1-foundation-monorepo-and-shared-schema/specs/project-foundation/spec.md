## 新增需求

### 需求:仓库必须建立最小 monorepo 工程骨架
系统必须建立以 `apps/` 和 `packages/` 分层的 monorepo 工程结构，并至少包含 `apps/web`、`apps/api`、`packages/shared-schema` 三个可识别工作区。

#### 场景:初始化工作区目录
- **当** 开发者检出仓库并查看工程结构
- **那么** 仓库必须包含 `apps/web`、`apps/api` 与 `packages/shared-schema`，且包管理配置必须能识别这些工作区

#### 场景:保留后续包边界
- **当** 后续阶段需要实现 AI workflow、PPT engine 或 exporter
- **那么** Phase 1 的工程结构必须为 `packages/ai-workflow`、`packages/ppt-engine`、`packages/exporter` 保留清晰扩展边界，禁止把这些职责塞进 `apps/web` 或 `apps/api`

### 需求:前端必须提供最小可启动 Web 壳
系统必须在 `apps/web` 提供 Next.js / React / TypeScript 最小可启动应用，用于验证前端工作区、TypeScript 配置与 shared-schema 引用路径。

#### 场景:启动 Web 壳
- **当** 开发者执行约定的 Web 启动脚本
- **那么** `apps/web` 必须能启动一个最小页面，且该页面不要求真实需求澄清、画布编辑或幻灯片预览功能存在

#### 场景:前端引用共享契约
- **当** Web 壳需要使用核心实体类型
- **那么** 它必须从 `packages/shared-schema` 引用类型或 schema，禁止在 `apps/web` 内手写重复实体模型

### 需求:后端必须提供最小可启动 API 壳
系统必须在 `apps/api` 提供 FastAPI 最小应用，并包含 health check（健康检查）入口。

#### 场景:启动 API 壳
- **当** 开发者执行约定的 API 启动脚本
- **那么** FastAPI 应用必须能启动并暴露 health check 入口

#### 场景:API 壳不实现业务流程
- **当** Phase 1 完成时
- **那么** `apps/api` 禁止实现 Requirement Discovery、Outline、Slide Plan、PPTX export 或真实项目状态机 API

### 需求:基础脚本必须覆盖安装、类型检查与校验入口
系统必须提供仓库级脚本，允许开发者执行安装、类型检查、schema 校验和 fixtures 验证。

#### 场景:执行基础验证
- **当** 开发者运行 Phase 1 约定的验证命令
- **那么** 命令必须覆盖 shared-schema 类型检查、fixtures 校验、Python smoke check、Web build + smoke-start 页面请求，以及 API health check 或等价启动证明

#### 场景:禁止引入重运行时依赖
- **当** Phase 1 验收工程依赖
- **那么** 项目启动和验证不得依赖 PostgreSQL、Redis、Celery/RQ、S3/MinIO、真实 LLM API key 或 PPTX 导出工具链

## 修改需求

## 移除需求
