# web-spec-review 规范

## 目的
待定 - 由归档变更 phase-4-frontend-workflow-shell 创建。归档后请更新目的。
## 需求
### 需求:确认前摘要卡限于可获取数据

**约束（重要）**：后端**没有**「读取待确认 Spec」的端点——`GET /api/projects/{id}` 只返回 `projectId/title/scene/styleProfileId/status`，完整的 `questionPolicy`/`riskNotes` 由 `build_spec` 在 `confirm` 时生成、**仅在 `confirm` 响应里**返回。因此确认前的摘要卡**只能展示前端已可获取的数据**：`scene`、`styleProfileId`（来自 `GET project` 或流程上下文）、所选 `mode`（fast/thorough，前端自己设定）、`discover` 返回的 `threshold`，以及已答/已跳过问题的计数。界面**禁止**声称展示确认前不可得的完整 `questionPolicy`/`riskNotes`（否则只能造假或提前确认）。本期不新增后端读取端点（纯前端边界）。

其中 `mode`/`threshold`/已答已跳过计数属**会话本地状态**（来自本次流程中前端持有的 `discover`/`answer`/`skip` 响应），硬刷新复核页会丢失且 `GET project` 无法补取。此时摘要卡必须**优雅降级**为仅 `scene`/`styleProfileId`（`GET project` 可得），**禁止**为补数据在复核页重新调用 `discover`（会覆盖后端会话态）。

#### 场景:确认前只展示可得字段

- **当** 用户进入 Spec review 页尚未确认
- **那么** 摘要卡只展示 scene/styleProfileId/mode/threshold/已答已跳过计数，不虚构 `questionPolicy`/`riskNotes`

#### 场景:硬刷新复核页降级

- **当** 用户硬刷新复核页、会话本地字段丢失
- **那么** 摘要卡必须降级为仅展示 scene/styleProfileId，禁止为补 mode/threshold/计数而重新 `discover`

### 需求:确认并展示已确认 Spec

Spec review 页必须提供确认动作调用 `POST /api/projects/{id}/requirements/confirm`。确认成功后必须用 `confirm` **响应**里的完整字段（`questionPolicy`、`riskNotes`、`scene`、`styleProfileId`、`presentationSpecId`）展示「已确认的 Spec」，并反映项目仍停留在 `REQUIREMENT_REVIEW`（本期不进入 outline，后续阶段前向边尚不存在）。**已知限制**：`GET project` 不返回 `confirmedByUser`，故「已确认」展示态**在硬刷新后不可恢复**——刷新后前端无法得知项目已确认，会退化为展示可确认的复核页；再次点击确认**重放安全**（不崩溃、不产生错误态），但**非严格幂等**——后端每次都重建 spec 并生成**新的 `presentationSpecId`**、追加一条 `PRESENTATION_SPEC_CONFIRMED` 事件（去重/短路重复确认属后端职责，非本纯前端期范围）。本期接受此退化，不加后端读取端点。

#### 场景:确认后展示完整 Spec

- **当** 用户确认，`confirm` 返回完整 spec 字段与 `nextState=REQUIREMENT_REVIEW`
- **那么** 界面必须以确认响应展示完整的 questionPolicy/riskNotes，显示「已确认」，停留复核态，不跳转到不存在的后续阶段

#### 场景:硬刷新后已确认态不可恢复（接受退化）

- **当** 已确认项目硬刷新复核页（`GET project` 无 `confirmedByUser`）
- **那么** 界面退化为可确认复核页；再次确认**重放安全**（不崩溃、不产生错误态），但非严格幂等（后端重建 spec、生成新 `presentationSpecId`、追加事件）

#### 场景:Spec 校验失败

- **当** 确认因 `SPEC_VALIDATION_ERROR` 失败
- **那么** 界面必须提示 Spec 未通过校验、保持未确认态，不崩溃

### 需求:改 profile 一律先回退再改（rollback-first）

在复核页改 `scene`/`styleProfileId` 时，界面**必须**统一采用「**先回退再改**」次序：先驱动 `REQUIREMENT_REVIEW → REQUIREMENT_DISCOVERY` 回退，**在 `REQUIREMENT_DISCOVERY` 态下**再 `PATCH .../profile`，随后重新 `discover`。**禁止**在 `REQUIREMENT_REVIEW` 态直接 `PATCH profile`。

改 profile 的动作次序必须是：① 先回退 `REVIEW→DISCOVERY`（项目进入 `REQUIREMENT_DISCOVERY`；复核页据「非 REVIEW 即重定向」自动把用户带回澄清页）→ ② 在 `REQUIREMENT_DISCOVERY` 态 `PATCH .../profile` → ③ 重新 `discover` → ④ 之后由用户在澄清页显式点「进入复核」重新到达可确认态。**`PATCH profile` 只能发生在 DISCOVERY 态**，确认动作只在澄清页显式推进后才在复核页出现。

**理由（后端不变量）**：回退 `REVIEW→DISCOVERY` 清空 `project.spec`（`workflow.py`）但保留会话；`PATCH .../profile` 每次成功清空 `project.discovery`+`project.spec` 且**不改状态**。若在 REVIEW 态直接改 profile，会把项目留在「REVIEW 但无会话」，而 `GET project` 只返回 `status`、无法区分它与可确认的 REVIEW。先回退再改使改 profile 时项目在 DISCOVERY（非可确认态）；**且因 profile 流程在澄清页 URL 下、复核页在非 REVIEW 态 mount 一律重定向而非自动推进（见 `web-workflow-shell` 前向转移需求）**，会话被清空的窗口内任何刷新都落在澄清页（显示重启 CTA）或被复核页重定向走，**不会**出现「从无会话 DISCOVERY 自动推进出无会话 REVIEW 并弹出必失败确认」。已确认项目本就被后端强制先回退（否则 `SPEC_NOT_CONFIRMABLE`），故两种情形统一为同一次序。

#### 场景:未确认在 REVIEW 改 profile 也先回退

- **当** 项目未确认、处于 `REQUIREMENT_REVIEW`，用户要改 profile
- **那么** 界面必须先回退到 `REQUIREMENT_DISCOVERY` 再 `PATCH profile`，禁止在 REVIEW 态直接改而把项目留在「无会话的 REVIEW」

#### 场景:已确认改 profile 先回退

- **当** 项目已确认，用户要改 profile
- **那么** 界面必须先回退到 `REQUIREMENT_DISCOVERY`（后端亦强制此次序，否则 `SPEC_NOT_CONFIRMABLE`）再改，随后重新澄清确认

#### 场景:回退改后重走流程

- **当** 用户回退到 `REQUIREMENT_DISCOVERY`、改了 profile、重新 `discover`
- **那么** 界面必须让用户重新走澄清→复核→确认流程（旧会话/确认已作废）

