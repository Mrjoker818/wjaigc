/**
 * Canvas Snap Guides — 对齐辅助线系统
 * 参考 tldraw SnapManager 的简化版实现
 * 
 * 拖动图片时自动检测与其他图片的边界/中心线对齐，
 * 显示辅助线并吸附到最近的对齐位置
 */

/** 单条辅助线 */
export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  /** 辅助线的画布坐标 (垂直线=x, 水平线=y) */
  position: number;
  /** 当前拖动图片与辅助线的偏移量 */
  offset: number;
  /** 辅助线来源描述 (用于 UI 显示) */
  source: 'center' | 'edge-left' | 'edge-right' | 'edge-top' | 'edge-bottom';
}

/** 辅助线渲染数据 */
export interface SnapGuideRender extends SnapGuide {
  /** 辅助线在视口中的起止坐标 */
  screenStart: number;
  screenEnd: number;
}

/** 图片边界信息 */
export interface ImageBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_THRESHOLD = 6; // 画布坐标系中的对齐阈值(像素)

/**
 * 计算拖动图片时所有可能的辅助线
 * @param dragBounds 被拖动图片的当前边界
 * @param allBounds 画布上所有图片的边界
 * @param threshold 对齐阈值(画布坐标), 默认 6px
 * @returns 匹配到的辅助线列表
 */
export function computeSnapGuides(
  dragBounds: ImageBounds,
  allBounds: ImageBounds[],
  threshold: number = DEFAULT_THRESHOLD
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  
  // 被拖动图片的关键位置
  const dragCx = dragBounds.x + dragBounds.width / 2;
  const dragCy = dragBounds.y + dragBounds.height / 2;
  const dragLeft = dragBounds.x;
  const dragRight = dragBounds.x + dragBounds.width;
  const dragTop = dragBounds.y;
  const dragBottom = dragBounds.y + dragBounds.height;

  for (const bounds of allBounds) {
    if (bounds.id === dragBounds.id) continue;

    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;

    // --- 垂直辅助线 (x轴对齐) ---
    
    // 中心线对齐
    if (Math.abs(dragCx - cx) < threshold) {
      guides.push({ type: 'vertical', position: cx, offset: cx - dragCx, source: 'center' });
    }
    // 左边界对齐
    if (Math.abs(dragLeft - left) < threshold) {
      guides.push({ type: 'vertical', position: left, offset: left - dragLeft, source: 'edge-left' });
    }
    // 右边界对齐
    if (Math.abs(dragRight - right) < threshold) {
      guides.push({ type: 'vertical', position: right, offset: right - dragRight, source: 'edge-right' });
    }
    // 左对右
    if (Math.abs(dragLeft - right) < threshold) {
      guides.push({ type: 'vertical', position: right, offset: right - dragLeft, source: 'edge-right' });
    }
    // 右对左
    if (Math.abs(dragRight - left) < threshold) {
      guides.push({ type: 'vertical', position: left, offset: left - dragRight, source: 'edge-left' });
    }

    // --- 水平辅助线 (y轴对齐) ---
    
    // 中心线对齐
    if (Math.abs(dragCy - cy) < threshold) {
      guides.push({ type: 'horizontal', position: cy, offset: cy - dragCy, source: 'center' });
    }
    // 上边界对齐
    if (Math.abs(dragTop - top) < threshold) {
      guides.push({ type: 'horizontal', position: top, offset: top - dragTop, source: 'edge-top' });
    }
    // 下边界对齐
    if (Math.abs(dragBottom - bottom) < threshold) {
      guides.push({ type: 'horizontal', position: bottom, offset: bottom - dragBottom, source: 'edge-bottom' });
    }
    // 上对下
    if (Math.abs(dragTop - bottom) < threshold) {
      guides.push({ type: 'horizontal', position: bottom, offset: bottom - dragTop, source: 'edge-bottom' });
    }
    // 下对上
    if (Math.abs(dragBottom - top) < threshold) {
      guides.push({ type: 'horizontal', position: top, offset: top - dragBottom, source: 'edge-top' });
    }
  }

  // 去重: 同 type+position 只保留偏移最小的一条
  const seen = new Map<string, SnapGuide>();
  for (const g of guides) {
    const key = `${g.type}:${g.position.toFixed(1)}:${g.source}`;
    const existing = seen.get(key);
    if (!existing || Math.abs(g.offset) < Math.abs(existing.offset)) {
      seen.set(key, g);
    }
  }

  return Array.from(seen.values());
}

/**
 * 从辅助线中找到最佳吸附偏移量
 * 优先级: 中心线 > 边界对齐, 偏移最小 > 偏移大
 */
export function findBestSnapOffset(guides: SnapGuide[]): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  let bestVertical: SnapGuide | null = null;
  let bestHorizontal: SnapGuide | null = null;

  for (const g of guides) {
    if (g.type === 'vertical') {
      if (!bestVertical || 
          (g.source === 'center' && bestVertical.source !== 'center') ||
          (g.source === bestVertical.source && Math.abs(g.offset) < Math.abs(bestVertical.offset))) {
        bestVertical = g;
      }
    } else {
      if (!bestHorizontal || 
          (g.source === 'center' && bestHorizontal.source !== 'center') ||
          (g.source === bestHorizontal.source && Math.abs(g.offset) < Math.abs(bestHorizontal.offset))) {
        bestHorizontal = g;
      }
    }
  }

  if (bestVertical) dx = bestVertical.offset;
  if (bestHorizontal) dy = bestHorizontal.offset;

  return { dx, dy };
}

/**
 * 生成辅助线渲染数据 (用于 SVG 渲染)
 * @param guides 辅助线列表
 * @param zoom 当前缩放级别
 * @param viewX 视口偏移 x
 * @param viewY 视口偏移 y
 * @param canvasWidth 画布容器宽度
 * @param canvasHeight 画布容器高度
 */
export function computeSnapGuideRenders(
  guides: SnapGuide[],
  zoom: number,
  viewX: number,
  viewY: number,
  canvasWidth: number,
  canvasHeight: number
): SnapGuideRender[] {
  return guides.map(guide => {
    if (guide.type === 'vertical') {
      const screenX = guide.position * zoom + viewX;
      return {
        ...guide,
        screenStart: 0,
        screenEnd: canvasHeight,
        // 替换 position 为屏幕坐标
        position: screenX,
      };
    } else {
      const screenY = guide.position * zoom + viewY;
      return {
        ...guide,
        screenStart: 0,
        screenEnd: canvasWidth,
        position: screenY,
      };
    }
  });
}
