'use client';

import { useState } from 'react';
import {
  Move, Sparkles, MessageSquare, Layers, Keyboard, Lightbulb,
  BookOpen, X, Info, Pen, Wand2, ImagePlus, GitMerge, ImageIcon,
  ZoomIn, Eraser, Maximize, Download, Shapes, Settings, Database,
  FileBox, ChevronRight, Check, PenTool, Pencil, Box, Type,
  LayoutGrid, Bot, Palette, FolderOpen, FileImage, Building2, ShoppingBag, Store
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@/config/app-meta';

// ─── Types ──────────────────────────────────────────────────────

type SectionId = 'canvas' | 'generate' | 'img2img' | 'video' | 'tools'
  | 'svg-trace' | 'lang-edit' | 'agent-edit' | 'refine-engine' | 'sticker'
  | 'font-design' | 'logo-pro' | 'brand-factory' | 'brand-ecommerce'
  | 'node-editor' | 'scene-studio' | 'display3d' | 'ai-psd' | 'chat' | 'project' | 'admin'
  | 'shortcuts' | 'tips' | 'changelog';

interface SectionDef {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  group: '使用说明' | '更新内容';
}

const SECTIONS: SectionDef[] = [
  { id: 'canvas', label: '无限画布', icon: <Move size={14} />, group: '使用说明' },
  { id: 'generate', label: '图像生成', icon: <Sparkles size={14} />, group: '使用说明' },
  { id: 'img2img', label: '图生图', icon: <ImagePlus size={14} />, group: '使用说明' },
  { id: 'video', label: '视频生成', icon: <FileBox size={14} />, group: '使用说明' },
  { id: 'tools', label: '图片编辑工具', icon: <Pencil size={14} />, group: '使用说明' },
  { id: 'svg-trace', label: 'SVG 智能描摹', icon: <PenTool size={14} />, group: '使用说明' },
  { id: 'lang-edit', label: '语言修图', icon: <Wand2 size={14} />, group: '使用说明' },
  { id: 'agent-edit', label: 'Agent 编排', icon: <Bot size={14} />, group: '使用说明' },
  { id: 'refine-engine', label: '精修引擎', icon: <Palette size={14} />, group: '使用说明' },
  { id: 'sticker', label: '表情助手', icon: <Shapes size={14} />, group: '使用说明' },
  { id: 'font-design', label: '字境大师', icon: <Type size={14} />, group: '使用说明' },
  { id: 'logo-pro', label: 'Logo 生成器 Pro', icon: <PenTool size={14} />, group: '使用说明' },
  { id: 'brand-factory', label: '品牌工厂', icon: <Building2 size={14} />, group: '使用说明' },
  { id: 'brand-ecommerce', label: '品牌电商', icon: <ShoppingBag size={14} />, group: '使用说明' },
  { id: 'node-editor', label: '工作流节点模式', icon: <GitMerge size={14} />, group: '使用说明' },
  { id: 'scene-studio', label: '3D 构图', icon: <Box size={14} />, group: '使用说明' },
  { id: 'display3d', label: '3D 展陈系统', icon: <Store size={14} />, group: '使用说明' },
  { id: 'ai-psd', label: 'AI PSD 生成器', icon: <FileImage size={14} />, group: '使用说明' },
  { id: 'chat', label: 'AI 聊天', icon: <MessageSquare size={14} />, group: '使用说明' },
  { id: 'project', label: '项目管理', icon: <FolderOpen size={14} />, group: '使用说明' },
  { id: 'admin', label: '管理员系统', icon: <Settings size={14} />, group: '使用说明' },
  { id: 'shortcuts', label: '快捷键', icon: <Keyboard size={14} />, group: '使用说明' },
  { id: 'tips', label: '使用技巧', icon: <Lightbulb size={14} />, group: '使用说明' },
  { id: 'changelog', label: '更新内容', icon: <BookOpen size={14} />, group: '更新内容' },
];

// ─── Helpers ────────────────────────────────────────────────────

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <Check size={12} className="text-[var(--color-primary)] mt-0.5 shrink-0" />
      <span className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed">{children}</span>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold text-[var(--color-on-surface)] mt-3 mb-1">{children}</h4>;
}

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded bg-[var(--color-surface-container)] text-[var(--color-on-surface)] border border-[var(--color-outline-variant)]">
      {children}
    </kbd>
  );
}

// ─── Section Content Components ─────────────────────────────────

function CanvasSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">无限画布</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        核心操作区域，支持图片与视频混合编排、拖拽、缩放、多选、框选、编辑等丰富交互。
      </p>
      <SubTitle>交互方式</SubTitle>
      <FeatureItem>左键点击：选择图片（单选 / <KeyBadge>Ctrl</KeyBadge> 多选 / 框选）</FeatureItem>
      <FeatureItem>空白区域长按拖动 / <KeyBadge>空格</KeyBadge> + 拖动：平移画布</FeatureItem>
      <FeatureItem>滚轮：缩放画布</FeatureItem>
      <FeatureItem>右键：上下文菜单（图片菜单 / 画布菜单）</FeatureItem>
      <FeatureItem><KeyBadge>ESC</KeyBadge>：退出编辑模式 / 取消选择</FeatureItem>
      <FeatureItem><KeyBadge>Delete</KeyBadge> / <KeyBadge>Backspace</KeyBadge>：删除选中图片</FeatureItem>
      <FeatureItem><KeyBadge>Ctrl+Z</KeyBadge>：无限步数撤回</FeatureItem>
      <SubTitle>底部浮动工具栏</SubTitle>
      <FeatureItem>选择工具 / 平移工具 / 上传图片 / 缩放控制 / 重置视图</FeatureItem>
      <FeatureItem>功能按钮：精修 / 语言修图 / Agent / 字境 / Logo / 品牌 / 电商 / PSD / 表情 / 六面体 / ChatCanvas / 节点 / 3D</FeatureItem>
      <SubTitle>图片操作工具栏（选中图片后顶部显示）</SubTitle>
      <FeatureItem>放大、移除背景、SVG 描摹、擦除、蒙版、编辑元素</FeatureItem>
      <FeatureItem>扩展画面、图生图、裁切、下载（PNG / SVG / PSD）</FeatureItem>
      <SubTitle>视频支持</SubTitle>
      <FeatureItem>视频图片显示播放按钮覆盖层，点击播放或右键菜单操作</FeatureItem>
      <FeatureItem>视频编辑 / 视频延长 / 视频压缩</FeatureItem>
      <SubTitle>下载格式</SubTitle>
      <FeatureItem>PSD：Basic / Pro / Studio 三种导出模式</FeatureItem>
      <FeatureItem>SVG：Fast / Pro / Studio 三种矢量化精度</FeatureItem>
    </div>
  );
}

function GenerateSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">图像生成</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        支持多种 AI 图像模型，通过管理员后台动态配置，支持任意 OpenAI 兼容 API 提供商。
      </p>
      <SubTitle>基础功能</SubTitle>
      <FeatureItem>模型选择：从管理员配置的模型列表中选择图像模型</FeatureItem>
      <FeatureItem>画面比例：带比例图形预览，直观展示比例样式</FeatureItem>
      <FeatureItem>生图质量：根据所选模型支持的质量设置</FeatureItem>
      <FeatureItem>产品品类：通用、人物、风景、建筑等预设场景</FeatureItem>
      <SubTitle>高级功能</SubTitle>
      <FeatureItem>提示词优化：支持增强 / 扩展 / 精简三种模式</FeatureItem>
      <FeatureItem>参考图功能：6 大类别（风格 / 构图 / 场景 / 色彩 / 主体 / 细节），每张参考图可选类别 + 强度</FeatureItem>
      <FeatureItem>反向提示词：排除不想要的元素</FeatureItem>
    </div>
  );
}

function Img2ImgSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">图生图</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        选中图片后，通过顶部工具栏"图生图"按钮进入。基于原图生成新图，支持多维度参考控制。
      </p>
      <SubTitle>参考类别（独立开关 + 强度滑块）</SubTitle>
      <FeatureItem>风格（in the style of）：参考原图的风格</FeatureItem>
      <FeatureItem>构图（with the composition of）：参考原图的构图</FeatureItem>
      <FeatureItem>角色（featuring the character of）：参考原图的角色</FeatureItem>
      <FeatureItem>IP（based on the IP of）：参考原图的 IP 形象</FeatureItem>
      <SubTitle>快捷操作</SubTitle>
      <FeatureItem>"当前图片描述"：一键填充图片原始描述到关键词输入框</FeatureItem>
      <FeatureItem>"反向提示词"：自动填充默认反向提示词，可编辑修改</FeatureItem>
      <FeatureItem>生成比例自动与原图一致（4:3、16:9 等）</FeatureItem>
      <FeatureItem>生成结果在原图右侧显示，不覆盖原图</FeatureItem>
    </div>
  );
}

function ToolsSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">图片编辑工具</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        选中图片后，通过顶部工具栏使用各种编辑功能。AI 模型优先 + 本地算法兜底，确保编辑质量。
      </p>
      <SubTitle>放大</SubTitle>
      <FeatureItem>智能补细节把图片变大变高清，不改画面内容、不换背景</FeatureItem>
      <FeatureItem>支持多种放大模型和倍率（2x / 4x），输出格式 PNG / JPG / WEBP</FeatureItem>
      <SubTitle>移除背景</SubTitle>
      <FeatureItem>自动把主体和背景分开，一键删掉杂乱背景</FeatureItem>
      <FeatureItem>同时输出透明背景图 + 黑白蒙版图（白色 = 主体，黑色 = 背景）</FeatureItem>
      <FeatureItem>多模型可选：BiRefNet 通用推荐 / U2Net 轻量快速 / Silueta 轻量人像</FeatureItem>
      <SubTitle>擦除</SubTitle>
      <FeatureItem>画笔涂抹消除并自动无缝补上新的画面</FeatureItem>
      <FeatureItem>IOPaint 多模型优先（LaMa 通用 / ZITS 结构保持 / Anime-Lama 动漫），AI 模型兜底</FeatureItem>
      <SubTitle>蒙版修图</SubTitle>
      <FeatureItem>给图片加"透明遮罩膜"，精准控制编辑范围</FeatureItem>
      <FeatureItem>画笔 + 提示词输入 + AI 生成，后端精确蒙版合成</FeatureItem>
      <SubTitle>扩展画面</SubTitle>
      <FeatureItem>往图片四周延伸画面，扩大画布</FeatureItem>
      <FeatureItem>支持缩放比例（原始比例 / 1x / 1.5x / 2x / 3x / 4x）+ 画面比例选择</FeatureItem>
      <SubTitle>裁切</SubTitle>
      <FeatureItem>自由裁切 / 预设比例裁切，确认后生效</FeatureItem>
    </div>
  );
}

function SvgTraceSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">SVG 智能描摹</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        将位图转为矢量图，支持彩色和黑白两种模式，多级质量预设。
      </p>
      <SubTitle>模式</SubTitle>
      <FeatureItem>彩色模式：使用 vtracer 全彩矢量化，支持 64 ~ 4096 色精度</FeatureItem>
      <FeatureItem>黑白模式：使用 potrace 轮廓追踪，纯黑白输出，适合线稿和徽标</FeatureItem>
      <SubTitle>质量预设</SubTitle>
      <FeatureItem>快速（64 色）/ 均衡（256 色）/ 高清（1024 色）/ 极致（4096 色）</FeatureItem>
      <SubTitle>智能降级</SubTitle>
      <FeatureItem>矢量模型 API → LLM 视觉模型 fallback → 本地 vtracer 兜底</FeatureItem>
      <FeatureItem>画布显示 PNG 预览，下载输出完整 SVG</FeatureItem>
    </div>
  );
}

function LangEditSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">语言修图</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        通过自然语言描述修改图片，支持 OpenAI 和 Google Gemini 两种模型提供商。
      </p>
      <SubTitle>支持的模型</SubTitle>
      <FeatureItem>OpenAI：GPT Image 2、DALL-E 3 — 支持画笔涂抹指定修改区域（蒙版）</FeatureItem>
      <FeatureItem>Google Gemini：仅文字描述，AI 智能理解修改意图</FeatureItem>
      <SubTitle>操作方式</SubTitle>
      <FeatureItem>选中图片 → 工具栏"语言修图" → 用自然语言描述修改意图</FeatureItem>
      <FeatureItem>OpenAI 模型：画笔/橡皮擦/清除工具绘制蒙版区域</FeatureItem>
      <FeatureItem>Gemini 模型：仅文字描述即可，无需蒙版</FeatureItem>
      <FeatureItem>支持尺寸选择（1024 / 1536 / 2048）和质量选择（低 / 中 / 高）</FeatureItem>
      <FeatureItem>编辑结果替换原图，自动保存到画布</FeatureItem>
    </div>
  );
}

function AgentEditSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">Agent 编排</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        基于大语言模型的智能编排系统，自动选择和组合工具完成用户指令。语言修图的增强版，支持多工具 + 动态循环。
      </p>
      <SubTitle>注册工具</SubTitle>
      <FeatureItem>image_edit：自然语言修图（OpenAI images/edits + Gemini）</FeatureItem>
      <FeatureItem>generate_image：从零生成新图片</FeatureItem>
      <FeatureItem>analyze_image：图片内容分析</FeatureItem>
      <FeatureItem>adjust_color：色彩 / 亮度 / 对比度调整</FeatureItem>
      <FeatureItem>generate_video：文生视频 / 图生视频</FeatureItem>
      <FeatureItem>extend_video：视频延长</FeatureItem>
      <FeatureItem>adjust_color：色彩 / 亮度 / 对比度调整</FeatureItem>
      <SubTitle>Agent 循环</SubTitle>
      <FeatureItem>LLM 思考 → 选工具 → 执行 → 反馈 → 再思考，重复直到任务完成</FeatureItem>
      <FeatureItem>最大轮次可选（3 / 5 / 8），安全限制：单轮 60 秒超时，全局 5 分钟超时</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>选中图片工具栏"Agent 编排" / 右键菜单 / 底部工具栏</FeatureItem>
    </div>
  );
}

function RefineEngineSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">精修引擎</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        对画布中的图片进行 AI 精修优化，支持多种图像模型，保持原图构图的基础上提升画面质量。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>选择图像模型进行精修，支持管理员配置的所有图像模型</FeatureItem>
      <FeatureItem>画面比例和生图质量根据所选模型自动适配</FeatureItem>
      <FeatureItem>精修结果自动替换原图并保存到画布</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>选中图片 → 工具栏"精修"按钮</FeatureItem>
      <FeatureItem>右键菜单"精修引擎"</FeatureItem>
    </div>
  );
}

function StickerSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">表情助手</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        AI 驱动的表情包批量生成工具，一次生成多张不同风格的表情图。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>输入角色描述，AI 自动生成 9 张不同表情的图片</FeatureItem>
      <FeatureItem>支持选择图像模型，逐张串行生成避免 API 限流</FeatureItem>
      <FeatureItem>每张图可独立重新生成，不满意可以单独重试</FeatureItem>
      <FeatureItem>快速模板：猫咪、柴犬、兔子、熊猫等预设角色</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"表情"按钮</FeatureItem>
    </div>
  );
}

function FontDesignSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">字境大师</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        AI 字体设计工具，支持黑金 / 单色双主题，左右分栏操作。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>输入文字内容，AI 自动生成创意字体设计</FeatureItem>
      <FeatureItem>风格库：多种预设风格可选</FeatureItem>
      <FeatureItem>提示词模式：完整版 / 精简版 / 增强版 / 黑底白字 / 透明 Logo</FeatureItem>
      <FeatureItem>异步提交 + 轮询，支持多种图像模型</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"字境"按钮</FeatureItem>
    </div>
  );
}

function NodeEditorSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">工作流节点模式</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        基于 DAG 拓扑排序的可视化工作流编排系统，支持自然语言建图、连线语义类型、节点间数据传递。
      </p>
      <SubTitle>核心功能</SubTitle>
      <FeatureItem>AI 自然语言建图：输入描述 → 自动生成完整节点图</FeatureItem>
      <FeatureItem>连线语义类型：prompt / image / reference / mask，端口类型约束</FeatureItem>
      <FeatureItem>节点间数据传递：上游 output 自动流入下游 input</FeatureItem>
      <FeatureItem>@图片引用：提示词中输入 @ 插入画布图片</FeatureItem>
      <FeatureItem>30+ 节点类型：输入、AI 图像、AI 视频、控制、输出五大类</FeatureItem>
      <SubTitle>增强功能</SubTitle>
      <FeatureItem>8 种专业预设工作流模板，一键加载</FeatureItem>
      <FeatureItem>素材库系统：双层（本地 + 服务器）管理，分类筛选</FeatureItem>
      <FeatureItem>提示词库：CRUD + 标签管理 + 一键填入节点</FeatureItem>
      <FeatureItem>画布助手：节点感知，自动读取上游上下文</FeatureItem>
      <FeatureItem>撤销重做：50 步历史栈，<KeyBadge>Ctrl+Z</KeyBadge> / <KeyBadge>Ctrl+Shift+Z</KeyBadge></FeatureItem>
      <FeatureItem>ComfyUI 工作流导入：支持前端格式和 API 格式</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"节点"按钮</FeatureItem>
    </div>
  );
}

function SceneStudioSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">3D 构图</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        AI 驱动的 3D 场景搭建工具，支持自动布景、模型选择、场景生成等功能。
      </p>
      <SubTitle>功能 Tab</SubTitle>
      <FeatureItem>搭建：3D 模型库浏览与基础搭建操作</FeatureItem>
      <FeatureItem>生成：基于 3D 场景截图，AI 生成高质量渲染图</FeatureItem>
      <FeatureItem>布景：AI 自动布景，输入场景描述一键生成 3D 场景布局</FeatureItem>
      <FeatureItem>资产：场景资产管理和模板选择</FeatureItem>
      <SubTitle>生成功能</SubTitle>
      <FeatureItem>选择图像模型，基于当前 3D 场景截图生成渲染图</FeatureItem>
      <FeatureItem>支持自定义提示词描述生成效果</FeatureItem>
      <SubTitle>AI 布景</SubTitle>
      <FeatureItem>选择 LLM 模型，输入场景描述一键生成布局</FeatureItem>
      <FeatureItem>快速模板：品牌快闪店 / 产品展台 / 便利店 / 美妆柜台 / 科技展位 / 食品货架</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"3D"按钮</FeatureItem>
    </div>
  );
}

function Display3DSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">3D 展陈系统 Pro</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        基于 AI 图像模型的商业级 3D 展陈空间效果图生成工具，支持方案拆解、尺寸标注、材质工艺、BOM 清单等多维度输出。
      </p>
      <SubTitle>操作流程</SubTitle>
      <FeatureItem>品牌与产品：填写品牌名称（必填）和产品名称，品牌名会融入效果图的门头与导视</FeatureItem>
      <FeatureItem>资产上传：上传品牌素材（主视觉KV、Logo、IP形象等），AI 参考素材风格生成展陈图</FeatureItem>
      <FeatureItem>渲染与展示模式：选择效果图风格（实时渲染/照片级/线框/概念等）</FeatureItem>
      <FeatureItem>图像使用模式：定义上传图片的使用方式（贴图应用/风格延展/结构参考）</FeatureItem>
      <FeatureItem>场景设置：选择展陈类型（快闪店/展位/堆头/橱窗/打卡装置等）和空间尺寸</FeatureItem>
      <FeatureItem>环境与尺寸：设定场地环境、预算、材质风格、灯光氛围、人群氛围</FeatureItem>
      <FeatureItem>输出视角：选择效果图视角（正面/45度/侧面/俯视/入口/细节）</FeatureItem>
      <FeatureItem>输出设置：设定分辨率、格式和质量</FeatureItem>
      <FeatureItem>点击底部"生成展陈方案"按钮开始生成</FeatureItem>
      <SubTitle>右侧预览区</SubTitle>
      <FeatureItem>效果图：查看生成的主效果图，点击可添加到画布</FeatureItem>
      <FeatureItem>多角度：不同视角的效果图展示</FeatureItem>
      <FeatureItem>方案拆解：AI 分析展陈空间的结构组件、尺寸、材质</FeatureItem>
      <FeatureItem>尺寸标注：标注展陈各部件的尺寸信息</FeatureItem>
      <FeatureItem>材质工艺：推荐各部件的材质与制作工艺</FeatureItem>
      <FeatureItem>平面拆解图：俯视平面布局方案图</FeatureItem>
      <FeatureItem>物料清单BOM：展陈所需的物料清单及预算估算</FeatureItem>
      <SubTitle>导出功能</SubTitle>
      <FeatureItem>导出PDF：将效果图+拆解方案导出为PDF文档</FeatureItem>
      <FeatureItem>导出BOM：将物料清单导出为CSV表格</FeatureItem>
      <FeatureItem>发送到画布：将效果图发送到无限画布进行后续编辑</FeatureItem>
      <SubTitle>注意事项</SubTitle>
      <FeatureItem>AI 效果图不是施工图，尺寸为建议尺寸，落地需设计师/制作方/结构工程师复核</FeatureItem>
      <FeatureItem>品牌名称为必填项，会体现在效果图的门头和品牌标识上</FeatureItem>
      <FeatureItem>上传资产越丰富（KV、Logo、IP形象），生成效果越贴合品牌</FeatureItem>
      <FeatureItem>需要管理员后台配置可用的图像模型才能生成效果图</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"展陈"按钮</FeatureItem>
      <FeatureItem>右键菜单"3D展陈"</FeatureItem>
    </div>
  );
}

function ChatSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">AI 聊天</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        支持管理员配置的任意 LLM 模型，Agent 联网思考模式，支持图像理解与提示词优化。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>多模型选择：管理员配置的聊天模型列表</FeatureItem>
      <FeatureItem>图像理解：发送图片让 AI 分析内容</FeatureItem>
      <FeatureItem>提示词优化：增强 / 扩展 / 精简三种模式，优化结果可一键发送到图像生成面板</FeatureItem>
      <FeatureItem>Skills 系统：21 个预设 Skill（图像 / 设计 / 品牌 / 编辑 / 社交），对话经验沉淀为可复用工作流</FeatureItem>
      <FeatureItem>模糊意图追问：AI 自动判断意图清晰度，主动追问或补全</FeatureItem>
      <FeatureItem>生成后引导：AI 回复末尾推荐后续操作（图生图 / 修图 / 放大等）</FeatureItem>
      <FeatureItem>@引用系统：输入 @ 触发引用菜单（@图片 / @品牌 / @模型 / @提示词）</FeatureItem>
      <FeatureItem>Tab 模式：选中画布图片后自动切换为"针对此图片"模式</FeatureItem>
    </div>
  );
}

function ProjectSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">项目管理</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        支持多项目管理，每个项目独立保存画布内容，数据自动同步到服务器。
      </p>
      <FeatureItem>新建 / 切换 / 删除项目</FeatureItem>
      <FeatureItem>项目数据自动保存到服务器数据库（2 秒防抖）</FeatureItem>
      <FeatureItem>登录时自动从服务器恢复项目数据</FeatureItem>
      <FeatureItem>localStorage 独立兜底机制，确保数据不丢失</FeatureItem>
      <FeatureItem>用户数据支持分组管理（groupId）</FeatureItem>
    </div>
  );
}

function AdminSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">管理员系统</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        管理员专属后台，配置 API 提供商、用户权限、系统设置。数据持久化到 PostgreSQL 数据库。
      </p>
      <SubTitle>API 提供商管理</SubTitle>
      <FeatureItem>5 种模型类型：图像模型 / LLM 模型 / 3D 模型 / 矢量模型 / 图片分层模型</FeatureItem>
      <FeatureItem>添加 API 后自动识别模型列表，管理员手动选择启用的模型</FeatureItem>
      <FeatureItem>全选 / 取消全选快捷操作</FeatureItem>
      <FeatureItem>测试连接 + API 协议验证（一键检测端点兼容性）</FeatureItem>
      <FeatureItem>API 用量分析和余额显示</FeatureItem>
      <SubTitle>用户管理</SubTitle>
      <FeatureItem>用户创建 / 编辑 / 启用禁用</FeatureItem>
      <FeatureItem>API 权限分配</FeatureItem>
      <SubTitle>任务管理</SubTitle>
      <FeatureItem>每用户最大 15 个并发任务，超额自动排队</FeatureItem>
      <FeatureItem>全局 500 任务上限，30 分钟自动清理过期任务</FeatureItem>
      <FeatureItem>任务支持 SSE 实时进度推送 + 轮询兜底</FeatureItem>
      <FeatureItem>支持任务取消（擦除/蒙版/放大/生成等所有异步任务）</FeatureItem>
      <SubTitle>协议兼容</SubTitle>
      <FeatureItem>6 种协议档案：openai / openai-async / apimart / pearapi / gemini-image / auto</FeatureItem>
      <FeatureItem>高级参数自定义（compatProfile / pollPathTemplate 等）</FeatureItem>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">快捷键</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
        <FeatureItem><KeyBadge>Ctrl+Z</KeyBadge> 撤回操作</FeatureItem>
        <FeatureItem><KeyBadge>Ctrl+Shift+Z</KeyBadge> 重做（节点模式）</FeatureItem>
        <FeatureItem><KeyBadge>Delete</KeyBadge> 删除选中图片</FeatureItem>
        <FeatureItem><KeyBadge>ESC</KeyBadge> 退出编辑 / 取消选择</FeatureItem>
        <FeatureItem><KeyBadge>空格+拖动</KeyBadge> 抓手工具平移画布</FeatureItem>
        <FeatureItem><KeyBadge>Ctrl+点击</KeyBadge> 多选图片</FeatureItem>
        <FeatureItem><KeyBadge>Ctrl+C/V</KeyBadge> 复制粘贴节点（节点模式）</FeatureItem>
        <FeatureItem><KeyBadge>滚轮</KeyBadge> 缩放画布</FeatureItem>
      </div>
    </div>
  );
}

function TipsSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">使用技巧</h3>
      <FeatureItem>上传图片会自动压缩（超过 4MB 或 2048px 自动缩放），减少带宽占用</FeatureItem>
      <FeatureItem>无透明通道需求的 PNG 会自动转 JPEG 保存，节省存储空间（有透明需求的绝不可转）</FeatureItem>
      <FeatureItem>图生图生成比例自动与原图一致，无需手动设置</FeatureItem>
      <FeatureItem>擦除/蒙版/扩展等编辑操作，除扩展和裁切外均保持原图比例</FeatureItem>
      <FeatureItem>移除背景同时输出透明图和蒙版图，蒙版图可手动精修</FeatureItem>
      <FeatureItem>扩展功能自动回退不支持精确编辑的模型（如 Gemini 图像模型），选择支持 /images/edits 的模型</FeatureItem>
      <FeatureItem>精修引擎支持所有管理员配置的图像模型，不同供应商的模型可切换选择</FeatureItem>
      <FeatureItem>工作流节点模式支持 @图片引用，直接插入画布中的图片</FeatureItem>
      <FeatureItem>3D 构图支持图像模型和 LLM 模型独立选择，生成和布景分别使用不同模型</FeatureItem>
      <FeatureItem>API 协议自动推断：根据 URL 特征匹配协议档案，也支持手动指定</FeatureItem>
      <FeatureItem>任务并发控制：每用户最多 15 个并发任务，超额自动排队等待，不会丢失</FeatureItem>
      <FeatureItem>任务失败或过期会自动提示，不会无限等待（poll-task 对不存在任务返回 failed）</FeatureItem>
      <FeatureItem>不支持蒙版的模型使用擦除/蒙版功能时，系统会自动提示蒙版将被忽略</FeatureItem>
    </div>
  );
}

function VideoSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">视频生成</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        支持 20+ 视频模型的视频生成与编辑功能，6 种 API 协议自动适配。
      </p>
      <SubTitle>生成模式</SubTitle>
      <FeatureItem>文生视频：纯文字描述生成视频，支持画面比例 / 时长 / 质量选择</FeatureItem>
      <FeatureItem>图生视频 - 首帧驱动：上传首帧图片，AI 生成后续视频内容</FeatureItem>
      <FeatureItem>图生视频 - 首尾帧驱动：上传首帧 + 尾帧图片，AI 生成中间过渡</FeatureItem>
      <FeatureItem>图生视频 - 多参考图：上传多张参考图，AI 综合参考生成</FeatureItem>
      <SubTitle>视频编辑</SubTitle>
      <FeatureItem>视频延长：在现有视频末尾继续生成内容（支持可灵 V3 / Seedance 等）</FeatureItem>
      <FeatureItem>音效生成：生成视频时可选同时生成音效</FeatureItem>
      <FeatureItem>视频播放器：黑金主题，进度条 / 音量 / 倍速（0.5x ~ 2x） / 全屏</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>右侧面板图像 / 视频 Tab 切换到视频生成</FeatureItem>
      <FeatureItem>画布右键菜单"视频编辑" / "视频延长"</FeatureItem>
      <FeatureItem>视频图片点击播放按钮覆盖层</FeatureItem>
    </div>
  );
}

function LogoProSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">Logo 生成器 Pro</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        3 步式专业 Logo 设计工具，从方向选择到最终生成，支持多种风格和颜色方案。
      </p>
      <SubTitle>设计流程</SubTitle>
      <FeatureItem>Step 1 - 方向：输入品牌名称和描述，选择设计方向（极简 / 字母标志 / 图标 / 吉祥物 / 徽章 / 排版）</FeatureItem>
      <FeatureItem>Step 2 - 风格：选择风格预设和配色方案，自定义设计细节</FeatureItem>
      <FeatureItem>Step 3 - 生成：AI 生成多款 Logo 方案，支持下载 PNG</FeatureItem>
      <SubTitle>功能特点</SubTitle>
      <FeatureItem>6 种设计方向 + 多种风格预设</FeatureItem>
      <FeatureItem>8 种配色方案（单色 / 双色 / 渐变 / 金属 / 霓虹 / 水彩 / 几何 / 自然）</FeatureItem>
      <FeatureItem>黑金主题浮动面板，支持缩小 / 拖动</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"Logo"按钮</FeatureItem>
    </div>
  );
}

function BrandFactorySection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">品牌工厂</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        BrandDNA 品牌规范定义 + 品牌视觉套图生成，一站式品牌视觉资产管理。
      </p>
      <SubTitle>BrandDNA 定义</SubTitle>
      <FeatureItem>品牌名称 / 品牌口号 / 品牌调性描述</FeatureItem>
      <FeatureItem>品牌色彩（主色 / 辅助色 / 强调色）</FeatureItem>
      <FeatureItem>字体偏好 / 禁区规则</FeatureItem>
      <SubTitle>视觉套图生成</SubTitle>
      <FeatureItem>基于 BrandDNA 自动生成品牌视觉套图</FeatureItem>
      <FeatureItem>支持多种场景：品牌主视觉 / 海报 / 社交媒体 / 包装等</FeatureItem>
      <FeatureItem>生成的图片自动注入品牌色彩和调性</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"品牌"按钮</FeatureItem>
    </div>
  );
}

function BrandEcommerceSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">品牌电商</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        电商模板套图批量生成，自动适配主图 / 详情页 / 海报等多种电商场景。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>选择电商模板类型（主图 / 详情页 / 海报 / 直播封面等）</FeatureItem>
      <FeatureItem>输入商品信息和描述，AI 自动生成适配模板的图片</FeatureItem>
      <FeatureItem>支持品牌工厂 BrandDNA 注入，保持品牌一致性</FeatureItem>
      <FeatureItem>批量生成，一次产出多张不同角度的电商图</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"电商"按钮</FeatureItem>
    </div>
  );
}

function AiPsdSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">AI PSD 生成器</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        AI 生成图片并自动导出 PSD，支持多种导出模式，便于后续 Photoshop 编辑。
      </p>
      <SubTitle>PSD 导出模式</SubTitle>
      <FeatureItem>Basic：原图层 + 白色背景 + 注释层（安全快速）</FeatureItem>
      <FeatureItem>Pro：背景移除 + 连通域前景分析 + 语义图层命名 + 背景重建 + XMP 元数据</FeatureItem>
      <FeatureItem>Studio：所有 Pro 功能 + 阴影估算 + 语义分组 + 质量评分 + 完整 V4 清单</FeatureItem>
      <SubTitle>功能</SubTitle>
      <FeatureItem>选择图像模型，输入提示词生成图片</FeatureItem>
      <FeatureItem>自动分层导出 PSD，V4 规范图层命名（bg/main, subject/{'{idx}'}/{'{label}'} 等）</FeatureItem>
      <FeatureItem>使用 ag-psd 确保 Photoshop 兼容性</FeatureItem>
      <SubTitle>入口</SubTitle>
      <FeatureItem>底部工具栏"PSD"按钮</FeatureItem>
    </div>
  );
}

function ChangelogSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">更新内容</h3>

      <SubTitle>v3.4.0</SubTitle>
      <FeatureItem>API 错误中文翻译：9 类错误码结构化翻译，友好提示+建议+是否可重试</FeatureItem>
      <FeatureItem>尺寸自动修复：检测 Invalid Size 错误后自动修正为 16 对齐合法尺寸</FeatureItem>
      <FeatureItem>Responses API SSE 保活：解决 Cloudflare 524/504 超时断连，Feature Flag 控制自动降级</FeatureItem>
      <FeatureItem>智能重试引擎：CF 超时同模型重试 3 次+指数退避，Partial Image 兜底保存半成品</FeatureItem>
      <FeatureItem>零风险设计：纯增量改造，不修改现有函数签名，降级路径完整</FeatureItem>

      <SubTitle>v3.3.0</SubTitle>
      <FeatureItem>任务并发控制：每用户最大 15 个并发任务，全局 500 任务上限，30 分钟自动清理</FeatureItem>
      <FeatureItem>任务队列管理：超额任务自动排队，支持查询排队位置</FeatureItem>
      <FeatureItem>修复：视频编辑/延长任务 ID 解析错误导致生成失败</FeatureItem>
      <FeatureItem>修复：品牌工厂批量生成 API 参数不匹配导致 400 错误</FeatureItem>
      <FeatureItem>修复：视频编辑面板未传递模型和提供商信息</FeatureItem>
      <FeatureItem>修复：poll-task 对不存在任务返回 processing 导致前端无限轮询</FeatureItem>
      <FeatureItem>修复：聊天面板 SSE 流式解析跨 chunk JSON 断裂</FeatureItem>
      <FeatureItem>修复：图像生成/精修引擎缺少 HTTP 状态码检查</FeatureItem>
      <FeatureItem>修复：品牌包装/3D 展陈添加图片到画布缺少模型信息</FeatureItem>
      <FeatureItem>修复：品牌电商重新生成缺少模型提供商参数</FeatureItem>
      <FeatureItem>修复：前端向图片编辑 API 传递 apiKey 安全隐患</FeatureItem>
      <FeatureItem>修复：擦除模式 AI 路径空提示词导致生成质量差</FeatureItem>
      <FeatureItem>修复：不支持蒙版的模型静默丢弃蒙版未提示用户</FeatureItem>
      <FeatureItem>修复：视频生成缺少高级参数传递（运镜/运动强度等）</FeatureItem>
      <FeatureItem>修复：视频延长 API 同步完成场景未处理</FeatureItem>
      <FeatureItem>修复：工作流轮询无上限可能导致无限轮询（添加 300 次上限）</FeatureItem>
      <FeatureItem>修复：语言修图 /images/edits 超时 15s → 30s</FeatureItem>

      <SubTitle>v3.2.0</SubTitle>
      <FeatureItem>视频生成核心功能：6 种视频 API 协议适配层，20+ 视频模型注册表</FeatureItem>
      <FeatureItem>文生视频 / 图生视频（首帧驱动 / 首尾帧驱动 / 多参考图）三种模式</FeatureItem>
      <FeatureItem>视频延长：基于可灵 V3 / Seedance 等模型延长视频</FeatureItem>
      <FeatureItem>音效生成：部分模型支持生成视频时同时生成音效</FeatureItem>
      <FeatureItem>视频播放器：黑金主题，进度条 / 音量 / 倍速 / 全屏</FeatureItem>
      <FeatureItem>视频编辑面板：语言编辑 + 视频延长双 Tab，黑金 / 单色双主题</FeatureItem>
      <FeatureItem>Logo 生成器 Pro：3 步式 Logo 设计（方向 → 风格 → 生成），支持下载</FeatureItem>
      <FeatureItem>品牌工厂：BrandDNA 品牌规范定义 + 品牌视觉套图生成</FeatureItem>
      <FeatureItem>品牌电商：电商模板套图批量生成（主图 / 详情页 / 海报等）</FeatureItem>
      <FeatureItem>AI PSD 生成器：AI 生成 + PSD 导出，支持 Basic / Pro / Studio 三种模式</FeatureItem>
      <FeatureItem>充值系统修复：套餐点击 / 自定义充值 / 演示模式充值完成</FeatureItem>
      <FeatureItem>数据隔离修复：普通用户 / 管理员数据完全隔离，跨用户项目清理</FeatureItem>
      <FeatureItem>工作流新增 3 个视频节点类型：ai-video-generate / ai-video-i2v / output-video</FeatureItem>
      <FeatureItem>Agent 编排注册视频工具：generate_video / extend_video</FeatureItem>

      <SubTitle>v3.1.0</SubTitle>
      <FeatureItem>修复：扩展命令在 gemini-image 协议模型上自动回退到支持编辑的模型</FeatureItem>
      <FeatureItem>修复：精修引擎多供应商同名模型点击后显示错误</FeatureItem>
      <FeatureItem>修复：表情助手生图全部失败（串行生成防限流 + 错误处理改进）</FeatureItem>
      <FeatureItem>修复：3D 构图功能右侧面板不可用（后端 API 重写 + 前端模型选择器）</FeatureItem>
      <FeatureItem>新增：3D 构图功能支持图像模型和 LLM 模型独立选择</FeatureItem>
      <FeatureItem>新增：精修引擎、表情助手使用 providerId::modelId 格式区分不同供应商模型</FeatureItem>

      <SubTitle>v3.0.0</SubTitle>
      <FeatureItem>SVG 智能描摹全面升级：VTracer 预处理管道 + AI SVG 提示词工程</FeatureItem>
      <FeatureItem>移除背景边缘修复：边缘颜色混合修复，消除抠图锯齿和色差</FeatureItem>
      <FeatureItem>26+ 模型参数适配：完整重写 MODEL_QUALITIES 和 MODEL_PIXEL_SIZES</FeatureItem>
      <FeatureItem>任务基础设施升级：task-registry + SSE 推送 + 任务取消 + 队列管理</FeatureItem>
      <FeatureItem>Agent 编排引擎：工具注册表 + Agent 循环 + 多轮决策</FeatureItem>
      <FeatureItem>IOPaint 本地集成：多模型擦除 + RemoveBG（3 模型）</FeatureItem>

      <SubTitle>v2.9.0</SubTitle>
      <FeatureItem>RemoveBG 同时输出透明背景图 + 黑白蒙版图</FeatureItem>
      <FeatureItem>任务注册中心 + API 协议验证 + Agent 编排引擎</FeatureItem>

      <SubTitle>v2.8.0</SubTitle>
      <FeatureItem>SVG 智能描摹 / 语言修图 / 擦除 & 蒙版 AI 增强 / API 兼容层升级</FeatureItem>

      <SubTitle>v2.6.0</SubTitle>
      <FeatureItem>数据库持久化存储：PostgreSQL + 双写策略 + API 兼容性修复</FeatureItem>

      <SubTitle>v2.5.0</SubTitle>
      <FeatureItem>参考图与图生图类别统一 / 工具栏功能优化 / 管理员 5 种模型类型</FeatureItem>

      <SubTitle>v2.3.0</SubTitle>
      <FeatureItem>图生图功能：黑金配色浮动面板 + 四个参考类别</FeatureItem>
    </div>
  );
}

// ─── Section Content Map ────────────────────────────────────────

const SECTION_CONTENT: Record<SectionId, React.ReactNode> = {
  'canvas': <CanvasSection />,
  'generate': <GenerateSection />,
  'img2img': <Img2ImgSection />,
  'video': <VideoSection />,
  'chat': <ChatSection />,
  'tools': <ToolsSection />,
  'svg-trace': <SvgTraceSection />,
  'lang-edit': <LangEditSection />,
  'agent-edit': <AgentEditSection />,
  'refine-engine': <RefineEngineSection />,
  'sticker': <StickerSection />,
  'font-design': <FontDesignSection />,
  'logo-pro': <LogoProSection />,
  'brand-factory': <BrandFactorySection />,
  'brand-ecommerce': <BrandEcommerceSection />,
  'node-editor': <NodeEditorSection />,
  'scene-studio': <SceneStudioSection />,
  'display3d': <Display3DSection />,
  'ai-psd': <AiPsdSection />,
  'project': <ProjectSection />,
  'admin': <AdminSection />,
  'shortcuts': <ShortcutsSection />,
  'tips': <TipsSection />,
  'changelog': <ChangelogSection />,
};

// ─── Main Component ─────────────────────────────────────────────

interface HelpGuideProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: SectionId;
  themeStyle?: string;
}

export function HelpGuide({ isOpen, onClose, initialSection = 'canvas', themeStyle }: HelpGuideProps) {
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);

  if (!isOpen) return null;

  const groups = ['使用说明', '更新内容'] as const;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[680px] max-h-[80vh] bg-[var(--color-surface)] rounded-xl border border-[var(--color-outline-variant)] shadow-2xl flex flex-col overflow-hidden"
        data-modal>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-outline-variant)]">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold text-[var(--color-on-surface)]">使用说明</span>
            <span className="text-[10px] text-[var(--color-on-surface-variant)] ml-1">{APP_VERSION_LABEL}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--color-surface-container)] transition-colors">
            <X size={16} className="text-[var(--color-on-surface-variant)]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[180px] border-r border-[var(--color-outline-variant)] overflow-y-auto py-2 shrink-0">
            {groups.map(group => (
              <div key={group}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase tracking-wider">
                  {group}
                </div>
                {SECTIONS.filter(s => s.group === group).map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                      activeSection === section.id
                        ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                        : 'text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-container)]'
                    }`}
                  >
                    {section.icon}
                    {section.label}
                    {activeSection === section.id && <ChevronRight size={12} className="ml-auto" />}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {SECTION_CONTENT[activeSection]}
          </div>
        </div>
      </div>
    </div>
  );
}
