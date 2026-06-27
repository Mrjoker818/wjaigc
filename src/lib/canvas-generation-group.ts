import { getModelSpecificPixelSize } from './api-compatibility';

/**
 * Canvas Generation Group — 画布生图组数据类型与工具函数
 *
 * 调整2/3的核心概念：
 * - Alt+左键点击图片 → 创建「参考图组」(reference)
 * - Ctrl+左键点击图片 → 创建「参考融图组」(fusion)
 * - 组包含：参考图片列表 + 连接线 + 空白结果框 + 工具栏
 */

// 参考类别（与功能区参考图功能一致）
export const REFERENCE_CATEGORIES = [
  'style', 'composition', 'scene', 'color', 'subject', 'detail'
] as const;
export const REFERENCE_CATEGORY_LABELS: Record<string, string> = {
  style: '风格',
  composition: '构图',
  scene: '场景',
  color: '色彩',
  subject: '主体',
  detail: '细节',
};
export type ReferenceCategory = typeof REFERENCE_CATEGORIES[number];

// 单张参考图在组中的配置
export interface GroupRefImage {
  imageId: string;           // 画布图片ID
  url: string;               // 图片URL
  number: number;            // 编号 R1/R2/...
  categories: ReferenceCategory[];  // 选中的参考类别
  strengths: Record<string, number>;  // 每个类别的强度 0-100
}

// 生图组的类型
export type GenGroupType = 'reference' | 'fusion';

// 生图组状态
export type GenGroupStatus = 'idle' | 'generating' | 'completed';

// 工具栏配置
export interface GenGroupToolbar {
  model: string;
  providerId?: string;
  providerName?: string;   // 提供商显示名称
  aspectRatio: string;     // 如 "1:1"
  size: string;            // 如 "1024x1024"
  quality: string;
  outputCount: number;     // 1-4 (also referred to as 'n')
  n?: number;              // alias for outputCount
  prompt: string;
  negativePrompt?: string;
}

// 结果占位框
export interface ResultPlaceholder {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: string;     // 如 "1:1", "16:9"
  imageId?: string;        // 占位图片ID（画布上的processing placeholder）
  isProcessing?: boolean;  // 是否正在生成
  progress?: number;       // 生成进度 0-100
  resultUrl?: string;      // 生成完成后的图片URL
  startedAt?: number;      // 生成开始时间戳(ms)
  errorMsg?: string;       // 错误信息
}

// 生图组 — 画布上的一个视觉组合
export interface CanvasGenGroup {
  id: string;                // 唯一ID
  type: GenGroupType;        // reference(Alt) / fusion(Ctrl)
  status: GenGroupStatus;    // 空闲/生成中/完成

  // 参考图列表（最多14张）
  refImages: GroupRefImage[];

  // 来源图片ID列表（用于快速查找）
  sourceImageIds: string[];

  // 结果框占位符
  resultPlaceholder: ResultPlaceholder;

  // 组的位置（用于整体拖动）
  position: {
    x: number;
    y: number;
    sourceCenterX?: number;
    sourceCenterY?: number;
    resultX?: number;
    resultY?: number;
  };

  // 工具栏设置
  toolbar: GenGroupToolbar;

  // 每张源图的参考类别和强度
  sourceCategories: Record<string, ReferenceCategory[]>;    // imageId → 选中类别
  sourceStrengths: Record<string, Record<string, number>>;  // imageId → { category: strength }

  // 生成结果（完成后）
  resultImageIds?: string[];

  // 折叠状态
  isCollapsed?: boolean;

  // 展开的参考图类别设置 (imageId → boolean)
  expandedRefImages?: Record<string, boolean>; // deprecated, kept for backward compat

  // 创建时间
  createdAt: number;
}

// 连接线节点类型
export interface ConnectionLine {
  groupId: string;
  fromImageId: string;       // 参考图ID
  toFrameId: string;         // 结果框对应的placeholder图片ID
}

// ============ 模型配置映射（共享） ============

/** 各模型支持的画面比例（按官方API文档严格配置）
 *
 * 数据来源（2025-05 官方文档 + OpenAI兼容代理实测）:
 *
 * 【火山方舟 直连API】
 * - Seedream 4.0/4.5: size="1K"|"2K"|"4K" 或宽高像素值
 *   推荐比例: 1:1(2048x2048) 4:3(2304x1728) 3:4(1728x2304)
 *            16:9(2560x1440) 9:16(1440x2560) 3:2(2496x1664)
 *            2:3(1664x2496) 21:9(3024x1296)
 * - Seedream 3.0: 仅支持像素值 size="1024x1024"等，总像素范围[512x512, 2048x2048]
 *   推荐比例: 1:1(1024x1024) 4:3(1152x864) 3:4(864x1152)
 *            16:9(1280x720) 9:16(720x1280) 3:2(1248x832) 2:3(832x1248) 21:9(1512x648)
 * - Seedance 4.5: size="2K"|"4K"，总像素范围[2560x1440, 4096x4096]
 *   推荐比例同Seedream 4.5，但最小2K起步
 *
 * 【OpenAI兼容代理 (DMXAPI等)】
 * - Seedream 4: 仅支持 1024x1024, 1664x936, 936x1664 → 1:1, 16:9, 9:16
 * - Seedream 3: 仅支持 1024x1024, 1024x768, 768x1024 → 1:1, 4:3, 3:4
 *   注意：通过代理不支持1K/2K/4K简写
 *
 * 【OpenAI 官方】
 * - GPT Image 2: size=1024x1024, 1536x1024, 1024x1536, 2048x1152, 1152x2048, auto
 *   → 1:1, 3:2, 2:3, 16:9, 9:16   quality=auto|low|medium|high
 * - DALL-E 3: size=1024x1024, 1792x1024, 1024x1792
 *   → 1:1, 16:9(≈), 9:16(≈)      quality=standard|hd
 *
 * 【BFL Flux】
 * - Flux 1.1 Pro: width/height自由(步长32, 256-2048)，无quality
 * - Flux 1.1 Pro Ultra: aspect_ratio="1:1"|"4:3"|"3:4"|"16:9"|"9:16"|"3:2"|"2:3"，4MP输出，无quality
 * - Flux 2: width/height自由，无quality
 *
 * 【Google Gemini/Imagen】
 * - Gemini 图片生成: aspectRatio参数 + outputOptions控制尺寸
 * - Imagen 4/4 Ultra: aspectRatio + outputMimeType，支持1:1 3:4 4:3 9:16 16:9
 *
 * 【Ideogram】
 * - Ideogram 3.0: aspect_ratio参数 + rendering_speed
 */
export const MODEL_ASPECT_RATIOS: Record<string, string[]> = {
    // ===== Seedream 4.0/4.5 系列 =====
    // 火山方舟直连API: 支持全部8种推荐比例 (size=1K/2K/4K或像素值)
    // OpenAI兼容代理: 仅支持 1:1, 16:9, 9:16 三种 (1024x1024, 1664x936, 936x1664)
    // 这里按直连API配置，代理由后端api-compatibility自动适配
    'doubao-seedream-4-5': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'doubao-seedream-4': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedream-4-5': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedream-4': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    // Seedream 3.0: 总像素[512x512, 2048x2048]，推荐比例同4.0但像素更小
    // OpenAI兼容代理: 仅 1:1, 4:3, 3:4 (1024x1024, 1024x768, 768x1024)
    'doubao-seedream-3': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedream-3': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    // Seedream 5.0 系列 — 火山方舟直连API: 支持全部8种推荐比例 (size=1K/2K/3K/4K)
    'doubao-seedream-5-0-lite': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'doubao-seedream-5-0': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedream-5-0-lite': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedream-5': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    // Seedance 4.5: size=2K/4K，最小2560x1440起步，同Seedream 4.5比例
    'doubao-seedance-4-5': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
    'seedance': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],

    // ===== GPT Image 系列 =====
    // 官方: 1024x1024(1:1), 1536x1024(3:2), 1024x1536(2:3), 2048x1152(16:9), 1152x2048(9:16)
    'gpt-image-2': ['1:1', '3:2', '2:3', '16:9', '9:16'],
    'gpt-image-1': ['1:1', '3:2', '2:3', '16:9', '9:16'],

    // ===== DALL-E 3 =====
    // 官方: 1024x1024(1:1), 1792x1024(≈16:9), 1024x1792(≈9:16)
    // 注意: 1792x1024 约为 1.75:1，不是精确16:9，但OpenAI将其归类为横版
    'dall-e-3': ['1:1', '16:9', '9:16'],

    // ===== Gemini 系列 =====
    // Gemini 图片生成: aspectRatio参数支持多种比例
    'gemini-2.5-flash-preview-image-generation': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'gemini-2.5-pro-preview-image-generation': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'gemini-3-pro-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'gemini-3-flash-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'gemini-3.1-flash-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],

    // ===== Imagen 系列 =====
    // Imagen 4: aspectRatio 1:1, 3:4, 4:3, 9:16, 16:9
    'imagen-4-ultra': ['1:1', '4:3', '3:4', '16:9', '9:16'],
    'imagen-4': ['1:1', '4:3', '3:4', '16:9', '9:16'],
    'imagen-3': ['1:1', '4:3', '3:4', '16:9', '9:16'],

    // ===== Flux 系列 =====
    // Flux 1.1 Pro: width/height自由(步长32, 范围256-2048) — 无质量参数
    'flux-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'flux-1.1-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    // Flux 1.1 Pro Ultra: aspect_ratio参数，4MP输出 — 无质量参数
    'flux-pro-ultra': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'flux-1.1-pro-ultra': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    // Flux 2: width/height自由 — 无质量参数
    'flux-2': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    // Flux Dev/Schnell: width/height自由
    'flux-dev': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'flux-schnell': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'flux': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],

    // ===== Stable Diffusion 系列 =====
    // SDXL: 推荐 1024x1024, 但支持自由尺寸
    'stable-diffusion': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'sd-xl': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'sdxl': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'sd-3': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],

    // ===== Midjourney =====
    // --ar 参数支持任意比例
    'midjourney': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],

    // ===== 可灵 Kling =====
    'kling': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],

    // ===== Ideogram =====
    // Ideogram 3.0: aspect_ratio参数，支持广泛比例
    'ideogram': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '3:1', '1:3'],

    // ===== HiDream =====
    'hidream': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],

    // ===== PearAPI Nano Banana 系列 =====
    // 基于 Gemini 的图像模型，支持多种画面比例
    'nano-banana': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'nano-banana-2': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'nano-banana-2-4k': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'nano-banana-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'nano-banana-pro-4k': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
};

/** 各模型支持的质量/分辨率档位（按官方API文档严格配置）
 *
 * 关键说明:
 * - Seedream 4.0/4.5 (直连API): size="1K"|"2K"|"4K"
 * - Seedream 3.0 (直连API): 仅支持像素值，不支持1K/2K/4K简写，最大2048x2048
 *   → 前端按 "1K"/"2K" 显示，后端转换为像素值
 * - Seedance 4.5 (直连API): size="2K"|"4K" (最小2K起步)
 * - GPT Image 2: quality="auto"|"low"|"medium"|"high"
 * - DALL-E 3: quality="standard"|"hd"
 * - Flux 系列: 无quality参数 (分辨率由width/height直接控制)
 * - Gemini/Imagen: 无独立quality参数 (分辨率由outputOptions控制)
 * - Ideogram: rendering_speed="DEFAULT"|"TURBO" (非quality概念，不设条目)
 * - Midjourney: 无quality参数
 * - SDXL: quality概念来自第三方代理，非官方标准
 */
export const MODEL_QUALITIES: Record<string, string[]> = {
    // ===== Seedream 4.0/4.5 系列 =====
    // 火山方舟直连API
    // Seedream 4.0: size="1K"|"2K"|"4K" (1K=1024档, 2K=2048档, 4K=4096档)
    // Seedream 4.5: size="2K"|"4K" (最小2K起步，不支持1K)
    // Ref: https://www.volcengine.com/docs/6492/2172373
    'doubao-seedream-4-5': ['2K', '4K'],
    'seedream-4-5': ['2K', '4K'],
    'doubao-seedream-4': ['1K', '2K', '4K'],
    'seedream-4': ['1K', '2K', '4K'],
    // Seedream 3.0: 直连API仅支持像素值(默认1024x1024, 最大2048x2048)
    // 不支持4K (超出2048限制)，前端按1K/2K显示
    'doubao-seedream-3': ['1K', '2K'],
    'seedream-3': ['1K', '2K'],
    // Seedream 5.0 Lite — 火山方舟直连API: size="2K"|"3K"
    // Ref: https://www.volcengine.com/docs/6492/2172373
    // 官方文档明确: 仅支持 2K 和 3K，不支持 1K 和 4K
    'doubao-seedream-5-0-lite': ['2K', '3K'],
    'seedream-5-0-lite': ['2K', '3K'],
    // Seedream 5.0 (非lite) — 火山方舟直连API: size="2K"|"4K"
    // 官方: 2K直出 + 4K AI增强，不支持 1K 和 3K
    'doubao-seedream-5-0': ['2K', '4K'],
    'seedream-5': ['2K', '4K'],
    // Seedance 4.5: 直连API size="2K"|"4K" (最小2560x1440起步)
    'doubao-seedance-4-5': ['2K', '4K'],
    'seedance': ['2K', '4K'],

    // ===== GPT Image 系列 =====
    // 官方: quality="auto"|"low"|"medium"|"high"
    'gpt-image-2': ['auto', 'low', 'medium', 'high'],
    'gpt-image-1': ['auto', 'low', 'medium', 'high'],

    // ===== DALL-E 3 =====
    // 官方: quality="standard"|"hd"
    'dall-e-3': ['standard', 'hd'],

    // ===== Gemini/Imagen 系列 =====
    // Gemini 2.5 Flash: image_size 仅 "1K"(1024px)
    // Gemini 3.0 Pro: image_size "1K"|"2K" (官方: 1K=1024, 2K=2048)
    // Gemini 3.1 Flash: image_size "1K"|"2K"|"4K"
    // Ref: https://ai.google.dev/gemini-api/docs/image-generation
    'gemini-2.5-flash-image': ['1K'],
    'gemini-2.5-pro-image': ['1K', '2K'],
    'gemini-3-flash-image': ['1K'],
    'gemini-3-pro-image': ['1K', '2K'],
    'gemini-3.1-flash-image': ['1K', '2K', '4K'],
    // Imagen 3: 输出分辨率 1024px
    // Imagen 4/4 Ultra: 输出分辨率 1024|2048
    // Ref: https://cloud.google.com/vertex-ai/generative-ai/docs/image-generation
    'imagen-3': ['1K'],
    'imagen-4': ['1K', '2K'],
    'imagen-4-ultra': ['1K', '2K'],

    // ===== Flux 系列 =====
    // fal.ai API: image_size = "square_hd"|"square"|"portrait_4_3"|"portrait_16_9"|"landscape_4_3"|"landscape_16_9"
    // BFL API: 类似预设 + 自定义宽高
    // 不设置quality条目，分辨率通过 image_size 预设控制

    // ===== Stable Diffusion 系列 =====
    // SDXL 官方分辨率: 1024x1024, 1152x896, 1216x832, 1344x768, 1536x640
    // 部分代理支持 standard/hd，非官方标准
    'stable-diffusion': ['standard', 'hd'],
    'sd-xl': ['standard', 'hd'],
    'sdxl': ['standard', 'hd'],
    'sd-3': ['standard', 'hd'],

    // ===== Midjourney =====
    // 无quality参数，分辨率通过 --ar 控制

    // ===== 可灵 Kling =====
    // Kling V3: resolution = "1K"|"2K", aspect_ratio = "16:9"|"9:16"|"1:1"
    // Kling V3 Omni: resolution = "1K"|"2K"|"4K"
    // Ref: https://platform.kuaishou.com/docs/image-generation
    'kling-v3': ['1K', '2K'],
    'kling-v3-omni': ['1K', '2K', '4K'],
    'kling': ['1K', '2K'],

    // ===== Ideogram =====
    // 官方参数: aspect_ratio="1x1"|"16x9"|... + rendering_speed="TURBO"|"DEFAULT"|"QUALITY"
    // 69种尺寸选择，分辨率由 aspect_ratio 决定
    'ideogram': ['standard', 'quality'],
    'ideogram-3': ['standard', 'quality'],

    // ===== HiDream =====
    // 支持最大 2048x2048
    'hidream': ['1K', '2K'],

    // ===== PearAPI Nano Banana 系列 =====
    // 基于 Gemini 的图像模型，通过 OpenAI 兼容 /images/generations 调用
    // nano-banana: 基础版 (Gemini 2.5 Flash Image)，仅 1K
    // nano-banana-2: 进阶版 (Gemini 3.1 Flash Image)，支持 1K/2K
    // nano-banana-2-4k: 4K版，支持 1K/2K/4K
    // nano-banana-pro: 专业版 (Gemini 3 Pro Image)，支持 1K/2K
    // nano-banana-pro-4k: 专业4K版，支持 1K/2K/4K
    'nano-banana': ['1K'],
    'nano-banana-2': ['1K', '2K'],
    'nano-banana-2-4k': ['1K', '2K', '4K'],
    'nano-banana-pro': ['1K', '2K'],
    'nano-banana-pro-4k': ['1K', '2K', '4K'],
};

/** 质量档位到显示名称的映射 */
export const QUALITY_DISPLAY_NAMES: Record<string, string> = {
    'auto': '自动',
    'low': '低',
    'medium': '中',
    'high': '高',
    'standard': '标准',
    'hd': '高清',
    'quality': '高质量',
    '1K': '1K',
    '2K': '2K',
    '3K': '3K',
    '4K': '4K',
};

/** 各模型质量/分辨率对应的实际像素尺寸 */
export const QUALITY_TO_SIZE: Record<string, Record<string, string>> = {
    // DALL-E 系列
    'dall-e-3': {
        'standard': '1024px',
        'hd': '1024px 细节增强'
    },
    // Gemini 系列 — 官方通过 image_size 参数控制分辨率
    // Gemini 2.5 Flash: 仅 1K (1024px)
    // Ref: https://ai.google.dev/gemini-api/docs/image-generation
    'gemini-2.5-flash-image-preview': {
        '1K': '1024'
    },
    'gemini-2.5-flash-image': {
        '1K': '1024'
    },
    // Gemini 2.5 Pro: 1K, 2K
    'gemini-2.5-pro-image-preview': {
        '1K': '1024',
        '2K': '2048'
    },
    'gemini-2.5-pro-image': {
        '1K': '1024',
        '2K': '2048'
    },
    // Gemini 3.0 Pro: 1K, 2K
    'gemini-3-pro-image-preview': {
        '1K': '1024',
        '2K': '2048'
    },
    'gemini-3-pro-image': {
        '1K': '1024',
        '2K': '2048'
    },
    // Gemini 3.0 Flash: 仅 1K
    'gemini-3-flash-image-preview': {
        '1K': '1024'
    },
    'gemini-3-flash-image': {
        '1K': '1024'
    },
    // Gemini 3.1 Flash: 1K, 2K, 4K
    'gemini-3.1-flash-image-preview': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    'gemini-3.1-flash-image': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    // Imagen 系列 — Google Vertex AI
    // Imagen 3: 输出分辨率 1024px
    // Imagen 4/4 Ultra: 输出分辨率 1024|2048
    'imagen-3': {
        '1K': '1024'
    },
    'imagen-4': {
        '1K': '1024',
        '2K': '2048'
    },
    'imagen-4-ultra': {
        '1K': '1024',
        '2K': '2048'
    },
    // Seedream 4.5 — 火山方舟: size="2K"|"4K" (最小2K起步)
    'doubao-seedream-4-5': {
        '2K': '2048',
        '4K': '4096'
    },
    'seedream-4-5': {
        '2K': '2048',
        '4K': '4096'
    },
    // Seedream 4.0 — 火山方舟: size="1K"|"2K"|"4K"
    'doubao-seedream-4': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    'seedream-4': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    // Seedream 3.0 — 像素范围 [512, 2048]
    'doubao-seedream-3': {
        '1K': '1024',
        '2K': '2048'
    },
    // Seedream 5.0 Lite — 火山方舟: size="2K"|"3K"
    'doubao-seedream-5-0-lite': {
        '2K': '2048',
        '3K': '3072'
    },
    // Seedream 5.0 (非lite) — 火山方舟: size="2K"|"4K"
    'doubao-seedream-5-0': {
        '2K': '2048',
        '4K': '4096'
    },
    'seedream-5-0-lite': {
        '2K': '2048',
        '3K': '3072'
    },
    'seedream-5': {
        '2K': '2048',
        '4K': '4096'
    },
    // Seedance 4.5 — 视频生图模型
    'doubao-seedance-4-5': {
        '2K': '2048',
        '4K': '4096'
    },
    // GPT-Image 系列 — quality独立于size
    // 官方: quality="auto"|"low"|"medium"|"high"，size="1024x1024"|"1536x1024"|"1024x1536"|"auto"
    // Ref: https://platform.openai.com/docs/api-reference/images/create
    'gpt-image-2-official': {
        'auto': 'auto (推荐尺寸)',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    'gpt-image-2': {
        'auto': 'auto (推荐尺寸)',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    'gpt-image-1': {
        'auto': 'auto (推荐尺寸)',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    // Stable Diffusion 系列 — SDXL官方分辨率: 1024x1024, 1152x896, 1216x832, 1344x768, 1536x640
    // 部分代理支持 standard/hd
    'stable-diffusion': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    'sd-xl': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    'sdxl': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    'sd-3': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    // Flux 系列 — fal.ai: image_size = "square_hd"|"square"|"portrait_4_3"|"portrait_16_9"|"landscape_4_3"|"landscape_16_9"
    // 分辨率由 image_size 预设决定，非quality参数
    'flux': {
        'standard': '1024 (预设尺寸)',
        'hd': '1024 细节增强'
    },
    'flux-pro': {
        'standard': '1024 (预设尺寸)',
        'hd': '1024 细节增强'
    },
    'flux-dev': {
        'standard': '1024 (预设尺寸)',
        'hd': '1024 细节增强'
    },
    'flux-schnell': {
        'standard': '1024'
    },
    // Midjourney
    'midjourney': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    // 可灵 Kling — 官方 resolution 参数
    // Kling V3: resolution="1K"|"2K"
    // Kling V3 Omni: resolution="1K"|"2K"|"4K"
    // Ref: https://platform.kuaishou.com/docs/image-generation
    'kling-v3': {
        '1K': '1024',
        '2K': '2048'
    },
    'kling-v3-omni': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    'kling': {
        '1K': '1024',
        '2K': '2048'
    },
    // Ideogram — 官方 rendering_speed 参数
    // rendering_speed="DEFAULT"|"TURBO"|"QUALITY"，非分辨率概念
    // 69种尺寸选择由 aspect_ratio 决定
    'ideogram': {
        'standard': '1024 (默认速度)',
        'quality': '1024 (高质量)'
    },
    'ideogram-3': {
        'standard': '1024 (默认速度)',
        'quality': '1024 (高质量)'
    },
    // HiDream — 支持最大 2048x2048
    'hidream': {
        '1K': '1024',
        '2K': '2048'
    },
    // ===== PearAPI Nano Banana 系列 =====
    // 基于 Gemini 的图像模型，分辨率参数映射
    'nano-banana': {
        '1K': '1024'
    },
    'nano-banana-2': {
        '1K': '1024',
        '2K': '2048'
    },
    'nano-banana-2-4k': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    'nano-banana-pro': {
        '1K': '1024',
        '2K': '2048'
    },
    'nano-banana-pro-4k': {
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
};

/** 画面比例到默认像素尺寸的映射 */
export const ASPECT_RATIO_TO_PIXELS: Record<string, string> = {
    '1:1': '1024x1024',
    '4:3': '1536x1024',
    '3:4': '1024x1536',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '21:9': '2048x878',
    '9:21': '878x2048',
    '2:1': '2048x1024',
    '1:2': '1024x2048',
    '4:5': '1024x1280',
    '5:4': '1280x1024',
};

/** 默认画面比例列表 */
export const DEFAULT_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];

/** 默认质量列表 */
export const DEFAULT_QUALITIES = ['standard', 'hd'];

/** 模糊匹配模型配置键名 — 支持纯 modelId 匹配到带后缀的配置 */
export function findModelConfig<T>(map: Record<string, T>, modelId: string): T | undefined {
    // 1. 精确匹配
    if (map[modelId] !== undefined) return map[modelId];
    const lowerId = modelId.toLowerCase();
    // 2. 优先长键匹配（如 "gpt-image-2" 匹配 "gpt-image-2-official" 优先于 "gpt-image"）
    const matches: Array<{ key: string; len: number }> = [];
    for (const key of Object.keys(map)) {
        const lowerKey = key.toLowerCase();
        if (lowerId === lowerKey) {
            matches.push({ key, len: key.length });
        } else if (lowerId.includes(lowerKey) || lowerKey.includes(lowerId)) {
            matches.push({ key, len: key.length });
        }
    }
    if (matches.length > 0) {
        // 返回最长匹配（更精确）
        matches.sort((a, b) => b.len - a.len);
        return map[matches[0].key];
    }
    // 3. 前缀匹配（如 "gpt-image-2" 匹配 "gpt-image"）
    for (const key of Object.keys(map)) {
        const shortKey = key.split('-').slice(0, -1).join('-');
        if (shortKey && (lowerId.startsWith(shortKey) || key.startsWith(lowerId.split('-').slice(0, -1).join('-')))) {
            return map[key];
        }
    }
    return undefined;
}

// ============ 工具函数 ============

let _groupCounter = 0;

/** 生成唯一组ID */
export function generateGroupId(): string {
  return `gen-group-${Date.now()}-${++_groupCounter}`;
}

/** 为参考图创建默认配置 */
export function createGroupRefImage(
  imageId: string,
  url: string,
  number: number,
  defaultCategories: ReferenceCategory[] = ['style', 'composition']
): GroupRefImage {
  const strengths: Record<string, number> = {
    'style': 0, 'composition': 0, 'scene': 0, 'color': 0, 'subject': 0, 'detail': 0
  };
  return {
    imageId,
    url,
    number,
    categories: [...defaultCategories],
    strengths,
  };
}

/** 根据宽高比和模型尺寸配置计算实际像素尺寸
 *  委托给 api-compatibility.ts 的 getModelSpecificPixelSize 确保前后端一致 */
export function calculateActualPixels(
  aspectRatio: string,
  quality: string = 'standard',
  modelId?: string
): string {
  // 委托给规范数据源，确保前端显示与后端请求一致
  // 使用后端规范表（api-compatibility.ts）查模型精确像素
  if (modelId) {
    const result = getModelSpecificPixelSize(aspectRatio, quality, modelId);
    if (result) return result;
  }

  // 默认回退：根据比例计算
  const ratioMap: Record<string, [number, number]> = {
    '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4],
    '16:9': [16, 9], '9:16': [9, 16], '3:2': [3, 2], '2:3': [2, 3],
    '21:9': [21, 9], '9:21': [9, 21],
  };
  const [rw, rh] = ratioMap[aspectRatio] || [1, 1];
  const base = 1024;
  const w = rw >= rh ? base : Math.round(base * rw / rh);
  const h = rw >= rh ? Math.round(base * rh / rw) : base;
  return `${w}x${h}`;
}



export function aspectRatioToDimensions(
  aspectRatio: string,
  baseSize: number = 512
): { width: number; height: number } {
  const ratioMap: Record<string, [number, number]> = {
    '1:1': [1, 1],
    '4:3': [4, 3],
    '3:4': [3, 4],
    '16:9': [16, 9],
    '9:16': [9, 16],
    '3:2': [3, 2],
    '2:3': [2, 3],
    '21:9': [21, 9],
    '9:21': [9, 21],
  };
  const [rw, rh] = ratioMap[aspectRatio] || [1, 1];
  if (rw >= rh) {
    return { width: baseSize, height: Math.round(baseSize * rh / rw) };
  }
  return { width: Math.round(baseSize * rw / rh), height: baseSize };
}

/** 计算结果框在参考图组右侧的位置 */
export function calculateResultFramePosition(
  refImages: { x: number; y: number; width: number; height: number }[],
  aspectRatio: string,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; width: number; height: number } {
  if (refImages.length === 0) {
    return { x: 400, y: 200, width: 512, height: 512 };
  }

  // 取所有参考图的边界框
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const img of refImages) {
    minX = Math.min(minX, img.x);
    minY = Math.min(minY, img.y);
    maxX = Math.max(maxX, img.x + img.width);
    maxY = Math.max(maxY, img.y + img.height);
  }

  const gap = 200; // 间距
  const dims = aspectRatioToDimensions(aspectRatio);

  // 结果框放在参考图右侧
  return {
    x: maxX + gap,
    y: minY + (maxY - minY) / 2 - dims.height / 2,
    width: dims.width,
    height: dims.height,
  };
}

/** 计算连接线的路径点（从参考图中心到结果框左侧中点） */
export function calculateConnectionPoints(
  fromRect: { x: number; y: number; width: number; height: number },
  toRect: { x: number; y: number; width: number; height: number }
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  return {
    from: {
      x: fromRect.x + fromRect.width / 2,
      y: fromRect.y + fromRect.height / 2,
    },
    to: {
      x: toRect.x,
      y: toRect.y + toRect.height / 2,
    },
  };
}

/** 创建一个新的生图组 */
export function createGenGroup(
  type: GenGroupType,
  refImages: GroupRefImage[],
  resultPlaceholder: ResultPlaceholder,
  position: { x: number; y: number },
  toolbar?: Partial<GenGroupToolbar>,
  sourceCategories?: Record<string, ReferenceCategory[]>,
  sourceStrengths?: Record<string, Record<string, number>>,
): CanvasGenGroup {
  const sourceImageIds = refImages.map(img => img.imageId);

  // 默认每个源图选中 风格+构图
  const defaultCategories: Record<string, ReferenceCategory[]> = {};
  const defaultStrengths: Record<string, Record<string, number>> = {};
  for (const img of refImages) {
    defaultCategories[img.imageId] = img.categories;
    defaultStrengths[img.imageId] = img.strengths;
  }

  return {
    id: generateGroupId(),
    type,
    status: 'idle',
    refImages,
    sourceImageIds,
    resultPlaceholder,
    position,
    toolbar: {
      model: '',
      aspectRatio: resultPlaceholder.aspectRatio,
      size: '1024x1024',
      quality: 'standard',
      outputCount: 1,
      prompt: '',
      ...toolbar,
    },
    sourceCategories: sourceCategories || defaultCategories,
    sourceStrengths: sourceStrengths || defaultStrengths,
    createdAt: Date.now(),
  };
}

// ==================== HexCube 六面体展开图类型 ====================

/** 六面体面枚举 */
export type CubeFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** 面的中文标签 */
export const CUBE_FACE_LABELS: Record<CubeFace, string> = {
  front: '前',
  back: '后',
  left: '左',
  right: '右',
  top: '上',
  bottom: '下',
};

/** 面的顺序（展开图布局顺序：上左中右下后） */
export const CUBE_FACE_ORDER: CubeFace[] = ['top', 'left', 'front', 'right', 'bottom', 'back'];

/** 缩放类型 */
export type ZoomLevel = 'close-up' | 'standard' | 'wide';

/** 缩放类型中文标签 */
export const ZOOM_LEVEL_LABELS: Record<ZoomLevel, string> = {
  'close-up': '特写',
  'standard': '标准',
  'wide': '广角',
};

/** 六面体面数据 */
export interface HexCubeFaceData {
  face: CubeFace;
  imageUrl: string | null;    // 上传的产品图URL
  imageId: string | null;     // 画布图片ID
}

/** 六面体3D预览工具栏 */
export interface HexCubeToolbar {
  rotationY: number;          // 旋转角度 (0-360)
  tiltX: number;              // 倾斜角度 (-90 to 90)
  zoom: ZoomLevel;            // 缩放
  model: string;              // 模型ID
  providerId: string;         // API提供商ID
  providerName: string;       // 提供商名称
  aspectRatio: string;        // 比例
  quality: string;            // 质量
  outputCount: number;        // 出图数量
  prompt: string;             // 提示词
}

/** 六面体组状态 */
export type HexCubeStatus = 'idle' | 'generating' | 'completed';

/** 六面体组 */
export interface HexCubeGroup {
  id: string;
  faces: HexCubeFaceData[];    // 6个面的数据
  resultImageUrl: string | null; // 生成的3D结果图URL
  resultImageId: string | null;  // 画布上的结果图ID
  toolbar: HexCubeToolbar;
  status: HexCubeStatus;
  isCollapsed: boolean;
  position: { x: number; y: number }; // 组在画布上的位置
  progress: number;            // 生成进度 0-100
  createdAt: number;
}

/** 生成六面体组ID */
export function generateHexCubeId(): string {
  return `hexcube-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/** 创建默认六面体组 */
export function createHexCubeGroup(position: { x: number; y: number }): HexCubeGroup {
  const faces: HexCubeFaceData[] = CUBE_FACE_ORDER.map(face => ({
    face,
    imageUrl: null,
    imageId: null,
  }));

  return {
    id: generateHexCubeId(),
    faces,
    resultImageUrl: null,
    resultImageId: null,
    toolbar: {
      rotationY: 0,
      tiltX: 0,
      zoom: 'standard',
      model: '',
      providerId: '',
      providerName: '',
      aspectRatio: '1:1',
      quality: 'standard',
      outputCount: 1,
      prompt: '',
    },
    status: 'idle',
    isCollapsed: false,
    position,
    progress: 0,
    createdAt: Date.now(),
  };
}
