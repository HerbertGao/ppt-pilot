## 目的

定义 Phase 1 fixtures 与校验命令的长期规范，确保合法最小样例、非法输入样例、默认风格模板回退与错误定位能力持续可验证。

## 需求

### 需求:fixtures 必须覆盖合法最小样例
系统必须提供合法 fixtures，用于验证 shared-schema 能表达 PPTPilot 的最小结构化数据。

#### 场景:验证合法 PresentationSpec
- **当** 开发者运行 fixtures 校验命令
- **那么** 合法最小 `PresentationSpec` 必须通过校验，并包含 topic、audience、purpose、language、scene、styleProfileId、questionPolicy 与 confirmedByUser 等关键字段

#### 场景:验证合法 SlidePlan
- **当** 开发者运行 fixtures 校验命令
- **那么** 合法最小 `SlidePlan` 必须通过校验，并包含 objective、keyMessage、contentIntent、visualIntent、layoutSuggestion、requiredAssets 与 riskNotes

#### 场景:验证合法 Event
- **当** 开发者运行 fixtures 校验命令
- **那么** 合法最小 `Event` 必须通过校验，并包含 projectId、type、actor、payload 与 createdAt

### 需求:fixtures 必须覆盖非法输入样例
系统必须提供非法 fixtures，用于证明错误输入会在进入 API、Agent 或后续渲染流程前失败。

#### 场景:拒绝非法 scene
- **当** fixture 中的 `scene` 不是 `education`、`corporate` 或 `default`
- **那么** 校验命令必须失败，并报告 `scene` 字段错误

#### 场景:拒绝无效 styleProfile 归属
- **当** fixture 中 `styleProfileId` 指向的风格模板不属于当前 `scene`
- **那么** 校验命令必须失败，并报告 `styleProfileId` 与 `scene` 的归属错误

#### 场景:拒绝无效实体引用
- **当** fixture 中的实体引用指向不存在的 `Presentation`、`Slide`、`Element` 或 `Asset`
- **那么** 校验命令必须失败，并报告对应引用字段错误

#### 场景:验证 styleProfile 默认回退
- **当** fixture 省略 `styleProfileId` 但提供 `scene`
- **那么** 校验或默认值归一化命令必须按 `default -> style_default`、`education -> style_education_default`、`corporate -> style_corporate_default` 验证默认 profile 关系

### 需求:锁定写保护样例必须保持非 gating
系统必须允许保留锁定写保护的参考样例，但该样例禁止作为 Phase 1 必过非法校验，避免提前实现运行时写保护。

#### 场景:记录 locked write 参考样例
- **当** 仓库包含表示对已锁定 slide 或 element 写入意图的 fixture
- **那么** 该 fixture 必须标记为 later-phase reference（后续阶段参考），并且不得被 Phase 1 的非法 fixtures 必过校验命令计入

### 需求:校验命令必须区分合法与非法 fixtures
系统必须提供一个可重复执行的校验命令，使合法 fixtures 全部通过、非法 fixtures 全部失败。

#### 场景:合法 fixtures 全部通过
- **当** 开发者运行合法 fixtures 校验
- **那么** 命令必须以成功状态结束

#### 场景:非法 fixtures 全部失败
- **当** 开发者运行非法 fixtures 校验
- **那么** 命令必须确认每个 Phase 1 gating 非法样例都被拒绝，禁止把非法样例当作成功数据接受

#### 场景:校验失败可定位
- **当** 任一 fixture 校验失败
- **那么** 输出必须包含足够定位的实体名称、fixture 文件名或字段路径，便于开发者修复 schema 或样例

