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

/** 各模型支持的画面比例（按官方API文档配置） */
export const MODEL_ASPECT_RATIOS: Record<string, string[]> = {
    'gemini-2.5-flash-image-preview': ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    'gemini-3-pro-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'gemini-3.1-flash-image-preview': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'doubao-seedance-4-5': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'],
    // GPT Image 2 — 官方支持的尺寸比例
    'gpt-image-2-official': ['1:1', '3:2', '2:3', '16:9', '9:16'],
    'gpt-image-2': ['1:1', '3:2', '2:3', '16:9', '9:16'],
    // DALL-E 3
    'dall-e-3': ['1:1', '16:9', '9:16'],
    // Stable Diffusion 系列 - 支持多种比例
    'stable-diffusion': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'sd-xl': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    'sd-3': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    // Flux 系列
    'flux': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
};

/** 各模型支持的质量/分辨率档位（按官方API文档配置） */
export const MODEL_QUALITIES: Record<string, string[]> = {
    // Gemini 系列 - resolution类型
    'gemini-2.5-flash-image-preview': ['1K'],
    'gemini-3-pro-image-preview': ['1K', '2K'],
    'gemini-3.1-flash-image-preview': ['1K', '2K', '4K'],
    // Seedream 系列 - resolution类型
    'doubao-seedance-4-5': ['2K', '4K'],
    // GPT-Image 系列 - quality类型
    'gpt-image-2-official': ['auto', 'low', 'medium', 'high'],
    'gpt-image-2': ['auto', 'low', 'medium', 'high'],
    // DALL-E 3 - quality类型
    'dall-e-3': ['standard', 'hd'],
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
    'gemini-3-pro-image-preview': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048'
    },
    'gemini-3.1-flash-image-preview': {
        'standard': '1024',
        '1K': '1024',
        '2K': '2048',
        '4K': '4096'
    },
    // Seedream 系列
    'doubao-seedance-4-5': {
        'standard': '2K',
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
    'style': 70, 'composition': 60, 'scene': 50, 'color': 50, 'subject': 50, 'detail': 50
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
    // Seedance 系列
    'doubao-seedance-4-5': {
      '1:1': { 'standard': '2048x2048', '2K': '2048x2048', 'ultra': '4096x4096', '4K': '4096x4096' },
      '4:3': { 'standard': '2048x1536', '2K': '2048x1536', 'ultra': '3840x2880', '4K': '3840x2880' },
      '3:4': { 'standard': '1536x2048', '2K': '1536x2048', 'ultra': '2880x3840', '4K': '2880x3840' },
      '16:9': { 'standard': '2048x1152', '2K': '2048x1152', 'ultra': '3840x2160', '4K': '3840x2160' },
      '9:16': { 'standard': '1152x2048', '2K': '1152x2048', 'ultra': '2160x3840', '4K': '2160x3840' },
    },
  };

  // 尝试精确匹配模型ID
  const lowerModel = (modelId || '').toLowerCase();
  let matchedKey: string | undefined;
  for (const key of Object.keys(MODEL_PIXEL_SIZES)) {
    if (lowerModel.includes(key)) {
      matchedKey = key;
      break;
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
