'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Send, Square, Sparkles, Copy, Check, Trash2, Loader2, Eye, EyeOff, Wand2, User, Upload, X, Image as ImageIcon, Languages, Settings, Plug, Plus, History, FolderOpen, MessageSquare, Bookmark, BookmarkCheck, Lightbulb, Zap, ArrowRight, Palette, Target, Sliders, Download, AlertCircle, LocateFixed, RotateCcw, FileText, Cpu, ChevronRight, AtSign, ThumbsUp, ThumbsDown } from 'lucide-react';
import { AgentBuilderDialog, type AgentDefinition, type AgentRecipe } from '@/components/chat/AgentBuilderDialog';
import { toast } from 'sonner';
import { extractTaskResultImageUrl } from '@/lib/task-result-url';
import { normalizeGenerationSubmitSlots } from '@/lib/task-core/generation-batch';
import { withClientImageOutputPreference } from '@/lib/image-generation-output-preference';
import { CHAT_TASK_MAX_ATTEMPTS, getChatTaskPollIntervalMs } from '@/lib/chat-task-polling';
import { collectChatGenerationSlotResults, getResumableChatGenerationTasks, mergeChatSessionMessages, mergeRecoveredChatTasks, mergeRecoveredImages, settleChatGenerationSlots, updateChatSessionMessage, upsertChatGenerationSlotImage, type ChatPendingGenerationTask, type RecoverableChatCloudTask } from '@/lib/chat-pending-generation';
import { normalizePersistedChatSessions } from '@/lib/chat-session-persistence';
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
import { readPersistedImageModelSelection, selectInitialModel } from '@/lib/model-defaults';
import { getPromptTemplates, searchTemplates, type PromptTemplate } from '@/lib/prompt-templates';
import { classifyIntent, ClassifiedIntent, IntentCategory } from '@/lib/intent-classifier';
import { generateClarificationMessage, detectVagueScenarios, type ClarificationTemplate, type VagueScenario } from '@/lib/clarification-templates';
import { generateSuggestions, type Suggestion, type SuggestionContext, type ContentCategory } from '@/lib/suggestion-engine';
import { parseCanvasOperationIntent, extractCanvasActionFromAIResponse, type CanvasAction, type CanvasActionResult, type CanvasActionType } from '@/lib/canvas-action-executor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  extractTaskAssetReferences,
  findWorkspaceAssetReferenceByUrl,
  mergeWorkspaceAssetReferences,
} from '@/lib/asset-core/workspace-transfer';
import { AgentProgressTimeline } from '@/components/agent-runtime/AgentProgressTimeline';
import { useAgentRunEvents } from '@/components/agent-runtime/use-agent-run-events';
import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';
import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { SkillRunHistory, type SkillRunHistoryItem } from '@/components/skill-runtime/SkillRunHistory';
import { createPlatformComplianceRecheckRequest } from '@/components/skill-runtime/platform-compliance-client';
import type { PlatformComplianceReportV1 } from '@/lib/platform-compliance/types';
import { useSkillRun } from '@/components/skill-runtime/use-skill-run';
import { useSkillOutputReceiver } from '@/components/skill-runtime/use-skill-output-receiver';
import {
  createCanvasSkillProjectionCoordinator,
  createConversationCanvasSkill,
  deleteCanvasSkill,
  deleteCanvasSkillsSequentially,
  loadCanvasSkillCatalog,
  loadCompletedCanvasSkillAssets,
  startCanvasSkillRun,
  updateCanvasSkill,
} from '@/lib/skill-runtime/canvas-client';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import type { SkillDefinition, SkillModelBinding } from '@/lib/skill-runtime/types';
import { bindCanvasSkillSourceInputs, collectCanvasSkillSourceVersionIds } from '@/lib/skill-runtime/canvas-source-inputs';

const CHAT_RENDER_WINDOW = 80;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imageUrl?: string;
  generatedImages?: string[]; // AI生成的图片URL列表
  generatedImageRefs?: WorkspaceAssetReference[];
  isGeneratingImage?: boolean; // 是否正在生成图片
  generateModelName?: string; // 生成使用的模型名称
  generateProviderId?: string; // 生成使用的API提供商ID
  generateProgress?: number; // 生成进度 0-100
  generateImageCount?: number; // 生成图片数量
  generateError?: string; // 生成失败时的错误信息
  pendingGenerationTasks?: ChatPendingGenerationTask[];
  agentRunId?: string;
  imageAnchors?: Array<{
    imageId: string;
    imageUrl: string;
    imageName: string;
    assetId?: string;
    assetVersionId?: string;
    placementId?: string;
  }>; // 画布图片锚点（Lovart风格）
  suggestions?: NextSuggestion[]; // 建议下一步操作
  isClarifying?: boolean; // 是否为追问消息
  toolExecutions?: ToolExecution[]; // Agent工具执行记录
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

function AgentRunMessageProgress({ runId }: { runId: string }): React.ReactElement {
  const run = useAgentRunEvents(runId);
  return (
    <AgentProgressTimeline
      projection={run.projection}
      stale={run.stale}
      onCancel={() => { void run.cancel(); }}
    />
  );
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



const AGENTS: AgentDefinition[] = [
  {
    id: 'product-design',
    name: '产品设计',
    nameEn: 'Product Design',
    icon: '📦',
    desc: '打造专业级产品渲染与包装视觉',
    color: '#f39c12',
    prompt: `你是一位顶级的工业设计师与产品视觉专家，擅长为消费品、电子产品、时尚单品打造高精度3D渲染图、产品包装及详情页视觉。你精通产品摄影美学、材质表现与商业视觉规律。

核心任务：
1. 产品3D渲染：构建逼真的产品视觉，展现材质质感与设计细节。
2. 包装设计：设计产品外包装、礼盒及零售陈列方案。
3. 详情页视觉：规划电商详情页视觉层级、场景图与卖点图。
4. 生活方式摄影：设计产品在真实使用场景中的生活方式图。

输出规范：
1. 创意概念（100字内）
2. 视觉方案说明（构图/光影/材质）
3. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'product-3d-render', name: '产品3D渲染', operationType: 'generate_image', promptTemplate: '3D product render, {productType}, {material}, studio lighting, clean background, photorealistic, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'lifestyle-shot', name: '生活方式图', operationType: 'generate_image', promptTemplate: 'Product lifestyle photography, {productType}, {scene}, natural lighting, editorial style, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'packaging-design', name: '包装设计', operationType: 'generate_image', promptTemplate: 'Premium product packaging design, {brand}, {colorScheme}, minimalist, white background, mockup style, 8k --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'hd' } },
    ],
    defaultAspectRatio: '3:4',
    suggestedNextSteps: [
      { label: '换个角度渲染', action: 'generate_image', prefilledPrompt: '从45度俯视角度重新渲染产品' },
      { label: '调整材质', action: 'edit_image', prefilledPrompt: '将产品材质改为哑光质感，保持造型不变' },
      { label: '移除背景', action: 'remove_bg' },
    ],
    routingKeywords: ['产品', '包装', '3D渲染', '电商图', '详情页', '产品摄影', '工业设计', '材质', 'product', 'packaging', '3d render', 'ecommerce'],
    skillIds: ['preset-product-packaging', 'preset-mockup-showcase'],
  },
  {
    id: 'brand-identity',
    name: '品牌视觉',
    nameEn: 'Brand Identity',
    icon: '🎨',
    desc: '构建完整 VI 系统与品牌符号',
    color: '#5b8fb9',
    prompt: `你是一位资深品牌视觉总监与VI系统架构师，擅长为各行业品牌构建从标识到应用的全套视觉识别系统。你能将品牌文化转化为视觉符号，确保在所有触点保持高度一致性。

核心任务：
1. Logo设计：构思并设计品牌标识，包括主标志、辅助图形与使用规范。
2. 色彩体系：建立主色/辅色/点缀色的完整色彩规范（含各色彩模式数值）。
3. 字体系统：指定品牌中英文字体、排版层级与应用规则。
4. VI应用：制定名片、信封、PPT模板等物料的视觉规范。

输出规范：
1. 品牌视觉核心理念
2. Logo设计说明（构图逻辑/含义/禁区）
3. 色彩方案（CMYK/HEX/Pantone）
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'logo-design', name: 'Logo设计', operationType: 'generate_image', promptTemplate: 'Brand logo design, {brandStyle}, minimalist, vector style, {colorScheme}, white background, flat design, professional --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'hd' } },
      { id: 'vi-mockup', name: 'VI应用效果', operationType: 'generate_image', promptTemplate: 'Brand identity mockup, {brandStyle}, business card letterhead packaging, professional presentation, photorealistic --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'brand-pattern', name: '品牌纹样', operationType: 'generate_image', promptTemplate: 'Brand pattern design, {brandStyle}, {colorScheme}, seamless tile, decorative, elegant --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'standard' } },
    ],
    defaultAspectRatio: '1:1',
    suggestedNextSteps: [
      { label: '优化Logo细节', action: 'edit_image', prefilledPrompt: '优化Logo的线条流畅度，保持整体构图不变' },
      { label: '生成VI应用场景', action: 'generate_image', prefilledPrompt: '将Logo应用到名片和信封上的效果图' },
      { label: '移除背景', action: 'remove_bg' },
    ],
    routingKeywords: ['品牌', 'VI', '视觉识别', 'Logo', '标志', '色彩体系', '字体系统', '品牌规范', 'brand', 'logo', 'identity', 'visual system', 'vi'],
    skillIds: ['preset-logo-brand', 'preset-mockup-showcase', 'preset-business-card'],
  },
  {
    id: 'creative-poster',
    name: '创意海报',
    nameEn: 'Creative Posters',
    icon: '🖼️',
    desc: '产出高精尖商业KV与创意物料',
    color: '#e85d75',
    prompt: `你是一位顶级的商业海报艺术总监与视觉创意大师，擅长为各类品牌打造主视觉KV、活动海报、促销物料及社交媒体图。你精通从概念到落地的全流程，善于将视觉冲击力与信息传达完美平衡。

核心任务：
1. KV主视觉：创作具有冲击力的品牌主视觉，适配线上线下全渠道。
2. 活动海报：针对节日、促销、发布会等场景设计系列化视觉。
3. 社交媒体：适配微信/小红书/抖音/Instagram等平台的规格与风格。
4. 宣传物料：设计展架、折页、易拉宝等线下物料。

输出规范：
1. 创意概念（150字内）
2. 构图方案（主体/留白/视觉动线）
3. 色彩与字体方案
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'kv-main-visual', name: 'KV主视觉', operationType: 'generate_image', promptTemplate: 'Brand key visual poster, {brandStyle}, {theme}, cinematic lighting, {colorScheme}, high impact, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'event-poster', name: '活动海报', operationType: 'generate_image', promptTemplate: 'Event poster design, {eventType}, {colorScheme}, bold typography, eye-catching layout, professional, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'social-card', name: '社交媒体卡片', operationType: 'generate_image', promptTemplate: 'Social media card, {platform} style, {content}, vibrant colors, mobile-friendly, 8k --ar 9:16', defaultParams: { aspectRatio: '9:16', quality: 'standard' } },
    ],
    defaultAspectRatio: '3:4',
    suggestedNextSteps: [
      { label: '调整色彩方案', action: 'edit_image', prefilledPrompt: '保持构图不变，调整整体色调为更沉稳的深色系' },
      { label: '适配社交媒体', action: 'generate_image', prefilledPrompt: '将海报适配为小红书竖版卡片格式' },
      { label: '放大到8K', action: 'upscale' },
    ],
    routingKeywords: ['海报', 'KV', '主视觉', '活动', '促销', '物料', '广告', '宣传图', '社交图', 'banner', 'poster', 'flyer', 'ad', 'marketing'],
    skillIds: ['preset-poster-design', 'preset-social-media', 'preset-marketing-brochure', 'preset-magazine-cover'],
  },
  {
    id: 'ui-design',
    name: 'UI设计',
    nameEn: 'UI/UX Design',
    icon: '💻',
    desc: '打造精美应用界面与交互原型',
    color: '#00b4d8',
    prompt: `你是一位顶级的UI/UX设计师，擅长为移动App、网页产品、SaaS工具设计高质量的用户界面。你精通设计系统、组件库规范、交互动效逻辑，能够产出兼具美观与易用性的界面方案。

核心任务：
1. 界面设计：设计App或网页的主要页面，建立完整的视觉层级。
2. 设计系统：定义颜色、字体、间距、组件的设计规范。
3. 交互设计：规划用户流程、页面跳转逻辑与微交互细节。
4. 原型产出：输出可用于开发参考的高保真效果图。

输出规范：
1. 产品定位与目标用户
2. 界面设计说明（布局/色彩/组件）
3. 交互逻辑说明
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'app-screen', name: 'App界面', operationType: 'generate_image', promptTemplate: 'Mobile app UI design, {appType}, {colorScheme}, clean layout, modern design system, iPhone mockup, 8k --ar 9:16', defaultParams: { aspectRatio: '9:16', quality: 'hd' } },
      { id: 'web-landing', name: '网站落地页', operationType: 'generate_image', promptTemplate: 'Website landing page design, {productType}, {style}, clear hierarchy, CTA buttons, {colorScheme}, desktop view, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'component-kit', name: '组件设计', operationType: 'generate_image', promptTemplate: 'UI component kit, {appType}, {style}, buttons cards forms modals, design system, white background, 8k --ar 4:3', defaultParams: { aspectRatio: '4:3', quality: 'standard' } },
    ],
    defaultAspectRatio: '9:16',
    suggestedNextSteps: [
      { label: '优化排版层级', action: 'edit_image', prefilledPrompt: '优化界面的视觉层级，让主要操作区域更突出' },
      { label: '设计暗色模式', action: 'generate_image', prefilledPrompt: '将界面改为暗色模式设计方案，保持整体布局' },
      { label: '放大查看细节', action: 'upscale' },
    ],
    routingKeywords: ['UI', 'UX', '界面', 'App设计', '网页设计', '交互', '原型', '设计系统', '组件', 'ui design', 'ux', 'app', 'web design', 'interface'],
    skillIds: ['preset-app-web-design'],
  },
  {
    id: 'concept-art',
    name: '概念艺术',
    nameEn: 'Concept Art',
    icon: '🎭',
    desc: '创作影视游戏级概念插画与场景',
    color: '#7c5cbf',
    prompt: `你是一位顶级的概念艺术家与插画师，具备影视级的世界观构建能力与角色设计能力。你擅长游戏、动漫、影视项目的美术概念开发，能够将文字描述转化为震撼人心的视觉世界。

核心任务：
1. 角色概念设计：创作具有独特性格、装备与世界观背景的角色。
2. 场景世界构建：设计宏大的环境场景，建立完整的视觉世界逻辑。
3. 道具设计：设计武器、装备、交通工具等道具的概念图。
4. 氛围渲染：产出体现情绪与故事张力的概念插画。

输出规范：
1. 世界观/角色背景设定
2. 视觉风格说明（参考美术风格、色彩调性）
3. 关键视觉元素清单
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'upscale', 'analyze_image'],
    recipes: [
      { id: 'character-concept', name: '角色概念图', operationType: 'generate_image', promptTemplate: 'Character concept art, {characterType}, {artStyle}, detailed costume design, {colorScheme}, dramatic lighting, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'environment-art', name: '环境场景图', operationType: 'generate_image', promptTemplate: 'Environment concept art, {settingType}, {mood}, atmospheric perspective, cinematic composition, {artStyle}, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'illustration', name: '概念插画', operationType: 'generate_image', promptTemplate: 'Concept illustration, {theme}, {artStyle}, {colorScheme}, painterly textures, narrative scene, 8k --ar 4:3', defaultParams: { aspectRatio: '4:3', quality: 'hd' } },
    ],
    defaultAspectRatio: '16:9',
    suggestedNextSteps: [
      { label: '深化角色细节', action: 'edit_image', prefilledPrompt: '深化角色的服装细节和面部特征，增加更多纹理' },
      { label: '调整画面氛围', action: 'edit_image', prefilledPrompt: '调整场景的光线和氛围，营造更神秘的感觉' },
      { label: '放大到8K', action: 'upscale' },
    ],
    routingKeywords: ['概念艺术', '插画', '角色设计', '场景设计', '游戏美术', '动漫', '影视', '世界观', 'concept art', 'illustration', 'character design', 'environment art', 'game art'],
    skillIds: ['preset-concept-scene', 'preset-ip-character', 'preset-comic-manga'],
  },
  {
    id: 'spatial-design',
    name: '空间设计',
    nameEn: 'Spatial Design',
    icon: '🏛️',
    desc: '打造电影级室内与展览空间',
    color: '#d4af37',
    prompt: `你是一位顶级的室内设计师与空间创意总监，擅长为住宅、商业空间、展览展示及快闪活动提供全局视觉方案。你精通空间叙事逻辑、动线规划与灯光设计，能将抽象概念转化为引人入胜的实体空间。

核心任务：
1. 空间策划：规划空间的功能分区、动线逻辑与视觉焦点。
2. 风格定义：确立空间的设计语言（现代/复古/工业/自然等）。
3. 灯光方案：设计环境光、重点光与装饰光的组合方案。
4. 材质搭配：规划地面、墙面、天花、软装的材质与色彩组合。

输出规范：
1. 空间设计理念
2. 功能分区说明
3. 材质与灯光方案
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'generate_video', 'img2video', 'analyze_image'],
    recipes: [
      { id: 'interior-render', name: '室内效果图', operationType: 'generate_image', promptTemplate: 'Interior design render, {roomType}, {style}, {colorScheme}, natural lighting, architectural photography, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'commercial-space', name: '商业空间', operationType: 'generate_image', promptTemplate: 'Commercial interior design, {spaceType}, {style}, strategic lighting, brand integration, photorealistic, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'space-walkthrough', name: '空间漫游视频', operationType: 'generate_video', promptTemplate: 'Cinematic interior walkthrough, {spaceType}, smooth camera movement, beautiful lighting', defaultParams: { aspectRatio: '16:9', duration: '5' } },
    ],
    defaultAspectRatio: '16:9',
    suggestedNextSteps: [
      { label: '调整灯光氛围', action: 'edit_image', prefilledPrompt: '将室内灯光改为暖色调氛围照明，营造更温馨感' },
      { label: '生成漫游视频', action: 'generate_video', prefilledPrompt: '生成一段空间漫游视频，相机缓慢推进' },
      { label: '换个角度', action: 'generate_image', prefilledPrompt: '从鸟瞰角度渲染同一空间' },
    ],
    routingKeywords: ['室内设计', '空间', '展览', '展厅', '展位', '会展', '软装', '装修', '商业空间', 'interior', 'space design', 'exhibition', 'booth', 'gallery'],
    skillIds: ['preset-interior-design', 'preset-concept-art'],
  },
  {
    id: 'ip-character',
    name: 'IP形象',
    nameEn: 'IP Character',
    icon: '🧸',
    desc: '孵化IP吉祥物与品牌虚拟形象',
    color: '#00b894',
    prompt: `你是一位顶级的IP形象设计师与品牌吉祥物创作专家，擅长为品牌、游戏、内容IP打造具有辨识度、人格魅力及商业延展性的虚拟形象。你能将品牌精神与流行审美完美融合，创造出令人过目不忘的IP角色。

核心任务：
1. 人格设定：为IP赋予性格、背景故事、价值观与核心特质。
2. 视觉设计：设计极具辨识度的外形特征、服饰风格、标志性配件。
3. 表情延展：设计多种情绪表情与动态姿势。
4. 场景应用：规划IP在不同营销场景中的使用方式。

输出规范：
1. IP命名与人格画像
2. 视觉设计说明（造型/色彩/风格）
3. 延展场景规划
4. AI 渲染提示词（中英双版本）`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'generate_video', 'img2video', 'analyze_image'],
    recipes: [
      { id: 'mascot-design', name: 'IP形象设计', operationType: 'generate_image', promptTemplate: 'Brand mascot character design, {characterStyle}, cute and memorable, {colorScheme}, clean white background, 8k --ar 1:1', defaultParams: { aspectRatio: '1:1', quality: 'hd' } },
      { id: 'expression-sheet', name: '表情延展', operationType: 'generate_image', promptTemplate: 'Character expression sheet, {characterName}, 6 expressions happy sad angry surprised shy cool, consistent style, 8k --ar 16:9', defaultParams: { aspectRatio: '16:9', quality: 'hd' } },
      { id: 'scene-application', name: '场景应用', operationType: 'generate_image', promptTemplate: '{characterName} in {scene}, {pose}, brand integration, {colorScheme}, 8k --ar 3:4', defaultParams: { aspectRatio: '3:4', quality: 'hd' } },
      { id: 'ip-animation', name: 'IP动画', operationType: 'generate_video', promptTemplate: '{characterName} performing {action}, smooth animation, cute style, high quality', defaultParams: { aspectRatio: '1:1', duration: '5' } },
    ],
    defaultAspectRatio: '1:1',
    suggestedNextSteps: [
      { label: '设计表情包', action: 'generate_image', prefilledPrompt: '为该IP角色设计一组6个表情：开心、生气、惊讶、思考、害羞、得意' },
      { label: '生成应用场景', action: 'generate_image', prefilledPrompt: '将IP角色放入品牌展示场景中，保持角色一致性' },
      { label: '制作动画', action: 'generate_video', prefilledPrompt: 'IP角色向镜头挥手打招呼的动画' },
    ],
    routingKeywords: ['吉祥物', 'IP', '角色', '虚拟形象', '品牌人物', '卡通', 'mascot', 'character', 'avatar', 'ip character', 'virtual idol', 'brand character'],
    skillIds: ['preset-ip-character', 'preset-sticker-emoji', 'preset-comic-manga'],
  },
  {
    id: 'liquor-brand-all',
    name: '酒类品牌全案',
    nameEn: 'Liquor Brand Studio',
    icon: '🥃',
    desc: '白酒/洋酒品牌从瓶型到空间的全链路视觉方案',
    color: '#8b6914',
    prompt: `你是一位深耕酒类行业的顶级创意总监，集瓶型包装设计、品牌VI系统、空间展演、沉浸式美陈、商业海报、内容长图、品牌IP形象七大专业能力于一身。你深刻理解白酒、洋酒、精酿、清酒等各品类的文化内涵、消费场景与审美语言，能够为酒类品牌提供从单一物料到全案视觉的完整解决方案。

## 七大核心能力

### 1. 瓶型与包装设计
专注白酒瓶型、酒标、礼盒及配套包装的视觉创作。
- 瓶型风格：古典陶瓷/现代极简/东方传统/西式晶莹
- 礼盒设计：节庆限定/高端礼赠/IP联名款
- 工艺表达：烫金/压纹/镂空/渐变/手绘插画风

### 2. 品牌VI系统
为酒类品牌构建完整视觉识别体系。
- 标志体系：主标志/辅助图形/品牌图案
- 色彩体系：主色/辅色（东方金/墨玉/赤朱/青花蓝等）
- 应用规范：终端陈列/货架物料/促销物料

### 3. 空间展演设计
酒类品牌线下体验空间与展会展台的视觉方案。
- 专卖店/品牌旗舰店设计
- 展会展台/发布会现场搭建
- 沉浸式体验馆与品鉴空间

### 4. 沉浸式美陈装置
打造具有话题性的品牌美陈与装置艺术。
- 节日主题装置（春节/中秋/重阳等）
- 零售终端陈列与氛围营造
- 品牌联名装置艺术

### 5. 商业KV与海报
酒类品牌全年营销物料的视觉主创。
- 品牌主视觉KV（节气/节日/新品上市）
- 电商主图/详情页首图
- 户外广告/电梯媒体/社交媒体图

### 6. 内容长图与品牌故事
将酒文化转化为可传播的视觉内容。
- 品牌故事图文长图
- 酿造工艺/原料产地视觉化呈现
- 社交媒体套图（小红书/微信/抖音）

### 7. 品牌IP与吉祥物
孵化具有酒类文化属性的品牌IP。
- 传统文化IP（神话人物/历史典故/生肖形象）
- 现代化IP（品牌代言人/虚拟调酒师/萌化角色）
- IP延展：表情包/周边衍生/联名授权

## 工作方式
1. **场景识别**：自动判断用户需求属于以上哪个方向
2. **文化融合**：将东方酒文化与现代设计美学有机融合
3. **方案产出**：给出创意概念 + 视觉说明 + AI渲染提示词（中英双版）
4. **系列延展**：主动建议可延展的配套物料方向

## 审美标准
- 东方美学：水墨/金石/青花/漆艺/织锦等传统工艺美学语言
- 现代高端：极简工业/奢华质感/光影戏剧性/材质对比
- 情绪表达：节庆喜悦/岁月沉淀/文人雅趣/豪迈放达
- 禁止俗气：避免廉价感、过度堆砌、色彩杂乱、比例失调`,
    tools: ['generate_image', 'edit_image', 'remove_bg', 'upscale', 'generate_video', 'img2video', 'analyze_image'],
    recipes: [
      {
        id: 'liquor-bottle-render',
        name: '瓶型渲染',
        operationType: 'generate_image',
        promptTemplate: 'Premium liquor bottle product render, {bottleStyle}, {material}, studio lighting, white background, photorealistic, ultra detailed, 8k --ar 3:4',
        defaultParams: { aspectRatio: '3:4', quality: 'hd' },
      },
      {
        id: 'liquor-gift-box',
        name: '礼盒包装',
        operationType: 'generate_image',
        promptTemplate: 'Luxury liquor gift box packaging design, {style}, {colorScheme}, gold foil embossing, elegant, traditional Chinese aesthetics, 8k --ar 3:4',
        defaultParams: { aspectRatio: '3:4', quality: 'hd' },
      },
      {
        id: 'liquor-kv-poster',
        name: '品牌KV海报',
        operationType: 'generate_image',
        promptTemplate: 'Liquor brand key visual poster, {season} theme, {colorScheme}, cinematic lighting, dramatic atmosphere, Chinese aesthetics, 8k --ar 3:4',
        defaultParams: { aspectRatio: '3:4', quality: 'hd' },
      },
      {
        id: 'liquor-spatial',
        name: '空间展演',
        operationType: 'generate_image',
        promptTemplate: 'Luxury liquor brand exhibition space, {spaceType}, immersive design, {colorScheme}, dramatic lighting, architectural photography, 8k --ar 16:9',
        defaultParams: { aspectRatio: '16:9', quality: 'hd' },
      },
      {
        id: 'liquor-installation',
        name: '品牌装置',
        operationType: 'generate_image',
        promptTemplate: 'Liquor brand art installation, {festival} theme, {colorScheme}, immersive retail display, creative visual merchandising, 8k --ar 16:9',
        defaultParams: { aspectRatio: '16:9', quality: 'hd' },
      },
      {
        id: 'liquor-ip-character',
        name: '品牌IP形象',
        operationType: 'generate_image',
        promptTemplate: 'Liquor brand mascot character, {characterStyle}, traditional Chinese elements, {colorScheme}, brand mascot design, white background, 8k --ar 1:1',
        defaultParams: { aspectRatio: '1:1', quality: 'hd' },
      },
      {
        id: 'liquor-content-graphic',
        name: '内容长图',
        operationType: 'generate_image',
        promptTemplate: 'Liquor brand story infographic, {topic}, {colorScheme}, editorial design, elegant typography, WeChat article cover style, 8k --ar 3:4',
        defaultParams: { aspectRatio: '3:4', quality: 'standard' },
      },
    ],
    defaultAspectRatio: '3:4',
    suggestedNextSteps: [
      { label: '设计礼盒包装', action: 'generate_image', prefilledPrompt: '为该酒品设计一款节庆礼盒，要求高端大气，融合东方传统纹样' },
      { label: '制作品牌海报', action: 'generate_image', prefilledPrompt: '基于产品特色制作一张节日主题KV海报，横版16:9' },
      { label: '生成空间展演', action: 'generate_image', prefilledPrompt: '设计该品牌的沉浸式体验馆空间效果图' },
      { label: '孵化品牌IP', action: 'generate_image', prefilledPrompt: '为该酒类品牌设计一个融合传统文化元素的品牌IP形象' },
      { label: '放大到8K', action: 'upscale' },
    ],
    routingKeywords: [
      '白酒', '洋酒', '精酿', '清酒', '葡萄酒', '威士忌', '白兰地', '茅台', '五粮液', '酱香', '浓香',
      '酒瓶', '酒标', '酒盒', '礼盒', '酒类包装', '酒类品牌', '酒类VI', '酒类海报', '酒类展台',
      'liquor', 'wine', 'whisky', 'spirits', 'baijiu', 'sake', 'brewery', 'distillery',
    ],
    skillIds: ['preset-product-packaging', 'preset-logo-brand', 'preset-poster-design', 'preset-interior-design', 'preset-ip-character', 'preset-marketing-brochure'],
  },
];

interface ChatPanelProps {
  themeStyle: 'gold' | 'monochrome';
  projectId?: string;

  onAddToPrompt?: (prompt: string) => void;
  onAddImages?: (imageUrls: string[], sourceImageId?: string, meta?: { modelName?: string; apiProvider?: string }) => void;
  onAddGeneratedImage?: (reference: WorkspaceAssetReference, meta?: {
    modelName?: string;
    apiProvider?: string;
    sourceImageId?: string;
    runId?: string;
    sourceVersionIds?: readonly string[];
    restoreDeletedPlacement?: boolean;
    signal?: AbortSignal;
  }) => void | Promise<void>;
  canvasImages?: CanvasImage[];
  selectedCanvasImage?: CanvasImage | null;
  onResolveCanvasImageForChat?: (image: CanvasImage) => Promise<CanvasImage>;
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
  /** Prompt injected from quick creation without auto-sending */
  externalPrompt?: string;
  /** Called after the injected prompt is consumed */
  onExternalPromptConsumed?: () => void;
}

interface CanvasSkillSaveFormProps {
  themeStyle: 'gold' | 'monochrome';
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CanvasSkillSaveForm({
  themeStyle,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onSave,
  onCancel,
}: CanvasSkillSaveFormProps) {
  const isGold = themeStyle === 'gold';
  return (
    <div className={`rounded-lg p-3 ${isGold ? 'bg-gold/8 border border-gold/20' : 'bg-blue-50 border border-blue-200'}`}>
      <div className={`text-xs font-medium mb-2 flex items-center gap-1 ${isGold ? 'text-gold' : 'text-blue-600'}`}>
        <BookmarkCheck size={13} />
        保存为 Skill
      </div>
      <input
        aria-label="Skill 名称"
        value={name}
        onChange={event => onNameChange(event.target.value)}
        placeholder="Skill 名称..."
        className={`w-full px-2.5 py-1.5 rounded-md text-xs mb-2 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/40' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
      />
      <textarea
        aria-label="Skill 描述"
        value={description}
        onChange={event => onDescriptionChange(event.target.value)}
        placeholder="Skill 描述（可选）..."
        className={`w-full px-2.5 py-1.5 rounded-md text-xs min-h-[48px] resize-none mb-2 ${isGold ? 'bg-[#0d0d0d] border border-white/[0.06] text-text-bright placeholder:text-gold-muted/40' : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400'} focus:outline-none`}
      />
      <div className="flex gap-1.5">
        <Button onClick={onSave} disabled={!name.trim()} className="flex-1 h-7 text-xs font-medium rounded-md">
          保存
        </Button>
        <Button onClick={onCancel} className="h-7 px-3 text-xs rounded-md">
          取消
        </Button>
      </div>
    </div>
  );
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
        return modelInfo.model;
      }
    }
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
        return modelId;
      }
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
      return { model: modelId, providerId };
    }
    // 备用：从 wujie_selected_model 读取（generation panel 选择的模型）
    const rawModel = localStorage.getItem('wujie_selected_model');
    if (rawModel) {
      const selection = readPersistedImageModelSelection(JSON.parse(rawModel));
      if (selection) return { model: selection.modelId, providerId: selection.providerId };
    }
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
      return { model: modelId, providerId };
    }
    return { model: selectedModel };
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[ChatImage] Error reading model:', e);
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
/* AgentBuilderDialog 已提取至 src/components/chat/AgentBuilderDialog.tsx */

export function ChatPanel({ themeStyle, projectId, onAddToPrompt, onAddImages, onAddGeneratedImage, canvasImages = [], selectedCanvasImage, onResolveCanvasImageForChat, onChatModelChange, onSuggestionAction, onGenerateImage, brandDna, onInjectBrandDna, chatInitialImage, onChatInitialImageConsumed, chatTabOpen, onChatTabOpenChange, onNavigateToImage, externalPrompt, onExternalPromptConsumed }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const visibleMessages = useMemo(() => (showFullHistory ? messages : messages.slice(-CHAT_RENDER_WINDOW)).filter(Boolean), [messages, showFullHistory]);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const [input, setInput] = useState('');
  const [suggestedAgent, setSuggestedAgent] = useState<AgentDefinition | null>(null); // P2-10: auto-routing suggestion
  const [model, setModel] = useState('');

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
  const [isAgentMode, setIsAgentMode] = useState(false);
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
  const [pendingImages, setPendingImages] = useState<Array<{
    id: string;
    url: string;
    name: string;
    assetId?: string;
    assetVersionId?: string;
    placementId?: string;
  }>>([]);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  // 第三方模型相关状态
  const [showThirdPartyDialog, setShowThirdPartyDialog] = useState(false);
  const [thirdPartyChatModels, setThirdPartyChatModels] = useState<{id: string; name: string; provider: string; providerId: string; supportsVision?: boolean}[]>([]);
  // 服务器端发现的模型
  const [discoveredChatModels, setDiscoveredChatModels] = useState<{id: string; name: string; provider: string; providerId: string; description?: string; isDefault?: boolean; supportsVision?: boolean}[]>([]);
  const availableChatModels = useMemo(() => {
    const uniqueModels = new Map<string, typeof discoveredChatModels[number]>();
    [...discoveredChatModels, ...thirdPartyChatModels].forEach((candidate) => {
      if (!uniqueModels.has(candidate.id)) uniqueModels.set(candidate.id, candidate);
    });
    return Array.from(uniqueModels.values());
  }, [discoveredChatModels, thirdPartyChatModels]);
  const isChatModelReady = availableChatModels.some((candidate) => candidate.id === model);
  // 图像模型选择（用于聊天中生图）
  const [imageModel, setImageModel] = useState('');
  const [imageModelProviderId, setImageModelProviderId] = useState('');
  const [discoveredImageModels, setDiscoveredImageModels] = useState<{id: string; name: string; provider: string; providerId: string}[]>([]);
  const [showImageModelSelector, setShowImageModelSelector] = useState(false);

  useEffect(() => {
    if (!isChatModelReady) setIsAgentMode(false);
  }, [isChatModelReady]);

  // Resolve providerId to human-readable display name
  const providerDisplayName = useCallback((pid: string | undefined): string => {
    if (!pid) return '';
    const m = discoveredImageModels.find(m => m.providerId === pid);
    return m?.provider || pid;
  }, [discoveredImageModels]);

  // 对话管理相关状态
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [chatSessionsLoaded, setChatSessionsLoaded] = useState(false);
  const resumedChatTaskKeysRef = useRef<Set<string>>(new Set());
  // 客户端 portal 挂载就绪标志（用于 createPortal 安全挂到 document.body）
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  // 自定义智能体相关状态
  const [customAgents, setCustomAgents] = useState<typeof AGENTS>([]);
  const [showAgentBuilder, setShowAgentBuilder] = useState(false);
  const [editingAgent, setEditingAgent] = useState<typeof AGENTS[0] | null>(null);
  // Skills 相关状态
  const [chatSkills, setChatSkills] = useState<SkillDefinition[]>([]);
  const [skillCatalogError, setSkillCatalogError] = useState<string>();
  const [showSkillSaveDialog, setShowSkillSaveDialog] = useState(false);
  const [skillSaveName, setSkillSaveName] = useState('');
  const [skillSaveDescription, setSkillSaveDescription] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('');
  const [activeSkill, setActiveSkill] = useState<SkillDefinition | null>(null);
  const [skillParamValues, setSkillParamValues] = useState<Record<string, unknown>>({});
  const skillRun = useSkillRun();
  const receiveSkillOutput = useSkillOutputReceiver(onAddGeneratedImage);
  const resetSkillRun = skillRun.reset;
  const skillAccountKey = typeof window === 'undefined' ? '' : UserManager.getInstance().getCurrentUserId() || '';
  const activeCanvasSkillRunRef = useRef<{
    runId: string;
    projectId: string;
    sourceVersionIds: string[];
    sourceImageId?: string;
    restoreDeletedPlacement?: boolean;
    request: SkillRunRequest;
  } | null>(null);
  const skillProjectionCoordinatorRef = useRef(createCanvasSkillProjectionCoordinator());
  const skillProjectionAttemptCountsRef = useRef<Map<string, number>>(new Map());
  const [skillProjectionRetry, setSkillProjectionRetry] = useState(0);
  const skillProjectionControllerRef = useRef<AbortController | null>(null);
  const skillCanvasImagesRef = useRef(canvasImages);
  useEffect(() => { skillCanvasImagesRef.current = canvasImages; }, [canvasImages]);

  useEffect(() => {
    skillProjectionControllerRef.current?.abort();
    skillProjectionCoordinatorRef.current.cancel();
    activeCanvasSkillRunRef.current = null;
    resetSkillRun();
  }, [projectId, skillAccountKey, resetSkillRun]);

  // ===== 聊天数据跨设备持久化（服务器同步，避免换电脑/换浏览器后数据丢失） =====
  const isChatUserLoggedIn = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem('unbounded_ai_current_user');
  }, []);
  const saveChatKeyToServer = useCallback(async (key: string, value: unknown): Promise<void> => {
    if (!isChatUserLoggedIn()) return;
    try {
      const res = await fetch('/api/user-data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        console.warn('[chat-persist] sync failed', key, res.status);
      }
    } catch (e) {
      console.warn('[chat-persist] sync error', key, e);
    }
  }, [isChatUserLoggedIn]);
  const loadChatKeyFromServer = useCallback(async (key: string): Promise<unknown | null> => {
    if (!isChatUserLoggedIn()) return null;
    try {
      const res = await fetch(`/api/user-data/sync?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data?.success && data.value != null) return data.value;
      return null;
    } catch {
      return null;
    }
  }, [isChatUserLoggedIn]);
  // 防抖调度器：聊天数据变更后延迟写入服务器，避免高频写库
  const chatSyncTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleChatSync = useCallback((key: string, value: unknown) => {
    if (!isChatUserLoggedIn()) return;
    if (chatSyncTimers.current[key]) clearTimeout(chatSyncTimers.current[key]);
    chatSyncTimers.current[key] = setTimeout(() => {
      void saveChatKeyToServer(key, value);
      delete chatSyncTimers.current[key];
    }, 800);
  }, [isChatUserLoggedIn, saveChatKeyToServer]);
  // 会话列表与本地合并（按 id 去重，updatedAt 较新者优先）
  const mergeChatSessionLists = useCallback((server: ChatSession[], local: ChatSession[]): ChatSession[] => {
    const map = new Map<string, ChatSession>();
    for (const s of local) map.set(s.id, s);
    for (const s of server) {
      const existing = map.get(s.id);
      if (!existing || (s.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) map.set(s.id, s);
    }
    return Array.from(map.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 50);
  }, []);

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
    assetId?: string;
    assetVersionId?: string;
    placementId?: string;
    data?: Record<string, unknown>;
  }
  const [activeMentions, setActiveMentions] = useState<MentionRef[]>([]);
  const canvasSkillSourceVersionIds = useMemo(() => collectCanvasSkillSourceVersionIds({
    selected: selectedCanvasImage,
    pending: pendingImages,
    mentions: activeMentions,
  }), [activeMentions, pendingImages, selectedCanvasImage]);
  const canvasSkillInputValues = useMemo(() => bindCanvasSkillSourceInputs(
    activeSkill?.inputs ?? [],
    skillParamValues,
    canvasSkillSourceVersionIds,
  ), [activeSkill?.inputs, canvasSkillSourceVersionIds, skillParamValues]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionPickerSearch, setMentionPickerSearch] = useState('');
  const [mentionPickerIndex, setMentionPickerIndex] = useState(0);
  const mentionTriggerRef = useRef<{ start: number; end: number } | null>(null);

  const addCanvasImageToChat = useCallback(async (
    image: CanvasImage,
    includeMention: boolean,
  ): Promise<void> => {
    let resolved = image;
    if (onResolveCanvasImageForChat) {
      resolved = await onResolveCanvasImageForChat(image);
    }
    const pendingImage = {
      id: resolved.id,
      url: resolved.url,
      name: resolved.prompt?.slice(0, 20) || '鐢诲竷鍥剧墖',
      ...(resolved.assetId ? { assetId: resolved.assetId } : {}),
      ...(resolved.assetVersionId ? { assetVersionId: resolved.assetVersionId } : {}),
      ...(resolved.placementId ? { placementId: resolved.placementId } : {}),
    };
    setPendingImages(prev => {
      const existingIndex = prev.findIndex(item => item.id === resolved.id);
      if (existingIndex < 0) return [...prev, pendingImage];
      return prev.map((item, index) => index === existingIndex ? pendingImage : item);
    });
    if (includeMention) {
      const mention: MentionRef = {
        type: 'canvas-image',
        id: resolved.id,
        label: resolved.prompt?.slice(0, 15) || '鐢诲竷鍥剧墖',
        imageUrl: resolved.url,
        ...(resolved.assetId ? { assetId: resolved.assetId } : {}),
        ...(resolved.assetVersionId ? { assetVersionId: resolved.assetVersionId } : {}),
        ...(resolved.placementId ? { placementId: resolved.placementId } : {}),
        data: { url: resolved.url },
      };
      setActiveMentions(prev => {
        const existingIndex = prev.findIndex(item => item.type === 'canvas-image' && item.id === resolved.id);
        if (existingIndex < 0) return [...prev, mention];
        return prev.map((item, index) => index === existingIndex ? mention : item);
      });
    }
  }, [onResolveCanvasImageForChat]);

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
      void addCanvasImageToChat(chatInitialImage, false);
      setActiveTab('chat');
      setInput('请帮我修改这张图片：');
      if (onChatTabOpenChange) onChatTabOpenChange(true);
      if (onChatInitialImageConsumed) onChatInitialImageConsumed();
    }
  }, [addCanvasImageToChat, chatInitialImage, onChatInitialImageConsumed, onChatTabOpenChange]);

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

    void addCanvasImageToChat(selectedCanvasImage, false);

    // Show visual hint in input (don't overwrite if user is already typing)
    setInput(prev => {
      if (prev.trim() && prev !== '请帮我修改这张图片：') return prev; // Don't overwrite user's text
      return '针对这张图片，我想...';
    });
  }, [addCanvasImageToChat, selectedCanvasImage, chatTabOpen]);

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
        assetId: img.assetId,
        assetVersionId: img.assetVersionId,
        placementId: img.placementId,
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
    if (item.type === 'canvas-image') {
      const sourceImage = canvasImages.find(image => image.id === item.id);
      if (sourceImage) void addCanvasImageToChat(sourceImage, true);
    } else {
      setActiveMentions(prev => {
        if (prev.some(m => m.type === item.type && m.id === item.id)) return prev;
        return [...prev, item];
      });
    }
    setMentionPickerOpen(false);
    mentionTriggerRef.current = null;
    // If brand, also inject into system prompt context
    if (item.type === 'brand' && item.data && onInjectBrandDna) {
      onInjectBrandDna(item.data);
    }
  }, [addCanvasImageToChat, canvasImages, input, onInjectBrandDna]);

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

  // 加载自定义智能体（登录用户优先从服务器恢复）
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const stored = localStorage.getItem('custom-agents');
        if (stored) setCustomAgents(JSON.parse(stored));
      } catch {}
      try {
        const serverAgents = await loadChatKeyFromServer('chat_agents');
        if (!cancelled && Array.isArray(serverAgents) && serverAgents.length > 0) {
          setCustomAgents(serverAgents as typeof AGENTS);
          try { localStorage.setItem('custom-agents', JSON.stringify(serverAgents)); } catch {}
        }
      } catch {
        // 服务器不可用时保留本地智能体
      }
    };
    void init();
    return () => { cancelled = true; };
  }, [loadChatKeyFromServer]);

  const loadCanvasSkills = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const skills = await loadCanvasSkillCatalog(fetch, signal);
      if (!signal?.aborted) {
        setChatSkills(skills);
        setSkillCatalogError(undefined);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setSkillCatalogError(error instanceof Error ? error.message : 'Canvas Skill 目录加载失败');
      }
    }
  }, []);

  // Canvas 目录以统一 Skill API 为唯一真相；兼容迁移由服务端负责。
  useEffect(() => {
    const controller = new AbortController();
    void loadCanvasSkills(controller.signal);
    return () => controller.abort();
  }, [loadCanvasSkills]);

  // 保存当前对话为 Skill
  const handleSaveAsSkill = useCallback(async (): Promise<void> => {
    if (!skillSaveName.trim()) {
      toast.error('请输入 Skill 名称');
      return;
    }
    try {
      const conversationSummary = messages.slice(-6)
        .map(message => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
        .join('\n')
        .slice(0, 2_000);
      const selectedAgent = [...AGENTS, ...customAgents].find(agent => agent.id === systemPrompt);
      const savedSystemPrompt = selectedAgent?.prompt
        || systemPrompt
        || '根据保存的对话上下文理解用户需求，并在当前工作区继续完成任务。';
      await createConversationCanvasSkill({
        name: skillSaveName.trim(),
        description: skillSaveDescription.trim() || conversationSummary || '保存的画布对话',
        category: selectedAgent?.name || '保存对话',
        systemPrompt: savedSystemPrompt,
        conversation: conversationSummary,
      });
      await loadCanvasSkills();
      setShowSkillSaveDialog(false);
      setSkillSaveName('');
      setSkillSaveDescription('');
      toast.success('Skill 已同步到服务器');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Skill 失败');
    }
  }, [customAgents, loadCanvasSkills, messages, skillSaveDescription, skillSaveName, systemPrompt]);

  // 使用 Skill 创建新对话
  // 删除 Skill
  const handleDeleteSkill = useCallback(async (skillId: string): Promise<void> => {
    try {
      await deleteCanvasSkill(skillId);
      setChatSkills(current => current.filter(skill => skill.id !== skillId));
      if (activeSkill?.id === skillId) {
        skillProjectionControllerRef.current?.abort();
        skillProjectionCoordinatorRef.current.cancel();
        activeCanvasSkillRunRef.current = null;
        setActiveSkill(null);
        skillRun.reset();
      }
    } catch (error) {
      await loadCanvasSkills();
      toast.error(error instanceof Error ? error.message : '删除 Skill 失败');
    }
  }, [activeSkill?.id, loadCanvasSkills, skillRun]);

  const handleToggleSkill = useCallback(async (skill: SkillDefinition): Promise<void> => {
    try {
      const updated = await updateCanvasSkill(skill.id, { enabled: !skill.enabled });
      setChatSkills(current => current.map(item => item.id === skill.id ? updated : item));
    } catch (error) {
      await loadCanvasSkills();
      toast.error(error instanceof Error ? error.message : '更新 Skill 失败');
    }
  }, [loadCanvasSkills]);

  const handleClearUserSkills = useCallback(async (): Promise<void> => {
    try {
      const userSkills = chatSkills.filter(skill => !skill.builtIn);
      await deleteCanvasSkillsSequentially(userSkills.map(skill => skill.id));
      await loadCanvasSkills();
      if (activeSkill && !activeSkill.builtIn) {
        skillProjectionControllerRef.current?.abort();
        skillProjectionCoordinatorRef.current.cancel();
        activeCanvasSkillRunRef.current = null;
        setActiveSkill(null);
        skillRun.reset();
      }
    } catch (error) {
      await loadCanvasSkills();
      toast.error(error instanceof Error ? error.message : '清空 Skills 失败');
    }
  }, [activeSkill, chatSkills, loadCanvasSkills, skillRun]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const autoScrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!externalPrompt?.trim()) return;
    setInput(externalPrompt);
    onExternalPromptConsumed?.();
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [externalPrompt, onExternalPromptConsumed]);

  const handleMessageListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    shouldStickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  }, []);

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
        const loadCatalog = async (type: 'chat' | 'vlm'): Promise<Record<string, unknown> | null> => {
          try {
            const response = await fetch(`/api/models?type=${type}`);
            return response.ok ? await response.json() as Record<string, unknown> : null;
          } catch {
            return null;
          }
        };
        const [chatCatalog, visionCatalog] = await Promise.all([
          loadCatalog('chat'), loadCatalog('vlm'),
        ]);
        if (chatCatalog || visionCatalog) {
          const models = new Map<string, typeof discoveredChatModels[number]>();
          const providerMap = new Map<string, string>();
          for (const catalog of [chatCatalog, visionCatalog]) {
            if (catalog?.providers && Array.isArray(catalog.providers)) {
              for (const provider of catalog.providers as Array<Record<string, unknown>>) {
                if (typeof provider.id === 'string') {
                  providerMap.set(provider.id, String(provider.name || provider.displayName || ''));
                }
              }
            }
          }
          for (const [catalog, supportsVision] of [
            [chatCatalog, false], [visionCatalog, true],
          ] as const) {
            if (!catalog?.models || !Array.isArray(catalog.models)) continue;
            for (const raw of catalog.models as Array<Record<string, unknown>>) {
              const modelId = String(raw.id || raw.name || '');
              const providerId = typeof raw.providerId === 'string' ? raw.providerId : '';
              if (!modelId || !providerId) continue;
              const id = `${providerId}::${modelId}`;
              const existing = models.get(id);
              models.set(id, {
                id,
                name: raw.name && raw.name !== raw.id
                  ? String(raw.name)
                  : getModelDisplayName(modelId),
                provider: providerMap.get(providerId) || providerId,
                providerId,
                ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
                ...(raw.isDefault === true ? { isDefault: true } : {}),
                ...(supportsVision || existing?.supportsVision ? { supportsVision: true } : {}),
              });
            }
          }
          const available = Array.from(models.values());
          setDiscoveredChatModels(available);
          // 如果有默认模型，自动选中
          setModel(current => selectInitialModel(current, available));
        }
      } catch {
        // 静默失败
      }
    }, []);

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
        const selection = readPersistedImageModelSelection(JSON.parse(saved));
        if (selection) {
          setImageModel(selection.compositeKey);
          setImageModelProviderId(selection.providerId);
        }
      } catch {
        // ignore
      }
    }
  }, [loadImageModels]);

  // 初始化对话列表（已登录用户优先从服务器拉取，与本地合并后回写）
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let localSessions: ChatSession[] = [];
      const saved = localStorage.getItem('chat-sessions');
      if (saved) {
        try {
          localSessions = normalizePersistedChatSessions<ChatSession>(JSON.parse(saved));
          if (localSessions.length > 0) {
            setChatSessions(localSessions);
            const latest = localSessions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
            setCurrentSessionId(latest.id);
            setMessages(latest.messages);
            setModel(latest.model);
            setSystemPrompt(latest.systemPrompt);
          }
        } catch {
          // ignore
        }
      }
      // 服务器为权威源：登录用户跨设备恢复聊天历史
      try {
        const serverSessions = await loadChatKeyFromServer('chat_sessions');
        const validServerSessions = normalizePersistedChatSessions<ChatSession>(serverSessions);
        if (!cancelled && validServerSessions.length > 0) {
          const merged = mergeChatSessionLists(validServerSessions, localSessions);
          setChatSessions(merged);
          const latest = merged.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
          setCurrentSessionId(latest.id);
          setMessages(latest.messages);
          setModel(latest.model);
          setSystemPrompt(latest.systemPrompt);
          localStorage.setItem('chat-sessions', JSON.stringify(merged));
        }
      } catch {
        // 服务器不可用时保留本地会话
      }
      if (!cancelled) setChatSessionsLoaded(true);
    };
    void init();
    return () => { cancelled = true; };
  }, [loadChatKeyFromServer, mergeChatSessionLists]);

  // 保存对话到localStorage
  const saveSession = useCallback((sessionMessages: Message[], sessionModel: string, sessionSystemPrompt: string, sessionId?: string) => {
    const id = sessionId || currentSessionId || `session-${Date.now()}`;
    setChatSessions(prev => {
      const existing = prev.find(session => session.id === id);
      const mergedMessages = existing
        ? mergeChatSessionMessages(existing.messages, sessionMessages)
        : sessionMessages;
      const title = mergedMessages.length > 0
        ? mergedMessages[0].content.substring(0, 20) + (mergedMessages[0].content.length > 20 ? '...' : '')
        : '新对话';
      const session: ChatSession = {
        id,
        title,
        messages: mergedMessages,
        model: sessionModel,
        systemPrompt: sessionSystemPrompt,
        createdAt: mergedMessages.length > 0 ? mergedMessages[0].timestamp : Date.now(),
        updatedAt: Date.now(),
        agentId: sessionSystemPrompt && allAgents.find(a => a.id === sessionSystemPrompt) ? sessionSystemPrompt : undefined,
      };
      const filtered = prev.filter(s => s.id !== id);
      const updated = [session, ...filtered].slice(0, 50);
      localStorage.setItem('chat-sessions', JSON.stringify(updated));
      scheduleChatSync('chat_sessions', updated);
      return updated;
    });
    if (!currentSessionId) setCurrentSessionId(id);
  }, [currentSessionId, scheduleChatSync]);

  const persistMessageUpdate = useCallback((messageId: string, update: (message: Message) => Message) => {
    const nextMessages = updateChatSessionMessage(messagesRef.current, messageId, update);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    saveSession(nextMessages, model, systemPrompt);
  }, [model, saveSession, systemPrompt]);

  const persistTaskAssetReferences = useCallback((messageId: string, pollData: unknown) => {
    const references = extractTaskAssetReferences(pollData);
    if (references.length === 0) return;
    persistMessageUpdate(messageId, message => ({
      ...message,
      generatedImageRefs: mergeWorkspaceAssetReferences(message.generatedImageRefs, references),
    }));
  }, [persistMessageUpdate]);

  const addGeneratedImageToCanvas = useCallback(async (
    imageUrl: string,
    message: Message,
    sourceImageId?: string,
  ) => {
    try {
      const meta = {
        modelName: message.generateModelName,
        apiProvider: providerDisplayName(message.generateProviderId),
        sourceImageId,
      };
      const reference = findWorkspaceAssetReferenceByUrl(imageUrl, message.generatedImageRefs || []);
      if (reference && onAddGeneratedImage) await onAddGeneratedImage(reference, meta);
      else onAddImages?.([imageUrl], sourceImageId, meta);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加到画布失败');
    }
  }, [onAddGeneratedImage, onAddImages]);

  // Persist incremental tool output and task progress, not only the first chat reply.
  useEffect(() => {
    if (!chatSessionsLoaded || messages.length === 0) return;
    saveSession(messages, model, systemPrompt);
  }, [chatSessionsLoaded, messages, model, systemPrompt, saveSession]);

  // A refreshed canvas rehydrates chat history first, then resumes only unfinished
  // provider tasks with the exact model/provider pair that created them.
  useEffect(() => {
    if (!chatSessionsLoaded) return;
    let cancelled = false;

    const resume = async (): Promise<void> => {
      if (projectId && currentSessionId) {
        try {
          const response = await fetch(`/api/chat-tasks?projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(currentSessionId)}`);
          const data = await response.json();
          if (response.ok && data.success && Array.isArray(data.tasks)) {
            const recoveredMessages = mergeRecoveredChatTasks(
              messagesRef.current,
              data.tasks as RecoverableChatCloudTask[],
            );
            messagesRef.current = recoveredMessages;
            setMessages(recoveredMessages);
            saveSession(recoveredMessages, model, systemPrompt, currentSessionId);
          }
        } catch {
          // Local session recovery remains available if the task-center query is transiently unavailable.
        }
      }

      const pendingMessages = messagesRef.current
        .map(message => ({ message, tasks: getResumableChatGenerationTasks(message) }))
        .filter(({ tasks }) => tasks.length > 0);

      for (const { message, tasks } of pendingMessages) {
        const resumeKey = `${message.id}:${tasks.map(task => task.taskId).join(',')}`;
        if (resumedChatTaskKeysRef.current.has(resumeKey)) continue;
        resumedChatTaskKeysRef.current.add(resumeKey);

        const taskById = new Map(tasks.map(task => [task.taskId, task]));
        const resumeSlots = tasks.map((task, index) => ({
          taskId: task.taskId,
          slotIndex: typeof task.slotIndex === 'number' ? task.slotIndex : index,
          ...(task.batchId ? { batchId: task.batchId } : {}),
          ...(task.slotId ? { slotId: task.slotId } : {}),
        }));
        let recoveredSlotImages: Array<{ slotIndex: number; url: string }> = [];
        const settlements = await settleChatGenerationSlots(
          resumeSlots,
          async (slot) => {
            const task = taskById.get(slot.taskId);
            if (!task) throw new Error('恢复任务信息不完整');
            const createTerminalTaskError = (message: string): Error => {
              const error = new Error(message);
              error.name = 'TerminalTaskError';
              return error;
            };
            for (let attempt = 0; attempt < CHAT_TASK_MAX_ATTEMPTS && !cancelled; attempt += 1) {
              try {
                const response = await fetch('/api/poll-task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: task.taskId, model: task.model, providerId: task.providerId }),
                });
                const pollData = await response.json();
                const videoUrl = pollData.videoUrl || pollData.result?.videoUrl;
                const resultUrl = task.type === 'video' || videoUrl
                  ? videoUrl
                  : extractTaskResultImageUrl(pollData);

                if (pollData.status === 'completed') {
                  persistTaskAssetReferences(message.id, pollData);
                  if (typeof resultUrl === 'string' && resultUrl) return resultUrl;
                  throw createTerminalTaskError('生成完成但未获取到结果');
                }
                if (pollData.status === 'failed' || pollData.status === 'cancelled' || pollData.retryable === false) {
                  throw createTerminalTaskError(pollData.error || '生成失败');
                }

                const progress = Math.min(90, Math.max(5, pollData.progress || Math.round(((attempt + 1) / CHAT_TASK_MAX_ATTEMPTS) * 85)));
                setMessages(current => current.map(item => item.id === message.id
                  ? { ...item, generateProgress: progress }
                  : item));
              } catch (error) {
                if (error instanceof Error && error.name === 'TerminalTaskError') {
                  throw error;
                }
                // Transient provider or network failures are retried within the same window.
              }
              await new Promise(resolve => setTimeout(resolve, getChatTaskPollIntervalMs(attempt)));
            }
            if (cancelled) throw new Error('任务恢复已取消');
            throw new Error('任务恢复超时，请在任务中心确认供应商结果后重试');
          },
          (settlement) => {
            if (!settlement.result) return;
            recoveredSlotImages = upsertChatGenerationSlotImage(
              recoveredSlotImages,
              settlement.slot.slotIndex,
              settlement.result,
            );
            const visibleRecoveredUrls = recoveredSlotImages.map(image => image.url);
            setMessages(current => current.map(item => item.id === message.id
              ? {
                ...item,
                generatedImages: mergeRecoveredImages(
                  item.generatedImages,
                  visibleRecoveredUrls,
                ),
              }
              : item));
          },
        );

        const recoveredMessage = messagesRef.current.find(item => item.id === message.id) || message;
        for (const settlement of settlements) {
          if (settlement.result) {
            await addGeneratedImageToCanvas(settlement.result, recoveredMessage);
          }
        }

        if (cancelled) return;
        const uniqueUrls = recoveredSlotImages.map(image => image.url);
        const terminalError = settlements
          .flatMap(settlement => settlement.error ? [settlement.error] : [])
          .join('；');
        setMessages(current => current.map(item => item.id === message.id
          ? {
            ...item,
            generatedImages: mergeRecoveredImages(item.generatedImages, uniqueUrls),
            isGeneratingImage: false,
            generateProgress: uniqueUrls.length > 0 ? 100 : item.generateProgress,
            generateError: terminalError || undefined,
            pendingGenerationTasks: undefined,
          }
          : item));
      }
    };

    void Promise.resolve().then(() => {
      if (!cancelled) return resume();
    });
    return () => { cancelled = true; };
  }, [addGeneratedImageToCanvas, chatSessionsLoaded, currentSessionId, model, persistTaskAssetReferences, projectId, saveSession, systemPrompt]);

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
      scheduleChatSync('chat_sessions', updated);
      return updated;
    });
    if (currentSessionId === sessionId) {
      setMessages([]);
      setCurrentSessionId(`session-${Date.now()}`);
    }
  }, [currentSessionId, scheduleChatSync]);

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
    if (!shouldStickToBottomRef.current || autoScrollRafRef.current !== null) return;
    autoScrollRafRef.current = requestAnimationFrame(() => {
      autoScrollRafRef.current = null;
      const container = messageListRef.current;
      if (container && shouldStickToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });
    return () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
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
        imageAnchors: pendingImages.map(img => ({
          imageId: img.id,
          imageUrl: img.url,
          imageName: img.name,
          assetId: img.assetId,
          assetVersionId: img.assetVersionId,
          placementId: img.placementId,
        })),
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

    if (!isChatModelReady) {
      setShowThirdPartyDialog(true);
      return;
    }

    if (overrideText) {
      // When triggered by suggestion click, ensure input field is cleared
    }

    const trimmedInput = textToSend.trim();
    const taskSessionId = currentSessionId || `session-${Date.now()}`;
    if (!currentSessionId) setCurrentSessionId(taskSessionId);
    const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // P0-2: 增强意图分类 - 使用新版意图分类器
    const intentResult = classifyIntent(trimmedInput, { hasImages: pendingImages.length > 0 || activeMentions.some(m => m.type === 'canvas-image') });
    const intentLevel = intentResult.clarity;

    // 收集图片锚点（来自pendingImages、@图片引用）
    const imageAnchors: Array<{
      imageId: string;
      imageUrl: string;
      imageName: string;
      assetId?: string;
      assetVersionId?: string;
      placementId?: string;
    }> = [];
    activeMentions.filter(m => m.type === 'canvas-image').forEach(m => {
      if (!imageAnchors.find(a => a.imageId === m.id)) {
        imageAnchors.push({
          imageId: m.id,
          imageUrl: m.imageUrl || '',
          imageName: m.label,
          assetId: m.assetId,
          assetVersionId: m.assetVersionId,
          placementId: m.placementId,
        });
      }
    });
    // Add pending images as anchors
    pendingImages.forEach(img => {
      if (!imageAnchors.find(a => a.imageId === img.id)) {
        imageAnchors.push({
          imageId: img.id,
          imageUrl: img.url,
          imageName: img.name,
          assetId: img.assetId,
          assetVersionId: img.assetVersionId,
          placementId: img.placementId,
        });
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
      const allRefImageList: Array<{
        id: string;
        url: string;
        name: string;
        assetVersionId?: string;
        placementId?: string;
      }> = [];
      activeMentions.forEach(m => {
        if (m.type === 'canvas-image' && m.imageUrl && !allRefImageList.find(r => r.id === m.id)) {
          allRefImageList.push({
            id: m.id,
            url: m.imageUrl,
            name: m.label,
            assetVersionId: m.assetVersionId,
            placementId: m.placementId,
          });
        }
      });
      capturedPendingImages.forEach(img => {
        if (!allRefImageList.find(r => r.id === img.id)) {
          allRefImageList.push({
            id: img.id,
            url: img.url,
            name: img.name,
            assetVersionId: img.assetVersionId,
            placementId: img.placementId,
          });
        }
      });
      const chatSourceVersionIds = [...new Set(
        allRefImageList.flatMap(image => image.assetVersionId ? [image.assetVersionId] : []),
      )];
      const chatSelectedEntityIds = [...new Set(
        allRefImageList.flatMap(image => (
          image.assetVersionId && image.placementId ? [image.id] : []
        )),
      )];
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
          projectId,
          sessionId: taskSessionId,
          messageId: assistantMessageId,
          sourceVersionIds: chatSourceVersionIds,
          selectedEntityIds: chatSelectedEntityIds,
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
      let assistantContent = '';
      const toolExecutions: ToolExecution[] = []; // Agent工具执行记录
      const toolGeneratedImages: string[] = []; // 工具生成的图片URL
      const addedImageUrls = new Set<string>(); // 已添加到画布的图片URL去重
      const toolPendingTaskIds: Array<{ taskId: string; model: string; providerId: string; type: 'image' | 'video'; runId?: string }> = []; // 工具返回的异步任务，需轮询
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
                      const runId = parsed.taskIds.find((task: { runId?: unknown }) => typeof task.runId === 'string')?.runId;
                      if (typeof runId === 'string') {
                        persistMessageUpdate(assistantMessageId, message => ({ ...message, agentRunId: runId }));
                      }
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
          const pendingGenerationTasks: ChatPendingGenerationTask[] = toolPendingTaskIds.map(task => ({
            ...task,
            model: task.model || imageModelInfo.model,
            providerId: task.providerId || imageModelInfo.providerId || '',
          }));
          persistMessageUpdate(assistantMessageId, msg => ({
            ...msg,
            isGeneratingImage: true,
            generateModelName: imageModelInfo.model || '图像生成',
            generateProviderId: imageModelInfo.providerId,
            generateProgress: 5,
            generateImageCount: toolPendingTaskIds.length,
            pendingGenerationTasks,
            agentRunId: toolPendingTaskIds.find(task => task.runId)?.runId,
          }));

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
                      persistTaskAssetReferences(assistantMessageId, pollData);
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
                  const projectedMessage = messagesRef.current.find(message => message.id === assistantMessageId);
                  const projectedReference = findWorkspaceAssetReferenceByUrl(url, projectedMessage?.generatedImageRefs || []);
                  if (projectedReference) { savedUrls.push(url); continue; }
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
                const generatedMessage = messagesRef.current.find(message => message.id === assistantMessageId);
                if (generatedMessage) {
                  for (const imageUrl of newUrls) {
                    await addGeneratedImageToCanvas(imageUrl, generatedMessage);
                  }
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
                  body: JSON.stringify(withClientImageOutputPreference({
                    prompt: rawPrompt,
                    model: imageModelInfo.model,
                    providerId: imageModelInfo.providerId,
                    aspectRatio,
                    quality,
                    outputCount: 1,
                    submitOnly: true,
                    projectId,
                    sessionId: taskSessionId,
                    messageId: assistantMessageId,
                    assetWorkspace: 'chat',
                    assetWorkspaceId: `embedded-chat:${taskSessionId}`,
                    assetSourceEntityId: assistantMessageId,
                    ...(referenceImages.length > 0 ? { referenceImages } : {}),
                  }, imageModelInfo.model)),
                });
                const generateData = await generateRes.json();
                if (!generateData.success) { continue; }

                const genModel = generateData.model || imageModelInfo.model;
                const promptResultUrls: string[] = [];

                if (generateData.imageUrls?.length > 0) { promptResultUrls.push(...generateData.imageUrls); }
                else if (generateData.imageUrl) { promptResultUrls.push(generateData.imageUrl); }

                const submittedSlots = normalizeGenerationSubmitSlots(generateData);
                if (submittedSlots.length > 0 && promptResultUrls.length === 0) {
                  const pendingGenerationTasks: ChatPendingGenerationTask[] = submittedSlots.map(slot => ({
                    ...slot,
                    model: genModel,
                    providerId: imageModelInfo.providerId || '',
                    type: 'image',
                  }));
                  persistMessageUpdate(assistantMessageId, msg => ({
                    ...msg,
                    pendingGenerationTasks: [...(msg.pendingGenerationTasks || []), ...pendingGenerationTasks],
                  }));
                  const progressiveResults = new Map<number, string>();
                  const settledResults = await collectChatGenerationSlotResults(
                    submittedSlots,
                    async (slot) => {
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
                          body: JSON.stringify({ taskId: slot.taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();
                        if (pollData.status === 'completed') {
                          persistTaskAssetReferences(assistantMessageId, pollData);
                          const extractedUrl = extractTaskResultImageUrl(pollData);
                          return extractedUrl && typeof extractedUrl === 'string'
                            ? extractedUrl
                            : undefined;
                        } else if (pollData.status === 'failed' || pollData.retryable === false) {
                          return undefined;
                        }
                      } catch { /* retry */ }
                    }
                    return undefined;
                    },
                    (slot, resultUrl) => {
                      progressiveResults.set(slot.slotIndex, resultUrl);
                      const progressiveUrls = [...new Set([
                        ...allResultUrls,
                        ...[...progressiveResults.entries()]
                          .sort(([left], [right]) => left - right)
                          .map(([, url]) => url),
                      ])];
                      setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, generatedImages: progressiveUrls }
                          : msg
                      ));
                    },
                  );
                  promptResultUrls.push(...settledResults.map(entry => entry.result));
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
                const generatedMessage = messagesRef.current.find(message => message.id === assistantMessageId);
                if (generatedMessage) {
                  for (const imageUrl of uniqueResultUrls) {
                    await addGeneratedImageToCanvas(imageUrl, generatedMessage, imageSourceId);
                  }
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
      } else if (!hasToolGeneratedImages && pendingImages.length > 0) {
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
                  body: JSON.stringify(withClientImageOutputPreference({
                    prompt: optimizedPrompt, model: imageModelInfo.model, providerId: imageModelInfo.providerId,
                    aspectRatio, quality, outputCount, submitOnly: true,
                    projectId,
                    sessionId: taskSessionId,
                    messageId: assistantMessageId,
                    assetWorkspace: 'chat',
                    assetWorkspaceId: `embedded-chat:${taskSessionId}`,
                    assetSourceEntityId: assistantMessageId,
                    ...(referenceImages.length > 0 ? { referenceImages } : {}),
                  }, imageModelInfo.model)),
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

                const submittedSlots = normalizeGenerationSubmitSlots(generateData);
                const genModel = generateData.model || imageModelInfo.model;
                const resultUrls: string[] = [];

                if (generateData.imageUrls?.length > 0) { resultUrls.push(...generateData.imageUrls); }
                else if (generateData.imageUrl) { resultUrls.push(generateData.imageUrl); }

                const slotErrors: string[] = [];
                if (submittedSlots.length > 0 && resultUrls.length === 0) {
                  const pendingGenerationTasks: ChatPendingGenerationTask[] = submittedSlots.map(slot => ({
                    ...slot,
                    model: genModel,
                    providerId: imageModelInfo.providerId || '',
                    type: 'image',
                  }));
                  persistMessageUpdate(assistantMessageId, msg => ({ ...msg, pendingGenerationTasks }));
                  const progressiveResults = new Map<number, string>();
                  const settledResults = await collectChatGenerationSlotResults(
                    submittedSlots,
                    async (slot) => {
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
                          body: JSON.stringify({ taskId: slot.taskId, model: genModel, providerId: imageModelInfo.providerId }),
                        });
                        const pollData = await pollRes.json();
                        if (pollData.status === 'completed') {
                          persistTaskAssetReferences(assistantMessageId, pollData);
                          const extractedUrl = extractTaskResultImageUrl(pollData);
                          return extractedUrl && typeof extractedUrl === 'string'
                            ? extractedUrl
                            : undefined;
                        } else if (pollData.status === 'failed' || pollData.retryable === false) {
                          const slotError = pollData.error || '生成失败';
                          slotErrors.push(slotError);
                          setMessages(prev => prev.map(msg => 
                            msg.id === assistantMessageId 
                              ? { ...msg, isGeneratingImage: true, generateError: slotError }
                              : msg
                          ));
                          return undefined;
                        }
                      } catch { /* retry */ }
                    }
                    return undefined;
                    },
                    (slot, resultUrl) => {
                      progressiveResults.set(slot.slotIndex, resultUrl);
                      const progressiveUrls = [...progressiveResults.entries()]
                        .sort(([left], [right]) => left - right)
                        .map(([, url]) => url);
                      setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, generatedImages: progressiveUrls }
                          : msg
                      ));
                    },
                  );
                  resultUrls.push(...settledResults.map(entry => entry.result));
                }

                if (resultUrls.length > 0) {
                  const uniqueResultUrls = [...new Set(resultUrls)];
                  // 生成建议下一步
                  const suggestions = generateSuggestions({ contentCategory: 'image_generated', modelName: imageModelInfo.model });
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? {
                        ...msg,
                        generatedImages: uniqueResultUrls,
                        isGeneratingImage: false,
                        generateProgress: 100,
                        generateError: slotErrors.length > 0
                          ? `部分图片生成失败：${[...new Set(slotErrors)].join('；')}`
                          : undefined,
                        suggestions,
                      }
                      : msg
                  ));
                  const generatedMessage = messagesRef.current.find(message => message.id === assistantMessageId);
                  if (generatedMessage) {
                    for (const imageUrl of uniqueResultUrls) {
                      await addGeneratedImageToCanvas(imageUrl, generatedMessage, imageSourceId);
                    }
                  }
                } else {
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? {
                        ...msg,
                        isGeneratingImage: false,
                        generateError: slotErrors.length > 0
                          ? [...new Set(slotErrors)].join('；')
                          : '图像生成未返回结果',
                      }
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
      saveSession(finalMessages, model, systemPrompt, taskSessionId);
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
  }, [input, isLoading, isChatModelReady, messages, model, systemPrompt, isThinkingMode, saveSession, persistMessageUpdate, pendingImages, allAgents, activeMentions, brandDna, tuneContextString, onAddImages, currentSessionId, projectId]);

  const handleUseSkill = useCallback((skill: SkillDefinition) => {
    skillProjectionControllerRef.current?.abort();
    skillProjectionCoordinatorRef.current.cancel();
    activeCanvasSkillRunRef.current = null;
    skillRun.reset();
    setActiveSkill(skill);
    setSkillParamValues(Object.fromEntries(skill.inputs.flatMap(field => (
      field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]]
    ))));
  }, [skillRun]);

  const handleCloseSkill = useCallback((): void => {
    skillProjectionControllerRef.current?.abort();
    skillProjectionCoordinatorRef.current.cancel();
    activeCanvasSkillRunRef.current = null;
    skillRun.reset();
    setActiveSkill(null);
    setSkillParamValues({});
  }, [skillRun]);

  const buildCanvasSkillRequest = useCallback((overrides?: {
    inputValues: Record<string, unknown>;
    sourceVersionIds: string[];
  }): SkillRunRequest | null => {
    if (!activeSkill || !projectId) return null;
    const executionSkill = activeSkill;
    const chatSelection = availableChatModels.find(candidate => candidate.id === model);
    const imageSelection = discoveredImageModels.find(candidate => candidate.id === imageModel);
    const chatProviderId = chatSelection?.providerId || (model.includes('::') ? model.split('::')[0] : '');
    const chatModelId = model.includes('::') ? model.split('::').slice(1).join('::') : model;
    const imageProviderId = imageSelection?.providerId
      || imageModelProviderId
      || (imageModel.includes('::') ? imageModel.split('::')[0] : '');
    const imageModelId = imageModel.includes('::')
      ? imageModel.split('::').slice(1).join('::')
      : imageModel;
    const modelBindings: SkillRunRequest['modelBindings'] = {};
    const roles = new Set<SkillModelBinding['role']>(executionSkill.steps.map(step => step.modelRole));
    roles.add('orchestrator');
    for (const role of roles) {
      if (role === 'orchestrator' && chatProviderId && chatModelId) {
        modelBindings.orchestrator = { providerId: chatProviderId, modelId: chatModelId };
      } else if (role === 'vision' && chatSelection?.supportsVision && chatProviderId && chatModelId) {
        modelBindings.vision = { providerId: chatProviderId, modelId: chatModelId };
      } else if (role === 'image' && imageProviderId && imageModelId) {
        modelBindings.image = { providerId: imageProviderId, modelId: imageModelId };
      } else {
        return null;
      }
    }
    const request: SkillRunRequest = {
      skillId: executionSkill.id,
      skillVersion: executionSkill.version,
      surface: 'canvas',
      projectId,
      workspaceId: `canvas:${projectId}`,
      inputValues: canvasSkillInputValues,
      sourceVersionIds: canvasSkillSourceVersionIds,
      modelBindings,
      idempotencyKey: typeof crypto.randomUUID === 'function'
        ? `canvas-skill:${crypto.randomUUID()}`
        : `canvas-skill:${Date.now()}`,
    };
    return overrides ? {
      ...request,
      inputValues: overrides.inputValues,
      sourceVersionIds: overrides.sourceVersionIds,
    } : request;
  }, [activeSkill, availableChatModels, canvasSkillInputValues, canvasSkillSourceVersionIds, discoveredImageModels, imageModel, imageModelProviderId, model, projectId]);

  const hasRequiredCanvasSkillSource = useCallback((): boolean => {
    const requiresManagedSource = activeSkill?.inputs.some(field => (
      field.required && field.bindToSourceVersions
    ));
    if (!requiresManagedSource || canvasSkillSourceVersionIds.length > 0) return true;
    toast.error('当前选中图片尚未生成可用的资产版本，请等待保存完成后重新选择图片');
    return false;
  }, [activeSkill, canvasSkillSourceVersionIds.length]);

  const handleEstimateSkill = useCallback(async (): Promise<void> => {
    if (!hasRequiredCanvasSkillSource()) return;
    const request = buildCanvasSkillRequest();
    if (!request) {
      toast.error('请先选择项目，并配置此 Skill 所需的聊天与图像模型');
      return;
    }
    await skillRun.estimateRun(request);
  }, [buildCanvasSkillRequest, hasRequiredCanvasSkillSource, skillRun]);

  const handleRestoreSkill = useCallback(async (record: SkillRunHistoryItem): Promise<void> => {
    if (!projectId || record.projectId !== projectId || record.surface !== 'canvas' || record.skillId !== activeSkill?.id) return;
    const restoredInputValues = record.inputValues ?? canvasSkillInputValues;
    const restoredRequest = buildCanvasSkillRequest({
      inputValues: restoredInputValues,
      sourceVersionIds: [...record.sourceVersionIds],
    });
    if (!restoredRequest) return;
    if (record.inputValues) setSkillParamValues(structuredClone(record.inputValues));
    skillProjectionControllerRef.current?.abort();
    activeCanvasSkillRunRef.current = null;
    const runId = await startCanvasSkillRun(
      skillProjectionCoordinatorRef.current,
      () => skillRun.restoreRun(record),
      projectId,
    );
    if (runId) {
      skillProjectionAttemptCountsRef.current.delete(runId);
      activeCanvasSkillRunRef.current = { runId, projectId, sourceVersionIds: [...record.sourceVersionIds], restoreDeletedPlacement: true, request: restoredRequest };
      setSkillProjectionRetry(value => value + 1);
    }
  }, [activeSkill?.id, buildCanvasSkillRequest, canvasSkillInputValues, projectId, skillRun]);

  const handleStartSkill = useCallback(async (): Promise<void> => {
    if (!hasRequiredCanvasSkillSource()) return;
    const request = buildCanvasSkillRequest();
    if (!request) {
      toast.error('请先选择项目，并配置此 Skill 所需的聊天与图像模型');
      return;
    }
    skillProjectionControllerRef.current?.abort();
    activeCanvasSkillRunRef.current = null;
    const sourceImageId = selectedCanvasImage?.id;
    const runId = await startCanvasSkillRun(
      skillProjectionCoordinatorRef.current,
      () => skillRun.startRun(request),
      request.projectId,
    );
    if (runId) {
      activeCanvasSkillRunRef.current = {
        runId,
        projectId: request.projectId,
        sourceVersionIds: [...request.sourceVersionIds],
        sourceImageId,
        request,
      };
    }
  }, [buildCanvasSkillRequest, hasRequiredCanvasSkillSource, selectedCanvasImage?.id, skillRun]);

  const handleLocateComplianceSource = useCallback((sourceVersionId: string): void => {
    const image = skillCanvasImagesRef.current.find(candidate => candidate.assetVersionId === sourceVersionId);
    if (!image) {
      toast.error('来源图片不在当前画布中');
      return;
    }
    onNavigateToImage?.(image.id);
  }, [onNavigateToImage]);

  const handleRecheckCompliance = useCallback(async (report: PlatformComplianceReportV1): Promise<void> => {
    const context = activeCanvasSkillRunRef.current;
    if (!context || !context.sourceVersionIds.includes(report.sourceVersionId)) {
      toast.error('无法确认报告来源，请从运行记录恢复后重试');
      return;
    }
    const idempotencyKey = typeof crypto.randomUUID === 'function'
      ? `canvas-skill:${crypto.randomUUID()}`
      : `canvas-skill:${Date.now()}`;
    const request = createPlatformComplianceRecheckRequest(context.request, idempotencyKey);
    skillProjectionControllerRef.current?.abort();
    const runId = await startCanvasSkillRun(
      skillProjectionCoordinatorRef.current,
      () => skillRun.startRun(request),
      request.projectId,
    );
    if (runId) {
      activeCanvasSkillRunRef.current = {
        runId,
        projectId: request.projectId,
        sourceVersionIds: [...request.sourceVersionIds],
        sourceImageId: context.sourceImageId,
        request,
      };
    }
  }, [skillRun]);

  useEffect(() => {
    const projection = skillRun.projection;
    if (!projection || projection.status !== 'completed') return;
    if (projection.runId !== activeCanvasSkillRunRef.current?.runId) return;
    const context = activeCanvasSkillRunRef.current;
    if (!context || context.projectId !== projectId || !skillProjectionCoordinatorRef.current.isActive(context.runId, context.projectId)) return;
    if (!receiveSkillOutput) {
      toast.error('画布暂时无法接收 Skill 资产版本');
      return;
    }
    const attempt = skillProjectionAttemptCountsRef.current.get(context.runId) ?? 0;
    if (attempt >= 2) return;
    skillProjectionAttemptCountsRef.current.set(context.runId, attempt + 1);
    const controller = new AbortController();
    skillProjectionControllerRef.current?.abort();
    skillProjectionControllerRef.current = controller;
    void loadCompletedCanvasSkillAssets({
      projectId: context.projectId,
      runId: context.runId,
      sourceVersionIds: context.sourceVersionIds,
      signal: controller.signal,
    }).then(async references => {
      if (
        controller.signal.aborted
        || activeCanvasSkillRunRef.current?.runId !== context.runId
        || activeCanvasSkillRunRef.current.projectId !== projectId
      ) return;
      for (const reference of references) {
        const assetVersionId = reference.assetVersionId;
        if (!assetVersionId || controller.signal.aborted) continue;
        await skillProjectionCoordinatorRef.current.project({
          runId: context.runId,
          projectId: context.projectId,
          assetVersionId,
          isAlreadyProjected: () => skillCanvasImagesRef.current.some(image => image.assetVersionId === assetVersionId),
          project: signal => Promise.resolve(receiveSkillOutput(reference, {
            sourceImageId: context.sourceImageId,
            runId: context.runId,
            sourceVersionIds: context.sourceVersionIds,
            restoreDeletedPlacement: context.restoreDeletedPlacement,
            signal,
          })),
        });
      }
    }).catch(error => {
      if (!controller.signal.aborted && activeCanvasSkillRunRef.current?.runId === context.runId) {
        toast.error(error instanceof Error ? error.message : 'Skill 结果加入画布失败');
        // A lost restore response may already have committed; retry needs a new history click.
        if (!context.restoreDeletedPlacement
          && (skillProjectionAttemptCountsRef.current.get(context.runId) ?? 0) < 2) {
          setSkillProjectionRetry(value => value + 1);
        }
      }
    });
    return () => controller.abort();
  }, [receiveSkillOutput, projectId, skillProjectionRetry, skillRun.projection]);

  useEffect(() => () => skillProjectionControllerRef.current?.abort(), []);

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
                        void addCanvasImageToChat(img, true);
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
                  const grouped: Record<string, typeof availableChatModels> = {};
                  availableChatModels.forEach(m => {
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
                {availableChatModels.length === 0 && (
                  <div className={`px-3 py-2 text-xs ${themeClasses.textMuted}`}>暂无可用聊天模型</div>
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
              onClick={() => {
                setIsAgentMode((enabled) => !enabled);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all shrink-0 ${
                isAgentMode
                  ? isGold
                    ? 'bg-gradient-to-r from-gold/20 to-amber-500/20 text-gold border border-gold/30'
                    : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 text-blue-600 border border-blue-200'
                  : isGold
                    ? 'text-gold-muted/50 hover:text-gold-muted border border-transparent hover:border-white/[0.08]'
                    : 'text-gray-400 hover:text-gray-600 border border-transparent hover:border-gray-200'
              }`}
              title={!isChatModelReady ? '请先配置聊天模型' : isAgentMode ? 'Agent模式已开启：描述需求自动调用工具生成成品' : '点击开启Agent模式：自然语言自动生图/修图/配音'}
              aria-pressed={isAgentMode}
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
                        scheduleChatSync('chat_agents', updated);
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
              onClick={handleCloseSkill}
              className={`ml-auto p-0.5 rounded transition-colors ${isGold ? 'hover:bg-[#333] text-gold-muted' : 'hover:bg-gray-200 text-gray-400'}`}
              title="退出技能模式"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* Messages - 精致设计 */}
        <div ref={messageListRef} onScroll={handleMessageListScroll} className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3 ${isGold ? 'bg-[#090909]' : 'bg-gray-50/50'}`}>
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
                  // Skill 的输入和运行留在 Skills 面板，普通聊天保持独立。
                  activeSkill ? (
                    <div className="flex flex-col items-center w-full max-w-[280px]">
                      <div className={`w-12 h-12 rounded-xl mb-2 flex items-center justify-center text-xl ${
                        isGold ? 'bg-gold/10 border border-gold/20' : 'bg-blue-50 border border-blue-100'
                      }`}>
                        {{image: '🖼', design: '🎨', brand: '🏢', storyboard: '🎬', editing: '✏️', custom: '⚡'}[activeSkill.category as 'image'|'design'|'brand'|'storyboard'|'editing'|'custom'] || '⚡'}
                      </div>
                      <h3 className={`text-sm font-semibold mb-0.5 ${themeClasses.text}`}>{activeSkill.name}</h3>
                      {activeSkill.category && (
                        <span className={`text-[10px] mb-1.5 ${themeClasses.textMuted} opacity-60`}>{activeSkill.category}</span>
                      )}
                      <div className={`w-full rounded-lg p-2.5 mb-3 text-center ${
                        isGold ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-gray-50 border border-gray-100'
                      }`}>
                        <p className={`text-xs leading-relaxed ${themeClasses.textMuted}`}>
                          请在 Skills 面板填写结构化输入并运行；这里仍是普通聊天。
                        </p>
                      </div>
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
            <>
              {!showFullHistory && messages.length > CHAT_RENDER_WINDOW && (
                <button
                  type="button"
                  onClick={() => setShowFullHistory(true)}
                  className={`mx-auto block px-2 py-1 text-xs ${isGold ? 'text-gold-muted hover:text-gold' : 'text-blue-500 hover:text-blue-600'}`}
                >
                  显示早期消息 ({messages.length - CHAT_RENDER_WINDOW})
                </button>
              )}
            {visibleMessages.map(message => (
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
                              onClick={() => {
                                void addGeneratedImageToCanvas(imgUrl, message);
                              }}
                              title="点击添加到画布"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                            {/* 悬浮操作按钮 */}
                            <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover/chat-img:opacity-100 transition-opacity">
                              {onAddImages && (
                                <button
                                  aria-label="添加到画布"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void addGeneratedImageToCanvas(imgUrl, message);
                                  }}
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
                  {message.agentRunId && (
                    <div className="mt-3">
                      <AgentRunMessageProgress runId={message.agentRunId} />
                    </div>
                  )}
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
            ))}
            </>
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
                              void addCanvasImageToChat(img, true);
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
                                providerId: m.providerId,
                                compositeKey: `${m.providerId}::${modelId}`,
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
            {isLoading ? (
              <button
                onClick={() => {
                  abortControllerRef.current?.abort();
                }}
                className={`shrink-0 h-7 px-2 rounded-md flex items-center justify-center gap-1 text-[11px] font-medium transition-all ${
                  isGold
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                    : 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200'
                }`}
                title="停止生成"
              >
                <Square size={11} className="fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading || !isChatModelReady}
                className={`shrink-0 h-7 px-2 rounded-md flex items-center justify-center text-[11px] font-medium transition-all ${
                  !input.trim() || !isChatModelReady
                    ? isGold
                      ? 'bg-white/[0.03] text-white/20 cursor-not-allowed'
                      : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : isGold
                      ? 'bg-gold text-black hover:opacity-90 shadow-md shadow-gold/20'
                      : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
                }`}
                title={isChatModelReady ? '发送 (Enter)' : '请先配置聊天模型'}
              >
                <Send size={14} />
              </button>
            )}
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
              <CanvasSkillSaveForm
                themeStyle={themeStyle}
                name={skillSaveName}
                description={skillSaveDescription}
                onNameChange={setSkillSaveName}
                onDescriptionChange={setSkillSaveDescription}
                onSave={() => { void handleSaveAsSkill(); }}
                onCancel={() => setShowSkillSaveDialog(false)}
              />
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

            {skillCatalogError && (
              <div role="alert" className="text-xs text-red-500 flex items-center justify-between gap-2">
                <span>{skillCatalogError}</span>
                <button type="button" onClick={() => { void loadCanvasSkills(); }}>重试</button>
              </div>
            )}

            {activeSkill && (
              <div className={`rounded-lg p-3 space-y-3 ${
                isGold ? 'bg-white/[0.03] border border-gold/20' : 'bg-white border border-blue-200'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className={`text-xs font-medium ${themeClasses.text}`}>{activeSkill.name}</div>
                    <div className={`text-[10px] mt-0.5 ${themeClasses.textMuted}`}>{activeSkill.description}</div>
                  </div>
                  <button
                    type="button"
                    title="关闭 Skill"
                    onClick={handleCloseSkill}
                    className={`p-1 rounded ${themeClasses.textMuted}`}
                  >
                    <X size={12} />
                  </button>
                </div>
                <SkillInputFields
                  fields={activeSkill.inputs}
                  values={canvasSkillInputValues}
                  onChange={(key, value) => setSkillParamValues(current => ({ ...current, [key]: value }))}
                  disabled={skillRun.busy || Boolean(skillRun.runId && skillRun.projection?.status !== 'completed' && skillRun.projection?.status !== 'failed' && skillRun.projection?.status !== 'cancelled' && skillRun.projection?.status !== 'timeout')}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-8 flex-1 text-xs" onClick={() => { void handleEstimateSkill(); }} disabled={skillRun.busy}>
                    估算积分
                  </Button>
                  <Button type="button" className="h-8 flex-1 text-xs" onClick={() => { void handleStartSkill(); }} disabled={skillRun.busy}>
                    运行 Skill
                  </Button>
                </div>
                {skillRun.error && <div role="alert" className="text-xs text-red-500">{skillRun.error}</div>}
                {projectId && <SkillRunHistory
                  projectId={projectId}
                  surface="canvas"
                  skillId={activeSkill.id}
                  accountKey={skillAccountKey}
                  activeRunId={skillRun.runId}
                  refreshKey={`${skillRun.runId || ''}:${skillRun.projection?.status || ''}`}
                  busy={skillRun.busy}
                  onSelect={handleRestoreSkill}
                />}
                <SkillRunProgress
                  estimate={skillRun.estimate}
                  projection={skillRun.projection}
                  retryableStepId={skillRun.retryableStepId}
                  retryabilityError={skillRun.retryabilityError}
                  stale={skillRun.stale}
                  busy={skillRun.busy}
                  onPause={() => { void skillRun.pause(); }}
                  onResume={() => { void skillRun.resume(); }}
                  onCancel={() => { void skillRun.cancel(); }}
                  onRetry={stepId => { void skillRun.retry(stepId); }}
                  onRefreshRetryability={skillRun.refreshRetryability}
                  projectId={projectId}
                  onLocateComplianceSource={handleLocateComplianceSource}
                  onRecheckCompliance={report => { void handleRecheckCompliance(report); }}
                />
              </div>
            )}

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
                  return chatSkills
                    .filter(skill => skill.builtIn && skill.enabled && skill.allowedSurfaces.includes('canvas'))
                    .filter((s: SkillDefinition) => !skillCategoryFilter || s.category === skillCategoryFilter)
                    .filter((s: SkillDefinition) => !skillSearchQuery || s.name.includes(skillSearchQuery) || s.description.includes(skillSearchQuery))
                    .map((skill: SkillDefinition) => {
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
              .filter(s => !s.builtIn)
              .filter(s => !skillCategoryFilter || s.category === skillCategoryFilter)
              .filter(s => !skillSearchQuery || s.name.includes(skillSearchQuery) || s.description.includes(skillSearchQuery))
              .length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-medium ${themeClasses.textMuted}`}>
                    我的 Skills
                  </div>
                  <button
                    onClick={() => { if (confirm('确认清空所有自定义 Skills？')) void handleClearUserSkills(); }}
                    className={`text-[10px] ${themeClasses.textMuted} hover:text-red-400 transition-colors`}
                  >
                    清空
                  </button>
                </div>
                {chatSkills
                  .filter(s => !s.builtIn)
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
                          type="button"
                          onClick={() => { void handleToggleSkill(skill); }}
                          className={`p-1 rounded transition-colors ${
                            skill.enabled
                              ? isGold ? 'text-green-400 hover:bg-green-400/10' : 'text-green-600 hover:bg-green-50'
                              : themeClasses.textMuted
                          }`}
                          title={skill.enabled ? '停用' : '启用'}
                        >
                          {skill.enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                        </button>
                        <button
                          onClick={() => handleUseSkill(skill)}
                          disabled={!skill.enabled}
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
            {chatSkills.every(skill => skill.builtIn) && (!skillCategoryFilter || !['image', 'design', 'brand', 'storyboard'].includes(skillCategoryFilter)) && (
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
      {/* AgentBuilderDialog 通过 portal 挂到 document.body，逃出右侧面板 fixed stacking context */}
      {portalReady && createPortal(
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
              scheduleChatSync('chat_agents', updated);
              return updated;
            });
          }}
        />,
        document.body
      )}
    </div>
  );
}
