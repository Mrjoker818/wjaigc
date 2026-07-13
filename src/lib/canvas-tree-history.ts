/**
 * 树状版本历史管理器
 * 支持从任意节点创建分支，比线性 Ctrl+Z 更专业。
 * 
 * 核心概念：
 * - 节点(Node)：每次操作记录为一个节点，包含快照和父节点引用
 * - 分支(Branch)：从同一父节点可以创建多个子节点，形成分支
 * - HEAD：当前所在的节点指针
 * - 回溯：可以跳转到任意历史节点，并从该节点创建新分支
 */

import type { CanvasImage } from '@/components/infinite-canvas';

/** 版本节点 */
export interface VersionNode {
  /** 节点唯一ID */
  id: string;
  /** 父节点ID（根节点为null） */
  parentId: string | null;
  /** 操作描述（自动生成或用户标注） */
  label: string;
  /** 完整快照（当前画布所有图片） */
  snapshot: CanvasImage[];
  /** 创建时间 */
  timestamp: number;
  /** 子节点ID列表 */
  children: string[];
  /** 是否为当前分支的活跃节点 */
  isHead: boolean;
  /** 用户自定义标注 */
  userMark?: string;
  /** 操作类型（add/remove/update/move等） */
  operationType?: 'add' | 'remove' | 'update' | 'move' | 'multi' | 'init';
}

/** 分支信息 */
export interface BranchInfo {
  /** 分支ID（等于分支起点的节点ID） */
  id: string;
  /** 分支名称（用户标注或自动生成） */
  name: string;
  /** 分支起点节点ID */
  startNodeId: string;
  /** 分支当前HEAD节点ID */
  headNodeId: string;
  /** 分支深度（从根节点开始的层数） */
  depth: number;
}

/** 树状历史管理器配置 */
export interface TreeHistoryConfig {
  /** 最大节点数量（防止内存溢出） */
  maxNodes?: number;
  /** 是否自动生成操作描述 */
  autoLabel?: boolean;
  /** 快照压缩阈值（超过此数量图片时压缩） */
  compressThreshold?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: TreeHistoryConfig = {
  maxNodes: 500,
  autoLabel: true,
  compressThreshold: 50,
};

export class TreeHistoryManager {
  private nodes: Map<string, VersionNode> = new Map();
  private rootId: string | null = null;
  private headId: string | null = null;
  private config: TreeHistoryConfig;
  
  /** 当前分支路径（从根节点到HEAD的节点ID列表） */
  private currentPath: string[] = [];
  
  /** 分支列表 */
  private branches: BranchInfo[] = [];

  constructor(config: TreeHistoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 初始化根节点 */
  initializeRoot(images: CanvasImage[], label: string = '初始状态'): string {
    const rootId = this.generateId();
    const rootNode: VersionNode = {
      id: rootId,
      parentId: null,
      label,
      snapshot: this.compressSnapshot(images),
      timestamp: Date.now(),
      children: [],
      isHead: true,
      operationType: 'init',
    };
    
    this.nodes.set(rootId, rootNode);
    this.rootId = rootId;
    this.headId = rootId;
    this.currentPath = [rootId];
    this.branches = [{
      id: rootId,
      name: '主分支',
      startNodeId: rootId,
      headNodeId: rootId,
      depth: 0,
    }];
    
    return rootId;
  }

  /** 记录新操作（创建新节点） */
  recordOperation(
    images: CanvasImage[],
    label?: string,
    operationType?: VersionNode['operationType']
  ): string {
    // 如果没有根节点，先初始化
    if (!this.rootId) {
      return this.initializeRoot(images, label || '初始状态');
    }

    const nodeId = this.generateId();
    const autoLabel = this.generateAutoLabel(images, operationType);
    
    const newNode: VersionNode = {
      id: nodeId,
      parentId: this.headId,
      label: label || autoLabel,
      snapshot: this.compressSnapshot(images),
      timestamp: Date.now(),
      children: [],
      isHead: true,
      operationType,
    };

    // 更新父节点的children列表
    const parentNode = this.nodes.get(this.headId!);
    if (parentNode) {
      parentNode.children.push(nodeId);
      parentNode.isHead = false;
    }

    this.nodes.set(nodeId, newNode);
    this.headId = nodeId;
    this.currentPath.push(nodeId);

    // 更新分支HEAD
    const currentBranch = this.branches.find(b => b.headNodeId === newNode.parentId);
    if (currentBranch) {
      currentBranch.headNodeId = nodeId;
    }

    // 清理超出限制的节点（保留当前路径）
    this.cleanupOldNodes();

    return nodeId;
  }

  /** 从任意节点创建新分支 */
  createBranch(fromNodeId: string, images: CanvasImage[], branchName?: string): string {
    const fromNode = this.nodes.get(fromNodeId);
    if (!fromNode) {
      throw new Error(`节点 ${fromNodeId} 不存在`);
    }

    // 创建分支起点节点
    const branchId = this.generateId();
    const newBranchNode: VersionNode = {
      id: branchId,
      parentId: fromNodeId,
      label: branchName || `分支 ${this.branches.length + 1}`,
      snapshot: this.compressSnapshot(images),
      timestamp: Date.now(),
      children: [],
      isHead: true,
      operationType: 'init',
      userMark: branchName,
    };

    // 更新父节点
    fromNode.children.push(branchId);

    const previousHead = this.headId ? this.nodes.get(this.headId) : undefined;
    if (previousHead) {
      previousHead.isHead = false;
    }

    this.nodes.set(branchId, newBranchNode);
    this.headId = branchId;

    // 计算新路径
    this.currentPath = this.getPathToNode(branchId);

    // 创建分支信息
    const newBranch: BranchInfo = {
      id: branchId,
      name: branchName || `分支 ${this.branches.length + 1}`,
      startNodeId: branchId,
      headNodeId: branchId,
      depth: this.currentPath.length - 1,
    };
    this.branches.push(newBranch);

    return branchId;
  }

  /** 跳转到指定节点 */
  jumpToNode(nodeId: string): CanvasImage[] | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    // 更新HEAD状态
    const oldHead = this.nodes.get(this.headId!);
    if (oldHead) {
      oldHead.isHead = false;
    }
    node.isHead = true;
    this.headId = nodeId;

    // 更新当前路径
    this.currentPath = this.getPathToNode(nodeId);

    // 更新分支HEAD（如果该节点属于某个分支）
    this.updateBranchHead(nodeId);

    return this.decompressSnapshot(node.snapshot);
  }

  /** 撤销（沿当前分支向上回退一步） */
  undo(): CanvasImage[] | null {
    if (!this.headId || this.currentPath.length <= 1) return null;

    const currentHead = this.nodes.get(this.headId);
    if (!currentHead || !currentHead.parentId) return null;

    return this.jumpToNode(currentHead.parentId);
  }

  /** 重做（沿当前分支向下前进一步） */
  redo(): CanvasImage[] | null {
    if (!this.headId) return null;

    const currentHead = this.nodes.get(this.headId);
    if (!currentHead || currentHead.children.length === 0) return null;

    // 选择第一个子节点（或记录用户选择的子节点）
    const nextNodeId = currentHead.children[0];
    return this.jumpToNode(nextNodeId);
  }

  /** 重做到指定子节点（多分支时使用） */
  redoToChild(childId: string): CanvasImage[] | null {
    if (!this.headId) return null;

    const currentHead = this.nodes.get(this.headId);
    if (!currentHead || !currentHead.children.includes(childId)) return null;

    return this.jumpToNode(childId);
  }

  /** 获取指定节点的完整路径 */
  getPathToNode(nodeId: string): string[] {
    const path: string[] = [];
    let currentId: string | null = nodeId;

    while (currentId) {
      path.unshift(currentId);
      const node = this.nodes.get(currentId);
      currentId = node?.parentId || null;
    }

    return path;
  }

  /** 获取当前HEAD节点的数据 */
  getCurrentSnapshot(): CanvasImage[] | null {
    if (!this.headId) return null;
    const node = this.nodes.get(this.headId);
    return node ? this.decompressSnapshot(node.snapshot) : null;
  }

  /** 获取指定节点的数据快照 */
  getSnapshot(nodeId: string): CanvasImage[] | null {
    const node = this.nodes.get(nodeId);
    return node ? this.decompressSnapshot(node.snapshot) : null;
  }

  /** 设置当前节点（用于版本回溯） */
  setCurrentNodeId(nodeId: string): boolean {
    if (!this.nodes.has(nodeId)) return false;
    
    const node = this.nodes.get(nodeId)!;
    // 从当前节点到目标节点重新计算路径
    const path = this.findPathToNode(nodeId);
    if (path.length === 0) return false;
    
    this.currentPath = path;
    this.headId = nodeId;
    node.isHead = true;
    
    // 清除之前 HEAD 标记
    for (const n of this.nodes.values()) {
      if (n.id !== nodeId && n.isHead) {
        n.isHead = false;
      }
    }
    
    return true;
  }

  /** 查找从根节点到目标节点的路径 */
  private findPathToNode(targetId: string): string[] {
    const path: string[] = [];
    let currentId: string | null = targetId;
    
    while (currentId) {
      path.unshift(currentId);
      const node = this.nodes.get(currentId);
      currentId = node?.parentId ?? null;
    }
    
    return path;
  }

  /** 获取所有节点列表（用于渲染树状图） */
  getAllNodes(): VersionNode[] {
    return Array.from(this.nodes.values());
  }

  /** 获取当前路径 */
  getCurrentPath(): string[] {
    return [...this.currentPath];
  }

  /** 获取所有分支 */
  getBranches(): BranchInfo[] {
    return [...this.branches];
  }

  /** 获取指定节点的子节点 */
  getChildren(nodeId: string): VersionNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return node.children.map(id => this.nodes.get(id)).filter(Boolean) as VersionNode[];
  }

  /** 获取指定节点的所有兄弟节点（包括自己） */
  getSiblings(nodeId: string): VersionNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    if (!node.parentId) return [node];
    
    const parent = this.nodes.get(node.parentId);
    if (!parent) return [node];
    
    return parent.children.map(id => this.nodes.get(id)).filter(Boolean) as VersionNode[];
  }

  /** 为当前节点添加用户标注 */
  markCurrentNode(mark: string): void {
    if (!this.headId) return;
    const node = this.nodes.get(this.headId);
    if (node) {
      node.userMark = mark;
    }
  }

  /** 判断是否可以撤销 */
  canUndo(): boolean {
    return this.currentPath.length > 1;
  }

  /** 判断是否可以重做 */
  canRedo(): boolean {
    if (!this.headId) return false;
    const node = this.nodes.get(this.headId);
    return node ? node.children.length > 0 : false;
  }

  /** 获取节点数量 */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /** 获取撤销次数（沿当前分支向上） */
  getUndoCount(): number {
    return this.currentPath.length - 1;
  }

  /** 获取重做次数（沿当前分支向下） */
  getRedoCount(): number {
    if (!this.headId) return 0;
    const node = this.nodes.get(this.headId);
    return node ? node.children.length : 0;
  }

  /** 清空所有历史 */
  clear(): void {
    this.nodes.clear();
    this.rootId = null;
    this.headId = null;
    this.currentPath = [];
    this.branches = [];
  }

  /** 导出历史数据（用于持久化） */
  exportData(): { nodes: VersionNode[]; rootId: string | null; headId: string | null; branches: BranchInfo[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      rootId: this.rootId,
      headId: this.headId,
      branches: this.branches,
    };
  }

  /** 导入历史数据（用于恢复） */
  importData(data: { nodes: VersionNode[]; rootId: string | null; headId: string | null; branches: BranchInfo[] }): void {
    this.clear();
    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
    }
    this.rootId = data.rootId;
    this.headId = data.headId;
    this.branches = data.branches || [];
    if (this.headId) {
      this.currentPath = this.getPathToNode(this.headId);
    }
  }

  // ====== 私有方法 ======

  private generateId(): string {
    return `v-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateAutoLabel(images: CanvasImage[], operationType?: VersionNode['operationType']): string {
    switch (operationType) {
      case 'add':
        return `添加 ${images.length} 张图片`;
      case 'remove':
        return '删除图片';
      case 'update':
        return '更新图片属性';
      case 'move':
        return '移动图片';
      case 'multi':
        return '批量操作';
      default:
        return `操作 (${images.length} 张图片)`;
    }
  }

  /** 压缩快照（减少内存占用） */
  private compressSnapshot(images: CanvasImage[]): CanvasImage[] {
    // 对于少量图片直接返回
    if (images.length < this.config.compressThreshold!) {
      return images.map(img => ({
        ...img,
        // 只保留必要字段
        id: img.id,
        url: img.url,
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
        prompt: img.prompt,
        modelName: img.modelName,
        visible: img.visible ?? true,
        locked: img.locked ?? false,
        name: img.name,
        zIndex: img.zIndex ?? 0,
      }));
    }
    
    // 大量图片时进一步压缩
    return images.map(img => ({
      id: img.id,
      url: img.url,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      prompt: img.prompt,
      modelName: img.modelName,
      visible: img.visible ?? true,
      locked: img.locked ?? false,
      name: img.name,
      zIndex: img.zIndex ?? 0,
    }));
  }

  /** 解压快照（恢复完整数据） */
  private decompressSnapshot(snapshot: CanvasImage[]): CanvasImage[] {
    return snapshot;
  }

  /** 更新分支HEAD */
  private updateBranchHead(nodeId: string): void {
    // 查找节点所属的分支
    for (const branch of this.branches) {
      const path = this.getPathToNode(nodeId);
      if (path.includes(branch.startNodeId)) {
        // 检查是否是该分支的最新节点
        const branchPath = this.getPathToNode(branch.headNodeId);
        if (path.length >= branchPath.length && path[branchPath.length - 1] === branch.headNodeId) {
          branch.headNodeId = nodeId;
        }
      }
    }
  }

  /** 清理超出限制的旧节点 */
  private cleanupOldNodes(): void {
    if (this.nodes.size <= this.config.maxNodes!) return;

    // 保留当前路径上的所有节点
    const keepIds = new Set(this.currentPath);
    
    // 保留当前路径节点的直接兄弟节点（用于分支切换）
    for (const pathId of this.currentPath) {
      const node = this.nodes.get(pathId);
      if (node?.parentId) {
        const parent = this.nodes.get(node.parentId);
        if (parent) {
          for (const siblingId of parent.children) {
            keepIds.add(siblingId);
          }
        }
      }
    }

    // 按时间戳排序，删除最旧的非保留节点
    const allNodes = Array.from(this.nodes.values())
      .filter(n => !keepIds.has(n.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    const deleteCount = this.nodes.size - this.config.maxNodes!;
    for (let i = 0; i < deleteCount && i < allNodes.length; i++) {
      const nodeToDelete = allNodes[i];
      // 从父节点的children中移除
      if (nodeToDelete.parentId) {
        const parent = this.nodes.get(nodeToDelete.parentId);
        if (parent) {
          parent.children = parent.children.filter(id => id !== nodeToDelete.id);
        }
      }
      this.nodes.delete(nodeToDelete.id);
    }
  }
}

export default TreeHistoryManager;