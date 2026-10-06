'use client';

import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getConstrainedFixedPanelPosition } from '@/lib/image-toolbar-position';

interface CanvasContextMenuProps {
  anchor: { x: number; y: number };
  minWidth: number;
  isMonochrome: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

/** Both desktop context clicks and touch long presses use the visible viewport. */
export function CanvasContextMenu({ anchor, minWidth, isMonochrome, onDismiss, children }: CanvasContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const visualViewport = window.visualViewport;
    const position = (): void => {
      const width = visualViewport?.width ?? window.innerWidth;
      const height = visualViewport?.height ?? window.innerHeight;
      const offsetLeft = visualViewport?.offsetLeft ?? 0;
      const offsetTop = visualViewport?.offsetTop ?? 0;
      const margin = Math.min(8, width / 2, height / 2);
      const availableWidth = Math.max(0, width - margin * 2);
      menu.style.maxWidth = `${availableWidth}px`;
      menu.style.minWidth = `${Math.min(minWidth, availableWidth)}px`;
      menu.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
      const bounds = menu.getBoundingClientRect();
      const constrained = getConstrainedFixedPanelPosition({
        anchor: { left: anchor.x - offsetLeft, top: anchor.y - offsetTop, transform: 'translate(0, 0)' },
        panel: bounds,
        viewport: { width, height },
        margin,
      });
      // The shared helper rounds pixels; constrain again for fractional viewports.
      menu.style.left = `${Math.min(Math.max(margin, constrained.left), width - margin - Math.min(bounds.width, availableWidth)) + offsetLeft}px`;
      menu.style.top = `${Math.min(Math.max(margin, constrained.top), height - margin - Math.min(bounds.height, Math.max(0, height - margin * 2))) + offsetTop}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener('resize', position);
    visualViewport?.addEventListener('resize', position);
    visualViewport?.addEventListener('scroll', position);
    return (): void => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      visualViewport?.removeEventListener('resize', position);
      visualViewport?.removeEventListener('scroll', position);
    };
  }, [anchor.x, anchor.y, minWidth]);

  // Escape the canvas clipping/touch-action boundary, but stop React portal bubbling.
  return createPortal(
    <div ref={menuRef} data-popup="context-menu"
      className={`fixed py-1.5 rounded-xl border shadow-2xl ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1e1e1e] border-[#333]'}`}
      // Above mobile action bars/drawers (74–76), below modal/editor surfaces.
      style={{ zIndex: 80, left: anchor.x, top: anchor.y, width: 'max-content', overflowY: 'auto',
        overflowWrap: 'anywhere', overscrollBehavior: 'contain', touchAction: 'pan-y' }}
      onPointerDown={event => event.stopPropagation()}
      onPointerMove={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onPointerCancel={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onAuxClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
      {children}
    </div>, document.body,
  );
}
