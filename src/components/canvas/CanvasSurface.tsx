'use client';

import React, { forwardRef, type CSSProperties, type ReactNode } from 'react';

interface CanvasSurfaceProps {
  offset: { x: number; y: number };
  zoom: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const CanvasSurface = forwardRef<HTMLDivElement, CanvasSurfaceProps>(function CanvasSurface(
  { offset, zoom, children, className, style },
  ref,
) {
  return (
    <div
      ref={ref}
      data-canvas-surface="true"
      className={className}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        willChange: 'transform',
        contain: 'layout style',
        ...style,
      }}
    >
      {children}
    </div>
  );
});
