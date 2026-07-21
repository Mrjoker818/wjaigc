'use client';

import { useRef, useEffect, useCallback } from 'react';

export interface VenueRegion {
  id: string;
  name: string;
  type: 'entrance' | 'main-display' | 'interactive' | 'photo-spot' | 'storage' | 'passage' | 'other';
  /** normalized 0-1 bbox [x, y, w, h] */
  position: { x: number; y: number; w: number; h: number };
  estimatedSize?: string;
  notes?: string;
}

interface VenueRegionCanvasProps {
  imageUrl: string;
  regions: VenueRegion[];
  selectedRegionId?: string | null;
  onSelectRegion?: (id: string) => void;
  className?: string;
}

const REGION_COLORS: Record<VenueRegion['type'], string> = {
  entrance: '#f59e0b',
  'main-display': '#3b82f6',
  interactive: '#8b5cf6',
  'photo-spot': '#ec4899',
  storage: '#6b7280',
  passage: '#10b981',
  other: '#f97316',
};

const REGION_LABELS: Record<VenueRegion['type'], string> = {
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
  const imgRef = useRef<HTMLImageElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: cw, height: ch } = canvas;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(imgRef.current, 0, 0, cw, ch);

    regions.forEach((region) => {
      const { x, y, w, h } = region.position;
      const rx = x * cw;
      const ry = y * ch;
      const rw = w * cw;
      const rh = h * ch;
      const color = REGION_COLORS[region.type] || '#f97316';
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
      const label = `${REGION_LABELS[region.type] || region.type} · ${region.name}`;
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
  }, [regions, selectedRegionId]);

  // Load image and draw
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Set canvas size to match image aspect ratio within container
      const containerW = canvas.parentElement?.clientWidth || 600;
      const aspect = img.naturalHeight / img.naturalWidth;
      canvas.width = containerW;
      canvas.height = Math.round(containerW * aspect);
      draw();
    };
    img.src = imageUrl;
  }, [imageUrl, draw]);

  // Redraw when regions/selection change
  useEffect(() => {
    if (imgRef.current) draw();
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelectRegion || regions.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    // Find topmost region containing click (last = topmost visually)
    const hit = [...regions].reverse().find((r) => {
      const { x, y, w, h } = r.position;
      return mx >= x && mx <= x + w && my >= y && my <= y + h;
    });
    if (hit) onSelectRegion(hit.id);
  }, [regions, onSelectRegion]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className={`block w-full rounded-lg cursor-pointer ${className}`}
      style={{ maxHeight: '360px', objectFit: 'contain' }}
    />
  );
}
