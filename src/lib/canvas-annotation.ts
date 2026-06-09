/**
 * ChatCanvas 批注系统 — 数据类型与工具函数
 *
 * 批注(Pin)是用户在画布上标注的修改指令，关联到具体图片后调用AI执行修改。
 */

/** 批注状态 */
export type AnnotationStatus = 'pending' | 'running' | 'done' | 'failed';

/** 框选区域（相对于原图的像素坐标，0~1归一化比例） */
export interface AnnotationRegion {
  /** 区域左上角X（归一化 0~1） */
  x: number;
  /** 区域左上角Y（归一化 0~1） */
  y: number;
  /** 区域宽度（归一化 0~1） */
  w: number;
  /** 区域高度（归一化 0~1） */
  h: number;
}

/** 画布批注数据 */
export interface CanvasAnnotation {
  /** 唯一ID */
  id: string;
  /** 批注在画布坐标中的X位置 */
  x: number;
  /** 批注在画布坐标中的Y位置 */
  y: number;
  /** 用户输入的修改意见 */
  text: string;
  /** 关联的目标图片ID（通过碰撞检测自动关联） */
  targetImageId: string | null;
  /** 可选：框选区域（归一化坐标，相对于原图） */
  region?: AnnotationRegion;
  /** 当前状态 */
  status: AnnotationStatus;
  /** AI回复（执行完成后） */
  aiReply?: string;
  /** 修改后的图片URL（执行完成后） */
  resultImageUrl?: string;
  /** 追问历史 */
  followUpHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 是否展开对话气泡 */
  chatExpanded?: boolean;
  /** 创建时间 */
  createdAt: number;
}

/** 生成唯一批注ID */
export function createAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** 创建新批注 */
export function createAnnotation(
  x: number,
  y: number,
  text: string,
  targetImageId: string | null,
  region?: AnnotationRegion,
): CanvasAnnotation {
  return {
    id: createAnnotationId(),
    x,
    y,
    text,
    targetImageId,
    region,
    status: 'pending',
    createdAt: Date.now(),
  };
}

/**
 * 碰撞检测：画布坐标是否在某张图片范围内
 * @returns 命中的图片ID，未命中返回 null
 */
export function hitTestAnnotationTarget(
  canvasX: number,
  canvasY: number,
  images: Array<{ id: string; x: number; y: number; width: number; height: number; isProcessingPlaceholder?: boolean }>,
): string | null {
  // 从上层往下找（后渲染的在上面）
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    if (img.isProcessingPlaceholder) continue;
    if (
      canvasX >= img.x &&
      canvasX <= img.x + img.width &&
      canvasY >= img.y &&
      canvasY <= img.y + img.height
    ) {
      return img.id;
    }
  }
  return null;
}

/**
 * 计算批注在图片内的归一化区域坐标
 * 用于告诉AI "修改图片的这个区域"
 */
export function computeAnnotationRegion(
  annotationX: number,
  annotationY: number,
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
): AnnotationRegion {
  const relX = Math.max(0, Math.min(1, (annotationX - imageX) / imageW));
  const relY = Math.max(0, Math.min(1, (annotationY - imageY) / imageH));
  // 默认区域为点击位置周围 30% 的范围
  const regionSize = 0.3;
  return {
    x: Math.max(0, relX - regionSize / 2),
    y: Math.max(0, relY - regionSize / 2),
    w: Math.min(regionSize, 1 - Math.max(0, relX - regionSize / 2)),
    h: Math.min(regionSize, 1 - Math.max(0, relY - regionSize / 2)),
  };
}

/**
 * 根据批注构建语言修图提示词
 * 包含区域描述（如果有框选区域）
 */
export function buildAnnotationPrompt(annotation: CanvasAnnotation): string {
  let prompt = annotation.text;

  // 如果有框选区域，补充位置描述
  if (annotation.region) {
    const { x, y, w, h } = annotation.region;
    // 判断区域大致位置
    const posH = y < 0.33 ? '上方' : y > 0.66 ? '下方' : '中间';
    const posV = x < 0.33 ? '左侧' : x > 0.66 ? '右侧' : '中间';
    prompt = `[修改位置：图片${posV}${posH}区域] ${prompt}`;
  }

  return prompt;
}

/**
 * 合并同一张图片的多条批注为一条提示词
 * 避免对同一张图反复调用API
 */
export function mergeAnnotationsForImage(
  annotations: CanvasAnnotation[],
  imageId: string,
): string {
  const imageAnnotations = annotations.filter(
    (a) => a.targetImageId === imageId && a.status === 'pending' && a.text.trim(),
  );

  if (imageAnnotations.length === 0) return '';
  if (imageAnnotations.length === 1) return buildAnnotationPrompt(imageAnnotations[0]);

  // 多条批注合并为编号列表
  const items = imageAnnotations.map((a, i) => `${i + 1}. ${buildAnnotationPrompt(a)}`);
  return `请同时进行以下修改：\n${items.join('\n')}`;
}

/** 批注状态颜色映射（黑金主题） */
export const ANNOTATION_COLORS = {
  pending: { bg: '#d4af37', border: '#b8972e', text: '#000000' },   // 金色
  running: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' },   // 蓝色
  done: { bg: '#22c55e', border: '#16a34a', text: '#ffffff' },      // 绿色
  failed: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },    // 红色
} as const;

/** 批注状态颜色映射（单色主题） */
export const ANNOTATION_COLORS_MONO = {
  pending: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' },   // 蓝色
  running: { bg: '#8b5cf6', border: '#7c3aed', text: '#ffffff' },   // 紫色
  done: { bg: '#22c55e', border: '#16a34a', text: '#ffffff' },      // 绿色
  failed: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },    // 红色
} as const;
