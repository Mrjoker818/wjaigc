'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  GitBranch, History, ChevronRight, ChevronDown, Circle, CircleDot,
  Undo2, Redo2, RotateCcw, BookmarkPlus, Trash2, X, Clock,
  Plus, ArrowRight, ArrowDown, Share2, FolderTree, Tag
} from 'lucide-react';
import type { VersionNode, BranchInfo } from '@/lib/canvas-tree-history';
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
  position?: 'left' | 'right' | 'bottom';
  /** 面板宽度 */
  width?: number;
  /** 是否以画布中央浮窗显示 */
  floating?: boolean;
  /** 底部抽屉时右侧面板占用的宽度（px），0 表示全页铺满 */
  rightInset?: number;
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
  floating = false,
  rightInset = 0,
}: VersionHistoryPanelProps) {
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [branchFromNode, setBranchFromNode] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');

  // 获取所有节点和分支信息
  const nodes = useMemo(() => manager.getAllNodes(), [manager]);
  const branches = useMemo(() => manager.getBranches(), [manager]);
  const currentPath = useMemo(() => manager.getCurrentPath(), [manager]);
  const headId = useMemo(() => {
    const snapshot = manager.getCurrentSnapshot();
    return nodes.find(n => n.isHead)?.id;
  }, [manager, nodes]);

  // 主路径节点（从根到当前 head 的线性路径，适配底部抽屉横向时间线）
  const pathNodes = useMemo(
    () => currentPath.map(id => nodes.find(n => n.id === id)).filter(Boolean) as VersionNode[],
    [currentPath, nodes],
  );

  // 分支节点（不在主路径上的其他版本，按时间倒序）
  const branchNodes = useMemo(() => {
    const pathSet = new Set(currentPath);
    return nodes.filter(n => !pathSet.has(n.id)).sort((a, b) => b.timestamp - a.timestamp);
  }, [nodes, currentPath]);

  // 渲染横向时间线卡片（适配底部抽屉）
  const renderTimelineCard = useCallback((node: VersionNode, isPath: boolean) => {
    const isCurrent = node.isHead;
    const thumbUrl = node.snapshot?.[node.snapshot.length - 1]?.url;
    const cardBg = isCurrent
      ? (isMonochrome ? 'bg-blue-50 border-blue-300' : 'bg-gold/10 border-gold/40')
      : isPath
        ? (isMonochrome ? 'bg-gray-50 border-gray-200' : 'bg-white/[0.03] border-gold/10')
        : (isMonochrome ? 'bg-gray-50/60 border-gray-200' : 'bg-white/[0.02] border-gold/5');
    return (
      <div
        key={node.id}
        className={`group relative flex flex-col w-[96px] flex-shrink-0 rounded-lg border cursor-pointer transition-all ${cardBg}`}
        onClick={() => onRestore(node.id)}
        title={`${node.userMark || node.label} — ${formatTime(node.timestamp)}`}
      >
        {/* 缩略图 */}
        <div className="relative w-full h-10 rounded-t-lg overflow-hidden bg-black/20">
          {thumbUrl ? (
            <img src={thumbUrl} alt={node.userMark || node.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <History className={`w-4 h-4 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/40'}`} />
            </div>
          )}
          {/* 当前标记 */}
          {isCurrent && (
            <div className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/50">
              <CircleDot className={`w-3 h-3 ${isMonochrome ? 'text-blue-500' : 'text-gold'}`} />
            </div>
          )}
          {/* hover 分支按钮 */}
          <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setBranchFromNode(node.id); setBranchName(''); setShowBranchDialog(true); }}
              className={`p-1 rounded ${isMonochrome ? 'bg-gray-700/70 hover:bg-gray-600' : 'bg-black/50 hover:bg-black/70'}`}
              title="从此节点创建分支"
            >
              <GitBranch className="w-3 h-3 text-white" />
            </button>
          </div>
        </div>
        {/* 信息区 */}
        <div className={`px-1.5 py-1 rounded-b-lg ${isCurrent ? (isMonochrome ? 'bg-blue-50' : 'bg-gold/10') : ''}`}>
          <div className={`text-[10px] leading-tight truncate ${isCurrent ? (isMonochrome ? 'text-blue-700 font-medium' : 'text-gold font-medium') : (isMonochrome ? 'text-gray-600' : 'text-foreground')}`}>
            {node.userMark || node.label}
          </div>
          <div className={`text-[9px] mt-0.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/70'}`}>
            {formatTime(node.timestamp)}
          </div>
        </div>
      </div>
    );
  }, [isMonochrome, onRestore, setShowBranchDialog, setBranchFromNode, setBranchName, setShowBranchDialog]);

  const isBottom = position === 'bottom';
  const placementClass = isBottom
    ? 'fixed bottom-0 left-0 h-[min(30dvh,260px)] rounded-t-xl shadow-2xl'
    : floating
      ? 'fixed left-1/2 top-1/2 h-[min(70dvh,620px)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl'
      : `absolute ${position === 'left' ? 'left-0' : 'right-0'} top-12 bottom-14`;
  const edgeBorderClass = isBottom ? '' : (position === 'left' ? 'border-r' : 'border-l');
  const themeClass = isMonochrome
    ? isBottom ? 'bg-gray-50 border-t border-gray-200' : (floating ? 'bg-gray-50 border border-gray-200' : `bg-gray-50 ${edgeBorderClass} border-gray-200`)
    : isBottom ? 'bg-[#0a0a0a] border-t border-gold/10' : (floating ? 'bg-[#0a0a0a] border border-gold/10' : `bg-[#0a0a0a] ${edgeBorderClass} border-gold/10`);

  return (
    <div
      role="dialog"
      aria-label="版本历史"
      className={`${placementClass} z-[80] flex flex-col ${themeClass}`}
      style={{ width: isBottom ? (rightInset ? `calc(100% - ${rightInset}px)` : '100%') : width, maxWidth: isBottom ? undefined : (floating ? 'calc(100dvw - 2rem)' : 'min(100%, calc(100dvw - 1rem))') }}
      data-popup={floating || isBottom ? 'version-history' : undefined}
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
          aria-label="关闭版本历史"
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

      {/* 版本时间线（横向卡片，适配底部抽屉） */}
      {nodes.length === 0 ? (
        <div className={`flex-1 flex flex-col items-center justify-center gap-2 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          <History className="w-6 h-6 opacity-50" />
          <span className="text-xs">暂无历史记录</span>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 主路径时间线 */}
          <div className={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/60'}`}>
            当前分支
          </div>
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gold/40 [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="flex flex-row gap-2 px-3 py-2 items-stretch w-max min-w-full">
              {pathNodes.map(node => renderTimelineCard(node, true))}
            </div>
          </div>
          {/* 分支轨道 */}
          {branchNodes.length > 0 && (
            <>
              <div className={`px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/60'}`}>
                其他分支
              </div>
              <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gold/40 [&::-webkit-scrollbar-track]:bg-transparent">
                <div className="flex flex-row gap-2 px-3 py-2 items-stretch w-max min-w-full">
                  {branchNodes.map(node => renderTimelineCard(node, false))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

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
