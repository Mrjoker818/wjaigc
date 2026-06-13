'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Bot, Send, Sparkles, Copy, Check, Trash2, Loader2, Eye, EyeOff, Wand2, User, Upload, X, Image as ImageIcon, Languages, Settings, Plug, Plus, History, FolderOpen, MessageSquare, Bookmark, BookmarkCheck, Lightbulb, Zap, ArrowRight, Palette, Target, Sliders, Download, AlertCircle, LocateFixed, RotateCcw, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
}

interface NextSuggestion {
  id: string;
  label: string;
  action: 'img2img' | 'retouch' | 'upscale' | 'remove-bg' | 'extend' | 'svg-trace' | 'agent-edit' | 'generate-variant' | 'send-to-prompt' | 'generate-image';
  prompt?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

const AGENTS = [
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
  },
  {
    id: 'creative-posters',
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
      // Parse individual suggestions like: 1. 调整配色 → 图生图 / 2. 修改细节 → 语言修图
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^\d+\.\s*(.+?)(?:\s*[→➡>]\s*(.+))?$/);
        if (m) {
          const label = m[1].trim();
          const actionHint = (m[2] || '').trim();
          let action: NextSuggestion['action'] = 'generate-variant';
          let prompt: string | undefined;
          if (/图生图|风格|参考|变体|variant/i.test(actionHint)) action = 'img2img';
          else if (/修图|修改|编辑|retouch|edit/i.test(actionHint)) action = 'retouch';
          else if (/放大|高清|upscale/i.test(actionHint)) action = 'upscale';
          else if (/背景|去背|removebg|remove.?bg/i.test(actionHint)) action = 'remove-bg';
          else if (/扩展|延伸|extend|outpaint/i.test(actionHint)) action = 'extend';
          else if (/矢量|描摹|svg|vectoriz/i.test(actionHint)) action = 'svg-trace';
          else if (/agent|编排|智能/i.test(actionHint)) action = 'agent-edit';
          else if (/生成图片|生成|create|generate|画图|画|制作|设计/i.test(actionHint || label)) action = 'generate-image';
          else if (/提示词|prompt|生图/i.test(actionHint)) action = 'send-to-prompt';
          prompt = label;
          suggestions.push({ id: `sug-${Date.now()}-${suggestions.length}`, label, action, prompt });
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
function isVagueInput(text: string): boolean {
  const trimmed = text.trim();
  // Too short (< 8 chars) and no image attached
  if (trimmed.length < 8) return true;
  // Very generic single-word or two-word requests
  const vaguePatterns = /^(画一个|做一个|设计|生成|搞个|来个|帮我|创作|随便|帮我画)\s*$/;
  if (vaguePatterns.test(trimmed)) return true;
  // Just a noun without any detail
  const nounOnlyPattern = /^(一个|一只|一副|一张)?[\u4e00-\u9fa5]{1,4}$/;
  if (nounOnlyPattern.test(trimmed)) return true;
  return false;
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
              onClick={(e) => { e.stopPropagation(); onAddImage(imgSrc); }}
              className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
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
                      onClick={(e) => { e.stopPropagation(); onAddImage(url); }}
                      className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
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
        className={`relative w-[340px] max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col ${
          isGold ? 'bg-white/[0.03] backdrop-blur-xl border border-white/[0.04]' : 'bg-white border border-gray-200'
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
          <button onClick={onClose} className={`p-1 rounded-md transition-colors ${isGold ? 'hover:bg-white/[0.04] text-gold-muted' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
                <div className="absolute top-full left-0 mt-1 p-1.5 grid grid-cols-8 gap-0.5 rounded-lg shadow-xl z-50 hidden group-hover:grid bg-white/[0.03] backdrop-blur-xl border border-white/[0.04]">
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
          <div>
            <label className={labelClass}>角色定位</label>
            <textarea
              className={`${inputClass} h-14 mt-0.5 py-1 resize-none`}
              value={rolePosition}
              onChange={e => setRolePosition(e.target.value)}
              placeholder="如：顶级的酒类包装设计师与 3D 视觉艺术家"
            />
          </div>

          {/* Core Tasks */}
          <div>
            <label className={labelClass}>核心任务</label>
            <textarea
              className={`${inputClass} h-24 mt-0.5 py-1 resize-none`}
              value={coreTasks}
              onChange={e => setCoreTasks(e.target.value)}
              placeholder={"1. 任务一\n2. 任务二\n3. 任务三\n4. 任务四"}
            />
          </div>

          {/* Aesthetic Standards */}
          <div>
            <label className={labelClass}>审美与技术标准</label>
            <textarea
              className={`${inputClass} h-24 mt-0.5 py-1 resize-none`}
              value={aestheticStandards}
              onChange={e => setAestheticStandards(e.target.value)}
              placeholder={"- 标准1\n- 标准2\n- 标准3\n- 标准4"}
            />
          </div>

          {/* Output Spec */}
          <div>
            <label className={labelClass}>输出规范</label>
            <textarea
              className={`${inputClass} h-24 mt-0.5 py-1 resize-none`}
              value={outputSpec}
              onChange={e => setOutputSpec(e.target.value)}
              placeholder={"1. 输出项1\n2. 输出项2\n3. 输出项3"}
            />
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
  const [model, setModel] = useState('gemini-3.1-pro-preview');

  // Sync current chat model info to parent for vision-prompt usage
  useEffect(() => {
    if (!onChatModelChange) return;
    const isThirdParty = model.includes('::');
    if (isThirdParty) {
      const providerId = model.split('::')[0];
      const actualModel = model.split('::').slice(1).join('::');
      // Look up provider info from UniversalApiManager
      import('@/lib/universal-api-manager').then(({ UniversalApiManager }) => {
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
      }).catch(() => onChatModelChange(null));
    } else {
      // Server-managed model
      onChatModelChange({
        model,
        providerId: '',
        apiKey: '',
        baseUrl: '',
      });
    }
  }, [model, onChatModelChange]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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

  // Get mention picker items based on search
  const mentionPickerItems: MentionRef[] = useMemo(() => {
    const items: MentionRef[] = [];
    // Canvas images
    canvasImages.forEach(img => {
      items.push({
        type: 'canvas-image',
        id: img.id,
        label: img.prompt ? img.prompt.slice(0, 40) + (img.prompt.length > 40 ? '...' : '') : `图片 ${img.id.slice(0, 6)}`,
        imageUrl: img.url,
        data: { url: img.url, prompt: img.prompt || '', width: img.width, height: img.height },
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
    ).slice(0, 8);
  }, [canvasImages, brandDna, mentionPickerSearch]);

  // Handle @ trigger in textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);

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
          setTemplatePopupItems(results.slice(0, 8));
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
    // Also add canvas images to pending images for visual thumbnail in input area
    if (item.type === 'canvas-image' && item.imageUrl) {
      const imgUrl = item.imageUrl;
      setPendingImages(prev => {
        if (prev.some(p => p.url === imgUrl)) return prev;
        return [...prev, { id: item.id, url: imgUrl, name: item.label }];
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
      systemPrompt: `你是电商视觉设计专家，擅长为产品生成符合平台规范的A+内容套图。

设计规范：
1. 白底主图：纯白背景，产品居中，占画幅70-80%，无文字无水印
2. 卖点矩阵图：2x2或3x1网格布局，每格一个核心卖点+图标+简短描述，字号≥24pt
3. 使用场景图：产品在真实场景中的使用效果，氛围感强
4. 尺寸对比图：产品与常见参照物（手掌/硬币）的尺寸对比
5. 参数规格图：关键技术参数以表格或信息图形式呈现
6. 套装展示图：所有颜色/配件的家族展示
7. 品牌故事图：品牌Logo+Slogan+品牌调性视觉
8. 细节特写图：产品材质/工艺/接口等细节放大

输出要求：
- 统一配色体系，主色不超过3种
- 信息层级清晰：标题>卖点>描述
- 文字安全区域：距边缘≥40px
- 移动端可读性：关键文字≥18pt
- 每张图生成后标注图片类型和设计意图`,
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
      systemPrompt: `你是品牌视觉识别系统设计专家，擅长将单一Logo延展为完整的品牌视觉体系。

品牌延展规范：
1. Logo延展原则：
   - 保持核心图形/文字的完整性，不变形不裁切
   - 在不同材质上适配透视角度（球面/圆柱/平面）
   - 单色版/反白版/竖版/横版至少4种变体
2. 产品周边设计：
   - T恤：Logo位于左胸或中心，尺寸适中，考虑布料纹理
   - 卫衣：Logo放大居中或背部大图，配合辅助图形
   - 帆布包：Logo居中或偏下，考虑包的褶皱
   - 棒球帽：Logo居中正面，尺寸占帽面40-50%
   - 保温杯：Logo环绕或正面，考虑曲面贴合和反光
3. 品牌色应用：从Logo提取主色+辅助色，所有衍生品统一配色
4. 安全区域：Logo周围留出至少Logo高度1/4的空白
5. 禁忌：Logo不得倾斜超过15°、不得拉伸变形、不得被其他元素遮挡超过10%

输出要求：
- 每个周边效果图需展示真实材质质感
- Logo位置、大小、角度需精准贴合载体
- 统一品牌色彩体系贯穿所有输出
- 生成后标注每个设计的设计意图和品牌规范说明`,
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
      systemPrompt: `你是专业影视分镜师，擅长将创意需求转化为可执行的分镜故事板。

分镜规范：
1. 镜头规划：
   - 30秒视频标准8-10个镜头
   - 60秒视频标准15-18个镜头
   - 每个镜头标注：景别(全景/中景/近景/特写)、运镜(推/拉/摇/移/固定)、时长(精确到0.5秒)
2. 画面描述：
   - 主体：产品/人物在画面中的位置和姿态
   - 环境：场景氛围、光线方向、色调倾向
   - 动势：画面中的运动方向和速度感
3. 技术规格：
   - 画幅比例：16:9(横屏视频) / 9:16(竖屏短视频)
   - 分辨率：至少1920x1080
   - 色彩风格：统一调色方案（如电影感/日系/高饱和）
4. 镜头语言标注：
   - 每张分镜图下方标注镜头编号、时长、景别、运镜方式
   - 转场方式标注（硬切/淡入淡出/划变）

执行流程：
1. 先输出完整的镜头规划表（文字）
2. 逐镜头生成分镜图，风格统一
3. 最终组装为专业分镜故事板排版`,
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
      systemPrompt: `你是专业印刷品设计师，擅长设计符合印刷规范的营销宣传册。

宣传册设计规范：
1. 三折页结构（6面）：
   - 外页：封面(面1) + 封底(面6) + 内折页(面5)
   - 内页：左页(面2) + 中页(面3) + 右页(面4)
2. 双折页结构（4面）：
   - 外页：封面(面1) + 封底(面4)
   - 内页：左页(面2) + 右页(面3)
3. 排版规范：
   - 安全区域：距裁切线≥5mm
   - 出血线：设计稿向外延伸3mm
   - 文字区域：距折痕≥8mm
   - 正文字号：≥9pt，标题≥18pt
   - 折痕位置标注
4. 视觉规范：
   - 统一配色体系，主色≤3种
   - 图片与文字比例建议 40:60
   - 留白≥15%，避免信息过载
   - 品牌元素（Logo/色彩）贯穿每页

执行流程：
1. 先确认折页类型和内容大纲
2. 逐面生成设计图，确保视觉连贯
3. 文字内容分区域标注`,
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
      systemPrompt: `你是社交媒体视觉设计专家，擅长生成符合各平台规范的统一风格套图。

平台规范：
1. Instagram：
   - 方图 1080x1080px / 竖图 1080x1350px / 横图 1080x566px
   - Stories/Reels: 1080x1920px
   - 视觉优先，文字≤20%面积
2. 小红书：
   - 竖图 1080x1440px（3:4比例）
   - 封面图必须有标题文字，字号≥36pt
   - 内容图配合文字说明，信息密度适中
3. 微信朋友圈：
   - 方图 1080x1080px / 横图 1080x720px
   - 九宫格切图支持
   - 文字简洁，一图一核心信息
4. 微博：
   - 横图 1080x608px / 方图 1080x1080px
   - 长图最大宽度1080px
   - 支持多图轮播，首图最关键

设计原则：
- 统一色彩体系和字体风格
- 每张图一个核心信息点
- 品牌元素（Logo/色彩）一致
- 文字可读性优先，避免花哨背景
- 不同平台自动调整排版和信息密度`,
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
      systemPrompt: `你是产品包装设计专家，擅长设计符合印刷规范和法规要求的产品包装。

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
      systemPrompt: `你是概念艺术设计师，擅长为游戏/影视/建筑项目创建高品质概念场景。

概念设计流程：
1. 氛围图（Mood Board）：
   - 确定整体氛围基调（暗黑/梦幻/科幻/古风）
   - 色彩方案：主色调+2-3种辅助色
   - 光影方向：主光源方向+环境光色温
   - 参考风格标注
2. 场景构图：
   - 透视类型：一点/两点/三点透视
   - 视角：鸟瞰/仰视/平视
   - 焦点区域标注
   - 前景/中景/远景层次划分
3. 材质与细节：
   - 主要材质标注（石材/金属/木材/植被）
   - 表面处理（风化/打磨/腐蚀/发光）
   - 材质贴图参考板
4. 光影研究：
   - 日间/夜间/黄昏多时段方案
   - 体积光/雾气/粒子效果标注
   - 阴影投射方向确认

输出规格：
- 画面比例：16:9(影视) / 21:9(宽屏) / 1:1(社交媒体)
- 分辨率要求标注
- 每张图附带设计说明和材质/光影标注`,
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
      systemPrompt: `你是资深室内设计师，擅长从概念到落地的全流程室内设计出图。

设计输出类型：
1. 空间效果图（Perspective Rendering）：
   - 依据空间尺寸和功能需求，生成逼真的3D空间效果图
   - 标注材质、色彩、灯光方案
   - 提供至少2个视角（如入户视角+客厅主视角）
   - 画面比例16:9或4:3，分辨率≥1920px
2. 彩平图（Color Floor Plan）：
   - 俯视平面布局，彩色填充功能分区
   - 标注房间名称、面积、动线箭头
   - 家具以简笔符号标注位置和朝向
   - 比例尺标注（如1:100）
3. 材质拼板（Material Board）：
   - 主材/辅材/软装三大类分区展示
   - 每种材质标注名称、品牌参考、色号
   - 材质间搭配协调性说明
   - 整体色调统一性检查
4. 家具布局方案（Furniture Layout）：
   - 平面+立体双视角展示
   - 标注家具尺寸（长x宽x高）
   - 人体工程学动线（过道≥80cm，转身空间≥60cm）
   - 家具选型推荐（风格/品牌参考）
5. 细部大样（Detail Drawing）：
   - 关键节点放大展示（如收口/拼缝/灯槽）
   - 标注工艺做法和材料层次
   - 尺寸标注精确到mm
   - 配合文字说明施工要点

设计原则：
- 风格一致性：所有输出保持统一设计语言
- 功能优先：空间利用率和动线合理性
- 预算意识：标注材料档次参考
- 落地可行性：标注施工难度等级`,
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
      systemPrompt: `你是资深平面海报设计师，擅长创作兼具视觉冲击力和信息传达效率的海报。

海报设计规范：
1. 视觉层级（从强到弱）：
   - 主视觉：占据画面40-60%，第一时间抓住目光
   - 主标题：字号≥48pt，3米外可读
   - 副标题/关键信息：字号≥24pt
   - 辅助信息：字号≥12pt
2. 构图法则：
   - 三分法/黄金分割/对称/对角线
   - 视觉引导线：从主视觉→标题→辅助信息
   - 留白≥20%，避免视觉拥挤
3. 配色策略：
   - 主色≤2种，辅色≤3种
   - 高对比度确保可读性
   - 品牌色优先使用
4. 文字排版：
   - 标题字体选择：根据调性匹配（力量感/优雅/童趣/科技）
   - 中英文混排规范
   - 行距1.2-1.5倍字高
5. 印刷/数字适配：
   - 印刷：CMYK，300dpi，出血3mm
   - 数字：sRGB，72dpi，适配移动端

海报类型专业规范：
- 节日海报：节日元素+品牌植入+祝福语
- 活动海报：时间地点醒目+CTA按钮/二维码
- 品牌海报：品牌调性为主+产品/服务弱化
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
      systemPrompt: `你是专业PPT设计师，擅长生成内容完整、设计统一、视觉出色的演示文稿。

PPT设计规范：
1. 整体框架：
   - 封面页：标题+副标题+日期/品牌Logo
   - 目录页：3-8个章节，图标化呈现
   - 内容页：每页一个核心观点
   - 过渡页：章节分隔，视觉节奏感
   - 总结页：3-5个要点回顾
   - 结尾页：感谢/Q&A/联系方式
2. 版式设计：
   - 标题区：页面上方1/4，字号≥28pt
   - 内容区：页面中部2/3，图文比50:50
   - 页脚：页码+品牌标识，字号8pt
   - 每页文字≤50字（中文）/80词（英文）
3. 视觉统一：
   - 主色1种+辅色2种，贯穿全部页面
   - 字体≤3种（标题+正文+强调）
   - 图标/图表风格统一（线性/面性/双色）
   - 图片风格统一（摄影/插画/3D）
4. 数据可视化：
   - 表格：≤5行5列，重点行高亮
   - 图表：柱状图/折线图/饼图，数据标签清晰
   - 流程图：≤6步，箭头方向一致
5. 动效建议：
   - 关键数据用强调动画
   - 章节切换用淡入淡出
   - 避免花哨过渡效果

输出规格：
- 每页独立图片，16:9比例
- 页码标注，方便排序
- 风格统一，配色一致`,
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
      systemPrompt: `你是资深杂志艺术总监，擅长设计高品质杂志封面。

杂志封面设计规范：
1. 主视觉（Cover Image）：
   - 占据画面60-80%面积
   - 人物/产品/场景为主题
   - 留出标题区域（顶部1/4和底部1/5）
   - 视觉焦点避开文字区域
2. 标题系统：
   - 刊名（Masthead）：固定位置（顶部居中/左侧），字号最大，每期风格一致
   - 主标题（Main Headline）：本期核心话题，字号≥36pt
   - 副标题（Deck）：主标题补充，字号≥14pt
   - 条目预告（Teasers）：3-5条本期亮点，字号≥10pt
3. 排版规则：
   - 文字不遮挡主视觉核心（人脸/产品）
   - 条目预告沿画面边缘排列
   - 条形码区域：右下角，≥20x15mm
   - 期号/日期/定价标注
4. 配色策略：
   - 时尚类：高饱和度+大胆撞色
   - 科技类：冷色调+渐变+光效
   - 生活方式：暖色调+自然色系
   - 商业类：深色调+金属点缀
5. 印刷规范：
   - CMYK色彩模式
   - 300dpi分辨率
   - 出血3mm
   - 封面尺寸参考：210x285mm（标准A4+）

封面类型：
- 人物封面：名人/模特，眼神接触+表情叙事
- 产品封面：居中构图+光影质感
- 概念封面：创意合成+抽象表达`,
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
      systemPrompt: `你是专业服装设计师，擅长从概念到成衣的完整服装设计流程。

服装设计规范：
1. 款式图（Technical Flat）：
   - 正面+背面标准款式图
   - 清晰线条，无阴影无装饰
   - 标注：缝线位置/纽扣/拉链/口袋等细节
   - 比例精确（1:5或1:10）
   - 黑白线稿为主，重点部位彩色标注
2. 时尚效果图（Fashion Illustration）：
   - 9头身比例人物
   - 着装效果展示，面料质感表现
   - 动态姿势：走秀/站立/转身
   - 配饰搭配：鞋/包/首饰/帽子
3. 面料搭配（Fabric Swatch）：
   - 主面料：占服装80%面积，标注成分/克重/手感
   - 辅面料：里料/衬料/装饰面料
   - 色板：主色+辅色+点缀色，标注Pantone色号
   - 图案：条纹/格纹/印花的比例和方向
4. 设计细节标注：
   - 领型/袖型/下摆/腰线
   - 工艺说明：明线/暗线/包边/收省
   - 尺寸参考：衣长/肩宽/胸围/袖长
5. 穿着场景：
   - 模特穿着效果图
   - 搭配建议：上下装/内外搭
   - 场景适配：日常/办公/派对/运动

风格指南：
- 休闲：宽松廓形，舒适面料，低调配色
- 正装：修身剪裁，精致面料，沉稳配色
- 运动：功能性面料，人体工学剪裁，活力色彩
- 潮牌：大胆廓形，创新面料，撞色/印花`,
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
      systemPrompt: `你是专业名片设计师，擅长设计简洁有力、令人印象深刻的商务名片。

名片设计规范：
1. 尺寸标准：
   - 中国标准：90x54mm
   - 国际标准：85x55mm（ISO 7810）
   - 美国标准：89x51mm（3.5x2英寸）
2. 正面设计：
   - 布局：品牌Logo+姓名+职位
   - 姓名字号≥18pt，职位≥10pt
   - Logo尺寸：15-25mm
   - 留白≥10%，呼吸感
3. 背面设计：
   - 联系方式：电话/邮箱/地址/网站
   - 二维码（可选）：≥15x15mm
   - 社交媒体图标（可选）
   - 品牌Slogan或辅助图形
4. 排版方式：
   - 横版：经典商务，信息左对齐或居中
   - 竖版：创意个性，信息纵向排列
   - 双语：正面中文/背面英文，或正反面各一
5. 材质效果：
   - 铜版纸：光面，色彩鲜艳
   - 哑粉纸：哑光，高级质感
   - 特种纸：纹理/金属/透明
   - 特殊工艺：烫金/UV/凹凸/圆角
6. 印刷规范：
   - CMYK色彩
   - 300dpi
   - 出血2mm
   - 安全区3mm
   - 文字转曲`,
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
      systemPrompt: `你是资深书籍装帧设计师，擅长设计兼具美学价值和市场吸引力的书籍封面。

书籍封面设计规范：
1. 封面（Front Cover）：
   - 书名：醒目可读，3米外可识别，字号≥36pt
   - 作者名：封面底部1/4或顶部，字号≥14pt
   - 主视觉：与书籍内容高度相关，风格化处理
   - 推荐语/奖项：小字标注，≤2条
2. 书脊（Spine）：
   - 书名纵向排列（≥15mm宽度可横排）
   - 作者名+出版社Logo
   - 书脊宽度根据页数计算（80g胶版纸约0.08mm/页）
3. 封底（Back Cover）：
   - 内容简介：150-300字，字号≥9pt
   - 作者简介：50-100字+照片
   - 条形码+定价：右下角
   - ISBN标注
4. 排版规则：
   - 封面文字不遮挡主视觉焦点
   - 书名字体选择匹配内容调性
   - 留白≥15%，避免信息过载
   - 封面/封底视觉呼应
5. 类型适配：
   - 小说：叙事性主视觉+情感化字体
   - 社科：概念化主视觉+理性排版
   - 童书：高饱和色彩+趣味图形
   - 教材：功能导向+清晰层级
6. 印刷规范：
   - 展开尺寸：封面+书脊+封底+出血
   - CMYK，300dpi
   - 覆膜/UV/起凸工艺标注`,
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
      systemPrompt: `你是贴纸/表情包设计专家，擅长创造高辨识度、强传播力的表情包系列。

贴纸/表情包设计规范：
1. 基础设定：
   - 角色设计：1-3个核心角色，固定轮廓和特征
   - 风格统一：线条粗细/色彩饱和度/圆角弧度一致
   - 识别符号：每个角色至少1个独特元素（配饰/表情/颜色标记）
2. 表情矩阵（16-24张标准套装）：
   - 基础情绪（6张）：开心/难过/生气/惊讶/害羞/无语
   - 社交用语（6张）：OK/谢谢/加油/抱歉/晚安/早安
   - 流行语（4-6张）：绝了/emo/好耶/寄了/摸鱼/卷王
   - 动作姿态（4-6张）：奔跑/瘫倒/拥抱/比心/哭泣/鼓掌
3. 尺寸规范：
   - 微信表情：240x240px / 120x120px
   - LINE贴纸：370x320px / 270x270px
   - 通用：512x512px（可缩放）
4. 设计原则：
   - 表情幅度：夸张≥真实，远距离可识别
   - 辅助符号：汗滴/爱心/火焰/闪电增强表达
   - 留白：角色周围留白≥10%，不贴边
   - 无文字优先：纯图像表达，文字为辅
5. 角色一致性检查：
   - 核心轮廓（头身比/五官比例）±5%偏差
   - 配色不偏移±10%色相
   - 识别元素不省略`,
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
      systemPrompt: `你是专业漫画创作者，擅长从故事构思到分格成稿的完整漫画创作流程。

漫画创作规范：
1. 故事结构：
   - 四格漫画：起→承→转→合，每格1个关键画面
   - 短篇故事（6-12格）：开场→发展→高潮→结局
   - 条漫：纵向滚动，每屏1-3格，节奏紧凑
2. 分格布局：
   - 格线宽度2-4px，间距6-12px
   - 格子形状：方形为主，倾斜/出血格用于强调
   - 阅读顺序：右→左（日式）/左→右（中式/美式）
   - 关键画面放大到半页或整页
3. 角色表现：
   - 3-5个核心角色，每人有辨识特征
   - 表情夸张化：Q版/变形用于喜剧效果
   - 动作线/速度线增强动感
   - 每个角色固定配色方案
4. 对话与文字：
   - 气泡形状：圆角（普通）/锯齿（喊叫）/云朵（内心）
   - 字号分级：呐喊≥18pt/普通≥10pt/内心≥8pt
   - 拟声词：手绘风格，配合画面方向
   - 叙述框：矩形，灰色/半透明背景
5. 画面表现：
   - 背景层：场景/环境，可简化但不能省略
   - 效果层：集中线/速度线/闪光/汗滴
   - 色调层：网点/渐变/纯色填充
   - 重点格使用跨页/出血强调`,
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
      systemPrompt: `你是样机展示(Mockup)专家，擅长将平面设计精准贴合到各种产品载体上，生成逼真的实物效果图。

样机展示规范：
1. 载体适配原则：
   - 平面载体（海报/画框/信纸）：正透视，1:1还原
   - 曲面载体（杯子/瓶子/球体）：透视变形+曲面贴合
   - 柔性载体（T恤/帆布包/帽子）：褶皱贴合+布料纹理
   - 硬质载体（手机/平板/笔记本）：反光效果+边框遮挡
   - 场景载体（公交站牌/车身/建筑）：环境光影匹配
2. 材质还原：
   - 纸张：哑光/光面/纹理质感
   - 布料：棉质柔软/涤纶光滑/牛仔纹理+褶皱
   - 玻璃/金属：反光/高光/镜面效果
   - 陶瓷：光泽度+微妙纹理
   - 木质：纹理方向+涂装效果
3. 光影处理：
   - 主光源方向一致（环境光分析）
   - 设计稿上的投影和反射
   - 环境色对设计稿的色彩影响
4. 透视精度：
   - 消失点匹配场景透视
   - 近大远小比例正确
   - 边缘处理：设计稿边缘融入载体（不浮在表面）
5. 输出规格：
   - 产品视角：45°/正面/侧面至少2个
   - 背景干净（纯色/渐变/简单场景）
   - 分辨率≥1920px

常见载体清单：
- 服饰：T恤/卫衣/帽子/围巾
- 日用：杯子/手机壳/笔记本/帆布袋
- 展示：海报框/易拉宝/灯箱
- 包装：包装盒/手提袋/信封`,
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
      systemPrompt: `你是专业插画师，擅长多种风格的插画创作，从概念构思到成稿交付。

插画创作规范：
1. 构思阶段：
   - 理解主题和情感诉求
   - 确定1个核心视觉焦点
   - 构图方式：三分法/对称/对角线/环形/满版
   - 情绪板参考（色彩/风格/氛围）
2. 草图到成稿流程：
   - 粗略构图（拇指图）：3-5个方案供选择
   - 精细线稿：确定最终构图和角色姿态
   - 色彩铺设：大色块确定色调
   - 细节刻画：纹理/光影/氛围
3. 风格指南：
   - 写实插画：光影精确，材质还原，细节丰富
   - 扁平插画：几何形状，纯色填充，无渐变
   - 手绘水彩：笔触自然，色彩晕染，留白韵味
   - 矢量插画：线条清晰，色块分明，可无限放大
   - 混合媒介：照片+手绘+3D元素合成
4. 技术规范：
   - 印刷用途：CMYK，300dpi，标注出血
   - 数字用途：sRGB，150-300dpi
   - 社交媒体：72dpi，适配各平台尺寸
   - 尺寸建议：最小边≥1500px
5. 配色策略：
   - 主色≤2种，辅助色≤4种
   - 60-30-10法则：60%主色+30%辅色+10%点缀色
   - 色彩情感：暖色=热情/冷色=理性/高饱和=活力/低饱和=沉稳`,
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
      systemPrompt: `你是UI/UX设计师，擅长设计美观且易用的App和网页界面。

UI设计规范：
1. 设计系统基础：
   - 栅格系统：8pt基准网格
   - 字体层级：H1(28-32pt)/H2(22-24pt)/H3(18-20pt)/Body(14-16pt)/Caption(10-12pt)
   - 间距系统：4/8/12/16/24/32/48px
   - 圆角规范：4/8/12/16px（按组件层级递增）
2. 组件规范：
   - 按钮：主按钮(填充)/次按钮(描边)/文字按钮，高度40-48px
   - 输入框：高度44-48px，标签+占位符+错误提示
   - 卡片：圆角12-16px，内边距16-20px，阴影层级
   - 导航栏：高度44-56px，标题居中或左对齐
   - 标签栏：高度49-56px（iOS）/56dp（Material）
3. 色彩系统：
   - 主色(Brand)：1种，用于主按钮/关键操作
   - 功能色：成功(绿)/警告(橙)/错误(红)/信息(蓝)
   - 中性色：文字(#1a1a1a~#999)/背景(#fff~#f5f5f5)/边框(#e5e5e5)
   - 暗色模式：自动反转+饱和度调整
4. 页面类型：
   - 首页：核心功能入口+个性化推荐+运营位
   - 列表页：筛选+排序+卡片/列表视图切换
   - 详情页：大图+信息层级+操作按钮
   - 表单页：分组+验证+进度指示
   - 设置页：分组列表+开关+跳转箭头
5. 适配规范：
   - iOS：375x812pt(iPhone 14)/430x932pt(iPhone 14 Pro Max)
   - Android：360x800dp(Material)
   - Web：1440px宽度，断点768/1024/1440px`,
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

美食摄影规范：
1. 构图法则：
   - 俯拍(Flat Lay)：桌面全貌，适合多菜品展示
   - 45°角：最自然视角，适合主菜/套餐
   - 平视：层次感强，适合汉堡/蛋糕/饮品
   - 特写：食材纹理/酱汁/蒸汽细节
2. 布光策略：
   - 自然光：侧窗光+反光板，柔和不刺眼
   - 逆光/侧逆光：食物边缘轮廓光，蒸汽可见
   - 暖色温(3200-4000K)：增强食欲感
   - 避免正面闪光（平面化）
3. 食物造型：
   - 酱汁用注射器精准摆放
   - 蔬菜喷油保持光泽
   - 蒸汽/烟雾增加氛围
   - 配料散落增加自然感
4. 道具搭配：
   - 盘器选择：白色/木色/石板，不抢食物风头
   - 餐具：银色/木色，摆放自然（不完全对齐）
   - 背景：大理石/木纹/亚麻布/深色桌面
   - 装饰：香草/水果/坚果等原材料散落
5. 后期风格：
   - 色温偏暖5-10%
   - 饱和度适度+10-15%
   - 暗部微微提亮保留细节
   - 清晰度+5-10增强质感`,
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
  const handleUseSkill = useCallback((skill: ChatSkill) => {
    const paramValues = { ...skillParamValues };
    // 设置智能体 systemPrompt（优先 agentId，其次 skill.systemPrompt）
    const skillSystemPrompt = skill.agentId || skill.systemPrompt;
    if (skillSystemPrompt) {
      setSystemPrompt(skillSystemPrompt);
    }
    // 构建首条消息 - 替换参数槽位
    let firstMessage = '';
    if (skill.steps.length > 0) {
      const firstUserStep = skill.steps.find(s => s.role === 'user');
      if (firstUserStep) {
        firstMessage = firstUserStep.content;
        // 替换参数槽位
        for (const slot of skill.paramSlots) {
          const val = paramValues[slot.name] || slot.defaultValue || '';
          if (val) {
            firstMessage = firstMessage.replace(slot.defaultValue || slot.name, val);
          }
        }
      }
    }
    // 创建新对话
    const newId = `chat-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: `Skill: ${skill.name}`,
      messages: [],
      model: model,
      systemPrompt: skillSystemPrompt || systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setChatSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setMessages([]);
    setActiveSkill(null);
    setSkillParamValues({});
    setActiveTab('chat');
    // 更新使用计数
    saveSkills(chatSkills.map(s => s.id === skill.id ? { ...s, usageCount: s.usageCount + 1, updatedAt: Date.now() } : s));
    // 如果有首条消息，自动发送
    if (firstMessage.trim()) {
      setInput(firstMessage);
    }
  }, [skillParamValues, model, systemPrompt, chatSkills, saveSkills]);

  // 删除 Skill
  const handleDeleteSkill = useCallback((skillId: string) => {
    saveSkills(chatSkills.filter(s => s.id !== skillId));
  }, [chatSkills, saveSkills]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
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
  }, []);

  // 保存对话到localStorage
  const saveSession = useCallback((sessionMessages: Message[], sessionModel: string, sessionSystemPrompt: string, sessionId?: string) => {
    const id = sessionId || currentSessionId || `session-${Date.now()}`;
    const title = sessionMessages.length > 0
      ? sessionMessages[0].content.substring(0, 20) + (sessionMessages[0].content.length > 20 ? '...' : '')
      : '新对话';
    const session: ChatSession = {
      id,
      title,
      messages: sessionMessages,
      model: sessionModel,
      systemPrompt: sessionSystemPrompt,
      createdAt: sessionMessages.length > 0 ? sessionMessages[0].timestamp : Date.now(),
      updatedAt: Date.now(),
    };
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      const updated = [session, ...filtered].slice(0, 50);
      localStorage.setItem('chat-sessions', JSON.stringify(updated));
      return updated;
    });
    if (!currentSessionId) setCurrentSessionId(id);
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

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  const handleSend = useCallback(async (overrideText?: string) => {
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

    // P0-3: 模糊意图主动追问 - 如果输入太模糊，添加追问标记
    const isVague = isVagueInput(trimmedInput) && pendingImages.length === 0;

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
      // systemPrompt 可能是 agentId（短ID）或直接是 Skill 的 systemPrompt 文本（长文本）
      const systemPromptObj = allAgents.find(p => p.id === systemPrompt);
      let enhancedSystemPrompt = systemPromptObj?.prompt || '';
      // 如果 systemPrompt 不是 agentId（未在 allAgents 中找到），则它本身就是 prompt 文本
      if (!systemPromptObj && systemPrompt) {
        enhancedSystemPrompt = systemPrompt;
      }

      const requestMessages = [];
      
      // P0-2: 生成后主动引导 - 在系统提示词中注入建议指令
      enhancedSystemPrompt += `

【重要：回复格式规范】
1. 当你帮助用户生成图片或完成设计任务后，必须在回复末尾附加"建议下一步"区域，格式如下：
💡 建议下一步：
1. [具体操作描述] → [操作类型]
2. [具体操作描述] → [操作类型]
3. [具体操作描述] → [操作类型]

操作类型必须是以下之一：图生图、语言修图、放大、移除背景、扩展画面、SVG描摹、Agent编排、提示词优化
每次给出2-3个建议，建议应与当前对话内容紧密相关。

2. 如果你生成的图片有任何值得注意的设计特点，请简要说明。`;

      // P0-3: 模糊意图追问 - 如果输入太模糊，注入追问指令
      if (isVague) {
        enhancedSystemPrompt += `

【重要：当前用户输入过于模糊】
用户输入简短且缺少关键细节。请先追问澄清，而非直接执行。你需要问清楚：
- 具体主题/对象是什么？
- 期望的风格/氛围是什么？
- 用途/场景是什么？
- 有无特殊要求？
追问时给出2-3个具体选项帮助用户选择，降低回答门槛。格式示例：
"我理解您想[用户意图]，为了给出最好的结果，请补充一些细节：
1. 关于主题：[选项A] / [选项B] / [选项C]
2. 关于风格：[选项A] / [选项B] / [选项C]"`;
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

      // P1-2: 图片上下文 - 如果有选中画布图片，注入图片上下文
      const hasCanvasImages = pendingImages.length > 0;
      if (hasCanvasImages) {
        const imageDescriptions = pendingImages.map((img, i) => 
          `图片${pendingImages.length > 1 ? (i + 1) : ''}: ${img.name}`
        ).join('\n');
        enhancedSystemPrompt += `

【当前编辑图片】
用户正在编辑画布上的${pendingImages.length > 1 ? '多张' : '一张'}图片，请针对图片给出建议或修改指令：
${imageDescriptions}
用户的消息是针对这${pendingImages.length > 1 ? '些' : '张'}图片的操作指令，请据此理解用户意图。

【⚠️ 图像生成指令 - 必须遵守⚠️】
仅在用户明确要求"生成/画出/创建/制作/设计一张图片或某种视觉内容"时，才输出图像生成指令。
例如：画一只猫、设计海报、制作表情包、生成插画、帮我P图、变体、换风格 → 必须输出[GENERATE:]
例如：什么是AI、解释xxx原理、写一段文案、推荐配色 → 不要输出[GENERATE:]

当你判断需要生成图片时，输出格式要求（严格遵守）：
1. 先用自然语言描述你的设计思路和建议（中文）
2. 在回复的最后，每张图片单独一行输出 [GENERATE: ...] 标签，格式严格如下：

【单张图】
[GENERATE: 详细的英文图像生成提示词]

【多张图 - 关键规则】
当用户要求生成多张图（如"生成3张"、"多个方案"、"不同风格"）时：
- 每个方案必须输出一个独立的 [GENERATE: ...] 标签
- 每个标签内的提示词只描述一个画面，不要把多个方案合并到一个标签里
- 每个提示词应有明显差异（不同构图/风格/角度/色调）
格式示例：
[GENERATE: a cute orange cat sleeping on a sunny windowsill, oil painting style, warm tones]
[GENERATE: a playful orange cat chasing a butterfly in a flower garden, watercolor style, bright colors]
[GENERATE: a majestic orange cat sitting on a rooftop at sunset, digital art, cinematic lighting]

提示词要求：英文、200-500词、详细描述画面内容/风格/构图/色彩/光照/细节。
示例：用户说"做一套表情包" → 你先给设计建议，最后为每个表情分别输出：
[GENERATE: a cute cartoon cat sticker with happy expression, kawaii style, white background, bold outlines]
[GENERATE: a cute cartoon cat sticker with angry expression, kawaii style, white background, bold outlines]
[GENERATE: a cute cartoon cat sticker with surprised expression, kawaii style, white background, bold outlines]`;
      }

      // P2-1: Tune Mode — Inject fine-tuning parameters
      if (tuneContextString) {
        enhancedSystemPrompt += tuneContextString;
      }

      // 通用图像生成指令 - 当没有图片时，也告诉LLM可以触发生图
      if (!hasCanvasImages) {
        enhancedSystemPrompt += `

【⚠️ 图像生成指令 - 必须遵守⚠️】
仅在用户明确要求"生成/画出/创建/制作/设计一张图片或某种视觉内容"时，才输出图像生成指令。
例如：画一只猫、设计海报、制作表情包、生成插画 → 必须输出[GENERATE:]
例如：什么是AI、解释原理、写文案、推荐配色 → 不要输出[GENERATE:]

当你判断需要生成图片时，输出格式要求（严格遵守）：
1. 先用自然语言描述你的设计思路和建议（中文）
2. 在回复的最后，每张图片单独一行输出 [GENERATE: ...] 标签，格式严格如下：

【单张图】
[GENERATE: 详细的英文图像生成提示词]

【多张图 - 关键规则】
当用户要求生成多张图（如"生成3张"、"多个方案"、"不同风格"）时：
- 每个方案必须输出一个独立的 [GENERATE: ...] 标签
- 每个标签内的提示词只描述一个画面，不要把多个方案合并到一个标签里
- 每个提示词应有明显差异（不同构图/风格/角度/色调）
格式示例：
[GENERATE: a cute orange cat sleeping on a sunny windowsill, oil painting style, warm tones]
[GENERATE: a playful orange cat chasing a butterfly in a flower garden, watercolor style, bright colors]
[GENERATE: a majestic orange cat sitting on a rooftop at sunset, digital art, cinematic lighting]

提示词要求：英文、200-500词、详细描述画面内容/风格/构图/色彩/光照/细节。
示例：用户说"画一只猫" → 你先给出创意建议，最后单独一行输出：
[GENERATE: a beautiful cat sitting on a windowsill, soft sunlight, oil painting style, warm color palette, detailed fur texture, cozy atmosphere, 4K quality]`;
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
      const mentionedImages = activeMentions.filter(m => m.type === 'canvas-image' && m.data?.url);
      const mentionedPrompts = activeMentions.filter(m => m.type === 'prompt' && m.data?.content);
      
      // Build context prefix from mentions
      let mentionContext = '';
      if (mentionedPrompts.length > 0) {
        mentionContext += '\n\n[引用的提示词]\n' + mentionedPrompts.map(m => `- ${m.data!.content}`).join('\n');
      }
      
      // Collect all images to send as multimodal content
      const allImageUrls: string[] = [];
      
      // 1. Pending images (canvas images, pasted images, @mentioned images)
      capturedPendingImages.forEach(img => {
        if (!allImageUrls.includes(img.url)) allImageUrls.push(img.url);
      });
      
      if (allImageUrls.length > 0) {
        // Send as multimodal content with images
        const imageContents = allImageUrls.map(url => ({
          type: 'image_url' as const,
          image_url: { url }
        }));
        requestMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: trimmedInput + mentionContext },
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

      // ====== 图像生成：改为LLM驱动模式 ======
      // 不再预检测意图，而是在LLM回复中解析 [GENERATE: ...] 标签
      // LLM会在systemPrompt中被告知如何使用此标签

      // 创建 AbortController 以支持取消
      const controller = new AbortController();
      abortControllerRef.current = controller;

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

          providerId,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const assistantMessageId = `assistant-${Date.now()}`;
      let assistantContent = '';

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
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  assistantContent += delta;
                  // 流式输出时实时隐藏所有 [GENERATE: ...] 标签（包括未闭合的）
                  const streamDisplayContent = assistantContent
                    .replace(/\[GENERATE:\s*[\s\S]+?\]/g, '') // 移除已闭合的标签
                    .replace(/\[GENERATE:\s*[\s\S]*$/, '') // 移除未闭合的标签（正在流式输出）
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
            }
          }
        }
      }

      // P0-2: 解析建议下一步
      const { cleanedContent, suggestions } = parseSuggestions(assistantContent);
      if (suggestions.length > 0) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: cleanedContent, suggestions }
            : msg
        ));
      }

      // P0-3: 检测追问回复 - 标记追问消息
      if (isVague && assistantContent.includes('？') || assistantContent.includes('?') || /请补充|请说明|请选择|请告诉我/.test(assistantContent)) {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, isClarifying: true }
            : msg
        ));
      }

      // ====== LLM驱动的图像生成：解析 [GENERATE: ...] 标签（支持多个独立标签） ======
      const generateMatches = [...assistantContent.matchAll(/\[GENERATE:\s*([\s\S]+?)\]/g)];
      const hasGenerateTags = generateMatches.length > 0;
      if (hasGenerateTags) {
        // ★ 提取所有独立的 prompt
        const prompts: string[] = generateMatches.map(m => m[1].trim());
        // 从显示内容中移除所有 [GENERATE: ...] 标签
        const displayContent = assistantContent.replace(/\[GENERATE:\s*[\s\S]+?\]/g, '').trim();
        // ★ 先获取模型信息
        const imageModelInfo = getCurrentImageModelInfo(imageModel, imageModelProviderId);
        // 图片数量 = LLM输出的标签数（优先），否则从用户文本检测
        const imageCount = prompts.length > 0 ? prompts.length : detectImageCountFromText(trimmedInput);
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: displayContent, isGeneratingImage: true, generateModelName: imageModelInfo.model || '图像生成', generateProviderId: imageModelInfo.providerId, generateProgress: 0, generateImageCount: imageCount }
            : msg
        ));

        // 检查是否有可用的图像模型
        if (!imageModelInfo.model) {
          console.warn('[ChatImage] No image model selected');
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, isGeneratingImage: false, generateError: '请先在聊天输入框选择一个图像模型，然后再试一次' }
              : msg
          ));
        } else {
          // 异步执行图像生成 — 每个 prompt 独立提交
          (async () => {
            try {
              const aspectRatio = detectAspectRatioFromText(prompts.join(' ') + ' ' + trimmedInput) || '1:1';
              const quality = detectQualityFromText(prompts.join(' ') + ' ' + trimmedInput) || '1K';
              const referenceImages = capturedPendingImages.map(img => img.url);
              const imageSourceId = capturedPendingImages.length > 0 ? capturedPendingImages[0].id : undefined;

              console.log(`[ChatImage] LLM-triggered generation: ${prompts.length} independent prompt(s)`);
              prompts.forEach((p, i) => console.log(`[ChatImage] Prompt #${i+1}:`, p.substring(0, 100) + '...'));

              const allResultUrls: string[] = [];

              // ★ 逐个提交每个 prompt（串行，避免API限流）
              for (let promptIdx = 0; promptIdx < prompts.length; promptIdx++) {
                const rawPrompt = prompts[promptIdx];
                const isMultiPrompt = prompts.length > 1;

                // 更新进度（多prompt时按prompt进度）
                if (isMultiPrompt) {
                  const baseProgress = Math.round((promptIdx / prompts.length) * 100);
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, generateProgress: baseProgress }
                      : msg
                  ));
                }

                // 提交图像生成 — 每个 prompt 只生成1张（outputCount: 1）
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
                    ...(referenceImages.length > 0 ? { referenceImages } : {}),
                  }),
                });
                const generateData = await generateRes.json();
                console.log(`[ChatImage] Prompt #${promptIdx+1} API response:`, JSON.stringify(generateData).substring(0, 200));

                if (!generateData.success) {
                  console.error(`[ChatImage] Prompt #${promptIdx+1} API failed:`, generateData.error);
                  // 单个prompt失败不中断其他prompt，记录错误继续
                  continue;
                }

                const genModel = generateData.model || imageModelInfo.model;
                const promptResultUrls: string[] = [];

                // ★ 处理直接返回图片的情况 (mode: 'direct', imageUrls)
                if (generateData.imageUrls && generateData.imageUrls.length > 0) {
                  promptResultUrls.push(...generateData.imageUrls);
                } else if (generateData.imageUrl) {
                  promptResultUrls.push(generateData.imageUrl);
                }

                // ★ 轮询模式 (mode: 'polling', taskIds)
                const taskIds: string[] = generateData.taskIds || [];
                if (taskIds.length > 0 && promptResultUrls.length === 0) {
                  for (const taskId of taskIds) {
                    for (let i = 0; i < 120; i++) {
                      const interval = i <= 2 ? 800 : i <= 5 ? 1000 : i <= 15 ? 1500 : 2000;
                      await new Promise(r => setTimeout(r, interval));

                      // ★ 更新进度
                      const pollProgress = isMultiPrompt
                        ? Math.round(((promptIdx + (i / 120)) / prompts.length) * 100)
                        : Math.min(90, 10 + Math.round((i / 120) * 80));
                      setMessages(prev => prev.map(msg => 
                        msg.id === assistantMessageId 
                          ? { ...msg, generateProgress: pollProgress }
                          : msg
                      ));

                      try {
                        const pollRes = await fetch('/api/poll-task', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();

                        if (pollData.status === 'completed') {
                          const extractedUrl = pollData.imageUrl
                            || pollData.result?.imageUrl
                            || (pollData.result?.image?.url)
                            || (pollData.result?.images?.[0]?.url)
                            || (pollData.result?.images?.[0]);
                          if (extractedUrl && typeof extractedUrl === 'string') {
                            promptResultUrls.push(extractedUrl);
                          }
                          break;
                        } else if (pollData.status === 'failed') {
                          console.error(`[ChatImage] Prompt #${promptIdx+1} generation failed:`, pollData.error);
                          break; // 单个prompt失败，不中断其他
                        } else if (pollData.retryable === false) {
                          console.error(`[ChatImage] Prompt #${promptIdx+1} task not retryable:`, pollData.error);
                          break;
                        }
                      } catch (pollErr) {
                        console.warn(`[ChatImage] Prompt #${promptIdx+1} poll error, retrying:`, pollErr);
                      }
                    }
                  }
                }

                // 收集此 prompt 的结果
                allResultUrls.push(...promptResultUrls);

                // 每完成一个prompt，实时更新已生成的图片
                if (allResultUrls.length > 0) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, generatedImages: [...allResultUrls] }
                      : msg
                  ));
                }
              }

              if (allResultUrls.length > 0) {
                // 更新消息：添加生成图片，移除loading
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, generatedImages: allResultUrls, isGeneratingImage: false, generateProgress: 100 }
                    : msg
                ));

                // 将图片添加到画布
                if (onAddImages) {
                  onAddImages(allResultUrls, imageSourceId, { modelName: imageModelInfo.model, apiProvider: imageModelInfo.providerId });
                }
                console.log('[ChatImage] Successfully generated', allResultUrls.length, 'images from', prompts.length, 'prompt(s)');
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
      }

      // ====== 兜底：如果LLM未输出 [GENERATE: ...] 但用户意图明确是生图 ======
      if (!hasGenerateTags && (pendingImages.length > 0 || (activeSkill && ['image', 'design'].includes(activeSkill.category)))) {
        const userWantsImage = isImageGenerationIntent(trimmedInput);
        if (userWantsImage) {
          console.log('[ChatImage] Fallback: LLM did not output [GENERATE] tag but user intent is clear');
          const imageModelInfo = getCurrentImageModelInfo(imageModel, imageModelProviderId);
          // 检测生成数量
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

                // 用 optimize-prompt 优化用户的提示词
                let optimizedPrompt = trimmedInput;
                try {
                  const optRes = await fetch('/api/optimize-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: trimmedInput, mode: 'enhance', model: actualModel, providerId }),
                  });
                  const optData = await optRes.json();
                  if (optData.optimizedPrompt) {
                    optimizedPrompt = optData.optimizedPrompt;
                  }
                } catch { /* use original */ }

                console.log('[ChatImage] Fallback generation with prompt:', optimizedPrompt.substring(0, 100));

                const generateRes = await fetch('/api/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: optimizedPrompt,
                    model: imageModelInfo.model,
                    providerId: imageModelInfo.providerId,
                    aspectRatio,
                    quality,
                    outputCount,
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
                const resultUrls: string[] = [];

                // ★ 处理直接返回图片的情况 (mode: 'direct', imageUrls)
                if (generateData.imageUrls && generateData.imageUrls.length > 0) {
                  resultUrls.push(...generateData.imageUrls);
                } else if (generateData.imageUrl) {
                  resultUrls.push(generateData.imageUrl);
                }

                // ★ 轮询模式
                if (taskIds.length > 0 && resultUrls.length === 0) {
                  for (const taskId of taskIds) {
                    for (let i = 0; i < 120; i++) {
                      const interval = i <= 2 ? 800 : i <= 5 ? 1000 : i <= 15 ? 1500 : 2000;
                      await new Promise(r => setTimeout(r, interval));

                      // ★ 更新进度
                      const progress = Math.min(90, 10 + Math.round((i / 120) * 80));
                      setMessages(prev => prev.map(msg => 
                        msg.id === assistantMessageId 
                          ? { ...msg, generateProgress: progress }
                          : msg
                      ));

                      try {
                        const pollRes = await fetch('/api/poll-task', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();
                        if (pollData.status === 'completed') {
                          const extractedUrl = pollData.imageUrl
                            || pollData.result?.imageUrl
                            || (pollData.result?.image?.url)
                            || (pollData.result?.images?.[0]?.url)
                            || (pollData.result?.images?.[0]);
                          if (extractedUrl && typeof extractedUrl === 'string') {
                            resultUrls.push(extractedUrl);
                          }
                          break;
                        } else if (pollData.status === 'failed') {
                          const failReason = pollData.error || '生成失败';
                          setMessages(prev => prev.map(msg => 
                            msg.id === assistantMessageId 
                              ? { ...msg, isGeneratingImage: false, generateError: failReason }
                              : msg
                          ));
                          return;
                        } else if (pollData.retryable === false) {
                          const failReason = pollData.error || '任务不可重试';
                          setMessages(prev => prev.map(msg => 
                            msg.id === assistantMessageId 
                              ? { ...msg, isGeneratingImage: false, generateError: failReason }
                              : msg
                          ));
                          return;
                        }
                      } catch { /* retry */ }
                    }
                  }
                }

                if (resultUrls.length > 0) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, generatedImages: resultUrls, isGeneratingImage: false, generateProgress: 100 }
                      : msg
                  ));
                  if (onAddImages) {
                    onAddImages(resultUrls, imageSourceId, { modelName: imageModelInfo.model, apiProvider: imageModelInfo.providerId });
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

      // 保存对话
      const finalMessages = [...newMessages, { id: assistantMessageId, role: 'assistant' as const, content: assistantContent, timestamp: Date.now() }];
      saveSession(finalMessages, model, systemPrompt);
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
  }, [input, isLoading, messages, model, systemPrompt, isThinkingMode, saveSession, pendingImages, allAgents, activeMentions, brandDna, tuneContextString, activeSkill, onAddImages]);

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
              onClick={() => setActiveTab('chat')}
              className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
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
              onClick={() => setActiveTab('optimizer')}
              className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
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
              onClick={() => setActiveTab('skills')}
              className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
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
              {messages.length >= 2 && (
                <button
                  onClick={() => {
                    setSkillSaveName('');
                    setSkillSaveDescription('');
                    setSkillSaveCategory('custom');
                    setShowSkillSaveDialog(true);
                    setActiveTab('skills');
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    isGold ? 'text-gold-muted hover:text-gold hover:bg-gold/10' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                  }`}
                  title="保存为 Skill"
                >
                  <BookmarkCheck size={14} />
                </button>
              )}
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
                      <MessageSquare size={12} className={session.id === currentSessionId ? (isGold ? 'text-gold' : 'text-blue-500') : themeClasses.textMuted} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium truncate ${session.id === currentSessionId ? themeClasses.text : themeClasses.textMuted}`}>
                          {session.title}
                        </div>
                        <div className={`text-xs ${themeClasses.textMuted}`}>
                          {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
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
                        // Add to pending images for chat context
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

        {/* Settings Bar - compact */}
        <div className={`border-b ${themeClasses.border} shrink-0 px-3 py-2`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Settings size={12} className={themeClasses.textMuted} />
              <span className={`text-xs font-medium ${themeClasses.textMuted} uppercase tracking-wider`}>对话配置</span>
            </div>
            <button
              onClick={() => setShowChatSettings(!showChatSettings)}
              className={`text-xs ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors`}
            >
              {showChatSettings ? '收起' : '展开'}
            </button>
          </div>
          {showChatSettings && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className={`flex-1 h-7 text-xs ${themeClasses.inputBg} ${themeClasses.border} ${themeClasses.text}`}>
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
            </div>

            <div className="grid grid-cols-4 gap-1">
              {allAgents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => setSystemPrompt(prev => prev === agent.id ? '' : agent.id)}
                  className={`group relative flex flex-col items-center justify-center py-1.5 px-1 rounded-md transition-all duration-150 border ${
                    systemPrompt === agent.id
                      ? 'border-[var(--agent-color)] shadow-[0_0_8px_var(--agent-color-20)]'
                      : `border-transparent ${isGold ? 'hover:bg-white/[0.06]' : 'hover:bg-[#f0f0f0]'}`
                  } ${isGold ? 'bg-[#0d0d0d]' : 'bg-[#fafafa]'}`}
                  style={{
                    '--agent-color': agent.color,
                    '--agent-color-20': agent.color + '33',
                  } as React.CSSProperties}
                >
                  <span className="text-xs shrink-0">{agent.icon}</span>
                  <span className={`text-xs font-medium leading-tight truncate w-full text-center mt-0.5 ${
                    systemPrompt === agent.id 
                      ? (isGold ? 'text-gold' : 'text-gray-900') 
                      : (isGold ? 'text-gold-muted' : 'text-gold-muted/50')
                  }`}>
                    {agent.name}
                  </span>
                  {systemPrompt === agent.id && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-[2px] rounded-full" style={{ backgroundColor: agent.color }} />
                  )}
                </button>
              ))}
              {/* 新增智能体按钮 */}
              <button
                onClick={() => { setEditingAgent(null); setShowAgentBuilder(true); }}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-md transition-all duration-150 border border-dashed ${
                  isGold ? 'border-white/[0.04] hover:border-gold/40 hover:bg-white/[0.06]' : 'border-gray-200 hover:border-gray-400 hover:bg-[#f0f0f0]'
                }`}
              >
                <Plus size={11} className={isGold ? 'text-gold/50' : 'text-gray-400'} />
                <span className={`text-xs font-medium mt-0.5 ${isGold ? 'text-gold-muted/50' : 'text-gray-400'}`}>新增</span>
              </button>
            </div>
            {systemPrompt && (() => {
              const selectedAgent = allAgents.find(a => a.id === systemPrompt);
              if (!selectedAgent) return null;
              const isCustom = customAgents.some(a => a.id === selectedAgent.id);
              return (
                <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md ${isGold ? 'bg-[#0d0d0d]' : 'bg-[#f5f5f5]'}`}>
                  <div className="w-0.5 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedAgent.color }} />
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-medium ${isGold ? 'text-gold' : 'text-gray-900'}`}>{selectedAgent.name}</span>
                    <span className={`text-xs ${isGold ? 'text-gold-muted' : 'text-gray-500'} ml-1`}>{selectedAgent.nameEn}</span>
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
          )}
        </div>

        {/* Messages - 精致设计 */}
        <div className={`flex-1 min-h-0 overflow-y-auto p-3 space-y-3 ${isGold ? 'bg-[#090909]' : 'bg-gray-50/50'}`}>
          {messages.length === 0 && pendingImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className={`w-16 h-16 rounded-2xl ${isGold ? 'bg-gold/10 border border-gold/20' : 'bg-gray-100 border border-gray-200'} flex items-center justify-center mb-3`}>
                <Bot size={32} className={isGold ? 'text-gold' : 'text-gray-400'} />
              </div>
              <h3 className={`text-lg font-medium ${themeClasses.text} mb-2`}>开始对话</h3>
              <p className={`text-sm ${themeClasses.textMuted} mb-4`}>选择模型并发送消息开始聊天</p>
              <div className={`text-sm ${themeClasses.textMuted} space-y-1.5`}>
                <p className="flex items-center gap-1.5 justify-center"><Upload size={14} /> 上传或粘贴图片到对话框</p>
                <p className="flex items-center gap-1.5 justify-center"><ImageIcon size={14} /> AI自动分析并生成关键词</p>
              </div>
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
                            components={createMarkdownComponents(isGold, onAddImages ? (url: string) => onAddImages([url], undefined, { modelName: message.generateModelName, apiProvider: message.generateProviderId }) : undefined)}
                          >
                            {cleanAssistantContent(message.content)}
                          </ReactMarkdown>
                        : message.content}
                    </div>
                  </div>
                  {/* AI生成的图片 - ChatGPT风格：每张图独立卡片，垂直排列 */}
                  {message.generatedImages && message.generatedImages.length > 0 && (
                    <div className="flex flex-col gap-3 mt-3">
                      {message.generatedImages.map((imgUrl, imgIdx) => (
                        <div key={imgIdx} className={`rounded-xl overflow-hidden ${isGold ? 'bg-black/30 border border-gold/15' : 'bg-gray-50 border border-gray-200'}`}>
                          {/* 模型名称标签 */}
                          <div className={`px-3 py-1.5 flex items-center gap-2 ${isGold ? 'bg-gold/5 border-b border-gold/10' : 'bg-gray-100 border-b border-gray-200'}`}>
                            <div className={`w-4 h-4 rounded flex items-center justify-center ${isGold ? 'bg-gold/20' : 'bg-blue-100'}`}>
                              <Sparkles size={10} className={isGold ? 'text-gold' : 'text-blue-500'} />
                            </div>
                            <span className={`text-xs font-medium ${isGold ? 'text-gold/90' : 'text-gray-700'}`}>
                              {message.generateModelName || 'AI 生成'}
                            </span>
                            {message.generatedImages!.length > 1 && (
                              <span className={`text-[10px] ${isGold ? 'text-gold/60' : 'text-gray-500'}`}>
                                {imgIdx + 1} / {message.generatedImages!.length}
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
                              onClick={() => onAddImages?.([imgUrl], undefined, { modelName: message.generateModelName, apiProvider: message.generateProviderId })}
                              title="点击添加到画布"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            {/* 悬浮操作按钮 */}
                            <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover/chat-img:opacity-100 transition-opacity">
                              {onAddImages && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onAddImages([imgUrl], undefined, { modelName: message.generateModelName, apiProvider: message.generateProviderId }); }}
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
                      ))}
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
                    <button
                      onClick={() => copyToClipboard(message.content, message.id)}
                      className={`text-xs ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors flex items-center gap-0.5`}
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
                                // 从最近的用户消息中检测生成数量、比例和质量
                                const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                                const userText = lastUserMsg?.content || '';
                                const count = detectImageCountFromText(userText);
                                const ratio = detectAspectRatioFromText(userText) || '1:1';
                                const quality = detectQualityFromText(userText) || '1K';
                                onGenerateImage(sug.prompt, count, ratio, quality);
                              } else if (sug.action === 'send-to-prompt' && sug.prompt) {
                                // 作为聊天消息发送，而非发到图像生成面板
                                handleSend(sug.prompt);
                              } else if (sug.prompt) {
                                // 所有其他建议也作为聊天消息发送（Agent模式）
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
          {isLoading && (
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
                <span className={`text-sm ${themeClasses.textMuted}`}>思考中...</span>
              </div>
            </div>
          )}

          {/* Pending images preview - multi-image strip */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2.5 justify-end">
              <div className="max-w-[92%] order-2">
                <div className={`rounded-xl overflow-hidden relative ${isGold ? 'border border-white/[0.04]' : 'border border-gray-200'}`}>
                  {/* Image strip - horizontal scrollable */}
                  <div className="flex gap-1 p-1.5 overflow-x-auto" style={{ maxWidth: '100%' }}>
                    {pendingImages.map((img, idx) => (
                      <div key={img.id} className="relative shrink-0 group">
                        <img src={img.url} alt={img.name} className="max-h-40 max-w-[200px] object-contain rounded-lg" />
                        <button
                          onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X size={12} />
                        </button>
                        <div className={`absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-gradient-to-t from-black/70 to-transparent rounded-b-lg`}>
                          <span className="text-[9px] text-white/80 truncate block">{img.name.length > 12 ? img.name.slice(0, 12) + '...' : img.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Action bar */}
                  <div className="flex items-center gap-2 p-2 border-t border-white/5">
                    <span className={`text-[10px] ${isGold ? 'text-gold/60' : 'text-gray-400'}`}>{pendingImages.length}张图片</span>
                    <div className="flex-1" />
                    <Button
                      onClick={() => setPendingImages([])}
                      className={`h-7 px-2.5 text-[10px] font-medium rounded-md ${
                        isGold
                          ? 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      清空
                    </Button>
                    <Button
                      onClick={handleAnalyzeImage}
                      disabled={isAnalyzingImage}
                      className={`h-7 px-3 text-[10px] font-medium rounded-md ${
                        isGold
                          ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {isAnalyzingImage ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          分析中...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" />
                          生成关键词
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                isGold ? 'bg-gradient-to-br from-gold to-gold-dark text-black' : 'bg-blue-500 text-white'
              }`}>
                <User size={14} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input - 精致设计 */}
        <div className={`px-3 py-4 border-t ${themeClasses.border} shrink-0 ${isGold ? 'bg-[#0d0d0d]/90' : 'bg-white'}`}>
          {/* Image Context Strip - all images in one unified bar (Lovart-style multi-image) */}
          {pendingImages.length > 0 && (
            <div className={`mb-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs overflow-x-auto ${isGold ? 'bg-gold/10 border border-gold/20' : 'bg-blue-50 border border-blue-200'}`}>
              {/* All images (canvas + uploaded + @mentioned) */}
              {pendingImages.map((img, idx) => (
                <div
                  key={img.id}
                  className="flex items-center gap-1.5 shrink-0 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] rounded-md px-1.5 py-1 hover:bg-white/5"
                  onClick={() => onNavigateToImage?.(img.id)}
                  title="点击定位到画布图片"
                >
                  <div className="w-7 h-7 rounded overflow-hidden shrink-0 border border-white/10">
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 max-w-[70px]">
                    <div className={`font-medium truncate text-[10px] ${isGold ? 'text-gold' : 'text-blue-700'}`}>
                      {pendingImages.length === 1 ? '针对此图片' : (img.name.length > 6 ? img.name.slice(0, 6) + '..' : img.name)}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setPendingImages(prev => prev.filter((_, i) => i !== idx)); }} className="shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                    <X size={12} />
                  </button>
                </div>
              ))}
              {/* Add canvas image button */}
              {canvasImages.length > 0 && (
                <button
                  onClick={() => {
                    // Add selected canvas image
                    if (selectedCanvasImage && !pendingImages.find(p => p.id === selectedCanvasImage.id)) {
                      setPendingImages(prev => [...prev, { id: selectedCanvasImage.id, url: selectedCanvasImage.url, name: selectedCanvasImage.prompt?.slice(0, 20) || '画布图片' }]);
                    }
                  }}
                  className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors ${isGold ? 'text-gold/50 hover:text-gold hover:bg-gold/10' : 'text-blue-400 hover:text-blue-600 hover:bg-blue-100'}`}
                  title="从画布添加图片"
                >
                  <Plus size={12} />
                  <span>画布图片</span>
                </button>
              )}
            </div>
          )}

          {/* P2-1: Tune Mode Panel */}
          {showTunePanel && (
            <div className={`mb-1.5 p-2 rounded-lg text-xs space-y-2 ${isGold ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-200'}`}>
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

          {/* P1-1: Active Mentions Tags */}
          {activeMentions.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {activeMentions.map((m, i) => (
                m.type === 'canvas-image' ? (
                  /* Lovart-style image anchor with thumbnail */
                  <div
                    key={`${m.type}-${m.id}`}
                    className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] ${isGold ? 'bg-gold/15 text-gold border border-gold/30 hover:bg-gold/20' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}`}
                    onClick={() => onNavigateToImage?.(m.id!)}
                    title="点击定位到画布图片"
                  >
                    {m.imageUrl && (
                      <div className="w-5 h-5 rounded overflow-hidden shrink-0 border border-white/10">
                        <img src={m.imageUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <span className="truncate max-w-[80px]">{m.label}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeMention(i); }} className="opacity-50 hover:opacity-100">
                      <X size={10} />
                    </button>
                  </div>
                ) : (
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
                )
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
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                isGold
                  ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                  : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="上传图片"
            >
              <ImageIcon size={12} />
              <span>图片</span>
            </button>
            <button
              onClick={() => setShowTunePanel(prev => !prev)}
              className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                showTunePanel
                  ? isGold
                    ? 'bg-gold/15 text-gold'
                    : 'bg-blue-100 text-blue-600'
                  : isGold
                    ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                    : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="Tune 精细调节"
            >
              <Sliders size={12} />
              <span>Tune</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowQuickCommands(prev => !prev)}
                className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                  showQuickCommands
                    ? isGold
                      ? 'bg-gold/15 text-gold'
                      : 'bg-blue-100 text-blue-600'
                    : isGold
                      ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                      : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                title="快捷指令"
              >
                <Zap size={12} />
                <span>指令</span>
              </button>
              {showQuickCommands && (
                <div className={`absolute bottom-full left-0 mb-1 w-48 rounded-lg border shadow-lg z-50 overflow-hidden ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                  <div className={`px-3 py-1.5 text-[10px] font-medium ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                    快捷指令
                  </div>
                  {quickCommands.map((cmd, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInput(prev => prev + cmd.prompt);
                        setShowQuickCommands(false);
                        textareaRef.current?.focus();
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      <span>{cmd.icon}</span>
                      <span>{cmd.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 图像模型选择器 */}
            <div className="relative">
              <button
                onClick={() => setShowImageModelSelector(prev => !prev)}
                className={`shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] transition-colors ${
                  showImageModelSelector
                    ? isGold
                      ? 'bg-gold/15 text-gold'
                      : 'bg-blue-100 text-blue-600'
                    : isGold
                      ? 'bg-white/[0.04] text-gold-muted/70 hover:text-gold hover:bg-white/[0.08]'
                      : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                title="选择图像模型"
              >
                <ImageIcon size={12} />
                <span className="max-w-[80px] truncate">{discoveredImageModels.find(m => m.id === imageModel)?.name || getModelDisplayName(imageModel.split('::').pop() || imageModel)}</span>
              </button>
              {showImageModelSelector && (
                <div className={`absolute bottom-full right-0 mb-1 w-64 max-h-80 overflow-y-auto rounded-lg border shadow-lg z-50 ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                  <div className={`px-3 py-2 text-[10px] font-medium border-b ${isGold ? 'text-gold-muted/60 border-white/5' : 'text-gray-400 border-gray-100'}`}>
                    选择图像模型
                  </div>
                  {discoveredImageModels.length === 0 ? (
                    <div className={`px-3 py-4 text-xs text-center ${isGold ? 'text-white/40' : 'text-gray-400'}`}>
                      暂无可用模型
                    </div>
                  ) : (
                    discoveredImageModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setImageModel(m.id);
                          setImageModelProviderId(m.providerId);
                          // 同步到localStorage，与图像生成面板共享
                          const modelId = m.id.split('::').pop() || m.id;
                          localStorage.setItem('wujie_selected_model', JSON.stringify({ model: modelId, providerId: m.providerId }));
                          setShowImageModelSelector(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                          imageModel === m.id
                            ? isGold
                              ? 'bg-gold/10 text-gold'
                              : 'bg-blue-50 text-blue-600'
                            : isGold
                              ? 'text-white/80 hover:bg-white/5'
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <ImageIcon size={12} className="shrink-0 opacity-50" />
                        <div className="flex-1 min-w-0 text-left">
                          <div className="truncate">{m.name}</div>
                          {m.provider && <div className={`text-[10px] truncate ${isGold ? 'text-white/40' : 'text-gray-400'}`}>{m.provider}</div>}
                        </div>
                        {imageModel === m.id && <span className="text-gold">✓</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className={`shrink-0 h-7 px-3 rounded-md flex items-center gap-1.5 text-[11px] font-medium transition-all ${
                !input.trim() || isLoading
                  ? isGold
                    ? 'bg-white/[0.03] text-white/20 cursor-not-allowed'
                    : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                  : isGold
                    ? 'bg-gold text-black hover:opacity-90 shadow-md shadow-gold/20'
                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
              }`}
            >
              <Send size={12} />
              <span>发送</span>
              {isLoading && <Loader2 size={10} className="animate-spin ml-0.5" />}
            </button>
          </div>

          {/* Textarea Row - 输入框独立占满宽度 */}
          <div className={`relative rounded-xl overflow-visible ${isGold ? 'bg-white/[0.03] border border-white/[0.04] focus-within:border-gold/40 focus-within:shadow-gold/10' : 'bg-white border border-gray-200 focus-within:border-gray-400 focus-within:shadow-sm'} transition-all`}>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              placeholder={pendingImages.length > 0 ? `描述你想对这${pendingImages.length}张图片做什么...` : "输入消息，@ 引用图片/品牌，/ 使用模板..."}
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
                {mentionPickerItems.map((item, idx) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => selectMentionItem(item)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      idx === mentionPickerIndex
                        ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                        : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.type === 'canvas-image' && <ImageIcon size={12} className="shrink-0" />}
                    {item.type === 'brand' && <Palette size={12} className="shrink-0" />}
                    {item.type === 'prompt' && <Sparkles size={12} className="shrink-0" />}
                    <span className="truncate">{item.label}</span>
                    <span className={`ml-auto text-[10px] ${isGold ? 'text-white/30' : 'text-gray-300'}`}>
                      {item.type === 'canvas-image' ? '图片' : item.type === 'brand' ? '品牌' : '提示词'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {/* / Prompt Template Popup */}
            {templatePopupOpen && templatePopupItems.length > 0 && (
              <div className={`absolute bottom-full left-0 right-0 mb-1 rounded-lg border shadow-lg z-50 overflow-hidden ${isGold ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                <div className={`px-3 py-1.5 text-[10px] font-medium ${isGold ? 'text-gold-muted/60' : 'text-gray-400'}`}>
                  提示词模板 {templatePopupSearch && `· 搜索: "${templatePopupSearch}"`}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {templatePopupItems.map((template, idx) => (
                    <button
                      key={template.id}
                      onClick={() => selectPromptTemplate(template)}
                      className={`w-full flex items-start gap-2 px-3 py-2 text-xs transition-colors text-left ${
                        idx === templatePopupIndex
                          ? isGold ? 'bg-gold/10 text-gold' : 'bg-blue-50 text-blue-700'
                          : isGold ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <FileText size={12} className="shrink-0 mt-0.5" />
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
                        className={`rounded-lg p-2.5 transition-all cursor-pointer ${
                          isActive
                            ? isGold ? 'bg-gold/12 border border-gold/30' : 'bg-blue-50 border border-blue-200'
                            : isGold ? 'bg-white/[0.03] border border-white/[0.04] hover:border-white/[0.10]' : 'bg-white border border-gray-100 hover:border-gray-200'
                        }`}
                        onClick={() => {
                          if (isActive) { setActiveSkill(null); setSkillParamValues({}); }
                          else {
                            setActiveSkill(skill);
                            setSkillParamValues(skill.paramSlots.reduce((acc: Record<string, string>, slot: ChatSkill['paramSlots'][0]) => { acc[slot.name] = slot.defaultValue || ''; return acc; }, {} as Record<string, string>));
                          }
                        }}
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
                            {skill.paramSlots.length > 0 && (
                              <span className={`text-[9px] ${themeClasses.textMuted}`}>
                                {skill.paramSlots.length} 个参数
                              </span>
                            )}
                          </div>
                        </div>
                        <Zap size={12} className={`shrink-0 mt-1 ${isActive ? (isGold ? 'text-gold' : 'text-blue-500') : (isGold ? 'text-gold-muted/30' : 'text-gray-300')}`} />
                      </div>
                      {/* 参数填写面板 */}
                      {isActive && skill.paramSlots.length > 0 && (
                        <div className={`mt-2 pt-2 border-t ${isGold ? 'border-white/[0.06]' : 'border-gray-100'}`}>
                          <div className="space-y-1.5">
                            {skill.paramSlots.map(slot => (
                              <div key={slot.name}>
                                <label className={`text-[10px] font-medium ${themeClasses.textMuted}`}>{slot.label}</label>
                                <input
                                  value={skillParamValues[slot.name] || ''}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkillParamValues(prev => ({...prev, [slot.name]: e.target.value}))}
                                  placeholder={slot.placeholder}
                                  className={`w-full px-2 py-1 rounded text-[11px] mt-0.5 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/30' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
                                />
                              </div>
                            ))}
                          </div>
                          <Button
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUseSkill(skill); }}
                            className={`w-full h-7 mt-2 text-xs font-medium rounded-md ${
                              isGold ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90' : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                          >
                            <ArrowRight size={12} className="mr-1" />
                            使用 Skill 开始对话
                          </Button>
                        </div>
                      )}
                      {isActive && skill.paramSlots.length === 0 && (
                        <div className={`mt-2 pt-2 border-t ${isGold ? 'border-white/[0.06]' : 'border-gray-100'}`}>
                          <Button
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUseSkill(skill); }}
                            className={`w-full h-7 text-xs font-medium rounded-md ${
                              isGold ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90' : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                          >
                            <ArrowRight size={12} className="mr-1" />
                            使用 Skill 开始对话
                          </Button>
                        </div>
                      )}
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
                          onClick={() => {
                            if (activeSkill?.id === skill.id) {
                              setActiveSkill(null);
                              setSkillParamValues({});
                            } else {
                              setActiveSkill(skill);
                              setSkillParamValues(
                                skill.paramSlots.reduce((acc, slot) => {
                                  acc[slot.name] = slot.defaultValue || '';
                                  return acc;
                                }, {} as Record<string, string>)
                              );
                            }
                          }}
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
                    {/* 参数填写面板 */}
                    {activeSkill?.id === skill.id && skill.paramSlots.length > 0 && (
                      <div className={`mt-2 pt-2 border-t ${isGold ? 'border-white/[0.06]' : 'border-gray-100'}`}>
                        <div className="space-y-1.5">
                          {skill.paramSlots.map(slot => (
                            <div key={slot.name}>
                              <label className={`text-[10px] font-medium ${themeClasses.textMuted}`}>{slot.label}</label>
                              <input
                                value={skillParamValues[slot.name] || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkillParamValues(prev => ({...prev, [slot.name]: e.target.value}))}
                                placeholder={slot.placeholder}
                                className={`w-full px-2 py-1 rounded text-[11px] mt-0.5 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/30' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          onClick={() => handleUseSkill(skill)}
                          className={`w-full h-7 mt-2 text-xs font-medium rounded-md ${
                            isGold ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90' : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          <ArrowRight size={12} className="mr-1" />
                          使用 Skill 开始对话
                        </Button>
                      </div>
                    )}
                    {activeSkill?.id === skill.id && skill.paramSlots.length === 0 && (
                      <div className={`mt-2 pt-2 border-t ${isGold ? 'border-white/[0.06]' : 'border-gray-100'}`}>
                        <Button
                          onClick={() => handleUseSkill(skill)}
                          className={`w-full h-7 text-xs font-medium rounded-md ${
                            isGold ? 'bg-gradient-to-r from-gold to-gold-dark text-black hover:opacity-90' : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          <ArrowRight size={12} className="mr-1" />
                          使用 Skill 开始对话
                        </Button>
                      </div>
                    )}
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
