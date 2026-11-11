'use client';

import { useLayoutEffect, useRef, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';

interface MobileGroupBounds {
  x: number;
  y: number;
  width: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MobileGroupHeaderProps {
  'data-toolbar': 'image-group';
  viewport: HTMLDivElement | null;
  surface: HTMLDivElement | null;
  bounds: MobileGroupBounds;
  collapsed: boolean;
  imageCount: number;
  isMonochrome: boolean;
  children: ReactNode;
}

export function MobileGroupHeader({
  'data-toolbar': toolbar,
  viewport,
  surface,
  bounds,
  collapsed,
  imageCount,
  isMonochrome,
  children,
}: MobileGroupHeaderProps): ReactPortal | null {
  const headerRef = useRef<HTMLDivElement>(null);
  const { x, width: groupWidth, minX, minY, maxX, maxY } = bounds;

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const doc = header.ownerDocument;
    let tap: { button: HTMLButtonElement; id: number; x: number; y: number } | null = null;
    const clearTap = () => { tap = null; };
    const handleStart = (event: TouchEvent) => {
      clearTap();
      if (!event.isTrusted || event.touches.length !== 1 || event.changedTouches.length !== 1) return;
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button || !header.contains(button) || button.matches(':disabled')) return;
      const touch = event.changedTouches[0];
      tap = { button, id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };
    const clearMultiTouch = (event: TouchEvent) => { if (event.touches.length > 1) clearTap(); };
    const handleMove = (event: TouchEvent) => {
      if (!tap) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== tap.id
        || Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) >= 8) clearTap();
    };
    const handleEnd = (event: TouchEvent) => {
      const start = tap;
      clearTap();
      if (!start || !event.isTrusted || !event.cancelable || event.defaultPrevented
        || event.touches.length !== 0 || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      if (touch.identifier !== start.id || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >= 8
        || !header.contains(start.button) || start.button.matches(':disabled')) return;
      const hit = doc.elementFromPoint(touch.clientX, touch.clientY);
      if (!hit || !start.button.contains(hit)) return;

      // A tap immediately after a captured drag may receive no compatibility click.
      event.preventDefault();
      if (event.defaultPrevented) start.button.click();
    };
    doc.addEventListener('touchstart', clearMultiTouch, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', clearTap);
    doc.defaultView?.addEventListener('blur', clearTap);
    header.addEventListener('touchstart', handleStart, { passive: true });
    header.addEventListener('touchmove', handleMove, { passive: true });
    header.addEventListener('touchcancel', clearTap);
    header.addEventListener('contextmenu', clearTap);
    header.addEventListener('touchend', handleEnd, { passive: false });
    return () => {
      doc.removeEventListener('touchstart', clearMultiTouch, true);
      doc.removeEventListener('visibilitychange', clearTap);
      doc.defaultView?.removeEventListener('blur', clearTap);
      header.removeEventListener('touchstart', handleStart);
      header.removeEventListener('touchmove', handleMove);
      header.removeEventListener('touchcancel', clearTap);
      header.removeEventListener('contextmenu', clearTap);
      header.removeEventListener('touchend', handleEnd);
    };
  }, [viewport]);

  useLayoutEffect((): (() => void) | undefined => {
    const header = headerRef.current;
    if (!header || !viewport || !surface) return undefined;
    let disposed = false;
    const update = (): void => {
      if (disposed || !header.isConnected) return;
      // Consume the exact painted preview; React intentionally throttles pan state.
      const matrix = new DOMMatrixReadOnly(surface.style.transform || undefined);
      const viewportWidth = viewport.clientWidth;
      const viewportHeight = viewport.clientHeight;
      const valid = [matrix.a, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
        && matrix.a > 0 && matrix.d > 0;
      const visible = valid
        && maxX * matrix.a + matrix.e > 0
        && minX * matrix.a + matrix.e < viewportWidth
        && maxY * matrix.d + matrix.f > 0
        && minY * matrix.d + matrix.f < viewportHeight - 72;
      const height = collapsed ? 112 : 88;
      const width = Math.min(Math.max(180, groupWidth * matrix.a), Math.max(0, viewportWidth - 80));
      const above = minY * matrix.d + matrix.f - height - 12;
      const below = maxY * matrix.d + matrix.f + 12;
      const preferredTop = !collapsed && above < 8 && below + height <= viewportHeight - 80 ? below : above;
      header.style.left = `${Math.max(72, Math.min(x * matrix.a + matrix.e, viewportWidth - width - 8))}px`;
      header.style.top = `${Math.max(8, Math.min(preferredTop, viewportHeight - height - 80))}px`;
      header.style.width = `${width}px`;
      header.style.height = `${height}px`;
      header.style.visibility = visible ? 'visible' : 'hidden';
      header.hidden = !visible;
    };
    const transformObserver = new MutationObserver(update);
    transformObserver.observe(surface, { attributes: true, attributeFilter: ['style'] });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(viewport);
    update();
    return (): void => {
      disposed = true;
      transformObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [viewport, surface, x, groupWidth, minX, minY, maxX, maxY, collapsed]);

  if (!viewport) return null;
  return createPortal(
    <div
      ref={headerRef}
      data-toolbar={toolbar}
      className={`pointer-events-auto rounded-xl shadow-lg ${isMonochrome ? 'bg-blue-50' : 'bg-[#222]'}`}
      style={{ position: 'absolute', zIndex: 40, visibility: 'hidden' }}
    >
      {children}
      {collapsed && (
        <div className={`flex h-6 items-center px-3 text-xs ${isMonochrome ? 'text-gray-600' : 'text-gold-muted'}`}>
          {imageCount} 张图片
        </div>
      )}
    </div>,
    viewport,
  );
}
