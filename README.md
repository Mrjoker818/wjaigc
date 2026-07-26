# 无界AI / BoundlessAI

<p align="center">
  <strong>AI 图像生成 · 智能图层编辑 · 无限画布协作平台</strong>
</p>

<p align="center">
  <em>AI Image Generation · Smart Layer Editing · Infinite Canvas Collaboration Platform</em>
</p>

---

## 🌟 简介 / Introduction

**中文**

无界AI 是一款基于 Next.js 16 + React 19 + TypeScript 的 AI 图像生成与协作平台。集成了无限画布、AI 聊天、多模型图像生成、PSD 图层编辑器等核心功能，支持 DALL-E 3、Gemini、Imagen 等主流 AI 模型。

**English**

BoundlessAI is an AI image generation and collaboration platform built on Next.js 16 + React 19 + TypeScript. It integrates infinite canvas, AI chat, multi-model image generation, PSD layer editor, and more, supporting mainstream AI models including DALL-E 3, Gemini, and Imagen.

---

## ✨ 核心功能 / Core Features

### 🎨 无限画布 / Infinite Canvas

| 功能 | 描述 | Feature | Description |
|------|------|---------|-------------|
| 拖拽/缩放 | 自由拖拽图片，滚轮缩放画布 | Drag & Zoom | Drag images freely, scroll to zoom |
| 框选/多选 | 框选区域，Ctrl 多选图片 | Area Select | Area selection, Ctrl for multi-select |
| 编辑模式 | 擦除、蒙版、扩展、裁切 | Edit Modes | Erase, Mask, Expand, Crop |
| 右键菜单 | 图片操作/画布操作上下文菜单 | Context Menu | Image/Canvas context menus |
| 下载导出 | PNG / SVG / PSD 多格式导出 | Export | PNG / SVG / PSD multi-format export |

### 🤖 多模型图像生成 / Multi-Model Image Generation

| 模型 / Model | 提供商 / Provider | 类型 / Type |
|-------------|-------------------|------------|
| 豆包 SeeDream | 扣子平台 / Coze | 免费 / Free |
| Gemini 2.5 Flash / Pro | Google | 本地 API / Local API |
| Gemini 3.1 Pro Preview | Google | 本地 API / Local API |
| Imagen 4 / Ultra / Fast | Google | 本地 API / Local API |
| DALL-E 3 | OpenAI | OpenAI API |
| GPT Image 2 | OpenAI | OpenAI API |

### 📊 PSD 图层编辑器 / PSD Layer Editor

**中文** — v4.0.0 全新核心功能 — AI 图像/视频生成协作平台，参考 [bggg-creator-image2psd](https://github.com/binggandata/bggg-skills/tree/main/bggg-creator-image2psd) 开源项目方法论：

- **背景移除分割**：取代像素级颜色分割，保证元素完整性
- **5 种背景模式**：none / white / corner / color / white-preserve
- **AI 视觉分析**：调用 Gemini 模型识别图片语义结构
- **连通域分析**：在前景掩码上查找完整连通区域
- **全画布透明 PNG**：每个图层 (0,0) 定位，Photoshop 零偏移叠加
- **V4 图层命名**：bg/main, subject/{idx}/{label}, text/{idx}/{excerpt}, deco/{idx}/{label}, fx/shadow/{idx}

**English** — v4.0.0 — AI Image/Video Generation Collaboration Platform, following the methodology of [bggg-creator-image2psd](https://github.com/binggandata/bggg-skills/tree/main/bggg-creator-image2psd):

- **Background Removal Segmentation**: Replaces pixel-level color splitting, preserving element integrity
- **5 Background Modes**: none / white / corner / color / white-preserve
- **AI Visual Analysis**: Uses Gemini model to identify semantic image structure
- **Connected Component Analysis**: Finds complete connected regions on foreground mask
- **Full-Canvas Transparent PNG**: Each layer positioned at (0,0), zero-offset stacking in Photoshop
- **V4 Layer Naming**: bg/main, subject/{idx}/{label}, text/{idx}/{excerpt}, deco/{idx}/{label}, fx/shadow/{idx}

**PSD 导出模式 / PSD Export Modes:**

| 模式 / Mode | 说明 / Description |
|------------|-------------------|
| **Basic** | 原图层 + 白色背景 + 注释层 / Original + white bg + annotation |
| **Pro** | 背景移除 + 语义命名 + 背景重建 + V4 XMP / BG removal + semantic naming + BG rebuild + V4 XMP |
| **Studio** | 所有 Pro + 阴影估算 + 语义分组 + 质量评分 + V4 清单 / All Pro + shadow + grouping + scoring + V4 manifest |

### 📝 提示词大师 / Prompt Master

- 三种优化模式 / Three optimization modes：增强 Enhance / 扩展 Expand / 精简 Simplify
- 6 大专业智能体 / 6 professional agents：摄影 / 插画 / 3D / 平面设计 / 电商 / 建筑
- 双语输出 / Bilingual output：中英文提示词自动生成
- 一键发送 / One-click send：优化结果直达图像生成面板

### 🧠 AI 聊天 / AI Chat

- Google Gemini 模型驱动 / Powered by Google Gemini
- Agent 联网思考模式 / Agent web-thinking mode
- 图像理解能力 / Image understanding capability

---

## 🛠 技术栈 / Tech Stack

| 技术 | 版本 | 用途 |
|-------|------|------|
| Next.js | 16 (App Router) | 全栈框架 / Full-stack framework |
| React | 19 | UI 库 / UI library |
| TypeScript | 5 | 类型安全 / Type safety |
| Tailwind CSS | 4 | 样式 / Styling |
| shadcn/ui | Latest | 组件库 / Component library |
| ag-psd | Latest | PSD 读写 / PSD read/write |
| coze-coding-dev-sdk | Latest | AI 模型调用 / AI model invocation |

---

## 📁 项目结构 / Project Structure

```
src/
├── app/
│   ├── page.tsx                    # 主应用页面 / Main app page
│   ├── layout.tsx                  # 根布局 / Root layout
│   ├── globals.css                 # 全局样式 / Global styles
│   └── api/
│       ├── generate/route.ts       # 图像生成 API / Image generation API
│       ├── poll-task/route.ts      # 轮询任务状态 / Poll task status
│       ├── chat/route.ts           # AI 聊天 API / AI chat API
│       ├── optimize-prompt/route.ts # 提示词优化 / Prompt optimization
│       └── analyze-psd/route.ts    # AI 视觉分析 / AI visual analysis
├── components/
│   ├── generation-panel.tsx        # 图像生成控制面板 / Generation panel
│   ├── infinite-canvas.tsx         # 无限画布 / Infinite canvas
│   ├── chat-panel.tsx              # AI 聊天面板 / Chat panel
│   ├── image-preview.tsx           # 图片预览 / Image preview
│   ├── psd-editor/                 # PSD 编辑器 / PSD editor
│   │   ├── PsdLayerEditor.tsx      # 主编辑器组件 / Main editor component
│   │   ├── PsdCanvas.tsx           # 画布渲染 / Canvas rendering
│   │   ├── LayerPanel.tsx          # 图层列表面板 / Layer list panel
│   │   ├── LayerRow.tsx            # 图层行组件 / Layer row component
│   │   ├── LayerInspector.tsx      # 属性面板 / Properties panel
│   │   └── ExportToolbar.tsx       # 导出工具栏 / Export toolbar
│   └── ui/                         # shadcn/ui 组件 / shadcn/ui components
├── lib/
│   ├── psd-export.ts               # PSD 导出核心 / PSD export core
│   ├── svg-export.ts               # SVG 导出 / SVG export
│   └── config.ts                   # 配置文件 / Configuration
└── types/
    └── psdLayer.ts                 # PSD 类型定义 / PSD type definitions
```

---

## 🚀 快速开始 / Quick Start

### 安装 / Installation

```bash
# 安装依赖 / Install dependencies
pnpm install

# 开发模式 (端口 5000) / Dev mode (port 5000)
pnpm dev

# 生产构建 / Production build
pnpm build

# 生产启动 / Production start
pnpm start
```

### 环境变量 / Environment Variables

```bash
# API 配置 / API configuration
APIMART_API_KEY=your_apimart_key
APIMART_BASE_URL=https://api.apimart.ai

# Google Gemini 配置 / Google Gemini configuration
GEMINI_API_KEY=your_gemini_key
```

---

## 📋 更新日志 / Changelog

### v2.0.0 (2025-05-06) - 图层编辑器 / Layer Editor

**🆕 新增 / Added:**
- PSD 图层编辑器：全屏透明画布 + 浮动面板 + 图层管理
- 智能元素分割：背景移除 + 连通域分析（参考 bggg-creator-image2psd）
- AI 视觉分析：Gemini 模型自动识别图片语义结构
- PSD 三模式导出：Basic / Pro / Studio
- SVG 三模式导出：Fast / Pro / Studio
- 提示词大师 2.0：三种优化模式 + 6 大专业智能体 + 双语输出
- 5 种背景移除模式：none / white / corner / color / white-preserve
- 文字检测：Sobel 边缘密度 + 宽高比启发式

**🔄 优化 / Improved:**
- 分割算法重构：从像素级颜色分割改为背景移除 + 连通域分析
- Otsu 亮度阈值：无统一背景时自动确定前景/背景分界
- AI 降级策略：AI 不可用时自动降级为纯算法分析
- ag-psd 兼容性：确保 PSD 文件兼容 Photoshop / Photopea / Affinity

**🐛 修复 / Fixed:**
- 元素碎片化：彻底解决像素级颜色分割导致的元素碎裂问题
- 图层不渲染：修复 imageDataUrl 未填充导致画布空白
- 透明度显示：修复透明度显示为 25500% 的问题
- 画布尺寸：使用实际图片尺寸替代硬编码 600x400

### v1.0.0 (2025-04-27) - 首发版 / Initial Release

- 无限画布 / Infinite canvas
- 多模型图像生成 / Multi-model image generation
- AI 聊天 / AI chat
- 黑金配色 UI / Black-gold themed UI

---

## ⚠️ 安全注意事项 / Security Notes

1. **API Key 管理 / API Key Management**: 所有 API Key 必须通过环境变量传入，严禁硬编码 / All API keys must be passed via environment variables, never hardcode
2. **文件上传 / File Upload**: 限制上传文件类型和大小 / Restrict upload file types and sizes
3. **用户输入 / User Input**: 对所有用户输入进行验证和清理 / Validate and sanitize all user inputs
4. **CORS**: 正确配置跨域策略 / Configure CORS properly

---

## 📄 许可证 / License

Private - All Rights Reserved

---

<p align="center">
  <strong>无界AI</strong> · 让创作没有边界<br>
  <em>BoundlessAI</em> · Creativity Without Boundaries
</p>
