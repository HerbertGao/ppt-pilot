## 新增需求

### 需求:需求发现与 Spec 构建的稳定错误码

系统必须为 Phase 3 需求/Spec 流程新增稳定错误码，纳入 Phase 2 统一错误信封（`error` / `code` / `details`）与错误分类映射，且同类错误使用同一稳定码：

- `VALIDATION_ERROR` 扩展覆盖 `SPEC_VALIDATION_ERROR`（Spec Builder 输出未过 schema 校验）。
- `NOT_FOUND` 扩展覆盖 `QUESTION_NOT_FOUND`（`questionId` 不存在）。
- `STATE_ERROR` 扩展覆盖 `SPEC_NOT_CONFIRMABLE`（无已校验 Spec 却请求确认，或已确认态未回退即改 profile）。
- 新增 `LLM_PROVIDER_ERROR`（`error=UPSTREAM_ERROR`，HTTP `502`）表示 `LLMProvider` 上游/超时失败；承载它的异常类必须继承 `DomainError` 并在 `_STATUS_BY_ERROR` 注册 `UPSTREAM_ERROR → 502`，否则会默认落到 400。

这些错误码必须稳定且机器可读，禁止用裸文本代替。已有的 `INVALID_SCENE` / `STYLE_PROFILE_MISMATCH` 继续用于 `PATCH .../profile` 的场景/风格校验。

#### 场景:Spec 校验失败返回稳定码

- **当** `POST .../requirements/confirm` 因 Spec Builder 输出非法而失败
- **那么** 响应必须为 `error=VALIDATION_ERROR`、`code=SPEC_VALIDATION_ERROR` 的统一结构

#### 场景:未知问题返回稳定码

- **当** 客户端对不存在的 `questionId` 作答或跳过
- **那么** 响应必须为 `error=NOT_FOUND`、`code=QUESTION_NOT_FOUND` 的统一结构

#### 场景:LLM 上游失败返回统一 502

- **当** `LLMProvider` 调用超时或上游报错
- **那么** 响应必须为 `error=UPSTREAM_ERROR`、`code=LLM_PROVIDER_ERROR` 的统一 `502` 结构，而非框架默认错误体或默认 400

### 需求:Phase 3 接口沿用失败无副作用不变量

Phase 2「校验失败不产生副作用」保护约定必须扩展到全部 Phase 3 需求/Spec 接口：任何因校验失败、未知问题、Spec 不可确认或 LLM 上游失败而被拒绝的请求，禁止改动持久状态、禁止推进工作流状态、禁止追加事件。

#### 场景:LLM 失败不留痕

- **当** 一次需求发现调用因 `LLM_PROVIDER_ERROR` 失败
- **那么** 项目状态、Spec 与事件序列必须与请求前完全一致

#### 场景:Spec 校验失败不留痕

- **当** 一次确认因 `SPEC_VALIDATION_ERROR` 被拒绝
- **那么** `confirmedByUser` 必须保持原值，且不追加 `PRESENTATION_SPEC_CONFIRMED`
