/**
 * model-capabilities.ts — 通用图像模型能力注册表
 *
 * 参考 Image-Studio 的 classifyImageModel / supports* 设计，
 * 但扩展为覆盖所有主流图像模型家族，而非仅 GPT Image。
 *
 * 核心思路：
 * 1. classifyModelFamily() 将任意模型 ID 映射到模型家族
 * 2. 每个家族定义一组能力声明（supports*）
 * 3. 请求构建时按能力过滤参数，避免向上游发送不支持的字段
 * 4. Size 修复时按家族规则约束合法尺寸范围
 */

// ======================== 模型家族定义 ========================

export type ModelFamily =
  | 'gpt-image'       // gpt-image-1, gpt-image-2, chatgpt-image-latest
  | 'dalle3'          // dall-e-3
  | 'dalle2'          // dall-e-2
  | 'gemini-image'    // gemini-2.5-flash-image, gemini-3-pro-image, etc.
  | 'flux'            // flux-1.1-pro, flux-1.1-dev, flux-schnell
  | 'stable-diffusion'// sd-3.5, sd-xl, sdxl-turbo
  | 'midjourney'      // midjourney-v6, midjourney-v7
  | 'kling'           // kling-v3, kling-v3-omni (图片模型)
  | 'seedream'        // seedream-4.5, seedream-5.0, seedream-5.0-lite
  | 'ideogram'        // ideogram-3, ideogram-2a
  | 'hidream'         // hidream
  | 'recraft'         // recraft-v3
  | 'playground'      // playground-v3
  | 'leonardo'        // leonardo-phoenix, leonardo-diffusionxl
  | 'other';          // 未知/其他模型

/**
 * 将模型 ID 映射到家族
 * 优先匹配精确前缀，兜底返回 'other'
 */
export function classifyModelFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase().trim();

  // GPT Image 系列
  if (id.startsWith('gpt-image') || id.startsWith('chatgpt-image')) return 'gpt-image';

  // DALL-E 系列
  if (id.startsWith('dall-e-3') || id === 'dall-e-3') return 'dalle3';
  if (id.startsWith('dall-e-2') || id === 'dall-e-2') return 'dalle2';
  if (id.startsWith('dall-e')) return 'dalle3'; // 兜底 dall-e → v3

  // Gemini 图像系列
  if (/gemini.*image/.test(id) || /gemini-\d.*flash/.test(id) && id.includes('image')) return 'gemini-image';
  if (id.includes('gemini-2.5-flash-image') || id.includes('gemini-3-pro-image') || id.includes('gemini-3.1-flash-image')) return 'gemini-image';
  if (id.startsWith('nano-banana')) return 'gemini-image'; // 俗称

  // Flux 系列
  if (id.includes('flux')) return 'flux';

  // Stable Diffusion 系列
  if (id.startsWith('sd-') || id.startsWith('sdxl') || id.startsWith('stable-diffusion') || id.startsWith('stable_diffusion')) return 'stable-diffusion';

  // Midjourney 系列
  if (id.includes('midjourney') || id.startsWith('mj-') || id.startsWith('midjourney-')) return 'midjourney';

  // 可灵系列
  if (id.includes('kling') || id.includes('kuaishou')) return 'kling';

  // Seedream 系列 (豆包/字节)
  if (id.includes('seedream') || id.includes('doubao-seedream')) return 'seedream';

  // Ideogram 系列
  if (id.includes('ideogram')) return 'ideogram';

  // HiDream 系列
  if (id.includes('hidream')) return 'hidream';

  // Recraft 系列
  if (id.includes('recraft')) return 'recraft';

  // Playground 系列
  if (id.includes('playground')) return 'playground';

  // Leonardo 系列
  if (id.includes('leonardo')) return 'leonardo';

  return 'other';
}

// ======================== 能力接口 ========================

export interface ModelCapabilities {
  /** 模型家族 */
  family: ModelFamily;

  // --- 请求参数能力 ---

  /** 支持 background 参数 (opaque/transparent/auto) */
  supportsBackground: boolean;
  /** 支持 output_compression 参数 (0-100) */
  supportsOutputCompression: boolean;
  /** 支持 input_fidelity 参数 (low/high) — 编辑时保留源图细节程度 */
  supportsInputFidelity: boolean;
  /** 支持 moderation 参数 (auto/low) — 安全审核级别 */
  supportsModeration: boolean;
  /** 支持 style 参数 (vivid/natural) — 生成风格 */
  supportsStyle: boolean;
  /** 支持 seed 参数 — 随机种子复现 */
  supportsSeed: boolean;
  /** 支持 negative_prompt 参数 — 反向提示词 */
  supportsNegativePrompt: boolean;
  /** 支持 n 参数 — 一次生成多张 */
  supportsMultipleImages: boolean;
  /** 支持 mask/蒙版 — 图像编辑蒙版 */
  supportsMask: boolean;
  /** 支持 stream + partial_images — SSE 流式预览 */
  supportsStreamPreview: boolean;
  /** 支持 Responses API (/v1/responses) 路径 */
  supportsResponsesAPI: boolean;

  // --- 尺寸约束 ---

  /** 尺寸对齐要求 (像素) — 0 表示无对齐要求 */
  sizeAlignment: number;
  /** 最小边长 (像素) */
  minSide: number;
  /** 最大边长 (像素) */
  maxSide: number;
  /** 最大总像素数 */
  maxPixels: number;
  /** 最大宽高比 (宽/高) */
  maxAspectRatio: number;
  /** 是否只支持固定尺寸选项 (不允许任意尺寸) */
  fixedSizesOnly: boolean;
  /** 固定尺寸列表 (仅 fixedSizesOnly=true 时有效) */
  allowedSizes: string[];

  // --- 质量选项 ---

  /** 支持的质量选项 */
  qualityOptions: string[];
  /** 默认质量 */
  defaultQuality: string;

  // --- 输出格式 ---

  /** 支持的输出格式 */
  outputFormats: string[];
  /** 默认输出格式 */
  defaultOutputFormat: string;
}

// ======================== 家族能力表 ========================

const CAPABILITY_TABLE: Record<ModelFamily, ModelCapabilities> = {
  'gpt-image': {
    family: 'gpt-image',
    supportsBackground: true,
    supportsOutputCompression: true,
    supportsInputFidelity: true, // gpt-image-1/1.5/1-mini 支持, gpt-image-2 不支持 (细粒度见下方函数)
    supportsModeration: true,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: true,
    supportsMask: true,
    supportsStreamPreview: true,
    supportsResponsesAPI: true,
    sizeAlignment: 16,
    minSide: 64,
    maxSide: 3840,
    maxPixels: 3840 * 2160,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['auto', 'high', 'medium', 'low'],
    defaultQuality: 'auto',
    outputFormats: ['png', 'jpeg', 'webp'],
    defaultOutputFormat: 'png',
  },

  'dalle3': {
    family: 'dalle3',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: true,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0, // DALL-E 3 只支持固定尺寸
    minSide: 1024,
    maxSide: 1792,
    maxPixels: 1792 * 1792,
    maxAspectRatio: 1.75,
    fixedSizesOnly: true,
    allowedSizes: ['1024x1024', '1792x1024', '1024x1792'],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'dalle2': {
    family: 'dalle2',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsMultipleImages: true,
    supportsMask: true,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 256,
    maxSide: 1024,
    maxPixels: 1024 * 1024,
    maxAspectRatio: 4,
    fixedSizesOnly: true,
    allowedSizes: ['256x256', '512x512', '1024x1024'],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'gemini-image': {
    family: 'gemini-image',
    supportsBackground: true,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['auto', 'low', 'medium', 'high'],
    defaultQuality: 'auto',
    outputFormats: ['png', 'jpeg'],
    defaultOutputFormat: 'png',
  },

  'flux': {
    family: 'flux',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 8,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'stable-diffusion': {
    family: 'stable-diffusion',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: true,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 8,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 4,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'midjourney': {
    family: 'midjourney',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: false,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'kling': {
    family: 'kling',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 512,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png', 'jpeg'],
    defaultOutputFormat: 'png',
  },

  'seedream': {
    family: 'seedream',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 512,
    maxSide: 3072,
    maxPixels: 3072 * 3072,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png', 'jpeg'],
    defaultOutputFormat: 'png',
  },

  'ideogram': {
    family: 'ideogram',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 4,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'hidream': {
    family: 'hidream',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 8,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'recraft': {
    family: 'recraft',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 0,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'playground': {
    family: 'playground',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 8,
    minSide: 256,
    maxSide: 1536,
    maxPixels: 1536 * 1536,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'leonardo': {
    family: 'leonardo',
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsMultipleImages: false,
    supportsMask: true,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 8,
    minSide: 256,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 3,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard', 'hd'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },

  'other': {
    family: 'other',
    // 未知模型：保守策略，只发核心字段，不发扩展字段
    supportsBackground: false,
    supportsOutputCompression: false,
    supportsInputFidelity: false,
    supportsModeration: false,
    supportsStyle: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsMultipleImages: false,
    supportsMask: false,
    supportsStreamPreview: false,
    supportsResponsesAPI: false,
    sizeAlignment: 16,
    minSide: 64,
    maxSide: 2048,
    maxPixels: 2048 * 2048,
    maxAspectRatio: 4,
    fixedSizesOnly: false,
    allowedSizes: [],
    qualityOptions: ['standard'],
    defaultQuality: 'standard',
    outputFormats: ['png'],
    defaultOutputFormat: 'png',
  },
};

// ======================== 查询 API ========================

/**
 * 获取模型能力声明
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
  const family = classifyModelFamily(modelId);
  const caps = { ...CAPABILITY_TABLE[family] };

  // gpt-image 家族内的细粒度差异
  if (family === 'gpt-image') {
    const id = modelId.toLowerCase().trim();
    // gpt-image-2 不支持 input_fidelity
    if (id.startsWith('gpt-image-2')) {
      caps.supportsInputFidelity = false;
    }
  }

  return caps;
}

/**
 * 判断模型是否支持某个能力
 */
export function modelSupports(modelId: string, capability: keyof ModelCapabilities): boolean {
  const caps = getModelCapabilities(modelId);
  const value = caps[capability];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return !!value;
}

/**
 * 过滤请求体 — 只保留模型支持的参数
 * 移除不支持的字段，避免上游报错
 */
export function filterRequestForModel(modelId: string, requestBody: Record<string, unknown>): Record<string, unknown> {
  const caps = getModelCapabilities(modelId);
  const filtered = { ...requestBody };

  // 按能力过滤扩展参数
  if (!caps.supportsBackground && 'background' in filtered) delete filtered.background;
  if (!caps.supportsOutputCompression && 'output_compression' in filtered) delete filtered.output_compression;
  if (!caps.supportsInputFidelity && 'input_fidelity' in filtered) delete filtered.input_fidelity;
  if (!caps.supportsModeration && 'moderation' in filtered) delete filtered.moderation;
  if (!caps.supportsStyle && 'style' in filtered) delete filtered.style;
  if (!caps.supportsSeed && 'seed' in filtered) delete filtered.seed;
  if (!caps.supportsNegativePrompt && 'negative_prompt' in filtered) delete filtered.negative_prompt;
  if (!caps.supportsMultipleImages && 'n' in filtered && filtered.n !== 1) filtered.n = 1;
  if (!caps.supportsMask && 'mask' in filtered) delete filtered.mask;
  if (!caps.supportsStreamPreview) {
    if ('stream' in filtered) delete filtered.stream;
    if ('partial_images' in filtered) delete filtered.partial_images;
  }

  // 修正输出格式
  if ('output_format' in filtered && !caps.outputFormats.includes(String(filtered.output_format))) {
    filtered.output_format = caps.defaultOutputFormat;
  }

  // 修正质量选项
  if ('quality' in filtered && !caps.qualityOptions.includes(String(filtered.quality))) {
    filtered.quality = caps.defaultQuality;
  }

  return filtered;
}

/**
 * 修正尺寸 — 根据模型能力自动修正不合法的尺寸
 * 返回修正后的尺寸字符串，如不需要修正返回 null
 */
export function repairSizeForModel(modelId: string, size: string): string | null {
  const caps = getModelCapabilities(modelId);

  // 固定尺寸模型：检查是否在允许列表中
  if (caps.fixedSizesOnly) {
    if (caps.allowedSizes.includes(size)) return null;
    // 找最接近的允许尺寸
    const parsed = parseSizeValue(size);
    if (!parsed) return caps.allowedSizes[0] || null;
    let bestMatch = caps.allowedSizes[0];
    let bestDiff = Infinity;
    for (const allowed of caps.allowedSizes) {
      const a = parseSizeValue(allowed);
      if (!a) continue;
      const diff = Math.abs(a.width - parsed.width) + Math.abs(a.height - parsed.height);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestMatch = allowed;
      }
    }
    return bestMatch !== size ? bestMatch : null;
  }

  // 任意尺寸模型：检查约束
  const parsed = parseSizeValue(size);
  if (!parsed) return null;

  let { width, height } = parsed;
  let modified = false;

  // 宽高比约束
  const aspect = width / height;
  if (aspect > caps.maxAspectRatio) {
    width = Math.round(height * caps.maxAspectRatio);
    modified = true;
  } else if (aspect < 1 / caps.maxAspectRatio) {
    height = Math.round(width / caps.maxAspectRatio);
    modified = true;
  }

  // 边长约束
  if (width > caps.maxSide) {
    const scale = caps.maxSide / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    modified = true;
  }
  if (height > caps.maxSide) {
    const scale = caps.maxSide / height;
    height = Math.round(height * scale);
    width = Math.round(width * scale);
    modified = true;
  }
  if (width < caps.minSide) {
    width = caps.minSide;
    modified = true;
  }
  if (height < caps.minSide) {
    height = caps.minSide;
    modified = true;
  }

  // 像素总数约束
  if (width * height > caps.maxPixels) {
    const scale = Math.sqrt(caps.maxPixels / (width * height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    modified = true;
  }

  // 对齐约束
  if (caps.sizeAlignment > 0) {
    const alignedW = Math.round(width / caps.sizeAlignment) * caps.sizeAlignment;
    const alignedH = Math.round(height / caps.sizeAlignment) * caps.sizeAlignment;
    if (alignedW !== width || alignedH !== height) {
      width = Math.max(caps.minSide, alignedW);
      height = Math.max(caps.minSide, alignedH);
      modified = true;
    }
  }

  if (!modified) return null;
  const newSize = `${width}x${height}`;
  return newSize !== size ? newSize : null;
}

/** 解析 "WxH" 格式 */
function parseSizeValue(size: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * 判断模型是否应走 Responses API 路径
 * 扩展：除了 gpt-image 系列，任何支持 Responses API 的模型也可以受益
 */
export function shouldUseResponsesAPI(modelId: string): boolean {
  const caps = getModelCapabilities(modelId);
  if (!caps.supportsResponsesAPI) return false;
  // 环境变量开关
  if (process.env.RESPONSES_API_ENABLED === 'false') return false;
  return true;
}

/**
 * 判断模型是否应走 Gemini Chat 路由 (/chat/completions)
 */
export function shouldUseGeminiChatRoute(modelId: string): boolean {
  return classifyModelFamily(modelId) === 'gemini-image';
}

// ======================== 模型别名规范化 ========================

/**
 * 管理员可能配置自定义模型别名（如 gpt-image-2-2k、gpt-image-2-4k），
 * 这些别名在第三方 API 端点上不被识别（第三方只认 gpt-image-2）。
 * 本函数将别名剥离质量后缀，还原为 API 可识别的基础模型名，
 * 同时返回从后缀推断的质量/尺寸信息，供后续请求参数使用。
 *
 * 已知后缀模式（仅分辨率后缀，质量后缀如 pro/max/lite 是模型名的一部分，不剥离）：
 *   -2k / -4k / -hd / -uhd / -8k  → 分辨率等级（管理员在别名中标注质量/尺寸）
 *   
 * 注意：-pro / -max / -lite 是模型名称固有部分（如 qwen-vl-max, gemini-3.1-pro），
 * 不应剥离。只有管理员手动添加的分辨率后缀（如 gpt-image-2-2k）才需要。
 */
const QUALITY_SUFFIX_RE = /-(2k|4k|8k|hd|uhd)$/i;

export interface NormalizedModelInfo {
  /** API 可识别的基础模型名（如 gpt-image-2） */
  apiModelName: string;
  /** 是否经过了别名规范化（原名 != API 名） */
  wasNormalized: boolean;
  /** 从后缀推断的分辨率等级（如 '2k', '4k', 'hd'），无后缀时为 null */
  resolutionTier: string | null;
  /** 从后缀推断的质量等级（如 'lite', 'pro', 'max'），无后缀时为 null */
  qualityTier: string | null;
}

export function normalizeModelForApi(modelId: string): NormalizedModelInfo {
  if (!modelId) {
    return { apiModelName: modelId, wasNormalized: false, resolutionTier: null, qualityTier: null };
  }

  const match = QUALITY_SUFFIX_RE.exec(modelId);
  if (!match) {
    return { apiModelName: modelId, wasNormalized: false, resolutionTier: null, qualityTier: null };
  }

  const suffix = match[1].toLowerCase();
  const apiModelName = modelId.slice(0, match.index);
  // Resolution suffixes only (2k/4k/8k/hd/uhd); pro/max/lite are part of model name
  const isResolution = ['2k', '4k', '8k', 'hd', 'uhd'].includes(suffix);

  console.log(`[normalizeModelForApi] 模型别名规范化: "${modelId}" → "${apiModelName}" (suffix: ${suffix})`);

  return {
    apiModelName,
    wasNormalized: true,
    resolutionTier: isResolution ? suffix : null,
    qualityTier: null, // pro/max/lite不再剥离，质量等级由模型自身决定
  };
}

// ======================== 专用功能模型检测 ========================

/** 判断模型是否为专用放大模型（而非通用图像模型） */
export function isUpscalerModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('seedvr') || id.includes('seed-vr') ||
    id.includes('upscaler') || id.includes('upscale') ||
    id.includes('real-esrgan') || id.includes('realesrgan') ||
    id.includes('swinir') || id.includes('scunet') ||
    (id.includes('hat') && id.includes('super')) ||
    id.includes('gfpgan') || id.includes('codeformer') ||
    id.includes('remacri') || id.includes('ultramix') ||
    id.includes('4x-anime') || id.includes('4x-ultrasharp') ||
    id.includes('esrgan')
  );
}

/** 判断模型是否为专用去背景模型 */
export function isRemoveBgModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('removebg') || id.includes('remove-bg') || id.includes('rmbg') ||
    id.includes('birefnet') || id.includes('u2net') || id.includes('isnet') ||
    id.includes('background-remover') || id.includes('cutout') ||
    id.includes('matting') || id.includes('background-remove') ||
    id.includes('remove-background') || id.includes('transparent-bg') ||
    id.includes('dis-background') || id.includes('bg-remover')
  );
}

/** 判断模型是否为专用矢量化模型 */
export function isVectorizeModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('vectorize') || id.includes('vector') ||
    id.includes('vtracer') || id.includes('starvector') ||
    id.includes('svg-convert') || id.includes('svgconvert') ||
    id.includes('recraft') || id.includes('potrace')
  );
}

/** 判断模型是否为专用分层/分割模型 */
export function isLayerModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('qwen-image-layered') || id.includes('layered') ||
    id.includes('segment') || id.includes('sam') ||
    id.includes('detection') || id.includes('yolo') ||
    id.includes('mask2former') || id.includes('segformer')
  );
}
