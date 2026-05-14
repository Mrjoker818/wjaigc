'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Eraser, Trash2, Loader2, ChevronDown, Check, Sparkles, History, Image as ImageIcon, Lock } from 'lucide-react';
import type { CanvasImage } from './infinite-canvas';

interface EditHistoryItem {
  id: string;
  prompt: string;
  imageUrl: string;
  timestamp: number;
}

interface ImageEditorProps {
  image: CanvasImage;
  onClose: () => void;
  onConfirm: (editedImage: { url: string; prompt: string }) => void;
  // 用于计算SVG连接线位置
  editorPosition?: { x: number; y: number };
  onPositionChange?: (pos: { x: number; y: number; width: number; height: number }) => void;
}

const SIZES = [
  { value: '1024', label: '1024' },
  { value: '1536', label: '1536' },
  { value: '2048', label: '2048' },
];

const QUALITIES = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

// 支持编辑的模型列表（包含 OpenAI 和 Gemini 模型）
const EDITABLE_MODELS = [
  { value: 'gpt-image-2', label: 'GPT Image 2', provider: 'OpenAI', supportsMask: true, apiKeyPlaceholder: 'OpenAI API Key', hint: '支持区域涂抹' },
  { value: 'dall-e-3', label: 'DALL-E 3', provider: 'OpenAI', supportsMask: true, apiKeyPlaceholder: 'OpenAI API Key', hint: '支持区域涂抹' },
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana', provider: 'Google', supportsMask: false, apiKeyPlaceholder: 'Google API Key', hint: '智能修图' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro', provider: 'Google', supportsMask: false, apiKeyPlaceholder: 'Google API Key', hint: '智能修图' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2', provider: 'Google', supportsMask: false, apiKeyPlaceholder: 'Google API Key', hint: '智能修图' },
];

export function ImageEditor({ image, onClose, onConfirm, editorPosition, onPositionChange }: ImageEditorProps) {
  // 状态管理
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024');
  const [quality, setQuality] = useState('high');
  const [selectedModel, setSelectedModel] = useState('gpt-image-2');
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageUrl, setCurrentImageUrl] = useState(image.url);

  // 结果图片状态
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isResultLoading, setIsResultLoading] = useState(false);

  // 当前模型是否支持蒙版涂抹
  const currentModelSupportsMask = EDITABLE_MODELS.find(m => m.value === selectedModel)?.supportsMask ?? true;

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 280, height: 280 });
  const [canvasSize, setCanvasSize] = useState({ width: 280, height: 280 });

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState(editorPosition || { x: 100, y: 100 });

  // 监听API Key输入显示逻辑
  useEffect(() => {
    const model = EDITABLE_MODELS.find(m => m.value === selectedModel);
    setShowApiKeyInput(true);
  }, [selectedModel]);

  // 初始化图片和Canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      // 计算显示尺寸（保持比例，最大280px）
      const maxSize = 280;
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

    // 设置Canvas尺寸
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    
    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [canvasSize]);

  // 通知位置变化
  useEffect(() => {
    if (containerRef.current && onPositionChange) {
      const rect = containerRef.current.getBoundingClientRect();
      onPositionChange({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [position, onPositionChange, resultImage]);

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

    if (tool === 'brush') {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [brushSize, tool]);

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (!currentModelSupportsMask) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [currentModelSupportsMask]);

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    drawLine(e);
  }, [isDrawing, drawLine]);

  // 鼠标释放
  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // 清除mask
  const clearMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // 导出mask（涂抹区域=白色，未涂抹=透明）
  const exportMask = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 创建临时Canvas存储结果
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // 获取原始图像数据
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

  // 处理Enter提交（Shift+Enter换行）
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [prompt]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) {
      setError('请输入编辑指令');
      return;
    }

    if (showApiKeyInput && !apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }

    setError(null);
    setIsLoading(true);
    setIsResultLoading(true);
    setResultImage(null);
    setLoadingProgress(0);

    try {
      // 获取mask（仅支持蒙版的模型且有绘制内容时）
      const maskDataUrl = currentModelSupportsMask ? exportMask() : null;

      // 模拟进度
      const progressInterval = setInterval(() => {
        setLoadingProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      const response = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: currentImageUrl,
          prompt: prompt,
          mask: maskDataUrl,
          size: `${size}x${size}`,
          quality,
          apiKey,
          model: selectedModel,
        }),
      });

      clearInterval(progressInterval);
      setLoadingProgress(100);

      const data = await response.json();

      if (data.success && data.image) {
        setIsResultLoading(false);
        setResultImage(data.image.url);
        
        // 添加到历史记录
        const newHistoryItem: EditHistoryItem = {
          id: `edit-${Date.now()}`,
          prompt: prompt,
          imageUrl: data.image.url,
          timestamp: Date.now(),
        };
        
        setHistory(prev => [...prev.slice(0, currentHistoryIndex + 1), newHistoryItem]);
        setCurrentHistoryIndex(prev => prev + 1);
        setCurrentImageUrl(data.image.url);
        
        // 清除mask
        clearMask();
      } else if (data.requiresApiKey) {
        setIsResultLoading(false);
        setError(`需要配置 API Key: ${data.error || '请输入 API Key'}`);
      } else if (data.networkError) {
        setIsResultLoading(false);
        setError(data.error || '网络连接失败');
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
  }, [prompt, apiKey, currentImageUrl, size, quality, selectedModel, showApiKeyInput, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex]);

  // 确认结果并关闭
  const handleConfirmResult = useCallback(() => {
    if (resultImage) {
      onConfirm({
        url: resultImage,
        prompt: `${image.prompt} + ${prompt}`,
      });
    }
    setPrompt('');
    setResultImage(null);
    onClose();
  }, [resultImage, prompt, image.prompt, onConfirm, onClose]);

  // 回退到历史版本
  const handleHistoryClick = useCallback((index: number) => {
    const historyItem = history[index];
    if (historyItem) {
      setCurrentImageUrl(historyItem.imageUrl);
      setCurrentHistoryIndex(index);
    }
  }, [history]);

  // 拖拽相关
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    });
  }, [isDragging, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 计算连接线终点（结果框左侧中点）
  const getResultBoxPosition = useCallback(() => {
    if (resultContainerRef.current) {
      const rect = resultContainerRef.current.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top + rect.height / 2,
      };
    }
    return {
      x: position.x + 420 + 60,
      y: position.y + 200,
    };
  }, [position, resultImage]);

  // 获取连接线起点（编辑器右侧中点）
  const getEditorConnectionPoint = useCallback(() => {
    return {
      x: position.x + 420,
      y: position.y + 200,
    };
  }, [position]);

  // 当前选中的模型配置
  const currentModelConfig = EDITABLE_MODELS.find(m => m.value === selectedModel);

  return (
    <>
      {/* SVG连接线层 */}
      {resultImage && (
        <svg
          className="fixed inset-0 pointer-events-none z-40"
          style={{ overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#d4af37" />
              <stop offset="100%" stopColor="#b8860b" />
            </linearGradient>
            <style>
              {`
                @keyframes flowAnimation {
                  from { stroke-dashoffset: 24; }
                  to { stroke-dashoffset: 0; }
                }
                .flowing-line {
                  animation: flowAnimation 0.5s linear infinite;
                }
              `}
            </style>
          </defs>
          <path
            d={`M ${getEditorConnectionPoint().x} ${getEditorConnectionPoint().y}
                C ${getEditorConnectionPoint().x + 30} ${getEditorConnectionPoint().y},
                  ${getResultBoxPosition().x - 30} ${getResultBoxPosition().y},
                  ${getResultBoxPosition().x} ${getResultBoxPosition().y}`}
            stroke="#d4af37"
            strokeWidth="2"
            fill="none"
            strokeDasharray="8 4"
            className="flowing-line"
          />
        </svg>
      )}

      {/* 主编辑器容器 - 左侧 */}
      <div
        ref={containerRef}
        className="fixed z-[200] w-[420px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
        style={{
          left: position.x,
          top: position.y,
          maxHeight: '90vh',
        }}
        onMouseMove={handleDrag}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#141414] cursor-move"
          onMouseDown={handleDragStart}
        >
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Pencil className="h-5 w-5 text-[#d4af37]" />
            语言修图
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#2a2a2a] transition-colors"
          >
            <X className="h-5 w-5 text-[#888]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[calc(90vh-140px)] overflow-y-auto">
          {/* Image Preview with Mask Canvas */}
          <div className="relative bg-[#1a1a1a] rounded-lg p-3 flex justify-center">
            <div className="relative" style={{ width: imageDisplaySize.width, height: imageDisplaySize.height }}>
              {/* Original Image */}
              {currentImageUrl && (
                <img
                  src={currentImageUrl}
                  alt="编辑图片"
                  className="absolute top-0 left-0 w-full h-full object-contain rounded"
                  crossOrigin="anonymous"
                />
              )}
              {/* Mask Canvas - 仅支持蒙版的模型可交互 */}
              <canvas
                ref={canvasRef}
                className={`absolute top-0 left-0 w-full h-full ${
                  currentModelSupportsMask ? 'cursor-crosshair' : 'cursor-not-allowed'
                }`}
                style={{ width: imageDisplaySize.width, height: imageDisplaySize.height }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
              {/* Gemini 模型蒙版禁用提示覆盖层 */}
              {!currentModelSupportsMask && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded pointer-events-none">
                  <div className="flex flex-col items-center gap-1.5 px-4 py-3 bg-[#1a1a1a]/90 rounded-lg border border-[#2a2a2a]">
                    <Lock className="h-5 w-5 text-[#888]" />
                    <span className="text-xs text-[#888] whitespace-nowrap">此模型暂不支持区域涂抹</span>
                    <span className="text-xs text-[#d4af37]">使用文字描述即可智能修图</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Drawing Tools - 仅支持蒙版的模型显示 */}
          {currentModelSupportsMask && (
            <div className="flex items-center gap-2 px-2">
              <button
                onClick={() => setTool('brush')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all ${
                  tool === 'brush'
                    ? 'bg-[#d4af37] text-black font-medium'
                    : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'
                }`}
              >
                <Pencil className="h-4 w-4" />
                画笔
              </button>
              <button
                onClick={() => setTool('eraser')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all ${
                  tool === 'eraser'
                    ? 'bg-[#d4af37] text-black font-medium'
                    : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a]'
                }`}
              >
                <Eraser className="h-4 w-4" />
                橡皮擦
              </button>
              <button
                onClick={clearMask}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a] transition-all"
              >
                <Trash2 className="h-4 w-4" />
                清除
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#888]">笔触</span>
                <input
                  type="range"
                  min="10"
                  max="50"
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-20 h-1 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-[#d4af37]"
                />
                <span className="text-xs text-[#d4af37] font-mono w-6">{brushSize}</span>
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              编辑指令
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentModelSupportsMask 
                ? "描述你想修改什么...例如：把背景换成日落海滩" 
                : "描述你想修改什么...例如：把背景换成日落海滩、给人物加上帽子"
              }
              className="w-full h-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none resize-none transition-colors"
            />
            <p className="text-xs text-[#666]">按 Enter 提交，Shift+Enter 换行</p>
          </div>

          {/* Parameters - 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            {/* Size */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
                大小
              </label>
              <div className="relative">
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
                >
                  {SIZES.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888] pointer-events-none" />
              </div>
            </div>

            {/* Quality */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
                质量
              </label>
              <div className="relative">
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm text-white appearance-none cursor-pointer focus:border-[#d4af37] focus:outline-none"
                >
                  {QUALITIES.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Model Selection - 3+2 grid */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
              模型
            </label>
            <div className="grid grid-cols-3 gap-2">
              {EDITABLE_MODELS.map(model => (
                <button
                  key={model.value}
                  onClick={() => setSelectedModel(model.value)}
                  className={`relative px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    selectedModel === model.value
                      ? 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black border border-[#d4af37]'
                      : 'bg-[#1a1a1a] text-[#888] border border-[#2a2a2a] hover:border-[#d4af37] hover:text-white'
                  }`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="truncate w-full text-center">{model.label}</span>
                    <span className={`text-[10px] ${selectedModel === model.value ? 'text-black/60' : 'text-[#555]'}`}>
                      {model.hint}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {/* 当前模型特性提示 */}
            <div className="flex items-center gap-1.5 px-1">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${currentModelSupportsMask ? 'bg-green-500' : 'bg-[#d4af37]'}`} />
              <span className="text-[10px] text-[#666]">
                {currentModelSupportsMask 
                  ? `${currentModelConfig?.provider} · 支持画笔涂抹指定修改区域` 
                  : `${currentModelConfig?.provider} · 仅文字描述，AI 智能理解修改意图`
                }
              </span>
            </div>
          </div>

          {/* API Key Input - 仅需要Key的模型显示 */}
          {showApiKeyInput && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#d4af37] uppercase tracking-wider">
                {currentModelConfig?.apiKeyPlaceholder || 'API Key'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={currentModelConfig?.provider === 'Google' ? 'AIza...' : 'sk-...'}
                className="w-full px-4 py-2.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm text-white placeholder:text-[#555] focus:border-[#d4af37] focus:outline-none transition-colors"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim() || (showApiKeyInput && !apiKey.trim())}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                修改中...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                开始修改
              </>
            )}
          </button>

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#2a2a2a]">
              <div className="flex items-center gap-2 text-xs text-[#888]">
                <History className="h-3.5 w-3.5" />
                <span className="font-medium text-[#d4af37]">编辑历史</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryClick(index)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2 ${
                      index === currentHistoryIndex
                        ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/30'
                        : 'bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a] hover:border-[#3a3a3a]'
                    }`}
                  >
                    <span className="flex-shrink-0">#{index + 1}</span>
                    <span className="truncate flex-1">{item.prompt}</span>
                    {index === currentHistoryIndex && (
                      <Check className="h-3 w-3 text-[#d4af37] flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 结果图片框 - 右侧 */}
      <div
        ref={resultContainerRef}
        className="fixed z-[200] w-[280px] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
        style={{
          left: position.x + 420 + 60,
          top: position.y,
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1a1a] to-[#141414]">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-[#d4af37]" />
            结果预览
          </h3>
          {resultImage && (
            <button
              onClick={handleConfirmResult}
              className="px-3 py-1 text-xs bg-[#d4af37] hover:bg-[#daa520] text-black rounded-lg font-medium transition-all"
            >
              确认使用
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {isResultLoading ? (
            /* 加载状态 - 显示进度动画 */
            <div className="flex flex-col items-center justify-center h-[280px] bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#d4af37]/30">
              <div className="relative w-16 h-16 mb-4">
                <div className="absolute inset-0 border-4 border-[#2a2a2a] rounded-full" />
                <div 
                  className="absolute inset-0 border-4 border-[#d4af37] rounded-full"
                  style={{
                    clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(loadingProgress / 100 * 2 * Math.PI)}% ${50 - 50 * Math.cos(loadingProgress / 100 * 2 * Math.PI)}%, 50% 50%)`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[#d4af37] text-xs font-mono">{loadingProgress}%</span>
                </div>
              </div>
              <p className="text-sm text-[#888]">正在生成图片...</p>
              <p className="text-xs text-[#666] mt-1">请稍候</p>
            </div>
          ) : resultImage ? (
            /* 成功状态 - 显示结果图片 */
            <div className="space-y-3">
              <div className="relative bg-[#1a1a1a] rounded-lg overflow-hidden">
                <img
                  src={resultImage}
                  alt="编辑结果"
                  className="w-full h-auto object-contain rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setResultImage(null);
                    setPrompt('');
                  }}
                  className="flex-1 px-3 py-2 text-sm bg-[#1a1a1a] text-[#888] hover:text-white border border-[#2a2a2a] rounded-lg transition-all"
                >
                  重新编辑
                </button>
                <button
                  onClick={handleConfirmResult}
                  className="flex-1 px-3 py-2 text-sm bg-gradient-to-r from-[#d4af37] to-[#b8860b] text-black rounded-lg font-medium transition-all"
                >
                  确认使用
                </button>
              </div>
            </div>
          ) : (
            /* 等待状态 */
            <div className="flex flex-col items-center justify-center h-[280px] bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#2a2a2a]">
              <ImageIcon className="w-12 h-12 text-[#333] mb-3" />
              <p className="text-sm text-[#666]">等待生成结果</p>
              <p className="text-xs text-[#555] mt-1">输入指令后点击开始修改</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
