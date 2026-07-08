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
- **特色功能**: 无限画布、图生图、图生视频、视频延长、PSD/SVG 导出、3D 模型预览、语言修图、SVG智能描摹、Agent编排、工作流节点模式、Ctrl+Z 撤回、自动连线

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
│       │   ├── generate/route.ts   # 视频生成 API (文生视频/图生视频/首尾帧, 异步提交+轮询, 支持导演增强+尾帧续写)
│       │   ├── extend/route.ts     # 视频延长 API (基于可灵/Seedance等, 异步提交+轮询, 支持导演增强)
│       │   └── extract-frame/route.ts # 视频抽帧 API (首帧/尾帧/指定秒/最后N帧拼图, ffmpeg, 支撑多镜头连续性)
│       ├── optimize-prompt/route.ts # 提示词优化 API
│       ├── analyze-psd/route.ts    # AI 视觉分析图片结构 API
│       ├── vision-prompt/route.ts  # 图片识词 API (SSE流+JSON双模式)
│       ├── image-to-3d/
│       │   ├── route.ts            # 图片转3D API (单图/多图/文生3D, 4提供商Hunyuan3D/Meshy/Tripo/Rodin)
│       │   ├── auto-multi-view/route.ts  # 自动多视角转3D API (AI生成4视角图→合并转3D)
│       │   ├── meshy-stream/route.ts    # Meshy SSE流式进度代理 API
│       │   ├── post-process/route.ts    # 3D后处理API (重贴图/减面, Meshy Retexture/Remesh)
│       │   └── poll-post-process/route.ts  # 3D后处理轮询API
│       ├── poll-3d-task/route.ts   # 3D 模型任务轮询 API (支持Meshy SSE流式+多图结果)
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
│       │   ├── upscale-pro/route.ts # 无损放大Pro API (PearAPI+ONNX+AI精修, 多策略降级)
│       │   └── inpaint/route.ts    # 涂抹消除/蒙版修图 API (IOPaint+LaMa)
│       ├── admin/
│       │   ├── api-balance/route.ts   # API 余额与用量分析 API
│       │   └── op-log/route.ts        # 操作日志 API (查询/统计/AI分析/修复/批量删除/导出)
│       └── design/
│           └── vectorize/route.ts  # 矢量化 API (支持管理员配置的矢量模型 + PY_VECTORIZE_ENDPOINT)
├── components/
│   ├── generation-panel.tsx        # 图像生成控制面板（仅图像，视频已独立）
│   ├── infinite-canvas.tsx         # 无限画布组件
│   ├── chat-panel.tsx              # AI 聊天面板
│   ├── image-preview.tsx           # 图片预览组件
│   ├── image-editor.tsx             # 语言修图编辑器组件 (自然语言描述修改图片，内联画笔/橡皮/撤销/清除蒙版能力，无独立 image-editor/ 子目录)
│   ├── video-player.tsx             # 视频播放器组件 (进度条/音量/倍速/全屏, 黑金主题, 已同步fullscreenchange/volumechange)
│   ├── video-generation-panel.tsx   # 视频生成面板组件 (文生视频/图生视频/首尾帧/多参考图/延长/音效, URL输入受控)
│   ├── video-edit-panel.tsx         # 视频编辑面板组件 (语言编辑/视频延长, 黑金主题, 已补loading+错误提示)
│   ├── agent-editor.tsx             # Agent编排编辑器组件 (智能选择工具，多轮编辑, 已补unmount清理)
│   ├── font-design-panel.tsx        # 字境大师Pro字体设计面板 (黑金/单色双主题, 左右分栏)
│   ├── node-editor.tsx              # 节点编辑器组件 (工作流DAG编辑, AI建图, 提示词库, 画布助手, 撤销重做)
│   ├── model-viewer-3d.tsx         # 3D 模型预览组件 (视角切换/光照/线框/下载/后处理/多视角缩略图)
│   ├── motion-brush-canvas.tsx      # 视频运动笔刷画布组件 (画笔/橡皮/撤销/箭头轨迹, 已修复空蒙版恒导出bug)
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
│   ├── op-log.ts                  # 操作日志记录模块（logOpSuccess/logOpError/logOpWarn快捷函数）
│   ├── config.ts                   # 配置文件
│   ├── api-compatibility.ts        # API 兼容层（通用多提供商适配，自动推断请求格式）
│   ├── video-api.ts                # 视频API协议适配层（6种协议适配器, 20+视频模型注册表）
│   ├── api-error-translator.ts     # API错误中文翻译（结构化错误码→中文标题+描述+建议）
│   ├── size-auto-repair.ts         # 尺寸自动修复（检测Invalid Size错误→16对齐修正）
│   ├── responses-api-sse.ts        # Responses API SSE保活（/v1/responses+SSE心跳, Feature Flag控制）
│   ├── model-capabilities.ts       # 通用模型能力注册表（30+模型能力检测+参数过滤+尺寸规范+Responses API支持判定）
│   ├── smart-retry.ts              # 智能重试引擎（CF 524/504识别+同模型重试+Partial Image兜底+传输层错误+上游可重试检测）
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

### 8. 3D 模型生成与预览

- **3D模型生成** (api/image-to-3d/)
  - 支持3种模式：单图转3D / 多图转3D / 文生3D
  - 支持4种提供商：Hunyuan3D(3.0/3.1八视图) / Meshy(5/6) / Tripo / Rodin
  - 高级参数：PBR材质 / 目标面数 / 姿态模式(A-Pose/T-Pose) / 导出格式(GLB/OBJ/FBX/USDZ/STL)
  - 自动多视角生成：AI先生成4视角图(front/left/right/back)再合并转3D
  - Meshy SSE流式进度推送（替代轮询）
  - 3D后处理：重贴图(retexture) / 重网格(remesh)
- **3D模型预览** (model-viewer-3d.tsx)
  - 基于 Three.js + OrbitControls
  - 6预设视角(前/后/左/右/上/下)一键切换
  - 3种光照模式(柔和/影棚/户外) + 线框/实体/材质切换
  - 自动旋转开关 + 中键平移 + 双指缩放
  - 多视角缩略图(front/right/back/left)
  - 格式选择下载(GLB/OBJ/FBX/USDZ/STL)
  - 模型信息面板(面数/顶点数/文件大小)
  - 一键截图导出PNG
  - 后处理按钮(重贴图/重网格)
- **画布3D弹窗** (infinite-canvas.tsx)
  - 单图/多图/文生3D 三Tab切换
  - 多图模式：8个视角槽位(正面/左面/右面/背面/顶面/底面/自由1/自由2)
  - 自动生成视角图按钮(AI先出图再转3D)
  - 高级参数面板(PBR/面数/格式/姿态)

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
- **无损放大Pro**: PearAPI Real-ESRGAN 云端 → 本地 ONNX Real-ESRGAN (CPU) → AI 重绘兜底，放大后自动 AI 画质精修（补细节/消噪点/还原质感，保持原图内容不变）
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
  - POST `/api/image/upscale-pro` - 无损放大Pro（PearAPI+ONNX+AI精修，多策略降级）

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

## 操作日志系统 (op-log.ts + admin/op-log/route.ts)

基于数据库的完整操作日志系统，自动记录用户操作和错误，提供 AI 分析与智能修复能力。

### 核心架构
- `op-log.ts`: 操作日志记录模块，提供 `logOpSuccess` / `logOpError` / `logOpWarn` 快捷函数
- `admin/op-log/route.ts`: 日志管理 API（查询/统计/AI分析/修复/批量删除/导出）
- `db-storage.ts`: 扩展 `wujie_audit_log` 表（新增 level/error_message/stack_trace/request_data/response_status/duration_ms/model/provider_id/resolution_status 等列）

### 日志记录范围
- **已集成日志的 API 路由（15个）**:
  - `generate/route.ts` - 图像生成
  - `chat/route.ts` - AI 聊天
  - `image-edit/route.ts` - 图片编辑（擦除/蒙版/放大/扩展/去背景）
  - `edit/route.ts` - 语言修图
  - `video/generate/route.ts` - 视频生成
  - `video/extend/route.ts` - 视频延长
  - `workflow/execute/route.ts` - 工作流执行
  - `image-to-3d/route.ts` - 图片转3D
  - `refine-engine/route.ts` - 精修引擎
  - `agent-edit/route.ts` - Agent编排编辑
  - `font-design/generate-image/route.ts` - 字境大师图片生成
  - `brand-ecommerce/route.ts` - 品牌电商图片生成
  - `design/vectorize/route.ts` - 图片矢量化
  - `svg-trace/route.ts` - SVG智能描摹
  - `segment-elements/route.ts` - 元素分层
- **记录内容**: 操作类型、用户ID、模型/提供商、请求参数(脱敏)、响应状态、耗时、错误信息/堆栈
- **日志级别**: info(成功操作) / warn(超时/降级) / error(失败/异常)

### AI 分析与修复
- **AI 分析**: 调用管理员配置的 LLM 模型分析错误日志，给出根因分析和修复建议
- **智能修复**: 根据错误类型自动执行修复脚本（重置配额/切换模型/调整参数等）
- **批量处理**: 支持批量标记已解决/忽略、批量删除

### API 接口
- GET `/api/admin/op-log` - 查询日志列表（支持 action/level/userId/startTime/endTime/resolutionStatus/search 筛选 + 分页）
- POST `/api/admin/op-log` - 操作日志管理
  - action: `statistics` - 获取统计概览
  - action: `analyze` - AI 分析指定日志
  - action: `resolve` - 标记日志已解决/忽略
  - action: `batch_delete` - 批量删除日志
  - action: `export` - 导出日志 CSV

### 前端 UI (admin-tabs.tsx)
- 管理员面板"操作日志"Tab：统计卡片(总操作/今日操作/错误数/未解决) + 筛选栏(操作类型/日志级别/用户ID) + 日志列表 + 详情展开(错误堆栈/请求参数/AI分析) + 解决操作(标记已解决/忽略/AI修复)

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

### 自动连线不显示
- 检查 `connections` prop 是否从 page.tsx 正确传递给 InfiniteCanvas
- 检查 `onConnectionsChange` 回调是否正确更新状态
- 连线仅在有 `generatedFromImageId` 或 `relationType` 时自动创建
- `completeProcessingFrame` 需要传递 `relationType` 参数才会创建连线
- `RELATION_TYPE_CONFIG` 定义了6种关系类型: variant/reference/edit/img2img/upscale/trace

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

### v3.8.0 (当前版本)

**P0: 视频导演系统 (Video Director) — 导演级提示词编排 + AI分镜 + 失败诊断**

- 新增 `src/lib/video-director/` 导演核心模块（参考 seedance-2.0 MIT 协议的提示词系统）：
  - `prompt-compiler.ts`：导演提示词编译器，支持 6 种导演风格（cinematic/documentary/commercial/music-video/anime/minimal），输出结构化镜头语言（景别/运镜/光线/表演/声音）+ 统一负向提示词
  - `continuity.ts`：结构化分镜计划（VideoShotPlan）+ 连续性账本（ContinuityLedger）+ 尾帧续写提示词构造
  - `retake-diagnosis.ts`：失败诊断引擎（10类失败模式：人物变形/角色不一致/动作不符/运镜错误/首尾帧不连贯/参考图污染/风格跑偏/时长不足/镜头过乱/文字水印），输出单变量重试建议
  - `model-capabilities.ts`：视频模型导演能力档案（按模型家族裁剪首尾帧/多参考图/音效/最大时长等参数）
  - `reference-binding.ts`：参考资产语义绑定（角色/场景/风格/构图/运动/光线/摄像机/声音/首帧/尾帧 10 类角色）
- 新增 3 个导演 API 端点：
  - `POST /api/video/director/prompt`：导演增强（调用管理员配置的 chat 模型将自然语言想法编译为专业导演提示词）
  - `POST /api/video/director/shot-plan`：AI分镜（将故事拆分为 3-8 个结构化镜头，含景别/运镜/光线/声音/连续性备注）
  - `POST /api/video/director/diagnose`：失败诊断（返回结构化问题与单变量重试建议）
- 生成/延长路由集成导演增强：`/api/video/generate` 与 `/api/video/extend` 支持 `useDirector` + `directorStyle` 参数，开启后自动调用导演编译器增强 prompt/negative
- 视频生成面板（video-generation-panel.tsx）升级：
  - 浮动窗口两列布局（左 340px 风格模板与模型，右列提示词与参数）
  - 导演风格选择器（6 种风格按钮）
  - "AI 导演增强"按钮：调用 /api/video/director/prompt 生成专业提示词
  - "AI 分镜"按钮：多镜头叙事模式下调用 /api/video/director/shot-plan 自动拆分镜头
  - 结构化镜头卡片：展示景别/运镜/光线/声音标签，支持单独生成/删除/生成所有镜头
  - 参考图语义角色标签（角色/场景/风格/构图/首帧/尾帧等）
- 参考 dramaclaw 的数据模型与工作流思路（Elastic License 仅借鉴流程，未搬代码）
- P3 尾帧续写闭环：新增 `/api/video/extract-frame`（ffmpeg 抽帧 API，支持 first/last/at/N-grid 四种模式），前端"生成所有镜头"走串行流水线：上一镜头视频轮询完成→调抽帧 API 拿尾帧 URL→自动作为下一镜头 firstFrameUrl 传入，并用 `buildContinuationPrompt` 构造含前序尾帧描述的连续性提示词；UI 实时回写每个镜头的 status(generating/completed/failed) 和 thumbnailUrl；默认开启"尾帧接力"开关

### v3.7.0

**P0: 管理员操作日志系统 — 用户操作记录 + AI分析与智能修复**

- 新增 `op-log.ts` 操作日志记录模块：提供 `logOperation` / `logError` 函数 + `OP_ACTIONS` 常量（40+操作类型）
- 扩展 `wujie_audit_log` 数据库表：新增 level/error_message/stack_trace/request_data/response_status/duration_ms/model/provider_id/resolution_status/resolution_detail/resolved_at/resolved_by 列
- **15个 API 路由集成日志记录**: generate / chat / image-edit / edit / video/generate / video/extend / workflow/execute / image-to-3d / refine-engine / agent-edit / font-design/generate-image / brand-ecommerce / design/vectorize / svg-trace / segment-elements
- 新增 `/api/admin/op-log` 日志管理 API（GET 查询 + POST 操作：statistics/analyze/resolve/batch_delete/export）
- AI 日志分析：调用管理员配置的 LLM 模型分析错误日志，给出根因分析和修复建议
- 智能修复：根据错误类型自动执行修复脚本（重置配额/切换模型/调整参数等）
- 管理员面板"操作日志"Tab：统计卡片 + 筛选栏 + 日志列表 + 详情展开 + 解决操作 + AI分析
- 日志级别分类：info(成功操作) / warn(超时/降级) / error(失败/异常)
- 解决状态管理：none/pending/resolved/wontfix
- 批量操作：批量标记已解决/忽略、批量删除
- CSV 导出功能

**P0: FHL API 兼容性修复 — Responses API + 私有IP回退**

- `responses-api-sse.ts` 增强：新增 `extractImageUrlFromMarkdown` 辅助函数，支持从 `response.output_item.done` 和 `response.completed` 事件的 `message` 类型文本中提取 Markdown 格式图片 URL
- `responses-api-sse.ts` 新增 `response.output_text.done` 和 `response.output_text.delta` 事件类型解析
- `parseResponsesApiSSEEvent` 支持 FHL 返回的 `item.type === 'message'` + Markdown `![...](url)` 图片格式（替代标准 `image_generation_call.item.result` base64 格式）
- `generate/route.ts` 新增私有IP图片URL检测和三级回退策略：
  1. 优先尝试提供商域名替换（将私有IP替换为API base_url的域名）
  2. 回退到非流式 `/v1/responses`（`stream: false`），获取外部可访问的图片URL
  3. 最终回退到 `/chat/completions` 获取外部URL
- `generate/route.ts` 新增 `downloadAndSaveImage` 辅助函数，通过服务端代理下载不可达的图片URL并保存为本地可访问路径
- `generate/route.ts` 新增 `isPrivateIp` 辅助函数，检测 10.x / 172.16-31.x / 192.168.x 私有网段
- `api-compatibility.ts` `isChannelUnavailableError` 新增 `no available compatible account` 模式匹配
- `api-error-translator.ts` 新增 FHL 特定错误模式（渠道不可用 + 模型不支持建议）和中文翻译
- **根因**: FHL 的 `/images/generations` 端点不可用（502/503），图像生成需通过 `/v1/responses` 端点，且流式响应返回私有IP图片URL，非流式返回外部可访问URL

### v3.5.0 (当前版本)

**P0: 图片转3D全面升级 — 多图/文生3D/3D预览器增强**
- `api/image-to-3d/route.ts` 全面升级：新增 `mode` 字段支持 `single-image`/`multi-image`/`text-to-3d` 三种模式
- 新增 `images` 多图数组字段，支持1-8张不同视角图片输入
- 新增 `prompt` 文生3D描述字段
- 新增 `enablePBR`/`faceCount`/`pose` 参数，支持PBR材质/目标面数/A-Pose/T-Pose
- Meshy 提供商适配 `/openapi/v1/multi-image-to-3d` 多图端点 + `/openapi/v1/text-to-3d` 文生3D端点
- Tripo(阿里云) 提供商适配 `images` 多图数组 + `prompt` 文生3D
- 混元3D 3.1 提供商适配 `MultiViewImages` 八视图输入
- Rodin 提供商适配多图输入
- `api/poll-3d-task/route.ts` 升级：Meshy 多图任务轮询 + 返回 `thumbnail_urls`/`texture_urls`/`model_urls` 多格式/多视角
- 画布3D弹窗重构：单图/多图/文生3D三Tab切换UI
  - 单图模式：当前选中图片预览
  - 多图模式：8个视角上传槽位(正面/左面/右面/背面/顶面/底面/自由1/自由2)，支持拖拽上传
  - 文生3D模式：文字描述输入框
  - 新增：纹理质量(标准/PBR/4K)、目标面数、导出格式(GLB/OBJ/FBX/USDZ/STL)、姿态模式(无/A-Pose/T-Pose)
- `model-viewer-3d.tsx` 3D预览器全面升级：
  - 6个预设视角一键切换(前/后/左/右/上/下)
  - 3种光照模式(柔和/影棚/户外)
  - 4种材质显示(实体/线框/材质/PBR)
  - 自动旋转开关
  - 多格式下载(GLB/OBJ/FBX/USDZ/STL)
  - 模型信息面板(面数/顶点数/文件大小/提供商/模型)
  - 4格多视角缩略图(front/right/back/left)
  - 重贴图/减面后处理按钮
  - 截图导出PNG

**P1: 工作流3D节点增强**
- `ai-3d-model` 节点字段扩展：mode/prompt/texture/enablePBR/faceCount/format/pose
- 新增 `image_multi` 输入端口类型，支持从上游接收多张图片
- 执行逻辑扩展：多图模式构建 `images` 数组传递给 `/api/image-to-3d`

**P2: 高级3D功能**
- 混元3D 3.1 八视图支持：API路由自动在多图模式下使用 `Model: '3.1'` + `MultiViewImages`
- 多视角自动生成：新增 `/api/image-to-3d/auto-multi-view` API，AI先用图像模型生成4个视角图，再自动提交3D转换
- Meshy SSE流式进度：新增 `/api/image-to-3d/meshy-stream` SSE代理端点，代理Meshy API的SSE事件流
- 3D模型后处理：新增 `/api/image-to-3d/post-process` + `/api/image-to-3d/poll-post-process` API，支持重贴图(retexture)/减面(remesh)
- `task-registry.ts` 新增 `3d-retexture`/`3d-remesh` 任务类型

### v3.4.0

**P0: Image-Studio 借鉴升级 — 5项容错与稳定性增强**
- 新增 `api-error-translator.ts`: API错误码结构化中文翻译（9类错误→标题+描述+建议+是否可重试），前端展示友好提示
- 新增 `size-auto-repair.ts`: 检测 "Invalid size" 错误后自动修正为16对齐的最近合法尺寸，无需用户手动调整
- 新增 `responses-api-sse.ts`: Responses API SSE 保活路径（`/v1/responses` + SSE心跳事件保持TCP活跃），解决 Cloudflare 524/504 超时断连；Feature Flag 控制，仅 `isResponsesApiSupportedModel()` 匹配时激活，失败自动降级回现有 Images API
- 新增 `smart-retry.ts`: 智能重试引擎，识别 CF 524/504 超时错误后同模型重试（3次+指数退避），Partial Image 兜底保存半成品图片
- 集成到 `generate/route.ts`: Responses API 路径尝试→自动降级、CF超时智能重试、Size Auto-Repair
- 集成到 `poll-task/route.ts`: 错误分类 `classifyApiError()` + CF超时检测 + 中文友好提示
- 集成到 `infinite-canvas.tsx`: 前端 `translateErrorFrontend()` 增强 CF 524/504 识别
- **零风险设计**: 所有新功能为纯增量，不修改现有函数签名，Feature Flag 默认关闭，降级路径完整

**P0: 通用模型能力优化 — 覆盖30+图像模型**
- 新增 `model-capabilities.ts`: 通用模型能力注册表，覆盖6大模型家族（OpenAI/DALL-E/Flux/Midjourney/Stable Diffusion/国产模型），30+模型精细能力检测
  - `getModelCapabilities()`: 按模型ID自动识别家族和能力配置
  - `filterRequestForModel()`: 按模型能力自动过滤请求参数（去掉不支持的 background/output_compression/input_fidelity/style 等）
  - `normalizeSizeForModel()`: 按模型家族约束规范化尺寸（OpenAI 16对齐/Flux 8对齐/SD 64对齐等）
  - `isResponsesApiSupportedModel()`: 判定模型是否支持 Responses API（从 responses-api-sse.ts 迁移）
  - `getSupportedSizes()`: 按模型返回支持的尺寸列表
- 升级 `size-auto-repair.ts`: 多约束优化算法（最小/最大边长+像素上限+宽高比约束+模型特定对齐+三重评分找最近合法尺寸）
- 增强 `smart-retry.ts`: 传输层错误识别（connection reset/EOF/TLS handshake等6种关键词）+ 上游可重试检测（origin_gateway_timeout/api_error/server_error等）+ Partial Image 流中断检测
- 扩展 Responses API 支持范围: 从仅 GPT-Image 扩展到 OpenAI 全系（gpt-image-1/1.5/2/3/mini/chatgpt-image-latest）+ Flux/Seedream/HiDream/Ideogram 等
- 集成到 `generate/route.ts`: `filterRequestForModel()` 自动按模型能力过滤请求参数，避免发送不支持的字段导致上游报错

### v3.3.1

**P0: 生产环境用户数据丢失修复**
- 发现生产数据库3个用户账号记录丢失（有项目数据但无用户记录），已直接通过 SQL 恢复
- 新增 `detectAndRecoverOrphanedUsers()` 函数：启动时自动检测孤立用户并恢复账号记录
- 修复 `db-storage.ts` 循环依赖：`detectAndRecoverOrphanedUsers` 内联 authSecret 逻辑（避免 import server-auth.js 导致模块找不到）
- 修复 `authSecret()` 安全警告刷屏：添加缓存机制 `_authSecretCache`，仅首次输出警告（之前每个请求都输出，生产日志被严重刷屏）
- 修复 `authSecret()` 可见性：从 `export` 改为模块内部 `function`（避免外部误用导致循环依赖）
- 修复 `readStore` 数据库回退逻辑：当 DB 读取失败回退文件系统时，不再将文件数据写回 DB（避免 stale 数据覆盖生产数据）
- 孤立用户恢复：临时密码 `wujie_reset_2024`，管理员应在恢复后重置用户密码
- 恢复的生产用户：zhnude / iw3qca / btcwsm（管理员可在面板中修改为原始用户名）

### v3.3.0

**P0: 任务并发控制与稳定性**
- task-registry.ts 新增任务并发控制：每用户最大 15 个并发任务（MAX_CONCURRENT_PER_USER=15），全局 500 任务上限
- registerTask 自动调用 enqueueTask，超额任务自动排队等待
- 新增 waitForQueueSlot() 异步等待函数，确保任务在队列空位后执行
- 所有 20 个 API 路由的 registerTask 调用补传 userId 参数用于并发控制

**P0: 关键 Bug 修复 — 视频链路**
- infinite-canvas.tsx 视频编辑/延长：`data.taskIds` → `data.taskId`（3处致命字段名错误）
- poll-task/route.ts：model 参数传递为对象而非字符串导致轮询失败
- video-edit-panel.tsx：handleSubmitEdit/handleSubmitExtend 回调未传递 model 和 providerId
- page.tsx：视频生成请求体补传高级参数（cameraControl/motionBrush/characterReferences/motionStrength/seed/negativePrompt/multiShotScenes）
- video/extend/route.ts：添加同步完成场景处理（第三方 API 直接返回视频 URL 时）

**P0: 关键 Bug 修复 — 品牌系统**
- brand-kit-panel.tsx：`action:'batch-generate'` → `'generate'`，`sceneTypes` → `scenarioIds`，添加 `brandDNA` 参数
- brand-packaging-panel.tsx：所有 onAddImages 调用补传 meta（modelName/apiProvider）
- display3d-panel.tsx：所有 onAddImages 调用补传 meta（modelName/apiProvider）
- brand-ecommerce-panel.tsx：handleRegenerateTemplate 补传 imageProviderId/llmModel/llmProviderId

**P0: 关键 Bug 修复 — 轮询与流式解析**
- poll-task/route.ts：对不存在任务返回 `status:'failed'` 而非 `status:'processing'`，避免前端无限轮询
- chat-panel.tsx：SSE 流式解析添加 sseBuffer 行级拼接，修复跨 chunk JSON 断裂问题
- infinite-canvas.tsx pollForResult：添加 not_found 状态处理

**P1: HTTP 状态码与安全修复**
- page.tsx handleCanvasGenerate：添加 !res.ok 检查和错误 toast 提示
- infinite-canvas.tsx 精修引擎：添加 !submitResp.ok 和 !pollRes.ok 检查
- infinite-canvas.tsx：移除 5 处向 /api/image-edit 传递 apiKey 的代码（安全修复）
- edit/route.ts：/images/edits 超时从 15s 增加到 30s

**P1: 编辑功能修复**
- 擦除模式 AI 路径：空 prompt 改为默认英文提示词，提升生成质量
- image-editor.tsx：不支持 mask 的模型显示蒙版丢弃警告
- node-editor.tsx：工作流轮询添加 300 次上限
- onImagesChange 函数式更新器类型修复：`onImagesChange(prev => prev.xxx)` 改为 `onImagesChange(images.xxx)`

### v3.2.0

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
