/**
 * 画布模式轻量连线能力 (P2-1)
 *
 * 用户可在画布上拖拽创建图片之间的关系连线，
 * 类似 tldraw 的箭头工具，但更轻量——仅记录语义关系，不做复杂约束求解。
 *
 * 数据结构:
 * - CanvasConnection: { id, fromId, toId, label?, color? }
 * - 存储在 CanvasImage 的 metadata.connections 或独立的 connections 数组
 *
 * 交互:
 * 1. 用户从图片边缘拖出 → 出现临时连线
 * 2. 松开到另一图片上 → 创建连接
 * 3. 松开到空白区域 → 取消
 * 4. 点击连线 → 选中，可删除/编辑标签
 */

export interface CanvasConnection {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  color?: string;
  createdAt: number;
}

/** 连线绘制状态 (拖拽中) */
export interface ConnectionDraft {
  fromId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** 创建新连接 */
export function createConnection(fromId: string, toId: string, label?: string): CanvasConnection {
  return {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromId,
    toId,
    label,
    createdAt: Date.now(),
  };
}

/** 计算两图片之间的连接点 (从源图片最近边缘中心到目标图片最近边缘中心) */
export function computeConnectionEndpoints(
  fromImg: { x: number; y: number; width: number; height: number },
  toImg: { x: number; y: number; width: number; height: number },
): { fromX: number; fromY: number; toX: number; toY: number } {
  const fromCx = fromImg.x + fromImg.width / 2;
  const fromCy = fromImg.y + fromImg.height / 2;
  const toCx = toImg.x + toImg.width / 2;
  const toCy = toImg.y + toImg.height / 2;

  // 从源图片边缘出发
  const fromPt = closestEdgePoint(fromImg, toCx, toCy);
  // 到目标图片边缘
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

  // 如果点在矩形内部，从中心向外推到边缘
  if (dx === 0 && dy === 0) return { x: rect.x + rect.width, y: cy };

  // 计算射线与矩形边缘的交点
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let scale: number;
  if (absDx * halfH > absDy * halfW) {
    // 与左/右边缘相交
    scale = halfW / absDx;
  } else {
    // 与上/下边缘相交
    scale = halfH / absDy;
  }

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

/** 生成连线路径 (贝塞尔曲线，更优雅) */
export function buildConnectionPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 控制点偏移量：距离的 25%，最小 20
  const offset = Math.max(20, dist * 0.25);
  // 水平方向优先偏移
  const cpX = Math.abs(dx) > Math.abs(dy) ? offset : offset * 0.5;
  const cpY = Math.abs(dy) > Math.abs(dx) ? offset : offset * 0.5;

  const cp1x = fromX + (dx > 0 ? cpX : -cpX);
  const cp1y = fromY + (dy > 0 ? cpY : -cpY);
  const cp2x = toX - (dx > 0 ? cpX : -cpX);
  const cp2y = toY - (dy > 0 ? cpY : -cpY);

  return `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
}

/** 生成箭头头部 (在终点处) */
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

/** 默认连线颜色 */
export const CONNECTION_COLORS = [
  '#d4af37', // 金色 (默认)
  '#4ade80', // 绿色
  '#60a5fa', // 蓝色
  '#f87171', // 红色
  '#c084fc', // 紫色
  '#fb923c', // 橙色
] as const;

/** 判断点击是否在连线附近 (用于选中) */
export function isPointNearConnection(
  px: number, py: number,
  fromX: number, fromY: number,
  toX: number, toY: number,
  threshold: number = 8,
): boolean {
  // 简化：将贝塞尔曲线采样为线段，检测点到线段距离
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

/** 采样贝塞尔曲线上的点 (简化版: 二次近似) */
function sampleBezier(
  x1: number, y1: number,
  x2: number, y2: number,
  t: number,
): { x: number; y: number } {
  // 简单的线性插值 + 轻微弧度
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 垂直偏移，制造弧度
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

/** 点到线段距离 */
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
