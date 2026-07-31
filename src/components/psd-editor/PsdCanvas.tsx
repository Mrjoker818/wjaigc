'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { DesignLayer } from '@/lib/psd-export';

interface PsdCanvasProps {
  layers: DesignLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onLayerMove: (id: string, x: number, y: number) => void;
  width: number;
  height: number;
  onScaleChange?: (scale: number) => void;
}

interface LayerState {
  x: number;
  y: number;
  visible: boolean;
  image: HTMLImageElement | null;
}

export function PsdCanvas({
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayerMove,
  width,
  height,
}: PsdCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [layerStates, setLayerStates] = useState<Map<string, LayerState>>(new Map());
  const [dragState, setDragState] = useState<{
    layerId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  const checkerPatternRef = useRef<CanvasPattern | null>(null);

  // Create checkerboard pattern once
  useEffect(() => {
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 16;
    patternCanvas.height = 16;
    const pCtx = patternCanvas.getContext('2d');
    if (!pCtx) return;
    pCtx.fillStyle = '#ffffff';
    pCtx.fillRect(0, 0, 16, 16);
    pCtx.fillStyle = '#e8e8e8';
    pCtx.fillRect(0, 0, 8, 8);
    pCtx.fillRect(8, 8, 8, 8);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        checkerPatternRef.current = ctx.createPattern(patternCanvas, 'repeat');
      }
    }
  }, []);

  // Load layer images
  useEffect(() => {
    setLayerStates((prev) => {
      const activeIds = new Set(layers.map(layer => layer.id));
      const newStates = new Map([...prev].filter(([id]) => activeIds.has(id)));
      let changed = newStates.size !== prev.size;

      for (const layer of layers) {
        const nextX = layer.offsetX ?? 0;
        const nextY = layer.offsetY ?? 0;
        if (!newStates.has(layer.id)) {
          newStates.set(layer.id, { x: nextX, y: nextY, visible: layer.visible, image: null });
          changed = true;
          if (layer.imageDataUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              setLayerStates((current) => {
                const updated = new Map(current);
                const state = updated.get(layer.id);
                if (state) updated.set(layer.id, { ...state, image: img });
                return updated;
              });
            };
            img.src = layer.imageDataUrl;
          }
        } else {
          const existing = newStates.get(layer.id)!;
          if (existing.visible !== layer.visible || existing.x !== nextX || existing.y !== nextY) {
            newStates.set(layer.id, { ...existing, x: nextX, y: nextY, visible: layer.visible });
            changed = true;
          }
        }
      }

      return changed ? newStates : prev;
    });
  }, [layers]);

  // Calculate fit scale on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth - 60;
    const ch = container.clientHeight - 60;
    if (width > 0 && height > 0) {
      const fitScale = Math.min(cw / width, ch / height, 1);
      setScale(fitScale);
      setPan({ x: (container.clientWidth - width * fitScale) / 2, y: (container.clientHeight - height * fitScale) / 2 });
    }
  }, [width, height]);

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    // Transparent background - checkerboard handled by parent CSS
    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    // Draw canvas area shadow
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.shadowColor = 'transparent';

    // Draw layers bottom to top
    for (const layer of layers) {
      const state = layerStates.get(layer.id);
      if (!state || !state.visible || !state.image) continue;

      const offsetX = state.x;
      const offsetY = state.y;
      ctx.drawImage(state.image, offsetX, offsetY);
    }

    // Draw selection outline
    if (selectedLayerId) {
      const selLayer = layers.find((l) => l.id === selectedLayerId);
      const selState = layerStates.get(selectedLayerId);
      if (selLayer && selState) {
        const bx = (selLayer.boundingBox?.x ?? 0) + selState.x;
        const by = (selLayer.boundingBox?.y ?? 0) + selState.y;
        const bw = selLayer.boundingBox?.width ?? width;
        const bh = selLayer.boundingBox?.height ?? height;

        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([6 / scale, 3 / scale]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);

        // Corner handles
        const handleSize = 8 / scale;
        ctx.fillStyle = '#3b82f6';
        for (const [hx, hy] of [
          [bx, by],
          [bx + bw, by],
          [bx, by + bh],
          [bx + bw, by + bh],
        ]) {
          ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        }
      }
    }

    // Draw canvas border
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0, 0, width, height);

    ctx.restore();
  }, [layers, layerStates, selectedLayerId, scale, pan, width, height]);

  useEffect(() => {
    render();
  }, [render]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - pan.x) / scale;
    const my = (e.clientY - rect.top - pan.y) / scale;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
      return;
    }

    // Space key panning handled by parent
    if (e.button === 0 && (e as React.MouseEvent).shiftKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
      return;
    }

    // Check if clicking on a layer (top to bottom)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const state = layerStates.get(layer.id);
      if (!state || !state.visible) continue;

      const bx = (layer.boundingBox?.x ?? 0) + state.x;
      const by = (layer.boundingBox?.y ?? 0) + state.y;
      const bw = layer.boundingBox?.width ?? 0;
      const bh = layer.boundingBox?.height ?? 0;

      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
        if (!layer.locked) {
          onSelectLayer(layer.id);
          setDragState({ layerId: layer.id, startX: mx, startY: my, origX: state.x, origY: state.y });
        }
        return;
      }
    }

    // Clicked on empty area - start panning
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y });
    onSelectLayer(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: panStart.panX + (e.clientX - panStart.x),
        y: panStart.panY + (e.clientY - panStart.y),
      });
      return;
    }

    if (dragState) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = (e.clientX - rect.left - pan.x) / scale;
      const my = (e.clientY - rect.top - pan.y) / scale;
      const dx = mx - dragState.startX;
      const dy = my - dragState.startY;
      const state = layerStates.get(dragState.layerId);
      if (state) {
        setLayerStates((prev) => {
          const updated = new Map(prev);
          updated.set(dragState.layerId, { ...state, x: dragState.origX + dx, y: dragState.origY + dy });
          return updated;
        });
      }
    }
  };

  const handleMouseUp = () => {
    if (dragState) {
      const state = layerStates.get(dragState.layerId);
      if (state) {
        onLayerMove(dragState.layerId, state.x, state.y);
      }
      setDragState(null);
    }
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.05, Math.min(10, scale * delta));
    
    // Zoom toward mouse position
    const newPanX = mouseX - (mouseX - pan.x) * (newScale / scale);
    const newPanY = mouseY - (mouseY - pan.y) * (newScale / scale);
    
    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        data-testid="layer-canvas"
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      <div className="absolute bottom-3 left-3 text-xs text-black/40 bg-white/80 px-2 py-1 rounded-md shadow-sm backdrop-blur-sm font-mono">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
