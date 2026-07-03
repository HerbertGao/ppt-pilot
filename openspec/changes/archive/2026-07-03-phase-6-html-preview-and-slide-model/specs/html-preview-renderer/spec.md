## 新增需求

### 需求:纯函数 HTML 预览渲染器消费同一结构化模型

`packages/ppt-engine` 必须提供纯函数渲染器 `renderSlide(slide, theme)` 与 `renderPresentation(presentation)`，输入为 shared-schema 的 `Slide`/`Presentation` 模型（**与 Phase 7 PPTX 导出将消费的同一模型**），输出 HTML。渲染器必须是**纯函数**：无 I/O、无网络、不调后端、不依赖 DOM 运行时；相同输入产出**确定性**输出。渲染必须按 `Element` 的类型/几何/`zIndex`/`style` 布局元素，并把 `ThemeTokens` 应用为样式。

#### 场景:渲染演示模型为确定性 HTML

- **当** 以一个合法 `Presentation`（多页、每页含结构元素）调用 `renderPresentation`
- **那么** 必须返回确定性 HTML，逐页按元素几何/zIndex 布局、应用 theme token 为样式；相同输入两次调用输出一致（golden fixtures 锁定）

#### 场景:视觉占位元素渲染为占位框

- **当** 某页含 `chart`/`diagram`/`table`/`shape` 等视觉占位元素（本期无真实资源）
- **那么** 渲染器必须输出一个带类型标注的占位框（不请求任何外部资源、不发网络）

### 需求:上下文感知转义与 CSS 白名单（信任边界）

渲染器把模型值写入 HTML 时必须**按上下文**做转义/清洗（仅 HTML 文本转义不足以保护属性与 CSS 上下文——这是信任边界，不可省）：写入 **HTML 文本上下文**须 HTML 转义（`< > & " '`）；写入 **HTML 属性上下文**须属性转义；把 `element.style`/`theme` 值写入 **CSS 上下文**须经 **CSS 属性白名单 + 值清洗**（只输出白名单内的样式属性，拒绝/剥离 `expression(...)`、`url(...)`、`</style>` 等危险构造），禁止透传任意 CSS。为保证 golden fixtures 稳定，渲染 CSS/属性时对象键必须以**确定性顺序**（固定顺序或排序）遍历。

#### 场景:文本内容按 HTML 文本上下文转义

- **当** 某元素文本内容含 `<`、`>`、`&`、引号
- **那么** 写入 HTML 文本上下文时必须转义，不得产生未转义的原始标签

#### 场景:样式值经 CSS 白名单与清洗

- **当** `element.style` 或 `theme` 含不在白名单内的属性，或含 `expression(...)`/`url(...)`/`</style>` 等危险值
- **那么** 渲染器必须只输出白名单内属性并剥离/拒绝危险值，不得透传任意 CSS 到输出

#### 场景:属性上下文按属性转义

- **当** 模型值被写入某 HTML 属性（如内联 style 属性值）
- **那么** 渲染器必须按属性上下文转义，防止属性逃逸注入

#### 场景:对象键确定性顺序保证可复现

- **当** 用同一模型两次渲染（其 `style`/`theme` 为对象）
- **那么** 输出的 CSS/属性顺序必须一致（确定性键遍历），使 golden fixtures 稳定

### 需求:主题 token 到样式与缩略图占位

渲染器必须把 `ThemeTokens`（palette/font/spacing）确定性映射为样式（经上述 CSS 白名单），且提供每页**确定性缩略图占位**（如内联 SVG/data-uri，含尺寸/页码/标题占位），**不引入 headless browser/真实光栅化**。渲染器 fixtures 必须锁定 token→样式与缩略图占位输出。

#### 场景:主题 token 映射为确定性样式

- **当** 用不同 `ThemeTokens` 渲染同一 `Slide`
- **那么** 输出样式必须随 token 确定性变化（fixtures 可区分）

#### 场景:缩略图为确定性占位不做真实光栅化

- **当** 为某页生成缩略图
- **那么** 必须产出确定性占位（内联 SVG/data-uri 或稳定占位），不启动 headless browser、不发网络、不依赖真实渲染像素
