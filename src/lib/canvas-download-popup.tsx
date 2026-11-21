'use client';

import { useLayoutEffect, useRef, type ReactNode, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { getConstrainedFixedPanelPosition, type ImageToolbarPosition } from './image-toolbar-position';
import { getFloatingPanelViewport, subscribeFloatingPanelViewport } from './floating-panel-position';

/** Measure this panel independently of the much shorter image action toolbar. */
export function CanvasDownloadPopup({ anchor, viewportElement, children }: {
  anchor: ImageToolbarPosition;
  viewportElement: HTMLElement | null;
  children: ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const position = (): void => {
      const viewport = getFloatingPanelViewport();
      const canvas = viewportElement?.getBoundingClientRect();
      const hasCanvasBounds = canvas && canvas.width > 0 && canvas.height > 0;
      const left = Math.max(viewport.left, hasCanvasBounds ? canvas.left : viewport.left);
      const top = Math.max(viewport.top, hasCanvasBounds ? canvas.top : viewport.top);
      const right = Math.min(viewport.left + viewport.width, hasCanvasBounds ? canvas.right : Infinity);
      const mobile = viewport.width < 768;
      const bottom = Math.min(viewport.top + viewport.height - (mobile ? 112 : 0),
        hasCanvasBounds ? canvas.bottom : Infinity);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const margin = Math.min(16, width / 2, height / 2);
      const availableWidth = Math.max(0, width - margin * 2);
      const availableHeight = Math.max(0, height - margin * 2);
      panel.style.width = `${Math.min(mobile ? 360 : 260, availableWidth)}px`;
      panel.style.maxWidth = `${availableWidth}px`;
      panel.style.maxHeight = `${availableHeight}px`;
      const bounds = panel.getBoundingClientRect();
      const constrained = getConstrainedFixedPanelPosition({
        anchor: { ...anchor, left: anchor.left + (canvas?.left ?? 0) - left,
          top: anchor.top + (canvas?.top ?? 0) - top },
        panel: bounds,
        viewport: { width, height },
        margin,
      });
      panel.style.left = `${left + constrained.left}px`;
      panel.style.top = `${top + constrained.top}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    if (viewportElement) observer.observe(viewportElement);
    const unsubscribe = subscribeFloatingPanelViewport(position);
    return () => { observer.disconnect(); unsubscribe(); };
  }, [anchor, viewportElement, children]);

  return createPortal(
    <div ref={panelRef} data-popup="download" className="fixed z-[180] pointer-events-auto"
      style={{ position: 'fixed', overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y' }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}>
      {children}
    </div>, document.body,
  );
}
