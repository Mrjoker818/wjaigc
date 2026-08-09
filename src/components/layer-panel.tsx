'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Trash2, ChevronUp, ChevronDown,
  GripVertical, MoreHorizontal, Pencil, X, Check, Image as ImageIcon,
  Layers, Square, Circle, Triangle, Type, FileImage
} from 'lucide-react';
import type { CanvasImage } from '@/components/infinite-canvas';

/** 图层面板Props */
export interface LayerPanelProps {
  /** 当前画布所有图片 */
  images: CanvasImage[];
  /** 当前选中的图片ID数组 */
  selectedIds?: string[];
  /** 是否为单色主题 */
  isMonochrome?: boolean;
  /** 选中图片回调 */
  onSelect?: (ids: string[]) => void;
  /** 重新排序回调 */
  onReorder?: (images: CanvasImage[]) => void;
  /** 可见性切换回调 */
  onToggleVisibility?: (id: string) => void;
  /** 锁定切换回调 */
  onToggleLock?: (id: string) => void;
  /** 重命名回调 */
  onRename?: (id: string, name: string) => void;
  /** 删除回调 */
  onDelete?: (id: string) => void;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 面板位置（左、右或底部抽屉） */
  position?: 'left' | 'right' | 'bottom';
  /** 面板宽度（position='bottom' 时右侧留白宽度，用于避开右侧功能面板） */
  rightInset?: number;
  /** 面板宽度 */
  width?: number;
  /** 是否以画布中央浮窗显示 */
  floating?: boolean;
}

/** 图层项组件 */
interface LayerItemProps {
  image: CanvasImage;
  index: number;
  isSelected: boolean;
  isMonochrome: boolean;
  onSelect: () => void;
  onVisibilityToggle: () => void;
  onLockToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** 打开菜单：传入按钮的 DOMRect 用于 fixed 定位 */
  onMenuOpen?: (imageId: string, rect: DOMRect) => void;
  /** 外部触发的重命名ID */
  forceRenameId?: string | null;
  dragHandleProps?: Record<string, unknown>;
}

function LayerItem({
  image,
  index,
  isSelected,
  isMonochrome,
  onSelect,
  onVisibilityToggle,
  onLockToggle,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMenuOpen,
  forceRenameId,
}: LayerItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(image.name || `图层 ${index + 1}`);

  // 外部触发重命名
  useEffect(() => {
    if (forceRenameId === image.id) {
      setIsEditing(true);
      setEditName(image.name || `图层 ${index + 1}`);
    }
  }, [forceRenameId, image.id, image.name, index]);

  const displayName = image.name || `图层 ${index + 1}`;
  const isVisible = image.visible !== false;
  const isLocked = image.locked === true;

  const handleRenameSubmit = () => {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const bgClass = isSelected
    ? isMonochrome ? 'bg-gray-200' : 'bg-gold/10'
    : isMonochrome ? 'bg-transparent hover:bg-gray-50' : 'bg-transparent hover:bg-white/[0.02]';

  return (
    <div
      className={`group relative flex flex-col w-[108px] flex-shrink-0 rounded-lg overflow-visible cursor-pointer transition-all ${bgClass} ${isVisible ? '' : 'opacity-50'}`}
      onClick={onSelect}
      title={displayName}
    >
      {/* 缩略图区 */}
      <div className="relative w-full h-16 rounded-t-lg overflow-hidden">
        <img
          src={image.url}
          alt={displayName}
          className="w-full h-full object-cover"
          style={{ opacity: isVisible ? 1 : 0.3 }}
        />
        {/* 锁定覆盖层 */}
        {isLocked && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {/* 拖拽手柄 - 左上角 */}
        <div className="absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-100 cursor-grab p-0.5 rounded bg-black/40">
          <GripVertical className={`w-3 h-3 ${isMonochrome ? 'text-gray-300' : 'text-gold'}`} />
        </div>
        {/* 操作按钮 - 右上角（hover 显示） */}
        <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onVisibilityToggle(); }}
            className="p-0.5 rounded bg-black/40 hover:bg-black/70 transition-colors"
            title={isVisible ? '隐藏图层' : '显示图层'}
          >
            {isVisible ? <Eye className="w-3 h-3 text-white" /> : <EyeOff className="w-3 h-3 text-white/70" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onLockToggle(); }}
            className="p-0.5 rounded bg-black/40 hover:bg-black/70 transition-colors"
            title={isLocked ? '解锁图层' : '锁定图层'}
          >
            {isLocked ? <Lock className="w-3 h-3 text-gold" /> : <Unlock className="w-3 h-3 text-white" />}
          </button>
        </div>
        {/* 选中边框 */}
        {isSelected && (
          <div className={`absolute inset-0 rounded-t-lg ring-2 pointer-events-none ${isMonochrome ? 'ring-gray-400' : 'ring-gold'}`} />
        )}
      </div>

      {/* 信息区 */}
      <div className={`px-1 py-1 rounded-b-lg flex flex-col gap-0.5 ${isSelected ? (isMonochrome ? 'bg-gray-200' : 'bg-gold/10') : ''}`}>
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="w-full px-1 py-0.5 text-[11px] bg-transparent border border-gold/30 rounded focus:outline-none focus:border-gold"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className={`text-[11px] leading-tight truncate text-center ${isMonochrome ? 'text-gray-700' : 'text-foreground'}`}>
            {displayName}
          </div>
        )}
        {/* 模型信息 */}
        {image.modelName && (
          <div className={`text-[9px] truncate text-center ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground opacity-60'}`}>
            {image.modelName}
          </div>
        )}
        {/* 更多菜单按钮 */}
        <div className="flex justify-center">
          <button
            onClick={(e) => { e.stopPropagation(); onMenuOpen?.(image.id, e.currentTarget.getBoundingClientRect()); }}
            className={`p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
          >
            <MoreHorizontal className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 图层面板主组件 */
export function LayerPanel({
  images,
  selectedIds = [],
  isMonochrome = false,
  onSelect,
  onReorder,
  onToggleVisibility,
  onToggleLock,
  onRename,
  onDelete,
  onClose,
  position = 'right',
  width = 220,
  floating = false,
  rightInset = 0,
}: LayerPanelProps) {
  // 按zIndex排序（高zIndex在上面）
  const sortedImages = useMemo(() => {
    return [...images]
      .map((img, idx) => ({
        ...img,
        zIndex: img.zIndex ?? idx,
        originalIndex: idx,
      }))
      .sort((a, b) => b.zIndex - a.zIndex); // 高zIndex在上面（列表顶部）
  }, [images]);

  // 可见性切换
  const handleVisibilityToggle = useCallback((imageId: string) => {
    onToggleVisibility?.(imageId);
  }, [onToggleVisibility]);

  // 锁定切换
  const handleLockToggle = useCallback((imageId: string) => {
    onToggleLock?.(imageId);
  }, [onToggleLock]);

  // 重命名触发状态
  const [forceRenameId, setForceRenameId] = useState<string | null>(null);

  // 重命名
  const handleRename = useCallback((imageId: string, name: string) => {
    onRename?.(imageId, name);
    setForceRenameId(null);
  }, [onRename]);

  // 上移一层（增加zIndex）
  const handleMoveUp = useCallback((imageId: string) => {
    if (!onReorder) return;
    const currentZIndexes = images.map(img => img.zIndex ?? 0);
    const maxZ = Math.max(...currentZIndexes);
    onReorder(images.map(img => {
      if (img.id !== imageId) return img;
      return { ...img, zIndex: maxZ + 1 };
    }));
  }, [images, onReorder]);

  // 下移一层（减少zIndex）
  const handleMoveDown = useCallback((imageId: string) => {
    if (!onReorder) return;
    const currentZIndexes = images.map(img => img.zIndex ?? 0);
    const minZ = Math.min(...currentZIndexes);
    onReorder(images.map(img => {
      if (img.id !== imageId) return img;
      return { ...img, zIndex: minZ - 1 };
    }));
  }, [images, onReorder]);

  // 批量操作状态
  const visibleCount = images.filter(img => img.visible !== false).length;
  const lockedCount = images.filter(img => img.locked === true).length;

  // 菜单状态（面板级渲染，避开滚动容器裁剪）
  const [menuState, setMenuState] = useState<{ rect: DOMRect; imageId: string } | null>(null);
  const handleMenuOpen = useCallback((imageId: string, rect: DOMRect) => {
    setMenuState({ rect, imageId });
  }, []);
  const handleMenuClose = useCallback(() => {
    setMenuState(null);
  }, []);

  const handleRenameState = useCallback((id: string) => {
    setForceRenameId(id);
  }, []);

  // 全部显示/隐藏
  const handleToggleAllVisibility = useCallback(() => {
    if (!onReorder) return;
    const allVisible = images.every(img => img.visible !== false);
    onReorder(images.map(img => ({
      ...img,
      visible: allVisible ? false : true,
    })));
  }, [images, onReorder]);

  // 全部解锁/锁定
  const handleToggleAllLock = useCallback(() => {
    if (!onReorder) return;
    const allLocked = images.every(img => img.locked === true);
    onReorder(images.map(img => ({
      ...img,
      locked: allLocked ? false : true,
    })));
  }, [images, onReorder]);

  // 拖拽排序（简化的拖拽逻辑）
  const handleDragStart = useCallback((e: React.DragEvent, imageId: string) => {
    e.dataTransfer.setData('text/plain', imageId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!onReorder) return;
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || !onReorder) return;

    // 重新排序zIndex
    const draggedIndex = images.findIndex(img => img.id === draggedId);
    if (draggedIndex === -1 || draggedIndex === targetIndex) return;

    // 找到目标位置的zIndex
    const targetZ = sortedImages[targetIndex]?.zIndex ?? 0;

    // 更新被拖拽图片的zIndex到目标位置
    onReorder(images.map(img => {
      if (img.id === draggedId) {
        return { ...img, zIndex: targetZ };
      }
      return img;
    }));
  }, [images, sortedImages, onReorder]);

  const isBottomDock = position === 'bottom';
  const positionClass = !isBottomDock && position === 'left' ? 'left-0' : 'right-0';
  const placementClass = isBottomDock
    ? 'fixed bottom-0 left-0 rounded-t-xl shadow-2xl'
    : floating
      ? 'fixed left-1/2 top-1/2 h-[min(70dvh,620px)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl'
      : `absolute ${positionClass} top-12 bottom-14`;
  const edgeBorderClass = isBottomDock
    ? 'border-t'
    : position === 'left' ? 'border-r' : 'border-l';
  const themeClass = isMonochrome
    ? isBottomDock ? 'bg-gray-50 border-t border-gray-200' : (floating ? 'bg-gray-50 border border-gray-200' : `bg-gray-50 ${edgeBorderClass} border-gray-200`)
    : isBottomDock ? 'bg-[#0a0a0a] border-t border-gold/10' : (floating ? 'bg-[#0a0a0a] border border-gold/10' : `bg-[#0a0a0a] ${edgeBorderClass} border-gold/10`);

  return (
    <div
      className={`${placementClass} z-[80] flex flex-col ${themeClass}`}
      style={{
        width: isBottomDock ? (rightInset ? `calc(100% - ${rightInset}px)` : '100%') : width,
        maxWidth: isBottomDock ? undefined : (floating ? 'calc(100dvw - 2rem)' : 'min(100%, calc(100dvw - 1rem))'),
        height: isBottomDock ? 'min(30dvh, 260px)' : undefined,
      }}
      data-popup={floating || isBottomDock ? 'layer-panel' : undefined}
    >
      {/* 标题栏 */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
        <div className="flex items-center gap-2">
          <Layers className={`w-4 h-4 ${isMonochrome ? 'text-gray-600' : 'text-gold'}`} />
          <span className={`text-sm font-medium ${isMonochrome ? 'text-gray-700' : 'text-foreground'}`}>
            图层
          </span>
          <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
            ({images.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleToggleAllVisibility}
            className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
            title="全部显示/隐藏"
          >
            {visibleCount === images.length ? (
              <Eye className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-muted-foreground'}`} />
            ) : (
              <EyeOff className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/50'}`} />
            )}
          </button>
          <button
            onClick={handleToggleAllLock}
            className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
            title="全部锁定/解锁"
          >
            {lockedCount === images.length ? (
              <Lock className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-gold'}`} />
            ) : (
              <Unlock className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
              title="关闭图层"
            >
              <X className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-muted-foreground'}`} />
            </button>
          )}
        </div>
      </div>

      {/* 图层列表 - 横向排列 */}
      <div className={`flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full ${isMonochrome ? '[&::-webkit-scrollbar-thumb]:bg-gray-300' : '[&::-webkit-scrollbar-thumb]:bg-gold/30 hover:[&::-webkit-scrollbar-thumb]:bg-gold/50'}`}>
        {images.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-2 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
            <FileImage className="w-6 h-6 opacity-50" />
            <span className="text-xs">暂无图层</span>
          </div>
        ) : (
          <div className="flex flex-row gap-2 p-2 items-start h-full w-max">
            {sortedImages.map((image, index) => (
              <div
                key={image.id}
                draggable
                onDragStart={(e) => handleDragStart(e, image.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                className="flex-shrink-0"
              >
                <LayerItem
                  image={image}
                  index={images.findIndex(img => img.id === image.id)}
                  isSelected={selectedIds.includes(image.id)}
                  isMonochrome={isMonochrome}
                  onSelect={() => onSelect?.([image.id])}
                  onVisibilityToggle={() => handleVisibilityToggle(image.id)}
                  onLockToggle={() => handleLockToggle(image.id)}
                  onRename={(name) => handleRename(image.id, name)}
                  onDelete={() => onDelete?.(image.id)}
                  onMoveUp={() => handleMoveUp(image.id)}
                  onMoveDown={() => handleMoveDown(image.id)}
                  onMenuOpen={handleMenuOpen}
                  forceRenameId={forceRenameId}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className={`flex items-center justify-between px-3 py-2 border-t ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          可见: {visibleCount}/{images.length}
        </div>
        <div className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          锁定: {lockedCount}/{images.length}
        </div>
      </div>

      {/* 面板级菜单渲染 — 避开滚动容器裁剪 */}
      {menuState && (
        <div
          className="fixed inset-0 z-[90]"
          onClick={handleMenuClose}
        >
          <div
            className={`py-1 rounded-lg shadow-lg min-w-[120px] ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/20'}`}
            style={{
              position: 'fixed',
              right: window.innerWidth - menuState.rect.right + 8,
              bottom: window.innerHeight - menuState.rect.top + 4,
              zIndex: 100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setForceRenameId(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
            >
              <Pencil className="w-3 h-3" />
              重命名
            </button>
            <button
              onClick={() => {
                handleMoveUp(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
            >
              <ChevronUp className="w-3 h-3" />
              上移一层
            </button>
            <button
              onClick={() => {
                handleMoveDown(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
            >
              <ChevronDown className="w-3 h-3" />
              下移一层
            </button>
            <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-gold/10'}`} />
            <button
              onClick={() => {
                onDelete?.(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-red-50 text-red-600' : 'hover:bg-red-500/10 text-red-400'}`}
            >
              <Trash2 className="w-3 h-3" />
              删除图层
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LayerPanel;
