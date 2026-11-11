'use client';

import React, { useState, useCallback, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Trash2, ChevronUp, ChevronDown,
  GripVertical, MoreHorizontal, Pencil, X, Check, Image as ImageIcon,
  Layers, Square, Circle, Triangle, Type, FileImage
} from 'lucide-react';
import type { CanvasImage } from '@/components/infinite-canvas';
import { useIsMobile } from '@/hooks/use-mobile';
import { constrainFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport } from '@/lib/floating-panel-position';

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
  /** 批量状态变更不经仅处理层级的排序回调 */
  onSetAllVisibility?: (visible: boolean) => void;
  onSetAllLocked?: (locked: boolean) => void;
  /** 重命名回调 */
  onRename?: (id: string, name: string) => void;
  /** 删除回调 */
  onDelete?: (id: string) => void;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 使用当前选择调用画布现有的创建组命令 */
  onCreateGroup?: () => void;
  /** 面板位置（左、右或底部抽屉） */
  position?: 'left' | 'right' | 'bottom';
  /** 面板宽度（position='bottom' 时右侧留白宽度，用于避开右侧功能面板） */
  rightInset?: number;
  /** 面板宽度 */
  width?: number;
  /** 是否以画布中央浮窗显示 */
  floating?: boolean;
}

interface LayerThumbnailProps {
  url: string;
  name: string;
  isVisible: boolean;
  isMonochrome: boolean;
}

function LayerThumbnail({ url, name, isVisible, isMonochrome }: LayerThumbnailProps): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label="缩略图加载失败"
        className={'flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-sm md:text-[11px] ' + (isMonochrome ? 'bg-gray-200 text-gray-700' : 'bg-white/5 text-foreground')}
      >
        <FileImage className="h-4 w-4" aria-hidden="true" />
        <span className="whitespace-nowrap">预览不可用</span>
      </div>
    );
  }
  return <img src={url} alt={name} className="w-full h-full object-cover" style={{ opacity: isVisible ? 1 : 0.3 }} onError={() => setFailed(true)} />;
}

/** 图层项组件 */
interface LayerItemProps {
  image: CanvasImage;
  index: number;
  isSelected: boolean;
  isMonochrome: boolean;
  multiSelectMode?: boolean;
  onSelect: () => void;
  onVisibilityToggle: () => void;
  onLockToggle: () => void;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** 打开菜单：传入按钮的 DOMRect 用于 fixed 定位 */
  onMenuOpen?: (imageId: string, rect: DOMRect) => void;
  /** 外部触发的重命名ID */
  forceRenameId?: string | null;
  dragHandleProps?: Record<string, unknown>;
  scrollOwnerRef: React.RefObject<HTMLDivElement | null>;
}

function LayerItem({
  image,
  index,
  isSelected,
  isMonochrome,
  multiSelectMode = false,
  onSelect,
  onVisibilityToggle,
  onLockToggle,
  onRename,
  onRenameCancel,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMenuOpen,
  forceRenameId,
  scrollOwnerRef,
}: LayerItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(image.name || `图层 ${index + 1}`);
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const owner = scrollOwnerRef.current;
    if (!isEditing || !editor || !owner) return undefined;
    let frame: number | null = null;
    const reveal = (): void => {
      const area = owner.getBoundingClientRect();
      const rect = editor.getBoundingClientRect();
      const viewport = getFloatingPanelViewport();
      const left = Math.max(area.left + owner.clientLeft, viewport.left) + 4;
      const right = Math.min(area.left + owner.clientLeft + owner.clientWidth, viewport.left + viewport.width) - 4;
      const top = Math.max(area.top + owner.clientTop, viewport.top) + 4;
      const bottom = Math.min(area.top + owner.clientTop + owner.clientHeight, viewport.top + viewport.height) - 4;
      // Move only this panel's scroll owner. Never focus/blur or commit the draft.
      if (rect.bottom > bottom) owner.scrollTop += rect.bottom - bottom;
      else if (rect.top < top) owner.scrollTop += rect.top - top;
      if (rect.right > right) owner.scrollLeft += rect.right - right;
      else if (rect.left < left) owner.scrollLeft += rect.left - left;
    };
    const schedule = (): void => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => { frame = null; reveal(); });
    };
    reveal();
    const observer = new ResizeObserver(schedule);
    observer.observe(owner);
    observer.observe(editor);
    const unsubscribe = subscribeFloatingPanelViewport(schedule);
    return () => {
      observer.disconnect();
      unsubscribe();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [isEditing, scrollOwnerRef]);

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

  const handleRenameCancel = (): void => {
    setIsEditing(false);
    setEditName(displayName);
    onRenameCancel();
  };

  const handleRenameSubmit = (): void => {
    if (!editName.trim()) {
      handleRenameCancel();
      return;
    }
    onRename(editName.trim());
    setIsEditing(false);
  };

  const actionButtonClass = 'flex h-11 w-11 items-center justify-center rounded transition-colors md:[@media(hover:hover)_and_(pointer:fine)]:h-auto md:[@media(hover:hover)_and_(pointer:fine)]:w-auto md:[@media(hover:hover)_and_(pointer:fine)]:p-0.5';
  const actionThemeClass = isMonochrome
    ? 'bg-gray-200 hover:bg-gray-300 md:[@media(hover:hover)_and_(pointer:fine)]:bg-black/40 md:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/70'
    : 'bg-black/40 hover:bg-black/70';
  const lockThemeClass = isMonochrome && isLocked
    ? 'bg-gray-900 hover:bg-gray-800 md:[@media(hover:hover)_and_(pointer:fine)]:bg-black/40 md:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/70'
    : actionThemeClass;

  const bgClass = isSelected
    ? isMonochrome ? 'bg-gray-200' : 'bg-gold/10'
    : isMonochrome ? 'bg-transparent hover:bg-gray-50' : 'bg-transparent hover:bg-white/[0.02]';

  return (
    <div
      className={`group relative flex flex-col w-[108px] flex-shrink-0 rounded-lg overflow-visible cursor-pointer transition-colors ${bgClass} ${isVisible ? '' : 'md:opacity-50'}`}
      onClick={onSelect}
      title={displayName}
      data-canvas-dock-editing={isEditing ? 'true' : undefined}
    >
      {/* 缩略图区 */}
      <div className="relative w-full h-16 rounded-t-lg overflow-hidden">
        <LayerThumbnail key={image.url} url={image.url} name={displayName} isVisible={isVisible} isMonochrome={isMonochrome} />
        {multiSelectMode && (
          <button
            type="button"
            aria-label={`选择图层 ${displayName}`}
            aria-pressed={isSelected}
            onClick={(event) => { event.stopPropagation(); onSelect(); }}
            className={`absolute left-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-br-lg border-2 md:hidden ${isSelected ? (isMonochrome ? 'border-gray-900 bg-gray-900 text-white' : 'border-gold bg-gold text-black') : 'border-white bg-black/70 text-white'}`}
          >
            {isSelected ? <Check className="h-5 w-5" /> : <Square className="h-5 w-5" />}
          </button>
        )}
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
        {/* 选中边框 */}
        {isSelected && (
          <div className={`absolute inset-0 rounded-t-lg ring-2 pointer-events-none ${isMonochrome ? 'ring-gray-400' : 'ring-gold'}`} />
        )}
      </div>

      {/* 手机操作始终可见，桌面保留缩略图右上悬停布局 */}
        <div className="relative flex items-center justify-center gap-1 py-1 md:[@media(hover:hover)_and_(pointer:fine)]:absolute md:[@media(hover:hover)_and_(pointer:fine)]:top-0.5 md:[@media(hover:hover)_and_(pointer:fine)]:right-0.5 md:[@media(hover:hover)_and_(pointer:fine)]:gap-0.5 md:[@media(hover:hover)_and_(pointer:fine)]:p-0 md:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 md:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onVisibilityToggle(); }}
            className={`${actionButtonClass} ${actionThemeClass}`}
            aria-pressed={isVisible}
            title={isVisible ? '隐藏图层' : '显示图层'}
          >
            {isVisible ? <Eye className={`w-4 h-4 md:[@media(hover:hover)_and_(pointer:fine)]:w-3 md:[@media(hover:hover)_and_(pointer:fine)]:h-3 ${isMonochrome ? 'text-gray-900 md:[@media(hover:hover)_and_(pointer:fine)]:text-white' : 'text-white'}`} /> : <EyeOff className={`w-4 h-4 md:[@media(hover:hover)_and_(pointer:fine)]:w-3 md:[@media(hover:hover)_and_(pointer:fine)]:h-3 ${isMonochrome ? 'text-gray-700 md:[@media(hover:hover)_and_(pointer:fine)]:text-white/70' : 'text-white/70'}`} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onLockToggle(); }}
            className={`${actionButtonClass} ${lockThemeClass}`}
            aria-pressed={isLocked}
            title={isLocked ? '解锁图层' : '锁定图层'}
          >
            {isLocked ? <Lock className={`w-4 h-4 md:[@media(hover:hover)_and_(pointer:fine)]:w-3 md:[@media(hover:hover)_and_(pointer:fine)]:h-3 ${isMonochrome ? 'text-white md:[@media(hover:hover)_and_(pointer:fine)]:text-gold' : 'text-gold'}`} /> : <Unlock className={`w-4 h-4 md:[@media(hover:hover)_and_(pointer:fine)]:w-3 md:[@media(hover:hover)_and_(pointer:fine)]:h-3 ${isMonochrome ? 'text-gray-800 md:[@media(hover:hover)_and_(pointer:fine)]:text-white' : 'text-white'}`} />}
          </button>
        </div>

      {/* 信息区 */}
      <div className={`px-1 py-1 rounded-b-lg flex flex-col gap-0.5 ${isSelected ? (isMonochrome ? 'bg-gray-200' : 'bg-gold/10') : ''}`}>
        {isEditing ? (
          <div
            ref={editorRef}
            className="flex flex-col gap-1"
            onBlur={event => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
              handleRenameSubmit();
            }}
            onKeyDown={event => {
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              handleRenameCancel();
            }}
          >
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.stopPropagation();
              handleRenameSubmit();
            }}
            aria-label={`重命名 ${displayName}`}
            className="w-full min-h-11 px-1 py-0.5 text-base bg-transparent border border-gold/30 rounded focus:outline-none focus:border-gold md:[@media(hover:hover)_and_(pointer:fine)]:min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:text-[11px]"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex items-center gap-1 md:[@media(hover:hover)_and_(pointer:fine)]:hidden">
            <button type="button" aria-label="保存重命名" onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); handleRenameSubmit(); }} className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-gold text-black'}`}><Check className="h-5 w-5" /></button>
            <button type="button" aria-label="取消重命名" onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); handleRenameCancel(); }} className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded ${isMonochrome ? 'bg-gray-200 text-gray-800' : 'bg-white/10 text-foreground'}`}><X className="h-5 w-5" /></button>
          </div>
          </div>
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
            aria-label={`图层 ${displayName} 更多操作`}
            onClick={(e) => { e.stopPropagation(); onMenuOpen?.(image.id, e.currentTarget.getBoundingClientRect()); }}
            className={`flex h-11 w-11 items-center justify-center rounded transition-colors md:[@media(hover:hover)_and_(pointer:fine)]:h-auto md:[@media(hover:hover)_and_(pointer:fine)]:w-auto md:[@media(hover:hover)_and_(pointer:fine)]:p-0.5 md:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 md:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
          >
            <MoreHorizontal className={`w-4 h-4 md:[@media(hover:hover)_and_(pointer:fine)]:w-3 md:[@media(hover:hover)_and_(pointer:fine)]:h-3 ${isMonochrome ? 'text-gray-600 md:[@media(hover:hover)_and_(pointer:fine)]:text-gray-400' : 'text-muted-foreground'}`} />
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
  onSetAllVisibility,
  onSetAllLocked,
  onRename,
  onDelete,
  onClose,
  onCreateGroup,
  position = 'right',
  width = 220,
  floating = false,
  rightInset = 0,
}: LayerPanelProps) {
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const mobileMultiSelect = isMobile && multiSelectMode;
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
  const handleRenameCancel = useCallback((): void => { setForceRenameId(null); }, [setForceRenameId]);

  // 重命名
  const handleRename = useCallback((imageId: string, name: string) => {
    onRename?.(imageId, name);
    setForceRenameId(null);
  }, [onRename, setForceRenameId]);

  // 按当前可见顺序交换相邻图层，并归一化缺省或重复的层级值。
  const handleMove = useCallback((imageId: string, direction: -1 | 1): void => {
    if (!onReorder) return;
    const ids = sortedImages.map(image => image.id);
    const index = ids.indexOf(imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const zIndexes = new Map(ids.map((id, position) => [id, ids.length - position]));
    onReorder(images.map(image => ({ ...image, zIndex: zIndexes.get(image.id)! })));
  }, [images, onReorder, sortedImages]);

  const handleMoveUp = useCallback((imageId: string): void => {
    handleMove(imageId, -1);
  }, [handleMove]);

  const handleMoveDown = useCallback((imageId: string): void => {
    handleMove(imageId, 1);
  }, [handleMove]);

  // 批量操作状态
  const visibleCount = images.filter(img => img.visible !== false).length;
  const lockedCount = images.filter(img => img.locked === true).length;

  // 菜单状态（面板级渲染，避开滚动容器裁剪）
  const [menuState, setMenuState] = useState<{ rect: DOMRect; imageId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<{ x: number; y: number; maxWidth: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const candidate = menuRef.current;
    if (!menuState || isMobile || !candidate) { setMenuPlacement(null); return undefined; }
    const element = candidate;
    const anchor = menuState.rect;
    const sync = (): void => {
      const viewport = getFloatingPanelViewport();
      const maxWidth = Math.max(0, viewport.width - 16);
      const maxHeight = Math.max(0, viewport.height - 16);
      element.style.maxWidth = `${maxWidth}px`;
      element.style.maxHeight = `${maxHeight}px`;
      const bounds = element.getBoundingClientRect();
      const position = constrainFloatingPanelPosition({
        x: anchor.right - 8 - bounds.width - viewport.left,
        y: anchor.top - 4 - bounds.height - viewport.top,
        viewportWidth: viewport.width, viewportHeight: viewport.height,
        panelWidth: bounds.width, panelHeight: bounds.height, margin: 8,
      });
      const next = { x: position.x + viewport.left, y: position.y + viewport.top, maxWidth, maxHeight };
      setMenuPlacement(current => current?.x === next.x && current.y === next.y
        && current.maxWidth === maxWidth && current.maxHeight === maxHeight ? current : next);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    const unsubscribe = subscribeFloatingPanelViewport(sync);
    return () => { observer.disconnect(); unsubscribe(); };
  }, [isMobile, menuState]);
  const handleMenuOpen = useCallback((imageId: string, rect: DOMRect) => {
    setMenuState({ rect, imageId });
  }, [setMenuState]);
  const handleMenuClose = useCallback(() => {
    setMenuState(null);
  }, [setMenuState]);

  const handleRenameState = useCallback((id: string) => {
    setForceRenameId(id);
  }, []);

  // 全部显示/隐藏
  const handleToggleAllVisibility = useCallback(() => {
    const allVisible = images.every(img => img.visible !== false);
    if (onSetAllVisibility) {
      onSetAllVisibility(!allVisible);
      return;
    }
    if (!onReorder) return;
    onReorder(images.map(img => ({
      ...img,
      visible: allVisible ? false : true,
    })));
  }, [images, onReorder, onSetAllVisibility]);

  // 全部解锁/锁定
  const handleToggleAllLock = useCallback(() => {
    const allLocked = images.every(img => img.locked === true);
    if (onSetAllLocked) {
      onSetAllLocked(!allLocked);
      return;
    }
    if (!onReorder) return;
    onReorder(images.map(img => ({
      ...img,
      locked: allLocked ? false : true,
    })));
  }, [images, onReorder, onSetAllLocked]);

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
    ? 'fixed bottom-0 left-0 h-[min(64dvh,420px)] w-full rounded-t-xl shadow-2xl md:[@media(hover:hover)_and_(pointer:fine)]:h-[min(30dvh,260px)] md:w-[calc(100%_-_var(--layer-right-inset))]'
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
        '--layer-right-inset': `${rightInset}px`,
        width: isBottomDock ? undefined : width,
        maxWidth: isBottomDock ? undefined : (floating ? 'calc(100dvw - 2rem)' : 'min(100%, calc(100dvw - 1rem))'),
      } as React.CSSProperties}
      data-popup={floating || isBottomDock ? 'layer-panel' : undefined}
      data-canvas-dock-editing={forceRenameId !== null ? 'true' : undefined}
    >
      {/* 标题栏 */}
      <div className={`flex shrink-0 items-center justify-between px-3 py-1 border-b md:py-2 ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
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
            disabled={images.length === 0}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded transition-colors md:[@media(hover:hover)_and_(pointer:fine)]:h-auto md:[@media(hover:hover)_and_(pointer:fine)]:w-auto md:[@media(hover:hover)_and_(pointer:fine)]:p-1 ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
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
            disabled={images.length === 0}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded transition-colors md:[@media(hover:hover)_and_(pointer:fine)]:h-auto md:[@media(hover:hover)_and_(pointer:fine)]:w-auto md:[@media(hover:hover)_and_(pointer:fine)]:p-1 ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
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
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded transition-colors md:[@media(hover:hover)_and_(pointer:fine)]:h-auto md:[@media(hover:hover)_and_(pointer:fine)]:w-auto md:[@media(hover:hover)_and_(pointer:fine)]:p-1 ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-white/5'}`}
              title="关闭图层"
            >
              <X className={`w-3.5 h-3.5 ${isMonochrome ? 'text-gray-500' : 'text-muted-foreground'}`} />
            </button>
          )}
        </div>
      </div>

      {/* 图层列表 - 横向排列 */}
      <div ref={listRef} className={`flex-1 overflow-x-auto overflow-y-auto min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:overflow-y-hidden [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full ${isMonochrome ? '[&::-webkit-scrollbar-thumb]:bg-gray-300' : '[&::-webkit-scrollbar-thumb]:bg-gold/30 hover:[&::-webkit-scrollbar-thumb]:bg-gold/50'}`}>
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
                  multiSelectMode={mobileMultiSelect}
                  onSelect={() => onSelect?.(mobileMultiSelect
                    ? selectedIds.includes(image.id) ? selectedIds.filter(id => id !== image.id) : [...selectedIds, image.id]
                    : [image.id])}
                  onVisibilityToggle={() => handleVisibilityToggle(image.id)}
                  onLockToggle={() => handleLockToggle(image.id)}
                  onRename={(name) => handleRename(image.id, name)}
                  onRenameCancel={handleRenameCancel}
                  onDelete={() => onDelete?.(image.id)}
                  onMoveUp={() => handleMoveUp(image.id)}
                  onMoveDown={() => handleMoveDown(image.id)}
                  onMenuOpen={handleMenuOpen}
                  forceRenameId={forceRenameId}
                  scrollOwnerRef={listRef}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div className={`flex shrink-0 items-center justify-between px-3 py-1 border-t md:py-2 ${isMonochrome ? 'border-gray-200' : 'border-gold/10'}`}>
        <div className={`hidden text-xs md:block ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          可见: {visibleCount}/{images.length}
        </div>
        <div className={`hidden text-xs md:block ${isMonochrome ? 'text-gray-400' : 'text-muted-foreground'}`}>
          锁定: {lockedCount}/{images.length}
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 md:hidden">
          <button
            type="button"
            aria-pressed={multiSelectMode}
            onClick={() => setMultiSelectMode(current => !current)}
            className={`min-h-11 min-w-16 shrink-0 rounded-lg px-3 text-sm whitespace-nowrap ${multiSelectMode ? (isMonochrome ? 'bg-gray-900 text-white' : 'bg-gold text-black') : (isMonochrome ? 'bg-gray-200 text-gray-800' : 'bg-white/10 text-foreground')}`}
          >
            多选
          </button>
          <span aria-live="polite" className={`min-w-0 flex-1 truncate text-xs ${isMonochrome ? 'text-gray-600' : 'text-muted-foreground'}`}>已选 {selectedIds.length}</span>
          {onCreateGroup && (
            <button
              type="button"
              aria-label="创建组"
              disabled={selectedIds.length < 2}
              onClick={onCreateGroup}
              className={`min-h-11 shrink-0 rounded-lg px-3 text-sm whitespace-nowrap disabled:opacity-40 ${isMonochrome ? 'bg-gray-900 text-white' : 'bg-gold text-black'}`}
            >
              创建组
            </button>
          )}
        </div>
      </div>

      {/* 面板级菜单渲染 — 避开滚动容器裁剪 */}
      {menuState && (
        <div
          className="fixed inset-0 z-[90]"
          onClick={handleMenuClose}
        >
          <div
            ref={menuRef}
            className={`py-1 rounded-lg shadow-lg min-w-[120px] ${isMonochrome ? 'bg-white border border-gray-200' : 'bg-[#1a1a1a] border border-gold/20'}`}
            style={{
              position: 'fixed',
              ...(isMobile ? { left: 8, right: 8, bottom: 8, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' as const } : {
                left: menuPlacement?.x ?? 8,
                top: menuPlacement?.y ?? 8,
                maxWidth: menuPlacement?.maxWidth ?? 'calc(100dvw - 16px)',
                maxHeight: menuPlacement?.maxHeight ?? 'calc(100dvh - 16px)',
                overflowY: 'auto' as const,
                visibility: menuPlacement ? 'visible' as const : 'hidden' as const,
              }),
              zIndex: 100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setForceRenameId(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full min-h-11 px-3 py-2 text-sm flex items-center gap-2 md:[@media(hover:hover)_and_(pointer:fine)]:min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:py-1.5 md:[@media(hover:hover)_and_(pointer:fine)]:text-xs ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
            >
              <Pencil className="w-3 h-3" />
              重命名
            </button>
            <button
              onClick={() => {
                handleMoveUp(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full min-h-11 px-3 py-2 text-sm flex items-center gap-2 md:[@media(hover:hover)_and_(pointer:fine)]:min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:py-1.5 md:[@media(hover:hover)_and_(pointer:fine)]:text-xs ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
            >
              <ChevronUp className="w-3 h-3" />
              上移一层
            </button>
            <button
              onClick={() => {
                handleMoveDown(menuState.imageId);
                setMenuState(null);
              }}
              className={`w-full min-h-11 px-3 py-2 text-sm flex items-center gap-2 md:[@media(hover:hover)_and_(pointer:fine)]:min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:py-1.5 md:[@media(hover:hover)_and_(pointer:fine)]:text-xs ${isMonochrome ? 'hover:bg-gray-50 text-gray-700' : 'hover:bg-white/5 text-foreground'}`}
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
              className={`w-full min-h-11 px-3 py-2 text-sm flex items-center gap-2 md:[@media(hover:hover)_and_(pointer:fine)]:min-h-0 md:[@media(hover:hover)_and_(pointer:fine)]:py-1.5 md:[@media(hover:hover)_and_(pointer:fine)]:text-xs ${isMonochrome ? 'hover:bg-red-50 text-red-600' : 'hover:bg-red-500/10 text-red-400'}`}
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
