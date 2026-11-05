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
