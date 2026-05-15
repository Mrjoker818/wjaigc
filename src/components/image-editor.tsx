'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Eraser, Trash2, Loader2, Check, Sparkles, History, Image as ImageIcon, Lock, ChevronDown, ChevronUp, ZoomIn, ZoomOut, RotateCcw, MessageSquare } from 'lucide-react';
import type { CanvasImage } from './infinite-canvas';

interface EditHistoryItem {
  id: string;
  prompt: string;
  imageUrl: string;
  timestamp: number;
}

interface ServerModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  type?: string;
}

interface ImageEditorProps {
  image: CanvasImage;
  onClose: () => void;
  onConfirm: (editedImage: { url: string; prompt: string }) => void;
  /** 图片右侧连接点位置（画布坐标） */
  connectionPoint?: { x: number; y: number };
  /** 画面比例/质量/生图数量初始值 */
  initialAspectRatio?: string;
  initialQuality?: string;
  initialCount?: number;
  onParamsChange?: (params: { aspectRatio: string; quality: string; count: number }) => void;
}

// 画面比例选项
const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '1:2', '2:1'];
// 图片质量选项
const QUALITIES = [
  { value: 'low', label: '快速' },
  { value: 'medium', label: '中等' },
  { value: 'high', label: '高清' },
  { value: 'auto', label: '自动' },
  { value: 'standard', label: '标准' },
];
// 生图数量选项
const COUNTS = [1, 2, 3, 4];

// 图片模型到LLM模型的映射
const IMAGE_TO_LLM: Record<string, string[]> = {
  'gemini': ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  'gpt-image': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  'dall-e': ['gpt-4o', 'gpt-4o-mini'],
};
const LLM_TO_IMAGE: Record<string, string[]> = {
  'gemini': ['gemini-2.5-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'],
  'gpt': ['gpt-image-2', 'gpt-image-2'],
  'claude': ['gpt-image-2'],
};

function getModelFamily(id: string): string {
  const lid = id.toLowerCase();
  if (lid.includes('gemini')) return 'gemini';
  if (lid.includes('gpt-image') || lid.includes('dall-e')) return 'gpt-image';
  if (lid.includes('gpt') || lid.includes('o1') || lid.includes('o3') || lid.includes('o4')) return 'gpt';
  if (lid.includes('claude')) return 'claude';
  return 'unknown';
}

export function ImageEditor({ image, onClose, onConfirm, connectionPoint, initialAspectRatio, initialQuality, initialCount, onParamsChange }: ImageEditorProps) {
  // 基础状态
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio || '1:1');
  const [quality, setQuality] = useState(initialQuality || 'high');
  const [outputCount, setOutputCount] = useState(initialCount || 1);
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

  // 图片缩放
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

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

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState(() => {
    // 如果有连接点，编辑器定位在连接点右侧
    if (connectionPoint) {
      return { x: connectionPoint.x + 50, y: connectionPoint.y - 200 };
    }
    return { x: 300, y: 100 };
  });

  // 图片原始尺寸
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 512, height: 512 });

  // 从服务器加载编辑模型
  useEffect(() => {
    const loadModels = async () => {
      try {
        // 加载图片编辑模型
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

        // 加载LLM聊天模型
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

  // 图片模型改变时，自动联动LLM模型
  useEffect(() => {
    if (!selectedModelId || llmModels.length === 0) return;
    const m = serverModels.find(m => `${m.providerId}::${m.id}` === selectedModelId);
    if (!m) return;
    const family = getModelFamily(m.id);
    const targetLLMs = LLM_TO_IMAGE[family];
    if (!targetLLMs) return;
    // 如果当前LLM不在同一家族，则自动切换
    const currentLLM = llmModels.find(lm => `${lm.providerId}::${lm.id}` === selectedLLMId);
    if (currentLLM && getModelFamily(currentLLM.id) === family) return; // 已经同族
    // 找到同族的第一个LLM
    const matchLLM = llmModels.find(lm => {
      const lFamily = getModelFamily(lm.id);
      return lFamily === family;
    });
    if (matchLLM) {
      setSelectedLLMId(`${matchLLM.providerId}::${matchLLM.id}`);
    }
  }, [selectedModelId, llmModels, serverModels, selectedLLMId]);

  // LLM模型改变时，自动联动图片模型
  useEffect(() => {
    if (!selectedLLMId || serverModels.length === 0) return;
    const lm = llmModels.find(lm => `${lm.providerId}::${lm.id}` === selectedLLMId);
    if (!lm) return;
    const family = getModelFamily(lm.id);
    const targetImages = IMAGE_TO_LLM[family];
    if (!targetImages) return;
    // 如果当前图片模型不在同一家族，则自动切换
    const currentImg = serverModels.find(m => `${m.providerId}::${m.id}` === selectedModelId);
    if (currentImg && getModelFamily(currentImg.id) === family) return; // 已经同族
    // 找到同族的第一个图片模型
    const matchImg = serverModels.find(m => {
      const mFamily = getModelFamily(m.id);
      return mFamily === family || (family === 'gpt' && mFamily === 'gpt-image') || (family === 'gemini' && mFamily === 'gemini');
    });
    if (matchImg) {
      setSelectedModelId(`${matchImg.providerId}::${matchImg.id}`);
    }
  }, [selectedLLMId, serverModels, llmModels, selectedModelId]);

  // 同步参数变化
  useEffect(() => {
    onParamsChange?.({ aspectRatio, quality, count: outputCount });
  }, [aspectRatio, quality, outputCount, onParamsChange]);

  // 初始化图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageNaturalSize({ width: img.width, height: img.height });
      const maxSize = 320;
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
    if (!prompt.trim()) {
      setError('请输入编辑指令');
      return;
    }
    if (!selectedModelId) {
      setError('请选择模型');
      return;
    }

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
        prompt: `${image.prompt} + ${prompt}`,
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

  // 拖拽
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  }, [isDragging, dragOffset]);

  const handleDragEnd = useCallback(() => { setIsDragging(false); }, []);

  // 图片缩放控制
  const handleZoomIn = useCallback(() => setImageZoom(prev => Math.min(prev + 0.25, 3)), []);
  const handleZoomOut = useCallback(() => setImageZoom(prev => Math.max(prev - 0.25, 0.5)), []);
  const handleZoomReset = useCallback(() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); }, []);

  // 图片平移
  const handleImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (imageZoom <= 1) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - imagePan.x, y: e.clientY - imagePan.y });
  }, [imageZoom, imagePan]);

  const handleImageMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setImagePan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handleImageMouseUp = useCallback(() => { setIsPanning(false); }, []);

  // SVG连线端点计算
  const getLeftLineStart = useCallback(() => {
    // 图片右侧连接点 → 编辑器左侧
    if (connectionPoint) return connectionPoint;
    return { x: position.x - 40, y: position.y + 180 };
  }, [connectionPoint, position]);

  const getLeftLineEnd = useCallback(() => {
    // 编辑器左侧中心
    return { x: position.x, y: position.y + 180 };
  }, [position]);

  const getRightLineStart = useCallback(() => {
    // 编辑器右侧中心
    return { x: position.x + 420, y: position.y + 180 };
  }, [position]);

  const getRightLineEnd = useCallback(() => {
    // 结果框左侧
    return { x: position.x + 420 + 40, y: position.y + 180 };
  }, [position]);

  // 编辑器宽度
  const editorWidth = 420;

  return (
    <>
      {/* SVG连接线 - 图片连接点→编辑器 */}
      <svg className="fixed inset-0 pointer-events-none z-[199]" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="editLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#b8860b" />
          </linearGradient>
          <style>{`
            @keyframes editFlow { from { stroke-dashoffset: 16; } to { stroke-dashoffset: 0; } }
            .edit-flow-line { animation: editFlow 0.4s linear infinite; }
            @keyframes editPulse { 0%,100% { r: 6; opacity: 0.8; } 50% { r: 9; opacity: 1; } }
            .edit-connector-pulse { animation: editPulse 1.5s ease-in-out infinite; }
          `}</style>
        </defs>

        {/* 图片→编辑器 连线 */}
        <path
          d={`M ${getLeftLineStart().x} ${getLeftLineStart().y}
              C ${getLeftLineStart().x + 25} ${getLeftLineStart().y},
                ${getLeftLineEnd().x - 25} ${getLeftLineEnd().y},
                ${getLeftLineEnd().x} ${getLeftLineEnd().y}`}
          stroke="#d4af37"
          strokeWidth="2"
          fill="none"
          strokeDasharray="8 4"
          className="edit-flow-line"
        />
        {/* 连接点圆点 - 图片端 */}
        <circle cx={getLeftLineStart().x} cy={getLeftLineStart().y} r="6" fill="#d4af37" className="edit-connector-pulse" />
        <circle cx={getLeftLineStart().x} cy={getLeftLineStart().y} r="3" fill="#141414" />
        {/* 连接点圆点 - 编辑器端 */}
        <circle cx={getLeftLineEnd().x} cy={getLeftLineEnd().y} r="5" fill="#d4af37" />
        <circle cx={getLeftLineEnd().x} cy={getLeftLineEnd().y} r="2.5" fill="#141414" />

        {/* 编辑器→结果框 连线 */}
        {(isResultLoading || resultImages.length > 0) && (
          <>
            <path
              d={`M ${getRightLineStart().x} ${getRightLineStart().y}
                  C ${getRightLineStart().x + 25} ${getRightLineStart().y},
                    ${getRightLineEnd().x - 25} ${getRightLineEnd().y},
                    ${getRightLineEnd().x} ${getRightLineEnd().y}`}
              stroke="#d4af37"
              strokeWidth="2"
              fill="none"
              strokeDasharray="8 4"
              className="edit-flow-line"
            />
            <circle cx={getRightLineStart().x} cy={getRightLineStart().y} r="5" fill="#d4af37" />
            <circle cx={getRightLineStart().x} cy={getRightLineStart().y} r="2.5" fill="#141414" />
            <circle cx={getRightLineEnd().x} cy={getRightLineEnd().y} r="5" fill="#d4af37" />
            <circle cx={getRightLineEnd().x} cy={getRightLineEnd().y} r="2.5" fill="#141414" />
          </>
        )}
      </svg>

      {/* 主编辑器面板 - 放大版 */}
      <div
        ref={containerRef}
        className="fixed z-[200] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
        style={{ left: position.x, top: position.y, width: editorWidth, maxHeight: '90vh' }}
        onMouseMove={handleDrag}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Header - 可拖拽 */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#141414] cursor-move"
          onMouseDown={handleDragStart}
        >
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Pencil className="h-4 w-4 text-[#d4af37]" />
            语言修图
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#2a2a2a] transition-colors">
            <X className="h-4 w-4 text-[#888]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 max-h-[calc(90vh-50px)] overflow-y-auto">
          {/* 图片预览区 + 缩放控制 */}
          <div className="relative bg-[#1a1a1a] rounded-lg overflow-hidden" style={{ height: Math.min(360, imageDisplaySize.height * 1.15 + 40) }}>
            {/* 缩放控制条 - 右上角 */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#0d0d0d]/80 rounded-lg px-1.5 py-1 backdrop-blur-sm border border-[#2a2a2a]/50">
              <button onClick={handleZoomOut} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="缩小">
                <ZoomOut className="h-3.5 w-3.5 text-[#888]" />
              </button>
              <span className="text-[10px] text-[#d4af37] font-mono w-8 text-center">{Math.round(imageZoom * 100)}%</span>
              <button onClick={handleZoomIn} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="放大">
                <ZoomIn className="h-3.5 w-3.5 text-[#888]" />
              </button>
              <button onClick={handleZoomReset} className="p-1 rounded hover:bg-[#2a2a2a] transition-colors" title="重置">
                <RotateCcw className="h-3.5 w-3.5 text-[#888]" />
              </button>
            </div>

            {/* 图片+蒙版容器 */}
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              onMouseDown={handleImageMouseDown}
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
            <div className="absolute bottom-2 left-2 text-[10px] text-[#555] bg-[#0d0d0d]/70 px-1.5 py-0.5 rounded backdrop-blur-sm">
              {imageNaturalSize.width} × {imageNaturalSize.height}
            </div>
          </div>

          {/* 画笔工具 - 仅支持蒙版时显示 */}
          {currentModelSupportsMask && (
            <div className="flex items-center gap-2 px-1">
              <button onClick={() => setTool('brush')} className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-all ${tool === 'brush' ? 'bg-[#d4af37] text-black font-medium' : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'}`}>
                <Pencil className="h-3.5 w-3.5" />画笔
              </button>
              <button onClick={() => setTool('eraser')} className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs transition-all ${tool === 'eraser' ? 'bg-[#d4af37] text-black font-medium' : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'}`}>
                <Eraser className="h-3.5 w-3.5" />橡皮
              </button>
              <button onClick={clearMask} className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a] transition-all">
                <Trash2 className="h-3.5 w-3.5" />清除
              </button>
              <div className="flex-1" />
              <span className="text-[10px] text-[#666]">笔触</span>
              <input type="range" min="10" max="50" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-16 h-1 bg-[#2a2a2a] rounded appearance-none cursor-pointer accent-[#d4af37]" />
              <span className="text-[10px] text-[#d4af37] font-mono w-5">{brushSize}</span>
            </div>
          )}

          {/* 编辑指令输入 */}
          <div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述修改内容，如：把背景换成日落..."
              className="w-full h-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none resize-none transition-colors"
            />
            <p className="text-[10px] text-[#555] mt-1">Enter 提交 · Shift+Enter 换行</p>
          </div>

          {/* 图片模型选择 */}
          <div>
            <label className="text-[11px] text-[#888] mb-1.5 block font-medium">图片模型</label>
            <button
              onClick={() => setModelListExpanded(!modelListExpanded)}
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
                      onClick={() => { setSelectedModelId(key); setModelListExpanded(false); }}
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
          <div>
            <label className="text-[11px] text-[#888] mb-1.5 block font-medium flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" />
              LLM 辅助模型
            </label>
            <button
              onClick={() => setLLMListExpanded(!llmListExpanded)}
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
                      onClick={() => { setSelectedLLMId(key); setLLMListExpanded(false); }}
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

          {/* 参数行 - 画面比例/质量/数量 三列 */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">画面比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">图片质量</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full px-2 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-xs text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-1 block">生图数量</label>
              <select
                value={outputCount}
                onChange={(e) => setOutputCount(Number(e.target.value))}
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
            onClick={handleSubmit}
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
            <div className="pt-2 border-t border-[#2a2a2a]">
              <div className="flex items-center gap-1.5 text-[11px] text-[#888] mb-1.5">
                <History className="h-3.5 w-3.5" />
                <span className="font-medium text-[#d4af37]">编辑历史</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryClick(index)}
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

      {/* 结果框 - 右侧，SVG线连接 */}
      {(isResultLoading || resultImages.length > 0) && (
        <div
          ref={resultContainerRef}
          className="fixed z-[200] w-[280px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
          style={{ left: position.x + editorWidth + 40, top: position.y, maxHeight: '90vh' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a2a]">
            <h3 className="text-xs font-medium text-white flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#d4af37]" />
              修图结果
            </h3>
            {resultImages.length > 0 && (
              <button
                onClick={() => handleConfirmResult()}
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
                  <div key={idx} className="relative bg-[#1a1a1a] rounded-lg overflow-hidden cursor-pointer group" onClick={() => handleConfirmResult(url)}>
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
    </>
  );
}
