## 新增需求

### 需求:Slide Planner Agent 从确认的大纲逐页生成 SlidePlan

系统必须提供 Slide Planner Agent，输入为**已确认**的大纲（`Outline`）及确认的 `PresentationSpec` 上下文，逐 section 展开为逐页 `SlidePlan`：每个 `SlidePlan` 必须含 `objective`、`keyMessage`、`contentIntent`、`visualIntent`（取值必须 ∈ `VisualIntent` 枚举：`diagram`/`image`/`chart`/`text`/`comparison`/`timeline`）、`layoutSuggestion`、`requiredAssets`（数组）与 `riskNotes`（数组）。**`slideId` 由服务层确定性赋值（非 LLM）**：`slides/plans/generate` 为每页按序赋稳定唯一 id（如 `slide-0001`），生成的规划集必须两两 `slideId` 唯一（集合级校验），`slideId` 在服务采纳时视为必填——保证单页编辑 `PUT /slides/{slideId}/plan` 有稳定可寻址的键。Agent 必须经既有 `LLMProvider` 文本接口运行，默认决定性 `MockLLMProvider`。**错误码分层（仿 `spec_builder.py::build_spec` 自有循环，不用 `generate_validated`）**：以 `for attempt in range(max_repair+1)` 自有循环 `provider.generate → parse → 逐条内联 validateSlidePlan + 集合级 slideId 唯一性检查`，不过则重试一次；耗尽后非法（缺必填/`visualIntent` 越界/slideId 缺失或重复/总 slide 数超上限）必须抛 `SlidePlanValidationError` → `SLIDE_PLAN_VALIDATION_ERROR`(400)。不复用 `generate_validated`（它只产 `LLM_PROVIDER_ERROR`(502)）；Provider 传输异常从循环传播为 502。零持久化、不追加事件。若某 section 的 `estimatedSlides` 与该 section 实际生成页数不符，服务层**在生成期**（唯一能知 section↔页归属的时点）向该 section 的首页 `SlidePlan.riskNotes` 追加一条软提示，不硬失败、不作事后重算。

#### 场景:从确认的大纲生成逐页规划

- **当** 一个大纲已确认的项目请求生成 slide plans
- **那么** Slide Planner 必须为大纲覆盖的每一页产出一个通过 `SlidePlan` 校验的规划，且每个规划的 `visualIntent` ∈ `VisualIntent` 枚举

#### 场景:visualIntent 越界经内联校验产 400

- **当** Provider 返回的某页 `visualIntent` 不在枚举内，有界修复一次后仍不过
- **那么** 系统必须经**内联 `validateSlidePlan`** 以 `SLIDE_PLAN_VALIDATION_ERROR`(400) 失败，不持久化任何规划、不追加事件

#### 场景:服务层赋稳定唯一 slideId

- **当** `slides/plans/generate` 成功产出 N 页规划
- **那么** 每页的 `slideId` 必须由服务层确定性赋值、两两唯一、且此后可被 `PUT /slides/{slideId}/plan` 稳定寻址（LLM 不负责 slideId 的存在性/唯一性）

#### 场景:CI 决定性且不触网

- **当** 在 CI（默认 `MockLLMProvider`）下生成规划
- **那么** 相同的已确认大纲必须产生决定性规划输出，且不发起真实网络/LLM 调用

#### 场景:总页数超上限

- **当** 生成的规划总 slide 数超过 `validation-constants` 暴露的上限
- **那么** 系统必须以 `SLIDE_PLAN_VALIDATION_ERROR` 失败，不持久化、不追加事件
