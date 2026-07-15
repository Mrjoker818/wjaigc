'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  GitBranch, History, ChevronRight, ChevronDown, Circle, CircleDot, X, FolderTree
} from 'lucide-react';
import type { VersionNode } from '@/lib/canvas-tree-history';
import { TreeHistoryManager } from '@/lib/canvas-tree-history';

/** 版本历史面板Props */
export interface VersionHistoryPanelProps {
  /** 历史管理器实例 */
  manager: TreeHistoryManager;
  /** 是否为单色主题 */
  isMonochrome?: boolean;
  /** 恢复到指定节点回调 */
  onRestore: (nodeId: string) => void;
  /** 创建新分支回调 */
  onCreateBranch: (nodeId: string) => void;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 面板位置 */
  position?: 'left' | 'right';
  /** 面板宽度 */
  width?: number;
}

/** 时间格式化 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

/** 版本历史面板主组件 */
export function VersionHistoryPanel({
  manager,
  isMonochrome = false,
  onRestore,
  onCreateBranch,
  onClose,
  position = 'right',
  width = 280,
}: VersionHistoryPanelProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [branchFromNode, setBranchFromNode] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');

  // 获取所有节点和分支信息
  const nodes = useMemo(() => manager.getAllNodes(), [manager]);
  const branches = useMemo(() => manager.getBranches(), [manager]);
  const currentPath = useMemo(() => manager.getCurrentPath(), [manager]);
  useMemo(() => {
        manager.getCurrentSnapshot();
        return nodes.find(n => n.isHead)?.id;
      }, [manager, nodes]);

  // 获取根节点
  const rootNode = useMemo(() => nodes.find(n => n.parentId === null), [nodes]);

  // 展开当前路径上的所有节点
  useEffect(() => {
    const pathNodes = new Set(currentPath);
    setExpandedNodes(pathNodes);
  }, [currentPath]);

  // 切换节点展开状态
  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // 渲染单个节点行
  const renderNodeRow = useCallback(function renderNodeRow(node: VersionNode, depth: number, isExpanded: boolean, isCurrent: boolean, isInPath: boolean, hasChildren: boolean, children: VersionNode[]) {
    const nodeBgClass = isCurrent
      ? isMonochrome ? 'bg-blue-100 border-blue-300' : 'bg-gold/10 border-gold/30'
      : isInPath
        ? isMonochrome ? 'bg-gray-50' : 'bg-white/[0.02]'
        : isMonochrome ? 'bg-transparent hover:bg-gray-50' : 'bg-transparent hover:bg-white/[0.02]';

    return (
      <div key={node.id} className="select-none">
        {/* 节点行 */}
        <div
          className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer border-l-2 transition-all ${nodeBgClass}`}
          style={{ marginLeft: depth * 12 }}
          onClick={() => onRestore(node.id)}
        >
          {/* 展开/折叠按钮 */}
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
              className={`p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
            >
              {isExpanded ? (
                <ChevronDown className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
              ) : (
                <ChevronRight className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {/* 当前状态指示器 */}
          {isCurrent ? (
            <CircleDot className={`w-3.5 h-3.5 ${isMonochrome ? 'text-blue-600' : 'text-gold'}`} />
          ) : (
            <Circle className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-300' : 'text-muted-foreground/30'}`} />
          )}

          {/* 节点标签 */}
          <div className="flex-1 min-w-0">
            <div className={`text-xs truncate ${isCurrent ? (isMonochrome ? 'text-blue-700 font-medium' : 'text-gold font-medium') : (isMonochrome ? 'text-gray-600' : 'text-foreground')}`}>
              {node.userMark || node.label}
            </div>
          </div>

          {/* 时间戳 */}
          <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
            {formatTime(node.timestamp)}
          </div>

          {/* 操作按钮 */}
          <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100">
            {/* 创建分支 */}
            <button
              onClick={(e) => { e.stopPropagation(); setBranchFromNode(node.id); setBranchName(''); setShowBranchDialog(true); }}
              className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
              title="从此节点创建分支"
            >
              <GitBranch className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
            </button>
          </div>
        </div>

        {/* 子节点 */}
        {isExpanded && hasChildren && (
          <div className="relative">
            {/* 分支连线（如果有多个子节点） */}
            {children.length > 1 && (
              <div className={`absolute left-[${depth * 12 + 12}px] top-0 bottom-0 w-px ${isMonochrome ? 'bg-gray-200' : 'bg-gold/10'}`} />
            )}
            {children.map(child => {
              const childIsExpanded = expandedNodes.has(child.id);
              const childIsCurrent = child.isHead;
              const childIsInPath = currentPath.includes(child.id);
              const childHasChildren = child.children.length > 0;
              const childChildren = child.children.map(id => nodes.find(n => n.id === id)).filter(Boolean) as VersionNode[];
              return renderNodeRow(child, depth + 1, childIsExpanded, childIsCurrent, childIsInPath, childHasChildren, childChildren);
            })}
          </div>
        )}
      </div>
    );
  }, [expandedNodes, currentPath, nodes, isMonochrome, onRestore, toggleExpand]);

  // 渲染整个节点树
  const renderedTree = useMemo(() => {
    if (!rootNode) return null;
    const isExpanded = expandedNodes.has(rootNode.id);
    const isCurrent = rootNode.isHead;
    const isInPath = currentPath.includes(rootNode.id);
    const hasChildren = rootNode.children.length > 0;
    const children = rootNode.children.map(id => nodes.find(n => n.id === id)).filter(Boolean) as VersionNode[];
    return renderNodeRow(rootNode, 0, isExpanded, isCurrent, isInPath, hasChildren, children);
  }, [rootNode, expandedNodes, currentPath, nodes, renderNodeRow]);

  return (
    <div
      className={`absolute ${position === 'left' ? 'left-0' : 'right-0'} top-12 bottom-14 z-[80] flex flex-col ${isMonochrome ? 'bg-gray-50 border-l border-gray-200' : 'bg-[#0a0a0a] border-l border-gold/10'}`}
      style={{ width }}
    >
      {/* 标题栏 */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
        <div className="flex items-center gap-2">
          <FolderTree className={`w-4 h-4 ${isMonochrome ? 'text-gray-600' : 'text-gold'}`} />
          <span className={`text-sm font-medium ${isMonochrome ? 'text-gray-700' : 'text-foreground'}`}>
            版本历史
          </span>
        </div>
        <button
          onClick={onClose}
          className={`p-1 rounded ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
        >
          <X className={`w-4 h-4 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
        </button>
      </div>

      {/* 分支信息 */}
      {branches.length > 1 && (
        <div className={`px-3 py-2 border-b ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
          <div className="flex items-center gap-1">
            <GitBranch className={`w-3 h-3 ${isMonochrome ? 'text-gray-500' : 'text-muted-foreground'}`} />
            <span className={`text-xs ${isMonochrome ? 'text-gray-600' : 'text-muted-foreground'}`}>
              {branches.length} 个分支
            </span>
          </div>
        </div>
      )}

      {/* 版本树 */}
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-2 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
            <History className="w-6 h-6 opacity-50" />
            <span className="text-xs">暂无历史记录</span>
          </div>
        ) : (
          renderedTree
        )}
      </div>

      {/* 底部状态栏 */}
      <div className={`flex items-center justify-between px-3 py-2 border-t ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          {manager.getNodeCount()} 个版本
        </div>
        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          可撤销 {manager.getUndoCount()} 步
        </div>
      </div>

      {/* 创建分支对话框 */}
      {showBranchDialog && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center ${isMonochrome ? 'bg-white/80' : 'bg-black/80'}`}>
          <div className={`w-[90%] max-w-xs p-4 rounded-lg shadow-lg ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/20'}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-sm font-medium ${isMonochrome ? 'text-gray-800' : 'text-gold'}`}>
                创建新分支
              </h3>
              <button onClick={() => setShowBranchDialog(false)} className="p-1">
                <X className={`w-4 h-4 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
              </button>
            </div>
            <input
              type="text"
              placeholder="分支名称（可选）"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg text-sm ${isMonochrome ? 'bg-gray-50 border border-gray-200 text-gray-700' : 'bg-white/5 border border-gold/20 text-foreground'}`}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowBranchDialog(false)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm ${isMonochrome ? 'bg-gray-100 text-gray-600' : 'bg-white/5 text-muted-foreground'}`}
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (branchFromNode) {
                    onCreateBranch(branchFromNode);
                  }
                  setShowBranchDialog(false);
                }}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-gold text-black'}`}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VersionHistoryPanel;
