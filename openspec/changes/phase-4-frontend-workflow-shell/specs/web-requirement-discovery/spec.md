## 新增需求

### 需求:调用 discover 前的状态前置

后端 `discover` **无工作流状态守卫**且会**覆盖** `project.discovery` 会话态。为避免在错误状态下（如 `NEW_PROJECT` 或已进入 `REQUIREMENT_REVIEW`）误建/覆盖会话，需求澄清页必须在调用 `discover` 前确保项目处于 `REQUIREMENT_DISCOVERY`：进入本页时若项目为 `NEW_PROJECT`，必须先由 shell 驱动 `NEW_PROJECT → REQUIREMENT_DISCOVERY` 转移（见 `web-workflow-shell` 的前向转移需求）再调用 `discover`；已确认（`REQUIREMENT_REVIEW`）的项目要重新澄清，必须先按回退规则回到 `REQUIREMENT_DISCOVERY`。

#### 场景:NEW_PROJECT 进入澄清先转移

- **当** 项目为 `NEW_PROJECT`，用户进入需求澄清页
- **那么** 前端必须先转移到 `REQUIREMENT_DISCOVERY` 再调用 `discover`，不得在 `NEW_PROJECT` 直接 discover

### 需求:discover 仅首次/显式重启调用，不静默覆盖会话

`discover` **每次调用都会用全新会话覆盖 `project.discovery`**（丢失已答/已跳过），且后端**无「读取进行中会话」端点**，`answer`/`skip` 只回置信度视图、不回问题列表。因此需求澄清页**禁止在重入/硬刷新时静默重新 `discover`**：`discover` 只在**首次进入**或用户**显式重启**时调用。SPA 内导航（客户端状态仍在）重入时用本地状态还原问题卡；**硬刷新**导致本地状态丢失时，因无会话读端点无法还原进行中问答，必须提供**显式「重新开始澄清」**入口（用户确认后才重新 `discover`），不得自动覆盖既有会话。

#### 场景:硬刷新不自动覆盖会话

- **当** 用户在 `REQUIREMENT_DISCOVERY` 进行到一半硬刷新澄清页、客户端状态丢失
- **那么** 界面禁止自动重新 `discover`（会清掉后端已答/已跳过），必须展示显式「重新开始澄清」入口由用户决定

#### 场景:SPA 重入用本地状态

- **当** 用户在应用内离开又回到澄清页、客户端状态仍在
- **那么** 界面必须用本地状态还原已渲染的问题卡与进度，不重新 `discover`

### 需求:fast/thorough 模式与问题卡渲染

需求澄清页必须支持 `fast` / `thorough` 模式切换，并调用 `discover` 将返回的问题渲染为结构化问题卡——多选选项 + 可选自由文本（见 `docs/UI.md` §7），而非纯文本聊天框。每张卡必须使用后端返回的稳定 `questionId`。

#### 场景:渲染结构化问题卡

- **当** `discover` 返回若干问题
- **那么** 界面必须为每个问题渲染带选项与可选自由文本的卡片，并用其 `questionId` 标识

#### 场景:模式切换影响提问

- **当** 用户切到 `thorough` 模式并发起澄清
- **那么** 界面必须以该模式调用 `discover`（更高置信度阈值、更大提问上限由后端裁定）

### 需求:作答与跳过更新置信度

用户必须能逐题作答（`answer`）或跳过（`skip`）。作答后界面必须用返回的 `confidence` / `threshold` / `thresholdReached` 更新可见进度；跳过必须调用 `skip`。`QUESTION_NOT_FOUND` 表示会话已失效/被覆盖（后端无进行中会话读端点、`answer`/`skip` 不回问题列表）——界面**必须**将其作为会话失效处理，展示显式「重新开始澄清」入口由用户确认后再 `discover`，**禁止**自动 `discover` 去「刷新问题列表」（会覆盖后端会话），也禁止卡死。

#### 场景:作答更新置信度进度

- **当** 用户回答一个问题
- **那么** 界面必须调用 `answer` 并用返回的置信度/阈值更新进度显示

#### 场景:跳过问题

- **当** 用户跳过一个问题
- **那么** 界面必须调用 `skip`（记录风险由后端处理），并允许继续流程

#### 场景:QUESTION_NOT_FOUND 作会话失效处理

- **当** `answer`/`skip` 因 `QUESTION_NOT_FOUND` 失败（会话已失效/被覆盖）
- **那么** 界面必须展示显式「重新开始澄清」入口（用户确认后才 `discover`），禁止自动 `discover` 刷新、禁止卡死

### 需求:达阈或无问题时进入复核

当 `thresholdReached=true` 或 `discover` 返回空问题列表（后端判定信息已足够）时，界面必须呈现「信息已足够，可进入复核」并提供进入 Spec review 的入口。界面禁止假设总有问题可答。

#### 场景:置信度已达阈直接可复核

- **当** `discover` 返回 `questions=[]` 且 `thresholdReached=true`
- **那么** 界面必须提示信息已足够并允许进入复核，不显示空的问答区或报错
