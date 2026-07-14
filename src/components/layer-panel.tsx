'use client';

import React, { useState, useCallback, useMemo } from 'react';
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
  /** 面板位置（左或右） */
  position?: 'left' | 'right';
  /** 面板宽度 */
  width?: number;
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
}: LayerItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(image.name || `图层 ${index + 1}`);
  const [showMenu, setShowMenu] = useState(false);

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
      className={`group relative flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-all ${bgClass} ${isVisible ? '' : 'opacity-50'}`}
      onClick={onSelect}
    >
      {/* 拖拽手柄 */}
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab">
        <GripVertical className={`w-3 h-3 ${isMonochrome ? 'text-gray-400' : 'text-gold-muted'}`} />
      </div>

      {/* 缩略图 */}
      <div className="flex-shrink-0 w-8 h-8 rounded overflow-hidden relative">
        <img
          src={image.url}
          alt={displayName}
          className="w-full h-full object-cover"
          style={{ opacity: isVisible ? 1 : 0.3 }}
        />
        {/* 锁定覆盖层 */}
        {isLocked && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <Lock className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* 图层名称 */}
      <div className="flex-1 min-w-0">
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
            className="w-full px-1 py-0.5 text-xs bg-transparent border border-gold/30 rounded focus:outline-none focus:border-gold"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className={`text-xs truncate ${isMonochrome ? 'text-gray-700' : 'text-foreground'}`}>
            {displayName}
          </div>
        )}
        {/* 模型信息 */}
        {image.modelName && (
          <div className={`text-xs truncate ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground opacity-60'}`}>
            {image.modelName}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100">
        {/* 可见性 */}
        <button
          onClick={(e) => { e.stopPropagation(); onVisibilityToggle(); }}
          className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
          title={isVisible ? '隐藏图层' : '显示图层'}
        >
          {isVisible ? (
            <Eye className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-muted-foreground'}`} />
          ) : (
            <EyeOff className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground/50'}`} />
          )}
        </button>

        {/* 锁定 */}
        <button
          onClick={(e) => { e.stopPropagation(); onLockToggle(); }}
          className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
          title={isLocked ? '解锁图层' : '锁定图层'}
        >
          {isLocked ? (
            <Lock className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-gold'}`} />
          ) : (
            <Unlock className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
          )}
        </button>

        {/* 更多菜单 */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className={`p-1 rounded transition-colors ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
        >
          <MoreHorizontal className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`} />
        </button>
      </div>

      {/* 更多菜单弹窗 */}
      {showMenu && (
        <div
          className={`absolute right-2 top-full mt-1 z-50 py-1 rounded-lg shadow-lg ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/20'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setIsEditing(true); setShowMenu(false); }}
            className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
          >
            <Pencil className="w-3 h-3" />
            重命名
          </button>
          <button
            onClick={() => { onMoveUp(); setShowMenu(false); }}
            className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
          >
            <ChevronUp className="w-3 h-3" />
            上移一层
          </button>
          <button
            onClick={() => { onMoveDown(); setShowMenu(false); }}
            className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
          >
            <ChevronDown className="w-3 h-3" />
            下移一层
          </button>
          <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-gold/10'}`} />
          <button
            onClick={() => { onDelete(); setShowMenu(false); }}
            className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 ${isMonochrome ? 'hover:bg-red-50 text-red-600' : 'hover:bg-red-500/10 text-red-400'}`}
          >
            <Trash2 className="w-3 h-3" />
            删除图层
          </button>
        </div>
      )}
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

  // 重命名
  const handleRename = useCallback((imageId: string, name: string) => {
    onRename?.(imageId, name);
  }, [onRename]);

  // 图层偏移辅助函数：按zIndex排序后偏移目标图层位置
  const moveLayerByOffset = useCallback((imgs: typeof images, imageId: string, offset: number) => {
    const sorted = [...imgs].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const idx = sorted.findIndex(img => img.id === imageId);
    if (idx < 0) return imgs;
    const newIdx = Math.max(0, Math.min(sorted.length - 1, idx + offset));
    if (newIdx === idx) return imgs;
    // 移除目标图层
    const [moved] = sorted.splice(idx, 1);
    // 插入新位置
    sorted.splice(newIdx, 0, moved);
    // 重新分配zIndex
    return imgs.map(img => {
      const newPos = sorted.findIndex(s => s.id === img.id);
      return newPos >= 0 ? { ...img, zIndex: newPos } : img;
    });
  }, []);

  // 拖拽重排：将draggedId移到targetId的位置
  const reorderLayers = useCallback((imgs: typeof images, draggedId: string, targetId: string) => {
    const draggedImg = imgs.find(img => img.id === draggedId);
    const targetImg = imgs.find(img => img.id === targetId);
    if (!draggedImg || !targetImg) return imgs;
    const targetZ = targetImg.zIndex ?? 0;
    const draggedZ = draggedImg.zIndex ?? 0;
    const direction = draggedZ < targetZ ? 1 : -1;
    return imgs.map(img => {
      if (img.id === draggedId) return { ...img, zIndex: targetZ };
      if (direction > 0 && (img.zIndex ?? 0) > draggedZ && (img.zIndex ?? 0) <= targetZ) {
        return { ...img, zIndex: (img.zIndex ?? 0) - 1 };
      }
      if (direction < 0 && (img.zIndex ?? 0) < draggedZ && (img.zIndex ?? 0) >= targetZ) {
        return { ...img, zIndex: (img.zIndex ?? 0) + 1 };
      }
      return img;
    });
  }, []);

  // 上移一层（增加zIndex）
  const handleMoveUp = useCallback((imageId: string) => {
    if (!onReorder) return;
    onReorder(moveLayerByOffset(images, imageId, -1));
  }, [images, onReorder, moveLayerByOffset]);

  // 下移一层（减少zIndex）
  const handleMoveDown = useCallback((imageId: string) => {
    if (!onReorder) return;
    onReorder(moveLayerByOffset(images, imageId, 1));
  }, [images, onReorder, moveLayerByOffset]);

  // 批量操作状态
  const visibleCount = images.filter(img => img.visible !== false).length;
  const lockedCount = images.filter(img => img.locked === true).length;

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

    // 找到目标位置的图片ID
    const targetId = sortedImages[targetIndex]?.id;
    if (!targetId) return;

    // 更新被拖拽图片的zIndex到目标位置
    onReorder(reorderLayers(images, draggedId, targetId));
  }, [images, sortedImages, onReorder]);

  const positionClass = position === 'left' ? 'left-0' : 'right-0';

  return (
    <div
      className={`absolute ${positionClass} top-12 bottom-14 z-[80] flex flex-col ${isMonochrome ? 'bg-gray-50 border-r border-gray-200' : 'bg-[#0a0a0a] border-r border-gold/10'}`}
      style={{ width }}
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
        </div>
      </div>

      {/* 图层列表 */}
      <div className="flex-1 overflow-y-auto">
        {images.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-2 ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
            <FileImage className="w-6 h-6 opacity-50" />
            <span className="text-xs">暂无图层</span>
          </div>
        ) : (
          sortedImages.map((image, index) => (
            <div
              key={image.id}
              draggable
              onDragStart={(e) => handleDragStart(e, image.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
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
              />
            </div>
          ))
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
    </div>
  );
}

export default LayerPanel;