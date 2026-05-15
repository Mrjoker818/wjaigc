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
  onEditStart?: () => void;
  canvasScale?: number;
}

// ==================== 编辑模型支持蒙版判断 ====================
const MODELS_SUPPORT_MASK = ['gpt-image-2'];

export default function ImageEditor({ image, onClose, onConfirm, canvasScale = 1, onEditStart }: ImageEditorProps) {
  // === 基础状态 ===
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResultLoading, setIsResultLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);

  // === 当前编辑图片（历史切换时变化）===
  const [currentImageUrl, setCurrentImageUrl] = useState(image.url);

  // === 模型 ===
  const [editModels, setEditModels] = useState<ServerModel[]>([]);
  const [llmModels, setLlmModels] = useState<ServerModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [selectedLlmModelId, setSelectedLlmModelId] = useState('');
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);

  // === 参数 ===
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState('high');
  const [outputCount, setOutputCount] = useState(1);

  // === 蒙版 ===
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [isEraser, setIsEraser] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // === 图片缩放 ===
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showHand, setShowHand] = useState(false);

  // === 折叠 ===
  const [showLlm, setShowLlm] = useState(false);
  const [showParams, setShowParams] = useState(false);

  // 计算属性
  const currentModelSupportsMask = selectedModelId ? MODELS_SUPPORT_MASK.some(m => selectedModelId.includes(m)) : false;
  const imageDisplaySize = { width: 340, height: Math.min(280, 340 / (image.originalWidth && image.originalHeight ? image.originalWidth / image.originalHeight : 1)) };

  // === 加载模型 ===
  useEffect(() => {
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        const [editRes, llmRes] = await Promise.all([
          fetch('/api/edit'),
          fetch('/api/models?type=chat'),
        ]);
        const editData = await editRes.json();
        const llmData = await llmRes.json();

        if (editData.models) {
          setEditModels(editData.models);
          if (editData.models.length > 0) {
            setSelectedModelId(editData.models[0].id);
            setProviderId(editData.models[0].providerId);
            setModelId(editData.models[0].id);
          }
        }
        if (llmData.models) {
          setLlmModels(llmData.models);
          if (llmData.models.length > 0) {
            setSelectedLlmModelId(llmData.models[0].id);
            setSelectedLlmProviderId(llmData.models[0].providerId || '');
          }
        }
      } catch (e) {
        console.error('Failed to load models:', e);
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, []);

  // 选择图片模型
  const handleSelectEditModel = useCallback((model: ServerModel) => {
    setSelectedModelId(model.id);
    setProviderId(model.providerId);
    setModelId(model.id);
  }, []);

  // 选择LLM模型
  const handleSelectLlmModel = useCallback((model: ServerModel) => {
    setSelectedLlmModelId(model.id);
    setSelectedLlmProviderId(model.providerId || '');
  }, []);

  // === 蒙版相关 ===
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
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hasContent = false;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 0) { hasContent = true; break; }
    }
    return hasContent ? canvas.toDataURL('image/png') : null;
  }, []);

  // 画布事件
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentModelSupportsMask) return;
    e.stopPropagation();
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,0.6)';
    ctx.fill();
  }, [currentModelSupportsMask, brushSize, isEraser]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,0.6)';
    ctx.fill();
  }, [isDrawing, brushSize, isEraser]);

  const handleCanvasMouseUp = useCallback(() => { setIsDrawing(false); }, []);

  // === 提交编辑 ===
  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && !currentModelSupportsMask) return;
    setIsLoading(true);
    setIsResultLoading(true);
    setError(null);
    setLoadingProgress(0);
    onEditStart?.();

    const progressInterval = setInterval(() => {
      setLoadingProgress(prev => Math.min(prev + 3, 92));
    }, 400);

    try {
      const maskDataUrl = currentModelSupportsMask ? exportMask() : null;

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
  }, [prompt, selectedModelId, currentImageUrl, aspectRatio, quality, outputCount, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex, modelId, providerId]);

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

  // 图片缩放
  const handleZoomIn = useCallback(() => setImageZoom(prev => Math.min(prev + 0.25, 3)), []);
  const handleZoomOut = useCallback(() => setImageZoom(prev => Math.max(prev - 0.25, 0.5)), []);
  const handleZoomReset = useCallback(() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); setShowHand(false); }, []);

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

  const handleImageWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setImageZoom(prev => {
      const next = Math.round((prev + delta) * 100) / 100;
      if (next > 1) setShowHand(true);
      else { setShowHand(false); setImagePan({ x: 0, y: 0 }); }
      return Math.max(0.5, Math.min(3, next));
    });
  }, []);

  const stopPropagation = useCallback((e: React.UIEvent) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }, []);

  // 参数预设
  const aspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
  const qualities = [
    { value: 'low', label: '标准' },
    { value: 'medium', label: '高清' },
    { value: 'high', label: '超清' },
  ];
  const counts = [1, 2, 3];

  // ===================== 渲染 =====================
  return (
    <div
      ref={containerRef}
      className="bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
      style={{ width: 380, maxHeight: 520 * canvasScale, pointerEvents: 'auto' }}
      onWheel={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseMove={stopPropagation}
      onMouseUp={stopPropagation}
    >
      {/* Header - 不可拖拽区域 */}
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
      <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto" onWheel={stopPropagation}>
        {/* 图片预览区 */}
        <div
          className="relative bg-[#1a1a1a] rounded-lg overflow-hidden"
          style={{ height: imageDisplaySize.height }}
          onWheel={handleImageWheel}
          onMouseMove={handleImageMouseMove}
          onMouseUp={handleImageMouseUp}
          onMouseLeave={handleImageMouseUp}
        >
          {/* 缩放控制 */}
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

          {/* 小手标志 */}
          {showHand && !isPanning && (
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-[#0d0d0d]/80 rounded-lg px-2 py-1 backdrop-blur-sm border border-[#2a2a2a]/50 cursor-grab"
              onMouseDown={handleImageMouseDown}
            >
              <Hand className="h-3.5 w-3.5 text-[#d4af37]" />
              <span className="text-[10px] text-[#888]">拖拽移动</span>
            </div>
          )}

          {/* 图片 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ cursor: isPanning ? 'grabbing' : showHand ? 'grab' : 'default' }}
            onMouseDown={showHand ? handleImageMouseDown : undefined}
          >
            <img
              src={currentImageUrl}
              alt="edit"
              className="max-w-full max-h-full object-contain select-none"
              style={{ transform: `scale(${imageZoom}) translate(${imagePan.x / imageZoom}px, ${imagePan.y / imageZoom}px)`, transformOrigin: 'center' }}
              draggable={false}
            />
          </div>

          {/* 蒙版画布 */}
          {currentModelSupportsMask && (
            <canvas
              ref={canvasRef}
              width={imageDisplaySize.width}
              height={imageDisplaySize.height}
              className="absolute inset-0 z-5"
              style={{ cursor: isEraser ? 'cell' : 'crosshair', opacity: 0.7 }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          )}

          {/* Gemini不支持蒙版提示 */}
          {!currentModelSupportsMask && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 pointer-events-none">
              <div className="bg-black/70 rounded-xl px-5 py-4 text-center backdrop-blur-sm border border-[#2a2a2a]/40">
                <Lock className="h-6 w-6 text-[#666] mx-auto mb-2" />
                <p className="text-[#d4af37] text-xs font-medium">此模型不支持区域涂抹</p>
                <p className="text-[#999] text-[10px] mt-1">文字描述即可智能修图</p>
              </div>
            </div>
          )}

          {/* 画笔工具条 */}
          {currentModelSupportsMask && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-[#0d0d0d]/90 rounded-lg px-3 py-1.5 border border-[#2a2a2a]/50" onClick={stopPropagation}>
              <button onClick={(e) => { e.stopPropagation(); setIsEraser(false); }} className={`p-1 rounded ${!isEraser ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-[#888] hover:text-white'} transition-colors`} title="画笔">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setIsEraser(true); }} className={`p-1 rounded ${isEraser ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-[#888] hover:text-white'} transition-colors`} title="橡皮擦">
                <Eraser className="h-3.5 w-3.5" />
              </button>
              <div className="w-px h-4 bg-[#2a2a2a]" />
              <input type="range" min="5" max="50" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-14 h-1 accent-[#d4af37]" />
              <span className="text-[10px] text-[#888] w-5">{brushSize}</span>
              <div className="w-px h-4 bg-[#2a2a2a]" />
              <button onClick={(e) => { e.stopPropagation(); clearMask(); }} className="p-1 rounded text-[#888] hover:text-white transition-colors" title="清除">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* 提示词输入 */}
        <div className="space-y-1">
          <p className="text-[10px] text-[#666]">描述修改内容，如：把背景换成日落...</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入修改描述..."
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#d4af37]/50 resize-none"
            rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          />
          <p className="text-[9px] text-[#555]">Enter 提交、Shift+Enter 换行</p>
        </div>

        {/* 图片模型选择 */}
        <div className="space-y-1">
          <p className="text-[10px] text-[#666] flex items-center gap-1">
            <ImageIcon className="h-3 w-3" /> 修图模型
          </p>
          <div className="relative">
            <select
              value={`${selectedModelId}|${providerId}`}
              onChange={(e) => {
                const [id, pid] = e.target.value.split('|');
                setSelectedModelId(id);
                setProviderId(pid);
                setModelId(id);
              }}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none cursor-pointer"
              disabled={modelsLoading}
            >
              {modelsLoading && <option>加载中...</option>}
              {editModels.map((m) => (
                <option key={`${m.id}|${m.providerId}`} value={`${m.id}|${m.providerId}`}>
                  {m.name} ({m.providerName})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888] pointer-events-none" />
          </div>
        </div>

        {/* LLM 辅助模型（折叠） */}
        <div>
          <button
            className="flex items-center gap-1 text-[10px] text-[#666] hover:text-[#999] transition-colors"
            onClick={(e) => { e.stopPropagation(); setShowLlm(!showLlm); }}
          >
            <MessageSquare className="h-3 w-3" />
            LLM 辅助模型
            {showLlm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showLlm && (
            <div className="mt-1 relative">
              <select
                value={`${selectedLlmModelId}|${selectedLlmProviderId}`}
                onChange={(e) => {
                  const [id, pid] = e.target.value.split('|');
                  setSelectedLlmModelId(id);
                  setSelectedLlmProviderId(pid);
                }}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#d4af37]/50 appearance-none cursor-pointer"
                disabled={modelsLoading}
              >
                {modelsLoading && <option>加载中...</option>}
                {llmModels.map((m) => (
                  <option key={`${m.id}|${m.providerId}`} value={`${m.id}|${m.providerId}`}>
                    {m.name} ({m.providerName})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888] pointer-events-none" />
            </div>
          )}
        </div>

        {/* 参数（折叠） */}
        <div>
          <button
            className="flex items-center gap-1 text-[10px] text-[#666] hover:text-[#999] transition-colors"
            onClick={(e) => { e.stopPropagation(); setShowParams(!showParams); }}
          >
            参数设置
            {showParams ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showParams && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[9px] text-[#666] mb-1">画面比例</p>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white focus:outline-none appearance-none">
                  {aspectRatios.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[9px] text-[#666] mb-1">图片质量</p>
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white focus:outline-none appearance-none">
                  {qualities.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[9px] text-[#666] mb-1">生图数量</p>
                <select value={outputCount} onChange={(e) => setOutputCount(Number(e.target.value))} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-[10px] text-white focus:outline-none appearance-none">
                  {counts.map(c => <option key={c} value={c}>{c}张</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* 提交按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
          disabled={isLoading || (!prompt.trim() && !currentModelSupportsMask)}
          className="w-full bg-[#d4af37] hover:bg-[#c9a231] disabled:opacity-40 disabled:cursor-not-allowed text-[#141414] font-semibold rounded-lg py-2.5 text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> 修改中 {loadingProgress}%</>
          ) : (
            <><Sparkles className="h-4 w-4" /> 开始修改</>
          )}
        </button>

        {/* 历史记录 */}
        {history.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-[#666] flex items-center gap-1">
              <History className="h-3 w-3" /> 修改历史 ({history.length})
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {history.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={(e) => { e.stopPropagation(); handleHistoryClick(idx); }}
                  className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-colors ${idx === currentHistoryIndex ? 'border-[#d4af37]' : 'border-[#2a2a2a] hover:border-[#555]'}`}
                >
                  <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 返回结果给外部 */}
      {/* 结果确认 - 在底部 */}
      {resultImages.length > 0 && (
        <div className="border-t border-[#2a2a2a] px-4 py-3 space-y-2">
          <p className="text-[10px] text-[#666]">修图结果</p>
          <div className="flex gap-1.5 overflow-x-auto">
            {resultImages.map((url, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); handleConfirmResult(url); }}
                className="shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-[#2a2a2a] hover:border-[#d4af37] transition-colors relative group"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Check className="h-4 w-4 text-[#d4af37]" />
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleConfirmResult(); }}
            className="w-full bg-[#2a2a2a] hover:bg-[#333] text-white rounded-lg py-1.5 text-xs flex items-center justify-center gap-1 transition-colors"
          >
            <Check className="h-3.5 w-3.5" /> 使用此结果
          </button>
        </div>
      )}
    </div>
  );
}
