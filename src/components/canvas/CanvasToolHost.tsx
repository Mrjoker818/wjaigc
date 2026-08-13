'use client';

import type { ReactNode, SyntheticEvent } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { CanvasToolSession } from '@/lib/canvas-kernel/tool-registry';
import { getCanvasToolHostPlacementClassName } from '@/lib/canvas-toolbar-layout';

interface CanvasToolHostProps {
  session: CanvasToolSession;
  onRequestClose: () => void;
  children?: ReactNode;
}

const INTERACTIVE_TOOL_BOUNDARY = [
  '[data-canvas-tool-host]',
  '[data-floating-panel]',
  '[data-popup]',
  '[data-modal]',
  '[data-toolbar]',
  '[data-bottom-toolbar-drawer]',
].join(',');

export function CanvasToolHost({
  session,
  onRequestClose,
  children,
}: CanvasToolHostProps) {
  useEffect(() => {
    if (session.status !== 'open') return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRequestClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (
        target.closest('[data-canvas-tool-host]')
        || target.closest(INTERACTIVE_TOOL_BOUNDARY)
        || (
          session.panelPlacement === 'canvas-overlay'
          && target.closest('[data-canvas-viewport]')
        )
      )) return;
      onRequestClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onRequestClose, session.panelPlacement, session.status, session.toolId]);

  if (session.status !== 'open') return null;

  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
  const content = (
    <div
      data-canvas-tool-host="true"
      data-floating-panel="canvas-tool-host"
      data-tool-id={session.toolId ?? undefined}
      data-panel-placement={session.panelPlacement}
      className={getCanvasToolHostPlacementClassName(session.panelPlacement)}
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onWheel={stopPropagation}
    >
      {children}
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
