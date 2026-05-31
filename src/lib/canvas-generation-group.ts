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
    // 无独立quality参数，分辨率通过 outputOptions 控制
    // 不设置条目，使用默认

    // ===== Flux 系列 =====
    // 无quality参数，分辨率通过 width/height 控制
    // 不设置条目，使用默认

    // ===== Stable Diffusion 系列 =====
    // SDXL官方无quality参数，部分代理支持standard/hd
    'stable-diffusion': ['standard', 'hd'],
    'sd-xl': ['standard', 'hd'],
    'sdxl': ['standard', 'hd'],
    'sd-3': ['standard', 'hd'],

    // ===== Midjourney =====
    // 无quality参数
    // 不设置条目，使用默认

    // ===== 可灵 Kling =====
    'kling': ['standard', 'hd'],

    // ===== Ideogram =====
    // 官方只有rendering_speed，非quality概念
    // 不设置条目，使用默认

    // ===== HiDream =====
    'hidream': ['standard', 'hd'],
};

/** 质量档位到显示名称的映射 */
export const QUALITY_DISPLAY_NAMES: Record<string, string> = {
    'auto': '自动',
    'low': '低',
    'medium': '中',
    'high': '高',
    'standard': '标准',
    'hd': '高清',
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
    // Gemini 系列
    'gemini-2.5-flash-image-preview': {
        'standard': '1024',
        '1K': '1024'
    },
    'gemini-2.5-pro-image-preview': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048'
    },
    'gemini-3-pro-image-preview': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048'
    },
    'gemini-3-flash-image-preview': {
        'standard': '1024',
        '1K': '1024'
    },
    'gemini-3.1-flash-image-preview': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    // Imagen 系列
    'imagen-4-ultra': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048'
    },
    'imagen-4': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048'
    },
    'imagen-3': {
        'standard': '1024',
        '1K': '1024'
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
    // GPT-Image 系列 — quality独立于size，这里仅显示参考分辨率
    'gpt-image-2-official': {
        'auto': 'auto',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    'gpt-image-2': {
        'auto': 'auto',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    'gpt-image-1': {
        'auto': 'auto',
        'low': '1024',
        'medium': '1536',
        'high': '2048'
    },
    // Stable Diffusion 系列
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
    // Flux 系列
    'flux': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    'flux-pro': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    'flux-dev': {
        'standard': '1024',
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
    // 可灵 Kling
    'kling': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    // Ideogram
    'ideogram': {
        'standard': '1024',
        'hd': '1024 细节增强'
    },
    // HiDream
    'hidream': {
        'standard': '1024',
        'hd': '1024 细节增强'
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

/** 根据宽高比和模型尺寸配置计算实际像素尺寸 */
export function calculateActualPixels(
  aspectRatio: string,
  quality: string = 'standard',
  modelId?: string
): string {
  // 模型默认像素尺寸映射（根据各模型官方API文档配置）
  const MODEL_PIXEL_SIZES: Record<string, Record<string, Record<string, string>>> = {
    // GPT Image 2 — 官方支持的尺寸
    // Ref: https://platform.openai.com/docs/guides/image-generation
    // quality: auto/low/medium/high
    // Sizes: 1024x1024, 1536x1024, 1024x1536, 2048x1152, 1152x2048, 3840x2160(4K), 2160x3840(4K)
    'gpt-image-2': {
      '1:1':  { 'auto': '1024x1024', 'low': '1024x1024', 'medium': '1024x1024', 'high': '1024x1024' },
      '3:2':  { 'auto': '1536x1024', 'low': '1536x1024', 'medium': '1536x1024', 'high': '1536x1024' },
      '2:3':  { 'auto': '1024x1536', 'low': '1024x1536', 'medium': '1024x1536', 'high': '1024x1536' },
      '16:9': { 'auto': '2048x1152', 'low': '2048x1152', 'medium': '2048x1152', 'high': '3840x2160' },
      '9:16': { 'auto': '1152x2048', 'low': '1152x2048', 'medium': '1152x2048', 'high': '2160x3840' },
    },
    // Gemini 系列
    'gemini-2.5-flash-image-preview': {
      '1:1': { 'standard': '1024x1024', '1K': '1024x1024' },
      '4:3': { 'standard': '1024x768', '1K': '1024x768' },
      '3:4': { 'standard': '768x1024', '1K': '768x1024' },
      '16:9': { 'standard': '1792x1024', '1K': '1792x1024' },
      '9:16': { 'standard': '1024x1792', '1K': '1024x1792' },
      '3:2': { 'standard': '1536x1024', '1K': '1536x1024' },
      '2:3': { 'standard': '1024x1536', '1K': '1024x1536' },
    },
    'gemini-3-pro-image-preview': {
      '1:1': { 'standard': '1024x1024', '1K': '1024x1024', 'high': '2048x2048', '2K': '2048x2048' },
      '4:3': { 'standard': '1024x768', '1K': '1024x768', 'high': '2048x1536', '2K': '2048x1536' },
      '3:4': { 'standard': '768x1024', '1K': '768x1024', 'high': '1536x2048', '2K': '1536x2048' },
      '16:9': { 'standard': '1792x1024', '1K': '1792x1024', 'high': '2048x1152', '2K': '2048x1152' },
      '9:16': { 'standard': '1024x1792', '1K': '1024x1792', 'high': '1152x2048', '2K': '1152x2048' },
      '3:2': { 'standard': '1536x1024', '1K': '1536x1024', 'high': '2048x1365', '2K': '2048x1365' },
      '2:3': { 'standard': '1024x1536', '1K': '1024x1536', 'high': '1365x2048', '2K': '1365x2048' },
    },
    'gemini-3.1-flash-image-preview': {
      '1:1': { 'standard': '1024x1024', '1K': '1024x1024', 'high': '2048x2048', '2K': '2048x2048', 'ultra': '4096x4096', '4K': '4096x4096' },
      '4:3': { 'standard': '1024x768', '1K': '1024x768', 'high': '2048x1536', '2K': '2048x1536', 'ultra': '3840x2880', '4K': '3840x2880' },
      '3:4': { 'standard': '768x1024', '1K': '768x1024', 'high': '1536x2048', '2K': '1536x2048', 'ultra': '2880x3840', '4K': '2880x3840' },
      '16:9': { 'standard': '1792x1024', '1K': '1792x1024', 'high': '2048x1152', '2K': '2048x1152', 'ultra': '3840x2160', '4K': '3840x2160' },
      '9:16': { 'standard': '1024x1792', '1K': '1024x1792', 'high': '1152x2048', '2K': '1152x2048', 'ultra': '2160x3840', '4K': '2160x3840' },
      '3:2': { 'standard': '1536x1024', '1K': '1536x1024', 'high': '2048x1365', '2K': '2048x1365', 'ultra': '3840x2560', '4K': '3840x2560' },
      '2:3': { 'standard': '1024x1536', '1K': '1024x1536', 'high': '1365x2048', '2K': '1365x2048', 'ultra': '2560x3840', '4K': '2560x3840' },
    },
    // DALL-E 3 — 官方支持的尺寸
    // quality: standard/hd (仅 1:1 区分, 其余比例两种质量像素相同)
    'dall-e-3': {
      '1:1': { 'standard': '1024x1024', 'hd': '1024x1024' },
      '16:9': { 'standard': '1792x1024', 'hd': '1792x1024' },
      '9:16': { 'standard': '1024x1792', 'hd': '1024x1792' },
    },
    // Seedream 4.0/4.5 — 火山引擎官方推荐像素值
    // Ref: https://www.volcengine.com/docs/82379/1541523
    // quality: 1K(1024档), 2K(默认2048x2048), 4K(最大4096x4096)
    'doubao-seedream-4': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '1K': '1280x720', '2K': '2560x1440', '4K': '4096x2304' },
      '9:16': { '1K': '720x1280', '2K': '1440x2560', '4K': '2304x4096' },
      '3:2': { '1K': '1248x832', '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '1K': '832x1248', '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '1K': '1512x648', '2K': '3024x1296', '4K': '4096x1756' },
    },
    // Seedream 4.5 — 火山方舟: size="2K"|"4K" (最小2K起步，不支持1K)
    // Ref: https://www.volcengine.com/docs/6492/2172373
    'doubao-seedream-4-5': {
      '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '2K': '2560x1440', '4K': '4096x2304' },
      '9:16': { '2K': '1440x2560', '4K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '2K': '3024x1296', '4K': '4096x1756' },
    },
    // Seedream 4.0 (无 doubao 前缀)
    'seedream-4': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '1K': '1280x720', '2K': '2560x1440', '4K': '4096x2304' },
      '9:16': { '1K': '720x1280', '2K': '1440x2560', '4K': '2304x4096' },
      '3:2': { '1K': '1248x832', '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '1K': '832x1248', '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '1K': '1512x648', '2K': '3024x1296', '4K': '4096x1756' },
    },
    // Seedream 4.5 (无 doubao 前缀) — size="2K"|"4K"
    'seedream-4-5': {
      '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '2K': '2560x1440', '4K': '4096x2304' },
      '9:16': { '2K': '1440x2560', '4K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '2K': '3024x1296', '4K': '4096x1756' },
    },
    // Seedream 3.0 — 像素范围 [512x512, 2048x2048]
    // 官方: 仅支持像素值，不支持1K/2K/4K简写，默认1024x1024，最大2048x2048
    // 前端按 1K/2K 显示，后端转换为像素值
    // 注意: 2K档位的像素值受2048上限约束，部分比例无法达到标准2K尺寸
    'doubao-seedream-3': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
      '4:3': { '1K': '1024x768', '2K': '2048x1536' },
      '3:4': { '1K': '768x1024', '2K': '1536x2048' },
      '16:9': { '1K': '1024x576', '2K': '2048x1152' },
      '9:16': { '1K': '576x1024', '2K': '1152x2048' },
      '3:2': { '1K': '1024x683', '2K': '2048x1365' },
      '2:3': { '1K': '683x1024', '2K': '1365x2048' },
      '21:9': { '1K': '1024x439', '2K': '2048x878' },
    },
    // Seedream 3.0 (无 doubao 前缀)
    'seedream-3': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
      '4:3': { '1K': '1024x768', '2K': '2048x1536' },
      '3:4': { '1K': '768x1024', '2K': '1536x2048' },
      '16:9': { '1K': '1024x576', '2K': '2048x1152' },
      '9:16': { '1K': '576x1024', '2K': '1152x2048' },
      '3:2': { '1K': '1024x683', '2K': '2048x1365' },
      '2:3': { '1K': '683x1024', '2K': '1365x2048' },
      '21:9': { '1K': '1024x439', '2K': '2048x878' },
    },
    // Seedream 5.0 Lite — 火山方舟直连API: size="2K"|"3K"
    // Ref: https://www.volcengine.com/docs/6492/2172373
    // Ref: https://docs.geekai.co/cn/docs/image/bytedance/doubao-seedream-5.0-lite
    // 官方明确: 仅支持 2K 和 3K，总像素范围 [2560x1440, 3072x3072x1.1025]
    'doubao-seedream-5-0-lite': {
      '1:1': { '2K': '2048x2048', '3K': '3072x3072' },
      '4:3': { '2K': '2304x1728', '3K': '3456x2592' },
      '3:4': { '2K': '1728x2304', '3K': '2592x3456' },
      '16:9': { '2K': '2848x1600', '3K': '4096x2304' },
      '9:16': { '2K': '1600x2848', '3K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '3K': '3744x2496' },
      '2:3': { '2K': '1664x2496', '3K': '2496x3744' },
      '21:9': { '2K': '3136x1344', '3K': '4704x2016' },
    },
    'seedream-5-0-lite': {
      '1:1': { '2K': '2048x2048', '3K': '3072x3072' },
      '4:3': { '2K': '2304x1728', '3K': '3456x2592' },
      '3:4': { '2K': '1728x2304', '3K': '2592x3456' },
      '16:9': { '2K': '2848x1600', '3K': '4096x2304' },
      '9:16': { '2K': '1600x2848', '3K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '3K': '3744x2496' },
      '2:3': { '2K': '1664x2496', '3K': '2496x3744' },
      '21:9': { '2K': '3136x1344', '3K': '4704x2016' },
    },
    // Seedream 5.0 (非lite) — 火山方舟: size="2K"|"4K"
    // 官方: 2K直出 + 4K AI增强
    // 2K像素值与5.0-lite一致，4K像素值按4096x4096总像素上限计算
    'doubao-seedream-5-0': {
      '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '2K': '2848x1600', '4K': '4096x2304' },
      '9:16': { '2K': '1600x2848', '4K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '2K': '3136x1344', '4K': '4704x2016' },
    },
    'seedream-5': {
      '1:1': { '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '2K': '2304x1728', '4K': '4096x3072' },
      '3:4': { '2K': '1728x2304', '4K': '3072x4096' },
      '16:9': { '2K': '2848x1600', '4K': '4096x2304' },
      '9:16': { '2K': '1600x2848', '4K': '2304x4096' },
      '3:2': { '2K': '2496x1664', '4K': '4096x2730' },
      '2:3': { '2K': '1664x2496', '4K': '2730x4096' },
      '21:9': { '2K': '3136x1344', '4K': '4704x2016' },
    },
    // Seedance 4.5 — 视频生图模型
    // quality: 1K(1024档), 2K(默认), 4K(高清)
    'doubao-seedance-4-5': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '3840x2880' },
      '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '2880x3840' },
      '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
      '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
    },
    // Seedance (无 doubao 前缀)
    'seedance': {
      '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
      '4:3': { '1K': '1024x768', '2K': '2048x1536', '4K': '3840x2880' },
      '3:4': { '1K': '768x1024', '2K': '1536x2048', '4K': '2880x3840' },
      '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
      '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
    },
  };

  // 尝试匹配模型ID — 优先匹配最长key（更精确的匹配优先）
  const lowerModel = (modelId || '').toLowerCase();
  let matchedKey: string | undefined;
  let matchedLen = 0;
  for (const key of Object.keys(MODEL_PIXEL_SIZES)) {
    if (lowerModel.includes(key) && key.length > matchedLen) {
      matchedKey = key;
      matchedLen = key.length;
    }
  }

  if (matchedKey) {
    const modelSizes = MODEL_PIXEL_SIZES[matchedKey];
    const ratioSizes = modelSizes[aspectRatio];
    if (ratioSizes) {
      const qualityKey = quality || 'standard';
      // 尝试精确匹配质量
      if (ratioSizes[qualityKey]) return ratioSizes[qualityKey];
      // 回退到 standard
      if (ratioSizes['standard']) return ratioSizes['standard'];
      // 任意一个
      return Object.values(ratioSizes)[0];
    }
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
