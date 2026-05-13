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

  // 创建时间
  createdAt: number;
}

// 连接线节点类型
export interface ConnectionLine {
  groupId: string;
  fromImageId: string;       // 参考图ID
  toFrameId: string;         // 结果框对应的placeholder图片ID
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

/** 根据宽高比字符串计算像素尺寸 */
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
