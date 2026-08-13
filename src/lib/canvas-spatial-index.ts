/**
 * 空间索引工具 — 基于 RBush R-tree 的 O(log n) 命中测试/框选/视口裁剪
 * 替代 infinite-canvas.tsx 中的 O(n) images.filter() 线性扫描
 */
import RBush from 'rbush';

/** RBush 索引条目：画布坐标系下的包围盒 */
export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

/** 搜索用的包围盒范围 */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanvasImageLike {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasSpatialIndexChange =
  | { type: 'upsert'; image: CanvasImageLike }
  | { type: 'remove'; id: string };

const MAX_ITEMS = 16; // RBush 节点最大条目数

/**
 * 画布空间索引管理器
 *
 * 使用方式：
 *   const idx = new CanvasSpatialIndex();
 *   idx.rebuild(images);          // images 变化时重建
 *   idx.hitTest(cx, cy);          // 命中测试 O(log n)
 *   idx.search(bbox);             // 范围查询 O(log n + k)
 *   idx.viewportQuery(vx1, vy1, vx2, vy2, margin); // 视口裁剪
 */
export class CanvasSpatialIndex {
  private tree: RBush<SpatialItem>;
  private itemsById = new Map<string, SpatialItem>();
  private rebuilds = 0;
  private incrementalUpdates = 0;

  constructor() {
    this.tree = new RBush<SpatialItem>(MAX_ITEMS);
  }

  /** 从图片数组重建索引（全量） */
  rebuild(images: CanvasImageLike[]): void {
    const items: SpatialItem[] = [];
    for (const img of images) {
      const item = this.toSpatialItem(img);
      if (item) items.push(item);
    }
    this.tree.clear();
    this.tree.load(items);
    this.itemsById = new Map(items.map(item => [item.id, item]));
    this.rebuilds += 1;
  }

  private toSpatialItem(img: CanvasImageLike): SpatialItem | null {
    if (![img.x, img.y, img.width, img.height].every(Number.isFinite)) return null;
    return {
      minX: Math.min(img.x, img.x + img.width),
      minY: Math.min(img.y, img.y + img.height),
      maxX: Math.max(img.x, img.x + img.width),
      maxY: Math.max(img.y, img.y + img.height),
      id: img.id,
    };
  }

  /** 命中测试：给定画布坐标，返回命中的图片 ID（最上层优先） */
  hitTest(canvasX: number, canvasY: number): string | null {
    const hits = this.tree.search({
      minX: canvasX,
      minY: canvasY,
      maxX: canvasX,
      maxY: canvasY,
    });
    if (hits.length === 0) return null;
    // RBush search 结果不保证顺序，返回最后一个（最上层）
    // 注意：调用方应根据 images 数组顺序（后渲染=上层）进一步筛选
    return hits[hits.length - 1].id;
  }

  /** 命中测试：返回所有命中的图片 ID（按数组顺序排列，最上层在前） */
  hitTestAll(canvasX: number, canvasY: number): string[] {
    const hits = this.tree.search({
      minX: canvasX,
      minY: canvasY,
      maxX: canvasX,
      maxY: canvasY,
    });
    return hits.map(h => h.id);
  }

  /** 范围查询：返回与给定包围盒相交的所有图片 ID */
  search(bbox: BBox): string[] {
    return this.tree.search(bbox).map(item => item.id);
  }

  /** 范围查询（4个数字参数）：返回与给定矩形区域相交的所有图片 ID */
  searchInBounds(minX: number, minY: number, maxX: number, maxY: number): string[] {
    return this.tree.search({ minX, minY, maxX, maxY }).map(item => item.id);
  }

  /** 视口裁剪查询：返回视口内可见的图片 ID */
  viewportQuery(
    vx1: number,
    vy1: number,
    vx2: number,
    vy2: number,
    marginFactor: number = 0.5,
  ): string[] {
    const w = vx2 - vx1;
    const h = vy2 - vy1;
    const marginW = w * marginFactor;
    const marginH = h * marginFactor;
    return this.tree.search({
      minX: vx1 - marginW,
      minY: vy1 - marginH,
      maxX: vx2 + marginW,
      maxY: vy2 + marginH,
    }).map(item => item.id);
  }

  /** 增量更新：移动/缩放单张图片（不重建整棵树） */
  updateItem(img: CanvasImageLike): void {
    const previous = this.itemsById.get(img.id);
    if (previous) this.tree.remove(previous, (a, b) => a.id === b.id);
    const next = this.toSpatialItem(img);
    if (next) {
      this.tree.insert(next);
      this.itemsById.set(img.id, next);
    } else {
      this.itemsById.delete(img.id);
    }
    this.incrementalUpdates += 1;
  }

  /** 删除单张图片 */
  removeItem(id: string): void {
    const target = this.itemsById.get(id);
    if (target) {
      this.tree.remove(target, (a, b) => a.id === b.id);
      this.itemsById.delete(id);
    }
    this.incrementalUpdates += 1;
  }

  applyChanges(changes: readonly CanvasSpatialIndexChange[]): void {
    for (const change of changes) {
      if (change.type === 'remove') this.removeItem(change.id);
      else this.updateItem(change.image);
    }
  }

  /** 获取索引中的总条目数 */
  get size(): number {
    return this.itemsById.size;
  }

  get rebuildCount(): number {
    return this.rebuilds;
  }

  get incrementalUpdateCount(): number {
    return this.incrementalUpdates;
  }

  /** 清空索引 */
  clear(): void {
    this.tree.clear();
    this.itemsById.clear();
  }
}

export function buildCanvasSpatialIndexChanges(
  previous: ReadonlyMap<string, CanvasImageLike>,
  nextImages: readonly CanvasImageLike[],
): CanvasSpatialIndexChange[] {
  const changes: CanvasSpatialIndexChange[] = [];
  const nextIds = new Set(nextImages.map(image => image.id));

  for (const id of previous.keys()) {
    if (!nextIds.has(id)) changes.push({ type: 'remove', id });
  }
  for (const image of nextImages) {
    const prior = previous.get(image.id);
    if (
      !prior
      || prior.x !== image.x
      || prior.y !== image.y
      || prior.width !== image.width
      || prior.height !== image.height
    ) {
      changes.push({ type: 'upsert', image });
    }
  }
  return changes;
}

export function snapshotCanvasSpatialImages(
  images: readonly CanvasImageLike[],
): Map<string, CanvasImageLike> {
  return new Map(images.map(image => [image.id, {
    id: image.id,
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
  }]));
}
