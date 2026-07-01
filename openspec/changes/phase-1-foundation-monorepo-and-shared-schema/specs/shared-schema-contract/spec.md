## 新增需求

### 需求:shared-schema 必须作为核心实体唯一契约源
系统必须在 `packages/shared-schema` 定义第一版核心实体结构，并将其作为前端、后端、Agent、渲染器与导出器后续消费的唯一契约来源。

#### 场景:定义核心实体
- **当** Phase 1 实现 shared-schema
- **那么** 它必须至少定义 `PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`StyleProfile`、`Version` 与 `Event`

#### 场景:禁止重复模型
- **当** `apps/web` 或 `apps/api` 需要使用核心实体
- **那么** 它们必须通过 `packages/shared-schema` 的类型、JSON Schema 或生成产物使用实体定义，禁止创建字段不一致的重复模型

### 需求:shared-schema 必须输出可执行校验契约
系统必须为核心实体提供 JSON Schema 或等价的运行时校验入口，确保 AI 输出、API 输入和 fixtures 能在入库或进入后续流程前被校验。

#### 场景:合法实体通过校验
- **当** 合法的 `PresentationSpec`、`Presentation`、`SlidePlan` 或 `Event` 样例被提交到校验入口
- **那么** 校验必须通过，并返回可用于后续流程的结构化对象或成功状态

#### 场景:非法实体失败
- **当** 样例包含非法枚举、缺失必填字段、错误字段类型或无效实体引用
- **那么** 校验必须失败，并返回可定位字段路径的错误信息

### 需求:shared-schema 必须覆盖关键枚举与默认策略边界
系统必须在共享契约中定义 Phase 1 所需的关键枚举和默认策略边界，包括工作流状态、元素类型、slide 状态、actor 类型、scene 与 question mode 的基础枚举。

#### 场景:枚举值一致
- **当** 前端、后端或 fixtures 使用 `scene`、`workflowState`、`element.type`、`slide.status` 或 `questionPolicy.mode`
- **那么** 这些字段必须来自 shared-schema 中的同一枚举定义

#### 场景:保留后续阶段字段
- **当** schema 包含 `scene`、`styleProfileId`、`questionPolicy`、`locked`、`Version` 或 `Event`
- **那么** 它们必须作为后续阶段的契约边界存在，但 Phase 1 禁止实现对应完整业务流程

### 需求:Python 端必须有可执行的 schema 消费证明
系统必须定义并验证 FastAPI / Pydantic 端如何消费 shared-schema 契约，避免 TypeScript 与 Python 手写分裂。

#### 场景:后端消费共享契约
- **当** `apps/api` 需要校验核心实体
- **那么** 它必须使用 shared-schema 生成的 JSON Schema、生成的 Pydantic 模型，或等价适配方式，不得独立维护不兼容模型

#### 场景:Python smoke check 可执行
- **当** 开发者运行 Phase 1 验证命令
- **那么** 必须执行一个 Python 侧 smoke check，证明 `apps/api` 可以加载 shared-schema 产物或生成模型，并校验至少一个合法 fixture 与一个非法 fixture

#### 场景:生成策略可追踪
- **当** 开发者查看 shared-schema 文档或脚本
- **那么** 必须能找到 TypeScript 类型、JSON Schema、Python / Pydantic 消费方式与 smoke check 命令之间的关系说明

## 修改需求

## 移除需求
