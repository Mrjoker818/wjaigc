'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Pencil, Eraser, X, ZoomIn, ZoomOut, RotateCcw, Loader2, Sparkles, History, Check, ChevronDown, ChevronUp, MessageSquare, ImageIcon, Lock, Hand, Trash2 } from 'lucide-react';

// ==================== 类型 ====================
interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt?: string;
  originalWidth?: number;
  originalHeight?: number;
}

interface ServerModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  type?: string;
}

interface EditHistoryItem {
  id: string;
  prompt: string;
  imageUrl: string;
  timestamp: number;
}

interface ImageEditorProps {
  image: CanvasImage;
  onClose: () => void;
  onConfirm: (result: { url: string; prompt: string }) => void;
  canvasScale?: number;
}

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
const QUALITIES = [
  { value: 'low', label: '标准' },
  { value: 'medium', label: '高清' },
  { value: 'high', label: '超清' },
];
const COUNTS = [1, 2, 3, 4];

export function ImageEditor({ image, onClose, onConfirm, canvasScale = 1 }: ImageEditorProps) {
  // 基础状态
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState('high');
  const [outputCount, setOutputCount] = useState(1);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedLLMId, setSelectedLLMId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageUrl, setCurrentImageUrl] = useState(image.url);

  // 结果图片状态
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [isResultLoading, setIsResultLoading] = useState(false);

  // 服务器模型列表
  const [serverModels, setServerModels] = useState<ServerModel[]>([]);
  const [llmModels, setLLMModels] = useState<ServerModel[]>([]);

  // 图片缩放（编辑器内部预览图的缩放）
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showHand, setShowHand] = useState(false);

  // 模型列表展开
  const [modelListExpanded, setModelListExpanded] = useState(false);
  const [llmListExpanded, setLLMListExpanded] = useState(false);

  // 当前模型是否支持蒙版涂抹
  const currentModelSupportsMask = (() => {
    const m = serverModels.find(m => `${m.providerId}::${m.id}` === selectedModelId);
    if (!m) return true;
    return !m.id.toLowerCase().includes('gemini');
  })();

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 320, height: 320 });
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 320 });

  // 编辑器位置 - 相对于源图片，在画布坐标系内
  const GAP = 30; // 图片到编辑器的间距
  const editorWidth = 380;

  // 图片原始尺寸
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 512, height: 512 });

  // 从服务器加载编辑模型
  useEffect(() => {
    const loadModels = async () => {
      try {
        const imgRes = await fetch('/api/models?type=image');
        if (imgRes.ok) {
          const data = await imgRes.json();
          const models: ServerModel[] = [];
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              const id = (m.id || m.name || '').toLowerCase();
              if (id.includes('3d') || id.includes('vectoriz') || id.includes('layer') || id.includes('segment')) continue;
              models.push({
                id: m.id || m.name,
                name: m.name || m.id,
                providerId: m.providerId || '',
                providerName: m.providerName || m.providerId || '',
                type: m.type,
              });
            }
          }
          setServerModels(models);
          if (models.length > 0 && !selectedModelId) {
            setSelectedModelId(`${models[0].providerId}::${models[0].id}`);
          }
        }

        const chatRes = await fetch('/api/models?type=chat');
        if (chatRes.ok) {
          const data = await chatRes.json();
          const models: ServerModel[] = [];
          if (data.models && Array.isArray(data.models)) {
            for (const m of data.models) {
              models.push({
                id: m.id || m.name,
                name: m.name || m.id,
                providerId: m.providerId || '',
                providerName: m.providerName || m.providerId || '',
                type: m.type,
              });
            }
          }
          setLLMModels(models);
        }
      } catch (err) {
        console.error('Failed to load edit models:', err);
      }
    };
    loadModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 初始化图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageNaturalSize({ width: img.width, height: img.height });
      const maxSize = 340;
      const ratio = img.width / img.height;
      let displayWidth: number, displayHeight: number;
      if (ratio > 1) {
        displayWidth = maxSize;
        displayHeight = maxSize / ratio;
      } else {
        displayHeight = maxSize;
        displayWidth = maxSize * ratio;
      }
      setImageDisplaySize({ width: displayWidth, height: displayHeight });
      setCanvasSize({ width: displayWidth, height: displayHeight });
    };
    img.src = image.url;
  }, [image.url]);

  // 初始化Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [canvasSize]);

  // 绘制线条
  const drawLine = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tool === 'brush' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 0, 1)';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [brushSize, tool]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !currentModelSupportsMask) return;
    e.stopPropagation();
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [currentModelSupportsMask]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    drawLine(e);
  }, [isDrawing, drawLine]);

  const handleMouseUp = useCallback(() => { setIsDrawing(false); }, []);

  const clearMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const exportMask = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resultData = tempCtx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3];
      if (alpha > 10) {
        resultData.data[i] = 255;
        resultData.data[i + 1] = 255;
        resultData.data[i + 2] = 255;
        resultData.data[i + 3] = 255;
      } else {
        resultData.data[i] = 0;
        resultData.data[i + 1] = 0;
        resultData.data[i + 2] = 0;
        resultData.data[i + 3] = 0;
      }
    }
    tempCtx.putImageData(resultData, 0, 0);
    return tempCanvas.toDataURL('image/png');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [prompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) { setError('请输入编辑指令'); return; }
    if (!selectedModelId) { setError('请选择模型'); return; }

    setError(null);
    setIsLoading(true);
    setIsResultLoading(true);
    setResultImages([]);
    setLoadingProgress(0);

    try {
      const maskDataUrl = currentModelSupportsMask ? exportMask() : null;
      const progressInterval = setInterval(() => {
        setLoadingProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      const [providerId, modelId] = selectedModelId.split('::');

      const response = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: currentImageUrl,
          prompt: prompt,
          mask: maskDataUrl,
          size: aspectRatio,
          quality,
          model: modelId || selectedModelId,
          providerId,
          count: outputCount,
        }),
      });

      clearInterval(progressInterval);
      setLoadingProgress(100);

      const data = await response.json();

      if (data.success && data.image) {
        setIsResultLoading(false);
        const urls = data.images ? data.images.map((img: { url: string }) => img.url) : [data.image.url];
        setResultImages(urls);

        const newHistoryItem: EditHistoryItem = {
          id: `edit-${Date.now()}`,
          prompt: prompt,
          imageUrl: data.image.url,
          timestamp: Date.now(),
        };
        setHistory(prev => [...prev.slice(0, currentHistoryIndex + 1), newHistoryItem]);
        setCurrentHistoryIndex(prev => prev + 1);
        setCurrentImageUrl(data.image.url);
        clearMask();
      } else if (data.requiresApiKey) {
        setIsResultLoading(false);
        setError('需要在管理员系统中配置 API Key');
      } else {
        setIsResultLoading(false);
        setError(data.error || '编辑失败');
      }
    } catch (err: unknown) {
      setIsResultLoading(false);
      const errMsg = err instanceof Error ? err.message : '网络错误，请重试';
      console.error('Edit error:', err);
      setError(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedModelId, currentImageUrl, aspectRatio, quality, outputCount, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex]);

  const handleConfirmResult = useCallback((url?: string) => {
    const finalUrl = url || resultImages[0];
    if (finalUrl) {
      onConfirm({
        url: finalUrl,
        prompt: `${image.prompt || ''} + ${prompt}`,
      });
    }
    setPrompt('');
    setResultImages([]);
    onClose();
  }, [resultImages, prompt, image.prompt, onConfirm, onClose]);

  const handleHistoryClick = useCallback((index: number) => {
    const historyItem = history[index];
    if (historyItem) {
      setCurrentImageUrl(historyItem.imageUrl);
      setCurrentHistoryIndex(index);
    }
  }, [history]);

  // 图片缩放控制
  const handleZoomIn = useCallback(() => setImageZoom(prev => Math.min(prev + 0.25, 3)), []);
  const handleZoomOut = useCallback(() => setImageZoom(prev => Math.max(prev - 0.25, 0.5)), []);
  const handleZoomReset = useCallback(() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); setShowHand(false); }, []);

  // 图片平移
  const handleImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (imageZoom <= 1) return;
    e.stopPropagation();
    e.preventDefault();
    setIsPanning(true);
    setPanStart({ x: e.clientX - imagePan.x, y: e.clientY - imagePan.y });
  }, [imageZoom, imagePan]);

  const handleImageMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    e.stopPropagation();
    setImagePan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handleImageMouseUp = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation?.();
    setIsPanning(false);
  }, []);

  // 鼠标滚轮缩放图片预览
  const handleImageWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setImageZoom(prev => {
      const next = Math.round((prev + delta) * 100) / 100;
      const clamped = Math.max(0.5, Math.min(3, next));
      setShowHand(clamped > 1);
      return clamped;
    });
  }, []);

  // 编辑器位置：相对于源图片右侧
  const editorLeft = image.width + GAP;
  const editorTop = 0;
  // 结果框位置：编辑器右侧
  const resultLeft = editorLeft + editorWidth + GAP;
  const resultTop = 0;

  // SVG连线端点（在画布坐标系内）
  // 左线：图片右侧中点 → 编辑器左侧中点
  const leftLineStart = { x: image.width, y: image.height / 2 };
  const leftLineEnd = { x: editorLeft, y: editorTop + 180 };
  // 右线：编辑器右侧中点 → 结果框左侧中点
  const rightLineStart = { x: editorLeft + editorWidth, y: editorTop + 180 };
  const rightLineEnd = { x: resultLeft, y: resultTop + 180 };

  // 阻止所有鼠标事件冒泡到画布
  const stopPropagation = useCallback((e: React.MouseEvent | React.WheelEvent) => {
    e.stopPropagation();
    if ('deltaY' in e) e.preventDefault();
  }, []);

  return (
    <div
      className="absolute"
      style={{
        left: 0,
        top: 0,
        pointerEvents: 'none',
      }}
    >
      {/* SVG连接线 */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ overflow: 'visible', width: 0, height: 0 }}
      >
        <defs>
          <style>{`
            @keyframes editFlow { from { stroke-dashoffset: 16; } to { stroke-dashoffset: 0; } }
            .edit-flow-line { animation: editFlow 0.4s linear infinite; }
            @keyframes editPulse { 0%,100% { r: 6; opacity: 0.8; } 50% { r: 9; opacity: 1; } }
          `}</style>
        </defs>

        {/* 图片→编辑器 连线 */}
        <path
          d={`M ${leftLineStart.x} ${leftLineStart.y}
              C ${leftLineStart.x + GAP * 0.6} ${leftLineStart.y},
                ${leftLineEnd.x - GAP * 0.6} ${leftLineEnd.y},
                ${leftLineEnd.x} ${leftLineEnd.y}`}
          stroke="#d4af37"
          strokeWidth="2"
          fill="none"
          strokeDasharray="8 4"
          className="edit-flow-line"
        />
        {/* 图片端连接点 */}
        <circle cx={leftLineStart.x} cy={leftLineStart.y} r="6" fill="#d4af37" style={{ animation: 'editPulse 1.5s ease-in-out infinite' }} />
        <circle cx={leftLineStart.x} cy={leftLineStart.y} r="3" fill="#141414" />
        {/* 编辑器端连接点 */}
        <circle cx={leftLineEnd.x} cy={leftLineEnd.y} r="5" fill="#d4af37" />
        <circle cx={leftLineEnd.x} cy={leftLineEnd.y} r="2.5" fill="#141414" />

        {/* 编辑器→结果框 连线 */}
        {(isResultLoading || resultImages.length > 0) && (
          <>
            <path
              d={`M ${rightLineStart.x} ${rightLineStart.y}
                  C ${rightLineStart.x + GAP * 0.6} ${rightLineStart.y},
                    ${rightLineEnd.x - GAP * 0.6} ${rightLineEnd.y},
                    ${rightLineEnd.x} ${rightLineEnd.y}`}
              stroke="#d4af37"
              strokeWidth="2"
              fill="none"
              strokeDasharray="8 4"
              className="edit-flow-line"
            />
            <circle cx={rightLineStart.x} cy={rightLineStart.y} r="5" fill="#d4af37" />
            <circle cx={rightLineStart.x} cy={rightLineStart.y} r="2.5" fill="#141414" />
            <circle cx={rightLineEnd.x} cy={rightLineEnd.y} r="5" fill="#d4af37" />
            <circle cx={rightLineEnd.x} cy={rightLineEnd.y} r="2.5" fill="#141414" />
          </>
        )}
      </svg>

      {/* 主编辑器面板 */}
      <div
        ref={containerRef}
        className="absolute bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
        style={{ left: editorLeft, top: editorTop, width: editorWidth, maxHeight: '90vh', pointerEvents: 'auto' }}
        onWheel={stopPropagation}
        onMouseDown={stopPropagation}
        onMouseMove={stopPropagation}
        onMouseUp={stopPropagation}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#141414]">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Pencil className="h-4 w-4 text-[#d4af37]" />
            语言修图
          </h2>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-1 rounded-lg hover:bg-[#2a2a2a] transition-colors">
            <X className="h-4 w-4 text-[#888]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-[calc(90vh-50px)] overflow-y-auto" onWheel={stopPropagation}>
          {/* 图片预览区 + 缩放控制 */}
          <div
            className="relative bg-[#1a1a1a] rounded-lg overflow-hidden"
            style={{ height: Math.min(360, imageDisplaySize.height * 1.15 + 40) }}
            onWheel={handleImageWheel}
          >
            {/* 缩放控制条 - 右上角 */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#0d0d0d]/80 rounded-lg px-1.5 py-1 backdrop-blur-sm border border-[#2a2a2a]/50" onClick={stopPropagation}>
              <button onClick={(e) => { e.stopPropagation(); handleZoomOut(); }} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="缩小">
                <ZoomOut className="h-3.5 w-3.5 text-[#888]" />
              </button>
              <span className="text-[10px] text-[#d4af37] font-mono w-8 text-center">{Math.round(imageZoom * 100)}%</span>
              <button onClick={(e) => { e.stopPropagation(); handleZoomIn(); }} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="放大">
                <ZoomIn className="h-3.5 w-3.5 text-[#888]" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleZoomReset(); }} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="重置">
                <RotateCcw className="h-3.5 w-3.5 text-[#888]" />
              </button>
            </div>

            {/* 小手标志 - 放大后显示 */}
            {showHand && !isPanning && (
              <div
                className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-[#0d0d0d]/80 rounded-lg px-2 py-1 backdrop-blur-sm border border-[#2a2a2a]/50 cursor-grab"
                onMouseDown={handleImageMouseDown}
                onClick={stopPropagation}
                title="拖拽移动图片"
              >
                <Hand className="h-3.5 w-3.5 text-[#d4af37]" />
                <span className="text-[10px] text-[#d4af37]">拖拽</span>
              </div>
            )}

            {/* 图片+蒙版容器 */}
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              onMouseDown={imageZoom > 1 ? handleImageMouseDown : stopPropagation}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onMouseLeave={handleImageMouseUp}
              style={{ cursor: imageZoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
            >
              <div
                style={{
                  transform: `scale(${imageZoom}) translate(${imagePan.x / imageZoom}px, ${imagePan.y / imageZoom}px)`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                }}
              >
                <div className="relative" style={{ width: imageDisplaySize.width, height: imageDisplaySize.height }}>
                  {currentImageUrl && (
                    <img src={currentImageUrl} alt="编辑" className="absolute top-0 left-0 w-full h-full object-contain rounded" crossOrigin="anonymous" draggable={false} />
                  )}
                  <canvas
                    ref={canvasRef}
                    className={`absolute top-0 left-0 w-full h-full ${currentModelSupportsMask ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
                    style={{ width: imageDisplaySize.width, height: imageDisplaySize.height }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                  />
                  {!currentModelSupportsMask && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded pointer-events-none">
                      <div className="flex flex-col items-center gap-1.5 px-4 py-3 bg-[#1a1a1a]/90 rounded-lg border border-[#2a2a2a]">
                        <Lock className="h-5 w-5 text-[#888]" />
                        <span className="text-xs text-[#888]">此模型不支持区域涂抹</span>
                        <span className="text-xs text-[#d4af37] font-medium">文字描述即可智能修图</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* 图片尺寸信息 */}
            <div className="absolute bottom-2 left-2 text-[10px] text-[#555] bg-[#0d0d0d]/70 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">
              {imageNaturalSize.width} × {imageNaturalSize.height}
            </div>
          </div>

          {/* 画笔工具 - 仅支持蒙版时显示 */}
          {currentModelSupportsMask && (
            <div className="flex items-center gap-2 px-1" onClick={stopPropagation}>
              <button onClick={(e) => { e.stopPropagation(); setTool('brush'); }} className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-all ${tool === 'brush' ? 'bg-[#d4af37] text-black font-medium' : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'}`}>
                <Pencil className="h-3.5 w-3.5" />画笔
              </button>
              <button onClick={(e) => { e.stopPropagation(); setTool('eraser'); }} className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-all ${tool === 'eraser' ? 'bg-[#d4af37] text-black font-medium' : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'}`}>
                <Eraser className="h-3.5 w-3.5" />橡皮
              </button>
              <button onClick={(e) => { e.stopPropagation(); clearMask(); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a] transition-all">
                <Trash2 className="h-3.5 w-3.5" />清除
              </button>
              <div className="flex-1" />
              <span className="text-[10px] text-[#666]">笔触</span>
              <input type="range" min="10" max="50" value={brushSize} onChange={(e) => { e.stopPropagation(); setBrushSize(Number(e.target.value)); }} className="w-16 h-1 bg-[#2a2a2a] rounded appearance-none cursor-pointer accent-[#d4af37]" />
              <span className="text-[10px] text-[#d4af37] font-mono w-5">{brushSize}</span>
            </div>
          )}

          {/* 编辑指令输入 */}
          <div onClick={stopPropagation}>
            <textarea
              value={prompt}
              onChange={(e) => { e.stopPropagation(); setPrompt(e.target.value); }}
              onKeyDown={(e) => { e.stopPropagation(); handleKeyDown(e); }}
              placeholder="描述修改内容，如：把背景换成日落..."
              className="w-full h-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none resize-none transition-colors"
            />
            <p className="text-[10px] text-[#555] mt-1">Enter 提交 · Shift+Enter 换行</p>
          </div>

          {/* 图片模型选择 */}
          <div onClick={stopPropagation}>
            <label className="text-[11px] text-[#888] mb-1.5 block font-medium">图片模型</label>
            <button
              onClick={(e) => { e.stopPropagation(); setModelListExpanded(!modelListExpanded); }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-xs text-[#ccc] hover:border-[#d4af37] transition-all"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#d4af37]" />
                {serverModels.find(m => `${m.providerId}::${m.id}` === selectedModelId)?.name || '选择模型'}
                {currentModelSupportsMask
                  ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">支持涂抹</span>
                  : <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#d4af37]/15 text-[#d4af37]">文字修图</span>
                }
              </span>
              {modelListExpanded ? <ChevronUp size={14} className="text-[#888]" /> : <ChevronDown size={14} className="text-[#888]" />}
            </button>
            {modelListExpanded && (
              <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                {serverModels.length > 0 ? serverModels.map(model => {
                  const key = `${model.providerId}::${model.id}`;
                  const isSelected = selectedModelId === key;
                  const supportsMask = !model.id.toLowerCase().includes('gemini');
                  return (
                    <button
                      key={key}
                      onClick={(e) => { e.stopPropagation(); setSelectedModelId(key); setModelListExpanded(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
                        isSelected ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{model.name}</div>
                        <div className="text-[10px] text-[#666] mt-0.5">{model.providerName} · {supportsMask ? '支持区域涂抹' : '文字描述智能修图'}</div>
                      </div>
                      {isSelected && <Check size={14} className="text-[#d4af37] flex-shrink-0" />}
                    </button>
                  );
                }) : (
                  <div className="px-3 py-4 text-center text-[11px] text-[#666]">管理员系统中暂无可用图片模型</div>
                )}
              </div>
            )}
          </div>

          {/* LLM模型选择 */}
          <div onClick={stopPropagation}>
            <label className="text-[11px] text-[#888] mb-1.5 block font-medium flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" />
              LLM 辅助模型
            </label>
            <button
              onClick={(e) => { e.stopPropagation(); setLLMListExpanded(!llmListExpanded); }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-xs text-[#ccc] hover:border-[#d4af37] transition-all"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#6366f1]" />
                {selectedLLMId
                  ? (llmModels.find(m => `${m.providerId}::${m.id}` === selectedLLMId)?.name || '选择LLM')
                  : '选择LLM模型（可选）'}
              </span>
              {llmListExpanded ? <ChevronUp size={14} className="text-[#888]" /> : <ChevronDown size={14} className="text-[#888]" />}
            </button>
            {llmListExpanded && (
              <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                {llmModels.length > 0 ? llmModels.map(model => {
                  const key = `${model.providerId}::${model.id}`;
                  const isSelected = selectedLLMId === key;
                  return (
                    <button
                      key={key}
                      onClick={(e) => { e.stopPropagation(); setSelectedLLMId(key); setLLMListExpanded(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
                        isSelected ? 'bg-[#6366f1]/15 text-[#6366f1]' : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{model.name}</div>
                        <div className="text-[10px] text-[#666] mt-0.5">{model.providerName}</div>
                      </div>
                      {isSelected && <Check size={14} className="text-[#6366f1] flex-shrink-0" />}
                    </button>
                  );
                }) : (
                  <div className="px-3 py-4 text-center text-[11px] text-[#666]">管理员系统中暂无可用LLM模型</div>
                )}
              </div>
            )}
          </div>

          {/* 参数行 */}
          <div className="grid grid-cols-3 gap-2" onClick={stopPropagation}>
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">画面比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}
                className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">图片质量</label>
              <select
                value={quality}
                onChange={(e) => { e.stopPropagation(); setQuality(e.target.value); }}
                className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">生图数量</label>
              <select
                value={outputCount}
                onChange={(e) => { e.stopPropagation(); setOutputCount(Number(e.target.value)); }}
                className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {COUNTS.map(c => <option key={c} value={c}>{c}张</option>)}
              </select>
            </div>
          </div>

          {/* 错误 */}
          {error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* 生成按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
            disabled={isLoading || !prompt.trim() || !selectedModelId}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />修改中...</>
            ) : (
              <><Sparkles className="h-4 w-4" />开始修改</>
            )}
          </button>

          {/* 编辑历史 */}
          {history.length > 0 && (
            <div className="pt-2 border-t border-[#2a2a2a]" onClick={stopPropagation}>
              <div className="flex items-center gap-1.5 text-[11px] text-[#888] mb-1.5">
                <History className="h-3.5 w-3.5" />
                <span className="font-medium text-[#d4af37]">编辑历史</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={(e) => { e.stopPropagation(); handleHistoryClick(index); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] transition-all flex items-center gap-1.5 ${
                      index === currentHistoryIndex
                        ? 'bg-[#d4af37]/20 text-[#d4af37]'
                        : 'bg-[#1a1a1a] text-[#888] hover:text-white'
                    }`}
                  >
                    <span>#{index + 1}</span>
                    <span className="truncate flex-1">{item.prompt}</span>
                    {index === currentHistoryIndex && <Check className="h-3 w-3 text-[#d4af37] flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 结果框 - 编辑器右侧 */}
      {(isResultLoading || resultImages.length > 0) && (
        <div
          ref={resultContainerRef}
          className="absolute w-[280px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
          style={{ left: resultLeft, top: resultTop, maxHeight: '90vh', pointerEvents: 'auto' }}
          onWheel={stopPropagation}
          onMouseDown={stopPropagation}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-medium text-white flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#d4af37]" />
              修图结果
            </h3>
            {resultImages.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleConfirmResult(); }}
                className="px-2.5 py-1 text-[10px] bg-[#d4af37] hover:bg-[#daa520] text-black rounded font-medium transition-all"
              >
                确认使用
              </button>
            )}
          </div>
          <div className="p-4">
            {isResultLoading ? (
              <div className="flex flex-col items-center justify-center h-[240px] bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#d4af37]/30">
                <div className="relative w-14 h-14 mb-3">
                  <div className="absolute inset-0 border-[3px] border-[#2a2a2a] rounded-full" />
                  <div
                    className="absolute inset-0 border-[3px] border-[#d4af37] rounded-full animate-spin"
                    style={{ clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(loadingProgress / 100 * 2 * Math.PI)}% ${50 - 50 * Math.cos(loadingProgress / 100 * 2 * Math.PI)}%, 50% 50%)` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[#d4af37] text-xs font-mono">{loadingProgress}%</span>
                  </div>
                </div>
                <p className="text-xs text-[#888]">正在生成...</p>
              </div>
            ) : resultImages.length > 0 ? (
              <div className="space-y-2">
                {resultImages.map((url, idx) => (
                  <div key={idx} className="relative bg-[#1a1a1a] rounded-lg overflow-hidden cursor-pointer group" onClick={(e) => { e.stopPropagation(); handleConfirmResult(url); }}>
                    <img src={url} alt={`结果 ${idx + 1}`} className="w-full h-auto object-contain rounded-lg" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-white bg-[#d4af37] px-3 py-1.5 rounded font-medium">点击使用</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
