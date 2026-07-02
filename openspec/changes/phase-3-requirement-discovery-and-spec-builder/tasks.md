## 1. shared-schema：事件 fixtures 与回归（校验已存在，不改源）

> 前提：5 个 Phase-3 事件类型的负载校验（`validation.ts:1215-1277`）、类型与 `docs/DATA_MODEL.md` 清单已在 Phase 1 实现。本组**不改 shared-schema 校验逻辑**，只补 fixtures 并修正一处过期 fixture。

- [x] 1.1 修正 `packages/shared-schema/fixtures/valid/event-minimal.json`（`PRESENTATION_SPEC_CONFIRMED`）的 `nextState`：`OUTLINE_GENERATION` → `REQUIREMENT_REVIEW`，与新确认语义（D3）对齐
- [x] 1.2 为尚无 fixture 的 4 个事件（`SCENE_STYLE_PROFILE_UPDATED`、`QUESTION_POLICY_APPLIED`、`REQUIREMENT_QUESTION_ASKED`、`REQUIREMENT_QUESTION_SKIPPED`）各加 `fixtures/valid/` 合法样例（负载字段完整满足 `docs/DATA_MODEL.md` 既有契约）+ `fixtures/invalid/` 缺必需字段/非法枚举样例
- [x] 1.3 跑 `pnpm --filter @ppt-pilot/shared-schema validate:fixtures`（即 `packages/shared-schema/scripts/validate-fixtures.mjs`）验证合法通过/非法拒绝；未改校验源

## 2. LLMProvider 接口与实现

- [x] 2.1 在 `apps/api/app/llm/` 定义 `LLMProvider` 文本接口（`generate(messages, *, model, response_format) -> text`），仅文本能力，禁止图像方法
- [x] 2.2 实现确定性 `MockLLMProvider`（可编程返回），作为测试与本地默认
- [x] 2.3 实现 `OpenRouterProvider`：模型/API key/Base URL 经配置或环境变量注入（不硬编码），设超时，上游/超时失败抛领域异常
- [x] 2.4 provider 选择经配置装配（默认 mock）；确认 CI 路径不实例化真实 OpenRouter
- [x] 2.5 验收：单测覆盖 mock 返回可复现、OpenRouter 缺凭据/超时映射为异常路径

## 3. Agent 运行时（Requirement Discovery / Gap / Question / Spec Builder）

- [x] 3.1 在 `apps/api/app/agents/` 落地 4 个 agent 模块，均经 `LLMProvider` 运行；prompt 模板（源自 `docs/PROMPTS.md`）版本化存于 `packages/ai-workflow`（语言中立数据/文本），由后端运行时加载——运行时在 apps/api、定义在 ai-workflow（D1）
- [x] 3.1a 给 `packages/ai-workflow/README.md` 增加一行 Phase-3 边界说明：本包承载版本化 prompt 模板 + agent I/O 契约（无运行时），运行时在 `apps/api`
- [x] 3.2 Discovery Agent：抽取已知/未知字段 + 置信度，输出结构化并校验；结果存后端瞬时会话态（挂 `StoredProject`，不进 shared-schema）
- [x] 3.3 Gap 分类：`MUST_ASK`/`SHOULD_ASK`/`DO_NOT_ASK`，按 `scene` 排序（education/corporate 优先项）
- [x] 3.4 Question Agent：多选 + 可选自由文本，稳定 `questionId`
- [x] 3.5a 扩展常量桥 `apps/api/app/shared_schema_constants.py`：在 `NODE_CONSTANTS_SCRIPT` 与 `SharedSchemaConstants` dataclass 增补 `DEFAULT_FAST_SCENE_THRESHOLD_BY_SCENE`/`THOROUGH_MIN_SCENE_THRESHOLD`/`DEFAULT_MAX_QUESTIONS_BY_MODE`（三者已由 `profiles.ts` 经 `index.ts` 导出，桥当前未 surface）；补一条消费断言（仿现有 `default_profile_id_by_scene` 的 smoke）
- [x] 3.5 问题策略模块：`scene→sceneThreshold`（0.82/0.75/0.78，thorough ≥0.85）+ `mode→maxQuestions`（3/5）**经 3.5a 扩展后的常量桥消费 `profiles.ts` 既有常量**，禁止在 Python 手抄；标定旋钮作为覆盖层而非重新声明。实现四类停止条件
- [x] 3.6 Spec Builder：产出 `PresentationSpec`，快照 scene/styleProfileId/questionPolicy/riskNotes；输出经 `validateEntity` 校验，非法触发有界修复重试（≤1）后拒绝
- [x] 3.7 验收：单测覆盖达阈停止、达上限停止、跳过写 riskNotes、非法 agent 输出被拒不半写（全走 mock provider）

## 4. Requirement/Spec HTTP 表面

- [x] 4.1 在 `apps/api/app/routes.py`（及新增 service 模块）实现 `POST .../requirements/discover`
- [x] 4.2 实现 `POST .../requirements/questions/{questionId}/answer` 与 `.../skip`（未知 questionId → `QUESTION_NOT_FOUND`）
- [x] 4.3 实现 `POST .../requirements/confirm`：构建 + 校验 + 确认，`confirmedByUser=true`、追加 `PRESENTATION_SPEC_CONFIRMED`，`nextState=REQUIREMENT_REVIEW`（不推进状态）
- [x] 4.4 实现 `PATCH .../profile`：scene/styleProfile 校验、归属校验、`SCENE_STYLE_PROFILE_UPDATED`；确认后改 profile 须先回退（复用 review→discovery 回退边），否则 `SPEC_NOT_CONFIRMABLE`。回退时**重置 `confirmedByUser=false` 并作废旧 Spec 快照**，要求重新确认
- [x] 4.5 事件写入：按动作追加**既有事件类型**（shared-schema 仅有这 5 个 + `WORKFLOW_STATE_CHANGED`，不新增）——discover 提问时追加 `REQUIREMENT_QUESTION_ASKED` 与 `QUESTION_POLICY_APPLIED`；skip → `REQUIREMENT_QUESTION_SKIPPED`；confirm → `PRESENTATION_SPEC_CONFIRMED`；profile 更新 → `SCENE_STYLE_PROFILE_UPDATED`。**answer 仅更新置信度，无对应事件类型**（除非重新提问再触发 `REQUIREMENT_QUESTION_ASKED`）。负载**按 `docs/DATA_MODEL.md` 既有契约完整填充**（如 `QUESTION_POLICY_APPLIED` 带 confidence+thresholdReached、`REQUIREMENT_QUESTION_ASKED` 带 prompt/kind/options/confidenceBefore、`REQUIREMENT_QUESTION_SKIPPED` 带 reason/confidenceAfter/riskNote、`PRESENTATION_SPEC_CONFIRMED` 带 scene/styleProfileId/questionPolicy/riskNotes/nextState），追加前经 `validateEvent`（见 `event-log` 增量）
- [x] 4.6 沿用错误优先级（请求体 > 项目存在 > 领域校验）与「失败无持久副作用」不变量

## 5. 错误约定扩展

- [x] 5.1 在 `apps/api/app/errors.py` 新增 `SPEC_VALIDATION_ERROR`→`VALIDATION_ERROR`、`QUESTION_NOT_FOUND`→`NOT_FOUND`、`SPEC_NOT_CONFIRMABLE`→`STATE_ERROR`（这三个 error 组已存在）
- [x] 5.1a 新增 `UpstreamError`（**必须继承 `DomainError`**，否则不走 `handle_domain_error`/`_STATUS_BY_ERROR`）与 `LLM_PROVIDER_ERROR`（`error=UPSTREAM_ERROR`），并在 `apps/api/app/main.py` 的 `_STATUS_BY_ERROR` 注册 `UPSTREAM_ERROR → 502`（该 error 组当前不存在；未注册时 `_STATUS_BY_ERROR.get(exc.error, 400)` 会默认落到 **400** 而非预期的 5xx）
- [x] 5.2 `LLMProvider` 上游异常经处理器映射为统一 5xx（`LLM_PROVIDER_ERROR`），不泄漏框架默认体
- [x] 5.3 验收：各错误码返回统一 `{error,code,details}` 且请求无持久副作用

## 6. 契约测试

- [x] 6.1 在 `apps/api/tests/` 新增 Phase 3 契约测试，全部由 mock provider 驱动，CI 不发真实网络请求
- [x] 6.2 覆盖：discover 返回问题/置信度、answer 更新置信度、skip 写 riskNotes+事件、达阈/达上限停止
- [x] 6.3 覆盖：Spec 校验失败拒绝、confirm 置位不改状态、confirm 后 `to=OUTLINE_GENERATION` 仍被拒
- [x] 6.4 覆盖：确认后直接改 profile 被拒（`SPEC_NOT_CONFIRMABLE`）、经回退后可改且回退已重置 `confirmedByUser`/作废旧 Spec（须重新确认）；未知 questionId、非法 scene、LLM 上游失败各自无副作用
- [x] 6.6 覆盖：后端追加的各事件负载完整通过既有 `validateEvent`（含 `QUESTION_POLICY_APPLIED` 的 confidence/thresholdReached 等必需字段），负载不完整时不追加
- [x] 6.5 安全回归：确认动作与任意转移均不触发真实 LLM 之外的越权写；锁定/版本运行时本期不受影响（保持 Phase 2 边界）

## 7. 文档与收尾

- [x] 7.1 `docs/API.md` §3 由 Roadmap Draft 转为 Phase 3 已实现；confirm 响应 `nextState` 改为 `REQUIREMENT_REVIEW`；`PATCH .../profile` 转为已实现并写明确认后回退规则
- [x] 7.2 `docs/ROADMAP_PROGRESS.md` 将 Phase 3 状态更新为进行中/完成
- [x] 7.3 运行 `openspec-cn validate`（或等价）确认变更产物一致，准备归档
