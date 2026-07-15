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
  quality: string;         // 图片质量 (如 'auto/low/medium/high' 或 '1K/2K/4K')
  resolution?: string;     // 分辨率档位 (如 '1K/2K/4K')，用于 paramType='both' 的模型
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

    // ===== GPT Image 系列（APIMart/PearAPI官方文档）=====
    // 官方支持15种比例 + auto自动选择，resolution参数控制分辨率档位（1k/2k/4k）
    // 参考：https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation
    'gpt-image-2': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    'gpt-image-2-official': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    'gpt-image-1': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    'gpt-image-1-mini': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    'gpt-image-1.5': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    'chatgpt-image-latest': ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],

    // ===== DALL-E 3 =====
    // 官方: 1024x1024(1:1), 1792x1024(≈16:9), 1024x1792(≈9:16)
    // 注意: 1792x1024 约为 1.75:1，不是精确16:9，但OpenAI将其归类为横版
    'dall-e-3': ['1:1', '16:9', '9:16'],

    // ===== Gemini 系列 =====
    // Gemini 图片生成: aspectRatio参数支持多种比例
    // 官方文档支持: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9, 9:21
    'gemini-2.5-flash-preview-image-generation': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],
    'gemini-2.5-pro-preview-image-generation': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],
    'gemini-3-pro-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],
    'gemini-3-flash-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],
    'gemini-3.1-flash-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],

    // ===== Imagen 系列 =====
    // Imagen 4: aspectRatio 1:1, 3:4, 4:3, 9:16, 16:9
    'imagen-4-ultra': ['1:1', '4:3', '3:4', '16:9', '9:16'],
    'imagen-4': ['1:1', '4:3', '3:4', '16:9', '9:16'],
    'imagen-3': ['1:1', '4:3', '3:4', '16:9', '9:16'],

    // ===== Flux 系列 =====
    // Flux 1.1 Pro: width/height自由(步长32, 范围256-2048) — 无质量参数
    // 官方文档支持: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 9:21
    'flux-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
    'flux-1.1-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
    'flux-pro-ultra': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
    'flux-pro-ultra-fast': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    // Flux 1.1 Pro Ultra: aspect_ratio参数，4MP输出 — 无质量参数
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
    'ideogram': ['1:1', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '1:2', '2:1', '1:3', '3:1'],
    'ideogram-3': ['1:1', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '1:2', '2:1', '1:3', '3:1'],

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
    'gpt-image-2-official': ['auto', 'low', 'medium', 'high'],
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
    // 15种比例，69种尺寸选择，分辨率由 aspect_ratio 决定
    'ideogram': ['turbo', 'default', 'quality'],
    'ideogram-3': ['turbo', 'default', 'quality'],

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

// ===== 方案A：参数类型分离 =====
// 将 MODEL_QUALITIES 中的参数按类型拆分，避免概念混淆

/** 模型参数类型枚举 - 保持向后兼容的值命名 */
export type ModelParamType = 'resolution' | 'quality' | 'both' | 'none';

/** 分辨率档位型模型（参数值是"1K/2K/4K"，控制输出尺寸） */
export const RESOLUTION_TIER_MODELS = [
    // GPT-Image 系列（APIMart/PearAPI支持resolution参数）
    'gpt-image-2', 'gpt-image-2-official', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'chatgpt-image-latest',
    // Seedream 系列
    'doubao-seedream-4-5', 'seedream-4-5', 'doubao-seedream-4', 'seedream-4',
    'doubao-seedream-3', 'seedream-3', 'doubao-seedream-5-0-lite', 'seedream-5-0-lite',
    'doubao-seedream-5-0', 'seedream-5', 'doubao-seedance-4-5', 'seedance',
    // Gemini/Imagen 系列
    'gemini-2.5-flash-image', 'gemini-2.5-pro-image', 'gemini-3-flash-image',
    'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview',
    'imagen-3', 'imagen-4', 'imagen-4-ultra',
    // Kling 系列
    'kling-v3', 'kling-v3-omni', 'kling',
    // HiDream
    'hidream',
    // PearAPI Nano Banana 系列
    'nano-banana', 'nano-banana-2', 'nano-banana-2-4k', 'nano-banana-pro', 'nano-banana-pro-4k',
] as const;

/** 质量级别型模型（参数值是"standard/hd/auto/low/medium/high"，控制细节增强） */
export const QUALITY_LEVEL_MODELS = [
    // GPT-Image 系列
    'gpt-image-2', 'gpt-image-2-official', 'gpt-image-1', 'gpt-image-2-c',
    // DALL-E 3
    'dall-e-3',
    // Ideogram
    'ideogram', 'ideogram-3',
    // Stable Diffusion (非官方，部分代理支持)
    'stable-diffusion', 'sd-xl', 'sdxl', 'sd-3',
] as const;

/** 分辨率档位到显示名称的映射 */
export const RESOLUTION_TIER_DISPLAY_NAMES: Record<string, string> = {
    '1K': '1K',
    '2K': '2K',
    '3K': '3K',
    '4K': '4K',
};

/** 质量级别到显示名称的映射 */
export const QUALITY_LEVEL_DISPLAY_NAMES: Record<string, string> = {
    'auto': '自动',
    'low': '低质量',
    'medium': '中等质量',
    'high': '高质量',
    'standard': '标准',
    'hd': '高清增强',
    'quality': '高质量',
    'turbo': '极速渲染',
    'default': '默认速度',
};

/** 综合显示名称（兼容旧接口） */
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

/** 分辨率档位对应的像素长边（用于尺寸计算） */
export const RESOLUTION_TIER_TO_PIXELS: Record<string, number> = {
    '1K': 1024,
    '2K': 2048,
    '3K': 3072,
    '4K': 4096,
};

/** 通用画面比例选项数组（合并所有模型支持的常见比例，用于节点编辑器等通用场景） */
export const SHARED_ASPECT_RATIOS = [
    { label: '自动选择', value: 'auto' },
    { label: '1:1 (正方形)', value: '1:1' },
    { label: '4:3 (横向)', value: '4:3' },
    { label: '3:4 (竖向)', value: '3:4' },
    { label: '16:9 (宽屏)', value: '16:9' },
    { label: '9:16 (竖屏)', value: '9:16' },
    { label: '3:2 (横向)', value: '3:2' },
    { label: '2:3 (竖向)', value: '2:3' },
    { label: '21:9 (超宽)', value: '21:9' },
    { label: '9:21 (超竖)', value: '9:21' },
    { label: '5:4 (横向)', value: '5:4' },
    { label: '4:5 (竖向)', value: '4:5' },
    { label: '2:1 (横向)', value: '2:1' },
    { label: '1:2 (竖向)', value: '1:2' },
    { label: '3:1 (横向)', value: '3:1' },
    { label: '1:3 (竖向)', value: '1:3' },
    { label: '3:5 (横向)', value: '3:5' },
    { label: '5:3 (竖向)', value: '5:3' },
    { label: '4:7 (横向)', value: '4:7' },
    { label: '7:4 (竖向)', value: '7:4' },
    { label: '4:9 (横向)', value: '4:9' },
    { label: '9:4 (竖向)', value: '9:4' },
];

/** 判断模型的参数类型 */
export function getModelParamType(modelId: string): ModelParamType {
    const normalizedId = modelId.toLowerCase();
    
    // GPT-Image系列始终支持 both（resolution + quality）
    // APIMart/PearAPI官方文档明确说明：resolution(1k/2k/4k) + quality(auto/low/medium/high)
    const gptImageKeywords = ['gpt-image', 'chatgpt-image'];
    for (const keyword of gptImageKeywords) {
        if (normalizedId.includes(keyword)) return 'both';
    }
    
    // 🔧 后缀优先检测（必须在关键词之前！否则 banana-4k 会被关键词误判为 resolution）
    const hasResolutionSuffix = /(?:^|[-_])[1234]k(?:[-_]|$)/i.test(modelId) || /(?:^|[-_])hd(?:[-_]|$)/i.test(modelId);
    if (hasResolutionSuffix) {
        // 图像模型带后缀 → both（nanobanana-4k, gemini-3-pro-image-4k, imagen-4k 等）
        const bothKeywords = ['gpt-image', 'chatgpt-image', 'dall-e', 'gemini', 'banana', 'imagen', 'image'];
        for (const kw of bothKeywords) {
            if (normalizedId.includes(kw)) return 'both';
        }
        // 纯分辨率模型带后缀（如 hidream-4k）→ resolution
        return 'resolution';
    }
    
    // 不带后缀：分辨率档位型模型
    const resolutionKeywords = [
        'seedream', 'seedance', 'kling', 'gemini-image', 'imagen', 
        'nano-banana', 'nanobanana', 'nano_banana', 'banana', 'gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-image',
        'hidream', 'flux-ultra'
    ];
    for (const keyword of resolutionKeywords) {
        if (normalizedId.includes(keyword)) return 'resolution';
    }
    
    // 不带后缀：质量级别型模型
    const qualityKeywords = [
        'dall-e', 'ideogram', 'stable-diffusion', 
        'sd-xl', 'sdxl', 'sd-3'
    ];
    for (const keyword of qualityKeywords) {
        if (normalizedId.includes(keyword)) return 'quality';
    }
    
    // 回退：检查精确匹配列表（兼容旧代码）
    for (const m of RESOLUTION_TIER_MODELS) {
        if (normalizedId === m.toLowerCase()) return 'resolution';
    }
    for (const m of QUALITY_LEVEL_MODELS) {
        if (normalizedId === m.toLowerCase()) return 'quality';
    }
    
    return 'none';
}

/**
 * 合并参数选项：确保 MODEL_QUALITIES 中的选项与 getModelParamType 的类型一致。
 * 当 MODEL_QUALITIES 只有质量值但模型家族应同时支持分辨率时，补充分辨率档位。
 * 当 MODEL_QUALITIES 只有分辨率值但模型家族应同时支持质量时，补充质量档位。
 */
function mergeParamOptions(modelId: string, desiredType: ModelParamType, existingOpts: string[]): {
    type: ModelParamType; options: string[]; defaultOption: string;
} {
    const id = modelId.toLowerCase();
    const opts = [...existingOpts];
    let type = desiredType;
    
    const hasResInOpts = opts.some(o => isResolutionTier(o));
    const hasQualityInOpts = opts.some(o => isQualityLevel(o));
    
    // 需要分辨率但没有 → 补充
    if ((desiredType === 'both' || desiredType === 'resolution') && !hasResInOpts) {
        if (id.includes('-4k') || /4k-omni/i.test(id)) {
            opts.unshift('1K', '2K', '4K');
        } else if (id.includes('-3k')) {
            opts.unshift('1K', '2K', '3K');
        } else if (id.includes('-2k')) {
            opts.unshift('1K', '2K');
        } else {
            // GPT家族默认全分辨率
            if (id.includes('gpt-image') || id.includes('chatgpt-image')) {
                opts.unshift('1K', '2K', '4K');
            } else {
                opts.unshift('1K', '2K');
            }
        }
    }
    
    // 需要质量但没有 → 补充
    if ((desiredType === 'both' || desiredType === 'quality') && !hasQualityInOpts) {
        const qualityOpts = ['auto', 'low', 'medium', 'high'];
        for (const q of qualityOpts) {
            if (!opts.includes(q)) opts.push(q);
        }
    }
    
    // 如果 desiredType 是 'none' 但从 opts 可以推断 → 用推断值
    if (desiredType === 'none') {
        const isAllRes = opts.every(o => isResolutionTier(o));
        const isAllQ = opts.every(o => isQualityLevel(o));
        type = isAllRes ? 'resolution' : (isAllQ ? 'quality' : 'both');
    }
    
    // 默认值
    let def = opts[opts.length - 1] || opts[0];
    if (id.includes('-4k') || /4k-omni/i.test(id)) def = '4K';
    else if (id.includes('-3k')) def = '3K';
    else if (id.includes('-2k')) def = '2K';
    
    return { type, options: opts, defaultOption: def };
}

/**
 * 通用模型参数能力推断（动态+兜底）：
 * 1. 优先匹配 MODEL_QUALITIES 中明确定义的模型
 * 2. 未命中时根据模型名后缀/关键词智能推断：
 *    - 含 -4k/4k/4k-omni → resolution档位: ['1K','2K','4K']
 *    - 含 -2k/-3k/hd/omni 等 → resolution档位推断
 *    - 含 banana/gemini/imagen/seedream/kling → resolution档位
 *    - 含 ideogram → 速度档位 (turbo/default/quality)
 *    - 含 gpt-image/dall-e → quality档位 (auto/low/medium/high 或 standard/hd)
 *    - 含 sd/flux/midjourney → quality档位
 *    - 其他 → 无档位
 * 返回：{ type: 'resolution'|'quality'|'both'|'none', options: string[], defaultOption: string }
 */
export function inferModelParamCapability(modelId: string): { type: ModelParamType; options: string[]; defaultOption: string } {
    const id = (modelId || '').toLowerCase();
    if (!id) return { type: 'none', options: [], defaultOption: '' };

    // 1. 优先查MODEL_QUALITIES
    if (MODEL_QUALITIES[modelId]) {
        const opts = [...MODEL_QUALITIES[modelId]]; // copy to avoid mutation
        const type = getModelParamType(modelId);
        // ★ 关键修复：MODEL_QUALITIES 中的选项可能不完整（如 gpt-image-2 只有质量值但 type=both），
        // 需要根据 getModelParamType 的结果补充缺失的档位选项
        return mergeParamOptions(modelId, type, opts);
    }
    // 模糊匹配（MODEL_QUALITIES中可能存在前缀匹配，如nano-banana-pro-4k-xxx）
    for (const key of Object.keys(MODEL_QUALITIES)) {
        if (id === key.toLowerCase() || id.startsWith(key.toLowerCase() + '-') || id.endsWith('-' + key.toLowerCase())) {
            const opts = [...MODEL_QUALITIES[key]]; // copy to avoid mutation
            // 根据options内容判断type
            const isAllRes = opts.every(o => isResolutionTier(o));
            const isAllQ = opts.every(o => isQualityLevel(o));
            let t: ModelParamType = isAllRes ? 'resolution' : (isAllQ ? 'quality' : 'both');
            
            // ★ 关键修复：检查模型名中的分辨率后缀和模型家族，
            // 如果模糊匹配遗漏了分辨率/质量档位，需要升级type并补充选项
            const hasResSuffix = /(?:^|[-\s])[234]k(?:[-\s]|$)/.test(id) || /4k-omni/i.test(id);
            const gptFamily = id.includes('gpt-image') || id.includes('chatgpt-image');
            const bananaFamily = id.includes('banana') || id.includes('nano-banana') || id.includes('gemini') || id.includes('imagen');
            
            // 质量型匹配 + 分辨率后缀 → 升级为 both，补充分辨率档位
            if (hasResSuffix && t === 'quality') {
                t = 'both';
                if (id.includes('-4k') || /4k-omni/i.test(id)) {
                    opts.unshift('1K', '2K', '4K');
                } else if (id.includes('-3k')) {
                    opts.unshift('1K', '2K', '3K');
                } else if (id.includes('-2k')) {
                    opts.unshift('1K', '2K');
                }
            }
            // GPT/Banana家族仅有分辨率选项但应同时有质量 → 升级为 both，补充质量档位
            if ((gptFamily || bananaFamily) && t === 'resolution') {
                t = 'both';
                // 补充质量档位（去重）
                const qualityOpts = ['auto', 'low', 'medium', 'high'];
                for (const q of qualityOpts) {
                    if (!opts.includes(q)) opts.push(q);
                }
            }
            // GPT家族仅有质量选项但应同时有分辨率 → 升级为 both，补充分辨率档位
            if (gptFamily && t === 'quality' && !hasResSuffix) {
                t = 'both';
                opts.unshift('1K', '2K', '4K');
            }
            
            // 默认值
            let def = opts[opts.length - 1];
            if (id.includes('-4k') || /4k-omni/i.test(id)) def = '4K';
            else if (id.includes('-2k')) def = '2K';
            return { type: t, options: opts, defaultOption: def };
        }
    }

    // 2. 基于模型名后缀/关键词智能推断
    // 2.1 分辨率档位模型（1K/2K/4K）
    const is4k = /(?:^|[-\s])4k(?:[-\s]|$)|-4k-omni|4k-omni/.test(id);
    const is3k = /(?:^|[-\s])3k(?:[-\s]|$)/.test(id);
    const is2k = /(?:^|[-\s])2k(?:[-\s]|$)/.test(id) || id.includes('omni');
    const is1kOnly = /(?:^|[-\s])(?:1k|lite|mini)(?:[-\s]|$)/.test(id);
    // 品牌特征：这些模型通常使用resolution档位
    const resBrands = ['banana', 'gemini', 'imagen', 'seedream', 'seedance', 'kling', 'nano-banana'];
    const isResBrand = resBrands.some(b => id.includes(b));
    // 2.2 质量档位模型
    const isGpt = id.includes('gpt-image');
    const isDalle = id.includes('dall-e');
    const isSd = /(?:^|[-\s])(?:sd|stable-diffusion|sdxl|sd-3)(?:[-\s]|$)/.test(id);
    const isIdeogram = id.includes('ideogram');
    const isMidj = id.includes('midjourney') || id.includes('mj-');
    // 2.3 Flux不使用档位

    // 后缀优先：-4k/-3k/-2k 决定分辨率档位上限
    // GPT/banana/gemini/DALL-E/Ideogram/SD/Midjourney 家族同时需要质量档位 → type:'both'
    const needsQuality = isGpt || isDalle || isIdeogram || isSd || isMidj ||
        id.includes('banana') || id.includes('gemini') || id.includes('imagen') || id.includes('nano-banana');

    if (is4k) {
        // -4k 模型：分辨率全支持 1K-4K + 质量档位
        return needsQuality
            ? { type: 'both', options: ['1K', '2K', '4K', 'auto', 'low', 'medium', 'high'], defaultOption: '4K' }
            : { type: 'resolution', options: ['1K', '2K', '4K'], defaultOption: '4K' };
    }
    if (is3k) {
        return needsQuality
            ? { type: 'both', options: ['1K', '2K', '3K', 'auto', 'low', 'medium', 'high'], defaultOption: '3K' }
            : { type: 'resolution', options: ['1K', '2K', '3K'], defaultOption: '3K' };
    }
    if (is2k) {
        // -2k 上限 2K，不支持 4K
        return needsQuality
            ? { type: 'both', options: ['1K', '2K', 'auto', 'low', 'medium', 'high'], defaultOption: '2K' }
            : { type: 'resolution', options: ['1K', '2K'], defaultOption: '2K' };
    }
    if (isResBrand || is1kOnly) {
        return { type: 'resolution', options: ['1K', '2K'], defaultOption: is1kOnly ? '1K' : '2K' };
    }
    if (isGpt) {
        // GPT Image 家族：同时支持分辨率档位(1K-4K) + 质量档位
        return { type: 'both', options: ['1K', '2K', '4K', 'auto', 'low', 'medium', 'high'], defaultOption: '2K' };
    }
    if (isDalle) {
        return { type: 'quality', options: ['standard', 'hd'], defaultOption: 'standard' };
    }
    if (isIdeogram) {
        return { type: 'quality', options: ['turbo', 'default', 'quality'], defaultOption: 'default' };
    }
    if (isSd || isMidj) {
        return { type: 'quality', options: ['standard', 'hd'], defaultOption: 'standard' };
    }

    return { type: 'none', options: [], defaultOption: '' };
}

/** 获取模型支持的分辨率档位选项（智能兜底） */
export function getResolutionTierOptions(modelId: string): string[] {
    const cap = inferModelParamCapability(modelId);
    if (cap.type === 'resolution' || cap.type === 'both') return cap.options.filter(isResolutionTier);
    return [];
}

/** 获取模型支持的质量级别选项（智能兜底） */
export function getQualityLevelOptions(modelId: string): string[] {
    const cap = inferModelParamCapability(modelId);
    if (cap.type === 'quality' || cap.type === 'both') return cap.options.filter(o => !isResolutionTier(o));
    return [];
}

/** 综合获取模型的"质量"选项（兼容旧接口） */
export function getQualityOptions(modelId: string): string[] {
    return inferModelParamCapability(modelId).options;
}

/** 获取模型默认档位值（模型名带4k时默认4K） */
export function getDefaultParamValue(modelId: string): string {
    return inferModelParamCapability(modelId).defaultOption;
}

/** 判断值是否是分辨率档位 */
export function isResolutionTier(value: string): boolean {
    return ['1K', '2K', '3K', '4K'].includes(value);
}

/** 判断值是否是质量级别 */
export function isQualityLevel(value: string): boolean {
    return ['auto', 'low', 'medium', 'high', 'standard', 'hd', 'quality'].includes(value);
}

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

/** Provider-specific UI rules keep documented parameters selectable and visible. */
export function getProviderAspectRatios(modelId: string, providerHint = ''): string[] {
    const ratios = findModelConfig(MODEL_ASPECT_RATIOS, modelId) || DEFAULT_ASPECT_RATIOS;
    return /4sapi/i.test(providerHint) ? ratios.filter(ratio => ratio !== 'auto') : ratios;
}

/** 4SAPI maps the UI resolution tier to pixels; other providers use quality previews. */
export function getProviderPixelSizingOption(
    providerHint: string,
    quality: string,
    resolution: string,
): string {
    return /4sapi/i.test(providerHint) ? resolution || quality : quality;
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

/**
 * 根据画面比例和质量精确计算像素尺寸（优先查模型特定像素表）
 * 这是 calculateActualPixels 的精确版本，返回 string | null
 */
export function calculateActualPixelsFromRatio(aspectRatio: string, quality?: string, modelId?: string): string | null {
  // 直接使用 api-compatibility 中的模型像素表推算
  if (!aspectRatio || !quality) return null;
  try {
    const pixelSize = getModelSpecificPixelSize(aspectRatio, quality || 'standard', modelId || '');
    if (pixelSize) {
      const [w, h] = pixelSize.split('x').map(Number);
      if (w > 0 && h > 0) return pixelSize;
    }
  } catch {
    // fallback: 从比例推算基础尺寸
  }

  // Fallback: 从 aspectRatio 比例 + quality 推算
  const ratioMatch = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!ratioMatch) return null;
  const [, rw, rh] = ratioMatch.map(Number);
  const ratio = rw / rh;

  // 根据质量确定长边像素
  const qualityPixels: Record<string, number> = {
    '1K': 1024, '2K': 2048, '3K': 3072, '4K': 4096,
    'standard': 1024, 'std': 1024,
    'hd': 1792, 'high': 1792,
    'low': 1024, 'medium': 1024, 'auto': 1024,
  };
  const longEdge = qualityPixels[quality];
  if (!longEdge) return null;

  if (ratio >= 1) {
    return `${longEdge}x${Math.round(longEdge / ratio)}`;
  } else {
    return `${Math.round(longEdge * ratio)}x${longEdge}`;
  }
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
export function calculateResultFramePosition(refImages: { x: number; y: number; width: number; height: number }[], aspectRatio: string, canvasWidth: number, canvasHeight: number): { x: number; y: number; width: number; height: number } {
  void canvasHeight;
  void canvasWidth;
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
  resolution: string;         // 分辨率档位 (1K/2K/4K)
  quality: string;            // 图片质量 (auto/low/standard/high/max)
  size: string;               // 生成尺寸
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
      quality: 'auto',
      resolution: '2K',
      size: '1024x1024',
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
