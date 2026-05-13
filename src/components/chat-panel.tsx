'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Copy, Check, Trash2, Loader2, Eye, EyeOff, Wand2, User, Upload, X, Image as ImageIcon, Languages, Settings, Plug, Plus, History, FolderOpen, MessageSquare } from 'lucide-react';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imageUrl?: string;
  generatedImages?: string[]; // AI生成的图片URL列表
  isGeneratingImage?: boolean; // 是否正在生成图片
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
  onAddImages?: (imageUrls: string[]) => void;
  canvasImages?: CanvasImage[];
  onChatModelChange?: (info: { model: string; providerId: string; apiKey: string; baseUrl: string; providerPreset?: string } | null) => void;
}

// Helper: check if a URL looks like an image URL
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
          isGold ? 'bg-black/30 text-yellow-300' : 'bg-gray-100 text-gray-700'
        }`} {...props}>{children}</code>
      );
    },
    // Pre element - since we handle code blocks in the code component, 
    // we just pass through to avoid double wrapping
    pre: ({ children }) => <>{children}</>,
    // Links
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`underline ${
        isGold ? 'text-[#d4af37]' : 'text-blue-500'
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
      isGold ? 'border-[#d4af37]' : 'border-gray-300'
    }`}>{children}</blockquote>,
    // Table
    table: ({ children }) => <table className="border-collapse my-1.5 text-sm">{children}</table>,
    th: ({ children }) => <th className={`border px-2 py-1 ${isGold ? 'border-[#333]' : 'border-gray-300'}`}>{children}</th>,
    td: ({ children }) => <td className={`border px-2 py-1 ${isGold ? 'border-[#333]' : 'border-gray-300'}`}>{children}</td>,
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
  if (/竖版|纵向|portrait|vertical|9:?16/.test(lower)) return '9:16';
  if (/横版|横向|landscape|horizontal|16:?9/.test(lower)) return '16:9';
  if (/方形|正方|square|1:?1/.test(lower)) return '1:1';
  if (/4:?3/.test(lower)) return '4:3';
  if (/3:?4/.test(lower)) return '3:4';
  return undefined;
}

// Read the current image generation model from localStorage
function getCurrentGenerationModel(): string {
  try {
    if (typeof window === 'undefined') return 'gemini-2.5-flash-image-preview';
    const currentUserId = localStorage.getItem('unbounded_ai_current_user');
    const raw = localStorage.getItem('unbounded_ai_user_data');
    if (!raw || !currentUserId) return 'gemini-2.5-flash-image-preview';
    const data = JSON.parse(raw);
    const selectedModel = data?.userData?.[currentUserId]?.selectedModel;
    if (selectedModel) return selectedModel;
  } catch { /* fallback */ }
  return 'gemini-2.5-flash-image-preview';
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
  const patterns = [
    /生成.*图/, /画.*图/, /制作.*图/, /创建.*图/, /设计.*图/,
    /给我.*图/, /出.*图/, /做.*图/, /绘制/,
    /generate.*image/, /create.*image/, /draw.*image/, /make.*image/,
    /generate.*picture/, /create.*picture/, /draw.*picture/, /make.*picture/,
    /generate.*photo/, /create.*photo/, /make.*photo/,
    /海报/, /poster/, /插图/, /illustration/, /封面/, /cover/,
    /logo/i, /icon/i, /banner/i, /壁纸/, /wallpaper/,
    /插画/, /原画/, /concept\s*art/i, /角色.*设计/, /character.*design/i,
    /头像/, /avatar/i, /表情/, /emoji/i, /贴纸/, /sticker/i,
    /生图/, /画一个/, /画一张/, /来一张/, /来一个/,
  ];
  return patterns.some(p => p.test(lower));
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
      ? 'bg-[#111] border-[#333] text-white placeholder:text-[#555] focus:border-[#d4af37]/50'
      : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400'
  } outline-none`;

  const labelClass = `text-xs font-medium ${isGold ? 'text-[#999]' : 'text-gray-500'}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={`relative w-[340px] max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col ${
          isGold ? 'bg-[#1a1a1a] border border-[#333]' : 'bg-white border border-gray-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isGold ? 'border-[#333]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#d4af37] to-[#f0c040] flex items-center justify-center">
              <Bot size={12} className="text-black" />
            </div>
            <span className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>
              {editingAgent ? '编辑智能体' : '新建智能体'}
            </span>
          </div>
          <button onClick={onClose} className={`p-1 rounded-md transition-colors ${isGold ? 'hover:bg-[#333] text-[#888]' : 'hover:bg-gray-100 text-gray-400'}`}>
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
                  isGold ? 'bg-[#111] border-[#333] hover:border-[#555]' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                }`}>
                  {icon}
                </div>
                <div className="absolute top-full left-0 mt-1 p-1.5 grid grid-cols-8 gap-0.5 rounded-lg shadow-xl z-50 hidden group-hover:grid bg-[#222] border border-[#333]">
                  {EMOJI_OPTIONS.map(e => (
                    <button key={e} onClick={() => setIcon(e)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#333] text-sm">{e}</button>
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
        <div className={`flex items-center gap-2 px-4 py-3 border-t ${isGold ? 'border-[#333]' : 'border-gray-100'}`}>
          <button
            onClick={onClose}
            className={`flex-1 h-8 text-xs rounded-lg transition-colors ${
              isGold ? 'bg-[#222] text-[#999] hover:bg-[#333]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !nameEn.trim()}
            className="flex-1 h-8 text-xs rounded-lg bg-gradient-to-r from-[#d4af37] to-[#f0c040] text-black font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editingAgent ? '保存修改' : '创建智能体'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ themeStyle, onAddToPrompt, onAddImages, canvasImages = [], onChatModelChange }: ChatPanelProps) {
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
      // Built-in model (uses apimart)
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showChatSettings, setShowChatSettings] = useState(true);
  // 提示词大师相关状态
  const [activeTab, setActiveTab] = useState<'chat' | 'optimizer'>('chat');
  const [optimizerInput, setOptimizerInput] = useState('');
  const [optimizerOutputEn, setOptimizerOutputEn] = useState('');
  const [optimizerOutputCn, setOptimizerOutputCn] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerHistory, setOptimizerHistory] = useState<{input: string; outputEn: string; outputCn: string; mode: string; time: number}[]>([]);
  const [optimizerMode, setOptimizerMode] = useState<'enhance' | 'expand' | 'simplify'>('enhance');
  const [hoveredMode, setHoveredMode] = useState<'enhance' | 'expand' | 'simplify' | null>(null);
  const [selectedOutputLang, setSelectedOutputLang] = useState<'en' | 'cn'>('en');
  // 图片上传相关状态
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  // 第三方模型相关状态
  const [showThirdPartyDialog, setShowThirdPartyDialog] = useState(false);
  const [thirdPartyChatModels, setThirdPartyChatModels] = useState<{id: string; name: string; provider: string; providerId: string}[]>([]);
  // 服务器端发现的模型
  const [discoveredChatModels, setDiscoveredChatModels] = useState<{id: string; name: string; provider: string; providerId: string; description?: string; isDefault?: boolean}[]>([]);
  // 对话管理相关状态
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  // 自定义智能体相关状态
  const [customAgents, setCustomAgents] = useState<typeof AGENTS>([]);
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [editingAgent, setEditingAgent] = useState<typeof AGENTS[0] | null>(null);

  // 合并内置+自定义智能体
  const allAgents = [...AGENTS, ...customAgents];

  // 加载自定义智能体
  useEffect(() => {
    try {
      const stored = localStorage.getItem('custom-agents');
      if (stored) setCustomAgents(JSON.parse(stored));
    } catch {}
  }, []);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

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
                name: getModelDisplayName(m.name || m.id),
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
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadServerModels]);

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
            setPendingImage(dataUrl);
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [activeTab]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPendingImage(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAnalyzeImage = useCallback(async () => {
    if (!pendingImage || isAnalyzingImage) return;
    setIsAnalyzingImage(true);

    try {
      const requestMessages = [
        {
          role: 'system',
          content: '你是一个专业的AI图像分析专家。用户会给你一张图片，请详细分析图片内容并生成适合AI图像生成的关键词描述。请分别输出英文和中文两个版本，格式如下：\n\n【English】\n英文关键词描述\n\n【中文】\n中文关键词描述'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请分析这张图片，生成AI图像生成用的关键词描述。' },
            { type: 'image_url', image_url: { url: pendingImage, detail: 'high' } }
          ]
        }
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
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
        content: '请分析这张图片并生成关键词',
        timestamp: Date.now(),
        imageUrl: pendingImage,
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

      setPendingImage(null);
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
  }, [pendingImage, isAnalyzingImage, model, messages, systemPrompt, saveSession]);

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

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      let selectedModel = isThinkingMode 
        ? (model.includes('thinking') ? model : `${model}-thinking`)
        : model;

      const isThirdParty = selectedModel.includes('::');
      const providerId = isThirdParty ? selectedModel.split('::')[0] : undefined;
      const actualModel = isThirdParty ? selectedModel.split('::').slice(1).join('::') : selectedModel;

      const systemPromptObj = allAgents.find(p => p.id === systemPrompt);
      const requestMessages = [];
      
      if (systemPromptObj) {
        requestMessages.push({
          role: 'system',
          content: systemPromptObj.prompt
        });
      }

      messages.forEach(msg => {
        if (msg.imageUrl) {
          requestMessages.push({
            role: msg.role,
            content: [
              { type: 'text', text: msg.content },
              { type: 'image_url', image_url: { url: msg.imageUrl } }
            ]
          });
        } else {
          requestMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      });

      requestMessages.push({
        role: 'user',
        content: input.trim()
      });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
      let assistantMessageId = `assistant-${Date.now()}`;
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

          const chunk = decoder.decode(value);
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
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, content: assistantContent }
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

      // After streaming completes, check if user intended to generate an image
      // Use user's original message + optimize-prompt API to get a proper English prompt
      const userText = input.trim();
      if (isImageGenerationIntent(userText)) {
        // Mark as generating
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, isGeneratingImage: true }
            : msg
        ));

        try {
          // Step 1: Optimize the user's prompt to English
          let optimizedPrompt = userText;
          console.log('[ChatImage] Starting image generation for:', userText);
          try {
            const optRes = await fetch('/api/optimize-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: userText,
                model: model,
      
                mode: 'enhance',
              }),
            });
            if (optRes.ok) {
              const optData = await optRes.json();
              console.log('[ChatImage] Optimize response:', JSON.stringify(optData).substring(0, 200));
              if (optData.optimized) {
                // 清理思考过程，只保留优化后的关键词
                let cleaned = optData.optimized.trim();
                cleaned = cleaned
                  .replace(/<think[\s\S]*?<\/think>/gi, '')
                  .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
                  .replace(/【中文】[\s\S]*$/i, '')
                  .replace(/【English】\s*/i, '')
                  .trim();
                optimizedPrompt = cleaned;
                console.log('[ChatImage] Optimized prompt:', optimizedPrompt.substring(0, 100) + '...');
              }
            }
          } catch (optErr) {
            console.error('Prompt optimization failed, using original:', optErr);
          }

          // Step 2: Detect aspect ratio from user's message
          const aspectRatio = detectAspectRatioFromText(userText) || '1:1';

          // Step 3: Generate image with the optimized prompt
          const generateRes = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: optimizedPrompt,
              model: getCurrentGenerationModel(),
              aspectRatio,
              quality: '1K',
    
            }),
          });

          const generateData = await generateRes.json();
          console.log('[ChatImage] Generate API response:', JSON.stringify(generateData));
          
          if (!generateData.success) {
            console.error('[ChatImage] Generate API failed:', generateData.error);
          } else if (generateData.taskIds && generateData.taskIds.length > 0) {
            // 使用服务端实际使用的模型（可能因自动切换而与请求模型不同）
            const actualModel = generateData.model || getCurrentGenerationModel();
            // Poll for each task
            for (const taskId of generateData.taskIds) {
              const maxPolls = 60;
              let gotImage = false;
              for (let i = 0; i < maxPolls; i++) {
                const interval = i <= 2 ? 800 : i <= 5 ? 1000 : i <= 15 ? 1500 : 2000;
                await new Promise(r => setTimeout(r, interval));
                
                const pollRes = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, model: actualModel }),
                });
                const pollData = await pollRes.json();
                
                if (pollData.status === 'completed' && pollData.imageUrl) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { 
                          ...msg, 
                          generatedImages: [...(msg.generatedImages || []), pollData.imageUrl],
                        }
                      : msg
                  ));
                  gotImage = true;
                  break;
                } else if (pollData.status === 'failed') {
                  console.error('Image generation failed:', pollData.error);
                  break;
                }
              }
              if (!gotImage) {
                // If no image after polling, just clear loading
              }
            }
          } else if (generateData.imageUrl) {
            // Direct image URL returned
            setMessages(prev => prev.map(msg => 
              msg.id === assistantMessageId 
                ? { 
                    ...msg, 
                    generatedImages: [...(msg.generatedImages || []), generateData.imageUrl],
                    isGeneratingImage: false,
                  }
                : msg
            ));
          }
        } catch (imgError) {
          console.error('[ChatImage] Auto image generation error:', imgError);
        } finally {
          // Ensure loading state is cleared
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, isGeneratingImage: false }
              : msg
          ));
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
    }
  }, [input, isLoading, messages, model, systemPrompt, isThinkingMode, saveSession]);

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
      
      // 解析中英文 - 增强版
      let enPart = '';
      let cnPart = '';
      const enMatch = result.match(/【English】\s*([\s\S]*?)(?=【中文】|$)/);
      const cnMatch = result.match(/【中文】\s*([\s\S]*?)$/);
      if (enMatch) enPart = enMatch[1].trim();
      if (cnMatch) cnPart = cnMatch[1].trim();
      
      // 如果没有找到中文部分，尝试其他格式
      if (!cnPart && enPart) {
        // 可能模型用了其他格式输出中文
        const altCnMatch = result.match(/[Cc]hinese[：:]\s*([\s\S]*?)$/);
        if (altCnMatch) cnPart = altCnMatch[1].trim();
      }
      
      if (!enPart && !cnPart) {
        // 如果完全没解析出标记，整段作为英文
        enPart = result;
        cnPart = '';
      } else if (enPart && !cnPart) {
        // 有英文但没中文 - cnPart留空，让UI提示用户
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
        bg: 'bg-gradient-to-br from-[#0a0a0a] to-[#111]',
        border: 'border-[#2a2a2a]',
        text: 'text-white',
        textMuted: 'text-[#888]',
        accent: 'from-[#d4af37] to-[#b8860b]',
        inputBg: 'bg-[#141414]',
        cardBg: 'bg-[#0f0f0f]',
      }
    : {
        bg: 'bg-white',
        border: 'border-gray-200',
        text: 'text-gray-900',
        textMuted: 'text-gray-500',
        accent: 'from-gray-800 to-gray-600',
        inputBg: 'bg-white',
        cardBg: 'bg-gray-50',
      };

  const isGold = themeStyle === 'gold';

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`} ref={chatContainerRef}>
      {/* Header with Tabs - 精致标签设计 */}
      <div className={`shrink-0`}>
        <div className="px-4 pt-3 flex items-center justify-between">
          <div className={`relative flex items-center ${isGold ? 'bg-[#141414] p-0.5 rounded-lg' : 'bg-gray-100 p-0.5 rounded-lg'}`}>
            <button
              onClick={() => setActiveTab('chat')}
              className={`relative z-10 px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'chat'
                  ? isGold
                    ? 'bg-[#d4af37]/15 text-[#d4af37] shadow-sm'
                    : 'bg-white text-gray-900 shadow-sm'
                  : isGold
                    ? 'text-[#666] hover:text-[#999]'
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
                    ? 'bg-[#d4af37]/15 text-[#d4af37] shadow-sm'
                    : 'bg-white text-gray-900 shadow-sm'
                  : isGold
                    ? 'text-[#666] hover:text-[#999]'
                    : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Wand2 size={13} />
              提示词大师
            </button>
          </div>
          {activeTab === 'chat' && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleNewChat}
                className={`p-1.5 rounded-md transition-colors ${
                  isGold ? 'text-[#888] hover:text-[#d4af37] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="新建对话"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => { setShowHistoryPanel(!showHistoryPanel); setShowFilePanel(false); }}
                className={`p-2 rounded-lg transition-colors ${
                  showHistoryPanel
                    ? isGold ? 'text-[#d4af37] bg-[#d4af37]/10' : 'text-gray-900 bg-gray-100'
                    : isGold ? 'text-[#888] hover:text-[#d4af37] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="历史对话"
              >
                <History size={14} />
              </button>
              <button
                onClick={() => { setShowFilePanel(!showFilePanel); setShowHistoryPanel(false); }}
                className={`p-2 rounded-lg transition-colors ${
                  showFilePanel
                    ? isGold ? 'text-[#d4af37] bg-[#d4af37]/10' : 'text-gray-900 bg-gray-100'
                    : isGold ? 'text-[#888] hover:text-[#d4af37] hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                }`}
                title="文件列表"
              >
                <FolderOpen size={14} />
              </button>
              <button
                onClick={clearChat}
                className={`p-2 rounded-lg transition-colors ${
                  isGold ? 'text-[#888] hover:text-red-400 hover:bg-red-400/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
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
                <span className={`text-xs font-medium ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>历史对话</span>
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
                          ? isGold ? 'bg-[#d4af37]/10 border border-[#d4af37]/20' : 'bg-blue-50 border border-blue-200'
                          : isGold ? 'hover:bg-[#1a1a1a] border border-transparent' : 'hover:bg-white border border-transparent'
                      }`}
                    >
                      <MessageSquare size={12} className={session.id === currentSessionId ? (isGold ? 'text-[#d4af37]' : 'text-blue-500') : themeClasses.textMuted} />
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
                          isGold ? 'hover:text-red-400 text-[#666]' : 'hover:text-red-500 text-gray-400'
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
                <span className={`text-xs font-medium ${isGold ? 'text-[#999]' : 'text-gray-500'}`}>已生成的图片</span>
                <span className={`text-xs ${themeClasses.textMuted}`}>{canvasImages.length} 张图片</span>
              </div>
              {canvasImages.length === 0 ? (
                <div className={`text-xs text-center py-4 ${themeClasses.textMuted}`}>暂无生成图片</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {canvasImages.map(img => (
                    <div
                      key={img.id}
                      className={`aspect-square rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 ${
                        isGold ? 'border-[#2a2a2a] hover:border-[#d4af37]/40' : 'border-gray-200 hover:border-gray-400'
                      }`}
                      onClick={() => {
                        if (onAddToPrompt && img.prompt) {
                          onAddToPrompt(img.prompt);
                        }
                      }}
                      title={img.prompt || '点击发送提示词到生图'}
                    >
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
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
                <SelectContent className={themeClasses.bg}>
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
                    ? 'border-[#d4af37]/30 hover:border-[#d4af37]/60 hover:bg-[#d4af37]/10 text-[#d4af37]/70 hover:text-[#d4af37]'
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
                  <Sparkles size={10} className={isThinkingMode ? (isGold ? 'text-[#d4af37]' : 'text-gray-700') : (isGold ? 'text-[#555]' : 'text-gray-400')} />
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
                      : `border-transparent ${isGold ? 'hover:bg-[#1a1a1a]' : 'hover:bg-[#f0f0f0]'}`
                  } ${isGold ? 'bg-[#0d0d0d]' : 'bg-[#fafafa]'}`}
                  style={{
                    '--agent-color': agent.color,
                    '--agent-color-20': agent.color + '33',
                  } as React.CSSProperties}
                >
                  <span className="text-xs shrink-0">{agent.icon}</span>
                  <span className={`text-xs font-medium leading-tight truncate w-full text-center mt-0.5 ${
                    systemPrompt === agent.id 
                      ? (isGold ? 'text-[#d4af37]' : 'text-gray-900') 
                      : (isGold ? 'text-[#888]' : 'text-[#555]')
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
                  isGold ? 'border-[#2a2a2a] hover:border-[#d4af37]/40 hover:bg-[#1a1a1a]' : 'border-gray-200 hover:border-gray-400 hover:bg-[#f0f0f0]'
                }`}
              >
                <Plus size={11} className={isGold ? 'text-[#d4af37]/50' : 'text-gray-400'} />
                <span className={`text-xs font-medium mt-0.5 ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>新增</span>
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
                    <span className={`text-xs font-medium ${isGold ? 'text-[#d4af37]' : 'text-gray-900'}`}>{selectedAgent.name}</span>
                    <span className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'} ml-1`}>{selectedAgent.nameEn}</span>
                  </div>
                  {isCustom && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingAgent(selectedAgent); setShowAgentBuilder(true); }}
                        className={`p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-[#888]' : 'hover:bg-gray-200 text-gray-500'}`}
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
                        className={`p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-[#888]' : 'hover:bg-gray-200 text-gray-500'}`}
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
          {messages.length === 0 && !pendingImage ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className={`w-16 h-16 rounded-2xl ${isGold ? 'bg-[#d4af37]/10 border border-[#d4af37]/20' : 'bg-gray-100 border border-gray-200'} flex items-center justify-center mb-3`}>
                <Bot size={32} className={isGold ? 'text-[#d4af37]' : 'text-gray-400'} />
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
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <Bot size={14} />
                  </div>
                )}
                <div className={`max-w-[82%] ${message.role === 'user' ? 'order-2' : ''}`}>
                  {message.imageUrl && (
                    <div className={`rounded-xl overflow-hidden mb-0.5 ${isGold ? 'border border-[#2a2a2a]' : 'border border-gray-200'}`}>
                      <img src={message.imageUrl} alt="上传的图片" className="max-w-full max-h-40 object-contain" />
                    </div>
                  )}
                  {/* AI生成的图片 */}
                  {message.generatedImages && message.generatedImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-1">
                      {message.generatedImages.map((imgUrl, imgIdx) => (
                        <div key={imgIdx} className="relative group/chat-img inline-block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgUrl}
                            alt={`AI生成图片${imgIdx + 1}`}
                            className="max-w-full rounded-lg border cursor-pointer hover:opacity-90 transition-opacity"
                            style={{ maxHeight: '200px' }}
                            onClick={() => onAddImages?.([imgUrl])}
                            title="点击添加到画布"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          {onAddImages && (
                            <button
                              onClick={() => onAddImages([imgUrl])}
                              className="absolute bottom-1.5 right-1.5 opacity-0 group-hover/chat-img:opacity-100 transition-opacity bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
                            >
                              <Plus size={12} /> 画布
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 正在生成图片的加载状态 */}
                  {message.isGeneratingImage && (
                    <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" />
                      <span>正在生成图片...</span>
                    </div>
                  )}
                  <div className={`rounded-xl px-3 py-2 ${
                    message.role === 'user'
                      ? isGold
                        ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black'
                        : 'bg-gray-900 text-white'
                      : isGold
                        ? 'bg-[#1a1a1a] text-[#e0e0e0] border border-[#2a2a2a]'
                        : 'bg-white text-gray-800 border border-gray-200'
                  }`}>
                    <div className="text-xs leading-relaxed">
                      {message.role === 'assistant'
                        ? <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={createMarkdownComponents(isGold, onAddImages ? (url: string) => onAddImages([url]) : undefined)}
                          >
                            {cleanAssistantContent(message.content)}
                          </ReactMarkdown>
                        : message.content}
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 mt-0.5 px-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <button
                      onClick={() => copyToClipboard(message.content, message.id)}
                      className={`text-xs ${themeClasses.textMuted} hover:${themeClasses.text} transition-colors flex items-center gap-0.5`}
                    >
                      {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === message.id ? '已复制' : '复制'}
                    </button>
                    {message.role === 'assistant' && onAddToPrompt && (
                      <button
                        onClick={() => handleAddMessageToGeneration(message.content)}
                        className={`text-xs flex items-center gap-1 transition-colors ${
                          isGold ? 'text-[#d4af37]/70 hover:text-[#d4af37]' : 'text-blue-400 hover:text-blue-600'
                        }`}
                      >
                        <Send size={12} />
                        发送到生图
                      </button>
                    )}
                  </div>
                </div>
                {message.role === 'user' && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isGold ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b] text-black' : 'bg-blue-500 text-white'
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
                isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-gray-100 text-gray-600'
              }`}>
                <Bot size={14} />
              </div>
              <div className={`rounded-xl px-3 py-2 flex items-center gap-2 ${
                isGold ? 'bg-[#1a1a1a] border border-[#2a2a2a]' : 'bg-white border border-gray-200'
              }`}>
                <Loader2 className={`h-5 w-5 animate-spin ${isGold ? 'text-[#d4af37]' : 'text-blue-500'}`} />
                <span className={`text-sm ${themeClasses.textMuted}`}>思考中...</span>
              </div>
            </div>
          )}

          {/* Pending image preview */}
          {pendingImage && (
            <div className="flex gap-2.5 justify-end">
              <div className="max-w-[82%] order-2">
                <div className={`rounded-xl overflow-hidden relative ${isGold ? 'border border-[#2a2a2a]' : 'border border-gray-200'}`}>
                  <img src={pendingImage} alt="待分析的图片" className="max-w-full max-h-40 object-contain" />
                  <button
                    onClick={() => setPendingImage(null)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    <X size={14} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                    <Button
                      onClick={handleAnalyzeImage}
                      disabled={isAnalyzingImage}
                      className={`w-full h-9 text-sm font-medium rounded-lg ${
                        isGold
                          ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:opacity-90'
                          : 'bg-gray-900 text-white hover:bg-gray-800'
                      }`}
                    >
                      {isAnalyzingImage ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin mr-1.5" />
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
                isGold ? 'bg-gradient-to-br from-[#d4af37] to-[#b8860b] text-black' : 'bg-blue-500 text-white'
              }`}>
                <User size={14} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input - 精致设计 */}
        <div className={`px-3 py-2 border-t ${themeClasses.border} shrink-0 ${isGold ? 'bg-[#0a0a0a]' : 'bg-white'}`}>
          <div className="flex gap-1.5 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                isGold
                  ? 'bg-[#141414] border border-[#2a2a2a] text-[#888] hover:text-[#d4af37] hover:border-[#d4af37]/40'
                  : 'bg-gray-100 border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300'
              }`}
              title="上传图片"
            >
              <ImageIcon size={14} />
            </button>
            <div className={`flex-1 relative rounded-lg overflow-hidden ${isGold ? 'bg-[#141414] border border-[#2a2a2a] focus-within:border-[#d4af37]/40' : 'bg-white border border-gray-200 focus-within:border-gray-400'} transition-colors`}>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                placeholder="输入消息... (Ctrl+V 粘贴图片)"
                className={`w-full resize-none min-h-[32px] max-h-[120px] border-0 bg-transparent px-3 py-1.5 text-xs focus:outline-none focus:ring-0 ${themeClasses.text} placeholder:${isGold ? 'text-[#555]' : 'text-gray-400'}`}
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isLoading}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                !input.trim() || isLoading
                  ? isGold
                    ? 'bg-[#141414] border border-[#2a2a2a] text-[#444] cursor-not-allowed'
                    : 'bg-gray-100 border border-gray-200 text-gray-300 cursor-not-allowed'
                  : isGold
                    ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:opacity-90 shadow-lg shadow-[#d4af37]/20'
                    : 'bg-gray-900 text-white hover:bg-gray-800 shadow-md'
              }`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
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
              <div className={`w-1.5 h-1.5 rounded-full ${discoveredChatModels.length > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
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
                          ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/40'
                          : 'bg-gray-900 text-white border border-gray-700'
                        : isGold
                          ? 'bg-[#141414] text-[#666] border border-[#222] hover:text-[#999] hover:border-[#333]'
                          : 'bg-gray-50 text-gray-500 border border-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span className="text-xs" style={{ color: optimizerMode === m.value || hoveredMode === m.value ? m.color : m.color + '60' }}>{m.icon}</span>
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
              {hoveredMode && (
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#1a1a1a]/80 text-xs text-[#999]">
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
                  ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:opacity-90 shadow-md shadow-[#d4af37]/15'
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
              <div className={`rounded-lg ${isGold ? 'bg-[#d4af37]/8 border border-[#d4af37]/20' : 'bg-gray-50 border border-gray-200'}`}>
                {/* 语言切换行 */}
                <div className="px-3 pt-3 pb-2 flex items-center gap-1">
                  <button
                    onClick={() => setSelectedOutputLang('en')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      selectedOutputLang === 'en'
                        ? isGold
                          ? 'bg-[#d4af37] text-black'
                          : 'bg-gray-900 text-white'
                        : isGold
                          ? 'bg-[#141414] text-[#666] border border-[#222] hover:text-[#999]'
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
                          ? 'bg-[#d4af37] text-black'
                          : 'bg-gray-900 text-white'
                        : isGold
                          ? 'bg-[#141414] text-[#666] border border-[#222] hover:text-[#999]'
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
                      isGold ? 'text-[#d4af37]/70 hover:text-[#d4af37]' : 'text-blue-400 hover:text-blue-600'
                    }`}
                    title="发送到生图"
                  >
                    <Wand2 size={11} />
                  </button>
                </div>

                {/* 结果展示区 */}
                <div className="px-3 pb-3">
                  <div className={`p-3 rounded text-xs leading-relaxed whitespace-pre-wrap ${isGold ? 'bg-[#0a0a0a]' : 'bg-white'} ${themeClasses.text}`}>
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
                        ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black hover:opacity-90'
                        : 'bg-gray-900 text-white hover:bg-gray-800'
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
                        ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#d4af37]/40 hover:bg-[#222]'
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
                      className={`p-2 rounded-lg ${isGold ? 'bg-[#141414] border border-[#222]' : 'bg-gray-50 border border-gray-100'} cursor-pointer hover:opacity-80 transition-opacity`}
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
            localStorage.setItem('custom-agents', JSON.stringify(updated));
            return updated;
          });
        }}
      />
    </div>
  );
}
