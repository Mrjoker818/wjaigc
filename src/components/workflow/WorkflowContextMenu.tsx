'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoxSelect, Clipboard, Copy, CopyPlus, MessageSquare, Plus, Trash2, Unlink, type LucideIcon } from 'lucide-react';

export interface WorkflowMenuLocation {
  type: 'canvas' | 'node';
  /** Original canvas coordinates stay authoritative for existing data actions. */
  x: number;
  y: number;
  nodeId?: string;
  menuX?: number;
  menuY?: number;
  returnFocus?: HTMLElement;
  scope?: string;
}
interface WorkflowContextMenuProps {
  menu: WorkflowMenuLocation;
  hasClipboard: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
  extraNodeActions?: readonly WorkflowMenuAction[];
}
export interface WorkflowMenuAction { action: string; label: string; icon: LucideIcon; disabled?: boolean; destructive?: boolean }
interface MenuPosition { x: number; y: number; maxWidth: number; maxHeight: number }

export function WorkflowContextMenu({ menu, hasClipboard, onAction, onClose, extraNodeActions = [] }: WorkflowContextMenuProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropTouchRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const focusedRef = useRef(false);
  const restoreFocusRef = useRef(true);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const actions: WorkflowMenuAction[] = menu.type === 'canvas' ? [
    { action: 'add-node', label: '添加节点', icon: Plus },
    { action: 'paste', label: '粘贴', icon: Clipboard, disabled: !hasClipboard },
    { action: 'select-all', label: '全选', icon: BoxSelect },
  ] : [
    { action: 'annotate', label: '批注修改', icon: MessageSquare },
    { action: 'copy', label: '复制', icon: Copy },
    { action: 'duplicate', label: '副本', icon: CopyPlus },
    { action: 'disconnect', label: '断开连线', icon: Unlink },
    { action: 'delete', label: '删除节点', icon: Trash2, destructive: true },
    ...extraNodeActions,
  ];

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const place = (): void => {
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const rect = panel.getBoundingClientRect();
      const maxWidth = Math.max(0, width - 16), maxHeight = Math.max(0, height - 16);
      const next = {
        x: Math.max(left + 8, Math.min(menu.menuX ?? menu.x, left + width - 8 - Math.min(rect.width, maxWidth))),
        y: Math.max(top + 8, Math.min(menu.menuY ?? menu.y, top + height - 8 - Math.min(rect.height, maxHeight))),
        maxWidth, maxHeight,
      };
      setPosition(previous => previous && previous.x === next.x && previous.y === next.y
        && previous.maxWidth === next.maxWidth && previous.maxHeight === next.maxHeight ? previous : next);
    };
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [menu.x, menu.y, menu.menuX, menu.menuY]);

  useLayoutEffect(() => {
    if (!position || focusedRef.current) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    focusedRef.current = true;
  }, [position]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      const active = document.activeElement;
      if (restoreFocusRef.current && menu.returnFocus?.isConnected
        && (active === document.body || (active && panel?.contains(active)))) menu.returnFocus.focus({ preventScroll: true });
      focusedRef.current = false;
    };
  }, [menu.returnFocus]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'Tab') {
      restoreFocusRef.current = false;
      menu.returnFocus?.focus({ preventScroll: true });
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-popup data-workflow-ui-occlusion className="fixed inset-0 z-[199]" onClick={onClose}
      onPointerDown={event => {
        if (event.pointerType !== 'touch') return;
        if (!event.isPrimary || event.target !== event.currentTarget || backdropTouchRef.current) { backdropTouchRef.current = null; return; }
        backdropTouchRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={event => {
        const start = backdropTouchRef.current;
        if (start && start.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) start.moved = true;
      }}
      onPointerCancel={event => { if (backdropTouchRef.current?.id === event.pointerId) backdropTouchRef.current = null; }}
      onTouchEnd={event => {
        const start = backdropTouchRef.current;
        backdropTouchRef.current = null;
        if (!start || event.target !== event.currentTarget || event.touches.length !== 0 || event.changedTouches.length !== 1 || !event.cancelable) return;
        event.preventDefault();
        const touch = event.changedTouches[0];
        if (start.moved || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >= 8) return;
        onClose();
      }}
      onContextMenu={event => { event.preventDefault(); onClose(); }}>
      <div ref={panelRef} id="workflow-context-menu" role="menu"
        aria-label={menu.type === 'canvas' ? '工作流画布菜单' : '工作流节点菜单'}
        data-workflow-context-menu data-popup
        className="fixed z-[200] w-56 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl bg-popover p-1 text-popover-foreground shadow-lg"
        style={{ left: position?.x ?? 8, top: position?.y ?? 8, maxWidth: position?.maxWidth ?? 'calc(100vw - 16px)',
          maxHeight: position?.maxHeight ?? 'calc(100dvh - 16px)', visibility: position ? 'visible' : 'hidden' }}
        onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={handleKeyDown}>
        {actions.map(({ action, label, icon: Icon, disabled, destructive }) => (
          <button key={action} type="button" role="menuitem" tabIndex={-1} disabled={disabled}
            className={"flex h-11 w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-left text-base hover:bg-accent focus:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 " + (destructive ? 'text-destructive' : 'text-popover-foreground')}
            onClick={() => onAction(action)}>
            <Icon size={16} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

