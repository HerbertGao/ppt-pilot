## 目的

定义 Phase 1 共享模式契约的长期规范，确保核心实体、运行时校验、枚举边界与 Python 消费证明在前后端和后续代理中保持一致。
## 需求
### 需求:shared-schema 必须作为核心实体唯一契约源
系统必须在 `packages/shared-schema` 定义第一版核心实体结构，并将其作为前端、后端、Agent、渲染器与导出器后续消费的唯一契约来源。

#### 场景:定义核心实体
- **当** Phase 1 实现 shared-schema
- **那么** 它必须至少定义 `PresentationSpec`、`Presentation`、`Slide`、`SlidePlan`、`Element`、`Asset`、`StyleProfile`、`Version` 与 `Event`

#### 场景:禁止重复模型
- **当** `apps/web` 或 `apps/api` 需要使用核心实体
- **那么** 它们必须通过 `packages/shared-schema` 的类型、JSON Schema 或生成产物使用实体定义，禁止创建字段不一致的重复模型

### 需求:shared-schema 必须输出可执行校验契约
系统必须为核心实体提供 JSON Schema 或等价的运行时校验入口，确保 AI 输出、API 输入和 fixtures 能在入库或进入后续流程前被校验。**自 Phase 5 起校验入口必须覆盖 `Outline`（登记进 `ENTITY_NAMES` / `EntityMap` / `validateEntity` 分发与入口，后端经 `validateEntity("Outline", …)` 消费，与 `SlidePlan` 一致）**。同时 **`SlidePlan.visualIntent` 由自由 `string` 收紧为 `VisualIntent` 枚举约束**——这是对既有 `SlidePlan`（及经 `validateSlide`/`validatePresentation` 传递的）校验行为的**语义收紧（非纯加法）**：先前合法的越界 `visualIntent` 现在必须失败。

#### 场景:合法实体通过校验
- **当** 合法的 `PresentationSpec`、`Presentation`、`SlidePlan`、`Outline` 或 `Event` 样例被提交到校验入口
- **那么** 校验必须通过，并返回可用于后续流程的结构化对象或成功状态

#### 场景:非法实体失败
- **当** 样例包含非法枚举、缺失必填字段、错误字段类型或无效实体引用
- **那么** 校验必须失败，并返回可定位字段路径的错误信息

#### 场景:越界 visualIntent 现被拒绝（收紧行为锁定）
- **当** 一个 `SlidePlan` 的 `visualIntent` 不在 `VisualIntent` 枚举内（先前作为自由 string 合法）
- **那么** `validateSlidePlan`（及 `validateSlide`/`validatePresentation`）必须失败；必须存在一个 `invalid/*` fixture 锁定此收紧后的行为

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

### 需求:新增工作流状态变更事件类型

shared-schema `EVENT_TYPES` 必须新增一个 `WORKFLOW_STATE_CHANGED` 事件类型，用于表示一次工作流状态转移；`validateEvent` / `validateEventPayload` 必须为该类型新增 switch case 并校验其负载结构 `{ previousState, nextState }`，其中 `previousState`、`nextState` 必须 ∈ `WORKFLOW_STATES`。动作发起者以 `Event` 顶层 `actor`（∈ `ACTOR_TYPES`）表达，不放入 payload。此新增必须同步反映到 TypeScript 类型、JSON Schema 校验产物与 `docs/DATA_MODEL.md` 的 Event 类型清单。**（Phase 2 范围说明：`WORKFLOW_STATE_CHANGED` 是 Phase 2 对 shared-schema 源的唯一改动、Phase 2 不新增核心实体；后续阶段可依其所有权继续新增事件类型与实体——Phase 5 即新增大纲/规划事件与 `Outline` 实体。）**

#### 场景:合法的状态变更事件通过校验

- **当** 以 `type=WORKFLOW_STATE_CHANGED`、顶层 `actor="user"`、`payload={previousState:"NEW_PROJECT", nextState:"REQUIREMENT_DISCOVERY"}` 调用 `validateEvent`
- **那么** 校验必须通过

#### 场景:非法状态值的状态变更事件被拒绝

- **当** 状态变更事件的 `previousState` 或 `nextState` 不在 `WORKFLOW_STATES` 内
- **那么** `validateEvent` 必须返回字段路径错误

### 需求:Python 端可消费 shared-schema 常量

除既有的整实体校验桥（`validateEntity`）外，`apps/api` 必须能通过一个 shared-schema 消费入口读取运行时常量与派生映射，至少覆盖 `SCENES`、`WORKFLOW_STATES`、`ACTOR_TYPES`，以及 profile→scene 映射（`SCENES` 供 `INVALID_SCENE` 校验、`WORKFLOW_STATES` 供状态集合断言、映射供风格归属校验）。`EVENT_TYPES` 本期无后端本地消费方（事件类型由 `validateEvent` 校验桥强制），仅作为可选/前向用途，不纳入必需消费集合。profile→scene 映射必须以可序列化形式跨桥传递——由 `BUILT_IN_STYLE_PROFILES` / `DEFAULT_STYLE_PROFILE_ID_BY_SCENE` 序列化为映射后在 Python 侧查表（`getStyleProfileScene` 是函数，不能直接经打印常量的桥序列化）。这些符号均已由 `dist/index.js` 导出，消费入口以子进程桥形式读取，禁止在 Python 手抄这些常量。消费入口以 shared-schema 已构建产物（`dist/index.js`）为前置条件；由于 build-missing 守卫只覆盖 `dist` 缺失、不覆盖 `dist` 陈旧，编辑 shared-schema 源（新增事件类型）后必须重建 `dist` 再运行后端消费。

#### 场景:后端读取场景、状态与角色常量

- **当** `apps/api` 请求 shared-schema 常量
- **那么** 必须返回与 shared-schema 源一致的 `SCENES`、`WORKFLOW_STATES`、`ACTOR_TYPES` 数组与可序列化的 profile→scene 映射

#### 场景:构建产物缺失时给出明确前置错误

- **当** `dist/index.js` 未构建即请求常量
- **那么** 消费入口必须返回明确的构建前置错误（复用既有校验桥的 build-missing 语义），而非返回空集合或静默通过

### 需求:shared-schema 必须定义大纲实体与视觉意图枚举

shared-schema 必须新增 canonical 类型 `Outline`（`sections: OutlineSection[]`、`confirmedByUser: boolean`，可含可选 `id`、`riskNotes`）与 `OutlineSection`（`title`、`purpose`、`estimatedSlides` 正整数）；`OutlineSection` **不持有 slideId 列表**（slide 身份唯一来源是 `SlidePlan.slideId`，由服务层赋值）。必须新增 `VisualIntent` 枚举（`diagram`/`image`/`chart`/`text`/`comparison`/`timeline`）作为 `SlidePlan.visualIntent` 取值约束的唯一来源。`Outline` 必须登记进 `ENTITY_NAMES`、`EntityMap`、`validateEntity` 分发**与 `runtimeValidationEntrypoints`**（后者 `satisfies Record<EntityName,string>`——`ENTITY_NAMES` 加 `Outline` 会拓宽 `EntityName`，缺 `Outline` 键会 typecheck 失败）。以上除 `visualIntent` 收紧（见「可执行校验契约」修改需求）外为加法，禁止改动其它既有类型行为。

#### 场景:定义大纲与视觉意图契约

- **当** 消费方（后端/前端）引用大纲或视觉意图类型
- **那么** 必须来自 shared-schema 的 `Outline`/`OutlineSection`/`VisualIntent`，不存在重复定义，且 `validateEntity("Outline", …)` 可用

#### 场景:其它既有契约不回归

- **当** 新增大纲类型与枚举后运行 Phase 1–4 的 schema 校验样例
- **那么** 除刻意收紧的 `visualIntent` 外，全部既有 fixture 必须仍通过

### 需求:shared-schema 必须校验大纲与 SlidePlan 输出并暴露上限

shared-schema 必须新增 `validateOutline`（结构 + **`sections` 至少 1 项** + 每 section `estimatedSlides≥1` + section 数 ≤ 常量上限）与 `validateSlidePlan`（必填字段 + `visualIntent ∈ VisualIntent`）。合法对象必须通过、非法对象（含空 `sections`）必须被拒绝并给出字段路径。section 上限与总 slide 上限必须经 `validation-constants` 暴露给后端（禁止 Python 手抄）。

#### 场景:合法大纲/规划通过校验

- **当** 校验一个结构完整、`visualIntent` 合法、数量在上限内的大纲或 SlidePlan
- **那么** 校验必须通过

#### 场景:非法大纲/规划被拒绝

- **当** 校验缺必填字段、`visualIntent` 越界或数量超上限的大纲/SlidePlan
- **那么** 校验必须失败并返回字段路径

### 需求:大纲与规划事件类型及 payload 校验（fail-closed）

`EVENT_TYPES` 必须新增 `OUTLINE_GENERATED`、`OUTLINE_UPDATED`、`OUTLINE_CONFIRMED`、`SLIDE_PLAN_GENERATED`、`SLIDE_PLAN_UPDATED`、`SLIDE_PLAN_CONFIRMED`，并为每一类型在 `validateEventPayload` 新增 `case` 校验其必填 payload：`OUTLINE_*` 需 `{ sectionCount:int, nextState∈WORKFLOW_STATES }`；`SLIDE_PLAN_GENERATED` 需 `{ slideCount:int, slideIds:string[], nextState }`；`SLIDE_PLAN_UPDATED` 需 `{ slideId:string, nextState }`；`SLIDE_PLAN_CONFIRMED` 需 `{ slideCount:int, nextState }`。`validateEventPayload` 必须 **fail-closed**：对 `EVENT_TYPES` 中无显式 `case` 的事件类型返回校验失败（禁止空过），使「加了类型却漏写 payload case」显性失败。既有事件类型与其校验保持不变。

#### 场景:合法的大纲/规划事件通过校验

- **当** 校验一个类型属新增集合、payload 满足上述必填结构的事件
- **那么** 事件校验必须通过，可被追加到事件序列

#### 场景:缺必填 payload 字段的新事件被拒绝

- **当** 校验一个新增类型但缺 payload 必填字段（如 `SLIDE_PLAN_GENERATED` 无 `slideIds`）的事件
- **那么** 事件校验必须失败，禁止被追加（validate-before-append 保证零持久化）

#### 场景:无显式 case 的事件类型 fail-closed

- **当** 某事件类型已在 `EVENT_TYPES` 却未在 `validateEventPayload` 写 `case`
- **那么** 校验必须失败（fail-closed），而非空过放行

