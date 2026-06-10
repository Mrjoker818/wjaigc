# 无界AI — AI 图像生成与协作平台

## 项目概览

这是一个基于 Next.js 16 + React 19 + TypeScript 的 AI 图像与视频生成协作平台，支持无限画布操作、AI 聊天、图像/视频生成与编辑、图生图、PSD/SVG 导出等功能。

### 核心技术栈
- **框架**: Next.js 16 (App Router)
- **UI**: React 19 + shadcn/ui + Tailwind CSS 4
- **语言**: TypeScript 5
- **AI 集成**: 通用 API 兼容层（支持 OpenAI / Gemini / 任意兼容格式 API）
- **图像生成**: DALL-E 3、Midjourney、Stable Diffusion 等多种模型
- **视频生成**: 可灵 V3、Seedance 2.0/2.3、Vidu Q1/Q2、Runway Gen-3/4、Sora、Veo 等多种模型
- **特色功能**: 无限画布、图生图、图生视频、视频延长、PSD/SVG 导出、3D 模型预览、语言修图、SVG智能描摹、Agent编排、工作流节点模式、Ctrl+Z 撤回

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
│       ├── video/
│       │   ├── generate/route.ts   # 视频生成 API (文生视频/图生视频/首尾帧, 异步提交+轮询)
│       │   └── extend/route.ts     # 视频延长 API (基于可灵/Seedance等, 异步提交+轮询)
│       ├── optimize-prompt/route.ts # 提示词优化 API
│       ├── analyze-psd/route.ts    # AI 视觉分析图片结构 API
│       ├── vision-prompt/route.ts  # 图片识词 API (SSE流+JSON双模式)
│       ├── poll-3d-task/route.ts   # 3D 模型任务轮询 API
│       ├── segment-elements/route.ts  # 元素分层 API (支持管理员配置的分层模型)
│       ├── edit/route.ts             # 语言修图 API (OpenAI + Gemini，自然语言描述修改图片，异步提交+轮询)
│       ├── image-edit/route.ts       # 图片编辑 API (擦除/蒙版/放大/扩展，AI优先+BFS兜底，异步提交+轮询)
│       ├── svg-trace/route.ts        # SVG智能描摹 API (vtracer彩色+potrace黑白，多级质量预设)
│       ├── agent-edit/route.ts       # Agent编排编辑 API (智能选择工具，多轮编辑)
│       ├── cancel-task/route.ts      # 任务取消 API (支持所有异步任务取消)
│       ├── task-events/route.ts      # SSE任务事件推送 API (替代轮询，实时推送)
│       ├── queue-position/route.ts   # 队列位置查询 API (排队中任务的位置)
│       ├── verify-protocol/route.ts  # API协议验证 API (管理员面板一键验证提供商协议)
│       ├── font-design/
│       │   ├── plan/route.ts        # 字境大师-设计方案+风格库API (GET风格库, POST生成方案+提示词)
│       │   ├── prompt/route.ts      # 字境大师-即梦提示词API (完整版/精简版/增强版/黑底白字/透明Logo)
│       │   └── generate-image/route.ts # 字境大师-图片生成API (异步提交+轮询, 复用poll-task)
│       ├── workflow/
│       │   ├── execute/route.ts     # 工作流执行API (start/status/cancel, DAG拓扑排序, 异步执行)
│       │   ├── models/route.ts      # 工作流模型列表API (动态加载管理员配置的模型)
│       │   ├── save/route.ts        # 工作流保存API (持久化到数据库)
│       │   └── ai-build/route.ts    # AI自然语言建图API (LLM解析→自动生成节点图)
│       ├── upscayl/route.ts        # [旧] 无损放大 API (向后兼容)
│       ├── image/
│       │   ├── health/route.ts     # 本地图像工具健康检测 API
│       │   ├── upscale/route.ts    # 无损放大 API (upscayl-node)
│       │   └── inpaint/route.ts    # 涂抹消除/蒙版修图 API (IOPaint+LaMa)
│       ├── admin/
│       │   └── api-balance/route.ts   # API 余额与用量分析 API
│       └── design/
│           └── vectorize/route.ts  # 矢量化 API (支持管理员配置的矢量模型 + PY_VECTORIZE_ENDPOINT)
├── components/
│   ├── generation-panel.tsx        # 图像生成控制面板
│   ├── infinite-canvas.tsx         # 无限画布组件
│   ├── chat-panel.tsx              # AI 聊天面板
│   ├── image-preview.tsx           # 图片预览组件
│   ├── image-editor.tsx             # 语言修图编辑器组件 (自然语言描述修改图片)
│   ├── video-player.tsx             # 视频播放器组件 (进度条/音量/倍速/全屏, 黑金主题)
│   ├── video-generation-panel.tsx   # 视频生成面板组件 (文生视频/图生视频/首尾帧/多参考图/延长/音效)
│   ├── video-edit-panel.tsx         # 视频编辑面板组件 (语言编辑/视频延长, 黑金主题)
│   ├── agent-editor.tsx             # Agent编排编辑器组件 (智能选择工具，多轮编辑)
│   ├── font-design-panel.tsx        # 字境大师Pro字体设计面板 (黑金/单色双主题, 左右分栏)
│   ├── node-editor.tsx              # 节点编辑器组件 (工作流DAG编辑, AI建图, 提示词库, 画布助手, 撤销重做)
│   ├── model-viewer-3d.tsx         # 3D 模型预览组件
│   ├── image-editor/
│   │   ├── ImageEditPanel.tsx      # 擦除/蒙版修图浮窗面板 (黑金UI)
│   │   ├── ImageEditToolbar.tsx    # 图像编辑工具栏
│   │   ├── MaskBrushCanvas.tsx     # 蒙版画布 (react-konva, 画笔/橡皮擦/撤销/导出)
│   │   └── UpscaleDialog.tsx       # 无损放大弹窗 (模型/倍率/格式选择)
│   └── ui/                         # shadcn/ui 组件库
├── lib/
│   ├── db-client.ts                # PostgreSQL 连接池（使用 PGDATABASE_URL 环境变量）
│   ├── db-storage.ts               # 数据库持久化存储（用户/API提供商/用户数据/系统设置）
│   ├── task-registry.ts            # 任务注册中心（统一任务管理、SSE推送、取消、队列）
│   ├── task-events-client.ts       # SSE任务事件客户端（前端连接SSE、取消任务）
│   ├── agent-engine.ts             # Agent编排引擎（工具注册表、Agent循环、多轮决策）
│   ├── workflow-engine.ts          # 工作流引擎（DAG拓扑排序, 节点输入解析, 执行请求构建, 25+节点类型定义, AI建图结果解析, 自动布局）
│   ├── image-compress.ts           # 图片压缩工具（前端canvas压缩+尺寸限制）
│   ├── remove-bg-postprocess.ts   # RemoveBG后处理（保存RGBA+蒙版PNG，Python端处理）
│   ├── api-helpers.ts              # API 辅助函数（fetchWithV1Retry 智能 /v1 重试）
│   ├── psd-export.ts               # PSD 导出功能
│   ├── svg-export.ts               # SVG 矢量化导出
│   ├── config.ts                   # 配置文件
│   ├── api-compatibility.ts        # API 兼容层（通用多提供商适配，自动推断请求格式）
│   ├── video-api.ts                # 视频API协议适配层（6种协议适配器, 20+视频模型注册表）
│   └── image-tools/
│       ├── config.ts               # 本地图像工具配置 (环境变量/目录/超时)
│       ├── file.ts                 # 文件工具 (读取/缩放/保存/清理)
│       ├── mask.ts                 # 蒙版工具 (校验/归一化/反转)
│       ├── upscayl.ts              # upscayl-node 放大引擎
│       └── iopaint-client.ts       # IOPaint 客户端 (多模型擦除LaMa/ZITS/Anime-Lama + RemoveBG 3模型, Python子进程+HTTP双模式)
├── types/
│   └── image-tools.ts              # 本地图像工具类型定义
scripts/
├── start-iopaint-lama.sh           # IOPaint LaMa 启动脚本（兼容旧版 HTTP 服务模式）
├── iopaint_erase.py               # IOPaint 擦除脚本 (LaMa/ZITS/Anime-Lama, Python 子进程模式)
├── iopaint_removebg.py            # IOPaint RemoveBG 去背景脚本（Python 子进程模式）
└── download-iopaint-models.sh     # IOPaint 模型下载脚本 (LaMa/ZITS/Anime-Lama + RemoveBG)
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
  - 放大/缩小/缩放百分比/重置视图
- **图片操作工具栏** (选中图片后顶部显示):
  - 放大、移除背景、SVG智能描摹、擦除、蒙版、编辑元素、扩展、图生图、裁切、下载
- **编辑模式**:
  - 擦除: 画笔大小+确认擦除，IOPaint 多模型优先（LaMa/ZITS/Anime-Lama），AI模型智能修复兜底，BFS边界扩散最终兜底
  - 蒙版: 画笔+提示词输入+生成，AI模型优先生成+后端精确蒙版合成
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
- **模型支持**: 管理员动态配置，支持任意 OpenAI 兼容 API 提供商
- **产品品类**: 通用、人物、风景、建筑等预设场景
- **高级设置**:
  - 画面比例：带对应比例图形预览（矩形宽高按比例计算，直观展示比例样式）
  - 生图质量：根据所选模型支持的质量设置
- **模型同步**: 通过 `onModelChange` 回调实时同步当前选择的模型和API密钥给画布组件
- **外部提示词注入**: 支持从聊天区提示词优化器接收优化结果
- **风格切换**: 支持黑白配色+彩色图标风格

### 4. AI 聊天 (chat-panel.tsx)
- **模型**: 支持管理员配置的任意 LLM 模型（Gemini/GPT 等）
- **特性**: Agent 联网思考模式，支持图像理解
- **提示词优化**: 内置提示词优化功能，支持增强/扩展/精简三种模式
  - 使用聊天区 Gemini 模型进行优化
  - 优化结果一键发送到图像生成面板的创意描述
  - 优化历史记录，支持快速复用
- **配色**: 适配黑白主题，金色强调色
- **Skills 系统 (P0)**: 对话经验沉淀为可复用工作流资产
  - "基于此对话创建 Skill"按钮：自动提炼当前对话的 systemPrompt + 关键步骤为 Skill JSON
  - Skill Book 面板：浏览/搜索/调用/删除 Skills，按类别分类（图像/设计/品牌/分镜/编辑/自定义）
  - 调用 Skill 时自动注入 systemPrompt + 参数模板
  - localStorage 持久化，支持导入/导出
  - **21个预设Skill**（基于Lovart设计方法论+无界特色扩展）：
    - 图像类(5)：电商商品套图 / 分镜故事板 / IP角色设计 / 概念场景设计 / 漫画连环画创作 / 美食摄影风格图
    - 设计类(10)：室内设计全流程 / 创意海报设计 / PPT演示文稿设计 / 杂志封面设计 / 服装时尚设计 / 名片设计 / 书籍封面设计 / 贴纸表情包 / 样机展示(Mockup) / App/网页界面设计
    - 品牌类(1)：Logo与品牌设计
    - 编辑类(1)：营销宣传册
    - 社交类(1)：社交媒体套图
- **模糊意图主动追问 (P0)**: 系统提示词注入意图分级规则
  - 极度模糊（<10字+无图）→ AI 返回 `[CLARIFY]` 标记 + 追问
  - 中等模糊 → 自动补全并执行
  - 复杂多步 → 拆解流程建议
- **生成后主动引导 (P0)**: AI 回复末尾附加 `💡 建议下一步` 区域
  - 根据生成内容类型智能推荐后续操作（图生图/语言修图/放大/移除背景等）
  - 每条建议是可点击的快捷按钮，自动填充指令
- **@ 引用系统 (P1)**: 输入框输入 `@` 触发引用菜单
  - `@图片` → 引用画布图片（URL + 描述注入上下文）
  - `@品牌` → 引用品牌工厂 BrandDNA 规范
  - `@模型` → 切换当前使用的生成模型
  - `@提示词` → 引用提示词库模板
  - 引用显示为可删除的标签（chip/tag）
- **Tab 模式 (P1)**: 选中画布图片后聊天输入框自动切换为"针对此图片"模式
  - 消息自动附带选中图片 URL 到多模态请求
  - 输入框上方显示图片缩略图 + "退出图片模式"按钮
- **品牌资产跨面板注入 (P1)**: @品牌 引用自动将 BrandDNA 注入 systemPrompt
  - 品牌色彩/字体/调性/禁区规则自动附加到后续所有生成
- **Tune 模式 (P2)**: AI 修改后暴露可调节参数面板
  - 风格强度 / 创意度 / 色调偏移 三个参数滑块
  - 参数值自动注入后续消息的上下文提示
  - 快速命令面板：8个常用指令模板（生成图片/优化提示词/修图/放大等）
- **ChatCanvas 画布联动 (P2)**: 画布右键菜单新增"发送到聊天修改"
  - 点击后自动切换到聊天面板 + Tab 模式 + 预填充修改指令
  - 画布与聊天双向通信
- **Tab 补全 (P2)**: 预设常用指令模板 + Tab 快捷选择
  - 输入框右下角闪电图标触发快速命令面板
  - 模板包括：生成图片/优化提示词/修图/放大/移除背景/分析图片/品牌设计/创意建议

### 5. 矢量化 API (api/design/vectorize)
- 多策略自动降级: 管理员矢量模型API → LLM视觉模型fallback → 本地vtracer → raster-svg-wrapper兜底
- 管理员矢量模型支持: chat/completions(SSE流解析) + multipart form + JSON + OpenAI images格式
- LLM fallback: 当矢量模型API失败时，自动使用管理员配置的聊天模型(Gemini/GPT-4o等)生成SVG
- 支持 SSE 流式响应解析 (parseSSEContent)，兼容各种 API 代理的流式返回
- 支持配置 PY_VECTORIZE_ENDPOINT 环境变量对接 VTracer/StarVector
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

### 10. SVG 智能描摹 (svg-trace/route.ts)

基于 vtracer + potrace 的位图转矢量图功能，支持彩色和黑白两种模式。

- **彩色模式**: 使用 Python vtracer 库全彩矢量化，支持 64~4096 色精度
- **黑白模式**: 使用 potrace 追踪轮廓线，纯黑白输出，适合线稿和徽标
- **质量预设**: 快速(64色) / 均衡(256色) / 高清(1024色) / 极致(4096色)
- **自定义参数**: colorPrecision / filterSpeckle / cornerThreshold / lengthThreshold
- **颜色优化**: 温和颜色合并（仅合并 RGB 距离 < 12 的极近色），保留真实色彩还原
- **多策略降级**: 矢量模型 API → LLM 视觉模型 fallback → 本地 vtracer 兜底
- **PNG 预览**: 彩色模式用 sharp 光栅化 SVG→PNG，黑白模式用 potrace→BMP→PNG
- **画布显示**: 显示 PNG 预览，`svgDataUrl` 字段存储完整 SVG 用于下载
- **入口**: 选中图片顶部工具栏"SVG描摹" / 右键菜单"SVG智能描摹"

### 11. 图片编辑 API (image-edit/route.ts)

统一架构的图片编辑能力，AI 模型优先 + 本地算法兜底，支持异步提交+轮询模式。

- **擦除功能**: IOPaint 多模型优先（LaMa 通用/ZITS 结构保持/Anime-Lama 动漫），AI 模型兜底（全图发送+蒙版合成避免变形），BFS 边界扩散最终兜底
- **蒙版修图**: AI 模型优先生成 + 后端精确蒙版合成（仅替换蒙版区域）
- **无损放大**: upscayl-node (NCNN) + AI 整图放大兜底
- **移除背景**: IOPaint RemoveBG 优先（支持 3 个模型：BiRefNet通用 + U2Net轻量快速 + Silueta轻量人像），默认 birefnet-general-lite，AI 模型兜底，本地透明化最终兜底
  - 同时生成透明背景图和黑白蒙版图（白色=主体，黑色=背景），两图并排添加到画布
  - Python 端完成所有蒙版处理（膨胀+模糊+应用），Node.js 端仅保存文件
- **扩展画面**: AI 模型向四周延伸，支持缩放比例和画面比例选择
- **异步任务**: 擦除/蒙版/放大/扩展均支持提交+轮询模式（`taskId` + `/api/poll-task`）
- **持久化**: `persistImageBuffer` 三级 fallback（S3 → save-image API → base64 data URL）
- **蒙版合成**: `compositeAIResultToOriginal` 精确合成 AI 结果到原图蒙版区域
- **API 接口**:
  - POST `/api/image-edit` - 图片编辑（action: erase/mask/upscale/extend/removebg）
  - GET `/api/image/health` - 本地图像工具健康检测

### 12. 本地图像编辑 (image-editor/ + image-tools/)

统一架构的本地图像编辑能力，不依赖云端 API，使用 upscayl-node (放大) 和 IOPaint+LaMa (涂抹消除/蒙版修图)。

- **入口**: 无限画布图片选中后顶部工具栏中的"放大"、"擦除"、"蒙版"
- **无损放大 (UpscaleDialog)**:
  - 弹窗选择放大模型、倍率(2x/4x)、输出格式(PNG/JPG/WEBP)
  - 后端调用 upscayl-node (NCNN 二进制)，大图先用 sharp 缩小再放大
  - 成功后新图片添加到原图右侧（不覆盖原图）
  - 旧 `/api/upscayl` 入口保留向后兼容
- **涂抹消除 / 蒙版修图 (ImageEditPanel)**:
  - 基于 react-konva 的蒙版画布 (MaskBrushCanvas)
  - 支持画笔/橡皮擦模式、画笔大小调整、撤销、清空
  - 白色笔迹=擦除区域，黑色背景=保留区域
  - 导出蒙版尺寸与原图原始尺寸一致
  - 后端调用 IOPaint+LaMa 本地修复服务
  - 修复结果替换原图
- **健康检测**:
  - GET `/api/image/health` - 检查 IOPaint 和 upscayl 可用性
  - 前端根据状态显示服务未启动提示
- **API 接口**:
  - POST `/api/image/upscale` - 无损放大 (imageUrl, model, scale, outputFormat, compression)
  - POST `/api/image/inpaint` - 涂抹消除/蒙版修图 (imageUrl, maskDataUrl, prompt)
  - GET `/api/image/health` - 健康检测
- **配置**: 通过环境变量控制 (LOCAL_AI_ENABLED, IOPAINT_BASE_URL, UPSCAYL_MODELS_DIR 等)
- **启动脚本**: `scripts/start-iopaint-lama.sh` (HTTP 服务模式，兼容旧版)
- **Python 子进程模式** (推荐):
  - `scripts/iopaint_erase.py` — 多模型擦除（LaMa/ZITS/Anime-Lama），被 Node.js child_process 调用
  - `scripts/iopaint_removebg.py` — RemoveBG 去背景（3个模型：BiRefNet/U2Net/Silueta），被 Node.js child_process 调用
  - `scripts/download-iopaint-models.sh` — 下载擦除+去背景模型
- **擦除模型**: LaMa (默认推荐) / ZITS (结构保持) / Anime-Lama (动漫专用)
- **降级策略**: IOPaint 本地 → AI API → 本地算法兜底

### 13. 语言修图 (image-editor.tsx + api/edit)

基于自然语言描述的图片编辑功能，支持 OpenAI 和 Google Gemini 两种模型提供商。

（保留原有文档，此处省略）

### 14. 任务注册中心 (task-registry.ts)

统一任务管理系统，为所有异步任务（生成、编辑、修图、Agent等）提供注册、状态追踪、SSE推送和取消能力。

- **核心数据结构**: `TaskInfo` — taskId, type, status(queued/processing/completed/failed/cancelled), progress, label, result, error
- **任务注册**: `registerTask(taskId, type, label)` — 注册新任务到内存 Map
- **进度更新**: `updateTaskProgress(taskId, partial)` — 更新进度/标签/状态，自动触发 SSE 推送
- **取消检查**: `isTaskCancelled(taskId)` — 后台任务循环中检查是否已取消
- **SSE推送**: `onTaskProgressUpdate(handler)` — 注册进度变化回调，供 SSE 端点使用
- **队列管理**: 内置排队机制，`getQueuePosition(taskId)` 查询排队位置
- **内存限制**: 最多保存 500 条任务记录，30 分钟自动清理过期任务
- **API 接口**:
  - POST `/api/cancel-task` — 取消任务 (taskId)
  - GET `/api/task-events?taskId=xxx` — SSE 事件流 (实时推送进度)
  - GET/POST `/api/queue-position` — 查询排队位置 (taskId)
- **集成路由**: generate, image-edit, edit, agent-edit 均已集成任务注册

### 15. SSE 任务推送 (task-events/route.ts + task-events-client.ts)

替代前端轮询的实时任务进度推送机制，保留轮询作为兜底。

- **服务端**: `/api/task-events?taskId=xxx` — SSE 长连接，实时推送任务进度变化
- **客户端**: `taskEventsClient` — 自动连接/重连，支持注册处理器 `onTaskEvent(handler)`
- **消息格式**: `{ type: 'connected'|'progress'|'completed'|'failed'|'cancelled', taskId, task, timestamp }`
- **降级策略**: SSE 连接失败时自动回退到 `/api/poll-task` 轮询
- **取消任务**: `taskEventsClient.cancelTask(taskId)` — 调用 cancel API 并等待确认

### 16. 图片压缩 (image-compress.ts + save-image/route.ts)

前端和后端双重图片压缩，减少上传带宽和存储空间。

- **前端压缩**: `compressImage(file, options)` — canvas 压缩 + 尺寸限制
  - 支持 JPEG/WebP 格式，可配置质量 (0-1) 和最大边长
  - 大图自动缩放：超过 maxWidth/maxHeight 时等比缩放
  - 小图跳过压缩：低于 maxSizeKB 的文件直接返回
- **后端压缩**: `/api/save-image` 新增 `compress` 参数
  - 使用 sharp 进行高质量压缩和尺寸调整
  - 支持 `maxWidth/maxHeight/quality/format` 参数
  - 自动转换格式：PNG→JPEG（非透明图）或 WebP

### 17. API 协议验证 (verify-protocol/route.ts + admin-system.tsx)

管理员面板新增"验证协议"按钮，一键检测 API 提供商的协议兼容性。

- **POST `/api/verify-protocol`**: 验证 API 端点是否可达、支持的协议格式
- **检测项目**: 模型列表(/models)、图片生成(/images/generations)、对话(/chat/completions)
- **结果分类**: pass(通过) / warn(警告) / fail(失败)
- **自动推断**: `resolveCompatProfile` 自动识别 openai/apimart/auto 等协议
- **UI 集成**: 管理员面板每个提供商旁新增"验证"按钮，显示检测结果

### 18. Agent 编排 (agent-engine.ts + agent-editor.tsx + api/agent-edit)

基于 LLM 的智能编排系统，自动选择和组合工具完成用户指令。语言修图的扩展版本。

- **核心架构**:
  - `agent-engine.ts`: 工具注册表 + Agent 循环（LLM思考→选工具→执行→再思考）
  - `agent-editor.tsx`: 前端编辑器组件（黑金/单色双主题）
  - `api/agent-edit/route.ts`: 后端 API（异步提交+轮询模式）
- **注册工具**:
  - `image_edit`: 自然语言修图（OpenAI images/edits + Gemini）
  - `generate_image`: 从零生成新图片
  - `analyze_image`: 图片内容分析
  - `adjust_color`: 色彩/亮度/对比度调整
- **Agent 循环**:
  1. LLM 接收用户指令 + 工具列表，选择工具和参数
  2. 执行工具调用，获取结果
  3. 将结果反馈给 LLM，决定是否继续
  4. 重复直到任务完成或达到最大轮次
- **安全限制**: 最大 10 轮，单轮 60 秒超时，全局 5 分钟超时
- **前端 UI**:
  - 右侧浮动面板，黑金/单色双主题适配
  - 进度条 + 执行步骤展示（成功/失败标记）
  - 最大轮次选择（3/5/8）
  - 取消按钮 + 错误重试
- **入口**:
  - 选中图片工具栏"Agent编排"按钮
  - 右键菜单"Agent编排"
  - 底部工具栏"Agent"按钮
- **与语言修图的关系**: 语言修图是 Agent 的固定 2 步子集（1 个工具，无循环），Agent 支持多工具 + 动态循环

- **入口**:
  - 无限画布右键菜单"语言修图"
  - 无限画布底部工具栏"语言修图"按钮
  - 图片预览浮窗"语言修图"按钮
- **支持的模型**:
  - **OpenAI**: GPT Image 2、DALL-E 3 — 支持画笔涂抹指定修改区域（蒙版）
  - **Google Gemini**: Nano Banana (gemini-2.5-flash-image)、Nano Banana Pro (gemini-3-pro-image-preview)、Nano Banana 2 (gemini-3.1-flash-image-preview) — 仅文字描述，AI 智能理解修改意图
- **ImageEditor 组件**:
  - 黑金配色浮动面板，显示原始图片预览
  - 画笔/橡皮擦/清除工具（仅 OpenAI 模型可用）
  - Gemini 模型显示"此模型暂不支持区域涂抹"覆盖层
  - 5个模型按钮 3+2 网格布局，显示模型特性提示
  - 自然语言输入框描述修改意图
  - 尺寸选择 (1024/1536/2048)、质量选择 (低/中/高)
  - API Key 输入（OpenAI/Google 分别显示不同占位符）
  - 编辑历史记录、结果预览框、SVG连接线、拖拽移动
- **API 接口**:
  - POST `/api/edit` - 语言修图 (JSON: image + prompt + mask + size + quality + apiKey + model)
  - GET `/api/edit` - 获取支持的编辑模型列表
  - OpenAI 路径: 使用 openai SDK 调用 images.edit，支持蒙版
  - Gemini 路径: 使用 @google/generative-ai 调用 generateContent，不支持蒙版
  - 支持 base64 data URL、HTTP URL、相对路径（/api/serve-upload/xxx）图片输入
  - 完善的错误处理：401/403/429/503 + 网络错误 + API Key 无效 + 权限不足
- **选择模式**:
  - 点击"语言修图"后进入选择模式 (langEditMode='selecting')
  - 顶部显示提示横幅"点击图片进行语言修图"
  - 点击图片后打开编辑器，ESC取消选择
- **结果处理**:
  - 编辑完成后替换原图（URL和prompt更新）
  - 编辑结果自动保存到画布

### 19. 工作流节点模式 (workflow-engine.ts + node-editor.tsx + api/workflow)

基于 DAG 拓扑排序的可视化工作流编排系统，支持自然语言建图、连线语义类型、节点间数据传递。

- **核心架构**:
  - `workflow-engine.ts`: DAG 拓扑排序 (Kahn 算法)、节点输入解析 (`getNodeInputs`)、执行请求构建 (`buildNodeExecutionRequest`)、30+ 节点类型定义、ComfyUI工作流导入
  - `node-editor.tsx`: 前端节点编辑器（SVG 画布 + 侧边栏属性面板 + 素材库 + 画布助手 + 小地图）
  - `api/workflow/`: 执行/模型/保存/AI建图 4 个 API 端点
- **P0 核心功能**:
  - **AI 自然语言建图**: 用户输入自然语言描述 → LLM 解析 → 自动生成完整节点图（nodes+edges+layout），复用管理员配置的 chat 模型
  - **AI 建图二次修正**: AI首次输出nodes<2时自动追问重新生成，确保生成有意义的多节点工作流
  - **连线语义类型**: 连线区分 prompt(提示词)/image(图片)/reference(参考图)/mask(蒙版) 类型，端口类型约束（image 只能接 image）
  - **节点间数据传递**: 上游节点 output 自动流入下游节点 input，`getNodeInputs` 从已完成节点获取输入
  - **串行等待执行**: `waitForUpstreamCompletion` 确保节点等待上游节点实际完成后才执行
  - **@图片引用**: 提示词输入框输入@符号弹出画布图片列表，选中后插入`[img:id]`引用，执行时自动解析为图片URL
  - **画布模式专用节点**: 字境大师(ai-font-design)、精修引擎(ai-refine-engine)、品牌电商(ai-brand-ecommerce)、元素分层(ai-segment)、多角度(ai-multi-angle)、3D模型(ai-3d-model)
- **P1 增强功能**:
  - **专业预设工作流**: 8 种预设模板（文生图/图生图/精修/品牌/字境/元素分层/多角度/3D模型），一键加载
  - **节点自动布局**: `autoLayoutWorkflow` — DAG 拓扑排序 → 自动计算 grid 位置，输入左输出右
  - **图片组节点**: output-image-group 类型，支持叠卡预览和设主图
  - **节点复制粘贴**: Ctrl+C/V 复制节点+连线关系，自动偏移位置
  - **连线高亮**: 选中节点时自动高亮所有上下游节点和连线
  - **执行日志面板**: 底部右侧实时显示每个节点的执行状态、耗时、错误信息
  - **素材库系统**: 双层（本地+服务器）素材管理，支持图片/提示词/颜色素材，分类筛选，一键填入节点，localStorage 持久化
  - **画布助手上游自动引用**: 选中节点后自动遍历上游节点作为上下文，连同当前节点信息一起发送给AI助手
  - **分镜串行工作流**: storyboard-sequence 节点类型，支持多场景描述+串行执行，每个场景依次生成图片
- **P2 扩展功能**:
  - **提示词库**: 提示词 CRUD、标签管理、分类筛选、一键填入节点，localStorage 持久化
  - **画布助手 (节点感知)**: 选中节点后助手自动读取上下文，对话+建议，调用 `/api/chat`
  - **撤销重做 (节点级)**: 50 步历史栈，Ctrl+Z 撤销 / Ctrl+Shift+Z 重做
  - **节点 JSON 编辑器**: 右键或工具栏 → 查看/编辑工作流原始 JSON，高级用户可直接编辑（build_mode下隐藏）
  - **小地图增强**: 视口指示框（金色半透明矩形），点击小地图直接跳转到对应画布位置
  - **build_mode 检测**: 检测生产环境 `COZE_PROJECT_ENV=PROD`，自动隐藏开发工具（JSON编辑器等）
  - **ComfyUI 工作流导入**: 解析 ComfyUI 前端格式（nodes+links）和 API 格式（class_type+inputs），自动映射节点类型，工具栏一键导入 .json 文件
- **30+ 节点类型**:
  - 输入: input-text, input-image
  - AI图像: ai-generate, ai-remove-bg, ai-upscale, ai-retouch, ai-font-design, ai-refine-engine, ai-brand-ecommerce, ai-segment, ai-multi-angle, ai-3d-model
  - AI视频: ai-video-generate, ai-video-i2v
  - 控制: condition, loop, agent, storyboard-sequence
  - 输出: output-image, output-export, output-image-group, output-video
  - 每种类型含完整 fields 定义（text/textarea/number/select/toggle/slider/model-select/color）
- **API 接口**:
  - POST `/api/workflow/execute` - 执行工作流 (action: start/status/cancel)
  - GET `/api/workflow/models` - 获取模型列表 (type: image/chat/all)
  - POST `/api/workflow/save` - 保存工作流
  - POST `/api/workflow/ai-build` - AI 自然语言建图

### 20. 视频生成与编辑 (video-api.ts + video-generation-panel.tsx + video-edit-panel.tsx)

基于6种视频API协议适配层的视频生成与编辑功能，支持文生视频、图生视频、视频延长等。

- **6种视频API协议适配器**: dashscope-kling(可灵) / volcengine-ark(豆包/Seedance) / minimax(海螺AI) / vidu(Vidu) / openai-video(Sora等) / fal-video(Runway/Pika/Luma)
- **20+视频模型注册表** (VIDEO_MODEL_REGISTRY): 每个模型含协议、提供商、区域(cn/global)、特征(首尾帧/多参考图/视频编辑/延长/音效)
- **文生视频**: 纯文字描述生成视频，支持画面比例/时长/质量选择
- **图生视频**: 首帧驱动、首尾帧驱动、多参考图三种模式
  - 首帧驱动: 上传首帧图片，AI 生成后续视频内容
  - 首尾帧驱动: 上传首帧+尾帧图片，AI 生成中间过渡（仅支持 firstLastFrame 特征的模型）
  - 多参考图: 上传多张参考图，AI 综合参考生成（仅支持 multiReference 特征的模型）
- **视频延长**: 在现有视频末尾继续生成内容（仅支持 videoExtend 特征的模型）
- **音效生成**: 生成视频时可选同时生成音效（仅支持 audio 特征的模型）
- **视频播放器**: 黑金主题播放器，支持进度条/音量/倍速(0.5x-2x)/全屏/ESC关闭
- **视频编辑面板**: 语言编辑(描述修改意图) + 视频延长两个Tab，黑金/单色双主题
- **画布视频渲染**: 无限画布中视频图片显示播放按钮覆盖层，点击播放/右键菜单
- **节点模式**: 3个视频节点类型(ai-video-generate / ai-video-i2v / output-video)
- **Agent编排**: 注册 generate_video / extend_video 两个视频工具
- **管理员后台**: 视频模型类型支持，自动识别视频模型关键词
- **异步提交+轮询**: 所有视频API均采用POST提交+GET轮询，复用task-registry/poll-task/SSE架构
- **API 接口**:
  - POST `/api/video/generate` - 视频生成 (prompt/model/imageUrl/mode/aspectRatio/duration等)
  - GET `/api/video/generate` - 获取默认视频配置(比例/时长/模式列表)
  - POST `/api/video/extend` - 视频延长 (videoUrl/model/prompt/extendDuration等)
  - GET `/api/video/extend` - 获取视频延长API说明

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

# API 提供商配置（管理员后台动态添加，支持任意 OpenAI 兼容 API）
# 以下环境变量为向后兼容保留，优先使用管理员后台配置
APIMART_API_KEY=your_apimart_key
APIMART_BASE_URL=https://api.apimart.ai

# Google Gemini 配置
GEMINI_API_KEY=your_gemini_key

# 数据库持久化（关键：确保重部署后数据不丢失）
PGDATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
# 也支持 DATABASE_URL 环境变量

# 矢量化 (可选)
PY_VECTORIZE_ENDPOINT=http://localhost:8000/vectorize

# Inpainting 擦除/蒙版服务 (使用 AI 生成 API + 蒙版合成策略)
# 擦除和蒙版均通过 AI 模型生成内容，后端自动做蒙版合成确保非编辑区域像素级保留

# ========== 本地图像工具 ==========
# 是否启用本地 AI 工具 (upscayl / IOPaint)
LOCAL_AI_ENABLED=true

# IOPaint (LaMa + RemoveBG) 本地图像工具
# 支持 Python 子进程模式（推荐，无需启动独立服务）和 HTTP 服务模式（兼容旧版）
IOPAINT_BASE_URL=http://127.0.0.1:8080
IOPAINT_TIMEOUT_MS=300000

# 图片上传限制
IMAGE_MAX_SIZE_MB=20
IMAGE_MAX_EDGE=2048

# 无损放大
UPSCAYL_MODELS_DIR=./upscayl-models
UPSCALE_DEFAULT_SCALE=2
UPSCALE_MAX_SCALE=4
UPSCALE_TIMEOUT_MS=300000
```

## 安全注意事项

1. **API Key 管理**: 所有 API Key 必须通过环境变量传入，严禁硬编码
2. **文件上传**: 限制上传文件类型和大小
3. **用户输入**: 对所有用户输入进行验证和 sanitize
4. **CORS**: 正确配置跨域策略

## 数据库持久化架构

### 概述
管理员系统的用户数据、API 配置等核心数据已迁移到 PostgreSQL 数据库存储，确保应用重新部署后数据不丢失。

### 存储策略：数据库优先 + 文件系统兜底
- **读取**: 先尝试数据库，数据库不可用时回退到文件系统
- **写入**: 同时写入数据库和文件系统（双写），保证数据一致性和可恢复性
- **迁移**: 应用启动时自动将文件系统数据迁移到数据库（`instrumentation.ts`）

### 数据库表
| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `wujie_users` | 用户数据 | id, name, password_hash, role, status, api_permissions, email |
| `wujie_api_providers` | API 提供商 | id, name, base_url, api_key, model_type, selected_models, discovered_models |
| `wujie_user_data` | 用户项目/图片数据 | user_id, data_key, data_value (联合主键) |
| `wujie_system_settings` | 系统设置 | key, value |

### 核心文件
- `src/lib/db-client.ts`: PostgreSQL 连接池（读取 `PGDATABASE_URL` 或 `DATABASE_URL`）
- `src/lib/db-storage.ts`: 数据库 CRUD 操作 + 文件迁移函数
- `src/instrumentation.ts`: 启动时自动触发 `migrateFileDataToDb()`
- `src/lib/server-auth.ts`: 用户认证（读取先数据库后文件，写入双写）
- `src/lib/server-api-config.ts`: API 提供商配置（读取先数据库后文件，写入双写）

### API 辅助
- `src/lib/api-helpers.ts`: `fetchWithV1Retry()` - 先尝试原始 URL，失败后自动重试带 `/v1` 的 URL

### API 兼容层 (api-compatibility.ts)
- **核心目标**: 让程序能对接任意 OpenAI 兼容 API 提供商，不偏向任何特定平台
- **兼容配置文件 (CompatProfile)**:
  - `openai`: 标准 OpenAI API（/images/edits + /images/generations，multipart 表单）
  - `openai-async`: OpenAI 异步 API（/images/generations + /tasks/{id} 轮询）
  - `apimart`: APImart 代理格式（/images/generations，JSON + image_urls，异步轮询）
  - `auto`: 自动推断（根据 base URL 特征匹配）
  - `custom`: 自定义（用户可通过管理员后台 advancedParams 指定所有参数）
- **配置文件解析优先级**:
  1. 提供商显式 `compatProfile` 字段
  2. 提供商 `advancedParams.compatProfile` 字段
  3. 自动推断（基于 base URL 特征）
- **关键函数**:
  - `resolveCompatProfile()`: 解析提供商的兼容配置文件
  - `adjustRequestForProfile()`: 根据配置文件调整请求体（端点选择、参数格式、input_fidelity 等）
  - `parseResponseForProfile()`: 根据配置文件解析响应（直接返回 vs 异步轮询）
  - `buildPollUrl()`: 根据配置文件构建轮询 URL（支持不同路径模板）
- **提交策略**: JSON 优先 → multipart/form-data 降级（兼容所有提供商）
- **管理员自定义**: 通过 `advancedParams` 字段覆盖任意配置文件参数

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

### IOPaint 擦除/去背景不工作
- 检查 `LOCAL_AI_ENABLED` 是否为 `true`（开发环境默认开启，生产环境默认关闭）
- 检查 LaMa 模型文件是否存在且 >1MB：`~/.cache/torch/hub/checkpoints/big-lama.pt`
- 运行 `bash scripts/download-iopaint-models.sh` 下载模型
- RemoveBG 模型（u2net）首次使用时自动下载，需网络连接
- IOPaint 不可用时会自动降级到 AI API → 本地算法兜底

## 更新日志

### v3.2.0 (当前版本)

**P0: 视频生成核心功能**
- 新增 `video-api.ts`: 6种视频API协议适配层（dashscope-kling/volcengine-ark/minimax/vidu/openai-video/fal-video）
- 20+视频模型注册表 (VIDEO_MODEL_REGISTRY)，包含模型名/协议/提供商/区域/特征
- 新增 `/api/video/generate` 视频生成API（文生视频/图生视频，异步提交+轮询）
- 新增 `video-player.tsx` 视频播放器组件（进度条/音量/倍速/全屏，黑金主题）
- 新增 `video-generation-panel.tsx` 视频生成面板（模型选择/提示词/比例/时长/模式）
- generation-panel.tsx 新增图像/视频 Tab 切换
- infinite-canvas.tsx 新增视频渲染（播放按钮覆盖层/VideoPlayer弹窗/右键菜单）
- 管理员后台新增视频模型类型、自动识别、权限控制
- user-types.ts CanvasImage 新增 mediaType/videoUrl/videoDuration/videoThumbnailUrl/isPlaying
- poll-task/route.ts 新增 video 任务轮询分支
- model-name-map.ts 新增 20+ 视频模型名称映射

**P1: 视频增强功能**
- 首尾帧模式: 图生视频支持首帧驱动/首尾帧驱动/多参考图三种模式
- 多参考图上传: 支持上传多张参考图生视频
- 视频延长: 新增 `/api/video/extend` API，支持可灵V3/Seedance等模型延长
- video-generation-panel 新增延长Tab（选择视频+时长+描述）
- 音效生成: 根据模型特征动态显示音效开关，参数传递到API
- page.tsx 新增 handleVideoExtend 处理函数

**P2: 视频节点与编辑**
- workflow-engine.ts 新增3个视频节点类型: ai-video-generate / ai-video-i2v / output-video
- 视频节点完整字段/端口/执行逻辑定义，modelFilter 扩展支持 'video'
- node-editor.tsx 新增视频节点图标映射（Film/FileVideo）
- agent-engine.ts 注册 generate_video / extend_video 两个视频工具
- 新增 `video-edit-panel.tsx` 视频编辑面板（语言编辑+视频延长，黑金/单色双主题）
- infinite-canvas.tsx 右键菜单新增"视频编辑"/"视频延长"选项

### v3.1.0

**P0: 图片模型信息(modelName/apiProvider)持久化修复**
- user-types.ts CanvasImage 新增 modelName/apiProvider 可选字段定义
- loadProjectsFromServer 合并逻辑升级：服务器+本地都有图片时做字段级合并，保留本地非空的 modelName/apiProvider/model/originalWidth/originalHeight
- 服务器独有数据路径：回填 modelName（历史数据 model 有值但 modelName 为空时，用 model 字段值补充）
- normalizeImageUrls 同步回填 modelName（数据加载/迁移时自动补全）
- onProjectsChanged 字段保留逻辑：从 latestImagesRef 保留本地非空字段，避免30秒同步覆盖
- completedCanvasImages modelName 回退链：img.modelName || pollingModelName || img.model，确保模型名称始终有值
- 自动保存类型修复：PersistableCanvasImage 类型别名 + as 类型断言，解决 user-types 与 infinite-canvas CanvasImage 类型兼容问题
- apiProvider 渲染时回退：infinite-canvas 新增 modelProviderMap (useMemo)，当 image.apiProvider 为空时从模型配置查找提供商名称显示
- modelProviderMap 支持纯模型ID和复合键(providerId::modelId)两种格式的映射

**P0: 扩展命令 gemini-image 协议修复**
- submitImageTask 新增 gemini-image 协议检测与 chat 格式转换（buildGeminiChatImageRequest）
- 编辑操作（扩展/擦除/蒙版）遇到真正的 Gemini 图像模型时自动跳过，回退到支持 /images/edits 的模型
- isGeminiImageModel 精确检测：只跳过真正的 Gemini 图像模型，gpt-image-2-c 等非 Gemini 模型不再被错误跳过
- outpaint 改用 autoTrySubmitImageTask，支持候选模型自动回退

**P0: images[].image_url 格式适配**
- adjustRequestForProfile 新增 image/image_urls → images[{image_url:{url}}] 格式转换
- 修复 "images[].image_url is required" 错误（OpenAI GPT-Image-2 等模型新格式要求）
- 所有 API 路由（generate / image-edit / refine-engine / scene-studio）统一受益

**P0: 精修引擎修复**
- submitRefineToApi 新增 gemini-image 专用路由（buildGeminiChatImageRequest + parseGeminiChatImageResponse）
- selectedModel 格式从纯 modelId 改为 providerId::modelId，修复多供应商同名模型选择 bug
- getModelDisplay 匹配时同时比较 modelId + providerId

**P0: 表情助手修复**
- 修复并发问题：添加 isGeneratingItemRef 防止多个 doGenerate 同时运行
- 改为串行逐张生成，避免 API 限流导致全部失败
- 改进错误处理：先解析 JSON 再检查 res.ok，显示实际 API 错误信息

**P0: 3D 构图功能修复**
- 后端 scene-studio/generate/route.ts 重写：支持 providerId/model 前端传参 + images 格式转换 + gemini-image/pearapi 协议
- 前端新增图像模型选择器（生成 tab）和 LLM 模型选择器（布景 tab）
- AIAutoLayoutPanel 接受 chatModels/selectedChatModel/onSelectChatModel props

### v3.0.0

**P0: SVG 智能描摹全面升级**
- VTracer 预处理管道升级：小图智能放大（最长边 < 384px → 768px lanczos3）、中值滤波 median(1) 减噪、轻微模糊 blur(0.3) 平滑色彩梯度、低精度预量化（colorPrecision ≤ 5 时 sharp 预减色）
- AI SVG 提示词工程：从简单指令升级为专业 SVG 工程师 prompt（角色定义+7 步分析流程+1:1 还原优先+路径数 ≤ 220 限制+禁止 base64/image/foreignObject）
- AI SVG 重试机制：首次失败后使用轮廓锁定提示词二次生成
- `sanitizeAIGeneratedSvg` 安全过滤：检测拒绝 script/foreignObject/image/on*事件/外部 href/base64 嵌入，验证 viewBox 和元素数量
- `normalizeVectorSvg` SVG 标准化：统一 width/height/viewBox 为原始图片尺寸
- 路径数质量控制：彩色/黑白模式 > 900 路径提示"更适合保留 PNG"
- design/vectorize 路由同步升级：专业提示词+安全过滤+标准化

**P0: 移除背景边缘修复**
- `repairEdgeColors` 边缘颜色混合修复：对半透明边缘像素采样周围不透明像素颜色加权混合，消除抠图锯齿和色差
- 集成到 `postProcessLocalRemoveBG`：所有去背景策略（IOPaint RemoveBG / AI 原生透明 / 本地透明化）结果统一应用边缘修复
- AI 原生透明输出：`background: "transparent"` 参数请求 API 直接返回透明 PNG

**P0: 放大超时修复 + 任务注册**
- 放大异步任务注册到 task-registry（此前缺失），确保 poll-task 能正确查询第三方 API 提供商信息
- `submitImageTask` 返回值新增 `apiBaseUrl`/`apiKey`/`advancedParams` 字段
- `autoTrySubmitImageTask` 传播提供商信息到返回值
- `pollForResult` 缓存 `providerId`（函数开头调用一次），避免轮询期间用户切换模型导致查询错误提供商
- 所有 `pollForResult` 调用从传递 `apiKey`（值为 'server-managed'）改为传递 `modelInfo.model`
- 放大 fetch 添加 5 分钟 AbortController 超时

**P1: 26+ 模型参数适配**
- MODEL_QUALITIES：从 5 个模型扩展到 26 个模型，按官方文档修正所有尺寸/质量参数
- MODEL_PIXEL_SIZES：完整重写，26 个模型 × 多质量档位 × 多宽高比的精确像素值
- MODEL_SPECIFIC_PIXEL_SIZES：从 3 个模型扩展到 33 个模型（含别名如 doubao-seedream-5-0-lite + seedream-5-0-lite）
- 关键修正：Seedream 5.0 Lite 移除错误 1K 改为 2K/3K；Seedream 4.5 移除 1K 改为 2K/4K；新增 Kling V3/V3 Omni、Ideogram、SD-XL、HiDream、Flux 等

**P1: 节点模式与画布模式对齐**
- 节点编辑器模型名称使用 `getModelDisplayName()` 显示友好名称
- quality/aspectRatio 选项根据所选模型动态更新
- 切换模型时自动重置为新模型支持的默认值
- buildNodeExecutionRequest 统一使用 `calculateActualPixels` 计算精确像素尺寸

**P1: AI 图像编辑模型默认对齐**
- 所有工具栏工具（放大/移除背景/擦除/蒙版/扩展/多角度）统一使用图像生成面板当前选择的模型
- pollForResult 内部 pollModel 使用传入的 model 参数而非每次迭代重新读取 getCurrentModel()
- `image-editor.tsx` 默认选中图像生成面板当前模型（而非列表第一个）

### v2.9.0

**P0: RemoveBG 同时输出透明图+蒙版图**
- 移除背景时同时生成透明背景 PNG 和黑白蒙版 PNG，两图并排添加到画布
- 黑白蒙版图：白色=前景主体，黑色=背景，方便用户手动抠图
- `remove-bg-postprocess.ts` 重构：Python 端完成所有蒙版处理（膨胀+模糊+应用），Node.js 端仅保存文件
- 修复 `callPythonScript` 不设置 success 字段导致本地 RemoveBG 路径从未执行的 Bug
- API 响应新增 `maskUrl` 字段，`poll-task` 和 `completedTaskCache` 同步传播
- `RemoveBgResult` 类型新增 `maskUrl` 字段

**P0: 任务基础设施升级**
- 新增 `task-registry.ts`: 统一任务注册中心，支持状态追踪、SSE推送、取消、队列管理
- 新增 `/api/cancel-task`: 任务取消 API，支持所有异步任务取消
- 新增 `/api/task-events`: SSE 实时任务事件推送，替代前端轮询（保留轮询兜底）
- 新增 `/api/queue-position`: 队列位置查询 API
- 新增 `task-events-client.ts`: 前端 SSE 客户端，自动连接/重连/降级
- 集成到 generate、image-edit、edit 路由：注册任务、推送进度、检查取消
- 前端无限画布 processing frame 新增取消按钮（黑金+单色双主题）

**P0: 图片压缩上传**
- 新增 `image-compress.ts`: 前端 canvas 压缩 + 尺寸限制
- `save-image/route.ts` 新增后端 sharp 压缩（compress 参数）
- 上传图片自动压缩：超过 4MB 或 2048px 自动缩放压缩

**P1: API 协议验证**
- 新增 `/api/verify-protocol`: 一键验证 API 提供商协议兼容性
- 管理员面板每个提供商旁新增"验证"按钮
- 自动推断 openai/apimart/auto 协议，检测模型列表/图片生成/对话端点

**P1: 任务队列**
- task-registry 内置排队机制：按用户限并发，超额任务自动排队
- 队列位置查询 API，前端可显示"排队第N位"

**P2: Agent 编排**
- 新增 `agent-engine.ts`: 工具注册表 + Agent 循环（LLM思考→选工具→执行→再思考）
- 新增 `agent-editor.tsx`: 前端编辑器组件（黑金/单色双主题）
- 新增 `/api/agent-edit`: Agent 编排 API（异步提交+轮询）
- 注册工具: image_edit / generate_image / analyze_image / adjust_color
- 入口: 选中图片工具栏 + 右键菜单 + 底部工具栏
- 安全限制: 最大 10 轮，单轮 60s 超时，全局 5min 超时

**IOPaint 本地集成**
- 擦除功能升级：IOPaint 多模型优先（LaMa/ZITS/Anime-Lama），AI 模型兜底，BFS 边界扩散最终兜底
  - LaMa: 默认推荐，精准抹除与智能修复
  - ZITS: 结构感知修复，保持线条和结构更好
  - Anime-Lama: 动漫/漫画专用擦除
- 去背景功能升级：IOPaint RemoveBG 优先（3个精选模型：BiRefNet通用推荐 + U2Net轻量快速 + Silueta轻量人像），默认 birefnet-general-lite，AI 模型兜底，本地透明化最终兜底
- 新增 Python 子进程模式：直接调用 `iopaint_erase.py` / `iopaint_removebg.py`，无需启动独立服务
- 保留 HTTP 服务模式兼容旧版
- 新增 `scripts/download-iopaint-models.sh` 模型下载脚本（支持 LaMa/ZITS/Anime-Lama + RemoveBG 模型）
- `iopaint-client.ts` 重构：支持多模型擦除（LaMa/ZITS/Anime-Lama） + RemoveBG 去背景（3个精选模型），Python 子进程 + HTTP 双模式
- 健康检测 API 增强：报告擦除模型可用性（LaMa/ZITS/Anime-Lama）、RemoveBG 模型列表、Python 脚本状态

### v2.8.0

**SVG 智能描摹**
- 新增 `/api/svg-trace` API：彩色模式（vtracer 全彩矢量化）+ 黑白模式（potrace 轮廓追踪）
- 多级质量预设：快速(64色) / 均衡(256色) / 高清(1024色) / 极致(4096色)
- 自定义参数：colorPrecision / filterSpeckle / cornerThreshold / lengthThreshold
- 温和颜色合并后处理：仅合并 RGB 距离 < 12 的极近色，保留真实色彩
- 多策略降级：矢量模型 API → LLM 视觉模型 fallback → 本地 vtracer 兜底
- PNG 预览生成：sharp 光栅化 SVG→PNG（彩色）/ potrace→BMP→PNG（黑白）
- CanvasImage 新增 `svgDataUrl` 字段，画布显示 PNG 预览，下载输出完整 SVG

**语言修图**
- 新增 `/api/edit` API：支持 OpenAI（GPT Image 2/DALL-E 3 + 蒙版）和 Gemini（纯文字描述）
- 异步提交+轮询模式：editTaskStore 内存 Map 管理任务（100 上限 + 30 分钟清理）
- LLM 协作 3→1 合并：3 次 chat/completions 调用合并为 1 次，节省 API 费用
- SSE 响应兼容解析
- IIFE 全局 5 分钟超时兜底

**擦除功能 AI 增强**
- AI 模型优先智能修复：全图发送 AI（不裁剪避免变形）+ 蒙版精确合成
- `compositeAIResultToOriginal` 函数：仅替换蒙版区域像素，保留非蒙版区域
- 图片 > 2048px 时等比缩放，AI 结果缩放回原图尺寸
- BFS 边界扩散作为兜底方案

**蒙版修图 AI 增强**
- AI 模型优先生成 + 后端精确蒙版合成
- 蒙版羽化边缘 20px 渐变过渡

**图片编辑异步任务**
- 擦除/蒙版/放大/扩展支持提交+轮询模式
- `persistImageBuffer` 三级 fallback：S3 → save-image API → base64 data URL

**API 兼容层升级**
- 通用多提供商适配（openai / openai-async / apimart / auto / custom）
- `fetchWithV1Retry` 自动重试带 /v1 的 URL

### v2.7.0

**客户端数据服务器同步**
- `UserManagerCore` 新增 `syncToServer()` / `loadProjectsFromServer()` 方法
- 每次 `saveData()` 后自动通过 `/api/user-data/sync` 将项目数据同步到数据库（2秒防抖）
- 登录时自动从服务器加载项目数据（localStorage 为空时从数据库恢复）
- 新增 `/api/user-data/sync` API（GET/POST），支持按 key 读写用户数据到 `wujie_user_data` 表
- 管理员面板不再 fallback 到 localStorage，数据来源统一为服务器 API + 数据库

**z-index 层级规范**
- 重构全局 z-index 层级：z-[90] 认证覆盖层 → z-[100] UserManager/LayerGraphStudio → z-[200/201] Dialog
- 修复新建项目弹窗被 UserManager 遮挡的 BUG（Dialog z-index 提升）
- 移除过高的 z-[99999]/z-[100000] 值

**组数据持久化修复**
- beforeunload 处理器补充 groupId 和 metadata.groups
- 退出登录保存补充 groupId 和 metadata.groups
- 自动保存后同步更新 currentProject React 状态
- 新增 localStorage 独立兜底机制：onGroupsChange 时同步写入 localStorage
- 三处加载路径（auto-login / onLogin / project select）均增加 localStorage 兜底读取

### v2.6.0

**数据库持久化存储**
- 将管理员系统数据存储从文件系统迁移到 PostgreSQL 数据库，确保重新部署后数据不丢失
- 新增 `db-client.ts`：PostgreSQL 连接池，支持 `PGDATABASE_URL` 和 `DATABASE_URL` 环境变量
- 新增 `db-storage.ts`：数据库 CRUD 操作（用户、API 提供商、用户数据、系统设置）
- 新增 `instrumentation.ts`：应用启动时自动将文件系统数据迁移到数据库
- 存储策略：读取先数据库后文件系统，写入双写（数据库+文件），确保数据一致性和可恢复性
- 数据库表：`wujie_users`、`wujie_api_providers`、`wujie_user_data`、`wujie_system_settings`
- 用户认证（`server-auth.ts`）和 API 配置（`server-api-config.ts`）均已更新为数据库优先模式

**API 兼容性修复**
- 新增 `fetchWithV1Retry()` 辅助函数：先尝试原始 URL，失败后自动重试带 `/v1` 的 URL
- 所有 API 路由（generate、chat、image-edit、optimize-prompt 等）均已使用此函数
- 移除自动追加 `/v1` 的逻辑，由用户完全控制 API URL 格式

**管理员系统增强**
- 测试连接支持 `providerId` 参数，直接从服务器存储读取配置
- LLM 模型测试连接扩大成功状态码判断范围（200/400/422/429/500+ 均视为 API 可达）
- 测试连接使用 `fetchWithV1Retry` 自动处理 `/v1` 兼容

**UI 修复**
- 修复登录界面不显示问题：添加 `authChecked` 状态和认证门控覆盖层
- 新增图片自动居中：上传/生成图片后视图自动跳转到当前图片并居中显示
- 帮助文字更新："更新说明"改为"更新内容"

### v2.5.1

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
- API 类型精简为5种：图像模型、LLM模型、3D模型、矢量模型、图片分层模型
- 图像/LLM/3D模型：支持自动识别模型，管理员选择后对接功能
- 矢量模型：自动匹配 vectorize/vector/svg/tracer 模型，对接矢量化工具和导出SVG
- 图片分层模型：自动匹配 qwen-image-layered/layer/segment 模型，对接编辑元素和下载PSD
- 旧类型 imageEdit/universal 自动映射为 image 类型保持兼容
- `findProviderForFeature` 新增 'chat' 支持，供矢量化 fallback 使用
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

**图像生成面板**
- 画面比例添加对应比例图形预览（矩形宽高按比例计算）
- 扩图增加缩放比例选项（原始比例/1x/1.5x/2x/3x/4x）

**Ctrl+Z 撤回优化**
- 移除 toast 提示，改为纯 ref 同步管理
- 使用 historyStackRef + historyIndexRef 替代 useState 管理
- handleUndo 直接调用 setImagesRaw，避免异步状态竞争
- 快速连续撤回操作流畅无卡顿
