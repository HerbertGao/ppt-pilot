# project-lifecycle-api 规范

## 目的
待定 - 由归档变更 phase-2-api-skeleton-and-workflow-state 创建。归档后请更新目的。
## 需求
### 需求:创建项目

系统必须提供 `POST /api/projects` 接口，用于创建一个新项目。请求字段 `title`、`initialRequest`、`scene`、`styleProfileId` 全部可选：`title`/`initialRequest` 缺省时分别落地为空字符串/空值，空请求体 `{}` 必须成功创建一个默认场景项目而非报错。系统必须落地项目的初始 `WorkflowState` 为 `NEW_PROJECT`，并返回 `projectId` 与当前状态。`scene` 未传时必须默认 `default`；`styleProfileId` 未传时必须按 `scene` 回退到 shared-schema 定义的内置默认 profile id。

场景与风格归属校验必须由后端逻辑基于 **shared-schema 派生的可序列化 profile→scene 映射**执行（经常量桥读取，由 `BUILT_IN_STYLE_PROFILES` / `DEFAULT_STYLE_PROFILE_ID_BY_SCENE` 序列化为映射后在 Python 侧查表，见 `shared-schema-contract` 常量消费需求），而非通过 `PresentationSpec`/`Presentation` 的整实体校验器——本期不存在已确认的 spec，也不新增 shared-schema `Project` 实体。请求字段 `scene`、`styleProfileId` 及转移端点的 `to` 必须以原始字符串接收并在领域层校验（禁止用 pydantic 枚举类型），否则未知值会被框架误判为 `INVALID_REQUEST_BODY` 而非领域错误。校验规则：`scene` 必须 ∈ `SCENES`，否则 `INVALID_SCENE`；给定 `styleProfileId` 时，映射中该 id 对应的 scene 必须等于 `scene`，否则 `STYLE_PROFILE_MISMATCH`；未知 `styleProfileId`（映射无此项）同样按 `STYLE_PROFILE_MISMATCH` 处理。校验顺序：`scene` 校验先于 `styleProfileId` 归属校验，两者同时不满足时返回 `INVALID_SCENE`。任一校验失败必须返回错误且禁止写入任何持久状态。

#### 场景:使用合法输入创建项目

- **当** 客户端以合法 `title` 与 `scene=education` 请求 `POST /api/projects`
- **那么** 系统必须创建项目、将初始状态置为 `NEW_PROJECT`，并返回包含 `projectId` 与 `status` 的响应

#### 场景:省略场景与风格时应用默认

- **当** 客户端请求 `POST /api/projects` 但未提供 `scene` 与 `styleProfileId`
- **那么** 系统必须将 `scene` 记为 `default`，将 `styleProfileId` 回退为 `style_default`，并成功创建项目

#### 场景:空请求体创建默认项目

- **当** 客户端以空 JSON 请求体 `{}` 请求 `POST /api/projects`
- **那么** 系统必须成功创建一个 `scene=default`、`styleProfileId=style_default`、`status=NEW_PROJECT` 的项目，`title` 与 `initialRequest` 取空默认值，不返回校验错误

#### 场景:缺失或非 JSON 请求体被拒绝

- **当** 客户端请求 `POST /api/projects` 时完全不带请求体或提供非 JSON 内容
- **那么** 系统必须按 `INVALID_REQUEST_BODY` 返回统一错误（区别于空 JSON `{}` 的成功创建），且不写入任何持久状态

#### 场景:非法场景被拒绝且不入库

- **当** 客户端以 `scene=education2` 请求创建项目
- **那么** 系统必须返回 `INVALID_SCENE` 校验错误、禁止创建任何项目记录，仓储中的项目数量与事件序列长度保持不变

#### 场景:风格归属不匹配被拒绝

- **当** 客户端以 `scene=education` 且 `styleProfileId=style_corporate_default` 请求创建项目
- **那么** 系统必须返回 `STYLE_PROFILE_MISMATCH` 校验错误，并且禁止写入任何持久状态

#### 场景:未知风格 id 被拒绝

- **当** 客户端以 `scene=education` 且 `styleProfileId=style_foo`（不存在的 id）请求创建项目
- **那么** 系统必须返回 `STYLE_PROFILE_MISMATCH` 校验错误，并且禁止写入任何持久状态

### 需求:读取项目

系统必须提供 `GET /api/projects/{projectId}` 接口，返回项目当前的 `WorkflowState`、场景（`scene`）、风格（`styleProfileId`）以及项目标识与标题。读取操作禁止改动任何持久状态。

#### 场景:读取已存在项目

- **当** 客户端对一个已创建项目请求 `GET /api/projects/{projectId}`
- **那么** 系统必须返回该项目当前的 `status`、`scene`、`styleProfileId` 与标识信息

#### 场景:读取不存在项目

- **当** 客户端以一个未被创建的 `projectId` 请求 `GET /api/projects/{projectId}`
- **那么** 系统必须返回资源不存在错误（`code=PROJECT_NOT_FOUND`），且不创建或修改任何状态

