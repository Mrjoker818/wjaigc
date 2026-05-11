'use client';

import React from 'react';
import { Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';
import type { DesignLayer } from '@/lib/psd-export';

interface CanvasImageProps {
  layer: DesignLayer;
  x?: number;
  y?: number;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}

export function CanvasImage({ layer, x = 0, y = 0, isSelected, onSelect, onDragEnd }: CanvasImageProps) {
  const [image] = useImage(layer.imageDataUrl || '', 'anonymous');

  if (!image || !layer.visible) return null;

  const bx = layer.boundingBox?.x ?? 0;
  const by = layer.boundingBox?.y ?? 0;
  const bw = layer.boundingBox?.width ?? image.width;
  const bh = layer.boundingBox?.height ?? image.height;

  return (
    <KonvaImage
      image={image}
      x={bx + x}
      y={by + y}
      width={bw}
      height={bh}
      draggable={!layer.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onDragEnd(e.target.x() - bx, e.target.y() - by);
      }}
      stroke={isSelected ? '#f59e0b' : undefined}
      strokeWidth={isSelected ? 2 : 0}
      dash={isSelected ? [6, 3] : undefined}
    />
  );
}
