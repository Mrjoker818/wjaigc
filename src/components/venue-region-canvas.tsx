'use client';

import { useRef, useEffect, useLayoutEffect, useState } from 'react';

export interface VenueRegion {
  id: string;
  name: string;
  type: string;
  /** A descriptive location or normalized 0-1 bbox [x, y, w, h]. */
  position: string | { x: number; y: number; w: number; h: number };
  estimatedSize?: string | { length: number; width: number };
  notes?: string;
}

export function hasVenueRegionCoordinates(region: VenueRegion): region is VenueRegion & { position: { x: number; y: number; w: number; h: number } } {
  const p = region.position;
  if (!p || typeof p !== 'object') return false;
  return [p.x, p.y, p.w, p.h].every(Number.isFinite)
    && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0 && p.x + p.w <= 1 && p.y + p.h <= 1;
}

interface VenueRegionCanvasProps {
  imageUrl: string;
  regions: VenueRegion[];
  selectedRegionId?: string | null;
  onSelectRegion?: (id: string) => void;
  className?: string;
}

const REGION_COLORS: Record<string, string> = {
  entrance: '#f59e0b',
  'main-display': '#3b82f6',
  interactive: '#8b5cf6',
  'photo-spot': '#ec4899',
  storage: '#6b7280',
  passage: '#10b981',
  other: '#f97316',
};

const REGION_LABELS: Record<string, string> = {
  entrance: '入口',
  'main-display': '主展区',
  interactive: '互动区',
  'photo-spot': '打卡区',
  storage: '仓储',
  passage: '通道',
  other: '其他',
};

export function VenueRegionCanvas({
  imageUrl,
  regions,
  selectedRegionId,
  onSelectRegion,
  className = '',
}: VenueRegionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const image = loaded?.url === imageUrl ? loaded.image : null;

  useEffect(() => {
    setLoaded(null);
    if (!imageUrl) return;
    const image = new Image();
    let current = true;
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (current && image.naturalWidth > 0 && image.naturalHeight > 0) setLoaded({ url: imageUrl, image });
    };
    image.src = imageUrl;
    return () => {
      current = false;
      image.onload = null;
    };
  }, [imageUrl]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!image) {
      canvas.width = canvas.width;
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 600;
    const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const { width: cw, height: ch } = canvas;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(image, 0, 0, cw, ch);

    regions.forEach((region) => {
      if (!hasVenueRegionCoordinates(region)) return;
      const { x, y, w, h } = region.position;
      const rx = x * cw;
      const ry = y * ch;
      const rw = w * cw;
      const rh = h * ch;
      const color = Object.hasOwn(REGION_COLORS, region.type) ? REGION_COLORS[region.type] : '#f97316';
      const isSelected = region.id === selectedRegionId;

      // Fill with semi-transparent color
      ctx.fillStyle = isSelected ? color + '55' : color + '33';
      ctx.fillRect(rx, ry, rw, rh);

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [] : [4, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);

      // Label pill
      const regionLabel = Object.hasOwn(REGION_LABELS, region.type) ? REGION_LABELS[region.type] : region.type;
      const label = `${regionLabel} · ${region.name}`;
      const fontSize = Math.max(10, Math.min(13, cw / 40));
      ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
      const textW = ctx.measureText(label).width;
      const pillH = fontSize + 8;
      const pillX = rx + 4;
      const pillY = ry + 4;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, textW + 12, pillH, 4);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.fillText(label, pillX + 6, pillY + pillH - 5);
    });
  }, [image, regions, selectedRegionId]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image || !onSelectRegion || regions.length === 0) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // Match the centered object-fit: contain box used to display the bitmap.
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const width = canvas.width * scale, height = canvas.height * scale;
    const mx = (e.clientX - rect.left - (rect.width - width) / 2) / width;
    const my = (e.clientY - rect.top - (rect.height - height) / 2) / height;
    if (mx < 0 || mx > 1 || my < 0 || my > 1) return;

    // Find topmost region containing click (last = topmost visually)
    const hit = [...regions].reverse().find((r) => {
      if (!hasVenueRegionCoordinates(r)) return false;
      const { x, y, w, h } = r.position;
      return mx >= x && mx <= x + w && my >= y && my <= y + h;
    });
    if (hit) onSelectRegion(hit.id);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      role="img"
      aria-label="场馆区域标注图"
      className={`block w-full rounded-lg cursor-pointer ${className}`}
      style={{ maxHeight: '360px', objectFit: 'contain', objectPosition: 'center' }}
    />
  );
}
