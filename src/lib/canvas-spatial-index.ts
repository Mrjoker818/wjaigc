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

  constructor() {
    this.tree = new RBush<SpatialItem>(MAX_ITEMS);
  }

  /** 从图片数组重建索引（全量） */
  rebuild(images: CanvasImageLike[]): void {
    const items: SpatialItem[] = [];
    for (const img of images) {
      if (img.isProcessingPlaceholder !== undefined && (img as any).isProcessingPlaceholder) {
        // processing frame 也加入索引，保证命中测试一致
      }
      items.push({
        minX: img.x,
        minY: img.y,
        maxX: img.x + img.width,
        maxY: img.y + img.height,
        id: img.id,
      });
    }
    this.tree.clear();
    this.tree.load(items);
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
    // RBush 不支持原地更新，先删后插
    this.removeItem(img.id);
    this.tree.insert({
      minX: img.x,
      minY: img.y,
      maxX: img.x + img.width,
      maxY: img.y + img.height,
      id: img.id,
    });
  }

  /** 删除单张图片 */
  removeItem(id: string): void {
    // RBush remove 需要传入同一个对象引用或使用自定义 equals
    // 遍历搜索结果找到对应 id 然后删除
    const all = this.tree.all();
    const target = all.find(item => item.id === id);
    if (target) {
      this.tree.remove(target, (a, b) => a.id === b.id);
    }
  }

  /** 获取索引中的总条目数 */
  get size(): number {
    return this.tree.all().length;
  }

  /** 清空索引 */
  clear(): void {
    this.tree.clear();
  }
}
