'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Eraser, Trash2, Loader2, Check, Sparkles, History, Image as ImageIcon, Lock, ChevronDown, ChevronUp, Hand, ZoomIn, ZoomOut, RotateCcw, Plus, Minus, Maximize2 } from 'lucide-react';
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
  supportsMask?: boolean;
}

interface ImageEditorProps {
  image: CanvasImage;
  onClose: () => void;
  onConfirm: (editedImage: { url: string; prompt: string }) => void;
  connectionStart?: { x: number; y: number };
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

// 内置模型定义（保留原有5个模型 + 功能说明）
const BUILT_IN_MODELS = [
  { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'OpenAI', supportsMask: true, hint: '支持全区域涂抹，蒙版精准编辑' },
  { id: 'dall-e-3', name: 'DALL-E 3', provider: 'OpenAI', supportsMask: true, hint: '支持蒙版涂抹指定修改区域' },
  { id: 'gemini-2.5-flash-image-preview', name: 'Nano Banana', provider: 'Google', supportsMask: false, hint: '文字描述即可，AI智能理解意图' },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', provider: 'Google', supportsMask: false, hint: '高精度文字修图，细节还原更好' },
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', provider: 'Google', supportsMask: false, hint: '快速文字修图，响应更快' },
];

export function ImageEditor({ image, onClose, onConfirm, connectionStart, initialAspectRatio, initialQuality, initialCount, onParamsChange }: ImageEditorProps) {
  // 状态管理
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio || '1:1');
  const [quality, setQuality] = useState(initialQuality || 'high');
  const [outputCount, setOutputCount] = useState(initialCount || 1);

  // 模型选择：使用 "builtin::<id>" 或 "server::<providerId>::<id>" 作为 key
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [modelListExpanded, setModelListExpanded] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageUrl, setCurrentImageUrl] = useState(image.url);

  // 结果图片状态
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [isResultLoading, setIsResultLoading] = useState(false);

  // 服务器模型列表（从管理员系统获取）
  const [serverModels, setServerModels] = useState<ServerModel[]>([]);
  const [llmModels, setLlmModels] = useState<ServerModel[]>([]);
  const [llmModelId, setLlmModelId] = useState<string>('');

  // 当前选中的模型是否支持蒙版
  const currentModelSupportsMask = (() => {
    if (selectedModelKey.startsWith('builtin::')) {
      const id = selectedModelKey.replace('builtin::', '');
      const m = BUILT_IN_MODELS.find(bm => bm.id === id);
      return m ? m.supportsMask : true;
    }
    if (selectedModelKey.startsWith('server::')) {
      const parts = selectedModelKey.split('::');
      const providerId = parts[1];
      const modelId = parts.slice(2).join('::');
      const m = serverModels.find(sm => sm.providerId === providerId && sm.id === modelId);
      if (!m) return true;
      if (m.supportsMask !== undefined) return m.supportsMask;
      return !m.id.toLowerCase().includes('gemini');
    }
    return true; // 默认支持
  })();

  // 图片预览区缩放/平移状态
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handlePreviewWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setPreviewZoom(prev => Math.min(5, Math.max(0.5, prev + delta)));
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    e.stopPropagation();
    setIsPanDragging(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, panX: previewPan.x, panY: previewPan.y };
  }, [isPanning, previewPan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanDragging) return;
    e.stopPropagation();
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPreviewPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, [isPanDragging]);

  const handlePanEnd = useCallback(() => {
    setIsPanDragging(false);
  }, []);

  const resetPreviewView = useCallback(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }, []);

  // 当前选中模型的名称
  const currentModelName = (() => {
    if (selectedModelKey.startsWith('builtin::')) {
      const id = selectedModelKey.replace('builtin::', '');
      return BUILT_IN_MODELS.find(bm => bm.id === id)?.name || id;
    }
    if (selectedModelKey.startsWith('server::')) {
      const parts = selectedModelKey.split('::');
      const providerId = parts[1];
      const modelId = parts.slice(2).join('::');
      const m = serverModels.find(sm => sm.providerId === providerId && sm.id === modelId);
      return m ? `${m.name}` : modelId;
    }
    return '选择模型';
  })();

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 260, height: 260 });
  const [canvasSize, setCanvasSize] = useState({ width: 260, height: 260 });

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 100, y: 100 });

  // 从服务器加载编辑模型
  useEffect(() => {
    const loadModels = async () => {
      try {
        const editRes = await fetch('/api/edit');
        if (editRes.ok) {
          const editData = await editRes.json();
          if (editData.models && Array.isArray(editData.models) && editData.models.length > 0) {
            const models: ServerModel[] = editData.models.map((m: { id: string; name: string; providerId: string; providerName: string; supportsMask?: boolean }) => ({
              id: m.id,
              name: m.name,
              providerId: m.providerId,
              providerName: m.providerName || '',
              type: 'image',
              supportsMask: m.supportsMask,
            }));
            setServerModels(models);
          }
        }
      } catch (err) {
        console.error('Failed to load edit models:', err);
      }

      // 加载LLM模型
      try {
        const llmRes = await fetch('/api/models?type=chat');
        if (llmRes.ok) {
          const llmData = await llmRes.json();
          if (llmData.models && Array.isArray(llmData.models)) {
            const models: ServerModel[] = llmData.models.map((m: { id: string; name: string; providerId: string; providerName: string }) => ({
              id: m.id,
              name: m.name,
              providerId: m.providerId,
              providerName: m.providerName || '',
              type: 'chat',
            }));
            setLlmModels(models);
          }
        }
      } catch (err) {
        console.error('Failed to load LLM models:', err);
      }
    };
    loadModels();
  }, []);

  // 初始化模型选择（优先恢复上次选择，否则默认选内置第一个）
  useEffect(() => {
    const saved = localStorage.getItem('wujie_edit_selected_model');
    if (saved) {
      setSelectedModelKey(saved);
      return;
    }
    // 默认选内置第一个
    if (BUILT_IN_MODELS.length > 0) {
      setSelectedModelKey(`builtin::${BUILT_IN_MODELS[0].id}`);
    }
  }, []);

  const handleModelSelect = useCallback((key: string) => {
    setSelectedModelKey(key);
    setModelListExpanded(false);
    localStorage.setItem('wujie_edit_selected_model', key);
  }, []);

  // 同步参数变化
  useEffect(() => {
    onParamsChange?.({ aspectRatio, quality, count: outputCount });
  }, [aspectRatio, quality, outputCount, onParamsChange]);

  // 初始化图片和Canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      const maxSize = 260;
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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
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
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
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
    if (!selectedModelKey) {
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

      // 解析模型信息
      let modelId = '';
      let providerId = '';
      let isBuiltIn = false;
      let apiKey = '';

      if (selectedModelKey.startsWith('builtin::')) {
        modelId = selectedModelKey.replace('builtin::', '');
        isBuiltIn = true;
      } else if (selectedModelKey.startsWith('server::')) {
        const parts = selectedModelKey.split('::');
        providerId = parts[1];
        modelId = parts.slice(2).join('::');
      }

      const requestBody: Record<string, unknown> = {
        image: currentImageUrl,
        prompt: prompt,
        mask: maskDataUrl,
        size: aspectRatio,
        quality,
        model: modelId,
        count: outputCount,
        llmModelId: llmModelId || undefined,
        llmProviderId: llmModels.find(m => m.id === llmModelId)?.providerId || undefined,
      };

      if (isBuiltIn) {
        // 内置模型需要用户输入API Key
        const storedKey = (window as unknown as Record<string, unknown>).__editApiKey as string | undefined;
        requestBody.apiKey = storedKey || '';
      } else {
        requestBody.providerId = providerId; // 服务器管理模型使用providerId
      }

      const response = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
        setError(`需要在管理员系统中配置 API Key`);
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
  }, [prompt, selectedModelKey, currentImageUrl, aspectRatio, quality, outputCount, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex]);

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

  // SVG连接线计算
  const getLineStart = useCallback(() => {
    if (connectionStart) return connectionStart;
    return { x: position.x, y: position.y + 140 };
  }, [connectionStart, position]);

  const getLineEnd = useCallback(() => {
    return { x: position.x, y: position.y + 20 };
  }, [position]);

  const getResultLineStart = useCallback(() => {
    return { x: position.x + 360, y: position.y + 140 };
  }, [position]);

  const getResultLineEnd = useCallback(() => {
    if (resultContainerRef.current) {
      const rect = resultContainerRef.current.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    }
    return { x: position.x + 360 + 80, y: position.y + 140 };
  }, [position, resultImages]);

  // 判断内置模型是否在服务器模型中已存在（按模型ID匹配）
  const isBuiltInAvailableOnServer = useCallback((builtinId: string) => {
    return serverModels.some(sm => sm.id === builtinId);
  }, [serverModels]);

  return (
    <>
      {/* SVG连接线 - 图片到编辑器 */}
      {connectionStart && (
        <svg className="fixed inset-0 pointer-events-none z-[199]" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="editLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#d4af37" />
              <stop offset="100%" stopColor="#b8860b" />
            </linearGradient>
            <style>{`
              @keyframes editFlow { from { stroke-dashoffset: 16; } to { stroke-dashoffset: 0; } }
              .edit-flow-line { animation: editFlow 0.4s linear infinite; }
            `}</style>
          </defs>
          <path
            d={`M ${getLineStart().x} ${getLineStart().y}
                C ${getLineStart().x} ${getLineStart().y - 40},
                  ${getLineEnd().x} ${getLineEnd().y + 40},
                  ${getLineEnd().x} ${getLineEnd().y}`}
            stroke="#d4af37"
            strokeWidth="2"
            fill="none"
            strokeDasharray="8 4"
            className="edit-flow-line"
          />
          {(isResultLoading || resultImages.length > 0) && (
            <path
              d={`M ${getResultLineStart().x} ${getResultLineStart().y}
                  C ${getResultLineStart().x + 40} ${getResultLineStart().y},
                    ${getResultLineEnd().x - 40} ${getResultLineEnd().y},
                    ${getResultLineEnd().x} ${getResultLineEnd().y}`}
              stroke="#d4af37"
              strokeWidth="2"
              fill="none"
              strokeDasharray="8 4"
              className="edit-flow-line"
            />
          )}
        </svg>
      )}

      {/* 主编辑器面板 */}
      <div
        ref={containerRef}
        className="fixed z-[200] w-[360px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
        style={{ left: position.x, top: position.y, maxHeight: '85vh' }}
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
        <div className="p-3 space-y-3 max-h-[calc(85vh-50px)] overflow-y-auto">
          {/* 图片预览 + 蒙版 + 缩放/平移 */}
          <div
            className="relative bg-[#1a1a1a] rounded-lg overflow-hidden"
            onWheel={handlePreviewWheel}
            onMouseMove={isPanning ? handlePanMove : undefined}
            onMouseUp={isPanning ? handlePanEnd : undefined}
            onMouseLeave={isPanning ? handlePanEnd : undefined}
            style={{ height: Math.min(imageDisplaySize.height + 32, 280) }}
          >
            {/* 缩放/平移工具 */}
            <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
              <button
                onClick={() => setIsPanning(!isPanning)}
                className={`p-1 rounded transition-colors ${isPanning ? 'bg-[#d4af37] text-black' : 'bg-[#2a2a2a]/80 text-[#888] hover:text-white'}`}
                title="手掌工具：拖动画面"
              >
                <Hand className="h-3 w-3" />
              </button>
              <button
                onClick={() => setPreviewZoom(prev => Math.min(5, prev + 0.25))}
                className="p-1 rounded bg-[#2a2a2a]/80 text-[#888] hover:text-white transition-colors"
                title="放大"
              >
                <Plus className="h-3 w-3" />
              </button>
              <span className="text-[9px] text-[#d4af37] font-mono px-0.5 min-w-[32px] text-center">{Math.round(previewZoom * 100)}%</span>
              <button
                onClick={() => setPreviewZoom(prev => Math.max(0.2, prev - 0.25))}
                className="p-1 rounded bg-[#2a2a2a]/80 text-[#888] hover:text-white transition-colors"
                title="缩小"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                onClick={resetPreviewView}
                className="p-1 rounded bg-[#2a2a2a]/80 text-[#888] hover:text-white transition-colors"
                title="重置视图"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>

            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              style={{ cursor: isPanning ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
              onMouseDown={isPanning ? (e) => { handlePanStart(e); } : undefined}
            >
              <div
                className="relative"
                style={{
                  width: imageDisplaySize.width * previewZoom,
                  height: imageDisplaySize.height * previewZoom,
                  transform: `translate(${previewPan.x}px, ${previewPan.y}px)`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                }}
              >
                {currentImageUrl && (
                  <img src={currentImageUrl} alt="编辑" className="absolute top-0 left-0 w-full h-full object-contain rounded" crossOrigin="anonymous" />
                )}
                <canvas
                  ref={canvasRef}
                  className={`absolute top-0 left-0 w-full h-full ${currentModelSupportsMask && !isPanning ? 'cursor-crosshair' : 'pointer-events-none'}`}
                  style={{ width: imageDisplaySize.width * previewZoom, height: imageDisplaySize.height * previewZoom }}
                  onMouseDown={!isPanning ? handleMouseDown : undefined}
                  onMouseMove={!isPanning ? handleMouseMove : undefined}
                  onMouseUp={!isPanning ? handleMouseUp : undefined}
                  onMouseLeave={!isPanning ? handleMouseUp : undefined}
                />
                {!currentModelSupportsMask && (
                  <div className="absolute bottom-1 left-1 right-1 flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-[#1a1a1a]/80 rounded border border-[#2a2a2a]">
                      <Lock className="h-3 w-3 text-[#888]" />
                      <span className="text-[9px] text-[#d4af37]">此模型不支持涂抹，文字描述即可智能修图</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 画笔工具 - 始终显示 */}
          <div className="flex items-center gap-1.5 px-1">
            <button
              onClick={() => currentModelSupportsMask && setTool('brush')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-all ${
                !currentModelSupportsMask
                  ? 'bg-[#1a1a1a] text-[#444] border border-[#1a1a1a] cursor-not-allowed'
                  : tool === 'brush'
                    ? 'bg-[#d4af37] text-black font-medium'
                    : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'
              }`}
            >
              <Pencil className="h-3 w-3" />画笔
            </button>
            <button
              onClick={() => currentModelSupportsMask && setTool('eraser')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-all ${
                !currentModelSupportsMask
                  ? 'bg-[#1a1a1a] text-[#444] border border-[#1a1a1a] cursor-not-allowed'
                  : tool === 'eraser'
                    ? 'bg-[#d4af37] text-black font-medium'
                    : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'
              }`}
            >
              <Eraser className="h-3 w-3" />橡皮
            </button>
            <button
              onClick={() => currentModelSupportsMask && clearMask()}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-all ${
                !currentModelSupportsMask
                  ? 'bg-[#1a1a1a] text-[#444] border border-[#1a1a1a] cursor-not-allowed'
                  : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'
              }`}
            >
              <Trash2 className="h-3 w-3" />清除
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-[#666]">笔触</span>
            <input
              type="range"
              min="10"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={!currentModelSupportsMask}
              className={`w-14 h-0.5 rounded appearance-none accent-[#d4af37] ${!currentModelSupportsMask ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer bg-[#2a2a2a]'}`}
            />
            <span className={`text-[10px] font-mono w-4 ${currentModelSupportsMask ? 'text-[#d4af37]' : 'text-[#444]'}`}>{brushSize}</span>
          </div>

          {/* 编辑指令 */}
          <div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述修改内容，如：把背景换成日落..."
              className="w-full h-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none resize-none transition-colors"
            />
            <p className="text-[10px] text-[#555] mt-0.5">Enter 提交 · Shift+Enter 换行</p>
          </div>

          {/* 模型选择 - 列表形式（内置5个 + 管理员系统模型） */}
          <div>
            <button
              onClick={() => setModelListExpanded(!modelListExpanded)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-xs text-[#ccc] hover:border-[#d4af37] transition-all"
            >
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${currentModelSupportsMask ? 'bg-green-500' : 'bg-[#d4af37]'}`} />
                {currentModelName}
                {currentModelSupportsMask
                  ? <span className="text-[9px] text-green-500">支持涂抹</span>
                  : <span className="text-[9px] text-[#d4af37]">文字修图</span>
                }
              </span>
              {modelListExpanded ? <ChevronUp size={12} className="text-[#888]" /> : <ChevronDown size={12} className="text-[#888]" />}
            </button>

            {modelListExpanded && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                {/* 内置模型组 - 保留原有5个模型按钮 */}
                <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a]">内置模型</div>
                {BUILT_IN_MODELS.map(model => {
                  const key = `builtin::${model.id}`;
                  const isSelected = selectedModelKey === key;
                  const onServer = isBuiltInAvailableOnServer(model.id);
                  return (
                    <button
                      key={key}
                      onClick={() => handleModelSelect(key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
                        isSelected
                          ? 'bg-[#d4af37]/15 text-[#d4af37]'
                          : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-1.5">
                          {model.name}
                          {onServer && <span className="text-[8px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded">已接入</span>}
                        </div>
                        <div className="text-[10px] text-[#666]">{model.provider} · {model.hint}</div>
                      </div>
                      {isSelected && <Check size={12} className="text-[#d4af37] flex-shrink-0" />}
                    </button>
                  );
                })}

                {/* 服务器模型组 - 管理员系统添加的模型（排除与内置重复的） */}
                {serverModels.length > 0 && (() => {
                  const uniqueServerModels = serverModels.filter(sm =>
                    !BUILT_IN_MODELS.some(bm => bm.id === sm.id)
                  );
                  if (uniqueServerModels.length === 0) return null;
                  return (
                    <>
                      <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a]">管理员配置</div>
                      {uniqueServerModels.map(model => {
                        const key = `server::${model.providerId}::${model.id}`;
                        const isSelected = selectedModelKey === key;
                        const supportsMask = model.supportsMask !== undefined ? model.supportsMask : !model.id.toLowerCase().includes('gemini');
                        return (
                          <button
                            key={key}
                            onClick={() => handleModelSelect(key)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
                              isSelected
                                ? 'bg-[#d4af37]/15 text-[#d4af37]'
                                : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{model.name}</div>
                              <div className="text-[10px] text-[#666]">{model.providerName} · {supportsMask ? '支持区域涂抹' : '文字描述智能修图'}</div>
                            </div>
                            {isSelected && <Check size={12} className="text-[#d4af37] flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  );
                })()}

                {serverModels.length === 0 && (
                  <div className="px-3 py-3 text-center text-[10px] text-[#555]">
                    管理员系统中暂无额外模型
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 参数行 - 画面比例/质量/数量 三列 */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#888] mb-0.5 block">画面比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-0.5 block">图片质量</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#888] mb-0.5 block">生图数量</label>
              <select
                value={outputCount}
                onChange={(e) => setOutputCount(Number(e.target.value))}
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
              >
                {COUNTS.map(c => <option key={c} value={c}>{c}张</option>)}
              </select>
            </div>
          </div>

          {/* LLM 辅助模型选择 */}
          <div>
            <label className="text-[10px] text-[#888] mb-0.5 block">LLM 辅助模型</label>
            <select
              value={llmModelId}
              onChange={e => setLlmModelId(e.target.value)}
              className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[11px] text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
            >
              <option value="">不使用LLM辅助</option>
              {llmModels.map(m => (
                <option key={m.id + '|' + m.providerId} value={m.id + '|' + m.providerId}>
                  {m.name} ({m.providerName})
                </option>
              ))}
            </select>
          </div>

          {/* 错误 */}
          {error && (
            <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-[11px]">
              {error}
            </div>
          )}

          {/* 生成按钮 */}
          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim() || !selectedModelKey}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
              <div className="flex items-center gap-1.5 text-[10px] text-[#888] mb-1">
                <History className="h-3 w-3" />
                <span className="font-medium text-[#d4af37]">编辑历史</span>
              </div>
              <div className="max-h-20 overflow-y-auto space-y-0.5">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryClick(index)}
                    className={`w-full text-left px-2 py-1 rounded text-[10px] transition-all flex items-center gap-1 ${
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
          className="fixed z-[200] w-[240px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
          style={{ left: position.x + 360 + 40, top: position.y, maxHeight: '85vh' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2a]">
            <h3 className="text-[11px] font-medium text-white flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-[#d4af37]" />
              修图结果
            </h3>
            {resultImages.length > 0 && (
              <button
                onClick={() => handleConfirmResult()}
                className="px-2 py-0.5 text-[10px] bg-[#d4af37] hover:bg-[#daa520] text-black rounded font-medium transition-all"
              >
                确认使用
              </button>
            )}
          </div>
          <div className="p-3">
            {isResultLoading ? (
              <div className="flex flex-col items-center justify-center h-[200px] bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#d4af37]/30">
                <div className="relative w-12 h-12 mb-3">
                  <div className="absolute inset-0 border-3 border-[#2a2a2a] rounded-full" />
                  <div
                    className="absolute inset-0 border-3 border-[#d4af37] rounded-full animate-spin"
                    style={{ clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(loadingProgress / 100 * 2 * Math.PI)}% ${50 - 50 * Math.cos(loadingProgress / 100 * 2 * Math.PI)}%, 50% 50%)` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[#d4af37] text-[10px] font-mono">{loadingProgress}%</span>
                  </div>
                </div>
                <p className="text-[11px] text-[#888]">正在生成...</p>
              </div>
            ) : resultImages.length > 0 ? (
              <div className="space-y-2">
                {resultImages.map((url, idx) => (
                  <div key={idx} className="relative bg-[#1a1a1a] rounded-lg overflow-hidden cursor-pointer group" onClick={() => handleConfirmResult(url)}>
                    <img src={url} alt={`结果 ${idx + 1}`} className="w-full h-auto object-contain rounded-lg" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white bg-[#d4af37] px-2 py-1 rounded">点击使用</span>
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
