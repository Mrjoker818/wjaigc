/**
 * 增量 diff 历史管理器
 * 参考 tldraw HistoryManager 的 RecordsDiff 设计，简化适配 CanvasImage 数组。
 *
 * 优势（vs 全量快照）：
 * - 内存：O(changes * steps) vs O(n * steps)，拖动一张图只记录 {x, y} 变化
 * - 支持撤销 + 重做
 * - 支持 mark（标记撤销点）和 squashToMark（合并中间步骤）
 */

/** 单个图片的变化（旧值 → 新值） */
export interface FieldChanges {
  /** 字段名 → 旧值（用于 undo） */
  oldValues: Record<string, unknown>;
  /** 字段名 → 新值（用于 redo） */
  newValues: Record<string, unknown>;
}

export interface CanvasImageDiff {
  /** 新增的图片（完整数据，用于 redo 恢复） */
  added: Map<string, Record<string, unknown>>;
  addedIndices: Map<string, number>;
  /** 删除的图片（完整数据，用于 undo 恢复） */
  removed: Map<string, Record<string, unknown>>;
  removedIndices: Map<string, number>;
  /** 更新的图片 id → 变化的字段 */
  updated: Map<string, FieldChanges>;
}

export interface HistoryEntry {
  type: 'diff' | 'mark';
  id?: string;
  diff?: CanvasImageDiff;
}

export type CanvasImageLike = { id: string };

export class IncrementalHistoryManager<T extends CanvasImageLike = CanvasImageLike> {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pendingDiff: CanvasImageDiff | null = null;
  private activeTransactionId: string | null = null;
  private transactionRedoStack: HistoryEntry[] | null = null;
  private maxSteps: number;

  constructor(maxSteps = 50) {
    this.maxSteps = maxSteps;
  }

  /** 计算 before → after 的增量 diff */
  computeDiff(before: T[], after: T[]): CanvasImageDiff {
    const beforeMap = new Map(before.map(img => [img.id, img]));
    const afterMap = new Map(after.map(img => [img.id, img]));

    const added = new Map<string, Record<string, unknown>>();
    const addedIndices = new Map<string, number>();
    const removed = new Map<string, Record<string, unknown>>();
    const removedIndices = new Map<string, number>();
    const updated = new Map<string, FieldChanges>();

    // 新增的图片
    for (const [index, img] of after.entries()) {
      if (!beforeMap.has(img.id)) {
        added.set(img.id, { ...img });
        addedIndices.set(img.id, index);
      }
    }

    // 删除的图片
    for (const [index, img] of before.entries()) {
      if (!afterMap.has(img.id)) {
        removed.set(img.id, { ...img });
        removedIndices.set(img.id, index);
      }
    }

    // 更新的图片 — 只记录变化的字段
    for (const img of after) {
      const prev = beforeMap.get(img.id);
      if (!prev) continue;

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      let hasChanges = false;

      // 检查 img 中变化的字段
      for (const key of Object.keys(img)) {
        const imgVal = (img as Record<string, unknown>)[key];
        const prevVal = (prev as Record<string, unknown>)[key];
        if (imgVal !== prevVal) {
          oldValues[key] = prevVal;
          newValues[key] = imgVal;
          hasChanges = true;
        }
      }

      // 检查 prev 中有但 img 中没有的字段（被删除的字段）
      for (const key of Object.keys(prev)) {
        if (!(key in img) && !(key in oldValues)) {
          oldValues[key] = (prev as Record<string, unknown>)[key];
          newValues[key] = undefined;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        updated.set(img.id, { oldValues, newValues });
      }
    }

    return { added, addedIndices, removed, removedIndices, updated };
  }

  /** 记录一次变更（自动计算 diff 并存入 pending） */
  recordChange(before: T[], after: T[]): void {
    const diff = this.computeDiff(before, after);

    if (this.isEmptyDiff(diff)) return;

    if (!this.pendingDiff) {
      this.pendingDiff = diff;
    } else {
      this.mergeDiffs(this.pendingDiff, diff);
    }

    // 新变更清除 redo 栈
    this.redoStack = [];

    // 离散操作立即形成一步；连续手势仅在显式事务提交时形成一步。
    if (!this.activeTransactionId) this.flushPending();
  }

  beginTransaction(id: string): void {
    if (!id) throw new Error('History transaction ID is required');
    if (this.activeTransactionId) {
      throw new Error(`History transaction ${this.activeTransactionId} is already active`);
    }
    this.flushPending();
    this.activeTransactionId = id;
    this.transactionRedoStack = [...this.redoStack];
  }

  commitTransaction(id: string): void {
    this.assertActiveTransaction(id);
    this.flushPending();
    this.activeTransactionId = null;
    this.transactionRedoStack = null;
  }

  rollbackTransaction(id: string, currentImages: T[]): T[] {
    this.assertActiveTransaction(id);
    const result = this.pendingDiff
      ? this.applyReverseDiff(currentImages, this.pendingDiff)
      : currentImages;
    this.pendingDiff = null;
    this.activeTransactionId = null;
    if (this.transactionRedoStack) this.redoStack = this.transactionRedoStack;
    this.transactionRedoStack = null;
    return result;
  }

  /** 标记当前 pending diff 为一个撤销点 */
  mark(id?: string): void {
    this.flushPending();
    this.undoStack.push({ type: 'mark', id });
  }

  /** 刷新 pending diff 到 undo 栈 */
  private flushPending(): void {
    if (this.pendingDiff && !this.isEmptyDiff(this.pendingDiff)) {
      this.undoStack.push({ type: 'diff', diff: this.pendingDiff });
      this.pendingDiff = null;

      // 超过最大步数时移除最旧的条目
      while (this.undoStack.length > this.maxSteps) {
        this.undoStack.shift();
      }
    }
  }

  /** 合并到撤销点之间的所有 diff */
  squashToMark(markId: string): void {
    this.flushPending();
    const collected: CanvasImageDiff[] = [];
    let markIndex = -1;

    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const entry = this.undoStack[i];
      if (entry.type === 'mark' && entry.id === markId) {
        markIndex = i;
        break;
      }
      if (entry.type === 'diff' && entry.diff) {
        collected.unshift(entry.diff);
      }
    }

    if (markIndex === -1 || collected.length === 0) return;

    const merged = this.createEmptyDiff();
    for (const diff of collected) {
      this.mergeDiffs(merged, diff);
    }

    this.undoStack = [
      ...this.undoStack.slice(0, markIndex),
      { type: 'diff', diff: merged },
    ];
  }

  /** 撤销：将最近一个 diff 应用反向变更 */
  undo(currentImages: T[]): T[] {
    this.flushPending();

    // 跳过栈顶的 mark
    while (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1].type === 'mark') {
      const mark = this.undoStack.pop()!;
      this.redoStack.push(mark);
    }

    if (this.undoStack.length === 0) return currentImages;

    const entry = this.undoStack.pop()!;
    if (entry.type !== 'diff' || !entry.diff) return currentImages;

    this.redoStack.push(entry);
    return this.applyReverseDiff(currentImages, entry.diff);
  }

  /** 重做：将最近一个 diff 应用正向变更 */
  redo(currentImages: T[]): T[] {
    this.flushPending();

    // 跳过栈顶的 mark
    while (this.redoStack.length > 0 && this.redoStack[this.redoStack.length - 1].type === 'mark') {
      const mark = this.redoStack.pop()!;
      this.undoStack.push(mark);
    }

    if (this.redoStack.length === 0) return currentImages;

    const entry = this.redoStack.pop()!;
    if (entry.type !== 'diff' || !entry.diff) return currentImages;

    this.undoStack.push(entry);
    return this.applyForwardDiff(currentImages, entry.diff);
  }

  /** 应用反向 diff（撤销） */
  private applyReverseDiff(images: T[], diff: CanvasImageDiff): T[] {
    let result = [...images];

    // 1. 移除新增的图片
    const addedIds = new Set(diff.added.keys());
    result = result.filter(img => !addedIds.has(img.id));

    // 2. 恢复删除的图片
    for (const [id, data] of [...diff.removed.entries()].sort((left, right) => (
      (diff.removedIndices.get(left[0]) ?? Number.MAX_SAFE_INTEGER)
      - (diff.removedIndices.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
    ))) {
      const index = Math.max(0, Math.min(diff.removedIndices.get(id) ?? result.length, result.length));
      result.splice(index, 0, data as T);
    }

    // 3. 恢复更新的字段（用旧值替换新值）
    result = result.map(img => {
      const changes = diff.updated.get(img.id);
      if (!changes) return img;
      return { ...img, ...changes.oldValues };
    });

    return result;
  }

  /** 应用正向 diff（重做） */
  private applyForwardDiff(images: T[], diff: CanvasImageDiff): T[] {
    let result = [...images];

    // 1. 恢复新增的图片
    for (const [id, data] of [...diff.added.entries()].sort((left, right) => (
      (diff.addedIndices.get(left[0]) ?? Number.MAX_SAFE_INTEGER)
      - (diff.addedIndices.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
    ))) {
      const index = Math.max(0, Math.min(diff.addedIndices.get(id) ?? result.length, result.length));
      result.splice(index, 0, data as T);
    }

    // 2. 移除删除的图片
    const removedIds = new Set(diff.removed.keys());
    result = result.filter(img => !removedIds.has(img.id));

    // 3. 应用新值
    result = result.map(img => {
      const changes = diff.updated.get(img.id);
      if (!changes) return img;
      return { ...img, ...changes.newValues };
    });

    return result;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 || (this.pendingDiff !== null && !this.isEmptyDiff(this.pendingDiff));
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getNumUndos(): number {
    return this.undoStack.filter(e => e.type === 'diff').length + (this.pendingDiff ? 1 : 0);
  }

  getNumRedos(): number {
    return this.redoStack.filter(e => e.type === 'diff').length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingDiff = null;
    this.activeTransactionId = null;
    this.transactionRedoStack = null;
  }

  private assertActiveTransaction(id: string): void {
    if (!this.activeTransactionId) throw new Error('There is no active history transaction');
    if (this.activeTransactionId !== id) {
      throw new Error(`History transaction ${id} does not match active transaction ${this.activeTransactionId}`);
    }
  }

  /** 获取内存占用估算（字节） */
  estimateMemoryUsage(): number {
    let bytes = 0;
    const estimateDiff = (diff: CanvasImageDiff) => {
      for (const [, data] of diff.added) {
        bytes += JSON.stringify(data).length * 2;
      }
      for (const [, data] of diff.removed) {
        bytes += JSON.stringify(data).length * 2;
      }
      for (const [, changes] of diff.updated) {
        bytes += (JSON.stringify(changes.oldValues).length + JSON.stringify(changes.newValues).length) * 2;
      }
    };
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      if (entry.type === 'diff' && entry.diff) {
        estimateDiff(entry.diff);
      }
    }
    if (this.pendingDiff) {
      estimateDiff(this.pendingDiff);
    }
    return bytes;
  }

  private isEmptyDiff(diff: CanvasImageDiff): boolean {
    return diff.added.size === 0 && diff.removed.size === 0 && diff.updated.size === 0;
  }

  private createEmptyDiff(): CanvasImageDiff {
    return { added: new Map(), addedIndices: new Map(), removed: new Map(), removedIndices: new Map(), updated: new Map() };
  }

  /** 合并 diff2 到 diff1（就地修改 diff1） */
  private mergeDiffs(diff1: CanvasImageDiff, diff2: CanvasImageDiff): void {
    // 新增：diff2 新增的也加入 diff1
    for (const [id, data] of diff2.added) {
      diff1.added.set(id, data);
      const index = diff2.addedIndices.get(id);
      if (index !== undefined) diff1.addedIndices.set(id, index);
    }

    // 删除：diff2 删除的
    for (const [id, data] of diff2.removed) {
      if (diff1.added.has(id)) {
        // 新增后删除 = 抵消，移除 added 条目
        diff1.added.delete(id);
        diff1.addedIndices.delete(id);
        // 同时检查是否有 updated 记录
        diff1.updated.delete(id);
      } else if (diff1.updated.has(id)) {
        // 更新后删除 = 合并为 removed，保留最原始的字段
        const existingChanges = diff1.updated.get(id)!;
        diff1.removed.set(id, { ...existingChanges.oldValues, ...data });
        const index = diff2.removedIndices.get(id);
        if (index !== undefined) diff1.removedIndices.set(id, index);
        diff1.updated.delete(id);
      } else {
        diff1.removed.set(id, data);
        const index = diff2.removedIndices.get(id);
        if (index !== undefined) diff1.removedIndices.set(id, index);
      }
    }

    // 更新：合并变化字段
    for (const [id, newChanges] of diff2.updated) {
      // 如果是 diff1 新增的图片，只更新 added 中的数据
      if (diff1.added.has(id)) {
        const addedData = diff1.added.get(id)!;
        for (const [key, value] of Object.entries(newChanges.newValues)) {
          addedData[key] = value;
        }
        continue;
      }

      const existingChanges = diff1.updated.get(id);
      if (existingChanges) {
        // 合并：保留最早的旧值，更新新值
        for (const [key, value] of Object.entries(newChanges.oldValues)) {
          if (!(key in existingChanges.oldValues)) {
            existingChanges.oldValues[key] = value;
          }
        }
        for (const [key, value] of Object.entries(newChanges.newValues)) {
          existingChanges.newValues[key] = value;
        }
      } else {
        diff1.updated.set(id, {
          oldValues: { ...newChanges.oldValues },
          newValues: { ...newChanges.newValues },
        });
      }
    }
  }
}
