'use client';

import { useState } from 'react';
import {
  Move, Sparkles, MessageSquare, Layers, Keyboard, Lightbulb,
  BookOpen, X, Info, Pen, Wand2, ImagePlus, GitMerge, ImageIcon,
  ZoomIn, Eraser, Maximize, Download, Shapes, Settings, Database,
  FileBox, ChevronRight, Check, PenTool, Pencil, Box, Type,
  LayoutGrid, Bot, Palette, FolderOpen
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@/config/app-meta';

// ─── Types ──────────────────────────────────────────────────────

type SectionId = 'canvas' | 'generate' | 'img2img' | 'chat' | 'tools'
  | 'svg-trace' | 'lang-edit' | 'agent-edit' | 'refine-engine' | 'sticker'
  | 'font-design' | 'node-editor' | 'scene-studio' | 'project' | 'admin'
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
  { id: 'tools', label: '图片编辑工具', icon: <Pencil size={14} />, group: '使用说明' },
  { id: 'svg-trace', label: 'SVG 智能描摹', icon: <PenTool size={14} />, group: '使用说明' },
  { id: 'lang-edit', label: '语言修图', icon: <Wand2 size={14} />, group: '使用说明' },
  { id: 'agent-edit', label: 'Agent 编排', icon: <Bot size={14} />, group: '使用说明' },
  { id: 'refine-engine', label: '精修引擎', icon: <Palette size={14} />, group: '使用说明' },
  { id: 'sticker', label: '表情助手', icon: <Shapes size={14} />, group: '使用说明' },
  { id: 'font-design', label: '字境大师', icon: <Type size={14} />, group: '使用说明' },
  { id: 'node-editor', label: '工作流节点模式', icon: <GitMerge size={14} />, group: '使用说明' },
  { id: 'scene-studio', label: '3D 构图', icon: <Box size={14} />, group: '使用说明' },
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
        核心操作区域，支持图片拖拽、缩放、多选、框选、编辑等丰富交互。
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
      <FeatureItem>选择工具（鼠标指针）/ 平移工具（手掌）</FeatureItem>
      <FeatureItem>上传图片 / 放大 / 缩小 / 缩放百分比 / 重置视图</FeatureItem>
      <SubTitle>图片操作工具栏（选中图片后顶部显示）</SubTitle>
      <FeatureItem>放大、移除背景、SVG 描摹、擦除、蒙版、编辑元素</FeatureItem>
      <FeatureItem>扩展画面、图生图、裁切、下载（PNG / SVG / PSD）</FeatureItem>
      <SubTitle>下载格式</SubTitle>
      <FeatureItem>PSD：Basic（原图 + 注释）/ Pro（前景背景分离 + 重建）/ Studio（语义命名 + 阴影 + JSON 元数据）</FeatureItem>
      <FeatureItem>SVG：Fast（快速）/ Pro（优化）/ Studio（精细）</FeatureItem>
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
      <FeatureItem>27+ 节点类型：输入、AI 图像、控制、输出四大类</FeatureItem>
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

function ChatSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">AI 聊天</h3>
      <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
        支持管理员配置的任意 LLM 模型，Agent 联网思考模式，支持图像理解。
      </p>
      <SubTitle>功能</SubTitle>
      <FeatureItem>多模型选择：管理员配置的聊天模型列表</FeatureItem>
      <FeatureItem>图像理解：发送图片让 AI 分析内容</FeatureItem>
      <FeatureItem>提示词优化：增强 / 扩展 / 精简三种模式，优化结果可一键发送到图像生成面板</FeatureItem>
      <FeatureItem>优化历史记录，支持快速复用</FeatureItem>
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
    </div>
  );
}

function ChangelogSection() {
  return (
    <div>
      <h3 className="text-sm font-bold text-[var(--color-on-surface)] mb-2">更新内容</h3>

      <SubTitle>v3.1.0</SubTitle>
      <FeatureItem>修复：扩展命令在 gemini-image 协议模型上自动回退到支持编辑的模型，不再变形或不出图</FeatureItem>
      <FeatureItem>修复：精修引擎 4sapi / pearapi 模型无法生图（images[].image_url 格式适配）</FeatureItem>
      <FeatureItem>修复：精修引擎模型选择列表多供应商同名模型点击后显示错误（providerId 区分）</FeatureItem>
      <FeatureItem>修复：表情助手生图全部失败（串行生成防限流 + 错误处理改进）</FeatureItem>
      <FeatureItem>修复：3D 构图功能右侧面板不可用（后端 API 重写 + 前端模型选择器）</FeatureItem>
      <FeatureItem>修复：submitImageTask 对 gemini-image 协议的请求体转换（扩展/擦除/蒙版等编辑操作）</FeatureItem>
      <FeatureItem>修复：adjustRequestForProfile 图片格式转换（image/image_urls → images[].image_url）</FeatureItem>
      <FeatureItem>新增：3D 构图功能支持图像模型和 LLM 模型独立选择</FeatureItem>
      <FeatureItem>新增：精修引擎、表情助手使用 providerId::modelId 格式区分不同供应商的同名模型</FeatureItem>

      <SubTitle>v3.0.0</SubTitle>
      <FeatureItem>SVG 智能描摹全面升级：VTracer 预处理管道 + AI SVG 提示词工程 + 安全过滤 + 标准化</FeatureItem>
      <FeatureItem>移除背景边缘修复：边缘颜色混合修复，消除抠图锯齿和色差</FeatureItem>
      <FeatureItem>放大超时修复 + 任务注册：放大异步任务注册到 task-registry</FeatureItem>
      <FeatureItem>26+ 模型参数适配：完整重写 MODEL_QUALITIES 和 MODEL_PIXEL_SIZES</FeatureItem>
      <FeatureItem>节点模式与画布模式对齐：模型名称友好显示 + 质量/比例动态更新</FeatureItem>
      <FeatureItem>AI 图像编辑模型默认对齐：工具栏工具统一使用图像生成面板当前模型</FeatureItem>
      <FeatureItem>任务基础设施升级：task-registry + SSE 推送 + 任务取消 + 队列管理</FeatureItem>
      <FeatureItem>RemoveBG 同时输出透明图 + 黑白蒙版图</FeatureItem>
      <FeatureItem>图片压缩上传：前端 canvas 压缩 + 后端 sharp 压缩</FeatureItem>
      <FeatureItem>API 协议验证：管理员面板一键验证提供商协议兼容性</FeatureItem>
      <FeatureItem>Agent 编排引擎：工具注册表 + Agent 循环 + 多轮决策</FeatureItem>
      <FeatureItem>IOPaint 本地集成：多模型擦除（LaMa / ZITS / Anime-Lama）+ RemoveBG（3 模型）</FeatureItem>
      <FeatureItem>PNG→JPEG 自动转换：无透明需求时自动压缩（有透明需求绝不转换）</FeatureItem>
      <FeatureItem>画布缩略图清晰度优化：THUMBNAIL_MAX 1280px + zoom 感知动态切换</FeatureItem>

      <SubTitle>v2.9.0</SubTitle>
      <FeatureItem>RemoveBG 同时输出透明背景图 + 黑白蒙版图</FeatureItem>
      <FeatureItem>任务注册中心：统一任务管理、SSE 推送、取消、队列</FeatureItem>
      <FeatureItem>图片压缩上传：前端 canvas 压缩 + 后端 sharp 压缩</FeatureItem>
      <FeatureItem>API 协议验证 + 任务队列 + Agent 编排引擎</FeatureItem>
      <FeatureItem>IOPaint 本地集成：多模型擦除 + RemoveBG</FeatureItem>

      <SubTitle>v2.8.0</SubTitle>
      <FeatureItem>SVG 智能描摹：彩色 + 黑白双模式，多级质量预设</FeatureItem>
      <FeatureItem>语言修图：OpenAI + Gemini 双提供商支持</FeatureItem>
      <FeatureItem>擦除功能 AI 增强：AI 模型优先 + BFS 兜底</FeatureItem>
      <FeatureItem>蒙版修图 AI 增强：AI 生成 + 后端精确蒙版合成</FeatureItem>
      <FeatureItem>API 兼容层升级：通用多提供商适配</FeatureItem>

      <SubTitle>v2.7.0</SubTitle>
      <FeatureItem>客户端数据服务器同步</FeatureItem>
      <FeatureItem>z-index 层级规范</FeatureItem>
      <FeatureItem>组数据持久化修复</FeatureItem>

      <SubTitle>v2.6.0</SubTitle>
      <FeatureItem>数据库持久化存储：PostgreSQL + 双写策略</FeatureItem>
      <FeatureItem>API 兼容性修复：fetchWithV1Retry</FeatureItem>

      <SubTitle>v2.5.0</SubTitle>
      <FeatureItem>参考图与图生图类别统一（6 大类）</FeatureItem>
      <FeatureItem>工具栏功能优化：放大/移除背景/擦除/蒙版/扩展语义更新</FeatureItem>
      <FeatureItem>管理员系统增强：5 种模型类型 + API 用量分析</FeatureItem>

      <SubTitle>v2.4.0</SubTitle>
      <FeatureItem>服务器端 API 密钥管理</FeatureItem>
      <FeatureItem>移除前端 API Key 输入框，模型列表从服务器加载</FeatureItem>

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
  'chat': <ChatSection />,
  'tools': <ToolsSection />,
  'svg-trace': <SvgTraceSection />,
  'lang-edit': <LangEditSection />,
  'agent-edit': <AgentEditSection />,
  'refine-engine': <RefineEngineSection />,
  'sticker': <StickerSection />,
  'font-design': <FontDesignSection />,
  'node-editor': <NodeEditorSection />,
  'scene-studio': <SceneStudioSection />,
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
