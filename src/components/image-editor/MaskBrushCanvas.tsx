'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import type Konva from 'konva';

export interface MaskBrushCanvasRef {
  undo: () => void;
  clear: () => void;
  exportMask: () => Promise<string>;
}

export interface MaskBrushCanvasProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  brushSize: number;
  brushMode: 'brush' | 'eraser';
}

interface DrawLine {
  id: string;
  points: number[];
  isEraser: boolean;
  brushSize: number;
}

const MaskBrushCanvas = forwardRef<MaskBrushCanvasRef, MaskBrushCanvasProps>(
  ({ imageUrl, imageWidth, imageHeight, brushSize, brushMode }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
    const [lines, setLines] = useState<DrawLine[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);

    // 加载图片
    useEffect(() => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setImageObj(img);
      img.src = imageUrl;
    }, [imageUrl]);

    // 自适应容器大小
    useEffect(() => {
      const updateSize = () => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setCanvasSize({ width: rect.width, height: rect.height });
        }
      };
      updateSize();
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }, []);

    // 计算缩放比例
    const scale = Math.min(
      canvasSize.width / imageWidth,
      canvasSize.height / imageHeight,
      1
    );
    const displayWidth = imageWidth * scale;
    const displayHeight = imageHeight * scale;
    const offsetX = (canvasSize.width - displayWidth) / 2;
    const offsetY = (canvasSize.height - displayHeight) / 2;

    // 绘制事件
    const getRelativePointerPosition = useCallback(() => {
      const stage = stageRef.current;
      if (!stage) return null;
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      return {
        x: (pointer.x - offsetX) / scale,
        y: (pointer.y - offsetY) / scale,
      };
    }, [offsetX, offsetY, scale]);

    const handleMouseDown = useCallback(() => {
      setIsDrawing(true);
      const pos = getRelativePointerPosition();
      if (!pos) return;
      setLines(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          points: [pos.x, pos.y],
          isEraser: brushMode === 'eraser',
          brushSize,
        },
      ]);
    }, [brushMode, brushSize, getRelativePointerPosition]);

    const handleMouseMove = useCallback(() => {
      if (!isDrawing) return;
      const pos = getRelativePointerPosition();
      if (!pos) return;
      setLines(prev => {
        const newLines = [...prev];
        const last = newLines[newLines.length - 1];
        if (last) {
          last.points = [...last.points, pos.x, pos.y];
        }
        return newLines;
      });
    }, [isDrawing, getRelativePointerPosition]);

    const handleMouseUp = useCallback(() => {
      setIsDrawing(false);
    }, []);

    // 光标管理：画布区域内显示画笔光标，外部显示箭头
    const handleStageMouseEnter = useCallback(() => {
      const stage = stageRef.current;
      if (stage) {
        stage.container().style.cursor = brushMode === 'eraser' ? 'cell' : 'crosshair';
      }
    }, [brushMode]);

    const handleStageMouseLeave = useCallback(() => {
      const stage = stageRef.current;
      if (stage) {
        stage.container().style.cursor = 'default';
      }
    }, []);

    // 暴露方法
    useImperativeHandle(ref, () => ({
      undo: () => setLines(prev => prev.slice(0, -1)),
      clear: () => setLines([]),
      exportMask: () => {
        return new Promise<string>((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = imageWidth;
          canvas.height = imageHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          // 黑色背景（保留区域）
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, imageWidth, imageHeight);

          // 白色笔迹（擦除区域）
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#ffffff';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          for (const line of lines) {
            if (line.isEraser) continue; // 橡皮擦不导出
            if (line.points.length < 2) continue;
            ctx.lineWidth = line.brushSize;
            ctx.beginPath();
            ctx.moveTo(line.points[0], line.points[1]);
            for (let i = 2; i < line.points.length; i += 2) {
              ctx.lineTo(line.points[i], line.points[i + 1]);
            }
            ctx.stroke();
          }

          resolve(canvas.toDataURL('image/png'));
        });
      },
    }));

    return (
      <div ref={containerRef} className="w-full h-full bg-gray-900 rounded-lg overflow-hidden relative">
        {/* 棋盘格背景 */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%)',
            backgroundSize: '16px 16px',
          }}
        />
        <div className="relative w-full h-full">
          <Stage
            ref={stageRef}
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseEnter={handleStageMouseEnter}
            onMouseLeave={handleStageMouseLeave}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
          >
            <Layer>
              {/* 原图 */}
              {imageObj && (
                <KonvaImage
                  image={imageObj}
                  x={offsetX}
                  y={offsetY}
                  width={displayWidth}
                  height={displayHeight}
                />
              )}
              {/* 绘制线条 */}
              {lines.map(line => (
                <Line
                  key={line.id}
                  points={line.points.map((p, i) =>
                    i % 2 === 0 ? p * scale + offsetX : p * scale + offsetY
                  )}
                  stroke={line.isEraser ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)'}
                  strokeWidth={line.brushSize * scale}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={
                    line.isEraser ? 'destination-out' : 'source-over'
                  }
                />
              ))}
            </Layer>
          </Stage>
        </div>
      </div>
    );
  }
);

MaskBrushCanvas.displayName = 'MaskBrushCanvas';
export default MaskBrushCanvas;
