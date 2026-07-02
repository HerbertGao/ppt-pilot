# llm-provider 规范

## 目的
待定 - 由归档变更 phase-3-requirement-discovery-and-spec-builder 创建。归档后请更新目的。
## 需求
### 需求:文本 LLMProvider 接口

系统必须定义一个文本生成的 `LLMProvider` 接口，作为所有 agent 访问语言模型的唯一入口。接口输入必须是消息/prompt 与模型标识，输出必须是文本。agent 禁止绕过该接口直接发起模型调用。本期 `LLMProvider` 必须**仅暴露文本能力**，禁止定义或引入任何图像生成 / 文生图 / `ImageProvider` 能力（归属 Phase 9）。

#### 场景:agent 经接口获取文本

- **当** 任一 Phase 3 agent 需要模型输出
- **那么** 它必须通过 `LLMProvider` 接口获取文本，禁止在 agent 内直接实例化具体网络客户端

#### 场景:不含图像能力

- **当** 审视 `LLMProvider` 接口定义
- **那么** 其方法必须只覆盖文本生成，禁止出现图像生成 / 文生图相关方法

### 需求:OpenRouter 适配器凭配置注入

系统必须提供一个 OpenRouter 的 `LLMProvider` 实现。其模型标识、API key、Base URL 等必须经配置或环境变量注入，禁止硬编码密钥。调用必须设置超时；网络/上游失败必须映射为统一错误信封（见 `api-error-and-validation-contract` 的 `LLM_PROVIDER_ERROR`），且失败时禁止产生任何持久副作用。

#### 场景:凭据来自配置

- **当** 构造 OpenRouter provider
- **那么** API key 与模型标识必须来自配置/环境变量，源码中禁止出现明文密钥

#### 场景:上游失败被统一映射

- **当** OpenRouter 调用超时或返回上游错误
- **那么** 系统必须返回统一错误结构（`LLM_PROVIDER_ERROR`），且不写入项目状态、不追加事件

### 需求:确定性 mock provider 用于测试与默认

系统必须提供一个确定性的 mock `LLMProvider`，可编程返回固定输出，作为契约测试与本地默认实现。契约测试必须使用 mock provider，CI 禁止发起真实 OpenRouter 网络请求。

#### 场景:契约测试走 mock

- **当** 运行 Phase 3 契约测试
- **那么** agent 必须由 mock provider 驱动，测试结果必须可复现且不依赖外部网络

### 需求:结构化输出在 agent 层分类校验

由于 `LLMProvider` 返回文本，将文本解析为结构化对象并校验的责任必须落在 agent 层。校验必须按输出类别分流，禁止把非 canonical 的瞬时输出硬塞进 shared-schema 校验：

- **canonical 产物**（`PresentationSpec`、以及将要追加的 `Event` 负载）必须经 shared-schema 校验入口（`validateEntity` / `validateEvent`）校验。
- **瞬时中间输出**（需求发现草稿、问题列表、gap 分类、置信度等不属于 canonical 实体的会话态）必须经**后端结构（Pydantic 等）校验**，不走 shared-schema。

任一类别校验失败必须触发有界修复重试（默认不超过 1 次），仍非法则拒绝且不入库、不追加事件。

#### 场景:canonical 产物走 shared-schema 校验

- **当** agent 产出 `PresentationSpec` 或要追加的 `Event` 负载
- **那么** 系统必须经 shared-schema 校验入口校验，非法即拒

#### 场景:瞬时输出走后端结构校验

- **当** agent 产出需求发现草稿 / 问题 / 置信度等瞬时会话态
- **那么** 系统必须以后端结构校验其形状，禁止要求它通过 shared-schema 校验（它无对应 canonical 实体）

#### 场景:非法模型输出被拒绝且不半写

- **当** 模型输出无法解析为 JSON 或校验失败且修复重试后仍非法
- **那么** 系统必须拒绝该次生成，禁止写入任何持久状态或追加事件

