## 新增需求

### 需求:shared-schema 必须定义主题 token 类型

shared-schema 必须新增 canonical `ThemeTokens` 类型（基础 token：`palette`（若干具名颜色）、`fonts`（若干具名字体角色）、`spacing`（若干具名间距）），作为 `Presentation.theme` 结构化取值的唯一契约源，禁止后端/引擎重复定义。`ThemeTokens` 必须登记进 `ENTITY_NAMES`、`EntityMap`、`validateEntity` 分发与 `runtimeValidationEntrypoints`（`satisfies Record<EntityName,string>`——加 `ThemeTokens` 会拓宽 `EntityName`，缺键会 typecheck 失败）。物化演示模型的**结构合法性**复用既有 `validatePresentation`/`validateSlide`/`validateElement`（不改其行为）。**注意 `validatePresentation` 对 `theme` 只做松散 `readRequiredObject`、不校验为 `ThemeTokens`**，故 theme 的 ThemeTokens 合法性必须由消费方（物化服务）显式 `validateEntity("ThemeTokens", theme)` 保证（见 `slide-materialization`），本需求不改动 `validatePresentation` 的松散行为。以上为**加法**，禁止改动 Phase 1–5 既有类型/枚举/校验的行为。

#### 场景:定义主题 token 契约

- **当** 后端物化或 `ppt-engine` 渲染器引用主题 token
- **那么** 必须来自 shared-schema 的 `ThemeTokens`，不存在重复定义，且 `validateEntity("ThemeTokens", …)` 可用

#### 场景:合法/非法主题 token 校验

- **当** 校验一个结构完整（palette/fonts/spacing 齐备）的 `ThemeTokens`，以及一个缺必填组的 `ThemeTokens`
- **那么** 前者必须通过、后者必须失败并返回字段路径

#### 场景:既有实体校验不回归

- **当** 新增 `ThemeTokens` 与物化事件后运行 Phase 1–5 的 schema 校验样例
- **那么** 全部既有 fixture（含 `Presentation`/`Slide`/`Element`）必须仍通过，无行为变更

### 需求:物化事件类型及 payload 校验（fail-closed）

`EVENT_TYPES` 必须新增 `SLIDES_MATERIALIZED`（**仅此一个**——本期唯一发射方是 `slides/materialize`；更新/再生成事件属 Phase 8 编辑阶段，由其发射方届时引入，本期不预加未被发射的事件类型），并在 `validateEventPayload` 新增其 `case` 校验必填 payload `{ slideCount:int(min 1), nextState∈WORKFLOW_STATES }`。`validateEventPayload` 必须保持 **fail-closed**（`EVENT_TYPES` 中无显式 `case` 的类型返回失败）。既有事件类型与其校验保持不变。

#### 场景:合法物化事件通过校验

- **当** 校验一个 `type=SLIDES_MATERIALIZED`、payload `{slideCount:3, nextState:"SLIDE_GENERATION"}` 的事件
- **那么** 事件校验必须通过

#### 场景:缺必填 payload 的物化事件被拒绝

- **当** 校验一个 `SLIDES_MATERIALIZED` 但缺 `slideCount` 或 `nextState` 的事件
- **那么** 事件校验必须失败，禁止被追加（validate-before-append 零持久化）
