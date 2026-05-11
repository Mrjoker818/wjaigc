# 无界AI — AI 图像生成与协作平台

## 项目概览

这是一个基于 Next.js 16 + React 19 + TypeScript 的 AI 图像生成与协作平台，支持无限画布操作、AI 聊天、图像生成与编辑、图生图、Layer Graph 设计工程等功能。

### 核心技术栈
- **框架**: Next.js 16 (App Router)
- **UI**: React 19 + shadcn/ui + Tailwind CSS 4
- **语言**: TypeScript 5
- **AI 集成**: apimart.ai API (兼容 OpenAI 格式) + Google Gemini
- **图像生成**: DALL-E 3、Midjourney、Stable Diffusion 等多种模型
- **特色功能**: 无限画布、图生图、Layer Graph 设计工程、PSD/SVG 导出、3D 模型预览、Ctrl+Z 撤回

### 项目结构
```
src/
├── app/
│   ├── page.tsx                    # 主应用页面
│   ├── layout.tsx                  # 根布局
│   ├── globals.css                 # 全局样式
│   └── api/
│       ├── generate/route.ts       # 图像生成 API（提交+轮询模式，支持图生图）
│       ├── poll-task/route.ts      # 前端轮询任务状态 API（POST）
│       ├── save-image/route.ts     # 图片持久化 API（data:/blob:→服务器文件）
│       ├── serve-upload/[filename]/route.ts  # 上传文件服务 API（生产环境）
│       ├── chat/route.ts           # AI 聊天 API
│       ├── optimize-prompt/route.ts # 提示词优化 API
│       ├── analyze-psd/route.ts    # AI 视觉分析图片结构 API
│       ├── vision-prompt/route.ts  # 图片识词 API (SSE流+JSON双模式)
│       ├── poll-3d-task/route.ts   # 3D 模型任务轮询 API
│       ├── segment-elements/route.ts  # 元素分层 API (支持管理员配置的分层模型)
│       ├── admin/
│       │   └── api-balance/route.ts   # API 余额与用量分析 API
│       └── design/
│           └── vectorize/route.ts  # 矢量化 API (支持管理员配置的矢量模型 + PY_VECTORIZE_ENDPOINT)
├── components/
│   ├── generation-panel.tsx        # 图像生成控制面板
│   ├── infinite-canvas.tsx         # 无限画布组件
│   ├── chat-panel.tsx              # AI 聊天面板
│   ├── image-preview.tsx           # 图片预览组件
│   ├── model-viewer-3d.tsx         # 3D 模型预览组件
│   ├── design-studio/
│   │   ├── LayerGraphStudio.tsx    # Layer Graph 主弹窗
│   │   ├── LayerPanel.tsx          # 图层面板 (可见/锁定/排序)
│   │   ├── DesignCanvas.tsx        # 设计画布 (图层渲染+选择)
│   │   └── PropertiesPanel.tsx     # 属性面板 (名称/透明度/位置/矢量化)
│   └── ui/                         # shadcn/ui 组件库
├── lib/
│   ├── design-graph.ts             # Layer Graph 图层转换与操作
│   ├── design-export.ts            # .wujie 工程文件导入导出
│   ├── psd-export.ts               # PSD 导出功能
│   ├── svg-export.ts               # SVG 矢量化导出
│   └── config.ts                   # 配置文件
└── types/
    └── designGraph.ts              # Layer Graph 类型系统
```

## 核心功能说明

### 1. 无限画布 (infinite-canvas.tsx)
- **功能**: 支持图片拖拽、缩放、四角等比调整大小、多选、框选、编辑模式等
- **交互模式**:
  - 左键点击: 选择图片（单选/Ctrl多选/框选）
  - 空白区域长按拖动: 平移画布
  - 空格键+拖动: 抓手工具平移画布
  - 右键: 上下文菜单（图片菜单/画布菜单）
  - 滚轮: 缩放画布
  - ESC: 退出编辑模式/取消选择
  - Delete/Backspace: 删除选中图片
  - Ctrl+Z / Command+Z: 无限步数撤回（无toast提示，纯ref同步管理，流畅操作）
- **底部浮动工具栏**:
  - 选择工具（鼠标指针）
  - 平移工具（手掌）
  - 上传图片
  - 图层（Layers图标，hover显示"图层"，打开Layer Graph Studio）
  - 放大/缩小/缩放百分比/重置视图
- **图片操作工具栏** (选中图片后顶部显示):
  - 放大、移除背景、栅格化、擦除、蒙版、扩展、图生图、裁切、下载
- **编辑模式**:
  - 擦除: 画笔大小+确认擦除
  - 蒙版: 画笔+提示词输入+生成
  - 扩展: 缩放比例选项(原始比例/1x/1.5x/2x/3x/4x) + 画面比例(原始比例+固定比例) + 确认扩展
  - 图生图: 黑金配色浮动面板，详见下方
  - 裁切: 自由/预设比例+确认裁切
  - 所有模式ESC退出，顶部提示文字
- **下载格式**: PNG/SVG/PSD (支持模式选择)
  - **下载模式**:
    - PSD: Basic (原图+注释) / Pro (前景/背景分离+重建) / Studio (语义命名+阴影+JSON元数据)
    - SVG: Fast (快速) / Pro (优化) / Studio (精细)
  - **画布工具栏**: z-50始终在图片上层
- **滚动冲突处理**: 弹窗/浮层上滚动不影响画布缩放 (data-modal/data-popup/data-toolbar属性检测)

### 2. 图生图 (img2img)
- **入口**: 选中图片后顶部工具栏"图生图"按钮（ImagePlus图标）
- **调用方式**: 使用 `/api/generate` API + 当前用户选择的图像模型和API密钥
- **生成比例**: 自动根据原图宽高计算最简比例（如4:3、16:9），确保生成结果与原图比例一致
- **浮动面板设计** (黑金配色 #1a1a1a + #d4af37):
  - 顶部: "图生图"标题 + "Esc 退出"提示
  - 四个参考类别（默认全选，可toggle开关）:
    - 风格 (in the style of): 独立强度滑块 0-100%
    - 构图 (with the composition of): 独立强度滑块 0-100%
    - 角色 (featuring the character of): 独立强度滑块 0-100%
    - IP (based on the IP of): 独立强度滑块 0-100%
  - 快捷按钮区:
    - "当前图片描述": 一键填充图片原始描述到关键词输入框
    - "反向提示词": 展开反向提示词输入框，自动填充默认值（低质量, 模糊, 变形, 畸形, 水印, 文字, 签名, 截图, 压缩伪影），用户可自行编辑
  - 关键词输入框: 可拖拽调整大小的textarea（右下角拖拽手柄）
  - 生成按钮: 独立放置在输入框下方，全宽金色按钮
- **生成流程**:
  1. 根据选中类别构建prompt前缀（仅选中的类别参与）
  2. 取选中类别中的最大强度值作为全局strength参数
  3. 反向提示词以 `[negative: ...]` 格式附加到prompt末尾
  4. 调用 `/api/generate` 提交任务，获得taskId
  5. 在原图右侧创建processing frame（空白加载框+进度条）
  6. 通过 `/api/poll-task` (POST) 轮询任务状态，更新进度
  7. 任务完成后替换processing frame为结果图片

### 3. 图像生成 (generation-panel.tsx)
- **模型支持**: 按 apimart.ai 图像模型列表配置
- **产品品类**: 通用、人物、风景、建筑等预设场景
- **高级设置**:
  - 画面比例：带对应比例图形预览（矩形宽高按比例计算，直观展示比例样式）
  - 生图质量：根据所选模型支持的质量设置
- **模型同步**: 通过 `onModelChange` 回调实时同步当前选择的模型和API密钥给画布组件
- **外部提示词注入**: 支持从聊天区提示词优化器接收优化结果
- **风格切换**: 支持黑白配色+彩色图标风格

### 4. AI 聊天 (chat-panel.tsx)
- **模型**: Google Gemini (通过 apimart.ai)
- **特性**: Agent 联网思考模式，支持图像理解
- **提示词优化**: 内置提示词优化功能，支持增强/扩展/精简三种模式
  - 使用聊天区 Gemini 模型进行优化
  - 优化结果一键发送到图像生成面板的创意描述
  - 优化历史记录，支持快速复用
- **配色**: 适配黑白主题，金色强调色

### 5. Layer Graph 设计工程 (design-studio/)
- **入口**: 无限画布底部工具栏"图层"图标按钮
- **功能**: 将当前画布图片转换为可编辑图层的设计工程
- **LayerGraphStudio**: 主弹窗容器，三栏布局
  - 左栏: LayerPanel (图层面板) - 可见性切换、锁定、拖拽排序
  - 中栏: DesignCanvas (设计画布) - 图层渲染、选择高亮
  - 右栏: PropertiesPanel (属性面板) - 名称/透明度/位置尺寸/矢量化
- **设计文档类型** (types/designGraph.ts):
  - LayerNode: 图层节点 (id/名称/类型/变换/可见性/锁定/矢量化状态)
  - SceneGraph: 场景图 (图层列表/选中图层/画布尺寸)
  - DesignDocument: 设计文档 (场景图+元数据+版本)
- **图层操作** (lib/design-graph.ts):
  - 从画布图片创建设计文档
  - 图层移动/更新/选择/删除
  - 图层矢量化 (调用 /api/design/vectorize)
- **工程文件导入导出** (lib/design-export.ts):
  - 导出 .wujie 工程文件 (JSON格式，含图层+元数据)
  - 导入 .wujie 工程文件
  - 导出 SVG 文件
- **矢量化 API** (api/design/vectorize):
  - 支持配置 PY_VECTORIZE_ENDPOINT 环境变量对接 VTracer/StarVector/SAM2
  - 默认 safe-svg-wrapper 模式（SVG容器包裹原图）
  - POST 参数: imageUrl / layerId / mode

### 6. PSD 导出 (lib/psd-export.ts)
- 依据 bggg-creator-image2psd 开源项目方法论 + PSD SKILL V4 规范
- **核心方法**: 基于背景移除(BG Removal)而非像素级分割，保证元素完整性
- 三种导出模式:
  - Basic: 原图层 + 白色背景 + 注释层(安全快速)
  - Pro: 背景移除 + 连通域前景分析 + 语义图层命名 + 背景重建 + V4 XMP元数据
  - Studio: 所有Pro功能 + 阴影估算 + 语义分组 + 质量评分 + 完整V4清单
- V4 规范图层命名: bg/main, subject/{idx}/{label}, fx/shadow/{idx}, text/{idx}/{excerpt}, deco/{idx}/{label}
- 使用 ag-psd 确保Photoshop兼容性

### 7. SVG 矢量化导出 (lib/svg-export.ts)
- 基于 vtracer (visioncortex) 开源算法实现
- **算法流程**: 颜色量化(bit-shift+感知最近色) → 轮廓追踪(square tracing边界行走) → 共线合并 → Douglas-Peucker简化 → Visvalingam-Whyatt简化 → Chaikin角切割平滑 → Catmull-Rom→Bezier曲线拟合
- 三种导出模式:
  - Fast: 快速矢量化（5bit颜色精度，3次Chaikin平滑）
  - Pro: 优化矢量化（5bit颜色精度，4次Chaikin平滑，更精细简化）
  - Studio: 精细矢量化（6bit颜色精度，5次Chaikin平滑，最精细简化）
- **关键参数**: colorPrecision / cornerThreshold / filterSpeckle / segmentLength / spliceThreshold

### 8. 3D 模型预览 (model-viewer-3d.tsx)
- 基于 Three.js + OrbitControls
- 左键旋转 · 滚轮缩放（已移除右键平移避免冲突）

### 9. 图片识词 (vision-prompt API)
- 支持图片URL上传识别关键词
- 双模式解析: stream: false 优先 + SSE流回退解析
- 快速识别图片关键词用于提示词生成

## 构建和测试命令

```bash
# 安装依赖
pnpm install

# 开发模式 (端口 5000)
pnpm dev

# 生产构建
pnpm build

# 生产启动
pnpm start

# 代码检查
pnpm lint

# TypeScript 检查
pnpm ts-check
```

## 代码风格指南

### 类型安全
- 所有函数参数和返回值必须标注类型
- 使用 `interface` 定义组件 Props
- 避免使用 `any` 类型

### React 规范
- 使用函数组件 + Hooks
- 客户端组件使用 `'use client'` 指令
- 避免在服务端组件中使用浏览器 API

### Tailwind CSS
- 使用原子化 CSS 类
- 颜色值使用设计系统中的变量
- 响应式设计优先

## 环境变量

```bash
# API 配置
COZE_API_BASE=https://api.coze.cn
COZE_API_KEY=your_api_key

# apimart.ai 配置
APIMART_API_KEY=your_apimart_key
APIMART_BASE_URL=https://api.apimart.ai

# Google Gemini 配置
GEMINI_API_KEY=your_gemini_key

# Layer Graph 矢量化 (可选)
PY_VECTORIZE_ENDPOINT=http://localhost:8000/vectorize

# Inpainting 擦除/蒙版服务 (使用 AI 生成 API + 蒙版合成策略)
# 擦除和蒙版均通过 AI 模型生成内容，后端自动做蒙版合成确保非编辑区域像素级保留
```

## 安全注意事项

1. **API Key 管理**: 所有 API Key 必须通过环境变量传入，严禁硬编码
2. **文件上传**: 限制上传文件类型和大小
3. **用户输入**: 对所有用户输入进行验证和 sanitize
4. **CORS**: 正确配置跨域策略

## 常见问题

### 图生图不生成/加载框一闪而过
- 检查 `editImageId` 是否正确设置（点击图生图按钮时必须同步设置）
- 检查 `/api/poll-task` 必须使用 POST 方法（GET 会返回 405）
- 检查 API 响应中 `taskIds` 数组是否正确解析（不是 `taskId`）
- 确认管理员后台已配置可用 API 凭证（API Key 由服务端管理）

### Ctrl+Z 撤回不流畅
- 使用 `historyStackRef` + `historyIndexRef` 纯 ref 同步管理
- `handleUndo` 直接调用 `setImagesRaw`，不使用 `isUndoingRef`
- 撤回操作无 toast 提示，避免异步状态竞争

### TypeScript 类型错误
- 检查 `infinite-canvas.tsx` 中的 `onAddImages` 参数类型，应为 `(imageUrls: string[]) => void`
- 确保所有组件 Props 接口定义正确

### 热更新不生效
- 检查是否在正确的目录修改文件
- 确认 `.coze` 配置文件正确

### 端口占用
- 服务必须运行在 5000 端口
- 检查 `ss -tuln | grep :5000` 确认端口状态

### 矢量化卡死
- 检查颜色精度参数是否过高 (建议 ≤ 6bit)
- Chaikin 平滑迭代次数建议 ≤ 5 次
- 大图(>2000px)处理时间较长属正常现象

## 更新日志

### v2.5.1 (当前版本)

**擦除/蒙版功能修复**
- 修复蒙版检测核心 Bug：前端 canvas 导出的 PNG alpha 通道全为 255，导致后端误判整个图片为蒙版区域（99.97%覆盖率）
- 蒙版检测改用 RGB 亮度阈值（>127 为蒙版区域），不再依赖 alpha 通道
- 移除 IOPaint/OpenCV 修复引擎，改为 AI 生成 API + 蒙版合成策略
  - 擦除和蒙版均使用 AI 模型生成内容，质量远超 OpenCV 边界传播算法
  - 后端自动做蒙版合成：AI 结果仅覆盖蒙版区域，非编辑区域像素级保留
  - 蒙版边界 8px 柔和过渡，避免硬边
- 修复蒙版检测核心 Bug：前端 canvas 导出的 PNG alpha 通道全为 255，改用 RGB 亮度判断
- 移除 IOPAINT_ENDPOINT 环境变量和 inpaint-server.py 依赖
- 添加前端错误日志：API 失败时输出 console.error 便于调试

### v2.5.0

**参考图与图生图类别统一**
- 右键菜单"生成变体"改为"发送参考图"，点击后图片直接添加到参考图列表
- 参考图和图生图类别统一为6大类：风格、构图、场景、色彩、主体、细节
- 参考图功能区每张图片最多可选2项类别
- 图生图功能区6类全可选，每类独立强度滑块（0-100%）

**工具栏功能优化**
- 放大：智能补细节把图片变大变高清，不改画面内容、不换背景
- 移除背景：自动把主体和背景分开，一键删掉杂乱背景
- 擦除：画笔涂抹消除并自动无缝补上新的画面
- 蒙版：给图片加"透明遮罩膜"，精准控制编辑范围
- 编辑元素：根据图片元素进行分层处理
- 扩展：往图片四周延伸画面，扩大画布
- 除扩展和裁切外，所有编辑功能保持原图比例
- 下载图片比例与生成结果一致

**管理员系统增强**
- 新增 API 类型：矢量模型、分层模型、3D模型，自动适配到对应功能
- 矢量化功能使用管理员配置的矢量模型 API
- 编辑元素功能使用管理员配置的分层模型 API（`/api/segment-elements`）
- 转3D功能使用管理员配置的3D模型 API
- 新增 API 用量分析和余额显示（`/api/admin/api-balance`）
- 管理员添加 API 后自动识别模型列表默认不选择，管理员手动单选/多选
- 新增全选/取消全选按钮

**UI 优化**
- 标题下方显示版本号，标题右方显示当前项目名称
- 图生图浮动面板工具提示优化

**比例一致性修复**
- `/api/image-edit` 放大/移除背景/擦除/蒙版使用 `findClosestAspectRatio` 匹配原图比例
- 所有编辑操作（除扩展和裁切）传递 `aspectRatio` 参数到 API

### v2.4.0

**服务器端 API 密钥管理**
- 移除图像生成面板和聊天面板的内置模型列表（MODEL_OPTIONS/CHAT_MODELS），模型默认为空
- 移除图像生成面板和聊天面板的 API Key 输入框及相关代码
- 模型列表通过 `/api/models?type=image|chat` 从服务器加载管理员配置的模型
- 用户可通过第三方模型对话框添加自定义 API 端点和模型
- `getApiKey()` 改为返回 `'server-managed'`，后端路由使用 `findProviderForModel()` 查找服务器端 API 密钥
- 移除 InfiniteCanvas 的 `currentImageModel` 和 `currentApiKey` props
- 图生图使用 `getCurrentModel()` 从 localStorage 读取当前选择的模型
- `/api/generate`、`/api/image-edit`、`/api/universal-generate`、`/api/chat`、`/api/poll-task` 均使用服务器端 API 密钥管理
- 画布侧边栏新增管理员系统按钮（仅管理员可见）
- `pollForResult` 函数传递 `model` 参数给 `/api/poll-task` 以正确查找服务器端 API 密钥

### v2.3.0

**图生图功能**
- 新增图生图编辑模式，支持基于当前图片生成新图
- 黑金配色浮动面板（#1a1a1a + #d4af37），与深色主题一致
- 四个参考类别（风格/构图/角色/IP）默认全选，可独立 toggle 开关
- 每个类别独立强度滑块（0-100%），未选中时置灰
- 关键词输入框为可拖拽调整大小的 textarea（右下角拖拽手柄）
- "当前图片描述"快捷按钮：一键填充图片原始描述
- "反向提示词"功能：自动填充默认反向提示词，用户可编辑修改
- 生成结果比例与原图一致（自动计算最简比例 4:3、16:9 等）
- 使用当前用户选择的图像模型和 API 密钥（通过 onModelChange 回调同步）
- 生成流程：提交任务 → 原图右侧 processing frame → 轮询进度 → 替换结果

**Bug 修复**
- 修复图生图点击后无反应：点击按钮时未设置 editImageId
- 修复图生图加载框一闪而过：改用 /api/generate API + 函数式更新器避免 stale closure
- 修复轮询 API 405 错误：图生图轮询从 GET 改为 POST（/api/poll-task 仅支持 POST）
- 修复 API 响应解析：使用 taskIds[0] 匹配 /api/generate 返回格式
- 修复 generation-panel.tsx 中 effectiveApiKey 作用域错误

### v0.4.0

**Layer Graph 设计工程**
- 新增 Lovart Layer Graph 设计工程能力
- 图层面板：可见性切换、锁定、拖拽排序
- 设计画布：图层渲染、选择高亮
- 属性面板：名称/透明度/位置尺寸/矢量化
- .wujie 工程文件导入导出
- Layer Graph 入口集成到画布底部工具栏（图层图标，hover显示"图层"）

**图像生成面板**
- 画面比例添加对应比例图形预览（矩形宽高按比例计算）
- 扩图增加缩放比例选项（原始比例/1x/1.5x/2x/3x/4x）

**Ctrl+Z 撤回优化**
- 移除 toast 提示，改为纯 ref 同步管理
- 使用 historyStackRef + historyIndexRef 替代 useState 管理
- handleUndo 直接调用 setImagesRaw，避免异步状态竞争
- 快速连续撤回操作流畅无卡顿
