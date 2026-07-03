# outline-agent 规范

## 目的
待定 - 由归档变更 phase-5-outline-and-slide-planning 创建。归档后请更新目的。
## 需求
### 需求:Outline Agent 从确认的 Spec 生成结构化大纲

系统必须提供 Outline Agent，输入为**已确认**的 `PresentationSpec`（`scene`、`styleProfileId`、`questionPolicy`、`riskNotes` 及已知需求上下文），输出结构化大纲：一组 `sections`（至少 1 项），每个 section 含 `title`、`purpose`、`estimatedSlides`（正整数）——**section 不含 slideId 列表**（slide 身份唯一来源为 `SlidePlan.slideId`，由服务层赋值）。Agent 必须经既有 `LLMProvider` 文本接口运行（不新增接口），默认使用决定性 `MockLLMProvider`（CI 无网络）。**错误码分层（仿 `spec_builder.py::build_spec` 的自有循环，不用 `generate_validated`）**：agent 以 `for attempt in range(max_repair+1)` 自有循环 `provider.generate → parse → 注入 runtime 拥有的 confirmedByUser=false（及可选 id/riskNotes，仿 build_spec 的 candidate.update）→ 内联 validateOutline`（校验完整 `Outline` 含必填 `confirmedByUser`，非裸 `{sections}`），不过则附修复提示重试一次；**耗尽后抛 `OutlineValidationError` → `OUTLINE_VALIDATION_ERROR`(400)**。不复用 `generate_validated`（它把校验失败归为 `LLM_PROVIDER_ERROR`(502)，与此处需要的 400 冲突）；Provider 传输层异常从循环传播为 `LLM_PROVIDER_ERROR`(502)。校验不过零持久化、不追加事件。

#### 场景:从确认的 Spec 生成大纲

- **当** 一个已确认 Spec 的项目请求生成大纲
- **那么** Outline Agent 必须产出至少一个 section、每个 section 含非空 `title`/`purpose` 与 `estimatedSlides≥1`，且整体通过 `Outline` schema 校验

#### 场景:Agent 经 LLMProvider 运行且 CI 决定性

- **当** 在 CI（默认 `MockLLMProvider`）下生成大纲
- **那么** 相同输入必须产生决定性输出，且过程不发起任何真实网络/LLM 调用

#### 场景:大纲结构非法经内联校验产 400

- **当** Provider 返回的大纲结构非法（缺字段/section 数超上限/`estimatedSlides<1`），有界修复一次后仍不过
- **那么** 系统必须经**内联 `validateOutline`** 以 `OUTLINE_VALIDATION_ERROR`(400) 失败，不持久化任何大纲、不追加事件

#### 场景:Provider 传输失败产 502（与校验失败分开）

- **当** 生成大纲时底层 Provider 抛出传输类错误（超时/上游失败/畸形响应）
- **那么** 系统必须以 `LLM_PROVIDER_ERROR`(502) 呈现（`provider.generate` 的传输异常从自有修复循环传播），不持久化半成品、不追加事件；此路径与上面的 400 校验失败路径由不同代码分支产生

