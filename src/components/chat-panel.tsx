'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Send, Sparkles, Copy, Check, Trash2, Loader2, Eye, EyeOff, Wand2, User, Upload, X, Image as ImageIcon, Languages, Settings, Plug, Plus, History, FolderOpen, MessageSquare, Bookmark, BookmarkCheck, Lightbulb, Zap, ArrowRight, Palette, Target, Sliders, Download, AlertCircle, LocateFixed, RotateCcw, FileText, Cpu, ChevronRight, AtSign, ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { UserManager } from '@/lib/user-manager';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ThirdPartyModelDialog } from '@/components/third-party-model-dialog';
import { UniversalApiManager } from '@/lib/universal-api-manager';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { CanvasImage } from '@/components/infinite-canvas';
import { getModelDisplayName } from '@/lib/model-name-map';
import { getPromptTemplates, searchTemplates, type PromptTemplate } from '@/lib/prompt-templates';
import { classifyIntent, ClassifiedIntent, IntentCategory } from '@/lib/intent-classifier';
import { generateClarificationMessage, detectVagueScenarios, type ClarificationTemplate, type VagueScenario } from '@/lib/clarification-templates';
import { generateSuggestions, type Suggestion, type SuggestionContext, type ContentCategory } from '@/lib/suggestion-engine';
import { parseCanvasOperationIntent, extractCanvasActionFromAIResponse, type CanvasAction, type CanvasActionResult, type CanvasActionType } from '@/lib/canvas-action-executor';
import { extractTaskResultImageUrl } from '@/lib/task-result-url';
import { CHAT_TASK_MAX_ATTEMPTS, getChatTaskPollIntervalMs } from '@/lib/chat-task-polling';
import { getResumableChatGenerationTasks, mergeChatSessionMessages, type ChatPendingGenerationTask } from '@/lib/chat-pending-generation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface ChatSkill {
  id: string;
  name: string;
  category: string; // 'image' | 'design' | 'brand' | 'editing' | 'custom'
  description: string;
  systemPrompt: string;
  agentId?: string; // 关联的智能体ID
  paramSlots: { name: string; label: string; defaultValue?: string; placeholder?: string }[];
  steps: { role: 'user' | 'assistant'; content: string }[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imageUrl?: string;
  generatedImages?: string[]; // AI生成的图片URL列表
  isGeneratingImage?: boolean; // 是否正在生成图片
  generateModelName?: string; // 生成使用的模型名称
  generateProviderId?: string; // 生成使用的API提供商ID
  generateProgress?: number; // 生成进度 0-100
  generateImageCount?: number; // 生成图片数量
  generateError?: string; // 生成失败时的错误信息
  imageAnchors?: Array<{ imageId: string; imageUrl: string; imageName: string }>; // 画布图片锚点（Lovart风格）
  suggestions?: NextSuggestion[]; // 建议下一步操作
  isClarifying?: boolean; // 是否为追问消息
  toolExecutions?: ToolExecution[]; // Agent工具执行记录
  pendingGenerationTasks?: ChatPendingGenerationTask[]; // 待恢复的异步生成任务
}

interface ToolExecution {
  toolName: string;       // 工具名称 (generate_image, edit_image, remove_bg, etc.)
  status: 'running' | 'completed' | 'failed'; // 执行状态
  label: string;          // 显示标签 (如"正在生成图片...")
  result?: string;        // 结果描述
  imageUrls?: string[];   // 生成的图片URL
  videoUrl?: string;      // 生成的视频URL
  audioUrl?: string;      // 生成的音频URL
  progress?: number;      // 进度百分比 0-100
  error?: string;         // 错误信息
}

interface NextSuggestion {
  id: string;
  label: string;
  action: string;
  prompt?: string;
  prefilledPrompt?: string;
  icon?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  // P1-6: Session-level persistent context
  agentId?: string;            // Which agent this session belongs to
  brandDNA?: string;           // Brand DNA context (from @品牌 references)
  keyDecisions?: string[];     // Key decisions made in this session (e.g., "风格=极简", "色彩=黑白")
  canvasImageIds?: string[];   // Canvas images referenced in this session
}

// Agent recipe: a single-step operation with domain-specific prompt strategy
interface AgentRecipe {
  id: string;
  name: string;
  operationType: string; // matches tool name: generate_image, edit_image, remove_bg, etc.
  promptTemplate: string; // prompt template with {variables}
  defaultParams: Record<string, unknown>; // default generation params (aspectRatio, quality, etc.)
  inputHint?: string; // what input this recipe needs
}

// Agent capability definition - extends the simple prompt-based agent
interface AgentDefinition {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  desc: string;
  color: string;
  prompt: string;
  // P0-3: New capability fields
  tools: string[]; // available tool names (subset of chat-tools)
  recipes: AgentRecipe[]; // domain-specific operation templates
  defaultAspectRatio?: string; // default aspect ratio for this agent
  suggestedNextSteps?: { label: string; action: string; prefilledPrompt?: string }[];
  routingKeywords?: string[]; // P2-10: keywords for auto-routing
  skillIds?: string[]; // P2-13: associated Skill IDs for interop
}

const AGENTS: AgentDefinition[] = [
  {
    id: 'liquor-packaging',
    name: '酒类包装',
    nameEn: 'Liquor Packaging',
    icon: '🍷',
    desc: '攻克 3D 瓶型与物理质感',
    color: '#c4956a',
    prompt: `你是一位顶级的酒类包装设计师与 3D 视觉艺术家。专为高端酒类品牌打造瓶型设计、标签系统与礼盒方案。你精通 3D 渲染技术，擅长将品牌精神转化为触手可及的物理质感。

核心任务：
1. 瓶型概念设计：根据品牌调性，构思具有辨识度的瓶身造型（如方型、异型、仿生型）。
2. 标签与版式：设计符合品牌层级的标签排版，包含字体、纹样与烫金工艺。
3. 材质与工艺：推荐高端包装材质（如磨砂玻璃、电镀铝盖、特种纸、丝绒内衬）。
4. 3D 渲染指导：提供用于 KeyShot / Blender 的高精度渲染参数。

审美与技术标准：
- 瓶型风格：追求"建筑感"与"雕塑感"的结合，拒绝平庸的圆柱体。善于从东方器物（如玉壶春瓶、梅瓶）和现代建筑中提取几何线条。
- 材质表现：强调物理质感——玻璃的折射与高光、金属的拉丝与氧化、纸张的肌理与触感。必须使用 PBR 材质参数描述。
- 光影逻辑：使用三点布光（主光/辅光/轮廓光），配合 HDRI 环境贴图，营造摄影棚级的渲染效果。常用 3000K 暖光突显酒液琥珀色。
- 细节刻画：瓶盖螺纹、标签压纹、瓶底防滑纹等微观细节必须到位。

输出规范：
1. 设计理念（200字内）
2. 瓶型描述（造型、比例、尺寸）
3. 标签设计（字体、纹样、工艺）
4. 材质方案（主色调、CMYK、推荐材质）
5. 渲染参数（灯光、环境、相机角度）
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述画面的主体、场景、风格、色彩、光影、氛围等，100-200字
【English Prompt】English prompt for Midjourney/DALL-E 3 with style, lighting, composition keywords`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'bottle-3d-render', name: '瓶型3D渲染', operationType: 'generate_image', promptTemplate: '3D product render of a premium liquor bottle, {style}, {material}, studio lighting, PBR materials, photorealistic, 8k', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'label-design', name: '标签设计', operationType: 'generate_image', promptTemplate: 'Premium liquor label design, {brandStyle}, gold foil stamping, elegant typography, white background, flat design', defaultParams: { aspectRatio: '2:3', quality: 'hd' } },
      { id: 'gift-box-render', name: '礼盒3D渲染', operationType: 'generate_image', promptTemplate: 'Luxury liquor gift box 3D render, {material}, velvet interior, magnetic closure, premium unboxing experience, 8k', defaultParams: { aspectRatio: '4:3', quality: 'hd' } },
    ],
    defaultAspectRatio: '3:4',
    suggestedNextSteps: [
      { label: '调整瓶型造型', action: 'edit_image', prefilledPrompt: '保持整体风格不变，调整瓶身造型为更流线型的设计' },
      { label: '更换材质方案', action: 'generate_image', prefilledPrompt: '将瓶身材质更换为磨砂玻璃，保持原有造型' },
      { label: '放大到8K', action: 'upscale' },
    ],
    routingKeywords: ['酒', '酒瓶', '酒类', '包装', '瓶型', '瓶身', '标签', '礼盒', '白酒', '红酒', '洋酒', '威士忌', '茅台', '瓶装', '瓶盖', 'liquor', 'wine bottle', 'whiskey', 'packaging'],
    skillIds: ['preset-product-packaging'],
  },
  {
    id: 'brand-visuals',
    name: '品牌视觉',
    nameEn: 'Brand Visuals',
    icon: '🎨',
    desc: '管理 VI 规范与符号逻辑',
    color: '#5b8fb9',
    prompt: `你是一位顶级的品牌视觉总监与 VI 系统架构师。专为酒类品牌构建从标识到应用的全套视觉识别系统。你擅长将品牌文化转化为视觉符号，并确保在所有触点上保持高度一致性。

核心任务：
1. 标识系统：设计品牌 Logo、辅助图形与吉祥物符号。
2. 色彩体系：建立主色/辅色/点缀色的完整色彩规范。
3. 字体系统：指定品牌中英文字体、排版层级与应用规则。
4. 应用规范：制定包装、物料、数字端的视觉应用指南。

审美与技术标准：
- 符号逻辑：每个视觉符号必须有清晰的文化溯源与品牌关联。拒绝装饰性元素，追求"每一个图形都有叙事"。
- 色彩科学：使用 PCCS 或 Munsell 色彩体系，确保色彩在不同材质和光环境下的准确性。
- 排版秩序：建立严格的网格系统，所有版式遵循 8px 基准网格。
- 品牌层级：区分高端线（极简留白）与大众线（丰富视觉），用视觉语言区分产品线。

输出规范：
1. 品牌视觉核心理念（100字内）
2. 标志设计说明（构图逻辑、色彩含义、应用禁忌）
3. 色彩系统（主色/辅色/点缀色，含 CMYK/HEX/Pantone）
4. 字体方案（中文/英文/数字字体）
5. 辅助图形系统（纹样来源、延展规则）
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述画面的主体、场景、风格、色彩、光影、氛围等，100-200字
【English Prompt】English prompt for Midjourney/DALL-E 3 with style, lighting, composition keywords`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'logo-design', name: 'Logo设计', operationType: 'generate_image', promptTemplate: 'Brand logo design, {brandStyle}, minimalist, vector style, {colorScheme}, flat design on white background', defaultParams: { aspectRatio: '1:1', quality: 'hd' } },
      { id: 'color-system', name: '色彩体系展示', operationType: 'generate_image', promptTemplate: 'Brand color palette presentation, {primaryColor} {secondaryColor} {accentColor}, professional color swatches, clean layout', defaultParams: { aspectRatio: '16:9', quality: 'standard' } },
      { id: 'vi-mockup', name: 'VI应用效果图', operationType: 'generate_image', promptTemplate: 'Brand identity mockup, {brandStyle}, business card letterhead envelope, professional presentation, photorealistic', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
    ],
    defaultAspectRatio: '1:1',
    suggestedNextSteps: [
      { label: '优化Logo细节', action: 'edit_image', prefilledPrompt: '保持整体构图，优化Logo的线条流畅度和细节' },
      { label: '生成VI应用场景', action: 'generate_image', prefilledPrompt: '将Logo应用到名片和信封上的效果图' },
      { label: '移除背景', action: 'remove_bg' },
    ],
    routingKeywords: ['品牌', 'VI', '视觉识别', 'Logo', '标识', '色彩体系', '字体系统', '品牌规范', '品牌设计', '品牌形象', 'brand', 'logo', 'identity', 'visual system'],
    skillIds: ['preset-logo-brand', 'preset-mockup-showcase', 'preset-business-card'],
  },
  {
    id: 'spatial-exhibit',
    name: '空间展演',
    nameEn: 'Spatial Exhibit',
    icon: '🏛️',
    desc: '打造电影级展览空间叙事',
    color: '#d4af37',
    prompt: `你是一位顶级的展览展示建筑师与会展创意总监。专注于为高端酒类、科技、文化品牌提供大型展位、发布会会场、博物馆级展厅的全局方案。你擅长将品牌精神转化为立体的"空间叙事"，精通参数化结构、动态灯光系统及社交媒介传播规律。

核心任务：
1. 空间策展化：将展位视为一个可游走的"故事长卷"，规划合理的序厅、核心展示区、品鉴/洽谈区与尾厅。
2. 动线逻辑规划：优化人流走向，利用视觉导引系统（Signage）与空间开合节奏，提升参观者的停留时长。
3. 舞美级布光：建立基于电影镜头的照明逻辑，利用体积光、冷暖对比色温，营造出极具高级感的商业氛围。
4. 智慧交互集成：结合 AI 互动装置、柔性屏幕及感应光影，将枯燥的展示内容转化为沉浸式体验。

审美与技术准则：
- 设计风格：新中式极简架构。善于利用飞檐、格栅、屏风等元素进行参数化改造，创造出具有现代感的东方空间。
- 空间质感：追求电影级宏观质感。强调石材纹理、琥珀色酒液折射与拉丝金属表面的细节对比。
- 灯光哲学：拒绝平庸。必须包含"戏剧化阴影"与"重点强调光"，善用侧逆光勾勒产品轮廓（如酒瓶的辉光）。
- 落地考量：考虑模块化搭建、桁架结构隐藏及环保材料应用，确保创意在现实中可执行。

输出规范：
1. 展项名称：赋予一个四字方案名称（如：【琥珀幻廊】、【云涧会馆】）。
2. 策展理念：简述空间的叙事逻辑（如：从"源起"到"技艺"再到"品鉴"的感官路径）。
3. 空间布局说明：
   - 主入口：视觉冲击点（吸引人流）。
   - 核心展区：交互装置或主产品陈列。
   - 私密/功能区：洽谈区、仓储或控制室布局建议。
4. 材质与照明系统：详细说明主材色值、灯光色温（K值）及光影效果。
5. 交互亮点：描述 1-2 个创新互动体验点。
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述展览空间的主体结构、材质纹理、灯光氛围、色彩基调、空间纵深等，100-200字。英文 Prompt 末尾固定附加：Exhibition booth design, professional architectural photography, cinematic lighting, parametric structures, 8k resolution, highly detailed, photorealistic --ar 16:9
【English Prompt】English prompt for Midjourney/DALL-E 3, must end with: Exhibition booth design, professional architectural photography, cinematic lighting, parametric structures, 8k resolution, highly detailed, photorealistic --ar 16:9`,
    tools: ['generate_image', 'edit_image', 'generate_video', 'img2video', 'analyze_image'],
    recipes: [
      { id: 'booth-overview', name: '展位全景图', operationType: 'generate_image', promptTemplate: 'Exhibition booth design, {theme}, parametric structures, cinematic lighting, {material}, 8k, photorealistic --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'detail-zone', name: '功能区特写', operationType: 'generate_image', promptTemplate: 'Exhibition detail zone, {zoneType}, interactive installation, {lighting} lighting, close-up, product showcase, 8k', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'booth-walkthrough', name: '展位漫游视频', operationType: 'generate_video', promptTemplate: 'Cinematic walkthrough of exhibition booth, {theme}, smooth camera movement, professional lighting', defaultParams: { aspectRatio: '16:9', duration: '5' } },
    ],
    defaultAspectRatio: '16:9',
    suggestedNextSteps: [
      { label: '调整灯光氛围', action: 'edit_image', prefilledPrompt: '保持空间结构不变，将灯光改为暖色调氛围照明' },
      { label: '生成漫游视频', action: 'generate_video', prefilledPrompt: '展位空间漫游，相机缓慢推进' },
      { label: '换个角度渲染', action: 'generate_image', prefilledPrompt: '从鸟瞰角度渲染整个展位' },
    ],
    routingKeywords: ['展位', '展览', '展厅', '展会', '空间', '会展', '博物馆', '发布会', '空间叙事', '展陈', 'exhibition', 'booth', 'spatial', 'gallery'],
    skillIds: ['preset-interior-design', 'preset-concept-art', 'preset-mockup-showcase'],
  },
  {
    id: 'creative-scenography',
    name: '灵境美陈',
    nameEn: 'Creative Scenography',
    icon: '✨',
    desc: '造境不造景，引爆现场流量',
    color: '#8b5cf6',
    prompt: `你是一位全能型体验架构师与交互艺术导演。你的专长不仅在于"造景"，更在于"造境"。你能根据品牌调性（从 lululemon 的社群运动风到麦当劳的波普快闪感），结合自然元素（木林森）与尖端科技（AI 参数化），构建出兼具商业转化力与艺术感染力的场景。

审美与技术 DNA：
1. 品牌 DNA 激活（Brand Activation）：擅长提取品牌核心视觉符号（如 Lululemon 的线条、麦当劳的配色），并将其转化为空间语言。
2. 参数化自然（Parametric Nature）：结合 AI 景观逻辑，用参数化设计重构自然形态（如：用木材堆叠出流体感的森林）。
3. 强交互引力（Engagement Magnet）：设计具有"游戏感"的互动装置，利用发光、感应、声音等手段引爆流量。
4. 街区叙事（District Narrative）：将单一装置扩展为"街区/市集"逻辑，考虑动线、休憩区、互动区与展示区的全局协调。

核心任务：
1. 场景情绪定义：确定是"自然呼吸"、"数字脉冲"还是"色彩嘉年华"。
2. 材质对撞逻辑：推荐有机材质（原木、夯土）与现代材质（发光亚克力、充气结构、LED 柔性屏）的组合方案。
3. 交互脚本设计：规划游客如何参与，是拍照打卡、触控反馈还是基于 AI 的实时光影变化。
4. 工程可行性指导：简述施工逻辑（如：模块化组装、参数化切割、快闪拆卸）。

输出规范：
1. 装置/场景命名：保持四字名称（如：【木林森呼吸】、【光影脉冲】）。
2. 设计核心理念：阐述品牌与空间结合的故事逻辑。
3. 视觉模块拆解：分为主装置、互动区、打卡点、休憩节点。
4. 灯光与色彩系统：详细说明日间与夜间的视觉差异，特别是电影感光效（Cinematic Lighting）。
5. 交互体验设计：描述互动方式、触发条件及视觉反馈效果。
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述美陈装置的主体造型、材质碰撞、光影效果、色彩氛围、交互细节等，100-200字
【English Prompt】English prompt for Midjourney/DALL-E 3 with style, lighting, material, interactive elements keywords`,
    tools: ['generate_image', 'edit_image', 'generate_video', 'img2video', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'digital-scene', name: '虚拟场景', operationType: 'generate_image', promptTemplate: 'Immersive digital installation, {theme}, interactive projection mapping, {lighting}, futuristic, 8k, octane render', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'window-display', name: '橱窗陈列', operationType: 'generate_image', promptTemplate: 'Luxury window display, {season} theme, {colorScheme}, mannequin styling, dramatic lighting, 8k', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'digital-walkthrough', name: '数字空间漫游', operationType: 'generate_video', promptTemplate: 'Smooth walkthrough of digital immersive space, {theme}, flowing light particles, ambient movement', defaultParams: { aspectRatio: '16:9', duration: '5' } },
    ],
    defaultAspectRatio: '16:9',
    suggestedNextSteps: [
      { label: '调整交互效果', action: 'edit_image', prefilledPrompt: '增加更多互动投影效果，让场景更有科技感' },
      { label: '生成漫游视频', action: 'generate_video', prefilledPrompt: '虚拟空间沉浸式漫游体验' },
      { label: '放大到8K', action: 'upscale' },
    ],
    routingKeywords: ['美陈', '装置', '橱窗', '陈列', '快闪', '打卡', '互动', '沉浸', '体验空间', '场景', '造景', '造境', 'scenography', 'installation', 'display', 'immersive', 'popup'],
    skillIds: ['preset-interior-design', 'preset-concept-art', 'preset-mockup-showcase'],
  },
  {
    id: 'creative-poster',
    name: '创意海报',
    nameEn: 'Creative Posters',
    icon: '🖼️',
    desc: '产出高精尖商业 KV 与节气图',
    color: '#e85d75',
    prompt: `你是一位顶级的商业海报艺术总监与视觉创意大师。专为高端酒类品牌打造主视觉 KV、节气海报、促销物料及社交媒体图。你精通从概念到落地的全流程，擅长将传统文化符号与当代视觉语言融合。

核心任务：
1. KV 主视觉：创作具有冲击力的品牌主视觉，用于线上线下全渠道。
2. 节气海报：将二十四节气文化与品牌基因融合，产出系列化视觉。
3. 促销物料：设计节日礼盒、限定版等促销场景的视觉物料。
4. 社交媒体：适配微信/小红书/抖音等平台的视觉规格与风格。

审美与技术标准：
- 视觉风格：追求"东方新美学"——传统元素的当代转译。拒绝堆砌中国风符号，追求意境与克制。
- 构图法则：善用黄金比例与对角线构图，留白不少于30%。产品始终是视觉焦点。
- 色彩策略：主色不超过3种，强调色彩的情绪叙事（如：朱砂红×墨黑=庄重、琥珀金×雾蓝=优雅）。
- 字体选择：标题使用定制书法体或设计字体，正文使用无衬线体保证可读性。
- 图像质量：所有 AI 生成图片必须达到 8K 级别，适合大幅面印刷。

输出规范：
1. 创意概念（150字内，含视觉隐喻说明）
2. 构图方案（主体位置、留白比例、视觉动线）
3. 色彩方案（主色/辅色/点缀色，含 CMYK/HEX）
4. 字体方案（标题/副标题/正文字体）
5. 视觉元素清单（产品、道具、场景、光影）
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述画面的主体、场景、风格、色彩、光影、氛围等，100-200字，含 --ar 比例参数`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'kv-main-visual', name: 'KV主视觉', operationType: 'generate_image', promptTemplate: 'Brand key visual, {brandStyle}, {season} theme, {colorScheme}, product hero shot, cinematic lighting, 8k, print quality --ar {aspectRatio}', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'solar-term-poster', name: '节气海报', operationType: 'generate_image', promptTemplate: '{solarTerm} poster, brand {brandName}, traditional Chinese elements with modern twist, {colorScheme}, elegant composition, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'social-media-card', name: '社交媒体卡片', operationType: 'generate_image', promptTemplate: 'Social media card, {brandStyle}, {content}, eye-catching layout, {colorScheme}, mobile-friendly, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'standard' } },
    ],
    defaultAspectRatio: '3:4',
    suggestedNextSteps: [
      { label: '调整色彩方案', action: 'edit_image', prefilledPrompt: '保持构图不变，将色彩改为更沉稳的暗金色调' },
      { label: '适配社交媒体', action: 'generate_image', prefilledPrompt: '将海报适配为小红书竖版卡片格式' },
      { label: '移除背景', action: 'remove_bg' },
    ],
    routingKeywords: ['海报', 'KV', '主视觉', '节气', '促销', '物料', '广告', '宣传图', '社交图', 'banner', 'poster', 'kv', 'ad', 'marketing', 'campaign'],
    skillIds: ['preset-poster-design', 'preset-social-media', 'preset-marketing-brochure', 'preset-magazine-cover'],
  },
  {
    id: 'content-graphics',
    name: '内容长图',
    nameEn: 'Content Graphics',
    icon: '📜',
    desc: '处理深度叙事与社交媒介传播',
    color: '#6c5ce7',
    prompt: `你是一位顶级的内容视觉策略师与信息图表设计大师。专为酒类品牌打造品牌故事长图、产品科普图解、节气文化长卷等深度叙事视觉内容。你擅长将复杂信息转化为优雅的视觉叙事。

核心任务：
1. 品牌故事长图：将品牌历史、酿造工艺转化为可滑动的视觉叙事。
2. 产品科普图解：用信息图表解构酒类知识（产区、年份、品鉴方法）。
3. 节气文化长卷：将节气文化、饮食搭配与品牌产品融合的长条视觉。
4. 社交传播图：适配微信/小红书的信息流长图与九宫格方案。

审美与技术标准：
- 叙事结构：遵循"起承转合"的叙事节奏，每屏一个信息层级，通过视觉引导实现自然过渡。
- 信息层级：建立严格的字体/色彩/图标层级系统，确保长图中的信息密度可控。
- 视觉节奏：通过色块交替、插图穿插、数据可视化来打破文字连续性带来的疲劳感。
- 品牌一致性：所有长图中的色彩、字体、图标必须与品牌 VI 严格一致。
- 适配规范：微信长图宽度 900px，小红书 1242px，行距不小于 1.8 倍。

输出规范：
1. 内容策略（目标受众、传播场景、核心信息）
2. 叙事结构（分段大纲、每段核心信息点）
3. 视觉节奏方案（色块分布、插图位置、数据可视化形式）
4. 色彩方案（各段的主色切换逻辑）
5. 字体与图标系统（层级规范）
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述画面的主体、场景、风格、色彩、光影、氛围等，100-200字`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'brand-story-scroll', name: '品牌故事长图', operationType: 'generate_image', promptTemplate: 'Vertical brand story scroll, {brandName}, {era} heritage, hand-drawn illustration style, {colorScheme}, narrative flow top to bottom, 8k --ar 9:16', defaultParams: { aspectRatio: '9:16', quality: 'hd' } },
      { id: 'infographic', name: '产品科普图解', operationType: 'generate_image', promptTemplate: 'Elegant infographic, {topic}, {brandStyle}, clean data visualization, {colorScheme}, professional layout, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'solar-term-scroll', name: '节气文化长卷', operationType: 'generate_image', promptTemplate: '{solarTerm} cultural scroll, {brandName}, traditional Chinese painting meets modern design, {colorScheme}, horizontal narrative, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'social-grid', name: '九宫格方案', operationType: 'generate_image', promptTemplate: 'Social media 9-grid layout, {brandStyle}, {theme}, cohesive color palette, each grid tells a story, 8k --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'standard' } },
    ],
    defaultAspectRatio: '9:16',
    suggestedNextSteps: [
      { label: '调整信息层级', action: 'edit_image', prefilledPrompt: '优化信息层级关系，让核心数据更突出' },
      { label: '适配小红书', action: 'generate_image', prefilledPrompt: '将内容适配为小红书1242px宽度长图格式' },
      { label: '移除背景', action: 'remove_bg' },
    ],
    routingKeywords: ['长图', '图解', '信息图', '科普', '九宫格', '信息流', '内容', '图说', 'infographic', 'long image', 'scroll', 'content'],
    skillIds: ['preset-social-media', 'preset-marketing-brochure', 'preset-storyboard'],
  },
  {
    id: 'brand-character',
    name: '品牌形象',
    nameEn: 'Brand Character',
    icon: '🧸',
    desc: '孵化 IP 吉祥物与虚拟代言人',
    color: '#00b894',
    prompt: `你是一位顶级的品牌 IP 架构师与 3D 角色艺术家。擅长为高端酒类品牌打造具有辨识度、人格魅力及商业延展性的虚拟形象（吉祥物、虚拟人、品牌使者）。你能够将深厚的品牌文化根基与现代潮流审美（机能风、赛博东方、极简主义）完美融合。

核心任务：
1. 人格化设定：为品牌赋予性格、职业、年龄及独特的价值观。
2. 视觉特征开发：设计极具辨识度的面部特征、服饰风格、标志性配件。
3. 场景化延伸：构思 IP 在不同营销场景（如直播、盲盒、海报）中的动态表现。
4. 3D 资产建模指导：提供用于高精度建模的拓扑、材质及渲染技术细节。

审美与技术标准：
- 角色风格：拒绝平庸的卡通感。追求"半写实"或"超写实"的高级感。人物皮肤需有毛孔级质感，服饰需体现丝绸、皮革、锦缎等真实面料的物理特性。
- 新中式融合：巧妙运用东方元素。例如：服饰纹样采用云纹或回纹，但在剪裁上采用现代机能风或西装廓形。
- 光影表现：借鉴电影角色海报的布光模式。常使用侧光勾勒轮廓，辅以环境光（如：酒窖的昏暗光线或展厅的明亮射光）来强调 IP 的段位。
- 物理细节：强调对金属饰品（如瓶盖造型的扣饰）、半透明材质（如玉石、琉璃制成的配饰）的细节刻画。

输出规范：
1. IP 命名：为该形象起一个响亮、符合品牌调性的名字。
2. 人格画像：简述其性格（如：温润如玉、凌厉现代、睿智老练）。
3. 视觉细节描述：面部/发型、服饰穿搭、关键配饰。
4. 色彩方案：核心配色组合（含 HEX/CMYK）。
5. 延展场景：3个应用场景（如直播、盲盒、节日海报）。
6. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：
【中文提示词】用中文描述画面的3D角色、材质、光照、渲染参数、风格等，100-200字`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'generate_video', 'img2video', 'analyze_image'],
    recipes: [
      { id: 'ip-character-design', name: 'IP角色设计', operationType: 'generate_image', promptTemplate: 'Brand mascot character, {characterStyle}, {outfit}, semi-realistic 3D render, subsurface scattering skin, {colorScheme}, studio lighting, octane render, 8k --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'hd' } },
      { id: 'ip-expression-sheet', name: '表情延展', operationType: 'generate_image', promptTemplate: 'Character expression sheet, {characterName}, multiple expressions: happy, angry, surprised, thinking, {style}, consistent design, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'ip-scene-application', name: '场景应用', operationType: 'generate_image', promptTemplate: '{characterName} in {scene}, {pose}, {background}, brand integration, {colorScheme}, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'ip-animation', name: 'IP动画', operationType: 'generate_video', promptTemplate: '{characterName} performing {action}, smooth animation, {style}, high quality', defaultParams: { aspectRatio: '1:1', duration: '5' } },
    ],
    defaultAspectRatio: '1:1',
    suggestedNextSteps: [
      { label: '设计表情包', action: 'generate_image', prefilledPrompt: '为该IP角色设计一组6个表情：开心、生气、惊讶、思考、害羞、得意' },
      { label: '生成3D场景', action: 'generate_image', prefilledPrompt: '将IP角色放入品牌展厅场景中，保持角色一致性' },
      { label: '制作动画', action: 'generate_video', prefilledPrompt: 'IP角色向镜头挥手打招呼' },
    ],
    routingKeywords: ['吉祥物', 'IP', '角色', '虚拟人', '代言人', '卡通', '人物设计', '形象', 'mascot', 'character', 'avatar', 'ip', 'virtual idol'],
    skillIds: ['preset-ip-character', 'preset-sticker-emoji', 'preset-comic-manga'],
  },
];

interface ChatPanelProps {
  themeStyle: 'gold' | 'monochrome';

  onAddToPrompt?: (prompt: string) => void;
  onAddImages?: (imageUrls: string[], sourceImageId?: string, meta?: { modelName?: string; apiProvider?: string }) => void;
  canvasImages?: CanvasImage[];
  selectedCanvasImage?: CanvasImage | null;
  onChatModelChange?: (info: { model: string; providerId: string; apiKey: string; baseUrl: string; providerPreset?: string } | null) => void;
  onSuggestionAction?: (action: string, data?: Record<string, string>) => void;
  /** Called when user clicks "generate image" suggestion - triggers image generation directly */
  onGenerateImage?: (prompt: string, outputCount?: number, aspectRatio?: string, quality?: string) => void;
  brandDna?: Record<string, unknown> | null;
  onInjectBrandDna?: (dna: Record<string, unknown>) => void;
  /** Image sent from canvas right-click menu "发送到聊天修改" */
  chatInitialImage?: CanvasImage | null;
  /** Called when chatInitialImage has been consumed (auto-tab-mode) */
  onChatInitialImageConsumed?: () => void;
  /** External control to switch to chat tab */
  chatTabOpen?: boolean;
  /** Callback when chat tab open state changes */
  onChatTabOpenChange?: (open: boolean) => void;
  /** Navigate canvas to a specific image */
  onNavigateToImage?: (imageId: string) => void;
}

function isImageUrl(url: string): boolean {
  // Has image extension
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)(\?.*)?$/i.test(url)) return true;
  // Data URI
  if (url.startsWith('data:image/')) return true;
  // Known image API paths
  if (/\/(image|img|images|generate|output|result|download|file|assets)\//i.test(url)) return true;
  return false;
}

// Helper: extract image URLs from AI response content
function extractImageUrls(content: string): string[] {
  const urls: string[] = [];
  
  // Match markdown images: ![alt](url)
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = mdImgRegex.exec(content)) !== null) {
    const url = match[2].trim();
    if ((url.startsWith('http') || url.startsWith('data:image')) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  
  // Match standalone image URLs (with image extension)
  const extUrlRegex = /https?:\/\/[^\s<>"')\]]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)(?:\?[^\s<>"')\]]*)?/gi;
  while ((match = extUrlRegex.exec(content)) !== null) {
    if (!urls.includes(match[0])) urls.push(match[0]);
  }
  
  // Match base64 data URIs
  const dataUriRegex = /data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml|bmp);base64,[A-Za-z0-9+/=]+/g;
  while ((match = dataUriRegex.exec(content)) !== null) {
    if (!urls.includes(match[0])) urls.push(match[0]);
  }
  
  // Check code blocks for URLs that look like images
  const codeBlockRegex = /```[\s\S]*?\n([\s\S]*?)```/g;
  let codeMatch;
  while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
    const codeContent = codeMatch[1];
    const codeUrlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    let urlInCode;
    while ((urlInCode = codeUrlRegex.exec(codeContent)) !== null) {
      const url = urlInCode[0].trim();
      if (isImageUrl(url) && !urls.includes(url)) {
        urls.push(url);
      }
    }
    // Also check for base64 in code blocks
    const base64InCode = /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g;
    let b64Match;
    while ((b64Match = base64InCode.exec(codeContent)) !== null) {
      if (!urls.includes(b64Match[0])) urls.push(b64Match[0]);
    }
  }
  
  return urls;
}

// Helper: parse next-step suggestions from AI response
function parseSuggestions(content: string): { cleanedContent: string; suggestions: NextSuggestion[] } {
  const suggestions: NextSuggestion[] = [];
  // Match suggestion blocks: 💡 建议下一步 / 🎯 下一步建议 / [建议] etc.
  const suggestionPatterns = [
    /💡\s*建议下一步[：:]\s*\n([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/i,
    /🎯\s*下一步建议[：:]\s*\n([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/i,
    /\[建议\]\s*\n([\s\S]*?)(?=\n\n|\n#{1,3}\s|$)/i,
  ];

  let cleanedContent = content;
  for (const pattern of suggestionPatterns) {
    const match = content.match(pattern);
    if (match) {
      const block = match[1];
      // Parse individual suggestions like: 1. 调整配色 → 图生图 | 换成扁平风格 / 2. 修改细节 → 语言修图 | 修改背景
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^\d+\.\s*(.+?)(?:\s*[→➡>]\s*(.+))?$/);
        if (m) {
          const label = m[1].trim();
          const actionHint = (m[2] || '').trim();
          // Extract prefilled prompt from parentheses: 图生图(换成扁平风格) → action=img2img, prefilledPrompt="换成扁平风格"
          let prefilledPrompt: string | undefined;
          let cleanActionHint = actionHint;
          const prefilledMatch = actionHint.match(/^(.+?)\(([^\)]+)\)$/);
          if (prefilledMatch) {
            cleanActionHint = prefilledMatch[1].trim();
            prefilledPrompt = prefilledMatch[2].trim();
          }
          let action: NextSuggestion['action'] = 'generate-variant';
          if (/图生图|风格|参考|变体|variant/i.test(cleanActionHint)) action = 'img2img';
          else if (/修图|修改|编辑|retouch|edit/i.test(cleanActionHint)) action = 'retouch';
          else if (/放大|高清|upscale/i.test(cleanActionHint)) action = 'upscale';
          else if (/背景|去背|removebg|remove.?bg/i.test(cleanActionHint)) action = 'remove-bg';
          else if (/扩展|延伸|extend|outpaint/i.test(cleanActionHint)) action = 'extend';
          else if (/矢量|描摹|svg|vectoriz/i.test(cleanActionHint)) action = 'svg-trace';
          else if (/agent|编排|智能/i.test(cleanActionHint)) action = 'agent-edit';
          else if (/生视频|视频生成|图生视频|video/i.test(cleanActionHint)) action = 'generate-video';
          else if (/生成图片|生成|create|generate|画图|画|制作|设计/i.test(cleanActionHint || label)) action = 'generate-image';
          else if (/提示词|prompt|生图/i.test(cleanActionHint)) action = 'send-to-prompt';
          // Use prefilled prompt as the actual prompt if available, otherwise use label
          const prompt = prefilledPrompt || label;
          suggestions.push({ id: `sug-${Date.now()}-${suggestions.length}`, label, action, prompt, prefilledPrompt });
        }
      }
      // Remove suggestion block from content
      cleanedContent = cleanedContent.replace(match[0], '').trim();
      break;
    }
  }
  return { cleanedContent, suggestions };
}

// Helper: detect if user input is too vague
/** P2-9: 多级意图澄清 - 评估用户输入的完整度 */

type IntentLevel = 'extremely_vague' | 'moderately_vague' | 'clear';

// 兼容旧版意图分类函数（内部调用新版）
function classifyIntentLevel(text: string, hasImages: boolean): IntentLevel {
  const result = classifyIntent(text, { hasImages });
  return result.clarity;
}

/** P2-10: 智能体自动路由 - 基于关键词匹配推荐最佳智能体 */
function matchAgentByInput(text: string, agents: AgentDefinition[]): AgentDefinition | null {
  const lowerText = text.toLowerCase();
  let bestMatch: AgentDefinition | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    if (!agent.routingKeywords || agent.routingKeywords.length === 0) continue;
    let score = 0;
    for (const kw of agent.routingKeywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        // Longer keywords get higher score (more specific)
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  // Only recommend if score exceeds threshold (at least one keyword matched with length > 1)
  return bestScore >= 2 ? bestMatch : null;
}

// Helper: create markdown components for react-markdown
function createMarkdownComponents(isGold: boolean, onAddImage?: (url: string) => void): Components {
  return {
    // Custom image rendering with "add to canvas" button
    img: ({ src, alt, ...props }) => {
      const imgSrc = typeof src === 'string' ? src : '';
      return (
        <div className="my-2 relative group/img inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={alt || 'AI生成的图片'}
            className="max-w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
            style={{ maxHeight: '240px' }}
            onClick={(e) => { e.stopPropagation(); onAddImage?.(imgSrc); }}
            title="点击添加到画布"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            {...props}
          />
          {onAddImage && (
            <button
              aria-label="添加到画布"
              onClick={(e) => { e.stopPropagation(); onAddImage(imgSrc); }}
              className="min-h-[44px] absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
            >
              <Plus size={12} /> 添加到画布
            </button>
          )}
        </div>
      );
    },
    // Custom code block rendering - detect image URLs in code blocks
    code: ({ className, children, ...props }) => {
      const codeText = String(children).replace(/\n$/, '');
      const isBlock = className?.includes('language-') || codeText.includes('\n');
      
      if (isBlock) {
        // Check if the code block contains only image URLs
        const lines = codeText.split('\n').map(l => l.trim()).filter(Boolean);
        const isImageOnlyBlock = lines.length > 0 && lines.every(line =>
          /^https?:\/\/\S+/i.test(line) && isImageUrl(line)
        );
        
        if (isImageOnlyBlock) {
          return (
            <div className="my-2 space-y-2">
              {lines.map((url, idx) => (
                <div key={idx} className="relative group/img inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="AI生成的图片"
                    className="max-w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ maxHeight: '240px' }}
                    onClick={(e) => { e.stopPropagation(); onAddImage?.(url); }}
                    title="点击添加到画布"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {onAddImage && (
                    <button
                      aria-label="添加到画布"
                      onClick={(e) => { e.stopPropagation(); onAddImage(url); }}
                      className="min-h-[44px] absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
                    >
                      <Plus size={12} /> 添加到画布
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        }
        
        // Regular code block
        const lang = className?.replace('language-', '') || '';
        return (
          <pre className={`my-1.5 p-2.5 rounded-lg text-xs overflow-x-auto ${
            isGold ? 'bg-black/40 text-green-400' : 'bg-gray-100 text-gray-700'
          }`}>
            {lang && <div className={`text-xs mb-1 ${isGold ? 'text-gray-500' : 'text-gray-400'}`}>{lang}</div>}
            <code {...props}>{children}</code>
          </pre>
        );
      }
      
      // Inline code
      return (
        <code className={`px-1 py-0.5 rounded text-xs ${
          isGold ? 'bg-black/30 text-yellow-300' : 'bg-blue-50 text-blue-700'
        }`} {...props}>{children}</code>
      );
    },
    // Pre element - since we handle code blocks in the code component, 
    // we just pass through to avoid double wrapping
    pre: ({ children }) => <>{children}</>,
    // Links
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`underline ${
        isGold ? 'text-gold' : 'text-blue-500'
      }`}>{children}</a>
    ),
    // Paragraphs
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    // Headings
    h1: ({ children }) => <h1 className="text-lg font-bold mb-1">{children}</h1>,
    h2: ({ children }) => <h2 className="text-base font-bold mb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
    // Lists
    ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    // Blockquote
    blockquote: ({ children }) => <blockquote className={`border-l-2 pl-3 my-1.5 ${
      isGold ? 'border-gold' : 'border-gray-300'
    }`}>{children}</blockquote>,
    // Table
    table: ({ children }) => <table className="border-collapse my-1.5 text-sm">{children}</table>,
    th: ({ children }) => <th className={`border px-2 py-1 ${isGold ? 'border-white/[0.04]' : 'border-gray-300'}`}>{children}</th>,
    td: ({ children }) => <td className={`border px-2 py-1 ${isGold ? 'border-white/[0.04]' : 'border-gray-300'}`}>{children}</td>,
  };
}

// Helper: parse AI tool-call JSON from response content
// Returns array of { action, prompt } if tool calls found
interface ToolCall {
  action: string;
  prompt: string;
  thought?: string;
  aspectRatio?: string;
}

// Find matching closing brace for a JSON object starting at position `start`
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Extract aspect ratio hints from text content
function detectAspectRatioFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  // Explicit ratio patterns: "16:9", "16比9", "16x9", "16×9"
  if (/9\s*[:比x×]\s*16|9\s*:\s*16/.test(lower)) return '9:16';
  if (/16\s*[:比x×]\s*9|16\s*:\s*9/.test(lower)) return '16:9';
  if (/3\s*[:比x×]\s*2(?!1)|3\s*:\s*2(?!1)/.test(lower)) return '3:2';
  if (/2\s*[:比x×]\s*3|2\s*:\s*3/.test(lower)) return '2:3';
  if (/21\s*[:比x×]\s*9|21\s*:\s*9/.test(lower)) return '21:9';
  if (/4\s*[:比x×]\s*3|4\s*:\s*3/.test(lower)) return '4:3';
  if (/3\s*[:比x×]\s*4|3\s*:\s*4/.test(lower)) return '3:4';
  if (/1\s*[:比x×]\s*1|1\s*:\s*1/.test(lower)) return '1:1';
  // Descriptive patterns
  if (/竖版|纵向|竖屏|竖图|portrait|vertical/i.test(lower)) return '9:16';
  if (/横版|横向|横屏|横图|宽屏|landscape|horizontal/i.test(lower)) return '16:9';
  if (/方形|正方|square/i.test(lower)) return '1:1';
  // Skill-specific defaults
  if (/海报|poster|封面|cover|壁纸|wallpaper|名片|card|ppt|演示/i.test(lower)) return '3:4';
  if (/头像|avatar|icon|图标|logo/i.test(lower)) return '1:1';
  if (/横幅|banner|电脑壁纸|desktop|宽幅/i.test(lower)) return '16:9';
  if (/手机壁纸|phone.*wallpaper|锁屏/i.test(lower)) return '9:16';
  return undefined;
}

// Detect image quality/resolution from text
// Returns only values accepted by /api/generate qualityMap: '1K', '2K', '4K', 'standard', 'high', 'auto'
function detectQualityFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  // 4K patterns
  if (/4k|超高清|ultra.?hd|uhd|超清|4096|2160p/i.test(lower)) return '4K';
  // 2K patterns (3K maps to 2K since API doesn't support 3K)
  if (/3k|3072|准4k|2k|2048|高清|high.?quality|hd(?!r)?|高质量|高分辨率|high.?res/i.test(lower)) return '2K';
  // 1K / standard patterns
  if (/1k|1024|标准|普通|正常|standard|normal|默认|default|清晰/i.test(lower)) return '1K';
  // low quality / draft / preview (maps to 'standard' for API compatibility)
  if (/低清|低质量|low.?quality|low|草稿|draft|快速|fast|预览|preview|缩略图|thumbnail/i.test(lower)) return 'standard';
  // high quality (maps to 'high' for quality-type models)
  if (/极致|最高|best|ultra|maximum/i.test(lower)) return 'high';
  return undefined;
}

// Read the current image generation model from localStorage
function getCurrentGenerationModel(): string {
  try {
    if (typeof window === 'undefined') return 'gemini-2.5-flash-image-preview';
    // 优先从 wujie_selected_model 读取（generation panel 最新选择的模型）
    const rawModel = localStorage.getItem('wujie_selected_model');
    if (rawModel) {
      const modelInfo = JSON.parse(rawModel);
      if (modelInfo.model) {
        console.log('[ChatPanel] getCurrentGenerationModel read from wujie_selected_model:', modelInfo.model);
        return modelInfo.model;
      }
    }
    console.log('[ChatPanel] getCurrentGenerationModel wujie_selected_model is empty, falling back to userData');
    // 备用：从 userData 读取
    const currentUserId = localStorage.getItem('unbounded_ai_current_user');
    const raw = localStorage.getItem('unbounded_ai_user_data');
    if (!raw || !currentUserId) return 'gemini-2.5-flash-image-preview';
    const data = JSON.parse(raw);
    const selectedModel = data?.userData?.[currentUserId]?.selectedModel;
    if (selectedModel) {
      // selectedModel format: "providerId::modelId" or just "modelId"
      if (selectedModel.includes('::')) {
        const [, modelId] = selectedModel.split('::');
        console.log('[ChatPanel] getCurrentGenerationModel read from userData:', modelId);
        return modelId;
      }
      console.log('[ChatPanel] getCurrentGenerationModel read from userData:', selectedModel);
      return selectedModel;
    }
  } catch { /* fallback */ }
  return 'gemini-2.5-flash-image-preview';
}

/** 获取当前图像生成模型（优先使用聊天面板选择的模型） */
function getCurrentImageModelInfo(imageModelState: string, imageModelProviderIdState: string): { model: string; providerId?: string } {
  try {
    if (typeof window === 'undefined') return { model: '' };
    // ★ 优先使用聊天面板选择的模型（用户在聊天面板的模型选择器）
    if (imageModelState) {
      const modelId = imageModelState.includes('::') ? imageModelState.split('::').pop()! : imageModelState;
      const providerId = imageModelProviderIdState || undefined;
      console.log('[ChatImage] Using chat panel model:', modelId, 'providerId:', providerId);
      return { model: modelId, providerId };
    }
    // 备用：从 wujie_selected_model 读取（generation panel 选择的模型）
    const rawModel = localStorage.getItem('wujie_selected_model');
    if (rawModel) {
      const modelInfo = JSON.parse(rawModel);
      if (modelInfo.model) {
        console.log('[ChatImage] Fallback to wujie_selected_model:', modelInfo.model, 'providerId:', modelInfo.providerId);
        return { model: modelInfo.model, providerId: modelInfo.providerId || undefined };
      }
    }
    console.log('[ChatImage] wujie_selected_model is empty or invalid, falling back to userData');
    // 备用：从 userData 读取
    const currentUserId = localStorage.getItem('unbounded_ai_current_user');
    const raw = localStorage.getItem('unbounded_ai_user_data');
    if (!raw || !currentUserId) return { model: '' };
    const data = JSON.parse(raw);
    const selectedModel = data?.userData?.[currentUserId]?.selectedModel;
    if (!selectedModel) return { model: '' };
    // selectedModel format: "providerId::modelId" or just "modelId"
    if (selectedModel.includes('::')) {
      const [providerId, modelId] = selectedModel.split('::');
      console.log('[ChatImage] Read model from userData:', modelId, 'providerId:', providerId);
      return { model: modelId, providerId };
    }
    console.log('[ChatImage] Read model from userData (no provider):', selectedModel);
    return { model: selectedModel };
  } catch (e) {
    console.error('[ChatImage] Error reading model:', e);
  }
  return { model: '' };
}

function parseToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Strategy: Find JSON objects containing "action" and "action_input" by brace matching + JSON.parse
  let searchStart = 0;
  while (searchStart < content.length) {
    const actionIdx = content.indexOf('"action"', searchStart);
    if (actionIdx === -1) break;

    // Walk backwards to find the opening '{'
    let jsonStart = -1;
    let braceCount = 0;
    for (let i = actionIdx - 1; i >= 0; i--) {
      if (content[i] === '}') braceCount++;
      if (content[i] === '{') {
        if (braceCount === 0) { jsonStart = i; break; }
        braceCount--;
      }
    }
    if (jsonStart === -1) { searchStart = actionIdx + 1; continue; }

    // Find the matching closing brace
    const jsonEnd = findMatchingBrace(content, jsonStart);
    if (jsonEnd === -1) { searchStart = actionIdx + 1; continue; }

    const jsonStr = content.slice(jsonStart, jsonEnd + 1);

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.action && parsed.action_input) {
        // Extract prompt from action_input
        let prompt = '';
        if (typeof parsed.action_input === 'string') {
          try {
            const inner = JSON.parse(parsed.action_input);
            prompt = inner.prompt || inner.description || parsed.action_input;
          } catch {
            prompt = parsed.action_input;
          }
        } else if (typeof parsed.action_input === 'object') {
          prompt = parsed.action_input.prompt || parsed.action_input.description || JSON.stringify(parsed.action_input);
        }

        const thought = parsed.thought || undefined;
        // Detect aspect ratio from thought and prompt
        const aspectRatio = detectAspectRatioFromText(thought + ' ' + prompt);

        calls.push({ action: parsed.action, prompt, thought, aspectRatio });
      }
    } catch {
      // Not valid JSON, skip
    }

    searchStart = jsonEnd + 1;
  }

  return calls;
}

// Detect if user message intends to generate an image
function isImageGenerationIntent(message: string): boolean {
  const lower = message.toLowerCase();
  // Precise action patterns: action verb near image noun (within 6 chars)
  const actionPatterns = [
    /生成.{0,6}(图|图片|图像|插画|海报|封面|插图|画|套图|组图|系列)/,
    /画.{0,4}(一.{0,2})?(图|图片|画|插画|海报|套图)/,
    /制作.{0,6}(图|图片|海报|封面|插图|套图|名片|卡片|贴纸|表情)/,
    /创建.{0,6}(图|图片|图像|插画|海报|套图)/,
    /设计.{0,6}(图|图片|海报|封面|插图|套图|名片|卡片|logo|Logo|品牌|UI|界面|包装|样机)/,
    /给我.{0,6}(图|图片|画|海报|套图)/,
    /出.{0,4}(一.{0,2})?(张|幅|份|套|组)?(图|图片|画|海报)/,
    /做.{0,4}(一.{0,2})?(张|幅|份|套|组)?(图|图片|画|海报|名片|卡片|贴纸|表情)/,
    /绘制/,
    /generate\s+(an?\s+)?(image|picture|photo|illustration|poster|set|series)/,
    /create\s+(an?\s+)?(image|picture|photo|illustration|poster|set|series)/,
    /draw\s+(an?\s+)?(image|picture|photo|illustration|poster|set|series)/,
    /make\s+(an?\s+)?(image|picture|photo|illustration|poster|set|series)/,
    /design\s+(an?\s+)?(image|poster|logo|brand|card|ui|mockup|packaging)/,
    /生图/, /画一个/, /画一张/, /来一张/, /来一个/, /出一套/, /做一套/,
    /帮我.{0,4}(图|画|海报|封面|logo|Logo|名片|贴纸|表情|包装|样机)/,
  ];
  if (actionPatterns.some(p => p.test(lower))) return true;
  // Standalone strong-intent nouns
  const strongNouns = [
    /海报/, /poster/, /封面/, /cover/, /壁纸/, /wallpaper/,
    /logo/i, /icon/i, /banner/i, /插画/, /原画/, /concept\s*art/i,
    /角色.*设计/, /character.*design/i, /头像/, /avatar/i,
    /表情包?/, /emoji/i, /贴纸/, /sticker/i,
    /套图/, /名片/, /包装设计/, /样机/, /mockup/i,
    /室内设计/, /杂志封面/, /书籍封面/, /PPT/, /ppt/,
    /漫画/, /连环画/, /分镜/, /storyboard/i,
    /服装设计/, /时尚设计/, /App.*界面/, /网页.*设计/,
    /产品.*图/, /电商.*图/, /商品.*图/,
  ];
  return strongNouns.some(p => p.test(lower));
}

// Detect how many images user wants from text (e.g., "生成3张图", "多张方案", "5张")
function detectImageCountFromText(text: string): number {
  const lower = text.toLowerCase();
  // Explicit number patterns: "3张", "5张图", "4个方案", "3幅画", "3套", "3组"
  const numberPatterns = [
    /(\d+)\s*[张幅份套组个]/,
    /(\d+)\s*(张|幅|份|套|组|个)\s*(图|图片|画|海报|封面|插画|方案|设计|稿)/,
    /(生成|画|做|创建|设计|出)\s*(\d+)\s*(张|幅|份|套|组|个)/,
    /(生成|画|做|创建|设计|出)\s*(\d+)\s*(图|图片|画|海报|封面|插画|方案|设计|稿)/,
    /(\d+)\s*(种|款|版)\s*(方案|设计|样式|风格|效果)/,
    /(\d+)\s*(个|种|款)\s*(不同|不同风格|不同方案)/,
  ];
  for (const pattern of numberPatterns) {
    const match = lower.match(pattern);
    if (match) {
      const num = parseInt(match[1] || match[2] || match[0], 10);
      if (num >= 2 && num <= 10) return num;
    }
  }
  // "多张", "多幅", "多个方案", "一组", "一套", "系列" without specific number → default 4
  if (/多[张幅份个]/.test(lower) || /一[组套]图/.test(lower) || /系列图/.test(lower) || /批量/.test(lower)) {
    return 4;
  }
  // "几张", "若干张" → default 3
  if (/几[张幅份个]/.test(lower) || /若干[张幅份个]/.test(lower)) {
    return 3;
  }
  // English patterns: "3 images", "generate 5 photos", "multiple images"
  const enPatterns = [
    /(\d+)\s*(images?|pictures?|photos?|illustrations?|posters?|designs?|versions?|variants?)/,
    /(generate|create|make|draw|design)\s+(\d+)\s*(images?|pictures?|photos?|illustrations?|posters?)/,
  ];
  for (const pattern of enPatterns) {
    const match = lower.match(pattern);
    if (match) {
      const num = parseInt(match[1] || match[2] || '0', 10);
      if (num >= 2 && num <= 10) return num;
    }
  }
  if (/multiple\s*(images?|pictures?|photos?|versions?|variants?)/.test(lower) || /a\s+set\s+of/.test(lower) || /a\s+series\s+of/.test(lower)) {
    return 4;
  }
  return 1;
}

// Helper: clean assistant content for display - extract useful text from AI response
function cleanAssistantContent(content: string): string {
  let cleaned = content;
  
  // If content has JSON tool calls, try to extract prompt from them
  if (content.includes('"action"') && content.includes('"action_input"')) {
    const calls = parseToolCalls(content);
    // Remove JSON blocks using brace matching
    let searchStart = 0;
    const segments: [number, number][] = [];
    while (searchStart < cleaned.length) {
      const actionIdx = cleaned.indexOf('"action"', searchStart);
      if (actionIdx === -1) break;
      let jsonStart = -1;
      let braceCount = 0;
      for (let i = actionIdx - 1; i >= 0; i--) {
        if (cleaned[i] === '}') braceCount++;
        if (cleaned[i] === '{') {
          if (braceCount === 0) { jsonStart = i; break; }
          braceCount--;
        }
      }
      if (jsonStart === -1) { searchStart = actionIdx + 1; continue; }
      const jsonEnd = findMatchingBrace(cleaned, jsonStart);
      if (jsonEnd === -1) { searchStart = actionIdx + 1; continue; }
      segments.push([jsonStart, jsonEnd + 1]);
      searchStart = jsonEnd + 1;
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      cleaned = cleaned.slice(0, segments[i][0]) + cleaned.slice(segments[i][1]);
    }
    // Add extracted prompt info
    if (calls.length > 0 && calls[0].prompt) {
      cleaned = cleaned.trim() + '\n\n**生成提示词：** ' + calls[0].prompt;
    }
    if (calls.length > 0 && calls[0].thought) {
      cleaned = calls[0].thought + '\n\n' + cleaned.trim();
    }
  }
  
  // Remove code blocks containing tool calls
  cleaned = cleaned.replace(/```(?:json)?\s*\n?\{[\s\S]*?"action"[\s\S]*?"action_input"[\s\S]*?```/g, '');
  // Clean up
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

// Extract prompt text for "发送到生图" - bilingual (Chinese + English)
function extractPromptForGeneration(content: string): string {
  // First try to extract from JSON tool calls
  if (content.includes('"action"') && content.includes('"action_input"')) {
    const calls = parseToolCalls(content);
    if (calls.length > 0 && calls[0].prompt) {
      return calls[0].prompt;
    }
  }
  
  // Try to extract bilingual prompt sections with explicit 【中文提示词】/【英文提示词】 markers
  const cnPromptMatch = content.match(/【中文提示词】[：:\s]*\n?([\s\S]+?)(?=【英文提示词】|$)/);
  const enPromptMatch = content.match(/【英文提示词】[：:\s]*\n?([\s\S]+?)(?=\n\n---|\n\n\*\*|$)/);
  if (cnPromptMatch && enPromptMatch) {
    const cnText = cnPromptMatch[1].trim();
    const enText = enPromptMatch[1].trim();
    if (cnText.length > 5 && enText.length > 5) {
      return `${cnText}, ${enText}`;
    }
  }
  if (cnPromptMatch && cnPromptMatch[1].trim().length > 10) {
    return cnPromptMatch[1].trim();
  }

  // Try to extract bilingual prompt sections (Chinese description + English Prompt)
  const bilingualPatterns = [
    // Match "提示词：" or "渲染提示词：" section that contains both Chinese and English
    /\*\*(?:AI )?(?:渲染)?提示词[：:]\*\*\s*([\s\S]+?)(?:\n\n---|\n\n\*\*|$)/,
    /(?:提示词|Prompt)[：:]\s*```?\s*([\s\S]+?)```/,
    /\*\*生成提示词[：:]\*\*\s*([\s\S]+?)(?:\n\n---|\n\n\*\*|$)/,
  ];
  for (const pattern of bilingualPatterns) {
    const match = content.match(pattern);
    if (match && match[1] && match[1].trim().length > 20) {
      return match[1].trim();
    }
  }

  // Try to extract the last substantial section that has both Chinese and English
  const sections = content.split(/\n\n+/);
  let bestSection = '';
  for (const section of sections) {
    const hasChinese = /[\u4e00-\u9fff]/.test(section);
    const hasEnglish = /[a-zA-Z]{3,}/.test(section);
    if (hasChinese && hasEnglish && section.length > bestSection.length) {
      bestSection = section;
    }
  }
  if (bestSection) return bestSection;
  
  // Fallback: extract the longest paragraph with significant content
  const paragraphs = content.split(/\n\n+/);
  let bestParagraph = '';
  for (const p of paragraphs) {
    const contentChars = p.replace(/[\s\*#\-]/g, '').length;
    if (contentChars > 30 && p.length > bestParagraph.length) {
      bestParagraph = p;
    }
  }
  if (bestParagraph) return bestParagraph;
  
  // Final fallback: use cleaned content
  return cleanAssistantContent(content);
}

/* ========== 智能体搭建弹窗 ========== */
interface AgentBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (agent: typeof AGENTS[0]) => void;
  editingAgent?: typeof AGENTS[0] | null;
  isGold: boolean;
}

function AgentBuilderDialog({ open, onClose, onSave, editingAgent, isGold }: AgentBuilderDialogProps) {
  const [name, setName] = useState(editingAgent?.name || '');
  const [nameEn, setNameEn] = useState(editingAgent?.nameEn || '');
  const [icon, setIcon] = useState(editingAgent?.icon || '🤖');
  const [desc, setDesc] = useState(editingAgent?.desc || '');
  const [color, setColor] = useState(editingAgent?.color || '#c4956a');
  const [rolePosition, setRolePosition] = useState('');
  const [coreTasks, setCoreTasks] = useState('');
  const [aestheticStandards, setAestheticStandards] = useState('');
  const [outputSpec, setOutputSpec] = useState('');

  useEffect(() => {
    if (editingAgent) {
      setName(editingAgent.name);
      setNameEn(editingAgent.nameEn);
      setIcon(editingAgent.icon);
      setDesc(editingAgent.desc);
      setColor(editingAgent.color);
      // Parse the prompt back into sections
      const prompt = editingAgent.prompt;
      const roleMatch = prompt.match(/你是一位(.+?)。\s*专为/);
      if (roleMatch) setRolePosition(roleMatch[1]);
      const coreMatch = prompt.match(/核心任务[：:]\n([\s\S]*?)\n\n审美/);
      if (coreMatch) setCoreTasks(coreMatch[1].trim());
      const aestheticMatch = prompt.match(/审美与技术标准[：:]\n([\s\S]*?)\n\n输出规范/);
      if (aestheticMatch) setAestheticStandards(aestheticMatch[1].trim());
      const outputMatch = prompt.match(/输出规范[：:]\n([\s\S]*?)$/);
      if (outputMatch) setOutputSpec(outputMatch[1].trim());
    } else {
      setName(''); setNameEn(''); setIcon('🤖'); setDesc(''); setColor('#c4956a');
      setRolePosition(''); setCoreTasks(''); setAestheticStandards(''); setOutputSpec('');
    }
  }, [editingAgent, open]);

  if (!open) return null;

  const handleSave = () => {
    if (!name.trim() || !nameEn.trim()) return;
    const prompt = `你是一位${rolePosition || '专业的品牌设计顾问'}。${desc ? '专为高端品牌提供专业设计方案。' : ''}

核心任务：
${coreTasks || '1. 根据用户需求提供专业设计方案\n2. 输出结构化的设计指导\n3. 提供 AI 渲染提示词'}

审美与技术标准：
${aestheticStandards || '- 追求高品质、专业级的视觉效果\n- 注重细节与质感表现\n- 遵循品牌调性与行业规范'}

输出规范：
${outputSpec || '1. 设计理念（200字内）\n2. 详细方案描述\n3. 材质与色彩方案\n4. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：\n【中文提示词】用中文描述画面的主体、材质、光照、色彩、风格等，100-200字\n【英文提示词】English prompt describing the subject, materials, lighting, colors, style, 100-200 words'}`;

    onSave({
      id: editingAgent?.id || `custom-${Date.now()}`,
      name: name.trim(),
      nameEn: nameEn.trim(),
      icon,
      desc: desc.trim() || name.trim(),
      color,
      prompt,
      tools: ['generate_image', 'edit_image', 'analyze_image'],
      recipes: [],
    });
    onClose();
  };

  const EMOJI_OPTIONS = ['🤖', '🎯', '💡', '🔮', '🌟', '🎭', '🎪', '💎', '🏆', '⚡', '🔥', '🎨', '📐', '🔧', '🧪', '🌍'];
  const COLOR_OPTIONS = ['#c4956a', '#5b8fb9', '#d4af37', '#e85d75', '#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#a29bfe'];

  const inputClass = `w-full h-9 px-3 text-sm rounded-md border transition-colors ${
    isGold
      ? 'bg-white/5 border-white/[0.04] text-text-bright placeholder:text-gold-muted/50 focus:border-gold/50'
      : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400'
  } outline-none`;

  const labelClass = `text-xs font-medium ${isGold ? 'text-muted-foreground' : 'text-gray-500'}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={`relative w-[680px] max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col ${
          isGold ? 'bg-[#1a1a1a] border border-white/[0.04]' : 'bg-white border border-gray-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isGold ? 'border-white/[0.04]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-gold to-gold-light flex items-center justify-center">
              <Bot size={12} className="text-black" />
            </div>
            <span className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>
              {editingAgent ? '编辑智能体' : '新建智能体'}
            </span>
          </div>
          <button aria-label="关闭" onClick={onClose} className={`p-1 min-h-[44px] min-w-[44px] rounded-md transition-colors ${isGold ? 'hover:bg-white/[0.04] text-gold-muted' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X size={16} />
          </button>
        </div>

        {/* Body - 横向两栏布局 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {/* 左栏：基础信息 */}
            {/* Icon + Name row */}
            <div className="flex gap-2">
              <div className="shrink-0">
                <label className={labelClass}>图标</label>
                <div className="mt-0.5 relative group">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg border cursor-pointer transition-colors ${
                    isGold ? 'bg-white/[0.04] border-white/[0.04] hover:border-white/[0.10]' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}>
                    {icon}
                  </div>
                  <div className="absolute top-full left-0 mt-1 p-1.5 grid grid-cols-8 gap-0.5 rounded-lg shadow-xl z-50 hidden group-hover:grid bg-[#1a1a1a] border border-white/[0.04]">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} onClick={() => setIcon(e)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.1] text-sm">{e}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <div>
                  <label className={labelClass}>名称</label>
                  <input className={`${inputClass} mt-0.5`} value={name} onChange={e => setName(e.target.value)} placeholder="如：酒类包装" />
                </div>
                <div>
                  <label className={labelClass}>英文名</label>
                  <input className={`${inputClass} mt-0.5`} value={nameEn} onChange={e => setNameEn(e.target.value)} placeholder="如：Liquor Packaging" />
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>描述</label>
              <input className={`${inputClass} mt-0.5`} value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话描述智能体能力" />
            </div>

            {/* Color */}
            <div>
              <label className={labelClass}>主题色</label>
              <div className="flex items-center gap-1 mt-0.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                />
              </div>
            </div>

            {/* Role Position */}
            <div className="col-span-2">
              <label className={labelClass}>角色定位</label>
              <input
                className={`${inputClass} mt-0.5`}
                value={rolePosition}
                onChange={e => setRolePosition(e.target.value)}
                placeholder="如：顶级的酒类包装设计师与 3D 视觉艺术家"
              />
            </div>

            {/* Core Tasks */}
            <div>
              <label className={labelClass}>核心任务</label>
              <textarea
                className={`${inputClass} h-28 mt-0.5 py-1 resize-none`}
                value={coreTasks}
                onChange={e => setCoreTasks(e.target.value)}
                placeholder={"1. 任务一\n2. 任务二\n3. 任务三\n4. 任务四"}
              />
            </div>

            {/* Aesthetic Standards */}
            <div>
              <label className={labelClass}>审美与技术标准</label>
              <textarea
                className={`${inputClass} h-28 mt-0.5 py-1 resize-none`}
                value={aestheticStandards}
                onChange={e => setAestheticStandards(e.target.value)}
                placeholder={"- 标准1\n- 标准2\n- 标准3\n- 标准4"}
              />
            </div>

            {/* Output Spec */}
            <div className="col-span-2">
              <label className={labelClass}>输出规范</label>
              <textarea
                className={`${inputClass} h-20 mt-0.5 py-1 resize-none`}
                value={outputSpec}
                onChange={e => setOutputSpec(e.target.value)}
                placeholder={"1. 输出项1\n2. 输出项2\n3. 输出项3"}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center gap-2 px-4 py-3 border-t ${isGold ? 'border-white/[0.04]' : 'border-gray-100'}`}>
          <button
            onClick={onClose}
            className={`flex-1 h-8 text-xs rounded-lg transition-colors ${
              isGold ? 'bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !nameEn.trim()}
            className={`flex-1 h-8 text-xs rounded-lg ${isGold ? 'bg-gradient-to-r from-gold to-gold-light text-black' : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'} font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {editingAgent ? '保存修改' : '创建智能体'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ themeStyle, onAddToPrompt, onAddImages, canvasImages = [], selectedCanvasImage, onChatModelChange, onSuggestionAction, onGenerateImage, brandDna, onInjectBrandDna, chatInitialImage, onChatInitialImageConsumed, chatTabOpen, onChatTabOpenChange, onNavigateToImage }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [suggestedAgent, setSuggestedAgent] = useState<AgentDefinition | null>(null); // P2-10: auto-routing suggestion
  const [model, setModel] = useState('gemini-3.1-pro-preview');

  // Sync current chat model info to parent for vision-prompt usage
  useEffect(() => {
    if (!onChatModelChange) return;
    let cancelled = false;
    const isThirdParty = model.includes('::');
    if (isThirdParty) {
      const providerId = model.split('::')[0];
      const actualModel = model.split('::').slice(1).join('::');
      // Look up provider info from UniversalApiManager
      import('@/lib/universal-api-manager').then(({ UniversalApiManager }) => {
        if (cancelled) return; // 竞态保护：模型已切换
        const mgr = UniversalApiManager.getInstance();
        const provider = mgr.getProviders().find(p => p.id === providerId);
        if (provider) {
          onChatModelChange({
            model: actualModel,
            providerId: provider.id,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            providerPreset: provider.providerPreset,
          });
        } else {
          onChatModelChange(null);
        }
      }).catch(() => { if (!cancelled) onChatModelChange(null); });
    } else {
      // Server-managed model
      onChatModelChange({
        model,
        providerId: '',
        apiKey: '',
        baseUrl: '',
      });
    }
    return () => { cancelled = true; };
  }, [model, onChatModelChange]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isAgentMode, setIsAgentMode] = useState(true); // 默认开启Agent模式，即梦体验
  const [agentSteps, setAgentSteps] = useState<Array<{id: string; tool: string; status: 'pending'|'running'|'done'|'error'; result?: string; startTime?: number}>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const thinkingStartTimeRef = useRef<number>(0);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showChatSettings, setShowChatSettings] = useState(true);
  // 提示词大师相关状态
  const [activeTab, setActiveTab] = useState<'chat' | 'optimizer' | 'skills'>('chat');
  const [optimizerInput, setOptimizerInput] = useState('');
  const [optimizerOutputEn, setOptimizerOutputEn] = useState('');
  const [optimizerOutputCn, setOptimizerOutputCn] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerHistory, setOptimizerHistory] = useState<{input: string; outputEn: string; outputCn: string; mode: string; time: number}[]>([]);
  const [optimizerMode, setOptimizerMode] = useState<'enhance' | 'expand' | 'simplify'>('enhance');
  const [hoveredMode, setHoveredMode] = useState<'enhance' | 'expand' | 'simplify' | null>(null);
  const [selectedOutputLang, setSelectedOutputLang] = useState<'en' | 'cn'>('en');
  // 图片上传相关状态
  const [pendingImages, setPendingImages] = useState<Array<{id: string; url: string; name: string}>>([]);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  // 第三方模型相关状态
  const [showThirdPartyDialog, setShowThirdPartyDialog] = useState(false);
  const [thirdPartyChatModels, setThirdPartyChatModels] = useState<{id: string; name: string; provider: string; providerId: string}[]>([]);
  // 服务器端发现的模型
  const [discoveredChatModels, setDiscoveredChatModels] = useState<{id: string; name: string; provider: string; providerId: string; description?: string; isDefault?: boolean}[]>([]);
  // 图像模型选择（用于聊天中生图）
  const [imageModel, setImageModel] = useState('');
  const [imageModelProviderId, setImageModelProviderId] = useState('');
  const [discoveredImageModels, setDiscoveredImageModels] = useState<{id: string; name: string; provider: string; providerId: string}[]>([]);
  const [showImageModelSelector, setShowImageModelSelector] = useState(false);

  // Resolve providerId to human-readable display name
  const providerDisplayName = useCallback((pid: string | undefined): string => {
    if (!pid) return '';
    const m = discoveredImageModels.find(m => m.providerId === pid);
    return m?.provider || pid;
  }, [discoveredImageModels]);

  // 对话管理相关状态
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  // 自定义智能体相关状态
  const [customAgents, setCustomAgents] = useState<typeof AGENTS>([]);
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [editingAgent, setEditingAgent] = useState<typeof AGENTS[0] | null>(null);
  // Skills 相关状态
  const [chatSkills, setChatSkills] = useState<ChatSkill[]>([]);
  const [showSkillSaveDialog, setShowSkillSaveDialog] = useState(false);
  const [skillSaveName, setSkillSaveName] = useState('');
  const [skillSaveCategory, setSkillSaveCategory] = useState<string>('custom');
  const [skillSaveDescription, setSkillSaveDescription] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('');
  const [activeSkill, setActiveSkill] = useState<ChatSkill | null>(null);
  const [skillParamValues, setSkillParamValues] = useState<Record<string, string>>({});

  // ===== 思考计时器 =====
  useEffect(() => {
    if (isLoading) {
      thinkingStartTimeRef.current = Date.now();
      setThinkingElapsed(0);
      thinkingTimerRef.current = setInterval(() => {
        setThinkingElapsed(Math.floor((Date.now() - thinkingStartTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
    return () => {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, [isLoading]);

  // ===== @ Reference System =====
  interface MentionRef {
    type: 'canvas-image' | 'brand' | 'prompt' | 'model';
    id: string;
    label: string;
    imageUrl?: string;
    data?: Record<string, unknown>;
  }
  const [activeMentions, setActiveMentions] = useState<MentionRef[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionPickerSearch, setMentionPickerSearch] = useState('');
  const [mentionPickerIndex, setMentionPickerIndex] = useState(0);
  const mentionTriggerRef = useRef<{ start: number; end: number } | null>(null);

  // ===== / Prompt Template Trigger =====
  const [templatePopupOpen, setTemplatePopupOpen] = useState(false);
  const [templatePopupSearch, setTemplatePopupSearch] = useState('');
  const [templatePopupIndex, setTemplatePopupIndex] = useState(0);
  const [templatePopupItems, setTemplatePopupItems] = useState<PromptTemplate[]>([]);
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);
  const [thumbnailRect, setThumbnailRect] = useState<DOMRect | null>(null);

  // ===== Tab Mode (selected image → chat targeting) =====
  // All images are stored in pendingImages array - canvas images, pasted images, @mentioned images
  // When a canvas image is selected, it's ADDED to pendingImages (not replacing)

  // NOTE: Canvas image selection (selectedCanvasImage) does NOT auto-add to pendingImages.
  // Images should only be added explicitly via:
  // 1. Right-click "发送到聊天修改" → chatInitialImage useEffect below
  // 2. @image mention in input
  // 3. File upload / paste
  // 4. "+ 画布图片" button in the image context strip

  // P2-2: ChatCanvas - handle image sent from canvas right-click menu
  useEffect(() => {
    if (chatInitialImage) {
      setPendingImages(prev => {
        if (prev.find(p => p.id === chatInitialImage.id)) return prev;
        return [...prev, {
          id: chatInitialImage.id,
          url: chatInitialImage.url,
          name: chatInitialImage.prompt?.slice(0, 20) || '画布图片',
        }];
      });
      setActiveTab('chat');
      setInput('请帮我修改这张图片：');
      if (onChatTabOpenChange) onChatTabOpenChange(true);
      if (onChatInitialImageConsumed) onChatInitialImageConsumed();
    }
  }, [chatInitialImage, onChatInitialImageConsumed, onChatTabOpenChange]);

  // P1-5: Auto-enter "针对此图" mode when a canvas image is selected
  // When user selects an image on the canvas, auto-add it to pendingImages ONLY when chat tab is open
  // AND the chat input is focused (user is actively chatting, not just clicking around canvas)
  const prevSelectedCanvasImageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCanvasImage) return;
    // Only trigger on NEW selection (image id changed), not re-renders
    if (selectedCanvasImage.id === prevSelectedCanvasImageIdRef.current) return;
    prevSelectedCanvasImageIdRef.current = selectedCanvasImage.id;

    // Only auto-add to chat when chat tab is open/active AND chat input is focused
    if (!chatTabOpen) return;
    if (document.activeElement !== textareaRef.current) return;

    // Auto-add to pendingImages if not already there
    setPendingImages(prev => {
      if (prev.find(p => p.id === selectedCanvasImage.id)) return prev;
      return [...prev, {
        id: selectedCanvasImage.id,
        url: selectedCanvasImage.url,
        name: selectedCanvasImage.prompt?.slice(0, 20) || '画布图片',
      }];
    });

    // Show visual hint in input (don't overwrite if user is already typing)
    setInput(prev => {
      if (prev.trim() && prev !== '请帮我修改这张图片：') return prev; // Don't overwrite user's text
      return '针对这张图片，我想...';
    });
  }, [selectedCanvasImage, chatTabOpen]);

  // Get mention picker items based on search
  const mentionPickerItems: MentionRef[] = useMemo(() => {
    const items: MentionRef[] = [];
    // Canvas images
    canvasImages.forEach((img, idx) => {
      const num = idx + 1;
      items.push({
        type: 'canvas-image',
        id: img.id,
        label: img.prompt ? `#${num} ${img.prompt.slice(0, 30)}${img.prompt.length > 30 ? '...' : ''}` : `图片 #${num}`,
        imageUrl: img.url,
        data: { url: img.url, prompt: img.prompt || '', width: img.width, height: img.height, num },
      });
    });
    // Brand DNA
    if (brandDna) {
      items.push({
        type: 'brand',
        id: 'brand-dna',
        label: '品牌规范 (BrandDNA)',
        data: brandDna,
      });
    }
    // Prompts from oh-my-prompt
    try {
      const stored = localStorage.getItem('oh-my-prompt-items');
      if (stored) {
        const promptItems = JSON.parse(stored) as Array<{ id: string; title: string; content: string }>;
        promptItems.forEach(p => {
          items.push({
            type: 'prompt',
            id: p.id,
            label: `提示词: ${p.title}`,
            data: { content: p.content },
          });
        });
      }
    } catch { /* ignore */ }
    return items.filter(item =>
      !mentionPickerSearch || item.label.toLowerCase().includes(mentionPickerSearch.toLowerCase())
    ).slice(0, 50);
  }, [canvasImages, brandDna, mentionPickerSearch]);

  // Handle @ trigger in textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

    // P2-10: 智能体自动路由 - 检测输入是否匹配某个智能体
    if (value.trim().length >= 2) {
      const allAgentsForMatch = [...AGENTS, ...customAgents];
      const matched = matchAgentByInput(value.trim(), allAgentsForMatch);
      // Only suggest if not already using this agent
      if (matched && matched.id !== systemPrompt) {
        setSuggestedAgent(matched);
      } else {
        setSuggestedAgent(null);
      }
    } else {
      setSuggestedAgent(null);
    }

    // Detect @ trigger
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      setMentionPickerOpen(true);
      setMentionPickerSearch(atMatch[1]);
      setMentionPickerIndex(0);
      mentionTriggerRef.current = {
        start: cursorPos - atMatch[0].length,
        end: cursorPos,
      };
    } else {
      setMentionPickerOpen(false);
      mentionTriggerRef.current = null;
    }

    // Detect / trigger for prompt templates
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex >= 0) {
      const charBeforeSlash = lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : ' ';
      // Only trigger if / is at start or after whitespace, and not part of URL (://)
      const isUrlSlash = lastSlashIndex > 0 && textBeforeCursor[lastSlashIndex - 1] === ':';
      if (!isUrlSlash && (lastSlashIndex === 0 || /\s/.test(charBeforeSlash))) {
        const query = textBeforeCursor.slice(lastSlashIndex + 1);
        if (!query.includes('\n') && query.length <= 30) {
          setTemplatePopupSearch(query);
          const results = query ? searchTemplates(query) : getPromptTemplates();
          setTemplatePopupItems(results.slice(0, 20));
          setTemplatePopupIndex(0);
          setTemplatePopupOpen(results.length > 0);
          return;
        }
      }
    }
    setTemplatePopupOpen(false);
  }, []);

  // Select a mention item
  const selectMentionItem = useCallback((item: MentionRef) => {
    if (!mentionTriggerRef.current) return;
    const { start, end } = mentionTriggerRef.current;
    const before = input.slice(0, start);
    const after = input.slice(end);
    setInput(before + after);
    setActiveMentions(prev => {
      if (prev.some(m => m.type === item.type && m.id === item.id)) return prev;
      return [...prev, item];
    });
    // Also add canvas images to pending images for sending as multimodal content
    if (item.type === 'canvas-image' && item.imageUrl) {
      setPendingImages(prev => {
        if (prev.some(p => p.id === item.id)) return prev;
        return [...prev, { id: item.id!, url: item.imageUrl!, name: item.label }];
      });
    }
    setMentionPickerOpen(false);
    mentionTriggerRef.current = null;
    // If brand, also inject into system prompt context
    if (item.type === 'brand' && item.data && onInjectBrandDna) {
      onInjectBrandDna(item.data);
    }
  }, [input, onInjectBrandDna]);

  // Remove a mention
  const removeMention = useCallback((index: number) => {
    setActiveMentions(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ===== End @ Reference System =====

  // ===== P2-1: Tune Mode — Fine-grained parameter adjustment =====
  interface TuneParams {
    strength: number;       // 0-100, how strongly to apply changes
    styleShift: number;     // -50 to +50, shift toward more/less stylized
    colorTone: number;      // -50 to +50, shift toward cooler/warmer
    detailLevel: number;    // 0-100, level of detail to preserve/add
  }
  const [tuneParams, setTuneParams] = useState<TuneParams>({
    strength: 70,
    styleShift: 0,
    colorTone: 0,
    detailLevel: 50,
  });
  const [showTunePanel, setShowTunePanel] = useState(false);
  const tunePanelRef = useRef<HTMLDivElement>(null);

  // 点击空白处关闭Tune面板
  useEffect(() => {
    if (!showTunePanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tunePanelRef.current && !tunePanelRef.current.contains(e.target as Node)) {
        setShowTunePanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTunePanel]);

  const updateTuneParam = useCallback((key: keyof TuneParams, value: number) => {
    setTuneParams(prev => ({ ...prev, [key]: value }));
  }, []);

  // Build tune context string for prompt injection
  const tuneContextString = useMemo(() => {
    if (!showTunePanel) return '';
    const parts: string[] = [];
    if (tuneParams.strength !== 70) parts.push(`修改强度: ${tuneParams.strength}%${tuneParams.strength > 85 ? '(强烈)' : tuneParams.strength < 40 ? '(轻微)' : '(适中)'}`);
    if (tuneParams.styleShift !== 0) parts.push(`风格偏移: ${tuneParams.styleShift > 0 ? '更艺术化' : '更写实'}(${Math.abs(tuneParams.styleShift)}%)`);
    if (tuneParams.colorTone !== 0) parts.push(`色调偏移: ${tuneParams.colorTone > 0 ? '偏暖' : '偏冷'}(${Math.abs(tuneParams.colorTone)}%)`);
    if (tuneParams.detailLevel !== 50) parts.push(`细节程度: ${tuneParams.detailLevel > 70 ? '高细节' : tuneParams.detailLevel < 30 ? '简约' : '标准'}(${tuneParams.detailLevel}%)`);
    return parts.length > 0 ? `\n【精细调节参数】\n${parts.join('\n')}` : '';
  }, [showTunePanel, tuneParams]);

  // ===== End Tune Mode =====

  // ===== P2-3: Tab Completion — Quick command templates =====
  const quickCommands = useMemo(() => [
    { label: '生成图片', prompt: '请生成一张', icon: '🎨' },
    { label: '修改图片', prompt: '请修改这张图片：', icon: '✏️' },
    { label: '调整风格', prompt: '请将风格调整为', icon: '🎭' },
    { label: '换背景', prompt: '请将背景替换为', icon: '🖼️' },
    { label: '优化提示词', prompt: '请帮我优化这个提示词：', icon: '✨' },
    { label: '生成变体', prompt: '请基于这张图生成变体，', icon: '🔄' },
    { label: '添加文字', prompt: '请在图片上添加文字：', icon: '📝' },
    { label: '品牌设计', prompt: '请按照品牌规范设计', icon: '💎' },
  ], []);
  const [showQuickCommands, setShowQuickCommands] = useState(false);

  // ===== End Quick Commands =====

  // 合并内置+自定义智能体
  const allAgents = [...AGENTS, ...customAgents];

  // 加载自定义智能体
  useEffect(() => {
    try {
      const stored = localStorage.getItem('custom-agents');
      if (stored) setCustomAgents(JSON.parse(stored));
    } catch {}
  }, []);

  // ===== Lovart 风格预设 Skills =====
  const LOVART_PRESET_SKILLS: ChatSkill[] = useMemo(() => [
    {
      id: 'preset-ecommerce-listing',
      name: '电商商品套图',
      category: 'image',
      description: '基于产品图生成完整的电商A+内容套图，包含白底主图、卖点图、场景图、尺寸图等8张标准图，遵循亚马逊/淘宝规范',
      systemPrompt: `你是电商视觉设计专家，拥有10年电商视觉设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【交互流程 - 必须严格遵守】
第一步：需求分析
- 识别用户提供的产品图/描述，分析产品类型、目标受众、核心卖点
- 如信息不足，主动追问：产品名称？核心卖点？目标平台？视觉风格偏好？
- 如用户提供了图片，分析图片中产品的外观特征、颜色、材质

第二步：输出设计方案
- 用文字输出完整的套图规划方案，包括：
  • 套图数量和类型（主图+副图+A+页面图，共约15张）
  • 每张图的功能定位和设计意图
  • 统一配色体系和视觉风格
  • 文案方向建议
- 方案末尾必须询问用户："以上方案是否满意？如需调整请告诉我，确认后我将开始生成。"

第三步：用户确认后执行
- 按设计方案逐张生成图片
- 每张图标注类型和设计意图
- 生成过程中保持风格统一

【设计规范】
1. 白底主图：纯白背景，产品居中占70-80%，无文字无水印
2. 副图6张：2张信息图+1张多角度展示+2张场景图+1张细节图
3. A+页面图8张：品牌横幅、痛点场景、卖点矩阵、产品工艺、使用场景、尺码选择、品牌背书等
4. 统一配色，主色≤3种；信息层级清晰；文字安全区域距边缘≥40px；移动端关键文字≥18pt
5. 如用户有参考风格图，分析其色调/排版/字体风格并沿用到所有输出`,
      paramSlots: [
        { name: 'product', label: '产品名称', placeholder: '如：蓝牙音箱' },
        { name: 'features', label: '核心卖点', placeholder: '如：360°音效, 30h续航, IP67防水' },
        { name: 'style', label: '视觉风格', defaultValue: '高端科技感', placeholder: '如：黑金科技/清新自然/温暖家居' },
        { name: 'platform', label: '目标平台', defaultValue: '亚马逊', placeholder: '如：亚马逊/淘宝/京东' },
      ],
      steps: [
        { role: 'user', content: '为我的{{product}}设计一套{{platform}} A+内容套图，卖点是：{{features}}。风格：{{style}}' },
        { role: 'assistant', content: '我来为您设计8张标准A+内容图。首先生成白底主图和卖点矩阵图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-logo-brand',
      name: 'Logo与品牌设计',
      category: 'brand',
      description: '基于Logo/品牌标识生成完整的品牌视觉系统，包括Logo延展、产品周边（T恤/卫衣/帆布包/棒球帽/保温杯）、品牌规范手册',
      systemPrompt: `你是品牌视觉识别系统设计专家，拥有10年品牌设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【交互流程 - 必须严格遵守】
第一步：需求分析
- 分析用户提供的Logo/品牌图，提取品牌色彩、字体风格、核心视觉元素
- 主动追问：品牌名称？行业领域？目标受众？品牌调性（高端/亲民/潮流）？
- 分析Logo的构图特点，确定延展策略

第二步：输出品牌设计方案
- 用文字输出完整的品牌延展方案，包括：
  • Logo变体规划（单色版/反白版/竖版/横版）
  • 品牌色彩体系（主色+辅助色+中性色）
  • 产品周边清单（T恤/卫衣/帆布包/棒球帽/保温杯等）
  • 每个周边的Logo位置、大小、贴合方式
  • 材质适配方案（布料/金属/纸张各有不同处理）
- 方案末尾必须询问用户："以上品牌延展方案是否满意？如需调整请告诉我，确认后我将开始生成。"

第三步：用户确认后执行
- 逐个生成周边效果图，展示真实材质质感
- Logo位置/大小/角度精准贴合载体
- 统一品牌色彩贯穿所有输出
- 生成后标注设计意图和品牌规范说明

【品牌延展规范】
1. Logo保持完整性，不变形不裁切，不同材质适配透视角度
2. T恤：Logo左胸或中心；卫衣：放大居中或背部大图；帆布包：居中偏下考虑褶皱；棒球帽：居中正面占40-50%；保温杯：环绕或正面考虑曲面贴合
3. 从Logo提取主色+辅助色，所有衍生品统一配色
4. 安全区域：Logo周围留出至少Logo高度1/4的空白
5. 禁忌：Logo不得倾斜超过15°、不得拉伸变形、不得被遮挡超过10%`,
      paramSlots: [
        { name: 'brandName', label: '品牌名称', placeholder: '如：SoundWave' },
        { name: 'industry', label: '行业领域', placeholder: '如：科技/餐饮/时尚' },
        { name: 'colorScheme', label: '品牌色彩', defaultValue: '黑金配色', placeholder: '如：黑金/蓝白/绿色系' },
        { name: 'deliverables', label: '交付物', defaultValue: '全套周边', placeholder: '如：T恤+帽子+帆布包 / Logo变体+品牌手册' },
      ],
      steps: [
        { role: 'user', content: '为{{brandName}}品牌设计{{deliverables}}，行业：{{industry}}，配色：{{colorScheme}}' },
        { role: 'assistant', content: '我来为您设计完整的品牌视觉延展。首先确认品牌色彩体系，然后逐步生成周边效果图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-storyboard',
      name: '分镜故事板',
      category: 'image',
      description: '根据产品/场景描述生成专业分镜故事板，包含镜头规划、场景设计、视觉描述、技术规格标注，适用于短视频/广告片',
      systemPrompt: `你是专业影视分镜师，拥有10年广告和短视频分镜经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【交互流程 - 必须严格遵守】
第一步：需求分析
- 分析用户的创意需求，确定视频类型（广告/短视频/动画）
- 主动追问：主角是什么？故事背景？目标时长？画幅比例？视觉风格？
- 如用户提供了产品图/角色图，分析其视觉特征

第二步：输出分镜方案
- 用文字输出完整的分镜规划方案，包括：
  • 镜头总数和时长分配（30秒=8-10镜，60秒=15-18镜）
  • 每个镜头的：景别/运镜/时长/场景描述/视觉描述
  • 转场方式设计
  • 统一色彩风格和调色方案
  • 产品/角色在每镜中的位置和动作
- 方案末尾必须询问用户："以上分镜方案是否满意？如需调整镜头或场景请告诉我，确认后我将开始逐镜生成。"

第三步：用户确认后执行
- 按方案逐镜头生成分镜图，风格统一
- 每张图下方标注：镜头编号、时长、景别、运镜方式
- 最终组装为专业分镜故事板排版

【分镜规范】
1. 镜头规划：每个镜头标注景别(全景/中景/近景/特写)+运镜(推/拉/摇/移/固定)+精确时长
2. 画面描述：主体位置/环境氛围/光线方向/色调倾向/运动方向
3. 技术规格：画幅16:9或9:16，分辨率≥1920x1080，统一调色方案
4. 角色一致性：主角外观/服装/道具在所有镜头中保持一致`,
      paramSlots: [
        { name: 'concept', label: '创意概念', placeholder: '如：户外露营蓝牙音箱广告' },
        { name: 'duration', label: '视频时长', defaultValue: '30秒', placeholder: '如：30秒/60秒/90秒' },
        { name: 'scenes', label: '场景列表', placeholder: '如：户外露营,城市通勤,海滩派对,产品特写' },
        { name: 'style', label: '视觉风格', defaultValue: '写实摄影，电影感', placeholder: '如：写实摄影/动画风格/概念艺术' },
        { name: 'aspectRatio', label: '画幅比例', defaultValue: '16:9', placeholder: '如：16:9(横屏)/9:16(竖屏)' },
      ],
      steps: [
        { role: 'user', content: '为{{concept}}设计{{duration}}广告分镜，场景：{{scenes}}，风格：{{style}}，画幅：{{aspectRatio}}' },
        { role: 'assistant', content: '我来规划分镜。首先确定镜头数量和时长分配，然后输出完整的镜头规划表...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-marketing-brochure',
      name: '营销宣传册',
      category: 'design',
      description: '生成专业三折页/双折页宣传册设计，包含封面、内页、封底，自动排版文案与图片，遵循印刷规范',
      systemPrompt: `你是专业印刷品设计师，拥有10年宣传册设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【交互流程 - 必须严格遵守】
第一步：需求分析
- 分析用户的产品/服务特点和宣传目标
- 主动追问：产品核心卖点？目标受众？使用场景（展会/门店/寄送）？
- 如用户提供了产品图，分析其视觉特征和品牌调性
- 推荐折页类型：信息量大→三折页，简洁高端→双折页

第二步：输出设计方案
- 用文字输出完整的宣传册设计方案，包括：
  • 折页类型和页面结构（三折页6面/双折页4面）
  • 每一面的功能定位和内容分配
  • 整体配色体系和视觉风格
  • 文案分布和图片位置规划
  • 品牌元素贯穿策略
- 方案末尾必须询问用户："以上宣传册方案是否满意？如需调整页面内容或风格请告诉我，确认后我将开始逐面生成。"

第三步：用户确认后执行
- 按方案逐面生成设计图，确保视觉连贯
- 封面抓眼球，内页讲卖点，封底促行动
- 所有页面统一配色、字体层级、品牌元素
- 文字内容分区域标注，便于后续编辑

【印刷规范】
- 安全区域：距裁切线≥5mm，距折痕≥8mm
- 出血线：向外延伸3mm
- 正文字号≥9pt，标题≥18pt
- 配色主色≤3种，图片与文字比≈40:60，留白≥15%`,
      paramSlots: [
        { name: 'product', label: '产品/服务', placeholder: '如：蓝牙音箱' },
        { name: 'format', label: '折页类型', defaultValue: '三折页', placeholder: '如：三折页/双折页' },
        { name: 'highlights', label: '核心内容', placeholder: '如：360°音效, 30h续航, IP67防水' },
        { name: 'style', label: '视觉风格', defaultValue: '高端科技感', placeholder: '如：黑金科技/清新自然/商务简约' },
      ],
      steps: [
        { role: 'user', content: '为{{product}}设计一份{{format}}宣传册，核心内容：{{highlights}}，风格：{{style}}' },
        { role: 'assistant', content: '我来设计宣传册。首先确认内容大纲和页面分配，然后逐面生成设计...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-social-media',
      name: '社交媒体套图',
      category: 'image',
      description: '生成适配各社交平台（Instagram/小红书/微信朋友圈/微博）的统一风格套图，自动适配不同尺寸和排版规范',
      systemPrompt: `你是社交媒体视觉设计专家，拥有8年品牌社媒运营设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【交互流程 - 必须严格遵守】
第一步：需求分析
- 分析用户的推广主题、品牌调性和目标受众
- 主动追问：推广的具体产品/活动？主推哪些平台？现有品牌素材（Logo/产品图/参考图）？
- 如用户提供了图片，分析其视觉特征和可复用元素
- 推荐平台组合：国内→小红书+微信+微博，海外→Instagram+TikTok

第二步：输出设计方案
- 用文字输出完整的社媒套图方案，包括：
  • 目标平台和对应尺寸清单
  • 每张图的功能定位（封面/产品展示/卖点图/场景图/行动召唤）
  • 统一视觉体系：配色、字体风格、图形元素
  • 文案策略：标题/正文/标签建议
  • 图片数量和排版规划
- 方案末尾必须询问用户："以上社媒套图方案是否满意？如需调整平台、数量或风格请告诉我，确认后我将开始批量生成。"

第三步：用户确认后执行
- 按方案批量生成图片，确保风格统一
- 不同平台自动适配尺寸和排版密度
- 品牌元素（Logo/色彩/字体）贯穿所有图片
- 每张图一个核心信息，文字可读性优先

【平台规范】
- Instagram：方图1080x1080 / 竖图1080x1350 / Stories 1080x1920，文字≤20%
- 小红书：竖图1080x1440(3:4)，封面必须有标题文字≥36pt
- 微信朋友圈：方图1080x1080 / 横图1080x720，一图一核心
- 微博：横图1080x608 / 方图1080x1080，首图最关键`,
      paramSlots: [
        { name: 'subject', label: '推广主题', placeholder: '如：新品发布/节日促销/品牌故事' },
        { name: 'platforms', label: '目标平台', defaultValue: '小红书+微信', placeholder: '如：Instagram/小红书/微信/微博' },
        { name: 'count', label: '图片数量', defaultValue: '6', placeholder: '如：4/6/9' },
        { name: 'tone', label: '品牌调性', placeholder: '如：年轻活力/高端奢华/温暖治愈' },
      ],
      steps: [
        { role: 'user', content: '为{{subject}}设计{{count}}张{{platforms}}套图，品牌调性：{{tone}}' },
        { role: 'assistant', content: '我来设计社交媒体套图。首先确认各平台的尺寸规范，然后统一视觉风格批量生成...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-ip-character',
      name: 'IP角色设计',
      category: 'design',
      description: '从零设计IP角色/吉祥物，包含角色三视图、表情包、动作延展、应用场景展示，确保角色一致性和可延展性',
      systemPrompt: `你是IP角色设计专家，擅长创造具有高辨识度和商业延展性的IP形象。

【工作流程】你必须在生成任何图片前完成以下步骤：
第一步·需求分析：根据用户描述，明确角色定位（目标受众/应用场景/情感调性），识别用户提供的参考素材
第二步·方案输出：输出完整的IP角色设计方案，包含：角色设定（性格/视觉符号/配色）、三视图规划、表情系统规划、动作延展规划、应用场景规划。告知用户「确认方案后我将开始生成」
第三步·等待确认：用户确认或修改方案后，开始逐项生成图片
第四步·执行交付：按确认方案依次生成，每张图附带设计说明

IP角色设计规范：
1. 角色设定：
   - 性格特征：3-5个核心性格关键词
   - 视觉符号：至少1个独特识别元素（如帽子/围巾/形状）
   - 配色方案：主色1种+辅色2种，色彩饱和度适中
2. 三视图：
   - 正面/侧面/背面标准站姿
   - 比例标注（头身比/四肢长度）
   - 细节标注（材质/纹理/配件）
3. 表情系统（8-12个）：
   - 基础：开心/悲伤/愤怒/惊讶
   - 扩展：害羞/得意/懵圈/感动/酷/困/饿/爱
   - 表情幅度大，特征元素保持不变
4. 动作延展（6-8个）：
   - 日常动作：走路/跑步/坐着/躺着
   - 功能动作：招手/指路/搬运/工作
   - 动态线条和辅助图形增强动感
5. 应用场景：
   - 周边产品：公仔/贴纸/帆布袋/手机壳
   - 数字场景：头像/表情包/壁纸/直播挂件

角色一致性原则：
- 核心轮廓和比例在所有视角和表情中保持一致
- 识别元素（配饰/特征形状）不可省略
- 配色不可偏移超过±10%色相`,
      paramSlots: [
        { name: 'characterName', label: '角色名称', placeholder: '如：小星星/豆豆熊' },
        { name: 'characterType', label: '角色类型', placeholder: '如：动物/人物/抽象生物/食物拟人' },
        { name: 'personality', label: '性格特征', placeholder: '如：活泼开朗/慵懒可爱/酷帅高冷' },
        { name: 'industry', label: '应用行业', placeholder: '如：儿童教育/餐饮/科技/文旅' },
        { name: 'style', label: '视觉风格', defaultValue: '圆润可爱', placeholder: '如：圆润可爱/扁平极简/潮酷街头' },
      ],
      steps: [
        { role: 'user', content: '设计一个IP角色「{{characterName}}」，类型：{{characterType}}，性格：{{personality}}，用于{{industry}}行业，风格：{{style}}' },
        { role: 'assistant', content: '我来设计这个IP角色。首先确定角色设定和视觉符号，然后生成三视图、表情包和动作延展...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-product-packaging',
      name: '产品包装设计',
      category: 'design',
      description: '设计产品包装盒/袋/瓶身，包含正面主视觉、侧面信息、底部标签，遵循包装印刷规范和条码/营养标签标准',
      systemPrompt: `你是产品包装设计专家，擅长从品牌策略到包装落地的全流程设计。

【工作流程】你必须在生成任何图片前完成以下步骤：
第一步·需求分析：根据用户描述，明确产品定位、品牌调性、目标人群、包装形式。识别用户提供的参考素材（Logo/产品图/品牌色）
第二步·方案输出：输出完整的包装设计方案，包含：包装结构选择、视觉策略（主视觉方向/配色/字体/图案）、信息层级规划、材质工艺建议。告知用户「确认方案后我将开始生成」
第三步·等待确认：用户确认或修改方案后，开始逐项生成图片
第四步·执行交付：按确认方案依次生成，每张图附带设计说明

包装设计规范：
1. 正面（主视觉面）：
   - 品牌Logo位于顶部1/4区域
   - 产品名称突出，字号≥28pt
   - 产品实物图或艺术图占50-60%面积
   - 核心卖点标签（如"新品"/"有机"）≤3个
2. 侧面/背面：
   - 产品说明文字≥8pt
   - 成分/参数表：表格形式，字号≥7pt
   - 使用说明：步骤化+图标辅助
   - 条码区域：EAN-13标准，尺寸≥80%标准
3. 底部：
   - 生产商信息
   - 批号/日期区域预留
   - 环保标识/认证标志
4. 印刷规范：
   - CMYK色值标注
   - 出血3mm，安全区5mm
   - 文字转曲标注
   - 专色标注（如有）

设计原则：
- 货架吸引力：3米外可识别品牌和品类
- 信息层级：品牌>产品名>卖点>详细说明
- 材质适配：哑光纸/铜版纸/磨砂/烫金效果标注`,
      paramSlots: [
        { name: 'product', label: '产品名称', placeholder: '如：有机抹茶粉' },
        { name: 'packagingType', label: '包装类型', placeholder: '如：纸盒/玻璃瓶/铝罐/软包装' },
        { name: 'size', label: '规格尺寸', placeholder: '如：200g/330ml/30x20x5cm' },
        { name: 'style', label: '设计风格', placeholder: '如：日系简约/中式国潮/北欧极简' },
        { name: 'shelf', label: '货架场景', defaultValue: '商超货架', placeholder: '如：商超货架/电商详情/便利店' },
      ],
      steps: [
        { role: 'user', content: '为{{product}}设计{{packagingType}}包装，规格{{size}}，风格{{style}}，货架场景：{{shelf}}' },
        { role: 'assistant', content: '我来设计产品包装。首先确定主视觉方向，然后生成正面、侧面和底部的完整包装展开图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-concept-art',
      name: '概念场景设计',
      category: 'image',
      description: '生成游戏/影视/建筑的概念场景设计，包含氛围图、建筑/场景白模、材质板、光影研究，适合前期概念阶段',
      systemPrompt: `你是概念艺术设计师，拥有10年游戏/影视概念设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 项目类型（游戏/影视/动画/建筑）
- 场景描述和核心概念
- 氛围基调（暗黑/梦幻/科幻/古风/末日等）
- 艺术风格（写实概念/赛博朋克/水墨国风/低多边形等）
- 画面比例需求（16:9影视/21:9宽屏/1:1社交）

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 氛围方案：主色调+2-3种辅助色，光影方向，色温
2. 构图方案：透视类型（一点/两点/三点），视角（鸟瞰/仰视/平视），焦点区域
3. 层次规划：前景/中景/远景的内容安排
4. 材质标注：主要材质（石材/金属/木材/植被）及表面处理（风化/打磨/腐蚀/发光）
5. 光影研究：时段方案（日间/夜间/黄昏），特效标注（体积光/雾气/粒子）
6. 输出计划：需要生成的图片列表，每张图的内容描述和比例

【第三步：等待确认】
明确询问用户："以上方案是否确认？需要调整哪些部分？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐张生成图片，每张附带设计说明和材质/光影标注。`,
      paramSlots: [
        { name: 'scene', label: '场景描述', placeholder: '如：悬浮在云层之上的古代神殿' },
        { name: 'project', label: '项目类型', placeholder: '如：游戏/电影/建筑/动画' },
        { name: 'mood', label: '氛围基调', placeholder: '如：史诗磅礴/神秘阴森/温馨治愈' },
        { name: 'style', label: '艺术风格', defaultValue: '写实概念艺术', placeholder: '如：写实概念/赛博朋克/水墨国风' },
      ],
      steps: [
        { role: 'user', content: '为{{project}}项目设计场景：{{scene}}，氛围：{{mood}}，风格：{{style}}' },
        { role: 'assistant', content: '我来设计概念场景。首先确认氛围和色彩方案，然后生成氛围图和场景构图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-interior-design',
      name: '室内设计全流程',
      category: 'design',
      description: '专业室内设计出图助手，支持空间效果图、彩平图、材质拼板、家具布局方案、细部大样等多种输出类型，全流程覆盖从概念到落地',
      systemPrompt: `你是资深室内设计师，拥有10年高端住宅/商业空间设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 空间类型（客厅/卧室/餐厅/办公室/酒店大堂等）
- 面积和户型信息
- 设计风格（现代简约/北欧/新中式/侘寂/工业风等）
- 输出需求（空间效果图/彩平图/材质拼板/家具布局/细部大样/全部）
- 预算档次（经济型/中档/高端/奢华）

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 空间规划：功能分区+动线设计+人体工程学尺寸（过道≥80cm，转身空间≥60cm）
2. 风格方案：主色调+辅助色+点缀色，整体氛围描述
3. 材质方案：主材/辅材/软装三大类，材质名称+色号参考+搭配协调性说明
4. 家具方案：核心家具选型+尺寸标注（长x宽x高）+品牌参考
5. 灯光方案：基础照明+重点照明+氛围照明的布局规划
6. 输出计划：需要生成的图片列表（效果图视角/彩平图/材质板等）

【第三步：等待确认】
明确询问用户："以上方案是否确认？需要调整哪些部分？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐张生成图片：
- 空间效果图：至少2个视角，标注材质/色彩/灯光，比例16:9或4:3
- 彩平图：标注房间名称/面积/动线箭头/比例尺
- 材质拼板：主材/辅材/软装分区展示，标注名称/色号
- 细部大样：关键节点放大，标注工艺做法和材料层次`,
      paramSlots: [
        { name: 'spaceType', label: '空间类型', placeholder: '如：客厅/卧室/餐厅/办公室/酒店大堂' },
        { name: 'area', label: '面积', placeholder: '如：30㎡/120㎡' },
        { name: 'style', label: '设计风格', defaultValue: '现代简约', placeholder: '如：现代简约/北欧/新中式/侘寂/工业风' },
        { name: 'outputType', label: '输出类型', defaultValue: '空间效果图+彩平图', placeholder: '如：空间效果图/彩平图/材质拼板/家具布局/细部大样/全部' },
        { name: 'budget', label: '预算档次', placeholder: '如：经济型/中档/高端/奢华' },
      ],
      steps: [
        { role: 'user', content: '为{{area}}的{{spaceType}}做室内设计，风格：{{style}}，输出：{{outputType}}，预算：{{budget}}' },
        { role: 'assistant', content: '我来为您进行室内设计。首先确认空间尺寸和功能分区，然后逐步生成设计方案...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-poster-design',
      name: '创意海报设计',
      category: 'design',
      description: '生成各类创意海报，支持节日海报、活动海报、品牌海报、电影海报等，自动排版文字与视觉，兼顾视觉冲击力和信息传达',
      systemPrompt: `你是资深平面海报设计师，拥有10年品牌视觉设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 海报主题和核心信息
- 海报类型（节日/活动/品牌/电影/促销/招聘等）
- 尺寸比例（3:4竖版/16:9横版/1:1方图/9:16手机端）
- 视觉调性（高端奢华/活力青春/温馨治愈/震撼史诗等）
- 品牌色或配色偏好
- 文字内容（标题/副标题/时间地点/CTA等）

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 构图方案：视觉层级（主视觉40-60%→主标题≥48pt→副标题≥24pt→辅助信息≥12pt）+构图法则（三分法/黄金分割/对称/对角线）+视觉引导线
2. 色彩方案：主色≤2种+辅色≤3种，确保高对比度可读性
3. 字体方案：标题字体风格（力量感/优雅/童趣/科技）+中英文混排+行距1.2-1.5倍
4. 留白策略：≥20%，避免视觉拥挤
5. 输出计划：需要生成的图片列表和数量

【第三步：等待确认】
明确询问用户："以上方案是否确认？需要调整哪些部分？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐张生成海报，确保：
- 节日海报：节日元素+品牌植入+祝福语
- 活动海报：时间地点醒目+CTA清晰
- 品牌海报：品牌调性贯穿+产品/服务自然融入
- 电影海报：氛围先行+标题戏剧化+主视觉叙事`,
      paramSlots: [
        { name: 'subject', label: '海报主题', placeholder: '如：国庆节促销/新品发布/电影上映' },
        { name: 'posterType', label: '海报类型', defaultValue: '品牌海报', placeholder: '如：节日海报/活动海报/品牌海报/电影海报' },
        { name: 'size', label: '尺寸比例', defaultValue: '3:4竖版', placeholder: '如：3:4竖版/16:9横版/1:1方图/9:16手机端' },
        { name: 'tone', label: '视觉调性', placeholder: '如：高端奢华/活力青春/温馨治愈/震撼史诗' },
        { name: 'brandColor', label: '品牌色', placeholder: '如：品牌蓝#0066FF/无特殊要求' },
      ],
      steps: [
        { role: 'user', content: '设计一张{{posterType}}，主题：{{subject}}，尺寸：{{size}}，调性：{{tone}}，品牌色：{{brandColor}}' },
        { role: 'assistant', content: '我来设计海报。首先确定视觉方向和构图方案，然后生成完整海报设计...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-ppt-design',
      name: 'PPT演示文稿设计',
      category: 'design',
      description: '智能生成带排版设计的完整PPT，支持商业汇报/产品发布/培训课件等场景，每页可编辑且风格统一',
      systemPrompt: `你是专业PPT设计师，拥有10年演示文稿设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 演示主题和核心目标
- 使用场景（商业汇报/产品发布/培训课件/学术答辩等）
- 预计页数和章节划分
- 设计风格（商务简约/科技未来/创意活力/学术严谨）
- 配色方案偏好
- 是否有品牌规范需要遵循

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 内容大纲：封面→目录→各章节内容要点→总结→结尾，每页一个核心观点
2. 版式规划：标题区（上方1/4）+内容区（中部2/3，图文比50:50）+页脚（页码+品牌）
3. 视觉体系：主色1种+辅色2种，字体≤3种，图标/图表风格统一，图片风格统一
4. 数据可视化方案：表格≤5行5列/图表类型/流程图≤6步
5. 输出计划：每页独立图片，16:9比例，总计N页

【第三步：等待确认】
明确询问用户："以上PPT大纲和设计方案是否确认？需要调整哪些章节或页面？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐页生成PPT，确保：
- 每页文字≤50字（中文），图文搭配清晰
- 页码标注，方便排序
- 风格统一，配色一致贯穿全部页面
- 封面页含标题+副标题+日期/品牌
- 数据页使用图表可视化，重点数据高亮`,
      paramSlots: [
        { name: 'topic', label: '演示主题', placeholder: '如：2025年度营销复盘/AI产品发布' },
        { name: 'scenario', label: '使用场景', defaultValue: '商业汇报', placeholder: '如：商业汇报/产品发布/培训课件/学术答辩' },
        { name: 'pages', label: '页数', defaultValue: '12', placeholder: '如：8/12/16/20' },
        { name: 'style', label: '设计风格', defaultValue: '商务简约', placeholder: '如：商务简约/科技未来/创意活力/学术严谨' },
        { name: 'colorScheme', label: '配色方案', placeholder: '如：蓝色商务/橙色活力/绿色清新/黑色高端' },
      ],
      steps: [
        { role: 'user', content: '创建一份{{pages}}页的{{scenario}}PPT，主题：{{topic}}，风格：{{style}}，配色：{{colorScheme}}' },
        { role: 'assistant', content: '我来设计PPT。首先梳理内容大纲和页面结构，然后逐页生成设计...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-magazine-cover',
      name: '杂志封面设计',
      category: 'design',
      description: '设计专业杂志封面，包含主视觉、标题排版、条目预告，遵循杂志出版规范，支持时尚/科技/生活方式等多种类型',
      systemPrompt: `你是资深杂志艺术总监，拥有10年杂志出版设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 杂志名称和类型（时尚/科技/生活方式/商业/艺术）
- 封面主题和本期核心话题
- 封面风格偏好（极简高级/大胆前卫/温暖人文/冷峻科技）
- 期号和日期
- 是否有品牌规范需要遵循

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 封面类型：人物封面/产品封面/概念封面
2. 主视觉方向：占据60-80%面积，描述视觉主题和构图
3. 标题排版规划：
   - 刊名位置和风格（顶部居中/左侧，每期一致）
   - 主标题内容和位置（≥36pt）
   - 副标题和3-5条条目预告
4. 配色策略：
   - 时尚类：高饱和度+大胆撞色
   - 科技类：冷色调+渐变+光效
   - 生活方式：暖色调+自然色系
   - 商业类：深色调+金属点缀
5. 排版规则说明：文字不遮挡主视觉核心，条目沿边缘排列

【第三步：等待确认】
明确询问用户："以上杂志封面设计方案是否确认？需要调整哪些元素？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成封面，确保：
- 主视觉突出，留出标题区域（顶部1/4和底部1/5）
- 文字层级清晰：刊名>主标题>副标题>条目
- 视觉焦点避开文字区域
- 条形码区域右下角预留`,
      paramSlots: [
        { name: 'magazineName', label: '杂志名称', placeholder: '如：VISION/ELITE/TREND' },
        { name: 'magazineType', label: '杂志类型', defaultValue: '时尚', placeholder: '如：时尚/科技/生活方式/商业/艺术' },
        { name: 'coverSubject', label: '封面主题', placeholder: '如：春季时装趋势/AI未来十年/城市生活' },
        { name: 'coverStyle', label: '封面风格', placeholder: '如：极简高级/大胆前卫/温暖人文/冷峻科技' },
        { name: 'issue', label: '期号', placeholder: '如：2025年6月刊/第42期' },
      ],
      steps: [
        { role: 'user', content: '为「{{magazineName}}」设计{{magazineType}}类杂志封面，{{issue}}，主题：{{coverSubject}}，风格：{{coverStyle}}' },
        { role: 'assistant', content: '我来设计杂志封面。首先确定主视觉方向和标题排版，然后生成完整封面...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-apparel-fashion',
      name: '服装时尚设计',
      category: 'design',
      description: '设计服装款式图和时尚效果图，包含正反面款式图、面料搭配、穿着效果展示，支持休闲/正装/运动/潮牌等风格',
      systemPrompt: `你是专业服装设计师，拥有10年时尚品牌设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 服装类型（T恤/连衣裙/西装/运动外套/卫衣等）
- 目标性别和年龄段
- 风格定位（极简都市/街头潮牌/法式优雅/机能风等）
- 季节和穿着场景
- 面料偏好和预算范围
- 是否有品牌调性或参考图

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 设计概念：灵感来源和设计故事
2. 款式规划：
   - 正面+背面款式图说明
   - 领型/袖型/下摆/腰线选择
   - 关键细节：缝线/纽扣/拉链/口袋
3. 面料搭配方案：
   - 主面料（占80%面积）+ 辅面料
   - 色板：主色+辅色+点缀色
   - 图案方向（纯色/条纹/格纹/印花）
4. 穿着效果规划：
   - 模特姿势和场景
   - 配饰搭配建议
5. 风格调性：
   - 休闲：宽松廓形，舒适面料，低调配色
   - 正装：修身剪裁，精致面料，沉稳配色
   - 运动：功能面料，人体工学剪裁，活力色彩
   - 潮牌：大胆廓形，创新面料，撞色/印花

【第三步：等待确认】
明确询问用户："以上服装设计方案是否确认？需要调整哪些元素？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成，确保：
- 款式图线条清晰，比例精确
- 着装效果展示面料质感
- 配色和细节与方案一致
- 搭配建议合理完整`,
      paramSlots: [
        { name: 'garmentType', label: '服装类型', placeholder: '如：T恤/连衣裙/西装/运动外套/卫衣' },
        { name: 'targetGender', label: '目标性别', defaultValue: '中性', placeholder: '如：男装/女装/中性/童装' },
        { name: 'style', label: '风格定位', placeholder: '如：极简都市/街头潮牌/法式优雅/机能风' },
        { name: 'season', label: '季节', placeholder: '如：春夏/秋冬/四季通用' },
        { name: 'fabric', label: '面料偏好', placeholder: '如：纯棉/羊毛/丝绸/科技面料' },
      ],
      steps: [
        { role: 'user', content: '设计{{targetGender}}{{garmentType}}，风格：{{style}}，季节：{{season}}，面料偏好：{{fabric}}' },
        { role: 'assistant', content: '我来设计服装。首先确定廓形和配色方向，然后生成款式图和效果图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-business-card',
      name: '名片设计',
      category: 'design',
      description: '设计高端商务名片，包含正面+背面设计，支持多种材质效果展示，遵循名片印刷规范',
      systemPrompt: `你是专业名片设计师，拥有10年品牌视觉设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 姓名、职位、公司名称
- 联系方式（电话/邮箱/地址/网站）
- 品牌Logo或视觉识别元素
- 行业属性（科技/金融/创意/法律/医疗等）
- 设计风格偏好（简约商务/创意个性/高端奢华/科技未来）
- 材质效果偏好（铜版光面/哑粉哑光/特种纸/烫金/透明）
- 是否需要双语设计

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 设计概念：基于行业属性和品牌调性的设计方向
2. 正面设计规划：
   - 布局方式（横版/竖版/对称/非对称）
   - 视觉层级：品牌Logo + 姓名 + 职位的位置和大小关系
   - 留白比例：≥10%，确保呼吸感
3. 背面设计规划：
   - 联系方式排版（左对齐/居中/右对齐）
   - 是否包含二维码/社交媒体图标/品牌Slogan
4. 色彩方案：
   - 主色+辅色+点缀色
   - 行业配色建议（科技蓝/金融深蓝/创意彩色/法律深灰等）
5. 材质与工艺：
   - 纸张选择（铜版纸/哑粉纸/特种纸）
   - 特殊工艺（烫金/UV/凹凸/圆角）
6. 印刷规格：
   - 尺寸标准（90x54mm/85x55mm）
   - 出血2mm，安全区3mm，300dpi

【第三步：等待确认】
明确询问用户："以上名片设计方案是否确认？需要调整哪些元素？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成，确保：
- 正面+背面完整设计
- 信息层级清晰，阅读舒适
- 配色与行业属性匹配
- 材质质感表现真实
- 符合印刷规范`,
      paramSlots: [
        { name: 'name', label: '姓名', placeholder: '如：张三/John Smith' },
        { name: 'title', label: '职位/公司', placeholder: '如：CEO·星辰科技' },
        { name: 'contact', label: '联系方式', placeholder: '如：138-0000-0000 / john@star.com' },
        { name: 'style', label: '设计风格', defaultValue: '简约商务', placeholder: '如：简约商务/创意个性/高端奢华/科技未来' },
        { name: 'material', label: '材质效果', defaultValue: '哑光质感', placeholder: '如：铜版光面/哑粉哑光/特种纸/烫金' },
      ],
      steps: [
        { role: 'user', content: '为{{name}}设计名片，职位：{{title}}，联系方式：{{contact}}，风格：{{style}}，材质：{{material}}' },
        { role: 'assistant', content: '我来设计名片。首先确定布局和品牌元素，然后生成正面和背面设计...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-book-cover',
      name: '书籍封面设计',
      category: 'design',
      description: '设计书籍封面，包含封面+书脊+封底三面展开图，兼顾美学表现和市场吸引力，支持小说/社科/童书/教材等类型',
      systemPrompt: `你是资深书籍装帧设计师，拥有10年书籍封面设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 书名、作者名
- 书籍类型（小说/社科/童书/教材/诗集/传记）
- 内容主题和核心叙事
- 目标读者画像
- 设计风格偏好（极简文艺/写实摄影/手绘插画/概念抽象）
- 是否有参考封面或品牌要求
- 特殊工艺偏好（覆膜/UV/起凸/烫金）

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 设计概念：封面主视觉创意方向，至少提供2个方向供选择
2. 封面设计规划：
   - 主视觉：与书籍内容高度相关的视觉方案
   - 书名排版：字号≥36pt，3米外可识别，字体匹配内容调性
   - 作者名位置：封面底部1/4或顶部
   - 推荐语/奖项：≤2条，小字标注
   - 留白比例：≥15%
3. 书脊设计：
   - 书名排列方式（纵向/横向，取决于书脊宽度）
   - 作者名+出版社Logo
4. 封底设计：
   - 内容简介（150-300字）
   - 作者简介（50-100字）
   - 条形码+定价位置
5. 色彩方案：
   - 根据书籍类型适配（小说→情感化，社科→理性，童书→高饱和，教材→功能导向）
   - 主色+辅色+点缀色
6. 印刷规格：
   - 展开尺寸：封面+书脊+封底+出血
   - CMYK，300dpi

【第三步：等待确认】
明确询问用户："以上封面设计方案是否确认？需要调整哪些元素？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成，确保：
- 封面+书脊+封底三面展开图完整
- 书名醒目可读，与内容调性匹配
- 主视觉与书籍内容高度相关
- 封面/封底视觉呼应
- 符合印刷规范`,
      paramSlots: [
        { name: 'bookTitle', label: '书名', placeholder: '如：星际迷途/设计心理学' },
        { name: 'author', label: '作者', placeholder: '如：李明/John Doe' },
        { name: 'bookType', label: '书籍类型', defaultValue: '小说', placeholder: '如：小说/社科/童书/教材/诗集/传记' },
        { name: 'theme', label: '内容主题', placeholder: '如：科幻冒险/自我成长/自然科普' },
        { name: 'style', label: '设计风格', placeholder: '如：极简文艺/写实摄影/手绘插画/概念抽象' },
      ],
      steps: [
        { role: 'user', content: '为《{{bookTitle}}》设计封面，作者：{{author}}，类型：{{bookType}}，主题：{{theme}}，风格：{{style}}' },
        { role: 'assistant', content: '我来设计书籍封面。首先确定主视觉方向和排版方案，然后生成封面+书脊+封底展开图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-sticker-emoji',
      name: '贴纸表情包',
      category: 'design',
      description: '设计统一风格的贴纸/表情包系列，支持微信表情/LINE贴纸/品牌IP衍生，8-24张一套，角色一致性和表情差异化兼顾',
      systemPrompt: `你是贴纸/表情包设计专家，拥有10年IP形象和表情包设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 角色描述（IP形象/动物/人物/品牌吉祥物）
- 目标平台（微信/LINE/Telegram/品牌自用）
- 使用场景（日常聊天/品牌营销/粉丝社群/节日主题）
- 绘画风格偏好（圆润可爱/扁平极简/像素风/手绘涂鸦/Q版）
- 表情数量（8/16/24张）
- 是否有品牌色/Logo需要融入

【第二步：提出设计方案】
根据用户需求，输出结构化的设计方案（文字形式，不生成图片）：
1. 角色设定：
   - 核心轮廓和特征（头身比/五官比例/标志性配饰）
   - 主色调+辅色，保持全局一致
   - 识别符号（确保每个角色有独特记忆点）
2. 表情矩阵规划：
   - 基础情绪（6张）：开心/难过/生气/惊讶/害羞/无语
   - 社交用语（6张）：OK/谢谢/加油/抱歉/晚安/早安
   - 流行语（4-6张）：绝了/emo/好耶/寄了/摸鱼/卷王
   - 动作姿态（4-6张）：奔跑/瘫倒/拥抱/比心/哭泣/鼓掌
3. 设计规范：
   - 线条粗细/圆角弧度/色彩饱和度统一
   - 表情幅度夸张≥真实，远距离可识别
   - 辅助符号：汗滴/爱心/火焰/闪电增强表达
   - 留白≥10%，角色不贴边
   - 无文字优先，纯图像表达
4. 尺寸规格：
   - 微信表情：240x240px
   - LINE贴纸：370x320px
   - 通用：512x512px

【第三步：等待确认】
明确询问用户："以上表情包设计方案是否确认？需要调整角色设定或表情矩阵吗？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐批生成，确保：
- 角色核心轮廓一致（头身比/五官比例±5%偏差）
- 配色不偏移（±10%色相）
- 识别元素不省略
- 每张表情情感表达清晰可辨`,
      paramSlots: [
        { name: 'character', label: '角色描述', placeholder: '如：一只橘色胖猫/穿西装的兔子' },
        { name: 'count', label: '表情数量', defaultValue: '16', placeholder: '如：8/16/24' },
        { name: 'style', label: '绘画风格', defaultValue: '圆润可爱', placeholder: '如：圆润可爱/扁平极简/像素风/手绘涂鸦' },
        { name: 'platform', label: '目标平台', defaultValue: '微信', placeholder: '如：微信/LINE/Telegram/通用' },
        { name: 'usage', label: '使用场景', placeholder: '如：日常聊天/品牌营销/粉丝社群' },
      ],
      steps: [
        { role: 'user', content: '设计一套{{count}}张{{character}}表情包，风格：{{style}}，平台：{{platform}}，场景：{{usage}}' },
        { role: 'assistant', content: '我来设计表情包。首先确定角色设计和风格，然后规划表情矩阵并批量生成...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-comic-manga',
      name: '漫画连环画创作',
      category: 'image',
      description: '创作分格漫画/连环画，包含分镜构图、角色设计、对话气泡、特效文字，支持四格漫画/短篇故事/条漫等格式',
      systemPrompt: `你是专业漫画创作者，拥有10年漫画创作经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 故事概述（核心情节/主题）
- 漫画格式（四格漫画/短篇故事(6-12格)/条漫/连环画）
- 角色设定（核心3-5个角色，辨识特征）
- 绘画风格（日式少年/少女漫/美式超级英雄/国风水墨/Q版/写实）
- 阅读方向（左→右中式/右→左日式）
- 色彩偏好（全彩/黑白/单色点阵）
- 是否有参考图/画布上的图片可用

【第二步：提出设计方案】
根据用户需求，输出结构化的创作方案（文字形式，不生成图片）：
1. 故事结构规划：
   - 四格漫画：起→承→转→合，每格1个关键画面
   - 短篇故事：开场→发展→高潮→结局，6-12格
   - 条漫：纵向滚动，每屏1-3格，节奏紧凑
2. 分格布局方案：
   - 格线/间距/格子形状（方形为主，倾斜/出血格用于强调）
   - 关键画面放大到半页或整页
   - 阅读顺序标注
3. 角色表现方案：
   - 每个角色的固定配色/辨识特征
   - 表情夸张化策略（Q版/变形用于喜剧效果）
   - 动作线/速度线增强动感
4. 对话与文字方案：
   - 气泡形状：圆角（普通）/锯齿（喊叫）/云朵（内心）
   - 拟声词风格：手绘风格，配合画面方向
   - 叙述框：矩形，灰色/半透明背景

【第三步：等待确认】
明确询问用户："以上漫画创作方案是否确认？需要调整故事结构或分格布局吗？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐格生成，确保：
- 角色外观在每格保持一致
- 阅读顺序正确
- 对话气泡与角色对应清晰
- 效果线/拟声词增强画面表现力`,
      paramSlots: [
        { name: 'story', label: '故事概述', placeholder: '如：上班族加班到深夜遇到猫咪精灵' },
        { name: 'format', label: '漫画格式', defaultValue: '四格漫画', placeholder: '如：四格漫画/短篇故事(8格)/条漫' },
        { name: 'characters', label: '角色设定', placeholder: '如：上班族(男性,30岁,疲惫)+猫咪精灵(可爱,会说话)' },
        { name: 'style', label: '画风', defaultValue: '日系萌系', placeholder: '如：日系萌系/热血少年/国风水墨/美式卡通/写实' },
        { name: 'tone', label: '故事基调', placeholder: '如：轻松搞笑/温馨治愈/热血冒险/悬疑惊悚' },
      ],
      steps: [
        { role: 'user', content: '创作{{format}}，故事：{{story}}，角色：{{characters}}，画风：{{style}}，基调：{{tone}}' },
        { role: 'assistant', content: '我来创作漫画。首先规划故事结构和分镜脚本，然后逐格绘制...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-mockup-showcase',
      name: '样机展示(Mockup)',
      category: 'design',
      description: '将设计稿一键贴到真实场景样机中，支持T恤/杯子/手机/海报/包装盒/手提袋等载体，自动适配透视和材质',
      systemPrompt: `你是样机展示(Mockup)专家，拥有10年品牌视觉呈现经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 设计内容（Logo/海报/插画/包装图案）
- 展示载体（T恤/杯子/手机壳/海报框/帆布袋/包装盒等）
- 展示场景（纯色背景/办公桌面/咖啡厅/户外/影棚）
- 光线风格（自然光/影棚灯光/暖色调/冷色调）
- 品牌调性（高端商务/年轻潮流/温馨居家/科技极简）
- 是否有画布上的图片可作为设计源

【第二步：提出设计方案】
根据用户需求，输出结构化的展示方案（文字形式，不生成图片）：
1. 载体适配策略：
   - 平面载体（海报/画框）：正透视1:1还原
   - 曲面载体（杯子/瓶子）：透视变形+曲面贴合
   - 柔性载体（T恤/帆布袋）：褶皱贴合+布料纹理
   - 硬质载体（手机/笔记本）：反光效果+边框遮挡
   - 场景载体（站牌/车身）：环境光影匹配
2. 材质还原方案：
   - 纸张：哑光/光面/纹理质感
   - 布料：棉质柔软/涤纶光滑/牛仔纹理
   - 玻璃/金属：反光/高光/镜面效果
   - 陶瓷：光泽度+微妙纹理
3. 光影处理：
   - 主光源方向与场景一致
   - 设计稿上的投影和反射
   - 环境色对设计的色彩影响
4. 输出规格：
   - 每个载体至少2个视角（45°/正面/侧面）
   - 分辨率≥1920px
   - 背景干净（纯色/渐变/简单场景）

【第三步：等待确认】
明确询问用户："以上样机展示方案是否确认？需要调整载体或场景吗？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案逐个载体生成样机效果图，确保：
- 设计内容在每个载体上贴合自然
- 透视和比例正确
- 材质和光影匹配场景`,
      paramSlots: [
        { name: 'designContent', label: '设计内容', placeholder: '如：品牌Logo/海报/插画图案' },
        { name: 'carrier', label: '展示载体', defaultValue: 'T恤+杯子+帆布袋', placeholder: '如：T恤/杯子/手机壳/海报框/包装盒/多载体组合' },
        { name: 'scene', label: '展示场景', defaultValue: '纯色背景', placeholder: '如：纯色背景/办公桌面/咖啡厅/户外' },
        { name: 'lighting', label: '光线风格', defaultValue: '自然光', placeholder: '如：自然光/影棚灯光/暖色调/冷色调' },
      ],
      steps: [
        { role: 'user', content: '将{{designContent}}展示在{{carrier}}上，场景：{{scene}}，光线：{{lighting}}' },
        { role: 'assistant', content: '我来生成样机效果图。首先分析设计内容和载体材质，然后精准贴合生成逼真展示图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-illustration',
      name: '插画创作',
      category: 'image',
      description: '创作各类风格的插画，支持绘本/商业插画/ editorial/装饰画等，从构图到成稿全流程指导',
      systemPrompt: `你是专业插画师，拥有10年插画创作经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 插画主题和核心内容
- 插画类型（绘本/商业插画/editorial/装饰画/头像）
- 艺术风格（写实/扁平几何/水彩/矢量/像素/日系动漫/国风水墨）
- 氛围情绪（温馨治愈/神秘梦幻/活力奔放/静谧沉思）
- 色调倾向（暖色调/冷色调/高饱和/低饱和/单色）
- 用途和尺寸（印刷/数字/社交/海报）
- 是否有参考图/画布上的图片可用

【第二步：提出设计方案】
根据用户需求，输出结构化的创作方案（文字形式，不生成图片）：
1. 构图方案：
   - 核心1个视觉焦点
   - 构图方式选择：三分法/对称/对角线/环形/满版
   - 视觉引导路径
2. 色彩方案：
   - 主色≤2种，辅助色≤4种
   - 60-30-10法则：60%主色+30%辅色+10%点缀色
   - 色彩情感匹配主题
3. 风格执行策略：
   - 写实：光影精确，材质还原，细节丰富
   - 扁平：几何形状，纯色填充，无渐变
   - 水彩：笔触自然，色彩晕染，留白韵味
   - 矢量：线条清晰，色块分明
   - 混合媒介：照片+手绘+3D元素合成
4. 画面层次规划：
   - 前景/中景/背景层次
   - 主体与留白比例
   - 细节密度分布

【第三步：等待确认】
明确询问用户："以上插画创作方案是否确认？需要调整构图或色彩方案吗？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成插画，确保：
- 构图与方案一致
- 色彩方案准确还原
- 风格特征鲜明
- 画面层次丰富`,
      paramSlots: [
        { name: 'subject', label: '插画主题', placeholder: '如：森林里的蘑菇小屋/城市夜归人' },
        { name: 'illustrationType', label: '插画类型', defaultValue: '商业插画', placeholder: '如：绘本插画/商业插画/editorial/装饰画/头像' },
        { name: 'style', label: '艺术风格', defaultValue: '温暖手绘风', placeholder: '如：写实/扁平几何/水彩/矢量/像素/日系动漫' },
        { name: 'mood', label: '氛围情绪', placeholder: '如：温馨治愈/神秘梦幻/活力奔放/静谧沉思' },
        { name: 'colorTone', label: '色调倾向', placeholder: '如：暖色调/冷色调/高饱和/低饱和/单色' },
      ],
      steps: [
        { role: 'user', content: '创作{{illustrationType}}，主题：{{subject}}，风格：{{style}}，氛围：{{mood}}，色调：{{colorTone}}' },
        { role: 'assistant', content: '我来创作插画。首先构思构图方案，确定风格和色调，然后逐步完成从线稿到成稿...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-ui-design',
      name: 'App/网页界面设计',
      category: 'design',
      description: '设计App界面和网页页面，包含首页/详情页/设置页等常见页面类型，遵循iOS/Android/Material Design规范',
      systemPrompt: `你是资深UI/UX设计师，拥有10年App和网页设计经验。当用户选择此技能时，你必须按照以下专业流程引导对话：

【核心原则】先分析→提出方案→用户确认→再生成。绝对不要在用户确认方案前生成任何图片。

【第一步：需求分析】
主动询问并整理以下信息：
- 产品类型（电商App/社交App/工具App/SaaS后台）
- 页面类型（首页/列表页/详情页/个人中心/设置页/表单页）
- 目标平台（iOS/Android/Web/iPad）
- 设计风格（现代简约/玻璃拟态/新拟态/赛博朋克）
- 品牌主色
- 目标用户群体
- 核心功能优先级
- 是否有参考图/画布上的图片可用

【第二步：提出设计方案】
根据用户需求，输出结构化的UI设计方案（文字形式，不生成图片）：
1. 信息架构：
   - 页面核心功能模块划分
   - 信息层级和优先级排序
   - 用户操作路径规划
2. 设计系统：
   - 栅格系统：8pt基准网格
   - 字体层级：H1(28-32pt)/H2(22-24pt)/H3(18-20pt)/Body(14-16pt)/Caption(10-12pt)
   - 间距系统：4/8/12/16/24/32/48px
   - 圆角规范：4/8/12/16px（按组件层级递增）
3. 组件规范：
   - 按钮：主按钮(填充)/次按钮(描边)/文字按钮，高度40-48px
   - 输入框：高度44-48px
   - 卡片：圆角12-16px，内边距16-20px
   - 导航栏：高度44-56px
   - 标签栏：高度49-56px
4. 色彩系统：
   - 主色(Brand)：1种，用于主按钮/关键操作
   - 功能色：成功(绿)/警告(橙)/错误(红)/信息(蓝)
   - 中性色：文字/背景/边框
5. 适配规格：
   - 尺寸：375x812pt(iOS)/360x800dp(Android)/1440px(Web)
   - 暗色模式：自动反转+饱和度调整

【第三步：等待确认】
明确询问用户："以上UI设计方案是否确认？需要调整信息架构或风格方向吗？"
等待用户回复确认或修改意见后，再进入生成阶段。

【第四步：执行生成】
按确认的方案生成UI界面设计，确保：
- 信息层级清晰
- 组件规范统一
- 色彩系统一致
- 适配目标平台规范`,
      paramSlots: [
        { name: 'appType', label: '产品类型', placeholder: '如：电商App/社交App/工具App/SaaS后台' },
        { name: 'pageType', label: '页面类型', defaultValue: '首页', placeholder: '如：首页/列表页/详情页/个人中心/设置页' },
        { name: 'platform', label: '目标平台', defaultValue: 'iOS', placeholder: '如：iOS/Android/Web/iPad' },
        { name: 'style', label: '设计风格', defaultValue: '现代简约', placeholder: '如：现代简约/玻璃拟态/新拟态/赛博朋克' },
        { name: 'brandColor', label: '品牌主色', placeholder: '如：蓝色/绿色/橙色/紫色' },
      ],
      steps: [
        { role: 'user', content: '设计{{appType}}的{{pageType}}，平台：{{platform}}，风格：{{style}}，品牌色：{{brandColor}}' },
        { role: 'assistant', content: '我来设计UI界面。首先确定信息架构和组件规范，然后生成高保真界面设计...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
    {
      id: 'preset-food-photography',
      name: '美食摄影风格图',
      category: 'image',
      description: '生成专业美食摄影风格图，支持菜品/饮品/甜点，遵循食物摄影布光和构图规范，适合餐饮/外卖/食品品牌',
      systemPrompt: `你是专业美食摄影师兼食物造型师，擅长创造令人食欲大增的美食视觉。

## 核心能力
精通美食摄影全流程：构图法则、布光策略、食物造型、道具搭配、后期风格。

## 对话引导流程
你必须在生成图片前先完成以下步骤：
1. **需求分析**：理解用户想拍什么菜品/饮品，确认菜系类型、使用场景
2. **方案设计**：提出拍摄方案，包括：
   - 推荐拍摄角度（俯拍Flat Lay/45°角/平视/特写）及理由
   - 布光策略（自然侧窗光/逆光轮廓/暖色温3200-4000K/避免正面闪光）
   - 道具搭配（盘器白色/木色/石板，银色/木色餐具，大理石/木纹/亚麻布背景）
   - 食物造型技巧（酱汁精准摆放/蔬菜喷油光泽/蒸汽烟雾氛围/配料散落自然感）
   - 后期风格（色温偏暖5-10%/饱和度+10-15%/暗部提亮/清晰度+5-10%）
3. **用户确认**：展示方案后等待用户确认，用户可调整任何细节
4. **执行生成**：确认后按方案生成美食摄影图

## 美食摄影核心规范
- 构图：俯拍适合多菜品、45°最自然、平视显层次、特写抓质感
- 布光：侧光+反光板最通用，逆光拍蒸汽绝美，暖色温增强食欲
- 造型：酱汁用注射器精准、蔬菜喷油、蒸汽增氛围
- 道具：盘器不抢风头、餐具自然摆放、背景选质感材质
- 后期：偏暖偏饱、暗部保留、质感增强`,
      paramSlots: [
        { name: 'dish', label: '菜品名称', placeholder: '如：松露意面/抹茶拿铁/草莓蛋糕' },
        { name: 'cuisine', label: '菜系类型', placeholder: '如：中餐/日料/西餐/甜品/饮品' },
        { name: 'angle', label: '拍摄角度', defaultValue: '45°角', placeholder: '如：俯拍/45°角/平视/特写' },
        { name: 'style', label: '视觉风格', defaultValue: '温暖自然光', placeholder: '如：温暖自然光/暗调高级/清新明亮/杂志大片' },
        { name: 'purpose', label: '使用目的', placeholder: '如：菜单/外卖平台/社交媒体/品牌宣传' },
      ],
      steps: [
        { role: 'user', content: '拍摄{{cuisine}}{{dish}}的美食图，角度：{{angle}}，风格：{{style}}，用途：{{purpose}}' },
        { role: 'assistant', content: '我来生成美食摄影图。首先确定布光和道具方案，然后生成专业级美食图...' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    },
  ], []);

  // 加载 Skills（合并预置+用户自定义）
  useEffect(() => {
    try {
      const stored = localStorage.getItem('chat-skills');
      const userSkills: ChatSkill[] = stored ? JSON.parse(stored) : [];
      // 预置Skills不重复添加（按id去重）
      const userSkillIds = new Set(userSkills.map(s => s.id));
      const merged = [...LOVART_PRESET_SKILLS.filter(s => !userSkillIds.has(s.id)), ...userSkills];
      setChatSkills(merged);
    } catch {
      setChatSkills(LOVART_PRESET_SKILLS);
    }
  }, [LOVART_PRESET_SKILLS]);

  // 保存 Skills
  const saveSkills = useCallback((skills: ChatSkill[]) => {
    setChatSkills(skills);
    try {
      localStorage.setItem('chat-skills', JSON.stringify(skills));
    } catch {}
  }, []);

  // 保存当前对话为 Skill
  const handleSaveAsSkill = useCallback(() => {
    if (!skillSaveName.trim()) return;
    const agent = allAgents.find(a => a.id === systemPrompt);
    const steps = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6) // 取最近6条作为步骤参考
      .map(m => ({ role: m.role, content: m.content.substring(0, 200) }));

    // 自动提取参数槽位 - 从用户消息中提取变量模式
    const paramSlots: ChatSkill['paramSlots'] = [];
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      const firstMsg = userMessages[0].content;
      // 如果第一条消息包含具体描述，将其标记为主题参数
      if (firstMsg.length > 4) {
        paramSlots.push({
          name: 'topic',
          label: '主题内容',
          defaultValue: firstMsg.substring(0, 50),
          placeholder: '输入新的主题内容...',
        });
      }
    }

    const newSkill: ChatSkill = {
      id: `skill-${Date.now()}`,
      name: skillSaveName.trim(),
      category: skillSaveCategory,
      description: skillSaveDescription.trim() || `从对话"${currentSessionId}"提炼的技能`,
      systemPrompt: agent?.prompt || systemPrompt,
      agentId: agent?.id,
      paramSlots,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
    };
    saveSkills([...chatSkills, newSkill]);
    setShowSkillSaveDialog(false);
    setSkillSaveName('');
    setSkillSaveCategory('custom');
    setSkillSaveDescription('');
  }, [skillSaveName, skillSaveCategory, skillSaveDescription, messages, systemPrompt, allAgents, chatSkills, saveSkills, currentSessionId]);

  // 使用 Skill 创建新对话
  // 删除 Skill
  const handleDeleteSkill = useCallback((skillId: string) => {
    saveSkills(chatSkills.filter(s => s.id !== skillId));
  }, [chatSkills, saveSkills]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Select a prompt template from / trigger
  const selectPromptTemplate = useCallback((template: PromptTemplate) => {
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart || input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    const textAfterCursor = input.slice(cursorPos);
    
    if (lastSlashIndex >= 0) {
      const newInput = input.slice(0, lastSlashIndex) + template.content + textAfterCursor;
      setInput(newInput);
    }
    
    setTemplatePopupOpen(false);
    setTimeout(() => textarea?.focus(), 0);
  }, [input]);

  // 从服务器加载可用聊天模型
  const loadServerModels = useCallback(async () => {
      try {
        const res = await fetch('/api/models?type=chat');
        if (res.ok) {
          const data = await res.json();
          const models: {id: string; name: string; provider: string; providerId: string; description?: string; isDefault?: boolean}[] = [];
          const providerMap = new Map<string, string>();
          if (data.providers && Array.isArray(data.providers)) {
            for (const p of data.providers) {
              providerMap.set(p.id, p.name || p.displayName || '');
            }
          }
          // 优先从顶层 models 数组读取（已由服务端按 selectedModels + type 过滤）
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              models.push({
                id: m.providerId ? `${m.providerId}::${m.id || m.name}` : (m.id || m.name),
                name: (m.name && m.name !== m.id) ? m.name : getModelDisplayName(m.name || m.id),
                provider: providerMap.get(m.providerId) || m.providerId || '',
                providerId: m.providerId || '',
                description: m.description,
                isDefault: m.isDefault,
              });
            }
          }
          setDiscoveredChatModels(models);
          // 如果有默认模型，自动选中
          const defaultModel = models.find((m: {isDefault?: boolean}) => m.isDefault);
          if (defaultModel && !model) {
            setModel(defaultModel.id);
          }
        }
      } catch {
        // 静默失败
      }
    }, [model]);

  useEffect(() => {
    loadServerModels();
    // 页面重新可见时刷新模型列表（用户可能刚从管理面板切回）
    // 不使用定时刷新，避免刷新时重置用户当前选择的模型
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadServerModels();
        loadImageModels();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadServerModels]);

  // 从服务器加载可用图像模型（用于聊天中生图）
  const loadImageModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models?type=image');
      if (res.ok) {
        const data = await res.json();
        const models: {id: string; name: string; provider: string; providerId: string}[] = [];
        const providerMap = new Map<string, string>();
        if (data.providers && Array.isArray(data.providers)) {
          for (const p of data.providers) {
            providerMap.set(p.id, p.name || p.displayName || '');
          }
        }
        if (data.models && Array.isArray(data.models)) {
          for (const m of data.models) {
            models.push({
              id: m.providerId ? `${m.providerId}::${m.id || m.name}` : (m.id || m.name),
              name: (m.name && m.name !== m.id) ? m.name : getModelDisplayName(m.name || m.id),
              provider: providerMap.get(m.providerId) || m.providerId || '',
              providerId: m.providerId || '',
            });
          }
        }
        setDiscoveredImageModels(models);
      }
    } catch {
      // 静默失败
    }
  }, []);

  // 初始化图像模型选择（从localStorage读取，与图像生成面板同步）
  useEffect(() => {
    loadImageModels();
    const saved = localStorage.getItem('wujie_selected_model');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.model) {
          const modelId = parsed.providerId ? `${parsed.providerId}::${parsed.model}` : parsed.model;
          setImageModel(modelId);
          setImageModelProviderId(parsed.providerId || '');
        }
      } catch {
        // ignore
      }
    }
  }, [loadImageModels]);

  // 标记会话是否已加载完成（用于触发保存和恢复）
  const chatSessionsLoadedRef = useRef(false);
  const resumedChatTaskKeysRef = useRef(new Set<string>());

  // 初始化对话列表
  useEffect(() => {
    const saved = localStorage.getItem('chat-sessions');
    if (saved) {
      try {
        const sessions: ChatSession[] = JSON.parse(saved);
        setChatSessions(sessions);
        if (sessions.length > 0) {
          const latest = sessions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
          setCurrentSessionId(latest.id);
          setMessages(latest.messages);
          setModel(latest.model);
          setSystemPrompt(latest.systemPrompt);
        }
      } catch {
        // ignore
      }
    }
    chatSessionsLoadedRef.current = true;
  }, []);

  // 会话加载完成后，若消息非空则触发一次保存（确保持久化）
  useEffect(() => {
    if (chatSessionsLoadedRef.current && messages.length > 0) {
      saveSession(messages, model, systemPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionsLoadedRef.current, messages.length]);

  // 恢复未完成的异步生成任务
  useEffect(() => {
    if (!chatSessionsLoadedRef.current || messages.length === 0) return;
    const tasks = getResumableChatGenerationTasks(messages, resumedChatTaskKeysRef.current);
    if (tasks.length === 0) return;
    tasks.forEach(task => resumedChatTaskKeysRef.current.add(task.assistantMessageId));

    const pollAndUpdate = async () => {
      for (const task of tasks) {
        const results: string[] = [];
        for (const taskId of task.taskIds) {
          try {
            const resp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: task.model, providerId: task.providerId }),
            });
            const data = await resp.json();
            if (data.status === 'completed') {
              const url = extractTaskResultImageUrl(data);
              if (url) results.push(url);
            }
          } catch { /* skip individual poll errors */ }
        }
        if (results.length > 0) {
          setMessages(prev => prev.map(m => {
            if (m.id === task.assistantMessageId) {
              return { ...m, generatedImages: [...(m.generatedImages || []), ...results], pendingGenerationTasks: undefined };
            }
            return m;
          }));
        }
      }
    };
    pollAndUpdate();
  }, [chatSessionsLoadedRef.current, messages]);

  // 保存对话到localStorage
  const saveSession = useCallback((sessionMessages: Message[], sessionModel: string, sessionSystemPrompt: string, sessionId?: string) => {
    const id = sessionId || currentSessionId || `session-${Date.now()}`;
    const title = sessionMessages.length > 0
      ? sessionMessages[0].content.substring(0, 20) + (sessionMessages[0].content.length > 20 ? '...' : '')
      : '新对话';
    // Merge to preserve pendingGenerationTasks that may have been added after streaming snapshot
    const mergedMessages = mergeChatSessionMessages(
      chatSessions.find(s => s.id === id)?.messages ?? [],
      sessionMessages
    );
    const session: ChatSession = {
      id,
      title,
      messages: mergedMessages as Message[],
      model: sessionModel,
      systemPrompt: sessionSystemPrompt,
      createdAt: sessionMessages.length > 0 ? sessionMessages[0].timestamp : Date.now(),
      updatedAt: Date.now(),
      agentId: sessionSystemPrompt && allAgents.find(a => a.id === sessionSystemPrompt) ? sessionSystemPrompt : undefined,
    };
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      const updated = [session, ...filtered].slice(0, 50);
      localStorage.setItem('chat-sessions', JSON.stringify(updated));
      return updated;
    });
    if (!currentSessionId) setCurrentSessionId(id);
  }, [currentSessionId]);

  // 即时持久化消息更新（pendingGenerationTasks 立即写入 localStorage）
  const persistMessageUpdate = useCallback((updater: React.SetStateAction<Message[]>) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // 即时持久化到 localStorage，避免崩溃丢失
      if (currentSessionId) {
        try {
          const sessions: ChatSession[] = JSON.parse(localStorage.getItem('chat-sessions') || '[]');
          const idx = sessions.findIndex(s => s.id === currentSessionId);
          if (idx >= 0) {
            // Merge to preserve any pendingGenerationTasks in the new messages
            const merged = mergeChatSessionMessages(sessions[idx].messages, next);
            sessions[idx] = { ...sessions[idx], messages: merged as Message[], updatedAt: Date.now() };
            localStorage.setItem('chat-sessions', JSON.stringify(sessions));
          }
        } catch {}
      }
      return next;
    });
  }, [currentSessionId]);

  // 新建对话
  const handleNewChat = useCallback(() => {
    saveSession(messages, model, systemPrompt);
    setMessages([]);
    setCurrentSessionId(`session-${Date.now()}`);
  }, [messages, model, systemPrompt, saveSession]);

  // 切换对话
  const handleSwitchSession = useCallback((sessionId: string) => {
    saveSession(messages, model, systemPrompt);
    const session = chatSessions.find(s => s.id === sessionId);
    if (session) {
      setMessages(session.messages);
      setModel(session.model);
      setSystemPrompt(session.systemPrompt);
      setCurrentSessionId(session.id);
    }
    setShowHistoryPanel(false);
  }, [messages, model, systemPrompt, chatSessions, saveSession]);

  // 删除对话
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatSessions(prev => {
      const updated = prev.filter(s => s.id !== sessionId);
      localStorage.setItem('chat-sessions', JSON.stringify(updated));
      return updated;
    });
    if (currentSessionId === sessionId) {
      setMessages([]);
      setCurrentSessionId(`session-${Date.now()}`);
    }
  }, [currentSessionId]);

  // 加载第三方聊天模型
  useEffect(() => {
    const mgr = UniversalApiManager.getInstance();
    const providers = mgr.getProviders();
    const chatModels: {id: string; name: string; provider: string; providerId: string}[] = [];
    providers.forEach(p => {
      if ((p.modelType?.includes('chat') || (!p.modelType && p.type === 'chat')) && p.isEnabled) {
        // 只使用用户手动选择的模型列表，不自动发现全部模型
        if (p.selectedModels && p.selectedModels.length > 0) {
          p.selectedModels.forEach(mId => {
            chatModels.push({
              id: `${p.id}::${mId}`,
              name: mId,
              provider: p.displayName || p.name,
              providerId: p.id,
            });
          });
        } else if (p.selectedModel) {
          chatModels.push({
            id: `${p.id}::${p.selectedModel}`,
            name: p.selectedModel,
            provider: p.displayName || p.name,
            providerId: p.id,
          });
        }
      }
    });
    setThirdPartyChatModels(chatModels);
  }, [showThirdPartyDialog]);

  // 自动滚动到底部 — 仅在用户已在底部附近时才跟随滚动，避免思考时强制回滚
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    // 判断用户是否在底部附近（100px 内视为"在底部"）
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 自动调整textarea高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // 监听粘贴事件
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            setPendingImages(prev => [...prev, { id: `paste-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, url: dataUrl, name: file.name || '粘贴图片' }]);
          };
          reader.readAsDataURL(file);
          // Don't break - support pasting multiple images
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [activeTab]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setPendingImages(prev => [...prev, { id: `upload-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, url: dataUrl, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleAnalyzeImage = useCallback(async () => {
    if (pendingImages.length === 0 || isAnalyzingImage) return;
    setIsAnalyzingImage(true);

    try {
      const imageContents = pendingImages.map(img => ({
        type: 'image_url' as const,
        image_url: { url: img.url, detail: 'high' as const }
      }));

      const requestMessages = [
        {
          role: 'system',
          content: pendingImages.length > 1
            ? '你是一个专业的AI图像分析专家。用户会给你多张图片，请逐张分析图片内容并生成适合AI图像生成的关键词描述。请分别输出英文和中文两个版本，格式如下：\n\n【English】\n英文关键词描述\n\n【中文】\n中文关键词描述'
            : '你是一个专业的AI图像分析专家。用户会给你一张图片，请详细分析图片内容并生成适合AI图像生成的关键词描述。请分别输出英文和中文两个版本，格式如下：\n\n【English】\n英文关键词描述\n\n【中文】\n中文关键词描述'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: pendingImages.length > 1 ? `请分析这${pendingImages.length}张图片，生成AI图像生成用的关键词描述。` : '请分析这张图片，生成AI图像生成用的关键词描述。' },
            ...imageContents
          ]
        }
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          providerId: model.includes('::') ? model.split('::')[0] : undefined,
          messages: requestMessages,
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`分析失败: ${response.status}`);

      const data = await response.json();
      const result = data.choices?.[0]?.message?.content || '';

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: pendingImages.length > 1 ? `请分析这${pendingImages.length}张图片并生成关键词` : '请分析这张图片并生成关键词',
        timestamp: Date.now(),
        imageAnchors: pendingImages.map(img => ({ imageId: img.id, imageUrl: img.url, imageName: img.name })),
      };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result,
        timestamp: Date.now(),
      };
      const updatedMessages = [...newMessages, assistantMsg];
      setMessages(updatedMessages);
      saveSession(updatedMessages, model, systemPrompt);

      setPendingImages([]);
    } catch (error) {
      console.error('Image analysis error:', error);
      const assistantMsg: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `图片分析失败：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setIsAnalyzingImage(false);
    }
  }, [pendingImages, isAnalyzingImage, model, messages, systemPrompt, saveSession]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const clearChat = () => {
    if (confirm('确定要清空聊天记录吗？')) {
      setMessages([]);
    }
  };

  const handleSend = useCallback(async (overrideText?: string, options?: { systemPromptOverride?: string }) => {
    const textToSend = overrideText ?? input;
    if (textToSend.trim() || isLoading) {
      // continue
    } else {
      return;
    }

    if (overrideText) {
      // When triggered by suggestion click, ensure input field is cleared
    }

    const trimmedInput = textToSend.trim();

    // P0-2: 增强意图分类 - 使用新版意图分类器
    const intentResult = classifyIntent(trimmedInput, { hasImages: pendingImages.length > 0 || activeMentions.some(m => m.type === 'canvas-image') });
    const intentLevel = intentResult.clarity;

    // 收集图片锚点（来自pendingImages、@图片引用）
    const imageAnchors: { imageId: string; imageUrl: string; imageName: string }[] = [];
    activeMentions.filter(m => m.type === 'canvas-image').forEach(m => {
      if (!imageAnchors.find(a => a.imageId === m.id)) {
        imageAnchors.push({ imageId: m.id, imageUrl: m.imageUrl || '', imageName: m.label });
      }
    });
    // Add pending images as anchors
    pendingImages.forEach(img => {
      if (!imageAnchors.find(a => a.imageId === img.id)) {
        imageAnchors.push({ imageId: img.id, imageUrl: img.url, imageName: img.name });
      }
    });

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      imageAnchors: imageAnchors.length > 0 ? imageAnchors : undefined,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    // Capture pending images before clearing
    const capturedPendingImages = [...pendingImages];
    setPendingImages([]);
    setIsLoading(true);

    try {
      const selectedModel = isThinkingMode 
        ? (model.includes('thinking') ? model : `${model}-thinking`)
        : model;

      const isThirdParty = selectedModel.includes('::');
      const providerId = isThirdParty ? selectedModel.split('::')[0] : undefined;
      const actualModel = isThirdParty ? selectedModel.split('::').slice(1).join('::') : selectedModel;

      // 构建增强版系统提示词
      // 优先使用 options.systemPromptOverride（Skill 触发时直接传入）
      const effectiveSystemPrompt = options?.systemPromptOverride || systemPrompt;
      // systemPrompt 可能是 agentId（短ID）或直接是 Skill 的 systemPrompt 文本（长文本）
      const systemPromptObj = allAgents.find(p => p.id === effectiveSystemPrompt);
      let enhancedSystemPrompt = systemPromptObj?.prompt || '';
      // 如果 systemPrompt 不是 agentId（未在 allAgents 中找到），则它本身就是 prompt 文本
      if (!systemPromptObj && effectiveSystemPrompt) {
        enhancedSystemPrompt = effectiveSystemPrompt;
      }

      // ★ Agent模式：对话即创作，自动执行工具链，无需反复确认
      if (isAgentMode) {
        enhancedSystemPrompt += `

【Agent 创作模式 - 重要执行规则】
当前处于Agent自动创作模式。你是一个自主AI创作助手，核心规则：
1. **立即行动**：用户提出需求后，直接调用工具执行，无需询问"是否需要生成"等确认问题
2. **多步执行**：可以连续调用多个工具完成复杂任务（如：生成图片→放大→去背景→生成视频）
3. **自动规划**：用户说"帮我做一套电商主图"，你应该自动规划生成多张不同角度/场景的图片
4. **生成优先**：当用户意图是创作类（画图、做视频、修图），优先调用工具，不要只给文字建议
5. **结果导向**：完成工具调用后，简短说明已完成的操作，引导用户继续指令`;
      }

      // ★ Lovart 风格：Skill 上下文注入到 systemPrompt（不污染用户消息显示）
      if (activeSkill && messages.length === 0) {
        const paramParts = activeSkill.paramSlots
          ?.filter(p => skillParamValues[p.name])
          .map(p => `${p.label}: ${skillParamValues[p.name]}`)
          .filter(Boolean);
        const paramStr = paramParts && paramParts.length > 0 ? `\n用户填写的参数：${paramParts.join('、')}` : '';
        enhancedSystemPrompt += `\n\n【当前激活技能：${activeSkill.name}】${activeSkill.description ? `\n技能说明：${activeSkill.description}` : ''}${paramStr}\n\n你是专业设计总监。请按以下流程引导用户：\n1. 先分析用户需求，理解核心意图\n2. 输出专业设计方案和风格方向建议，等用户确认\n3. 确认后再执行生成，不要直接开始生成图片`;
      }

      // P0-3: 注入智能体能力信息（工具+配方）
      if (systemPromptObj) {
        const agentToolsList = systemPromptObj.tools.join('、');
        const agentRecipesList = systemPromptObj.recipes.map(r => 
          `"${r.name}" (${r.operationType}): ${r.promptTemplate}`
        ).join('\n');
        enhancedSystemPrompt += `

【智能体能力信息】
你是"${systemPromptObj.name}"智能体，具备以下专业能力：
- 可用工具：${agentToolsList}
- 专业配方（执行特定任务时的提示词策略）：
${agentRecipesList}
请根据用户需求，优先使用你的专业配方和工具来完成任务。当需要执行操作时，请调用对应的工具函数。`;
      }

      const requestMessages = [];
      
      // P0-2: 生成后主动引导 - 在系统提示词中注入建议指令
      enhancedSystemPrompt += `

【重要：回复格式规范】
1. 当你帮助用户生成图片或完成设计任务后，必须在回复末尾附加"建议下一步"区域，格式如下：
💡 建议下一步：
1. [具体操作描述] → [操作类型] | [预填充提示词]
2. [具体操作描述] → [操作类型] | [预填充提示词]
3. [具体操作描述] → [操作类型] | [预填充提示词]

操作类型必须是以下之一：图生图、语言修图、放大、移除背景、扩展画面、SVG描摹、Agent编排、提示词优化、生成视频、图生视频
预填充提示词是用户点击建议后自动填入输入框的内容，应包含具体可执行的指令。
示例：
- "换成扁平风格" → 图生图 | 请将这张图片转换为扁平化设计风格，保留主体构图
- "放大到4K" → 放大 | 请将这张图片无损放大到4K分辨率
- "做成视频" → 生成视频 | 请将这张图片生成为5秒的短视频，添加缓慢推镜效果

【P0-1 ChatCanvas画布操作能力】
你是无界AI的画布协作助手，不仅能提供设计建议，还能**直接执行画布操作**。

当用户请求画布操作时（如"放大这张图"、"去掉背景"），你应该：
1. 确认理解用户的操作意图
2. 在回复中包含操作指令块，系统会自动执行
3. 向用户展示操作结果

可执行的操作：upscale(放大)、remove_bg(去背景)、img2img(图生图)、erase(擦除)、extend(扩展)、crop(裁切)、generate(生成)、filter(滤镜风格)

操作指令格式（在回复末尾添加）：
[CANVAS_ACTION]
type: upscale
target: selected
params: scale=2
[/CANVAS_ACTION]

或JSON格式：
~~~canvas-action
{"type": "img2img", "target": "selected", "params": {"style": "watercolor"}}
~~~

注意：执行操作前先确认目标图片，用户说"这张"通常指选中的图片。
每次给出2-3个建议，建议应与当前对话内容紧密相关，且预填充提示词应具体可执行。

2. 如果你生成的图片有任何值得注意的设计特点，请简要说明。

3. 【智能体适应】当你检测到用户的请求明显超出当前智能体的专业领域时（例如：用户在"酒类包装"智能体中请求设计海报），请在回复开头输出以下标记：
[AGENT_SUGGEST:智能体ID:智能体名称]
示例：[AGENT_SUGGEST:creative-posters:创意海报]
这会触发系统推荐用户切换到更合适的智能体。注意：仅当领域确实不匹配时才输出此标记，轻微偏移不需要。`;

      // P0-2: 增强意图处理 - 根据意图完整度和类别注入不同指令
      // Agent模式下放宽意图检测：即使用户输入简短也直接生成，不强制追问
      if (intentLevel === 'extremely_vague' && !isAgentMode) {
        // 使用追问模板库获取场景化追问
        const vagueScenarios = detectVagueScenarios(trimmedInput);
        const clarificationMessage = generateClarificationMessage(vagueScenarios, 3);
        enhancedSystemPrompt += `

【重要：当前用户输入极度模糊】
用户输入过短或仅有触发词，完全无法确定执行方向。请严格遵循以下规则：
- **禁止调用任何工具**（不要生成图片/视频等）
- 必须先追问澄清，帮助用户明确需求
- 追问时给出2-3个具体选项帮助用户选择，降低回答门槛${clarificationMessage ? `
- 推荐追问内容：
${clarificationMessage}` : `
- 追问格式示例：
  "我理解您想创作些什么！为了给出最好的结果，请补充一些细节：
  1. 关于主题：[选项A] / [选项B] / [选项C]
  2. 关于风格：[选项A] / [选项B] / [选项C]
  3. 关于用途：[选项A] / [选项B] / [选项C]"`}
- 禁止回复"好的，我来帮你生成"，必须在追问后等用户回答`;
      } else if (intentLevel === 'moderately_vague') {
        enhancedSystemPrompt += `

【重要：当前用户输入中等模糊】
用户有大致方向但缺少关键细节。请按以下规则处理：
- 基于已有信息**自动补全**合理默认值（风格、主题、色彩等），尽量直接执行
- 在执行的同时，简要说明你的补全假设："我为您选择了XX风格/XX配色，如果您希望调整可以告诉我"
- 如果某个关键参数完全无法推断（如品牌色、具体尺寸要求），则简短追问该单项
- 优先执行而非追问，减少用户等待
- 示例：用户说"设计一个logo"→ 自动选择现代简约风格+品牌色系+矢量风格，生成后说明"默认使用了简约风格，如需调整风格/配色请告知"`;
      }

      // P0-2: 意图类别处理 - 根据意图类别调整AI响应策略
      // 先计算hasCanvasImages（变量需要在使用前定义）
      const hasCanvasImages = pendingImages.length > 0 || activeMentions.some(m => m.type === 'canvas-image');
      if (intentResult.category === 'operate' && !hasCanvasImages) {
        // 操作意图但无选中图片
        enhancedSystemPrompt += `

【重要：当前需要操作对象】
用户想要对画布图片进行操作，但当前没有选中或引用图片。请：
- 询问用户想要操作哪张图片："请先选中或上传您想要操作的图片"
- 或者建议用户先上传图片："您可以先上传图片，然后告诉我您想做什么调整"`;
      } else if (intentResult.category === 'operate') {
        // 有图片的操作意图
        const opHints = intentResult.action ? `建议执行的操作: ${intentResult.action}` : '';
        enhancedSystemPrompt += `

【操作意图识别】
用户想要对画布图片执行操作。${opHints}
请根据用户指令选择合适的工具执行，如：
- 放大/去背景/图生图 → 使用CanvasActionExecutor
- 文字修改 → 使用语言修图工具
- 扩展画面 → 使用扩展工具`;
      }

      // P1-3: 品牌资产注入 - 如果有@品牌引用，注入BrandDNA到systemPrompt
      const brandMention = activeMentions.find(m => m.type === 'brand');
      if (brandMention?.data) {
        const dna = brandMention.data;
        enhancedSystemPrompt += `

【品牌规范 (BrandDNA)】
当前对话需严格遵循以下品牌规范，所有生成内容必须符合：
- 主色: ${dna.primaryColor || dna['primaryColor'] || '未指定'}
- 辅色: ${dna.secondaryColor || dna['secondaryColor'] || '未指定'}
- 字体: ${dna.fontFamily || dna['fontFamily'] || '未指定'}
- 视觉调性: ${dna.visualTone || dna['visualTone'] || '未指定'}
- 禁区规则: ${dna.restrictions || dna['restrictions'] || '未指定'}
${dna.styleDescription || dna['styleDescription'] ? `- 风格描述: ${dna.styleDescription || dna['styleDescription']}` : ''}
请确保所有图片生成、设计建议都符合以上品牌规范。`;
      }

      // P1-2: 图片上下文 - 统一收集所有引用图片（@图片 + pendingImages），去重
      const allRefImageList: Array<{id: string; url: string; name: string}> = [];
      activeMentions.forEach(m => {
        if (m.type === 'canvas-image' && m.imageUrl && !allRefImageList.find(r => r.id === m.id)) {
          allRefImageList.push({ id: m.id!, url: m.imageUrl, name: m.label });
        }
      });
      capturedPendingImages.forEach(img => {
        if (!allRefImageList.find(r => r.id === img.id)) {
          allRefImageList.push({ id: img.id, url: img.url, name: img.name });
        }
      });
      // 使用前面已定义的hasCanvasImages变量
      if (hasCanvasImages || allRefImageList.length > 0) {
        const imageDescriptions = allRefImageList.map((img, i) =>
          `图片#${i + 1}: ${img.name}`
        ).join('\n');
        enhancedSystemPrompt += `

【当前编辑图片】
用户正在编辑画布上的${allRefImageList.length > 1 ? '多张' : '一张'}图片，请针对图片给出建议或修改指令：
${imageDescriptions}
${allRefImageList.length > 1 ? `用户可以通过"图片#1"、"图片#2"等编号来指代不同图片。例如"将图片#1的人物和图片#2的人物拥抱"表示同时对两张图片中的人物进行操作。` : ''}
用户的消息是针对这${allRefImageList.length > 1 ? '些' : '张'}图片的操作指令，请据此理解用户意图。

【⚠️ 图像操作指令 - 使用工具调用⚠️】
当你判断需要生成图片、编辑图片、移除背景、放大图片等操作时，请使用提供的工具(function calling)来执行。
- 用户要求"生成/画出/创建/设计一张图片" → 调用 generate_image 工具
- 用户要求"修改/编辑图片" → 调用 edit_image 工具
- 用户要求"移除背景/抠图" → 调用 remove_bg 工具
- 用户要求"放大/高清化" → 调用 upscale 工具
- 用户要求"扩展画面/补全边缘" → 调用 extend_image 工具
- 用户要求"生成视频" → 调用 generate_video 工具
- 用户要求"图片变视频" → 调用 img2video 工具
- 用户要求"分析图片" → 调用 analyze_image 工具

对于纯文本问答（解释原理、写文案、推荐配色等），直接文字回复即可，不需要调用工具。

【多张图生成规则】
⚠️ 重要：默认只生成1张图片。仅当用户明确要求"生成N张"、"多个方案"、"不同风格"时才生成多张。
当用户要求生成多张图时，每个方案调用一次 generate_image 工具，每次的提示词应有明显差异（不同构图/风格/角度/色调）。`;
      }

      // P2-1: Tune Mode — Inject fine-tuning parameters
      if (tuneContextString) {
        enhancedSystemPrompt += tuneContextString;
      }

      // 通用图像操作指令 - 当没有图片时，也告诉LLM可以使用工具
      if (!hasCanvasImages) {
        enhancedSystemPrompt += `

【⚠️ 图像操作指令 - 使用工具调用⚠️】
当你判断需要生成图片、编辑图片、移除背景、放大图片等操作时，请使用提供的工具(function calling)来执行。
- 用户要求"生成/画出/创建/设计一张图片" → 调用 generate_image 工具
- 用户要求"修改/编辑图片" → 调用 edit_image 工具
- 用户要求"移除背景/抠图" → 调用 remove_bg 工具
- 用户要求"放大/高清化" → 调用 upscale 工具
- 用户要求"扩展画面/补全边缘" → 调用 extend_image 工具
- 用户要求"生成视频" → 调用 generate_video 工具
- 用户要求"图片变视频" → 调用 img2video 工具
- 用户要求"分析图片" → 调用 analyze_image 工具

对于纯文本问答（解释原理、写文案、推荐配色等），直接文字回复即可，不需要调用工具。

【多张图生成规则】
⚠️ 重要：默认只生成1张图片。仅当用户明确要求"生成N张"、"多个方案"、"不同风格"时才生成多张。
当用户要求生成多张图时，每个方案调用一次 generate_image 工具，每次的提示词应有明显差异（不同构图/风格/角度/色调）。`;
      }

      if (enhancedSystemPrompt) {
        requestMessages.push({
          role: 'system',
          content: enhancedSystemPrompt
        });
      }

      messages.forEach(msg => {
        // Include images from imageAnchors or legacy imageUrl as multimodal content
        const msgImages: string[] = [];
        if (msg.imageUrl) msgImages.push(msg.imageUrl);
        if (msg.imageAnchors) {
          msg.imageAnchors.forEach(a => {
            if (a.imageUrl && !msgImages.includes(a.imageUrl)) msgImages.push(a.imageUrl);
          });
        }
        if (msgImages.length > 0) {
          const imageContents = msgImages.map(url => ({
            type: 'image_url' as const,
            image_url: { url }
          }));
          requestMessages.push({
            role: msg.role,
            content: [
              { type: 'text', text: msg.content },
              ...imageContents
            ]
          });
        } else {
          requestMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      });

      // P1-1: @引用系统 - 构建包含引用图片的用户消息
      const mentionedPrompts = activeMentions.filter(m => m.type === 'prompt' && m.data?.content);
      
      // Build context prefix from mentions
      let mentionContext = '';
      if (mentionedPrompts.length > 0) {
        mentionContext += '\n\n[引用的提示词]\n' + mentionedPrompts.map(m => `- ${m.data!.content}`).join('\n');
      }
      
      // Use unified image list (allRefImageList already defined above, with dedup)
      const allImageUrls = allRefImageList.map(img => img.url);
      
      // Add image number reference text for multi-image context
      let imageRefText = '';
      if (allRefImageList.length > 1) {
        imageRefText = '\n\n[图片引用]\n' + allRefImageList.map((img, i) => `图片#${i + 1}: ${img.name}`).join('\n');
      }
      
      if (allImageUrls.length > 0) {
        // Send as multimodal content with images
        const imageContents = allImageUrls.map(url => ({
          type: 'image_url' as const,
          image_url: { url }
        }));
        requestMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: trimmedInput + mentionContext + imageRefText },
            ...imageContents
          ]
        });
      } else {
        requestMessages.push({
          role: 'user',
          content: trimmedInput + mentionContext
        });
      }

      // Clear mentions after sending
      setActiveMentions([]);
      setShowImagePicker(false);

      // ====== 图像生成：改为LLM驱动模式 ======
      // 不再预检测意图，而是在LLM回复中解析 [GENERATE: ...] 标签
      // LLM会在systemPrompt中被告知如何使用此标签

      // 创建 AbortController 以支持取消
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 构建画布摘要：让 LLM 感知当前画布状态
      const canvasSummary = canvasImages && canvasImages.length > 0
        ? canvasImages.slice(0, 20).map((img: { id?: string; url?: string; prompt?: string; modelName?: string }, i: number) => ({
            id: img.id || `img_${i}`,
            url: (img.url || '').substring(0, 100),
            prompt: (img.prompt || '').substring(0, 200),
            modelName: img.modelName || undefined,
          }))
        : undefined;

      // ====== Agent模式与普通模式统一使用 /api/chat ======
      // 区别：Agent模式通过 systemPrompt 引导LLM更积极主动地使用工具（多步执行、自动规划）
      // 普通模式也已开启 enableTools: true，支持单步工具调用
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: actualModel,
          messages: requestMessages,
          stream: true,
          enableTools: true,
          agentTools: isAgentMode ? undefined : systemPromptObj?.tools, // Agent模式启用所有工具
          agentId: systemPrompt,
          providerId,
          canvasSummary,
          intentLevel,  // P2-9: 多级意图澄清
          imageModel,  // 前端当前选择的图像模型
          imageProviderId: imageModelProviderId,  // 前端当前选择的图像提供商ID
          isAgentMode,  // Agent模式标记：放宽意图检测，强制启用工具
        }),
      });

      if (!response.ok) {
        // 读取后端返回的实际错误消息
        let errMsg = `请求失败: ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) {
            errMsg = typeof errData.error === 'string' ? errData.error : JSON.stringify(errData.error);
          } else if (errData.message) {
            errMsg = errData.message;
          }
        } catch {
          // 无法解析 JSON，使用默认消息
        }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const assistantMessageId = `assistant-${Date.now()}`;
      let assistantContent = '';
      const toolExecutions: ToolExecution[] = []; // Agent工具执行记录
      const toolGeneratedImages: string[] = []; // 工具生成的图片URL
      const addedImageUrls = new Set<string>(); // 已添加到画布的图片URL去重
      const toolPendingTaskIds: Array<{ taskId: string; model: string; providerId: string; type: 'image' | 'video' }> = []; // 工具返回的异步任务，需轮询
      let toolGeneratedVideo: string | undefined; // 工具生成的视频URL
      let currentSSEEvent = ''; // 当前SSE事件类型
      let sseBuffer = ''; // SSE buffer拼接，防止跨chunk JSON破裂

      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;
          const lines = sseBuffer.split('\n');
          // 如果最后一行不以\n结尾，说明可能跨chunk断裂，保留到下次拼接
          if (!chunk.endsWith('\n')) {
            sseBuffer = lines.pop() || '';
          } else {
            sseBuffer = '';
          }

          for (const line of lines) {
            // 解析SSE event类型行
            if (line.startsWith('event: ')) {
              currentSSEEvent = line.slice(7).trim();
              continue;
            }

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);

                // ====== 处理Agent模式错误事件 ======
                const eventType = parsed.type || parsed.event || currentSSEEvent;
                const toolName = parsed.toolName || parsed.tool_name || parsed.tool;
                
                if (eventType === 'error') {
                  const errMsg = parsed.message || 'Agent执行失败';
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: (msg.content || '') + '\n❌ ' + errMsg, isGeneratingImage: false }
                      : msg
                  ));
                  assistantContent += '\n❌ ' + errMsg;
                  continue;
                }

                // ====== 处理Agent思考步骤（无toolName的step_start，如"理解需求中"） ======
                if (eventType === 'step_start' && !toolName) {
                  const stepLabel = parsed.label || parsed.stepName || '思考中...';
                  const thinkingExec: ToolExecution = {
                    toolName: 'thinking',
                    status: 'running',
                    label: stepLabel,
                  };
                  toolExecutions.push(thinkingExec);
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, toolExecutions: [...toolExecutions] }
                      : msg
                  ));
                  continue;
                }

                // 思考步骤完成
                if (eventType === 'step_complete' && !toolName) {
                  const thinkingIdx = toolExecutions.findIndex(e => e.toolName === 'thinking' && e.status === 'running');
                  if (thinkingIdx >= 0) {
                    toolExecutions[thinkingIdx].status = 'completed';
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, toolExecutions: [...toolExecutions] }
                        : msg
                    ));
                  }
                  continue;
                }

                // ====== 处理Agent工具调用事件（兼容两种事件名格式） ======
                // Agent模式事件兼容：tool_execution_start / tool_start 都识别为工具开始
                if ((eventType === 'tool_execution_start' || eventType === 'tool_start') && toolName) {
                  const toolLabel = parsed.label || `正在执行 ${toolName}...`;
                  const toolExec: ToolExecution = {
                    toolName,
                    status: 'running',
                    label: toolLabel,
                    progress: 0,
                  };
                  toolExecutions.push(toolExec);
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, toolExecutions: [...toolExecutions] }
                      : msg
                  ));
                  continue;
                }

                // 工具进度更新
                if (eventType === 'tool_progress' && toolName) {
                  const execIdx = toolExecutions.findIndex(e => e.toolName === toolName && e.status === 'running');
                  if (execIdx >= 0 && typeof parsed.progress === 'number') {
                    toolExecutions[execIdx].progress = parsed.progress;
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, toolExecutions: [...toolExecutions] }
                        : msg
                    ));
                  }
                  continue;
                }

                // Agent模式：文本增量内容
                if (eventType === 'text' || eventType === 'content' || eventType === 'delta' || eventType === 'thinking' || eventType === 'message') {
                  const delta = parsed.content || parsed.delta || parsed.text || parsed.message || '';
                  if (delta) {
                    assistantContent += delta;
                    setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: assistantContent }
                        : msg
                    ));
                  }
                  continue;
                }

                // Agent模式：工具完成
                if ((eventType === 'tool_execution_result' || eventType === 'tool_done' || eventType === 'tool_complete') && toolName) {
                  // 更新对应工具的执行结果
                  const execIdx = toolExecutions.findIndex(e => e.toolName === toolName && e.status === 'running');
                  if (execIdx >= 0) {
                    toolExecutions[execIdx] = {
                      ...toolExecutions[execIdx],
                      status: parsed.success ? 'completed' : 'failed',
                      progress: parsed.success ? 100 : toolExecutions[execIdx].progress,
                      result: parsed.result,
                      imageUrls: parsed.imageUrls,
                      videoUrl: parsed.videoUrl,
                      error: parsed.error,
                    };
                  }
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, toolExecutions: [...toolExecutions] }
                      : msg
                  ));
                  // 收集工具生成的图片/视频
                  if (parsed.imageUrls && parsed.imageUrls.length > 0) {
                    toolGeneratedImages.push(...parsed.imageUrls);
                  }
                  if (parsed.videoUrl) {
                    toolGeneratedVideo = parsed.videoUrl;
                  }
                  // 收集异步任务ID（后端直接发送 {taskId, model, providerId, type} 对象数组）
                  if (parsed.taskIds && parsed.taskIds.length > 0) {
                    // 如果同时有imageUrls，直接使用imageUrls；否则添加到待轮询列表
                    if (!parsed.imageUrls || parsed.imageUrls.length === 0) {
                      toolPendingTaskIds.push(...parsed.taskIds);
                    }
                  }
                  continue;
                }

                if (eventType === 'tool_execution_complete' || eventType === 'done') {
                  // 所有工具执行完成，先更新最终消息内容
                  if (parsed.message) {
                    assistantContent += '\n\n' + parsed.message;
                  }
                  // 收集done事件中的图片/视频
                  if (parsed.imageUrls && parsed.imageUrls.length > 0) {
                    toolGeneratedImages.push(...parsed.imageUrls);
                  }
                  if (parsed.videoUrls && parsed.videoUrls.length > 0) {
                    // 视频URL处理
                    toolGeneratedVideo = parsed.videoUrls[0];
                  }
                  currentSSEEvent = '';
                  continue;
                }

                // ====== 处理常规LLM流式内容 ======
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  assistantContent += delta;
                  // P2-11: 检测智能体适应建议标记
                  const agentSuggestMatch = assistantContent.match(/\[AGENT_SUGGEST:([^:]+):([^\]]+)\]/);
                  if (agentSuggestMatch && !suggestedAgent) {
                    const [, agentId, agentName] = agentSuggestMatch;
                    const found = allAgents.find(a => a.id === agentId);
                    if (found) setSuggestedAgent(found);
                  }
                  // 流式输出时隐藏 [GENERATE: ...] 标签（兼容旧模式）和 [AGENT_SUGGEST: ...] 标记
                  const streamDisplayContent = assistantContent
                    .replace(/\[GENERATE:\s*[\s\S]+?\]/g, '')
                    .replace(/\[GENERATE:\s*[\s\S]*$/, '')
                    .replace(/\[AGENT_SUGGEST:[^\]]+\]/g, '')
                    .trimEnd();
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: streamDisplayContent || assistantContent }
                      : msg
                  ));
                }
              } catch {
                // 忽略解析错误
              }
              currentSSEEvent = '';
            }
          }
        }
      }

      // P0-2: 解析建议下一步
      const { cleanedContent, suggestions } = parseSuggestions(assistantContent);
      // P2-11: 从最终内容中移除智能体适应标记
      const finalCleanedContent = cleanedContent.replace(/\[AGENT_SUGGEST:[^\]]+\]/g, '').trim();
      if (suggestions.length > 0 || finalCleanedContent !== assistantContent) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: finalCleanedContent, suggestions }
            : msg
        ));
      }

      // P0-3: 检测追问回复 - 标记追问消息（仅极度模糊时）
      if (intentLevel === 'extremely_vague' && (assistantContent.includes('？') || assistantContent.includes('?') || /请补充|请说明|请选择|请告诉我/.test(assistantContent))) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, isClarifying: true }
            : msg
        ));
      }

      // ====== P0-1: 图像生成处理（Function Calling优先，[GENERATE]标签兜底） ======
      const generateMatches = [...assistantContent.matchAll(/\[GENERATE:\s*([\s\S]+?)\]/g)];
      const hasGenerateTags = generateMatches.length > 0;
      const hasToolGeneratedImages = toolGeneratedImages.length > 0 || !!toolGeneratedVideo || toolPendingTaskIds.length > 0;

      // 优先使用 Function Calling 工具生成的图片
      if (hasToolGeneratedImages) {
        // 工具执行已由流中的 tool_execution_result/tool_execution_complete 事件处理
        console.log('[ChatImage] Function Calling generated', toolGeneratedImages.length, 'images, pending tasks:', toolPendingTaskIds.length);

        // 当工具返回 taskIds（异步任务）但没有直接的 imageUrls 时，需要轮询获取结果
        if (toolPendingTaskIds.length > 0) {
          const imageModelInfo = getCurrentImageModelInfo(imageModel, imageModelProviderId);
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, isGeneratingImage: true, generateModelName: imageModelInfo.model || '图像生成', generateProviderId: imageModelInfo.providerId, generateProgress: 5, generateImageCount: toolPendingTaskIds.length }
              : msg
          ));

          // Save pending generation tasks for recovery (immediate persist)
          persistMessageUpdate(prev => prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, pendingGenerationTasks: toolPendingTaskIds.map(taskId => ({
                  taskIds: [taskId],
                  model: imageModelInfo.model,
                  providerId: imageModelInfo.providerId,
                  assistantMessageId,
                  timestamp: Date.now(),
                })) } as unknown as Message
              : msg
          ));

          (async () => {
            try {
              const allPolledUrls: string[] = [];
              const allPolledVideoUrls: string[] = [];

              for (let tIdx = 0; tIdx < toolPendingTaskIds.length; tIdx++) {
                const { taskId, model, providerId, type: taskType } = toolPendingTaskIds[tIdx];
                const genModel = model || imageModelInfo.model;
                const genProviderId = providerId || imageModelInfo.providerId;

                for (let i = 0; i < CHAT_TASK_MAX_ATTEMPTS; i++) {
                  const interval = getChatTaskPollIntervalMs(i);
                  await new Promise(r => setTimeout(r, interval));
                  const pollProgress = Math.min(90, 5 + Math.round(((tIdx + i / CHAT_TASK_MAX_ATTEMPTS) / toolPendingTaskIds.length) * 85));
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId ? { ...msg, generateProgress: pollProgress } : msg
                  ));

                  try {
                    const pollRes = await fetch('/api/poll-task', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskId, model: genModel, providerId: genProviderId }),
                    });
                    const pollData = await pollRes.json();

                    if (pollData.status === 'completed') {
                      if (taskType === 'video' || pollData.videoUrl) {
                        const vUrl = pollData.videoUrl || pollData.result?.videoUrl;
                        if (vUrl) allPolledVideoUrls.push(vUrl);
                      } else {
                        const extractedUrl = extractTaskResultImageUrl(pollData);
                        if (extractedUrl && typeof extractedUrl === 'string') allPolledUrls.push(extractedUrl);
                      }
                      break;
                    } else if (pollData.status === 'failed' || pollData.retryable === false) {
                      console.warn('[ChatImage] Task', taskId, 'failed:', pollData.error);
                      break;
                    }
                  } catch (pollErr) {
                    console.warn('[ChatImage] Poll error for task', taskId, pollErr);
                  }
                }
              }

              // 将轮询到的图片/视频添加到画布
              if (allPolledUrls.length > 0) {
                const savedUrls: string[] = [];
                for (const url of allPolledUrls) {
                  try {
                    const saveRes = await fetch('/api/save-image', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ imageUrl: url }),
                    });
                    const saveData = await saveRes.json();
                    savedUrls.push(saveData.savedUrl || saveData.url || url);
                  } catch { savedUrls.push(url); }
                }
                // 去重：只添加尚未添加到画布的图片
                const newUrls = savedUrls.filter(u => !addedImageUrls.has(u));
                newUrls.forEach(u => addedImageUrls.add(u));
                if (onAddImages && newUrls.length > 0) {
                  onAddImages(newUrls);
                }
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, generatedImages: [...new Set([...(msg.generatedImages || []), ...newUrls])], isGeneratingImage: false, generateProgress: 100 }
                    : msg
                ));
              } else if (allPolledVideoUrls.length > 0) {
                const newVideoUrls = allPolledVideoUrls.filter(u => !addedImageUrls.has(u));
                newVideoUrls.forEach(u => addedImageUrls.add(u));
                if (onAddImages && newVideoUrls.length > 0) onAddImages(newVideoUrls);
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, generatedImages: [...new Set([...(msg.generatedImages || []), ...newVideoUrls])], isGeneratingImage: false, generateProgress: 100 }
                    : msg
                ));
              } else {
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, isGeneratingImage: false, generateError: '图像生成完成但未获取到结果' }
                    : msg
                ));
              }
            } catch (err) {
              console.error('[ChatImage] Task polling error:', err);
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, isGeneratingImage: false, generateError: '图像生成轮询失败' }
                  : msg
              ));
            }
          })();
        }
      } else if (hasGenerateTags) {
        // ====== 兜底：[GENERATE: ...] 标签解析（不支持 function calling 的模型） ======
        const prompts: string[] = generateMatches.map(m => m[1].trim());
        const displayContent = assistantContent.replace(/\[GENERATE:\s*[\s\S]+?\]/g, '').trim();
        const imageModelInfo = getCurrentImageModelInfo(imageModel, imageModelProviderId);
        const imageCount = prompts.length > 0 ? prompts.length : detectImageCountFromText(trimmedInput);
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: displayContent, isGeneratingImage: true, generateModelName: imageModelInfo.model || '图像生成', generateProviderId: imageModelInfo.providerId, generateProgress: 0, generateImageCount: imageCount }
            : msg
        ));

        if (!imageModelInfo.model) {
          console.warn('[ChatImage] No image model selected');
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, isGeneratingImage: false, generateError: '请先在聊天输入框选择一个图像模型，然后再试一次' }
              : msg
          ));
        } else {
          (async () => {
            try {
              const aspectRatio = detectAspectRatioFromText(prompts.join(' ') + ' ' + trimmedInput) || '1:1';
              const quality = detectQualityFromText(prompts.join(' ') + ' ' + trimmedInput) || '1K';
              const referenceImages = capturedPendingImages.map(img => img.url);
              const imageSourceId = capturedPendingImages.length > 0 ? capturedPendingImages[0].id : undefined;

              console.log(`[ChatImage] [GENERATE] fallback: ${prompts.length} prompt(s)`);

              const allResultUrls: string[] = [];
              for (let promptIdx = 0; promptIdx < prompts.length; promptIdx++) {
                const rawPrompt = prompts[promptIdx];
                const isMultiPrompt = prompts.length > 1;

                if (isMultiPrompt) {
                  const baseProgress = Math.round((promptIdx / prompts.length) * 100);
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, generateProgress: baseProgress }
                      : msg
                  ));
                }

                const generateRes = await fetch('/api/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: rawPrompt,
                    model: imageModelInfo.model,
                    providerId: imageModelInfo.providerId,
                    aspectRatio,
                    quality,
                    outputCount: 1,
                    submitOnly: true,
                    ...(referenceImages.length > 0 ? { referenceImages } : {}),
                  }),
                });
                const generateData = await generateRes.json();
                if (!generateData.success) { continue; }

                const genModel = generateData.model || imageModelInfo.model;
                const promptResultUrls: string[] = [];

                if (generateData.imageUrls?.length > 0) { promptResultUrls.push(...generateData.imageUrls); }
                else if (generateData.imageUrl) { promptResultUrls.push(generateData.imageUrl); }

                const taskIds: string[] = generateData.taskIds || [];
                // Save pending generation tasks for recovery (immediate persist)
                persistMessageUpdate(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, pendingGenerationTasks: [{ taskIds, model: genModel, providerId: imageModelInfo.providerId, assistantMessageId, timestamp: Date.now() }] } as unknown as Message
                    : msg
                ));
                if (taskIds.length > 0 && promptResultUrls.length === 0) {
                  for (const taskId of taskIds) {
                    for (let i = 0; i < CHAT_TASK_MAX_ATTEMPTS; i++) {
                      const interval = getChatTaskPollIntervalMs(i);
                      await new Promise(r => setTimeout(r, interval));
                      const pollProgress = isMultiPrompt
                        ? Math.round(((promptIdx + (i / CHAT_TASK_MAX_ATTEMPTS)) / prompts.length) * 100)
                        : Math.min(90, 10 + Math.round((i / CHAT_TASK_MAX_ATTEMPTS) * 80));
                      setMessages(prev => prev.map(msg => 
                        msg.id === assistantMessageId ? { ...msg, generateProgress: pollProgress } : msg
                      ));
                      try {
                        const pollRes = await fetch('/api/poll-task', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();
                        if (pollData.status === 'completed') {
                          const extractedUrl = extractTaskResultImageUrl(pollData);
                          if (extractedUrl && typeof extractedUrl === 'string') { promptResultUrls.push(extractedUrl); }
                          break;
                        } else if (pollData.status === 'failed' || pollData.retryable === false) { break; }
                      } catch { /* retry */ }
                    }
                  }
                }
                allResultUrls.push(...promptResultUrls);
                if (allResultUrls.length > 0) {
                  const uniqueResultUrls = [...new Set(allResultUrls)];
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId ? { ...msg, generatedImages: uniqueResultUrls } : msg
                  ));
                }
              }

              if (allResultUrls.length > 0) {
                const uniqueResultUrls = [...new Set(allResultUrls)];
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, generatedImages: uniqueResultUrls, isGeneratingImage: false, generateProgress: 100 }
                    : msg
                ));
                if (onAddImages) {
                  onAddImages(uniqueResultUrls, imageSourceId, { modelName: imageModelInfo.model, apiProvider: providerDisplayName(imageModelInfo.providerId) });
                }
              } else {
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, isGeneratingImage: false, generateError: '图像生成未返回结果，请检查图像模型配置' }
                    : msg
                ));
              }
            } catch (imgError) {
              console.error('[ChatImage] Image generation error:', imgError);
              setMessages(prev => prev.map(msg => 
                msg.id === assistantMessageId 
                  ? { ...msg, isGeneratingImage: false, generateError: `图像生成出错: ${imgError instanceof Error ? imgError.message : '未知错误'}` }
                  : msg
              ));
            }
          })();
        }
      } else if (!hasToolGeneratedImages && (pendingImages.length > 0 || (activeSkill && ['image', 'design'].includes(activeSkill.category)))) {
        // ====== 兜底：意图检测（既无工具调用也无 [GENERATE] 标签，但用户意图明确） ======
        const userWantsImage = isImageGenerationIntent(trimmedInput);
        if (userWantsImage) {
          console.log('[ChatImage] Fallback: intent detection triggered');
          const imageModelInfo = getCurrentImageModelInfo(imageModel, imageModelProviderId);
          const imageCount = detectImageCountFromText(trimmedInput);
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, isGeneratingImage: true, generateModelName: imageModelInfo.model || '图像生成', generateProviderId: imageModelInfo.providerId, generateProgress: 0, generateImageCount: imageCount }
              : msg
          ));

          if (!imageModelInfo.model) {
            setMessages(prev => prev.map(msg => 
              msg.id === assistantMessageId 
                ? { ...msg, isGeneratingImage: false, generateError: '请先在聊天输入框选择一个图像模型' }
                : msg
            ));
          } else {
            (async () => {
              try {
                const referenceImages = capturedPendingImages.map(img => img.url);
                const imageSourceId = capturedPendingImages.length > 0 ? capturedPendingImages[0].id : undefined;
                const aspectRatio = detectAspectRatioFromText(trimmedInput) || '1:1';
                const quality = detectQualityFromText(trimmedInput) || '1K';
                const outputCount = detectImageCountFromText(trimmedInput);

                let optimizedPrompt = trimmedInput;
                try {
                  const optRes = await fetch('/api/optimize-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: trimmedInput, mode: 'enhance', model: actualModel, providerId }),
                  });
                  const optData = await optRes.json();
                  if (optData.optimizedPrompt) optimizedPrompt = optData.optimizedPrompt;
                } catch { /* use original */ }

                const generateRes = await fetch('/api/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: optimizedPrompt, model: imageModelInfo.model, providerId: imageModelInfo.providerId,
                    aspectRatio, quality, outputCount, submitOnly: true,
                    ...(referenceImages.length > 0 ? { referenceImages } : {}),
                  }),
                });
                const generateData = await generateRes.json();
                if (!generateData.success) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, isGeneratingImage: false, generateError: `图像生成失败: ${generateData.error || '未知错误'}` }
                      : msg
                  ));
                  return;
                }

                const taskIds: string[] = generateData.taskIds || [];
                const genModel = generateData.model || imageModelInfo.model;
                // Save pending generation tasks for recovery (immediate persist)
                persistMessageUpdate(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, pendingGenerationTasks: [{ taskIds, model: genModel, providerId: imageModelInfo.providerId, assistantMessageId, timestamp: Date.now() }] } as unknown as Message
                    : msg
                ));
                const resultUrls: string[] = [];

                if (generateData.imageUrls?.length > 0) { resultUrls.push(...generateData.imageUrls); }
                else if (generateData.imageUrl) { resultUrls.push(generateData.imageUrl); }

                if (taskIds.length > 0 && resultUrls.length === 0) {
                  for (const taskId of taskIds) {
                    for (let i = 0; i < CHAT_TASK_MAX_ATTEMPTS; i++) {
                      const interval = getChatTaskPollIntervalMs(i);
                      await new Promise(r => setTimeout(r, interval));
                      const progress = Math.min(90, 10 + Math.round((i / CHAT_TASK_MAX_ATTEMPTS) * 80));
                      setMessages(prev => prev.map(msg => 
                        msg.id === assistantMessageId ? { ...msg, generateProgress: progress } : msg
                      ));
                      try {
                        const pollRes = await fetch('/api/poll-task', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();
                        if (pollData.status === 'completed') {
                          const extractedUrl = extractTaskResultImageUrl(pollData);
                          if (extractedUrl && typeof extractedUrl === 'string') { resultUrls.push(extractedUrl); }
                          break;
                        } else if (pollData.status === 'failed' || pollData.retryable === false) {
                          setMessages(prev => prev.map(msg => 
                            msg.id === assistantMessageId 
                              ? { ...msg, isGeneratingImage: false, generateError: pollData.error || '生成失败' }
                              : msg
                          ));
                          return;
                        }
                      } catch { /* retry */ }
                    }
                  }
                }

                if (resultUrls.length > 0) {
                  const uniqueResultUrls = [...new Set(resultUrls)];
                  // 生成建议下一步
                  const suggestions = generateSuggestions({ contentCategory: 'image_generated', modelName: imageModelInfo.model });
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, generatedImages: uniqueResultUrls, isGeneratingImage: false, generateProgress: 100, suggestions }
                      : msg
                  ));
                  if (onAddImages) {
                    onAddImages(uniqueResultUrls, imageSourceId, { modelName: imageModelInfo.model, apiProvider: providerDisplayName(imageModelInfo.providerId) });
                  }
                } else {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, isGeneratingImage: false, generateError: '图像生成未返回结果' }
                      : msg
                  ));
                }
              } catch (imgError) {
                console.error('[ChatImage] Fallback generation error:', imgError);
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, isGeneratingImage: false, generateError: `图像生成出错: ${imgError instanceof Error ? imgError.message : '未知错误'}` }
                    : msg
                ));
              }
            })();
          }
        }
      }

      // ====== P0-1: ChatCanvas 画布操作解析与提示 ======
      const canvasAction = extractCanvasActionFromAIResponse(assistantContent);
      if (canvasAction && selectedCanvasImage) {
        console.log('[ChatCanvas] 解析到画布操作指令:', canvasAction.type);
        // 注：实际执行需要后续集成画布操作API
        // 当前仅解析指令并在回复中提示用户
        const actionLabel = {
          upscale: '放大',
          remove_bg: '去背景',
          img2img: '图生图',
          erase: '擦除',
          extend: '扩展画面',
          crop: '裁切',
          generate: '生成新图',
          filter: '滤镜风格',
          move: '移动位置',
          delete: '删除',
          duplicate: '复制',
          arrange: '排列',
          color_adjust: '色彩调整',
          add_text: '添加文字',
          composite: '合成',
        }[canvasAction.type] || canvasAction.type;
        // 替换CANVAS_ACTION标签为可点击的提示
        assistantContent = assistantContent.replace(/\[CANVAS_ACTION\][\s\S]*?\[\/CANVAS_ACTION\]/, 
          `💡 **画布操作建议**: ${actionLabel} - 请在画布中选中图片后使用工具栏执行此操作`);
      }

      // 保存对话
      const finalMessages = [...newMessages, { id: assistantMessageId, role: 'assistant' as const, content: assistantContent, timestamp: Date.now() }];
      saveSession(finalMessages, model, systemPrompt);
      // 记录聊天使用
      try { UserManager.getInstance().recordUsage('chat'); } catch {}
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}.请检查API Key配置或稍后重试。`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, messages, model, systemPrompt, isThinkingMode, saveSession, pendingImages, allAgents, activeMentions, brandDna, tuneContextString, activeSkill, skillParamValues, onAddImages]);

  // Lovart 风格 Skill 调用：点击 Skill 直接创建对话并自动发送，AI 按 Skill 方法论引导用户
  const handleUseSkill = useCallback((skill: ChatSkill) => {
    // 1. 设置 activeSkill 标记
    setActiveSkill(skill);

    // 2. 构建最终 systemPrompt（优先 agentId，其次 skill.systemPrompt）
    let skillSystemPrompt = skill.systemPrompt || '';
    // 如果 Skill 关联了智能体，使用该智能体的 prompt
    if (skill.agentId) {
      const matchedAgent = allAgents.find(a => a.id === skill.agentId);
      if (matchedAgent) {
        skillSystemPrompt = matchedAgent.prompt;
      }
    }
    // 如果没有 agentId，检查是否有智能体的 skillIds 包含此 Skill
    if (!skill.agentId) {
      const matchedAgent = allAgents.find(a => a.skillIds?.includes(skill.id));
      if (matchedAgent) {
        skillSystemPrompt = matchedAgent.prompt;
      }
    }
    // 同步更新 systemPrompt 状态
    setSystemPrompt(skillSystemPrompt);

    // 3. 切换到聊天 tab
    setActiveTab('chat');

    // 4. 更新使用计数
    saveSkills(chatSkills.map(s => s.id === skill.id ? { ...s, usageCount: s.usageCount + 1, updatedAt: Date.now() } : s));

    // 5. 清空当前对话，创建新会话
    setMessages([]);
    setCurrentSessionId(`session-${Date.now()}`);

    // 6. 不自动发送，而是设置输入框占位提示，等待用户描述需求
    setInput('');

    // 7. 初始化参数默认值
    const defaultParams: Record<string, string> = {};
    skill.paramSlots?.forEach(p => {
      if (p.defaultValue) defaultParams[p.name] = p.defaultValue;
    });
    setSkillParamValues(defaultParams);
  }, [chatSkills, saveSkills, allAgents]);

  // 提示词大师功能 - Agent智能体化
  const handleOptimizePrompt = useCallback(async () => {
    if (!optimizerInput.trim() || isOptimizing) return;
    setIsOptimizing(true);
    setOptimizerOutputEn('');
    setOptimizerOutputCn('');
    
    try {
      const modePrompts = {
        enhance: `你是一个专业的AI图像生成提示词优化大师（Agent）。你的任务是接收用户简单的图像描述，将其转化为专业、详细、高质量的AI图像生成提示词。

优化流程：
1. 分析用户意图，理解核心主题
2. 扩展细节：光影、色调、构图、氛围、风格
3. 添加专业术语：摄影术语、艺术风格、渲染引擎关键词
4. 确保提示词结构清晰，适合AI图像生成模型理解

输出格式要求（严格遵守，必须同时输出英文和中文两个版本）：
【English】
英文优化后的提示词，包含详细的光影、构图、风格描述，关键词用逗号分隔

【中文】
中文优化后的提示词，同样详细但使用中文描述

注意：
- 英文版本应适合直接用于DALL-E/Midjourney/Stable Diffusion等模型
- 中文版本应自然流畅，保留专业描述的准确性
- 必须同时输出英文和中文，缺一不可
- 两个版本内容对应但表达方式符合各自语言习惯`,

        expand: `你是一个专业的AI图像生成提示词扩展大师（Agent）。你的任务是将用户的简短描述扩展为完整的场景描述。

扩展流程：
1. 解读用户简短描述的意图
2. 构建完整场景：时间、地点、氛围、人物、动作
3. 添加环境细节：天气、光线、背景元素
4. 指定艺术风格和渲染方式

输出格式要求（严格遵守，必须同时输出英文和中文两个版本）：
【English】
扩展后的英文场景描述，包含完整的环境、人物、光影、风格描述

【中文】
扩展后的中文场景描述，同样完整但使用中文表达

注意：
- 扩展应保持与原始意图一致，不偏离主题
- 英文版本注重关键词密度和排列
- 中文版本注重描述的连贯性和画面感
- 必须同时输出英文和中文，缺一不可`,

        simplify: `你是一个专业的AI图像生成提示词精炼大师（Agent）。你的任务是提取用户冗长描述的核心要素，精炼为高效的AI图像生成关键词。

精炼流程：
1. 提取核心主体和关键特征
2. 去除冗余描述，保留最关键的视觉要素
3. 用最精准的词汇表达
4. 确保关键词权重合理排列

输出格式要求（严格遵守，必须同时输出英文和中文两个版本）：
【English】
精炼后的英文关键词，核心在前，细节在后，逗号分隔

【中文】
精炼后的中文关键词，同样精炼但使用中文表达

注意：
- 精炼不是删减，而是提炼精华
- 英文版本应适合直接粘贴到图像生成模型
- 中文版本应简明扼要但信息完整
- 必须同时输出英文和中文，缺一不可`
      };

      const agentSystemPrompt = modePrompts[optimizerMode];

      const response = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: optimizerInput.trim(),
          model: model,
          providerId: model.includes('::') ? model.split('::')[0] : undefined,
          mode: 'agent',
          systemPrompt: agentSystemPrompt,
        }),
      });

      if (!response.ok) {
        throw new Error(`优化失败: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      const result = data.optimized || '';
      
      // 清理思考过程标签
      const cleaned = result
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
        .replace(/\*\*[^*]*\*\*/g, '')
        .trim();
      
      // 解析中英文 - 增强版
      let enPart = '';
      let cnPart = '';
      const enMatch = cleaned.match(/【English】\s*([\s\S]*?)(?=【中文】|$)/);
      const cnMatch = cleaned.match(/【中文】\s*([\s\S]*?)$/);
      if (enMatch) enPart = enMatch[1].trim();
      if (cnMatch) cnPart = cnMatch[1].trim();
      
      // 如果没有找到中文部分，尝试其他格式
      if (!cnPart && enPart) {
        const altCnMatch = cleaned.match(/[Cc]hinese[：:]\s*([\s\S]*?)$/);
        if (altCnMatch) cnPart = altCnMatch[1].trim();
      }
      
      if (!enPart && !cnPart) {
        // 如果完全没解析出标记，整段作为结果
        enPart = cleaned;
        cnPart = '';
      } else if (enPart && !cnPart) {
        cnPart = '';
      }

      setOptimizerOutputEn(enPart);
      setOptimizerOutputCn(cnPart);

      if (result) {
        setOptimizerHistory(prev => [{
          input: optimizerInput.trim(),
          outputEn: enPart,
          outputCn: cnPart,
          mode: optimizerMode,
          time: Date.now()
        }, ...prev].slice(0, 20));
      }
    } catch (error) {
      console.error('Optimize prompt error:', error);
      setOptimizerOutputEn(`优化失败：${error instanceof Error ? error.message : '未知错误'}`);
      setOptimizerOutputCn('');
    } finally {
      setIsOptimizing(false);
    }
  }, [optimizerInput, isOptimizing, model, optimizerMode]);

  const handleAddToGeneration = useCallback((lang: 'en' | 'cn') => {
    const text = lang === 'en' ? optimizerOutputEn : optimizerOutputCn;
    if (text.trim() && onAddToPrompt) {
      onAddToPrompt(text);
    }
  }, [optimizerOutputEn, optimizerOutputCn, onAddToPrompt]);

  const handleAddMessageToGeneration = useCallback((content: string) => {
    if (!content.trim() || !onAddToPrompt) return;
    const prompt = extractPromptForGeneration(content);
    onAddToPrompt(prompt);
  }, [onAddToPrompt]);

  const themeClasses = themeStyle === 'gold'
    ? {
        bg: 'bg-[#1a1d26] border border-white/[0.06]',
        border: 'border-white/[0.04]',
        text: 'text-white',
        textMuted: 'text-gold-muted',
        accent: 'from-gold to-gold-dark',
        inputBg: 'bg-white/5',
        cardBg: 'bg-white/[0.04]',
      }
    : {
        bg: 'bg-white',
        border: 'border-gray-200',
        text: 'text-gray-900',
        textMuted: 'text-gray-500',
        accent: 'from-blue-500 to-blue-600',
        inputBg: 'bg-gray-50',
        cardBg: 'bg-gray-50/50',
      };

  const isGold = themeStyle === 'gold';

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`} ref={chatContainerRef}>
      {/* Header with Tabs - 精致标签设计 */}
      <div className={`shrink-0 ${isGold ? 'border-b border-white/[0.04]' : ''}`}>
        <div className="px-4 pt-3 flex items-center justify-between">
          <div className={`relative flex items-center ${isGold ? 'bg-white/[0.04] p-0.5 rounded-lg' : 'bg-gray-100 p-0.5 rounded-lg'}`}>
            <button
              aria-label="智能对话"
              onClick={() => setActiveTab('chat')}
              className={`relative z-10 px-1.5 py-1 min-h-[32px] text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'chat'
                  ? isGold
                    ? 'bg-gold/15 text-gold shadow-sm'
                    : 'bg-white text-gray-900 shadow-sm'
                  : isGold
                    ? 'text-gold-muted/70 hover:text-muted-foreground'
                    : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <MessageSquare size={13} />
              智能对话
            </button>
            <button
              aria-label="提示词大师"
              onClick={() => setActiveTab('optimizer')}
              className={`relative z-10 px-1.5 py-1 min-h-[32px] text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'optimizer'
                  ? isGold
                    ? 'bg-gold/15 text-gold shadow-sm'
                    : 'bg-white text-gray-900 shadow-sm'
                  : isGold
                    ? 'text-gold-muted/70 hover:text-muted-foreground'
                    : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Wand2 size={13} />
              提示词大师
            </button>
            <button
              aria-label="Skills技能库"
              onClick={() => setActiveTab('skills')}
              className={`relative z-10 px-1.5 py-1 min-h-[32px] text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'skills'
                  ? isGold
                    ? 'bg-gold/15 text-gold shadow-sm'
                    : 'bg-white text-gray-900 shadow-sm'
                  : isGold
                    ? 'text-gold-muted/70 hover:text-muted-foreground'
                    : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Bookmark size={13} />
              Skills
              {chatSkills.length > 0 && (
                <span className={`ml-0.5 text-[10px] ${activeTab === 'skills' ? (isGold ? 'text-gold' : 'text-blue-500') : (isGold ? 'text-gold-muted/50' : 'text-gray-400')}`}>
                  {chatSkills.length}
                </span>
              )}
            </button>
          </div>
          {activeTab === 'chat' && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  if (messages.length >= 2) {
                    setSkillSaveName('');
                    setSkillSaveCategory('custom');
                    setSkillSaveDescription('');
                    setShowSkillSaveDialog(!showSkillSaveDialog);
                  }
                }}
                className={`p-1.5 rounded-md transition-colors ${
                  messages.length < 2
                    ? isGold ? 'text-gold-muted/30 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                    : showSkillSaveDialog
                      ? isGold ? 'text-gold bg-gold/10' : 'text-gray-900 bg-gray-100'
                      : isGold ? 'text-gold-muted hover:text-gold hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title={messages.length < 2 ? '至少2条对话才能保存为Skill' : '保存为Skill'}
              >
                <BookmarkCheck size={14} />
              </button>
              <button
                onClick={handleNewChat}
                className={`p-1.5 rounded-md transition-colors ${
                  isGold ? 'text-gold-muted hover:text-gold hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="新建对话"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => { setShowHistoryPanel(!showHistoryPanel); setShowFilePanel(false); }}
                className={`p-2 rounded-lg transition-colors ${
                  showHistoryPanel
                    ? isGold ? 'text-gold bg-gold/10' : 'text-gray-900 bg-gray-100'
                    : isGold ? 'text-gold-muted hover:text-gold hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="历史对话"
              >
                <History size={14} />
              </button>
              <button
                onClick={() => { setShowFilePanel(!showFilePanel); setShowHistoryPanel(false); }}
                className={`p-2 rounded-lg transition-colors ${
                  showFilePanel
                    ? isGold ? 'text-gold bg-gold/10' : 'text-gray-900 bg-gray-100'
                    : isGold ? 'text-gold-muted hover:text-gold hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="文件列表"
              >
                <FolderOpen size={14} />
              </button>
              <button
                onClick={clearChat}
                className={`p-2 rounded-lg transition-colors ${
                  isGold ? 'text-gold-muted hover:text-red-400 hover:bg-red-400/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                }`}
                title="清空聊天"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
        <div className={`mt-2 border-b ${themeClasses.border}`} />
      </div>

      {/* Chat Tab Content */}
      {activeTab === 'chat' && (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* 历史对话面板 */}
        {showHistoryPanel && (
          <div className={`border-b ${themeClasses.border} shrink-0 max-h-[240px] overflow-y-auto`}>
            <div className={`p-3 ${isGold ? 'bg-[#0d0d0d]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-xs font-medium ${isGold ? 'text-muted-foreground' : 'text-gray-500'}`}>历史对话</span>
                <span className={`text-xs ${themeClasses.textMuted}`}>{chatSessions.length} 条记录</span>
              </div>
              {chatSessions.length === 0 ? (
                <div className={`text-xs text-center py-4 ${themeClasses.textMuted}`}>暂无历史对话</div>
              ) : (
                <div className="space-y-1.5">
                  {chatSessions.map(session => (
                    <div
                      key={session.id}
                      onClick={() => handleSwitchSession(session.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all group ${
                        session.id === currentSessionId
                          ? isGold ? 'bg-gold/10 border border-gold/20' : 'bg-blue-50 border border-blue-200'
                          : isGold ? 'hover:bg-white/[0.06] border border-transparent' : 'hover:bg-white border border-transparent'
                      }`}
                    >
                      {session.agentId ? (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: allAgents.find(a => a.id === session.agentId)?.color || '#888' }}
                        />
                      ) : (
                        <MessageSquare size={12} className={session.id === currentSessionId ? (isGold ? 'text-gold' : 'text-blue-500') : themeClasses.textMuted} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium truncate ${session.id === currentSessionId ? themeClasses.text : themeClasses.textMuted}`}>
                          {session.agentId ? (
                            <span>{allAgents.find(a => a.id === session.agentId)?.name || session.title}</span>
                          ) : session.title}
                        </div>
                        <div className={`text-xs ${themeClasses.textMuted}`}>
                          {session.agentId ? `${session.title}` : `${new Date(session.updatedAt).toLocaleDateString()} ${new Date(session.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${
                          isGold ? 'hover:text-red-400 text-gold-muted/70' : 'hover:text-red-500 text-gray-400'
                        }`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 文件列表面板 */}
        {showFilePanel && (
          <div className={`border-b ${themeClasses.border} shrink-0 max-h-[240px] overflow-y-auto`}>
            <div className={`p-3 ${isGold ? 'bg-[#0d0d0d]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-xs font-medium ${isGold ? 'text-muted-foreground' : 'text-gray-500'}`}>已生成的图片</span>
                <span className={`text-xs ${themeClasses.textMuted}`}>{canvasImages.length} 张图片</span>
              </div>
              {canvasImages.length === 0 ? (
                <div className={`text-xs text-center py-4 ${themeClasses.textMuted}`}>暂无生成图片</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {canvasImages.map(img => (
                    <div
                      key={img.id}
                      className={`aspect-square rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 relative group ${
                        isGold ? 'border-white/[0.04] hover:border-gold/40' : 'border-gray-200 hover:border-gray-400'
                      }`}
                      onClick={() => {
                        // 添加为@图片引用（同时同步到pendingImages用于发送）
                        if (!activeMentions.find(m => m.type === 'canvas-image' && m.id === img.id)) {
                          setActiveMentions(prev => [...prev, {
                            type: 'canvas-image',
                            id: img.id,
                            label: img.prompt?.slice(0, 15) || '画布图片',
                            imageUrl: img.url,
                            data: { url: img.url },
                          }]);
                        }
                        if (!pendingImages.find(p => p.id === img.id)) {
                          setPendingImages(prev => [...prev, { id: img.id, url: img.url, name: img.prompt?.slice(0, 20) || '画布图片' }]);
                        }
                        if (onAddToPrompt && img.prompt) {
                          onAddToPrompt(img.prompt);
                        }
                      }}
                      title={img.prompt || '点击添加到聊天'}
                    >
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <Plus size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Bar - 单行布局 */}
        <div className={`border-b ${themeClasses.border} shrink-0 px-3 py-2`}>
          <div className="flex items-center gap-2 flex-wrap">
            {/* LLM模型选择器 */}
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className={`h-7 text-xs flex-1 min-w-[120px] ${themeClasses.inputBg} ${themeClasses.border} ${themeClasses.text}`}>
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" sideOffset={4} className={themeClasses.bg}>
                {(() => {
                  // Group discovered server models by provider
                  const grouped: Record<string, typeof discoveredChatModels> = {};
                  discoveredChatModels.forEach(m => {
                    const key = m.provider || '管理员配置';
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(m);
                  });
                  return Object.entries(grouped).map(([providerName, models]) => (
                    <div key={providerName}>
                      <div className={`px-2 py-0.5 text-xs font-semibold ${themeClasses.textMuted} border-t ${themeClasses.border} mt-1 pt-2`}>
                        {providerName}
                      </div>
                      {models.map(m => (
                        <SelectItem key={m.id} value={m.id} className={themeClasses.text}>
                          <div className="flex flex-col w-full">
                            <span className="font-medium text-xs">{m.name}</span>
                            {m.description && <span className={`text-xs ${themeClasses.textMuted}`}>{m.description}</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ));
                })()}
                {thirdPartyChatModels.length > 0 && (
                  <>
                    {(() => {
                      // Group third-party chat models by provider name
                      const grouped: Record<string, typeof thirdPartyChatModels> = {};
                      thirdPartyChatModels.forEach(m => {
                        const key = m.provider || '未知';
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(m);
                      });
                      return Object.entries(grouped).map(([providerName, models]) => (
                        <div key={providerName}>
                          <div className={`px-2 py-0.5 text-xs font-semibold ${themeClasses.textMuted} border-t ${themeClasses.border} mt-1 pt-2`}>
                            {providerName}
                          </div>
                          {models.map(m => (
                            <SelectItem key={m.id} value={m.id} className={themeClasses.text}>
                              <div className="flex flex-col w-full">
                                <span className="font-medium text-xs">{m.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      ));
                    })()}
                  </>
                )}
              </SelectContent>
            </Select>

            {/* 智能体下拉选择器 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all border shrink-0 ${
                    systemPrompt
                      ? isGold
                        ? 'border-gold/30 bg-gold/10 text-gold'
                        : 'border-blue-200 bg-blue-50 text-blue-600'
                      : isGold
                        ? 'border-white/[0.08] text-gold-muted/70 hover:border-gold/20 hover:text-gold'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700'
                  }`}
                >
                  <Bot size={14} />
                  {systemPrompt ? allAgents.find(a => a.id === systemPrompt)?.name || '智能体' : '智能体'}
                  <ChevronDown size={14} className="ml-0.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 max-h-[280px] overflow-y-auto">
                {allAgents.map(agent => (
                  <DropdownMenuItem
                    key={agent.id}
                    onClick={() => setSystemPrompt(prev => prev === agent.id ? '' : agent.id)}
                    className={`flex items-center gap-2 cursor-pointer ${
                      systemPrompt === agent.id ? 'bg-accent' : ''
                    }`}
                  >
                    <span className="text-sm">{agent.icon}</span>
                    <span className="flex-1">{agent.name}</span>
                    {systemPrompt === agent.id && (
                      <Check size={14} className="text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => { setEditingAgent(null); setShowAgentBuilder(true); }}
                  className="flex items-center gap-2 cursor-pointer text-muted-foreground"
                >
                  <Plus size={14} />
                  <span>新增智能体</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Agent模式开关 */}
            <button
              onClick={() => setIsAgentMode(!isAgentMode)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all shrink-0 ${
                isAgentMode
                  ? isGold
                    ? 'bg-gradient-to-r from-gold/20 to-amber-500/20 text-gold border border-gold/30'
                    : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 text-blue-600 border border-blue-200'
                  : isGold
                    ? 'text-gold-muted/50 hover:text-gold-muted border border-transparent hover:border-white/[0.08]'
                    : 'text-gray-400 hover:text-gray-600 border border-transparent hover:border-gray-200'
              }`}
              title={isAgentMode ? 'Agent模式已开启：描述需求自动调用工具生成成品' : '点击开启Agent模式：自然语言自动生图/修图/配音'}
            >
              <Zap size={13} className={isAgentMode ? 'animate-pulse' : ''} />
              Agent
              {isAgentMode && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            </button>

            {/* 思考开启按钮 */}
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                id="thinking-mode"
                checked={isThinkingMode}
                onCheckedChange={setIsThinkingMode}
                className="scale-75 origin-center"
              />
              <Label htmlFor="thinking-mode" className={`text-xs ${themeClasses.textMuted} cursor-pointer select-none flex items-center gap-0.5`}>
                <Sparkles size={10} className={isThinkingMode ? (isGold ? 'text-gold' : 'text-gray-700') : (isGold ? 'text-gold-muted/50' : 'text-gray-400')} />
                思考
              </Label>
            </div>

            {/* 第三方模型配置按钮 */}
            <button
              onClick={() => setShowThirdPartyDialog(true)}
              className={`shrink-0 p-1 rounded-md border transition-all ${
                isGold
                  ? 'border-gold/30 hover:border-gold/60 hover:bg-gold/10 text-gold/70 hover:text-gold'
                  : 'border-gray-300 hover:border-gray-500 hover:bg-gray-100 text-gray-400 hover:text-gray-700'
              }`}
              title="第三方模型调用"
            >
              <Plug size={12} />
            </button>
          </div>
          {systemPrompt && (() => {
            const selectedAgent = allAgents.find(a => a.id === systemPrompt);
            if (!selectedAgent) return null;
            const isCustom = customAgents.some(a => a.id === selectedAgent.id);
            return (
              <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md mt-1 ${isGold ? 'bg-[#0d0d0d]' : 'bg-[#f5f5f5]'}`}>
                <div className="w-0.5 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedAgent.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-medium ${isGold ? 'text-gold' : 'text-gray-900'}`}>{selectedAgent.name}</span>
                    <span className={`text-xs ${isGold ? 'text-gold-muted' : 'text-gray-500'}`}>{selectedAgent.nameEn}</span>
                  </div>
                  {selectedAgent.tools && selectedAgent.tools.length > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                      {selectedAgent.tools.map(tool => {
                        const toolMeta: Record<string, { label: string; icon: string }> = {
                          generate_image: { label: '生图', icon: '🎨' },
                          edit_image: { label: '修图', icon: '✏️' },
                          remove_bg: { label: '去背景', icon: '✂️' },
                          upscale: { label: '放大', icon: '🔍' },
                          generate_video: { label: '视频', icon: '🎬' },
                          img2video: { label: '图生视频', icon: '🎥' },
                          analyze_image: { label: '分析', icon: '🔎' },
                        };
                        const meta = toolMeta[tool] || { label: tool, icon: '⚡' };
                        return (
                          <span key={tool} className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded ${isGold ? 'bg-white/[0.06] text-gold-muted/70' : 'bg-gray-100 text-gray-500'}`}>
                            {meta.icon} {meta.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* P2-13: Associated Skills */}
                  {selectedAgent.skillIds && selectedAgent.skillIds.length > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                      <Bookmark size={8} className={isGold ? 'text-gold-muted/50' : 'text-gray-400'} />
                      {selectedAgent.skillIds.map(sid => {
                        const skill = chatSkills.find(s => s.id === sid);
                        if (!skill) return null;
                        return (
                          <button
                            key={sid}
                            onClick={(e) => { e.stopPropagation(); handleUseSkill(skill); }}
                            className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded transition-colors ${isGold ? 'bg-gold/10 text-gold-muted hover:bg-gold/20' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                            title={`使用 Skill: ${skill.name}`}
                          >
                            {skill.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {isCustom && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingAgent(selectedAgent); setShowAgentBuilder(true); }}
                      className={`p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-gold-muted' : 'hover:bg-gray-200 text-gray-500'}`}
                      title="编辑"
                    >
                      <Settings size={10} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const updated = customAgents.filter(a => a.id !== selectedAgent.id);
                        setCustomAgents(updated);
                        localStorage.setItem('custom-agents', JSON.stringify(updated));
                        setSystemPrompt('');
                      }}
                      className={`p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-gold-muted' : 'hover:bg-gray-200 text-gray-500'}`}
                      title="删除"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Agent identity badge when messages exist */}
        {messages.length > 0 && allAgents.find(a => a.id === systemPrompt) && (
          <div className={`shrink-0 px-3 py-1.5 flex items-center gap-1.5 border-b ${isGold ? 'bg-[#111]/80 border-white/5' : 'bg-gray-50/80 border-gray-100'}`}>
            <div className="w-4 h-4 rounded flex items-center justify-center text-[10px]" style={{ backgroundColor: (allAgents.find(a => a.id === systemPrompt)!.color) + '20', border: `1px solid ${(allAgents.find(a => a.id === systemPrompt)!.color)}40` }}>
              {allAgents.find(a => a.id === systemPrompt)!.icon}
            </div>
            <span className={`text-[10px] font-medium ${themeClasses.textMuted}`}>{allAgents.find(a => a.id === systemPrompt)!.name}</span>
            <span className={`text-[9px] ${isGold ? 'text-white/25' : 'text-gray-300'}`}>·</span>
            <span className={`text-[9px] ${themeClasses.textMuted} opacity-60`}>{allAgents.find(a => a.id === systemPrompt)!.nameEn}</span>
          </div>
        )}

        {/* Active Skill badge - Lovart 风格：技能名称标签头 */}
        {activeSkill && !allAgents.find(a => a.id === systemPrompt) && (
          <div className={`shrink-0 px-3 py-1.5 flex items-center gap-1.5 border-b ${isGold ? 'bg-[#111]/80 border-white/5' : 'bg-gray-50/80 border-gray-100'}`}>
            <span className={`text-[10px] font-semibold ${isGold ? 'text-[#d4af37]' : 'text-blue-500'}`}>{activeSkill.name}</span>
            {activeSkill.category && (
              <>
                <span className={`text-[9px] ${isGold ? 'text-white/25' : 'text-gray-300'}`}>·</span>
                <span className={`text-[9px] ${themeClasses.textMuted} opacity-60`}>{activeSkill.category}</span>
              </>
            )}
            <button
              onClick={() => { setActiveSkill(null); setSystemPrompt(''); }}
              className={`ml-auto p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-gold-muted' : 'hover:bg-gray-200 text-gray-400'}`}
              title="退出技能模式"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* Messages - 精致设计 */}
        <div className={`flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ${isGold ? 'bg-[#090909]' : 'bg-gray-50/50'}`}>
          {messages.length === 0 && pendingImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              {(() => {
                const selectedAgent = allAgents.find(a => a.id === systemPrompt);
                if (selectedAgent && selectedAgent.suggestedNextSteps && selectedAgent.suggestedNextSteps.length > 0) {
                  return (
                    <div className="flex flex-col items-center">
                      <div className={`w-12 h-12 rounded-2xl mb-2 flex items-center justify-center text-2xl`} style={{ backgroundColor: selectedAgent.color + '18', border: `1px solid ${selectedAgent.color}33` }}>
                        {selectedAgent.icon}
                      </div>
                      <h3 className={`text-base font-medium mb-0.5 ${themeClasses.text}`}>{selectedAgent.name}</h3>
                      <p className={`text-xs mb-3 ${themeClasses.textMuted}`}>{selectedAgent.nameEn}</p>
                      <div className="flex flex-col gap-1.5 w-full max-w-[240px]">
                        {selectedAgent.suggestedNextSteps.map((step, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              if (step.prefilledPrompt) {
                                setInput(step.prefilledPrompt);
                              }
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all ${
                              isGold
                                ? 'bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-gold/30 text-gold-muted hover:text-gold'
                                : 'bg-gray-50 border border-gray-100 hover:bg-gray-100 hover:border-gray-300 text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            <span className="text-sm">{'💡'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{step.label}</div>
                              {step.prefilledPrompt && (
                                <div className={`text-[10px] truncate ${isGold ? 'text-gold-muted/40' : 'text-gray-400'}`}>{step.prefilledPrompt}</div>
                              )}
                            </div>
                            <ChevronRight size={12} className={`shrink-0 ${isGold ? 'text-gold-muted/30' : 'text-gray-300'}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  // ★ Skill 激活状态：Lovart 风格 — 技能标签 + 引导输入
                  activeSkill ? (
                    <div className="flex flex-col items-center w-full max-w-[280px]">
                      {/* 技能图标 + 名称 */}
                      <div className={`w-12 h-12 rounded-xl mb-2 flex items-center justify-center text-xl ${
                        isGold ? 'bg-gold/10 border border-gold/20' : 'bg-blue-50 border border-blue-100'
                      }`}>
                        {{image: '🖼', design: '🎨', brand: '🏢', storyboard: '🎬', editing: '✏️', custom: '⚡'}[activeSkill.category as 'image'|'design'|'brand'|'storyboard'|'editing'|'custom'] || '⚡'}
                      </div>
                      <h3 className={`text-sm font-semibold mb-0.5 ${themeClasses.text}`}>{activeSkill.name}</h3>
                      {activeSkill.category && (
                        <span className={`text-[10px] mb-1.5 ${themeClasses.textMuted} opacity-60`}>{activeSkill.category}</span>
                      )}

                      {/* 引导提示 - Lovart 风格：告诉用户输入什么 */}
                      <div className={`w-full rounded-lg p-2.5 mb-3 text-center ${
                        isGold ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-100'
                      }`}>
                        <p className={`text-xs leading-relaxed ${themeClasses.textMuted}`}>
                          {activeSkill.paramSlots && activeSkill.paramSlots.length > 0
                            ? activeSkill.paramSlots[0].placeholder || `输入你的需求，AI 会先分析规划再生成`
                            : `描述你的需求，AI 会先分析规划再生成`}
                        </p>
                      </div>

                      {/* 参数输入 - Lovart 风格：紧凑内联 */}
                      {activeSkill.paramSlots && activeSkill.paramSlots.length > 0 && (
                        <div className="w-full space-y-1.5 mb-2">
                          {activeSkill.paramSlots.map((slot) => (
                            <div key={slot.name} className="text-left">
                              <label className={`text-[10px] font-medium ${themeClasses.textMuted} mb-0.5 block`}>{slot.label}</label>
                              <input
                                type="text"
                                value={skillParamValues[slot.name] || ''}
                                placeholder={slot.placeholder || ''}
                                onChange={(e) => setSkillParamValues(prev => ({ ...prev, [slot.name]: e.target.value }))}
                                className={`w-full text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                  isGold
                                    ? 'bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 focus:border-gold/40 focus:outline-none'
                                    : 'bg-white border-gray-200 text-gray-800 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none'
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                  <>
                    <div className={`w-16 h-16 rounded-2xl ${isGold ? 'bg-gold/10 border border-gold/20' : 'bg-gray-100 border border-gray-200'} flex items-center justify-center mb-3`}>
                      <Bot size={32} className={isGold ? 'text-gold' : 'text-gray-400'} />
                    </div>
                    <h3 className={`text-lg font-medium ${themeClasses.text} mb-2`}>开始对话</h3>
                    <p className={`text-sm ${themeClasses.textMuted} mb-4`}>选择模型并发送消息开始聊天</p>
                    <div className={`text-sm ${themeClasses.textMuted} space-y-1.5`}>
                      <p className="flex items-center gap-1.5 justify-center"><Upload size={14} /> 上传或粘贴图片到对话框</p>
                      <p className="flex items-center gap-1.5 justify-center"><ImageIcon size={14} /> AI自动分析并生成关键词</p>
                    </div>
                  </>
                  )
                );
              })()}
            </div>
          ) : (
            messages.map(message => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm ${
                    isGold ? 'bg-gold/10 text-gold ring-1 ring-[#d4af37]/20' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Bot size={14} />
                  </div>
                )}
                <div className={`max-w-[92%] ${message.role === 'user' ? 'order-2' : ''}`}>
                  {message.imageUrl && (
                    <div className={`rounded-xl overflow-hidden mb-0.5 ${isGold ? 'border border-white/[0.04]' : 'border border-gray-200'}`}>
                      <img src={message.imageUrl} alt="上传的图片" className="max-w-full max-h-40 object-contain" />
                    </div>
                  )}
                  {/* 图片锚点 */}
                  {message.imageAnchors && message.imageAnchors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {message.imageAnchors.map((anchor, aIdx) => (
                        <button
                          key={aIdx}
                          onClick={() => anchor.imageId && onNavigateToImage?.(anchor.imageId)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/30 border border-white/10 hover:bg-black/50 hover:border-white/20 transition-all cursor-pointer group/anchor"
                          title={anchor.imageId ? '点击定位到画布' : undefined}
                        >
                          <div className="w-6 h-6 rounded overflow-hidden bg-white/10 flex-shrink-0">
                            {anchor.imageUrl ? (
                              <img src={anchor.imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon size={12} className="text-white/40 m-auto" />
                            )}
                          </div>
                          <span className="text-xs text-white/60 group-hover/anchor:text-white/80 truncate max-w-[80px]">
                            {anchor.imageName || '图片'}
                          </span>
                          {anchor.imageId && (
                            <LocateFixed size={10} className="text-white/30 group-hover/anchor:text-gold flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={`rounded-2xl px-3.5 py-2.5 ${
                    message.role === 'user'
                      ? isGold
                        ? 'bg-gold/15 text-text-bright border border-gold/20'
                        : 'bg-blue-500 text-white shadow-sm'
                      : isGold
                        ? 'bg-white/5 text-text-bright border border-white/[0.04]'
                        : 'bg-white text-gray-800 border border-gray-100 shadow-sm'
                  }`}>
                    <div className="text-sm leading-relaxed">
                      {message.role === 'assistant'
                        ? <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={createMarkdownComponents(isGold, onAddImages ? (url: string) => onAddImages([url], undefined, { modelName: message.generateModelName, apiProvider: providerDisplayName(message.generateProviderId) }) : undefined)}
                          >
                            {cleanAssistantContent(message.content)}
                          </ReactMarkdown>
                        : message.content}
                    </div>
                  </div>
                  {/* Agent工具执行记录 */}
                  {message.role === 'assistant' && message.toolExecutions && message.toolExecutions.length > 0 && (
                    <div className={`mt-2 rounded-xl overflow-hidden ${isGold ? 'bg-black/30 border border-gold/15' : 'bg-gray-50 border border-gray-200'}`}>
                      <div className={`px-3 py-1.5 flex items-center gap-2 ${isGold ? 'bg-gold/5 border-b border-gold/10' : 'bg-gray-100 border-b border-gray-200'}`}>
                        <div className={`w-4 h-4 rounded flex items-center justify-center ${isGold ? 'bg-gold/20' : 'bg-blue-100'}`}>
                          <Cpu size={10} className={isGold ? 'text-gold' : 'text-blue-500'} />
                        </div>
                        <span className={`text-xs font-medium ${isGold ? 'text-gold/90' : 'text-gray-700'}`}>
                          Agent 执行
                        </span>
                        <span className={`text-[10px] ${isGold ? 'text-gold/60' : 'text-gray-500'}`}>
                          {message.toolExecutions.filter(e => e.status === 'completed').length}/{message.toolExecutions.length} 完成
                        </span>
                      </div>
                      <div className="p-2 space-y-1.5">
                        {message.toolExecutions.map((exec, execIdx) => (
                          <div key={execIdx} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                            exec.status === 'running' ? (isGold ? 'bg-gold/5' : 'bg-blue-50') :
                            exec.status === 'completed' ? (isGold ? 'bg-emerald-900/10' : 'bg-green-50') :
                            (isGold ? 'bg-red-900/10' : 'bg-red-50')
                          }`}>
                            {exec.status === 'running' && <Loader2 size={12} className={`animate-spin ${isGold ? 'text-gold' : 'text-blue-500'}`} />}
                            {exec.status === 'completed' && <Check size={12} className={isGold ? 'text-emerald-400' : 'text-green-500'} />}
                            {exec.status === 'failed' && <X size={12} className={isGold ? 'text-red-400' : 'text-red-500'} />}
                            <span className={`text-xs flex-1 ${
                              exec.status === 'running' ? (isGold ? 'text-gold/80' : 'text-blue-700') :
                              exec.status === 'completed' ? (isGold ? 'text-emerald-300/80' : 'text-green-700') :
                              (isGold ? 'text-red-300/80' : 'text-red-700')
                            }`}>
                              {exec.label || exec.toolName}
                            </span>
                            {exec.status === 'failed' && exec.error && (
                              <span className={`text-[10px] ${isGold ? 'text-red-400/60' : 'text-red-400'}`} title={exec.error}>
                                失败
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* AI生成的图片 - ChatGPT风格：每张图独立卡片，垂直排列 */}
                  {message.generatedImages && message.generatedImages.length > 0 && (
                    <div className="flex flex-col gap-3 mt-3">
                      {(() => {
                        const uniqueImages = [...new Set(message.generatedImages)];
                        return uniqueImages.map((imgUrl, imgIdx) => (
                        <div key={imgIdx} className={`rounded-xl overflow-hidden ${isGold ? 'bg-black/30 border border-gold/15' : 'bg-gray-50 border border-gray-200'}`}>
                          {/* 模型名称标签 */}
                          <div className={`px-3 py-1.5 flex items-center gap-2 ${isGold ? 'bg-gold/5 border-b border-gold/10' : 'bg-gray-100 border-b border-gray-200'}`}>
                            <div className={`w-4 h-4 rounded flex items-center justify-center ${isGold ? 'bg-gold/20' : 'bg-blue-100'}`}>
                              <Sparkles size={10} className={isGold ? 'text-gold' : 'text-blue-500'} />
                            </div>
                            <span className={`text-xs font-medium ${isGold ? 'text-gold/90' : 'text-gray-700'}`}>
                              {message.generateModelName || 'AI 生成'}
                            </span>
                            {uniqueImages.length > 1 && (
                              <span className={`text-[10px] ${isGold ? 'text-gold/60' : 'text-gray-500'}`}>
                                {imgIdx + 1} / {uniqueImages.length}
                              </span>
                            )}
                          </div>
                          {/* 图片区域 */}
                          <div className="relative group/chat-img">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgUrl}
                              alt={`AI生成图片${imgIdx + 1}`}
                              className="w-full cursor-pointer hover:opacity-95 transition-opacity"
                              style={{ maxHeight: '400px', objectFit: 'contain' }}
                              onClick={() => onAddImages?.([imgUrl], undefined, { modelName: message.generateModelName, apiProvider: providerDisplayName(message.generateProviderId) })}
                              title="点击添加到画布"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            {/* 悬浮操作按钮 */}
                            <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover/chat-img:opacity-100 transition-opacity">
                              {onAddImages && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onAddImages([imgUrl], undefined, { modelName: message.generateModelName, apiProvider: providerDisplayName(message.generateProviderId) }); }}
                                  className="bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-black/90 shadow-lg"
                                >
                                  <Plus size={12} /> 画布
                                </button>
                              )}
                              <a
                                href={imgUrl}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-black/90 shadow-lg"
                              >
                                <Download size={12} /> 下载
                              </a>
                            </div>
                          </div>
                        </div>
                      ));
                      })()}
                      <div className={`text-[10px] text-center ${isGold ? 'text-gold/50' : 'text-gray-400'}`}>
                        点击图片可添加到画布
                      </div>
                    </div>
                  )}
                  {/* 正在生成图片 - ChatGPT风格：每张图独立进度卡片 */}
                  {message.isGeneratingImage && (
                    <div className="flex flex-col gap-3 mt-3">
                      {Array.from({ length: message.generateImageCount || 1 }).map((_, imgIdx) => (
                        <div key={imgIdx} className={`rounded-xl overflow-hidden ${isGold ? 'bg-black/30 border border-gold/15' : 'bg-gray-50 border border-gray-200'}`}>
                          {/* 模型名称标签 */}
                          <div className={`px-3 py-1.5 flex items-center gap-2 ${isGold ? 'bg-gold/5 border-b border-gold/10' : 'bg-gray-100 border-b border-gray-200'}`}>
                            <div className={`w-4 h-4 rounded flex items-center justify-center ${isGold ? 'bg-gold/20' : 'bg-blue-100'}`}>
                              <Sparkles size={10} className={isGold ? 'text-gold' : 'text-blue-500'} />
                            </div>
                            <span className={`text-xs font-medium ${isGold ? 'text-gold/90' : 'text-gray-700'}`}>
                              {message.generateModelName || 'AI 生成'}
                            </span>
                            {(message.generateImageCount || 1) > 1 && (
                              <span className={`text-[10px] ${isGold ? 'text-gold/60' : 'text-gray-500'}`}>
                                {imgIdx + 1} / {message.generateImageCount}
                              </span>
                            )}
                          </div>
                          {/* 进度区域 */}
                          <div className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Loader2 size={14} className={`animate-spin ${isGold ? 'text-gold' : 'text-blue-500'}`} />
                                <span className={`text-xs ${isGold ? 'text-gold/80' : 'text-gray-600'}`}>
                                  生成中...
                                </span>
                              </div>
                              <span className={`text-xs tabular-nums ${isGold ? 'text-gold/60' : 'text-gray-500'}`}>
                                {message.generateProgress ? Math.round(message.generateProgress) + '%' : '准备中...'}
                              </span>
                            </div>
                            {/* 进度条 */}
                            <div className={`h-1 rounded-full overflow-hidden ${isGold ? 'bg-gold/10' : 'bg-gray-200'}`}>
                              <div
                                className={`h-full rounded-full transition-all duration-500 ease-out ${isGold ? 'bg-gold' : 'bg-blue-500'}`}
                                style={{ width: (message.generateProgress || 5) + '%' }}
                              />
                            </div>
                            {/* 占位区域 */}
                            <div className={`mt-3 rounded-lg flex items-center justify-center ${isGold ? 'bg-black/20' : 'bg-gray-100'}`} style={{ height: '200px' }}>
                              <div className="text-center">
                                <ImageIcon size={24} className={`mx-auto mb-1 ${isGold ? 'text-gold/30' : 'text-gray-300'}`} />
                                <span className={`text-[10px] ${isGold ? 'text-gold/40' : 'text-gray-400'}`}>
                                  图片 {imgIdx + 1}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 生成失败提示 */}
                  {message.generateError && (
                    <div className={`mt-3 rounded-lg p-3 flex items-center gap-2 ${isGold ? 'bg-red-900/20 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
                      <AlertCircle size={14} className={isGold ? 'text-red-400' : 'text-red-500'} />
                      <span className={`text-xs ${isGold ? 'text-red-300' : 'text-red-600'}`}>
                        图片生成失败: {message.generateError}
                      </span>
                    </div>
                  )}
                  <div className={`flex items-center gap-2 mt-0.5 px-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {/* AI反馈按钮 - 仅对assistant消息显示 */}
                    {message.role === 'assistant' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            // 记录正面反馈
                            console.log(`Positive feedback for message ${message.id}`);
                            toast.success('感谢您的正面反馈！');
                          }}
                          className={`text-xs ${themeClasses.textMuted} hover:text-green-500 transition-colors p-1.5 rounded hover:bg-green-500/10 min-h-[32px] min-w-[32px] flex items-center justify-center`}
                          aria-label="好评"
                          title="好评"
                        >
                          <ThumbsUp size={14} />
                        </button>
                        <button
                          onClick={() => {
                            // 记录负面反馈
                            console.log(`Negative feedback for message ${message.id}`);
                            toast.error('感谢您的反馈，我们会改进');
                          }}
                          className={`text-xs ${themeClasses.textMuted} hover:text-red-500 transition-colors p-1.5 rounded hover:bg-red-500/10 min-h-[32px] min-w-[32px] flex items-center justify-center`}
                          aria-label="差评"
                          title="差评"
                        >
                          <ThumbsDown size={14} />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => copyToClipboard(message.content, message.id)}
                      className={`text-xs ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors flex items-center gap-0.5 min-h-[32px] px-2`}
                      aria-label="复制内容"
                    >
                      {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === message.id ? '已复制' : '复制'}
                    </button>
                    {/* 重试/重新生成按钮 */}
                    {!isLoading && (
                      <button
                        onClick={() => {
                          if (message.role === 'user') {
                            // 用户消息：重新发送该消息
                            handleSend(message.content);
                          } else {
                            // AI消息：找到上一条用户消息并重新发送
                            const msgIndex = messages.findIndex(m => m.id === message.id);
                            const prevUserMsg = [...messages].slice(0, msgIndex).reverse().find(m => m.role === 'user');
                            if (prevUserMsg) {
                              handleSend(prevUserMsg.content);
                            }
                          }
                        }}
                        className={`text-xs flex items-center gap-1 transition-colors ${
                          isGold ? 'text-gold/70 hover:text-gold' : 'text-blue-400 hover:text-blue-600'
                        }`}
                      >
                        <RotateCcw size={12} />
                        {message.role === 'user' ? '重试' : '重新生成'}
                      </button>
                    )}
                    {message.role === 'assistant' && onAddToPrompt && (
                      <button
                        onClick={() => handleAddMessageToGeneration(message.content)}
                        className={`text-xs flex items-center gap-1 transition-colors ${
                          isGold ? 'text-gold/70 hover:text-gold' : 'text-blue-400 hover:text-blue-600'
                        }`}
                      >
                        <Send size={12} />
                        发送到生图
                      </button>
                    )}
                    {message.role === 'assistant' && message.isClarifying && (
                      <span className={`text-xs flex items-center gap-1 ${isGold ? 'text-amber-400/70' : 'text-amber-500'}`}>
                        <Lightbulb size={12} />
                        追问中
                      </span>
                    )}
                  </div>
                  {/* P0-2: 建议下一步操作 */}
                  {message.role === 'assistant' && message.suggestions && message.suggestions.length > 0 && (
                    <div className={`mt-1.5 rounded-lg p-2 ${isGold ? 'bg-gold/5 border border-gold/15' : 'bg-blue-50/50 border border-blue-100'}`}>
                      <div className={`text-[10px] font-medium mb-1.5 flex items-center gap-1 ${isGold ? 'text-gold/70' : 'text-blue-500'}`}>
                        <Zap size={10} />
                        建议下一步
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {message.suggestions.map(sug => (
                          <button
                            key={sug.id}
                            onClick={() => {
                              if (sug.action === 'generate-image' && onGenerateImage && sug.prompt) {
                                const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                                const userText = lastUserMsg?.content || '';
                                const count = detectImageCountFromText(userText);
                                const ratio = detectAspectRatioFromText(userText) || '1:1';
                                const quality = detectQualityFromText(userText) || '1K';
                                onGenerateImage(sug.prompt, count, ratio, quality);
                              } else if (sug.action === 'send-to-prompt' && sug.prompt) {
                                handleSend(sug.prompt);
                              } else if (sug.prefilledPrompt) {
                                // Use prefilled prompt as chat message for context-aware suggestions
                                handleSend(sug.prefilledPrompt);
                              } else if (sug.prompt) {
                                handleSend(sug.prompt);
                              }
                            }}
                            className={`text-[10px] px-2 py-1 rounded-md transition-all flex items-center gap-0.5 ${
                              isGold
                                ? 'bg-gold/10 text-gold/80 border border-gold/20 hover:bg-gold/20 hover:text-gold'
                                : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                            }`}
                          >
                            <ArrowRight size={9} />
                            {sug.label}
                            {sug.prefilledPrompt && <span className="opacity-50 ml-0.5 text-[8px]">✦</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {message.role === 'user' && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isGold ? 'bg-gradient-to-br from-gold to-gold-dark text-black' : 'bg-blue-500 text-white'
                  }`}>
                    <User size={14} />
                  </div>
                )}
              </div>
            ))
          )}
          {/* 思考中加载指示器 — 当有工具执行步骤时隐藏，避免与工具步骤重叠 */}
          {isLoading && !(messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].toolExecutions && messages[messages.length - 1].toolExecutions!.length > 0) && (
            <div className="flex gap-2.5 justify-start">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                isGold ? 'bg-gold/15 text-gold' : 'bg-gray-100 text-gray-600'
              }`}>
                <Bot size={14} />
              </div>
              <div className={`rounded-xl px-3 py-2 flex items-center gap-2 ${
                isGold ? 'bg-white/5 border border-white/[0.04]' : 'bg-white border border-gray-200'
              }`}>
                <Loader2 className={`h-5 w-5 animate-spin ${isGold ? 'text-gold' : 'text-blue-500'}`} />
                <span className={`text-sm ${themeClasses.textMuted}`}>思考中</span>
                <span className="inline-flex gap-0.5">
                  <span className={`w-1 h-1 rounded-full animate-bounce ${isGold ? 'bg-gold/60' : 'bg-blue-400'}`} style={{ animationDelay: '0ms' }} />
                  <span className={`w-1 h-1 rounded-full animate-bounce ${isGold ? 'bg-gold/60' : 'bg-blue-400'}`} style={{ animationDelay: '150ms' }} />
                  <span className={`w-1 h-1 rounded-full animate-bounce ${isGold ? 'bg-gold/60' : 'bg-blue-400'}`} style={{ animationDelay: '300ms' }} />
                </span>
                {thinkingElapsed > 0 && (
                  <span className={`text-xs ${isGold ? 'text-white/30' : 'text-gray-400'}`}>
                    {thinkingElapsed < 60
                      ? `${thinkingElapsed}s`
                      : `${Math.floor(thinkingElapsed / 60)}m${thinkingElapsed % 60}s`
                    }
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 图片引用预览 - Lovart风格：小方形缩略图在输入框上方 */}
          {/* (缩略图已移至输入区域上方渲染) */}

          <div ref={messagesEndRef} />
        </div>

        {/* Input - 精致设计 */}
        <div className={`px-3 py-4 border-t ${themeClasses.border} shrink-0 ${isGold ? 'bg-[#0d0d0d]/90' : 'bg-white'}`}>
          {/* P2-1: Tune Mode Panel */}
          {showTunePanel && (
            <div ref={tunePanelRef} className={`mb-1.5 p-2 rounded-lg text-xs space-y-2 ${isGold ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <span className={`font-medium ${themeClasses.text}`}>Tune 精细调节</span>
                <button onClick={() => setShowTunePanel(false)} className={`opacity-50 hover:opacity-100 ${themeClasses.textMuted}`}>
                  <X size={12} />
                </button>
              </div>
              {([
                { key: 'strength' as const, label: '修改强度', min: 0, max: 100, icon: '💪' },
                { key: 'styleShift' as const, label: '风格偏移', min: -50, max: 50, icon: '🎭' },
                { key: 'colorTone' as const, label: '色调偏移', min: -50, max: 50, icon: '🎨' },
                { key: 'detailLevel' as const, label: '细节程度', min: 0, max: 100, icon: '🔍' },
              ]).map(param => (
                <div key={param.key} className="flex items-center gap-2">
                  <span className="w-4 text-center">{param.icon}</span>
                  <span className={`w-16 shrink-0 ${themeClasses.textMuted}`}>{param.label}</span>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    value={tuneParams[param.key]}
                    onChange={e => updateTuneParam(param.key, parseInt(e.target.value))}
                    className="flex-1 h-1 accent-current"
                  />
                  <span className={`w-8 text-right tabular-nums ${themeClasses.textMuted}`}>
                    {tuneParams[param.key]}
                  </span>
                </div>
              ))}
              <button
                onClick={() => { setTuneParams({ strength: 70, styleShift: 0, colorTone: 0, detailLevel: 50 }); }}
                className={`w-full text-center py-0.5 rounded text-[10px] ${isGold ? 'text-gold-muted/60 hover:text-gold' : 'text-gray-400 hover:text-gray-600'}`}
              >
                重置参数
              </button>
            </div>
          )}

          {/* Lovart风格图片缩略图条 - 在输入框上方显示已引用的图片 */}
          {(() => {
            const allRefImgs: Array<{id: string; url: string; name: string; source: string}> = [];
            activeMentions.forEach(m => {
              if (m.type === 'canvas-image' && m.imageUrl && !allRefImgs.find(r => r.id === m.id)) {
                allRefImgs.push({ id: m.id!, url: m.imageUrl, name: m.label, source: 'mention' });
              }
            });
            pendingImages.forEach(img => {
              if (!allRefImgs.find(r => r.id === img.id)) {
                allRefImgs.push({ id: img.id, url: img.url, name: img.name, source: 'pending' });
              }
            });
            if (allRefImgs.length === 0) return null;
            return (
              <div className={`mb-2 rounded-lg overflow-hidden ${isGold ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-200'}`}>
                {/* 缩略图行 */}
                <div className="flex gap-1.5 p-2 overflow-x-auto" style={{ maxWidth: '100%' }}>
                  {allRefImgs.map((img, idx) => (
                    <div key={img.id} className="relative shrink-0 group">
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-black/20">
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                      </div>
                      {/* 右上角关闭按钮 */}
                      <button
                        onClick={() => {
                          setPendingImages(prev => prev.filter(p => p.id !== img.id));
                          setActiveMentions(prev => prev.filter(m => !(m.type === 'canvas-image' && m.id === img.id)));
                        }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 transition-colors opacity-0 group-hover:opacity-100 shadow-sm"
                      >
                        <X size={9} />
                      </button>
                      {/* 左上角序号标签 */}
                      <div className={`absolute top-0.5 left-0.5 px-1 py-px rounded text-[8px] font-bold leading-tight ${isGold ? 'bg-gold/80 text-black' : 'bg-blue-500 text-white'}`}>
                        {idx + 1}
                      </div>
                      {/* 底部名称 */}
                      <div className="mt-0.5 text-center">
                        <span className={`text-[8px] truncate block max-w-[48px] ${isGold ? 'text-white/50' : 'text-gray-400'}`}>
                          {img.name.length > 6 ? img.name.slice(0, 6) + '..' : img.name}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* 底部栏：图片数量 + 清空按钮 */}
                <div className={`flex items-center justify-between px-2 py-1 ${isGold ? 'border-t border-white/[0.04]' : 'border-t border-gray-200'}`}>
                  <span className={`text-[9px] ${isGold ? 'text-gold/50' : 'text-gray-400'}`}>
                    {allRefImgs.length}张图片引用
                  </span>
                  <button
                    onClick={() => { setPendingImages([]); setActiveMentions(prev => prev.filter(m => m.type !== 'canvas-image')); }}
                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                      isGold ? 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    清空
                  </button>
                </div>
              </div>
            );
          })()}

          {/* P1-1: Active Mentions Tags - 非图片类型显示在输入框上方，图片类型移到输入框内 */}
          {activeMentions.filter(m => m.type !== 'canvas-image').length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {activeMentions.map((m, i) => (
                m.type !== 'canvas-image' ? (
                  <span key={`${m.type}-${m.id}`} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    m.type === 'brand' ? (isGold ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-amber-50 text-amber-700 border border-amber-200') :
                    m.type === 'prompt' ? (isGold ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200') :
                    (isGold ? 'bg-white/10 text-white/60 border border-white/10' : 'bg-gray-50 text-gray-600 border border-gray-200')
                  }`}>
                    {m.type === 'brand' && <Palette size={10} />}
                    {m.type === 'prompt' && <Sparkles size={10} />}
                    <span className="truncate max-w-[100px]">{m.label}</span>
                    <button onClick={() => removeMention(i)} className="opacity-50 hover:opacity-100">
                      <X size={10} />
                    </button>
                  </span>
                ) : null
              ))}
            </div>
          )}

          {/* Toolbar Row - 上传/Tune/快捷指令 + 发送按钮 */}
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            {/* 图片按钮 - DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => {
                    if (!canvasImages || canvasImages.length === 0) {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                    activeMentions.some(m => m.type === 'canvas-image')
                      ? isGold ? 'bg-gold/15 text-gold' : 'bg-blue-100 text-blue-600'
                      : isGold
                        ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                        : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  title="添加图片引用"
                >
                  <ImageIcon size={12} />
                  <span>图片</span>
                  {canvasImages && canvasImages.length > 0 && <ChevronDown size={10} />}
                </button>
              </DropdownMenuTrigger>
              {canvasImages && canvasImages.length > 0 && (
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className={`w-56 max-h-60 overflow-hidden ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}
                >
                  <DropdownMenuLabel className={`text-[10px] font-medium flex items-center justify-between ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                    <span>@图片引用 (可多选)</span>
                    <button onClick={() => fileInputRef.current?.click()} className={`text-[10px] ${isGold ? 'text-gold/50 hover:text-gold' : 'text-blue-400 hover:text-blue-600'}`}>本地上传</button>
                  </DropdownMenuLabel>
                  <div className="overflow-y-auto max-h-48">
                    {canvasImages.slice().reverse().map((img) => {
                      const isAdded = activeMentions.some(m => m.type === 'canvas-image' && m.id === img.id);
                      return (
                        <DropdownMenuItem
                          key={img.id}
                          onSelect={(e) => {
                            e.preventDefault();
                            if (isAdded) {
                              setActiveMentions(prev => prev.filter(m => !(m.type === 'canvas-image' && m.id === img.id)));
                              setPendingImages(prev => prev.filter(p => p.id !== img.id));
                            } else {
                              setActiveMentions(prev => [...prev, {
                                type: 'canvas-image',
                                id: img.id,
                                label: img.prompt?.slice(0, 15) || '画布图片',
                                imageUrl: img.url,
                                data: { url: img.url },
                              }]);
                              setPendingImages(prev => {
                                if (prev.some(p => p.id === img.id)) return prev;
                                return [...prev, { id: img.id, url: img.url, name: img.prompt?.slice(0, 20) || '画布图片' }];
                              });
                            }
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs ${isGold ? 'text-white/80 focus:bg-white/5' : 'text-gray-700 focus:bg-gray-50'} ${isAdded ? (isGold ? 'bg-gold/10' : 'bg-blue-50') : ''}`}
                        >
                          <div className="w-7 h-7 rounded overflow-hidden shrink-0 border border-white/10">
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                          </div>
                          <span className="truncate flex-1 text-left">{img.prompt?.slice(0, 20) || '图片'}</span>
                          {isAdded && <span className={`text-[10px] ${isGold ? 'text-gold' : 'text-blue-500'}`}>已引用</span>}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
            {/* Tune按钮 - DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                    showTunePanel
                      ? isGold ? 'bg-gold/15 text-gold' : 'bg-blue-100 text-blue-600'
                      : isGold
                        ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                        : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  title="Tune 精细调节"
                >
                  <Sliders size={12} />
                  <span>Tune</span>
                  <ChevronDown size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className={`w-48 ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}
              >
                <DropdownMenuItem
                  onSelect={() => setShowTunePanel(true)}
                  className={`text-xs ${isGold ? 'text-white/80 focus:bg-white/5' : 'text-gray-700 focus:bg-gray-50'}`}
                >
                  <Sliders size={12} className="mr-2" />
                  打开调节面板
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => { setShowTunePanel(false); setTuneParams({ strength: 70, styleShift: 0, colorTone: 0, detailLevel: 50 }); }}
                  className={`text-xs ${isGold ? 'text-white/80 focus:bg-white/5' : 'text-gray-700 focus:bg-gray-50'}`}
                >
                  <RotateCcw size={12} className="mr-2" />
                  重置参数
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 快捷指令 - DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                    isGold
                      ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                      : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  title="快捷指令"
                >
                  <Zap size={12} />
                  <span>指令</span>
                  <ChevronDown size={10} className="opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className={`w-48 ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}
              >
                <DropdownMenuLabel className={`text-[10px] ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                  快捷指令
                </DropdownMenuLabel>
                {quickCommands.map((cmd, idx) => (
                  <DropdownMenuItem
                    key={idx}
                    onClick={() => {
                      setInput(prev => prev + cmd.prompt);
                      textareaRef.current?.focus();
                    }}
                    className={`flex items-center gap-2.5 text-xs ${isGold ? 'text-white/80 hover:bg-white/5 focus:bg-white/5' : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50'}`}
                  >
                    <span>{cmd.icon}</span>
                    <span>{cmd.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 图像模型选择器 - DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                    isGold
                      ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                      : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  title="选择图像模型"
                >
                  <ImageIcon size={12} />
                  <span className="max-w-[80px] truncate">{discoveredImageModels.find(m => m.id === imageModel)?.name || getModelDisplayName(imageModel.split('::').pop() || imageModel)}</span>
                  <ChevronDown size={10} className="opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                className={`w-64 max-h-80 overflow-y-auto ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}
              >
                <DropdownMenuLabel className={`text-[10px] border-b ${isGold ? 'text-gold-muted/60 border-white/5' : 'text-gray-400 border-gray-100'}`}>
                  选择图像模型
                </DropdownMenuLabel>
                {discoveredImageModels.length === 0 ? (
                  <div className={`px-3 py-4 text-xs text-center ${isGold ? 'text-white/40' : 'text-gray-400'}`}>
                    暂无可用模型
                  </div>
                ) : (
                  (() => {
                    // ★ 按供应商分组显示图像模型
                    const grouped: Record<string, typeof discoveredImageModels> = {};
                    discoveredImageModels.forEach(m => {
                      const key = m.provider || '管理员配置';
                      if (!grouped[key]) grouped[key] = [];
                      grouped[key].push(m);
                    });
                    return Object.entries(grouped).map(([providerName, models]) => (
                      <div key={providerName}>
                        <div className={`px-3 py-1.5 text-[10px] font-semibold ${isGold ? 'text-gold-muted/60' : 'text-gray-400'} border-t ${isGold ? 'border-white/5' : 'border-gray-100'} mt-1`}>
                          {providerName}
                        </div>
                        {models.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onClick={() => {
                              setImageModel(m.id);
                              setImageModelProviderId(m.providerId);
                              // 同步到localStorage，与图像生成面板共享（保留 quality/aspectRatio）
                              const modelId = m.id.split('::').pop() || m.id;
                              let existing: Record<string, unknown> = {};
                              try { existing = JSON.parse(localStorage.getItem('wujie_selected_model') || '{}'); } catch { existing = {}; }
                              localStorage.setItem('wujie_selected_model', JSON.stringify({
                                ...existing,
                                model: modelId,
                                modelName: m.name,
                                apiProvider: m.providerId,
                              }));
                            }}
                            className={`flex items-center gap-2 text-xs ${imageModel === m.id ? (isGold ? 'bg-gold/15 text-gold' : 'bg-blue-50 text-blue-600') : ''} ${isGold ? 'text-white/80 hover:bg-white/5 focus:bg-white/5' : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50'}`}
                          >
                            <ImageIcon size={14} className="opacity-60" />
                            <span className="truncate">{m.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </div>
                    ));
                  })()
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex-1" />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className={`shrink-0 h-7 px-2 rounded-md flex items-center justify-center text-[11px] font-medium transition-all ${
                !input.trim() || isLoading
                  ? isGold
                    ? 'bg-white/[0.03] text-white/20 cursor-not-allowed'
                    : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                  : isGold
                    ? 'bg-gold text-black hover:opacity-90 shadow-md shadow-gold/20'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
              }`}
              title="发送"
            >
              <Send size={14} />
              {isLoading && <Loader2 size={10} className="animate-spin ml-1" />}
            </button>
          </div>

          {/* P2-10: 智能体自动路由提示 */}
          {suggestedAgent && !isLoading && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${isGold ? 'bg-gold/10 border border-gold/20' : 'bg-blue-50 border border-blue-200'} animate-in fade-in duration-200`}>
              <span className={isGold ? 'text-gold/80' : 'text-blue-600'}>💡</span>
              <span className={isGold ? 'text-gold/70' : 'text-blue-600'}>
                检测到{`"${suggestedAgent.name}"`}相关需求
              </span>
              <button
                type="button"
                onClick={() => {
                  setSystemPrompt(suggestedAgent.id);
                  setSuggestedAgent(null);
                }}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${isGold ? 'bg-gold/20 text-gold hover:bg-gold/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
              >
                切换到{`${suggestedAgent.icon} ${suggestedAgent.name}`}
              </button>
              <button
                type="button"
                onClick={() => setSuggestedAgent(null)}
                className={`ml-auto ${isGold ? 'text-gold/40 hover:text-gold/60' : 'text-gray-400 hover:text-gray-600'}`}
              >
                ✕
              </button>
            </div>
          )}

          {/* Textarea Row - 输入框独立占满宽度 */}
          <div className={`relative rounded-xl overflow-visible ${isGold ? 'bg-white/[0.03] border border-white/[0.04] focus-within:border-gold/40 focus-within:shadow-gold/10' : 'bg-white border border-gray-200 focus-within:border-gray-400 focus-within:shadow-sm'} transition-all`}>
            {/* 图片缩略图已在输入框上方Lovart风格条中显示，此处不再重复 */}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              placeholder={(() => { if (activeSkill) { const skillName = activeSkill.name; return `描述你的需求，如"帮我生成一个科技公司的${skillName}"...`; } const imgIds = new Set<string>(); activeMentions.forEach(m => { if (m.type === 'canvas-image' && m.id) imgIds.add(m.id); }); pendingImages.forEach(p => imgIds.add(p.id)); const imgCount = imgIds.size; return imgCount > 0 ? `描述你想对这${imgCount}张图片做什么，如"将图片#1的人物和图片#2合并"...` : "输入消息，@ 引用图片/品牌，/ 使用模板..."; })()}
              className={`w-full resize-none min-h-[60px] max-h-[200px] border-0 bg-transparent px-4 py-3 text-[14px] leading-relaxed focus:outline-none focus:ring-0 ${themeClasses.text} placeholder:${isGold ? 'text-gold-muted/40' : 'text-gray-400'}`}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                // Handle template popup navigation (priority over mention picker)
                if (templatePopupOpen && templatePopupItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setTemplatePopupIndex(prev => Math.min(prev + 1, templatePopupItems.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setTemplatePopupIndex(prev => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    selectPromptTemplate(templatePopupItems[templatePopupIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setTemplatePopupOpen(false);
                    return;
                  }
                }
                // Handle mention picker navigation
                if (mentionPickerOpen && mentionPickerItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionPickerIndex(prev => Math.min(prev + 1, mentionPickerItems.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionPickerIndex(prev => Math.max(prev - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    selectMentionItem(mentionPickerItems[mentionPickerIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionPickerOpen(false);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isLoading}
            />
            {/* P1-1: @ Mention Picker Popup */}
            {mentionPickerOpen && mentionPickerItems.length > 0 && (
              <div className={`absolute bottom-full left-0 right-0 mb-1 rounded-lg border shadow-lg z-50 overflow-hidden ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                <div className={`px-3 py-1.5 text-[10px] font-medium ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                  @ 引用 — 输入筛选，↑↓选择，Enter确认
                </div>
                <div className="max-h-60 overflow-y-auto">
                {(() => {
                  // P2-12: Group mention items by type with category headers
                  const imageItems = mentionPickerItems.filter(i => i.type === 'canvas-image');
                  const brandItems = mentionPickerItems.filter(i => i.type === 'brand');
                  const promptItems = mentionPickerItems.filter(i => i.type === 'prompt');
                  return (
                    <>
                      {imageItems.length > 0 && (
                        <div className={`px-3 py-0.5 text-[9px] font-medium uppercase tracking-wider ${isGold ? 'text-gold/40' : 'text-gray-300'}`}>
                          画布图片 ({imageItems.length})
                        </div>
                      )}
                      {imageItems.map(item => {
                        const idx = mentionPickerItems.indexOf(item);
                        return (
                          <button
                            key={`${item.type}-${item.id}`}
                            onClick={() => selectMentionItem(item)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                              idx === mentionPickerIndex
                                ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                                : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0 border border-white/10" crossOrigin="anonymous" />
                            ) : (
                              <ImageIcon size={12} className="shrink-0" />
                            )}
                            <span className="truncate">{item.label}</span>
                            <span className={`ml-auto text-[10px] ${isGold ? 'text-white/30' : 'text-gray-300'}`}>
                              #{String((item.data as Record<string, unknown>)?.num ?? '')}
                            </span>
                          </button>
                        );
                      })}
                      {brandItems.length > 0 && (
                        <div className={`px-3 py-0.5 text-[9px] font-medium uppercase tracking-wider border-t ${isGold ? 'text-gold/40 border-white/5' : 'text-gray-300 border-gray-100'}`}>
                          品牌规范
                        </div>
                      )}
                      {brandItems.map(item => {
                        const idx = mentionPickerItems.indexOf(item);
                        return (
                          <button
                            key={`${item.type}-${item.id}`}
                            onClick={() => selectMentionItem(item)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                              idx === mentionPickerIndex
                                ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                                : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <Palette size={12} className="shrink-0" />
                            <span className="truncate">{item.label}</span>
                            <span className={`ml-auto text-[10px] ${isGold ? 'text-white/30' : 'text-gray-300'}`}>品牌</span>
                          </button>
                        );
                      })}
                      {promptItems.length > 0 && (
                        <div className={`px-3 py-0.5 text-[9px] font-medium uppercase tracking-wider border-t ${isGold ? 'text-gold/40 border-white/5' : 'text-gray-300 border-gray-100'}`}>
                          提示词库
                        </div>
                      )}
                      {promptItems.map(item => {
                        const idx = mentionPickerItems.indexOf(item);
                        return (
                          <button
                            key={`${item.type}-${item.id}`}
                            onClick={() => selectMentionItem(item)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                              idx === mentionPickerIndex
                                ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                                : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <Sparkles size={12} className="shrink-0" />
                            <span className="truncate">{item.label}</span>
                            <span className={`ml-auto text-[10px] ${isGold ? 'text-white/30' : 'text-gray-300'}`}>提示词</span>
                          </button>
                        );
                      })}
                    </>
                  );
                })()}
                </div>
              </div>
            )}
            {/* / Prompt Template Popup */}
            {templatePopupOpen && templatePopupItems.length > 0 && (
              <div className={`absolute bottom-full left-0 right-0 mb-1 rounded-lg border shadow-lg z-50 relative overflow-visible ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                <div className={`px-3 py-1.5 text-[10px] font-medium ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                  提示词模板 {templatePopupSearch && `· 搜索: "${templatePopupSearch}"`}
                </div>
                <div className="max-h-48 overflow-y-auto overscroll-contain rounded-b-lg">
                  {templatePopupItems.map((template, idx) => (
                    <button
                      key={template.id}
                      onClick={() => selectPromptTemplate(template)}
                      onMouseEnter={(e) => {
                        if (template.thumbnail) {
                          setHoveredTemplateId(template.id);
                          setThumbnailRect(e.currentTarget.getBoundingClientRect());
                        }
                      }}
                      onMouseLeave={() => setHoveredTemplateId(null)}
                      className={`w-full flex items-start gap-2 px-3 py-2 text-xs transition-colors text-left ${
                        idx === templatePopupIndex
                          ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                          : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {template.thumbnail ? (
                        <img src={template.thumbnail} alt={template.name} className="w-6 h-6 rounded object-cover flex-shrink-0 mt-0.5 border border-white/10" />
                      ) : (
                        <FileText size={12} className="shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{template.name}</span>
                          <span className={`text-[10px] px-1 rounded ${isGold ? 'bg-white/5 text-white/40' : 'bg-gray-100 text-gray-400'}`}>
                            {template.category}
                          </span>
                        </div>
                        <p className={`text-[10px] mt-0.5 truncate ${isGold ? 'text-white/40' : 'text-gray-400'}`}>
                          {template.content}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {/* Floating thumbnail - portal to body to avoid overflow clipping */}
                {hoveredTemplateId && (() => {
                  const tpl = templatePopupItems.find(t => t.id === hoveredTemplateId);
                  if (!tpl?.thumbnail || !thumbnailRect) return null;
                  return createPortal(
                    <div
                      className="fixed z-[9999] pointer-events-none"
                      style={{
                        left: thumbnailRect.left - 160,
                        top: Math.max(8, thumbnailRect.top - 40),
                      }}
                    >
                      <div className={`rounded-lg shadow-2xl overflow-hidden border ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                        <img src={tpl.thumbnail} alt={tpl.name} className="w-36 h-36 object-cover" />
                        <div className={`px-2 py-1 text-[10px] truncate ${isGold ? 'text-gold-muted' : 'text-gray-600'}`}>{tpl.name}</div>
                      </div>
                    </div>,
                    document.body
                  );
                })()}
                <div className={`px-3 py-1.5 border-t text-[10px] ${isGold ? 'border-white/5 text-white/30' : 'border-gray-100 text-gray-400'}`}>
                  ↑↓ 选择 · Enter 确认 · Esc 关闭
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Prompt Optimizer Tab Content */}
      {activeTab === 'optimizer' && (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Model indicator - compact */}
        <div className={`px-4 pt-3 pb-2 border-b ${themeClasses.border} shrink-0`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${discoveredChatModels.length > 0 ? 'bg-blue-400' : 'bg-amber-400'}`} />
              <span className={`text-sm font-medium ${themeClasses.text}`}>
                {discoveredChatModels.find(m => m.id === model)?.name || getModelDisplayName(model)}
              </span>
            </div>
            <span className={`text-xs ${themeClasses.textMuted}`}>
              模型与智能对话同步
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 space-y-3">
            {/* Optimize Mode Selection - 彩色图标+inline说明 */}
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {([
                  { value: 'enhance' as const, label: '增强', icon: '✦', color: '#f59e0b', desc: '提升细节表现力与画面质感' },
                  { value: 'expand' as const, label: '扩展', icon: '↗', color: '#3b82f6', desc: '补充场景构图、元素布局等维度' },
                  { value: 'simplify' as const, label: '精简', icon: '↓', color: '#10b981', desc: '去除冗余，提炼核心视觉要素' },
                ]).map(m => (
                  <button
                    key={m.value}
                    onClick={() => setOptimizerMode(m.value)}
                    onMouseEnter={() => setHoveredMode(m.value)}
                    onMouseLeave={() => setHoveredMode(null)}
                    className={`flex-1 py-1.5 px-1 rounded-md transition-all flex items-center justify-center gap-0.5 ${
                      optimizerMode === m.value
                        ? isGold
                          ? 'bg-gold/15 text-gold border border-gold/40'
                          : 'bg-blue-500 text-white border border-blue-600'
                        : isGold
                          ? 'bg-white/[0.04] text-gold-muted/70 border border-white/[0.04] hover:text-muted-foreground hover:border-white/[0.14]'
                          : 'bg-gray-50 text-gray-500 border border-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span className="text-xs" style={{ color: optimizerMode === m.value || hoveredMode === m.value ? m.color : m.color + '60' }}>{m.icon}</span>
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
              {hoveredMode && (
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-white/5 text-xs text-gold-muted">
                  <span style={{ color: hoveredMode === 'enhance' ? '#f59e0b' : hoveredMode === 'expand' ? '#3b82f6' : '#10b981' }}>
                    {hoveredMode === 'enhance' ? '✦' : hoveredMode === 'expand' ? '↗' : '↓'}
                  </span>
                  <span className="text-white/80 font-medium">
                    {hoveredMode === 'enhance' ? '增强' : hoveredMode === 'expand' ? '扩展' : '精简'}优化：
                  </span>
                  {hoveredMode === 'enhance' && '提升提示词的细节表现力与画面质感，增强光影、材质、氛围描写'}
                  {hoveredMode === 'expand' && '补充场景构图、元素布局、视角透视等维度，使画面更完整'}
                  {hoveredMode === 'simplify' && '去除冗余描述，提炼核心视觉要素，让提示词更精准高效'}
                </div>
              )}
            </div>

            {/* Original Prompt Input */}
            <div className="space-y-1.5">
              <Textarea
                value={optimizerInput}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setOptimizerInput(e.target.value)}
                placeholder="输入提示词...&#10;例如：一个漂亮的女孩在花园里"
                className={`min-h-[100px] resize-y text-sm rounded-lg ${themeClasses.inputBg} ${themeClasses.border} ${themeClasses.text}`}
              />
            </div>

            {/* Optimize Button */}
            <Button
              onClick={handleOptimizePrompt}
              disabled={!optimizerInput.trim() || isOptimizing}
              className={`w-full h-10 font-medium text-sm rounded-lg ${
                isGold
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90 shadow-md shadow-gold/15'
                  : 'bg-white border border-gray-300 text-gray-900 hover:bg-gray-50'
              } transition-all`}
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-1.5" />
                  优化中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1.5" />
                  Agent 智能优化
                </>
              )}
            </Button>

            {/* Optimized Result - 紧凑版式 */}
            {(optimizerOutputEn || optimizerOutputCn) && (
              <div className={`rounded-lg ${isGold ? 'bg-gold/8 border border-gold/20' : 'bg-gray-50 border border-gray-200'}`}>
                {/* 语言切换行 */}
                <div className="px-3 pt-3 pb-2 flex items-center gap-1">
                  <button
                    onClick={() => setSelectedOutputLang('en')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      selectedOutputLang === 'en'
                        ? isGold
                          ? 'bg-gold text-black'
                          : 'bg-blue-500 text-white'
                        : isGold
                          ? 'bg-white/[0.04] text-gold-muted/70 border border-white/[0.04] hover:text-muted-foreground'
                          : 'bg-white text-gray-500 border border-gray-200'
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setSelectedOutputLang('cn')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      selectedOutputLang === 'cn'
                        ? isGold
                          ? 'bg-gold text-black'
                          : 'bg-blue-500 text-white'
                        : isGold
                          ? 'bg-white/[0.04] text-gold-muted/70 border border-white/[0.04] hover:text-muted-foreground'
                          : 'bg-white text-gray-500 border border-gray-200'
                    }`}
                  >
                    中文
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => copyToClipboard(selectedOutputLang === 'en' ? optimizerOutputEn : optimizerOutputCn, `optimized-${selectedOutputLang}`)}
                    className={`p-1 rounded ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors`}
                    title="复制"
                  >
                    {copiedId === `optimized-${selectedOutputLang}` ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                  <button
                    onClick={() => {
                      const text = selectedOutputLang === 'en' ? optimizerOutputEn : optimizerOutputCn;
                      if (text && onAddToPrompt) onAddToPrompt(text);
                    }}
                    className={`p-1 rounded transition-colors ${
                      isGold ? 'text-gold/70 hover:text-gold' : 'text-blue-400 hover:text-blue-600'
                    }`}
                    title="发送到生图"
                  >
                    <Wand2 size={11} />
                  </button>
                </div>

                {/* 结果展示区 */}
                <div className="px-3 pb-3">
                  <div className={`p-3 rounded text-xs leading-relaxed whitespace-pre-wrap ${isGold ? 'bg-[#0d0d0d]/90' : 'bg-white'} ${themeClasses.text}`}>
                    {selectedOutputLang === 'en' ? optimizerOutputEn : (optimizerOutputCn || '中文结果未生成')}
                  </div>
                </div>

                {/* 底部发送按钮 */}
                <div className={`px-3 pb-3 flex gap-1.5`}>
                  <Button
                    onClick={() => handleAddToGeneration('en')}
                    disabled={!optimizerOutputEn}
                    className={`flex-1 h-9 font-medium text-sm rounded-lg ${
                      isGold
                        ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    } transition-all flex items-center justify-center gap-1`}
                  >
                    <Send className="h-4 w-4" />
                    发送英文
                  </Button>
                  <Button
                    onClick={() => handleAddToGeneration('cn')}
                    disabled={!optimizerOutputCn}
                    className={`flex-1 h-9 font-medium text-sm rounded-lg ${
                      isGold
                        ? 'bg-gold/15 text-gold border border-gold/30 hover:bg-gold/20'
                        : 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50'
                    } transition-all flex items-center justify-center gap-1`}
                  >
                    <Send className="h-4 w-4" />
                    发送中文
                  </Button>
                </div>
              </div>
            )}

            {/* Optimize History */}
            {optimizerHistory.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-medium ${themeClasses.textMuted}`}>优化历史</div>
                  <button
                    onClick={() => setOptimizerHistory([])}
                    className={`text-xs ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors`}
                  >
                    清空
                  </button>
                </div>
                <div className="space-y-0.5">
                  {optimizerHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg ${isGold ? 'bg-white/5 border border-white/[0.04]' : 'bg-gray-50 border border-gray-100'} cursor-pointer hover:opacity-80 transition-opacity`}
                      onClick={() => {
                        setOptimizerInput(item.input);
                        setOptimizerOutputEn(item.outputEn);
                        setOptimizerOutputCn(item.outputCn);
                      }}
                    >
                      <div className={`text-xs ${themeClasses.textMuted} truncate`}>
                        {item.input}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Skills Tab Content */}
      {activeTab === 'skills' && (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Skill 搜索 */}
            <div className="relative">
              <input
                value={skillSearchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkillSearchQuery(e.target.value)}
                placeholder="搜索 Skills..."
                className={`w-full px-3 py-2 rounded-lg text-xs ${isGold ? 'bg-white/[0.03] border border-white/[0.04] text-text-bright placeholder:text-gold-muted/40 focus:border-gold/40' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400'} focus:outline-none transition-colors`}
              />
            </div>

            {/* Skill 保存对话框（内联） */}
            {showSkillSaveDialog && messages.length >= 2 && (
              <div className={`rounded-lg p-3 ${isGold ? 'bg-gold/8 border border-gold/20' : 'bg-blue-50 border border-blue-200'}`}>
                <div className={`text-xs font-medium mb-2 flex items-center gap-1 ${isGold ? 'text-gold' : 'text-blue-600'}`}>
                  <BookmarkCheck size={13} />
                  保存为 Skill
                </div>
                <input
                  value={skillSaveName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkillSaveName(e.target.value)}
                  placeholder="Skill 名称..."
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs mb-2 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/40' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
                />
                <div className="flex gap-1.5 mb-2">
                  {(['image', 'design', 'brand', 'editing', 'custom'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSkillSaveCategory(cat)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        skillSaveCategory === cat
                          ? isGold ? 'bg-gold text-black' : 'bg-blue-500 text-white'
                          : isGold ? 'bg-white/[0.04] text-gold-muted/60 border border-white/[0.04]' : 'bg-white text-gray-500 border border-gray-200'
                      }`}
                    >
                      {{image: '图像', design: '设计', brand: '品牌', editing: '编辑', custom: '自定义'}[cat]}
                    </button>
                  ))}
                </div>
                <textarea
                  value={skillSaveDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSkillSaveDescription(e.target.value)}
                  placeholder="Skill 描述（可选）..."
                  className={`w-full px-2.5 py-1.5 rounded-md text-xs min-h-[48px] resize-none mb-2 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/40' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
                />
                <div className="flex gap-1.5">
                  <Button
                    onClick={handleSaveAsSkill}
                    disabled={!skillSaveName.trim()}
                    className={`flex-1 h-7 text-xs font-medium rounded-md ${
                      isGold ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90' : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    保存
                  </Button>
                  <Button
                    onClick={() => setShowSkillSaveDialog(false)}
                    className={`h-7 px-3 text-xs rounded-md ${
                      isGold ? 'bg-white/[0.04] text-gold-muted/70 border border-white/[0.04]' : 'bg-white text-gray-500 border border-gray-200'
                    }`}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}

            {/* 类别筛选 */}
            <div className="flex gap-1 flex-wrap">
              {[
                { key: '', label: '全部' },
                { key: 'image', label: '图像' },
                { key: 'design', label: '设计' },
                { key: 'brand', label: '品牌' },
                { key: 'storyboard', label: '分镜' },
                { key: 'editing', label: '编辑' },
                { key: 'custom', label: '自定义' },
              ].map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setSkillCategoryFilter(cat.key)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                    skillCategoryFilter === cat.key
                      ? isGold ? 'bg-gold/20 text-gold' : 'bg-blue-500 text-white'
                      : isGold ? 'bg-white/[0.04] text-gold-muted/60 hover:text-gold-muted' : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 推荐技能 — 来自 Lovart 设计方法论 */}
            {(!skillCategoryFilter || ['image', 'design', 'brand', 'storyboard'].includes(skillCategoryFilter)) && (
              <div className="space-y-1.5">
                <div className={`text-xs font-medium ${themeClasses.textMuted} flex items-center gap-1`}>
                  <Sparkles size={11} />
                  推荐技能
                  <span className={`text-[10px] opacity-50`}>— 专业设计工作流</span>
                </div>
                {(() => {
                  const categoryEmoji: Record<string, string> = { image: '🖼', design: '🎨', brand: '🏢', storyboard: '🎬', editing: '✏️', custom: '⚡' };
                  const categoryLabel: Record<string, string> = { image: '图像', design: '设计', brand: '品牌', storyboard: '分镜', editing: '编辑', custom: '自定义' };
                  return LOVART_PRESET_SKILLS
                    .filter((s: ChatSkill) => !skillCategoryFilter || s.category === skillCategoryFilter)
                    .filter((s: ChatSkill) => !skillSearchQuery || s.name.includes(skillSearchQuery) || s.description.includes(skillSearchQuery))
                    .map((skill: ChatSkill) => {
                    const isActive = activeSkill?.id === skill.id;
                    return (
                      <div
                        key={skill.id}
                        className={`rounded-lg p-2.5 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] ${
                          isGold ? 'bg-white/[0.03] border border-white/[0.04] hover:border-gold/30' : 'bg-white border border-gray-100 hover:border-blue-200'
                        }`}
                        onClick={() => handleUseSkill(skill)}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-sm ${
                            isGold ? 'bg-gradient-to-br from-gold/20 to-gold-dark/10' : 'bg-gradient-to-br from-blue-50 to-indigo-50'
                          }`}>
                            {categoryEmoji[skill.category] || '⚡'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-medium ${themeClasses.text}`}>{skill.name}</div>
                            {skill.description && (
                              <div className={`text-[10px] mt-0.5 ${themeClasses.textMuted} line-clamp-2`}>{skill.description}</div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                isGold ? 'bg-gold/10 text-gold/70' : 'bg-blue-50 text-blue-500'
                              }`}>
                                {categoryLabel[skill.category] || '自定义'}
                              </span>
                          </div>
                        </div>
                        <Zap size={12} className={`shrink-0 mt-1 ${isGold ? 'text-gold-muted/30' : 'text-gray-300'}`} />
                      </div>
                    </div>
                  );
                })}
                )()}
              </div>
            )}

            {/* 我的 Skills */}
            {chatSkills
              .filter(s => !skillCategoryFilter || s.category === skillCategoryFilter)
              .filter(s => !skillSearchQuery || s.name.includes(skillSearchQuery) || s.description.includes(skillSearchQuery))
              .length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-medium ${themeClasses.textMuted}`}>
                    我的 Skills
                  </div>
                  <button
                    onClick={() => { if (confirm('确认清空所有自定义 Skills？')) saveSkills([]); }}
                    className={`text-[10px] ${themeClasses.textMuted} hover:text-red-400 transition-colors`}
                  >
                    清空
                  </button>
                </div>
                {chatSkills
                  .filter(s => !skillCategoryFilter || s.category === skillCategoryFilter)
                  .filter(s => !skillSearchQuery || s.name.includes(skillSearchQuery) || s.description.includes(skillSearchQuery))
                  .map(skill => (
                  <div
                    key={skill.id}
                    className={`rounded-lg p-2.5 transition-all ${
                      activeSkill?.id === skill.id
                        ? isGold ? 'bg-gold/12 border border-gold/30' : 'bg-blue-50 border border-blue-200'
                        : isGold ? 'bg-white/[0.03] border border-white/[0.04] hover:border-white/[0.10]' : 'bg-white border border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 text-xs ${
                        isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-500'
                      }`}>
                        {{image: 'IMG', design: 'DSN', brand: 'BRD', storyboard: 'STR', editing: 'EDT', custom: 'SKL'}[skill.category as 'image'|'design'|'brand'|'storyboard'|'editing'|'custom'] || 'SKL'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium ${themeClasses.text}`}>{skill.name}</div>
                        {skill.description && (
                          <div className={`text-[10px] mt-0.5 ${themeClasses.textMuted} line-clamp-2`}>{skill.description}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] ${themeClasses.textMuted}`}>
                            {{image: '图像', design: '设计', brand: '品牌', storyboard: '分镜', editing: '编辑', custom: '自定义'}[skill.category as 'image'|'design'|'brand'|'storyboard'|'editing'|'custom'] || '自定义'}
                          </span>
                          <span className={`text-[10px] ${themeClasses.textMuted}`}>
                            使用 {skill.usageCount} 次
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleUseSkill(skill)}
                          className={`p-1 rounded transition-colors ${
                            isGold ? 'text-gold/70 hover:text-gold hover:bg-gold/10' : 'text-blue-400 hover:text-blue-600 hover:bg-blue-50'
                          }`}
                          title="使用此 Skill"
                        >
                          <Zap size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteSkill(skill.id)}
                          className={`p-1 rounded transition-colors ${
                            isGold ? 'text-gold-muted/40 hover:text-red-400 hover:bg-red-400/10' : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                          }`}
                          title="删除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 空状态 */}
            {chatSkills.length === 0 && (!skillCategoryFilter || !['image', 'design', 'brand', 'storyboard'].includes(skillCategoryFilter)) && (
              <div className={`text-center py-6 ${themeClasses.textMuted}`}>
                <Bookmark size={20} className="mx-auto mb-2 opacity-30" />
                <div className="text-xs">暂无自定义 Skills</div>
                <div className="text-[10px] mt-1 opacity-60">在对话中点击收藏按钮，将对话提炼为可复用 Skill</div>
              </div>
            )}

            {/* 使用说明 */}
            <div className={`rounded-lg p-3 ${isGold ? 'bg-white/[0.02] border border-white/[0.04]' : 'bg-gray-50 border border-gray-100'}`}>
              <div className={`text-[10px] ${themeClasses.textMuted} space-y-1`}>
                <div className="font-medium">Skill 使用说明</div>
                <div>1. 在智能对话中完成一次满意的交互</div>
                <div>2. 点击收藏按钮（<BookmarkCheck size={10} className="inline" />）将对话保存为 Skill</div>
                <div>3. 在 Skills 面板中找到保存的 Skill，点击使用</div>
                <div>4. Skill 会自动复用对话的智能体和提示词策略</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* 第三方模型调用弹窗 */}
      <ThirdPartyModelDialog
        isOpen={showThirdPartyDialog}
        onClose={() => setShowThirdPartyDialog(false)}
        themeStyle={themeStyle}
        defaultType="chat"
        onProviderAdded={(provider) => {
          const newModels: {id: string; name: string; provider: string; providerId: string}[] = [];
          if (provider.selectedModels && provider.selectedModels.length > 0) {
            provider.selectedModels.forEach(mId => {
              newModels.push({
                id: `${provider.id}::${mId}`,
                name: mId,
                provider: provider.displayName || provider.name,
                providerId: provider.id,
              });
            });
          } else if (provider.selectedModel) {
            newModels.push({
              id: `${provider.id}::${provider.selectedModel}`,
              name: provider.selectedModel,
              provider: provider.displayName || provider.name,
              providerId: provider.id,
            });
          }
          setThirdPartyChatModels(prev => [...prev, ...newModels]);
          if (newModels.length > 0 && !model.includes('::')) {
            setModel(newModels[0].id);
          }
        }}
        onProviderDeleted={(providerId) => {
          setThirdPartyChatModels(prev => prev.filter(m => m.providerId !== providerId));
          if (model.startsWith(`${providerId}::`)) {
            setModel('gemini-3.1-pro-preview');
          }
        }}
        onProviderUpdated={(provider) => {
          const mgr = UniversalApiManager.getInstance();
          const providers = mgr.getProviders();
          const chatModels: {id: string; name: string; provider: string; providerId: string}[] = [];
          providers.forEach((p: ApiProvider) => {
            if ((p.modelType?.includes('chat') || (!p.modelType && p.type === 'chat')) && p.isEnabled) {
              if (p.selectedModels && p.selectedModels.length > 0) {
                p.selectedModels.forEach((mId: string) => {
                  chatModels.push({
                    id: `${p.id}::${mId}`,
                    name: mId,
                    provider: p.displayName || p.name,
                    providerId: p.id,
                  });
                });
              } else if (p.selectedModel) {
                chatModels.push({
                  id: `${p.id}::${p.selectedModel}`,
                  name: p.selectedModel,
                  provider: p.displayName || p.name,
                  providerId: p.id,
                });
              }
            }
          });
          setThirdPartyChatModels(chatModels);
          if (model.includes('::') && !chatModels.find(m => m.id === model)) {
            setModel('gemini-3.1-pro-preview');
          }
        }}
      />
      <AgentBuilderDialog
        open={showAgentBuilder}
        onClose={() => setShowAgentBuilder(false)}
        editingAgent={editingAgent}
        isGold={isGold}
        onSave={(agent) => {
          setCustomAgents(prev => {
            const existing = prev.findIndex(a => a.id === agent.id);
            let updated;
            if (existing >= 0) {
              updated = [...prev];
              updated[existing] = agent;
            } else {
              updated = [...prev, agent];
            }
            // 限制最大30个自定义智能体，超出时移除最老的
            if (updated.length > 30) {
              updated = updated.slice(updated.length - 30);
            }
            localStorage.setItem('custom-agents', JSON.stringify(updated));
            return updated;
          });
        }}
      />
    </div>
  );
}
