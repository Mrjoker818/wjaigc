# 无界AI — AI 图像生成与协作平台

## 项目概览

这是一个基于 Next.js 16 + React 19 + TypeScript 的 AI 图像生成与协作平台，支持无限画布操作、AI 聊天、图像生成与编辑、图生图、PSD/SVG 导出等功能。

### 核心技术栈
- **框架**: Next.js 16 (App Router)
- **UI**: React 19 + shadcn/ui + Tailwind CSS 4
- **语言**: TypeScript 5
- **AI 集成**: 通用 API 兼容层（支持 OpenAI / Gemini / 任意兼容格式 API）
- **图像生成**: DALL-E 3、Midjourney、Stable Diffusion 等多种模型
- **特色功能**: 无限画布、图生图、PSD/SVG 导出、3D 模型预览、本地图像编辑(upscayl/IOPaint)、Ctrl+Z 撤回

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
│       ├── edit/route.ts             # 语言修图 API (OpenAI images.edit，自然语言描述修改图片)
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
│   ├── api-helpers.ts              # API 辅助函数（fetchWithV1Retry 智能 /v1 重试）
│   ├── psd-export.ts               # PSD 导出功能
│   ├── svg-export.ts               # SVG 矢量化导出
│   ├── config.ts                   # 配置文件
│   ├── api-compatibility.ts        # API 兼容层（通用多提供商适配，自动推断请求格式）
│   └── image-tools/
│       ├── config.ts               # 本地图像工具配置 (环境变量/目录/超时)
│       ├── file.ts                 # 文件工具 (读取/缩放/保存/清理)
│       ├── mask.ts                 # 蒙版工具 (校验/归一化/反转)
│       ├── upscayl.ts              # upscayl-node 放大引擎
│       └── iopaint-client.ts       # IOPaint+LaMa 修图客户端
├── types/
│   └── image-tools.ts              # 本地图像工具类型定义
scripts/
└── start-iopaint-lama.sh           # IOPaint LaMa 启动脚本
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

### 10. 本地图像编辑 (image-editor/ + image-tools/)

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
- **启动脚本**: `scripts/start-iopaint-lama.sh`

### 11. 语言修图 (image-editor.tsx + api/edit)

基于自然语言描述的图片编辑功能，使用 OpenAI images.edit API，用户无需手动绘制蒙版，只需描述想要的修改即可。

- **入口**:
  - 无限画布右键菜单"语言修图"
  - 无限画布底部工具栏"语言修图"按钮
  - 图片预览浮窗"语言修图"按钮
- **ImageEditor 组件**:
  - 黑金配色浮动面板，显示原始图片预览
  - 自然语言输入框描述修改意图
  - 尺寸选择 (1024/1536/2048)
  - 透明背景选项
  - 加载/保存状态管理
- **API 接口**:
  - POST `/api/edit` - 语言修图 (multipart form: image + prompt + size + background)
  - 使用 openai SDK 调用 images.edit
  - 支持 base64 和 URL 格式图片输入
  - 自动查找服务器端配置的图像模型 API
- **选择模式**:
  - 点击"语言修图"后进入选择模式 (langEditMode='selecting')
  - 顶部显示提示横幅"点击图片进行语言修图"
  - 点击图片后打开编辑器，ESC取消选择
- **结果处理**:
  - 编辑完成后替换原图（URL和prompt更新）
  - 编辑结果自动保存到画布

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

# IOPaint (LaMa) 本地修图服务
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

## 更新日志

### v2.7.0 (当前版本)

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
