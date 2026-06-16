/**
 * 画布自动连线系统
 *
 * 图片之间的连线自动创建，不再需要手动拖拽。
 * 当生成变体、图生图、编辑操作完成时，自动创建语义连线。
 *
 * 关系类型:
 * - variant: 变体（同一提示词重新生成）
 * - img2img: 图生图（风格/构图/角色/IP参考）
 * - reference: 参考图（参考了原图的某方面）
 * - style-inherit: 风格继承
 * - edit: 编辑操作（擦除/蒙版/扩展/修图/去背景/放大等）
 * - crop: 裁切
 *
 * 数据结构:
 * - CanvasConnection: { id, fromId, toId, relationType, label, color, createdAt }
 */

/** 连线关系类型 */
export type ConnectionRelationType =
  | 'variant'        // 变体（同一提示词重新生成）
  | 'img2img'        // 图生图
  | 'reference'      // 参考图
  | 'style-inherit'  // 风格继承
  | 'edit'           // 编辑操作（擦除/蒙版/扩展/修图等）
  | 'crop'           // 裁切
  | 'removebg'       // 移除背景
  | 'upscale'        // 无损放大
  | 'trace';         // SVG描摹

/** 连线关系类型配置 */
export const RELATION_TYPE_CONFIG: Record<ConnectionRelationType, {
  label: string;
  color: string;
  colorMono: string;
  dashArray?: string;
  icon?: string;
}> = {
  variant: {
    label: '变体',
    color: '#60a5fa',
    colorMono: '#888888',
    dashArray: undefined,
    icon: '↻',
  },
  img2img: {
    label: '图生图',
    color: '#d4af37',
    colorMono: '#999999',
    dashArray: undefined,
    icon: '🎨',
  },
  reference: {
    label: '参考',
    color: '#c084fc',
    colorMono: '#777777',
    dashArray: '6 3',
    icon: '📎',
  },
  'style-inherit': {
    label: '风格继承',
    color: '#fb923c',
    colorMono: '#999999',
    dashArray: '4 4',
    icon: '✦',
  },
  edit: {
    label: '编辑',
    color: '#4ade80',
    colorMono: '#666666',
    dashArray: undefined,
    icon: '✎',
  },
  crop: {
    label: '裁切',
    color: '#f87171',
    colorMono: '#888888',
    dashArray: '3 3',
    icon: '✂',
  },
  removebg: {
    label: '移除背景',
    color: '#2dd4bf',
    colorMono: '#777777',
    dashArray: '6 3',
    icon: '✕',
  },
  upscale: {
    label: '无损放大',
    color: '#818cf8',
    colorMono: '#999999',
    dashArray: undefined,
    icon: '⬆',
  },
  trace: {
    label: 'SVG描摹',
    color: '#e879f9',
    colorMono: '#888888',
    dashArray: '4 4',
    icon: '◈',
  },
};

/** 编辑操作子类型（用于细化 edit 类型的标签） */
export const EDIT_SUBTYPE_LABELS: Record<string, string> = {
  erase: '擦除',
  mask: '蒙版修图',
  extend: '扩展画面',
  outpaint: '扩展画面',
  retouch: '语言修图',
  removebg: '移除背景',
  upscale: '无损放大',
  agent: 'Agent编排',
  refine: '精修',
};

/** 画布连线 */
export interface CanvasConnection {
  id: string;
  /** 源图片 ID（被操作的原图） */
  fromId: string;
  /** 目标图片 ID（生成/编辑的结果图） */
  toId: string;
  /** 关系类型 */
  relationType: ConnectionRelationType;
  /** 显示标签（自动根据类型生成，也可自定义） */
  label: string;
  /** 连线颜色（自动根据类型分配） */
  color: string;
  /** 虚线样式 */
  dashArray?: string;
  /** 创建时间 */
  createdAt: number;
}

/** 自动创建连线 */
export function createAutoConnection(
  fromId: string,
  toId: string,
  relationType: ConnectionRelationType,
  customLabel?: string,
): CanvasConnection {
  const config = RELATION_TYPE_CONFIG[relationType];
  return {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromId,
    toId,
    relationType,
    label: customLabel || config.label,
    color: config.color,
    dashArray: config.dashArray,
    createdAt: Date.now(),
  };
}

/** 为编辑操作创建带子类型的连线 */
export function createEditConnection(
  fromId: string,
  toId: string,
  editSubtype: string,
): CanvasConnection {
  const subLabel = EDIT_SUBTYPE_LABELS[editSubtype] || editSubtype;
  return createAutoConnection(fromId, toId, 'edit', subLabel);
}

/** 为图生图创建连线（可包含参考类别） */
export function createImg2ImgConnection(
  fromId: string,
  toId: string,
  categories?: string[],
): CanvasConnection {
  if (categories && categories.length > 0) {
    const categoryLabels: Record<string, string> = {
      style: '风格',
      composition: '构图',
      character: '角色',
      ip: 'IP',
      scene: '场景',
      color: '色彩',
      subject: '主体',
      detail: '细节',
    };
    const parts = categories.map(c => categoryLabels[c] || c).join('+');
    return createAutoConnection(fromId, toId, 'img2img', `图生图(${parts})`);
  }
  return createAutoConnection(fromId, toId, 'img2img');
}

/** 计算两图片之间的连接点 */
export function computeConnectionEndpoints(
  fromImg: { x: number; y: number; width: number; height: number },
  toImg: { x: number; y: number; width: number; height: number },
): { fromX: number; fromY: number; toX: number; toY: number } {
  const fromCx = fromImg.x + fromImg.width / 2;
  const fromCy = fromImg.y + fromImg.height / 2;
  const toCx = toImg.x + toImg.width / 2;
  const toCy = toImg.y + toImg.height / 2;

  const fromPt = closestEdgePoint(fromImg, toCx, toCy);
  const toPt = closestEdgePoint(toImg, fromCx, fromCy);

  return { fromX: fromPt.x, fromY: fromPt.y, toX: toPt.x, toY: toPt.y };
}

/** 计算矩形边缘最靠近目标点的点 */
function closestEdgePoint(
  rect: { x: number; y: number; width: number; height: number },
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: rect.x + rect.width, y: cy };

  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let scale: number;
  if (absDx * halfH > absDy * halfW) {
    scale = halfW / absDx;
  } else {
    scale = halfH / absDy;
  }

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

/** 生成连线路径 (贝塞尔曲线) */
export function buildConnectionPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = Math.max(20, dist * 0.25);
  const cpX = Math.abs(dx) > Math.abs(dy) ? offset : offset * 0.5;
  const cpY = Math.abs(dy) > Math.abs(dx) ? offset : offset * 0.5;

  const cp1x = fromX + (dx > 0 ? cpX : -cpX);
  const cp1y = fromY + (dy > 0 ? cpY : -cpY);
  const cp2x = toX - (dx > 0 ? cpX : -cpX);
  const cp2y = toY - (dy > 0 ? cpY : -cpY);

  return `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
}

/** 生成箭头头部 */
export function buildArrowHead(
  toX: number, toY: number,
  fromX: number, fromY: number,
  size: number = 8,
): string {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  return `M ${toX + size * Math.cos(a1)} ${toY + size * Math.sin(a1)} L ${toX} ${toY} L ${toX + size * Math.cos(a2)} ${toY + size * Math.sin(a2)}`;
}

/** 获取图片的所有连线 */
export function getConnectionsForImage(
  imageId: string,
  connections: CanvasConnection[],
): CanvasConnection[] {
  return connections.filter(c => c.fromId === imageId || c.toId === imageId);
}

/** 获取从指定图片出发的连线 */
export function getOutgoingConnections(
  imageId: string,
  connections: CanvasConnection[],
): CanvasConnection[] {
  return connections.filter(c => c.fromId === imageId);
}

/** 获取到达指定图片的连线 */
export function getIncomingConnections(
  imageId: string,
  connections: CanvasConnection[],
): CanvasConnection[] {
  return connections.filter(c => c.toId === imageId);
}

/** 删除与指定图片相关的所有连线 */
export function removeConnectionsForImage(
  imageId: string,
  connections: CanvasConnection[],
): CanvasConnection[] {
  return connections.filter(c => c.fromId !== imageId && c.toId !== imageId);
}

/** 判断点击是否在连线附近 (用于选中) */
export function isPointNearConnection(
  px: number, py: number,
  fromX: number, fromY: number,
  toX: number, toY: number,
  threshold: number = 8,
): boolean {
  const segments = 20;
  for (let i = 0; i < segments; i++) {
    const t1 = i / segments;
    const t2 = (i + 1) / segments;
    const p1 = sampleBezier(fromX, fromY, toX, toY, t1);
    const p2 = sampleBezier(fromX, fromY, toX, toY, t2);
    if (pointToSegmentDist(px, py, p1.x, p1.y, p2.x, p2.y) < threshold) {
      return true;
    }
  }
  return false;
}

function sampleBezier(
  x1: number, y1: number,
  x2: number, y2: number,
  t: number,
): { x: number; y: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(dist * 0.1, 30);
  const nx = -dy / (dist || 1);
  const ny = dx / (dist || 1);
  const cpx = mx + nx * curvature;
  const cpy = my + ny * curvature;

  const mt = 1 - t;
  return {
    x: mt * mt * x1 + 2 * mt * t * cpx + t * t * x2,
    y: mt * mt * y1 + 2 * mt * t * cpy + t * t * y2,
  };
}

function pointToSegmentDist(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
