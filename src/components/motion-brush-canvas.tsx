'use client';

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Brush, Eraser, Undo2, Trash2, ArrowRight, Check, X } from 'lucide-react';

export interface MotionTrajectory {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  speed: number;
}

export interface MotionBrushResult {
  maskDataUrl: string;
  trajectories: MotionTrajectory[];
}

export interface MotionBrushCanvasHandle {
  export: () => MotionBrushResult | null;
  clear: () => void;
}

interface MotionBrushCanvasProps {
  imageUrl: string;
  accentColor?: string;
  borderColor?: string;
  inputBg?: string;
  onExport?: (result: MotionBrushResult) => void;
  onClose?: () => void;
}

const MotionBrushCanvas = forwardRef<MotionBrushCanvasHandle, MotionBrushCanvasProps>(
  ({ imageUrl, accentColor = '#d4af37', borderColor = 'rgba(212,175,55,0.3)', inputBg = '#2a2a2a', onExport, onClose }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<'brush' | 'eraser' | 'trajectory'>('brush');
    const [brushSize, setBrushSize] = useState(20);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [trajectories, setTrajectories] = useState<MotionTrajectory[]>([]);
    const [trajStart, setTrajStart] = useState<{ x: number; y: number } | null>(null);
    const [trajEnd, setTrajEnd] = useState<{ x: number; y: number } | null>(null);
    const maskHistoryRef = useRef<ImageData[]>([]);

    // 加载图片并初始化画布
    useEffect(() => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;

        // 限制最大尺寸
        const maxDim = 512;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        canvas.width = w;
        canvas.height = h;
        overlay.width = w;
        overlay.height = h;
        setImageSize({ width: w, height: h });

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setImageLoaded(true);
        }
      };
      img.src = imageUrl;
    }, [imageUrl]);

    // 保存蒙版状态（用于撤销）
    const saveMaskState = useCallback(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.getImageData(0, 0, overlay.width, overlay.height);
      maskHistoryRef.current.push(imageData);
      if (maskHistoryRef.current.length > 20) {
        maskHistoryRef.current.shift();
      }
    }, []);

    // 获取归一化坐标 (0-1)
    const getNormalizedPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return { x: 0, y: 0 };
      const rect = overlay.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    }, []);

    // 获取画布像素坐标
    const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return { x: 0, y: 0 };
      const rect = overlay.getBoundingClientRect();
      const scaleX = overlay.width / rect.width;
      const scaleY = overlay.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }, []);

    // 绘制蒙版笔触
    const drawMask = useCallback((x: number, y: number, erase: boolean) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      ctx.fillStyle = erase ? 'rgba(0,0,0,1)' : 'rgba(255, 215, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }, [brushSize]);

    // 鼠标事件处理
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === 'trajectory') {
        const pos = getNormalizedPos(e);
        setTrajStart(pos);
        setTrajEnd(pos);
        return;
      }

      setIsDrawing(true);
      saveMaskState();
      const pos = getCanvasPos(e);
      drawMask(pos.x, pos.y, tool === 'eraser');
    }, [tool, drawMask, getCanvasPos, getNormalizedPos, saveMaskState]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === 'trajectory' && trajStart) {
        const pos = getNormalizedPos(e);
        setTrajEnd(pos);
        return;
      }

      if (!isDrawing) return;
      const pos = getCanvasPos(e);
      drawMask(pos.x, pos.y, tool === 'eraser');
    }, [isDrawing, tool, drawMask, getCanvasPos, getNormalizedPos, trajStart]);

    const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === 'trajectory' && trajStart) {
        const pos = getNormalizedPos(e);
        const dx = pos.x - trajStart.x;
        const dy = pos.y - trajStart.y;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          setTrajectories(prev => [...prev, {
            startX: trajStart.x,
            startY: trajStart.y,
            endX: pos.x,
            endY: pos.y,
            speed: 50,
          }]);
        }
        setTrajStart(null);
        setTrajEnd(null);
        return;
      }

      setIsDrawing(false);
    }, [tool, trajStart, getNormalizedPos]);

    // 撤销
    const handleUndo = useCallback(() => {
      const overlay = overlayRef.current;
      if (!overlay || maskHistoryRef.current.length === 0) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      const prevState = maskHistoryRef.current.pop()!;
      ctx.putImageData(prevState, 0, 0);
    }, []);

    // 清空
    const handleClear = useCallback(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      setTrajectories([]);
      maskHistoryRef.current = [];
    }, []);

    // 导出
    const exportResult = useCallback((): MotionBrushResult | null => {
      const overlay = overlayRef.current;
      if (!overlay) return null;

      // 导出蒙版为base64
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = overlay.width;
      maskCanvas.height = overlay.height;
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return null;

      // 将蒙版转为黑白（有内容的区域为白色）
      maskCtx.drawImage(overlay, 0, 0);
      const imageData = maskCtx.getImageData(0, 0, overlay.width, overlay.height);
      let hasMask = false;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const alpha = imageData.data[i + 3];
        if (alpha > 10) { // 有实际涂抹
          hasMask = true;
          imageData.data[i] = 255;
          imageData.data[i + 1] = 255;
          imageData.data[i + 2] = 255;
          imageData.data[i + 3] = 255;
        } else {
          imageData.data[i] = 0;
          imageData.data[i + 1] = 0;
          imageData.data[i + 2] = 0;
          imageData.data[i + 3] = 255;
        }
      }
      // 无蒙版且无轨迹时返回 null
      if (!hasMask && trajectories.length === 0) return null;
      maskCtx.putImageData(imageData, 0, 0);
      const maskDataUrl = hasMask ? maskCanvas.toDataURL('image/png') : '';

      return { maskDataUrl, trajectories };
    }, [trajectories]);

    useImperativeHandle(ref, () => ({
      export: exportResult,
      clear: handleClear,
    }));

    const handleConfirm = useCallback(() => {
      const result = exportResult();
      if (result) {
        onExport?.(result);
      }
    }, [exportResult, onExport]);

    // 绘制轨迹箭头预览
    useEffect(() => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      // 重绘轨迹箭头（在蒙版之上）
      // 这里我们用一个临时canvas来绘制箭头
    }, [trajectories, trajStart, trajEnd]);

    if (!imageLoaded) {
      return (
        <div className="flex items-center justify-center p-8 text-gray-500 text-sm">
          加载中...
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: inputBg }}>
          <button
            onClick={() => setTool('brush')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all cursor-pointer"
            style={{
              background: tool === 'brush' ? 'rgba(212,175,55,0.2)' : 'transparent',
              color: tool === 'brush' ? accentColor : '#888',
            }}
          >
            <Brush className="w-3.5 h-3.5" />
            涂抹
          </button>
          <button
            onClick={() => setTool('eraser')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all cursor-pointer"
            style={{
              background: tool === 'eraser' ? 'rgba(212,175,55,0.2)' : 'transparent',
              color: tool === 'eraser' ? accentColor : '#888',
            }}
          >
            <Eraser className="w-3.5 h-3.5" />
            橡皮
          </button>
          <button
            onClick={() => setTool('trajectory')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all cursor-pointer"
            style={{
              background: tool === 'trajectory' ? 'rgba(212,175,55,0.2)' : 'transparent',
              color: tool === 'trajectory' ? accentColor : '#888',
            }}
          >
            <ArrowRight className="w-3.5 h-3.5" />
            轨迹
          </button>

          <div className="w-px h-4 mx-1" style={{ background: borderColor }} />

          {/* 画笔大小 */}
          {tool !== 'trajectory' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">大小:</span>
              <input
                type="range"
                min="5"
                max="50"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-16 h-1 rounded appearance-none cursor-pointer"
                style={{ background: `linear-gradient(to right, ${accentColor} ${brushSize * 2}%, #333 ${brushSize * 2}%)` }}
              />
              <span className="text-[10px] text-gray-500 w-4">{brushSize}</span>
            </div>
          )}

          <div className="w-px h-4 mx-1" style={{ background: borderColor }} />

          <button
            onClick={handleUndo}
            className="p-1 rounded text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
            title="撤销"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleClear}
            className="p-1 rounded text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
            title="清空"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1" />

          <button
            onClick={handleConfirm}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-all"
            style={{ background: 'rgba(212,175,55,0.2)', color: accentColor }}
          >
            <Check className="w-3.5 h-3.5" />
            确认
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 画布区域 */}
        <div
          ref={containerRef}
          className="relative rounded-md overflow-hidden"
          style={{ border: `1px solid ${borderColor}` }}
        >
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{ maxHeight: '300px', objectFit: 'contain' }}
          />
          <canvas
            ref={overlayRef}
            className="absolute top-0 left-0 w-full h-full"
            style={{ cursor: tool === 'trajectory' ? 'crosshair' : 'none', maxHeight: '300px' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={(e) => {
              e.preventDefault();
              setBrushSize(prev => Math.max(5, Math.min(100, prev - Math.sign(e.deltaY) * 3)));
            }}
            onMouseLeave={() => { setIsDrawing(false); setTrajStart(null); setTrajEnd(null); }}
          />

          {/* 轨迹预览SVG */}
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            style={{ maxHeight: '300px' }}
          >
            {trajectories.map((t, i) => (
              <g key={i}>
                <line
                  x1={t.startX * imageSize.width}
                  y1={t.startY * imageSize.height}
                  x2={t.endX * imageSize.width}
                  y2={t.endY * imageSize.height}
                  stroke={accentColor}
                  strokeWidth="2"
                  strokeDasharray="4,2"
                />
                <circle
                  cx={t.startX * imageSize.width}
                  cy={t.startY * imageSize.height}
                  r="4"
                  fill={accentColor}
                />
                <polygon
                  points={`${t.endX * imageSize.width},${t.endY * imageSize.height} ${t.endX * imageSize.width - 6},${t.endY * imageSize.height - 4} ${t.endX * imageSize.width - 6},${t.endY * imageSize.height + 4}`}
                  fill={accentColor}
                  transform={`rotate(${Math.atan2(t.endY - t.startY, t.endX - t.startX) * 180 / Math.PI}, ${t.endX * imageSize.width}, ${t.endY * imageSize.height})`}
                />
              </g>
            ))}
            {trajStart && trajEnd && (
              <line
                x1={trajStart.x * imageSize.width}
                y1={trajStart.y * imageSize.height}
                x2={trajEnd.x * imageSize.width}
                y2={trajEnd.y * imageSize.height}
                stroke={accentColor}
                strokeWidth="2"
                strokeDasharray="4,2"
                opacity="0.6"
              />
            )}
          </svg>
        </div>

        {/* 状态提示 */}
        <div className="flex items-center justify-between px-2">
          <span className="text-[10px] text-gray-500">
            {tool === 'brush' && '涂抹需要运动的区域（金色半透明）'}
            {tool === 'eraser' && '擦除不需要的区域'}
            {tool === 'trajectory' && '拖拽绘制运动方向箭头'}
          </span>
          <span className="text-[10px] text-gray-500">
            {trajectories.length > 0 && `${trajectories.length}条轨迹`}
          </span>
        </div>
      </div>
    );
  }
);

MotionBrushCanvas.displayName = 'MotionBrushCanvas';
export default MotionBrushCanvas;
