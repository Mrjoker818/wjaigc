'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Pencil, Eraser, Trash2, Loader2, Check, Sparkles, History, Image as ImageIcon, Lock, ChevronDown, ChevronUp, Hand, Plus, Minus, Maximize2, GripVertical, Upload } from 'lucide-react';
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

/** 参考图条目 */
interface ReferenceImage {
  id: string;
  url: string;
  prompt?: string;
}

interface ImageEditorProps {
  image: CanvasImage | null;
  onClose: () => void;
  onConfirm: (editedImage: { url: string; prompt: string; aspectRatio?: string }) => void;
  /** 画布上的所有图片，用于选择参考图 */
  canvasImages?: CanvasImage[];
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

// 模型功能描述映射（按模型ID关键词匹配，全兼容模式）
const MODEL_HINTS: Record<string, string> = {
  'gpt-image-2': '高精度修图，AI智能理解编辑意图',
  'dall-e-3': '文字描述修图，创意风格变换',
  'gemini-2.5-flash-image': '快速文字修图，响应更快',
  'gemini-3-pro-image': '高精度文字修图，细节还原更好',
  'gemini-3.1-flash-image': '快速文字修图，平衡速度与质量',
};

function getModelHint(modelId: string): string {
  for (const [key, hint] of Object.entries(MODEL_HINTS)) {
    if (modelId.includes(key)) return hint;
  }
  return '';
}

export function ImageEditor({ image, onClose, onConfirm, canvasImages, connectionStart, initialAspectRatio, initialQuality, initialCount, onParamsChange }: ImageEditorProps) {
  // 状态管理
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio || '1:1');
  const [quality, setQuality] = useState(initialQuality || 'high');
  const [outputCount, setOutputCount] = useState(initialCount || 1);

  // 模型选择：使用 "server::<providerId>::<modelId>" 作为 key
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [modelListExpanded, setModelListExpanded] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageUrl, setCurrentImageUrl] = useState(image?.url || '');

  // 结果图片状态
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [isResultLoading, setIsResultLoading] = useState(false);

  // 服务器模型列表（从管理员系统获取）
  const [imageModels, setImageModels] = useState<ServerModel[]>([]);
  const [llmModels, setLlmModels] = useState<ServerModel[]>([]);
  const [selectedLlmKey, setSelectedLlmKey] = useState('');
  const [llmListExpanded, setLlmListExpanded] = useState(false);

  // ★ 多图参考模式
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [refPickerOpen, setRefPickerOpen] = useState(false); // 从画布选择参考图弹窗
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当前选中的图像模型
  const currentImageModel = (() => {
    if (!selectedModelKey.startsWith('server::')) return null;
    const parts = selectedModelKey.split('::');
    const providerId = parts[1];
    const modelId = parts.slice(2).join('::');
    return imageModels.find(m => m.providerId === providerId && m.id === modelId) || null;
  })();

  // 当前选中的图像模型是否支持蒙版
  // 全兼容模式：仅 OpenAI 官方端点 + gpt-image/dall-e 模型支持 mask
  // 第三方代理（APImart/302等）即使模型名是 gpt-image-2 也不支持 mask
  const currentModelSupportsMask = (() => {
    if (!currentImageModel) return false;
    if (currentImageModel.supportsMask !== undefined) return currentImageModel.supportsMask;
    // 降级判断：仅 OpenAI 官方模型支持 mask
    const id = currentImageModel.id.toLowerCase();
    return (id.includes('gpt-image') || id.includes('dall-e')) && !currentImageModel.providerName.toLowerCase().includes('apimart') && !currentImageModel.providerName.includes('302');
  })();

  // 当前选中的图像模型名称
  const currentModelName = currentImageModel
    ? `${currentImageModel.name}${imageModels.filter(m => m.id === currentImageModel.id).length > 1 ? ` (${currentImageModel.providerName})` : ''}`
    : '选择图像模型';

  // 当前选中的LLM模型
  const currentLlmModel = (() => {
    if (!selectedLlmKey) return null;
    const parts = selectedLlmKey.split('::');
    const providerId = parts[1];
    const modelId = parts.slice(2).join('::');
    return llmModels.find(m => m.providerId === providerId && m.id === modelId) || null;
  })();

  const currentLlmModelName = currentLlmModel
    ? `${currentLlmModel.name}${llmModels.filter(m => m.id === currentLlmModel.id).length > 1 ? ` (${currentLlmModel.providerName})` : ''}`
    : '选择LLM模型';

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

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 260, height: 260 });
  const [canvasSize, setCanvasSize] = useState({ width: 260, height: 260 });

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 100, y: 100 });

  // ★ 参考图拖拽排序状态
  const [dragRefIdx, setDragRefIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 从服务器加载模型
  useEffect(() => {
    const loadModels = async () => {
      // 加载图像编辑模型
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
            setImageModels(models);
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
          // 从 providers 列表构建 providerId → providerName 映射
          const providerNameMap: Record<string, string> = {};
          if (llmData.providers && Array.isArray(llmData.providers)) {
            for (const p of llmData.providers) {
              if (p.id && p.name) providerNameMap[p.id] = p.name;
            }
          }
          if (llmData.models && Array.isArray(llmData.models)) {
            const models: ServerModel[] = llmData.models.map((m: { id: string; name: string; providerId: string }) => ({
              id: m.id,
              name: m.name,
              providerId: m.providerId,
              providerName: providerNameMap[m.providerId] || m.providerId,
              type: 'chat' as const,
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

  // 初始化模型选择（优先恢复上次选择，否则默认选第一个）
  useEffect(() => {
    if (imageModels.length === 0) return;
    const saved = localStorage.getItem('wujie_edit_selected_model');
    if (saved && imageModels.some(m => `server::${m.providerId}::${m.id}` === saved)) {
      setSelectedModelKey(saved);
      return;
    }
    setSelectedModelKey(`server::${imageModels[0].providerId}::${imageModels[0].id}`);
  }, [imageModels]);

  // 初始化LLM模型选择
  useEffect(() => {
    if (llmModels.length === 0) return;
    const saved = localStorage.getItem('wujie_edit_selected_llm');
    if (saved && llmModels.some(m => `server::${m.providerId}::${m.id}` === saved)) {
      setSelectedLlmKey(saved);
      return;
    }
    setSelectedLlmKey(`server::${llmModels[0].providerId}::${llmModels[0].id}`);
  }, [llmModels]);

  const handleModelSelect = useCallback((key: string) => {
    setSelectedModelKey(key);
    setModelListExpanded(false);
    localStorage.setItem('wujie_edit_selected_model', key);
  }, []);

  const handleLlmSelect = useCallback((key: string) => {
    setSelectedLlmKey(key);
    setLlmListExpanded(false);
    localStorage.setItem('wujie_edit_selected_llm', key);
  }, []);

  // 同步参数变化
  useEffect(() => {
    onParamsChange?.({ aspectRatio, quality, count: outputCount });
  }, [aspectRatio, quality, outputCount, onParamsChange]);

  // 初始化图片和Canvas
  useEffect(() => {
    if (!currentImageUrl) return;
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
    img.src = currentImageUrl;
  }, [currentImageUrl]);

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

  // ★ 添加参考图 - 从画布选择
  const handleAddRefFromCanvas = useCallback((canvasImg: CanvasImage) => {
    if (canvasImg.id === image?.id) return; // 不能添加主图自身
    if (referenceImages.some(r => r.id === canvasImg.id)) return; // 不重复
    setReferenceImages(prev => [...prev, {
      id: canvasImg.id,
      url: canvasImg.url,
      prompt: canvasImg.prompt,
    }]);
    setRefPickerOpen(false);
  }, [image?.id, referenceImages]);

  // ★ 添加参考图 - 从本地上传
  const handleAddRefFromFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          setReferenceImages(prev => [...prev, {
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            url: dataUrl,
          }]);
        }
      };
      reader.readAsDataURL(file);
    }
    // reset input so same file can be re-selected
    e.target.value = '';
  }, []);

  // ★ 删除参考图
  const handleRemoveRef = useCallback((refId: string) => {
    setReferenceImages(prev => prev.filter(r => r.id !== refId));
  }, []);

  // ★ 参考图拖拽排序
  const handleRefDragStart = useCallback((idx: number) => {
    setDragRefIdx(idx);
  }, []);

  const handleRefDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleRefDrop = useCallback((idx: number) => {
    if (dragRefIdx === null || dragRefIdx === idx) {
      setDragRefIdx(null);
      setDragOverIdx(null);
      return;
    }
    setReferenceImages(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragRefIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragRefIdx(null);
    setDragOverIdx(null);
  }, [dragRefIdx]);

  // 可选的画布图片（排除主图和已添加的参考图）
  const availableCanvasImages = (canvasImages || []).filter(
    ci => ci.id !== image?.id && !referenceImages.some(r => r.id === ci.id)
  );

  // ★ 主图选择器（无主图时弹出）
  const [mainPickerOpen, setMainPickerOpen] = useState(false);

  // 从画布选择主图
  const handleSelectMainFromCanvas = useCallback((canvasImg: CanvasImage) => {
    setCurrentImageUrl(canvasImg.url);
    setMainPickerOpen(false);
    // 同时初始化图片尺寸
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
    img.src = canvasImg.url;
  }, []);

  // 从本地上传主图
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const handleSelectMainFromFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) {
        setCurrentImageUrl(dataUrl);
        setMainPickerOpen(false);
        // 初始化图片尺寸
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
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // 将任意图片URL转换为base64 data URL（确保服务端能处理）
  const imageToDataUrl = useCallback(async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;

    // 方法1：fetch + blob（适用于同源和CORS友好的URL）
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // CORS限制或网络错误，继续尝试其他方式
    }

    // 方法2：通过canvas绘制（适用于同源或已设置crossOrigin的图片）
    try {
      return await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas context failed')); return; }
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            reject(new Error('CORS限制'));
          }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
      });
    } catch {
      // canvas方式也失败
    }

    // 方法3：通过服务端代理下载（服务端不受CORS限制）
    try {
      const saveResp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });
      const saveData = await saveResp.json();
      if (saveData.success && saveData.url) {
        // 服务端已保存，用本地URL重新fetch
        const localResp = await fetch(saveData.url);
        if (localResp.ok) {
          const blob = await localResp.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch {
      // 服务端代理也失败
    }

    throw new Error('图片转换失败，请尝试重新上传图片');
  }, []);

  /** 压缩图片dataURL：限制最大边长 + JPEG质量压缩，大幅减小请求体体积 */
  const compressImageDataUrl = useCallback(async (
    dataUrl: string,
    maxEdge: number = 1536,
    quality: number = 0.85
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        // 仅在图片超过最大边长时缩放
        if (w > maxEdge || h > maxEdge) {
          const scale = maxEdge / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG压缩（PNG→JPEG通常可缩小10-50倍）
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl); // 压缩失败返回原图
      img.src = dataUrl;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!currentImageUrl) {
      setError('请先添加要修图的图片');
      return;
    }
    if (!prompt.trim()) {
      setError('请输入编辑指令');
      return;
    }
    if (!selectedModelKey) {
      setError('请选择图像模型');
      return;
    }

    setError(null);
    setIsLoading(true);
    setIsResultLoading(true);
    setResultImages([]);
    setLoadingProgress(0);

    try {
      // ★ 将图片URL转为base64，确保服务端可处理
      let imageAsDataUrl: string;
      try {
        imageAsDataUrl = await imageToDataUrl(currentImageUrl);
        imageAsDataUrl = await compressImageDataUrl(imageAsDataUrl); // 压缩减小体积
      } catch {
        setError('图片加载失败，请尝试重新添加图片');
        setIsLoading(false);
        setIsResultLoading(false);
        return;
      }
      const maskDataUrl = currentModelSupportsMask ? exportMask() : null;
      const progressInterval = setInterval(() => {
        setLoadingProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      // 解析图像模型信息
      const parts = selectedModelKey.split('::');
      const providerId = parts[1];
      const modelId = parts.slice(2).join('::');

      // 解析LLM模型信息
      let llmModelId = '';
      let llmProviderId = '';
      if (selectedLlmKey) {
        const llmParts = selectedLlmKey.split('::');
        llmProviderId = llmParts[1];
        llmModelId = llmParts.slice(2).join('::');
      }

      // ★ 参考图也转为base64并压缩
      const refDataUrls = referenceImages.length > 0
        ? await Promise.all(
            referenceImages.map(async r => {
              const dataUrl = await imageToDataUrl(r.url);
              return compressImageDataUrl(dataUrl);
            })
          )
        : undefined;

      // ★ 构建请求体（不含 count，单次请求只生成1张图）
      const baseRequestBody: Record<string, unknown> = {
        image: imageAsDataUrl,
        prompt: prompt,
        mask: maskDataUrl,
        size: aspectRatio,
        quality,
        model: modelId,
        providerId: providerId,
        llmModelId: llmModelId || undefined,
        llmProviderId: llmProviderId || undefined,
        referenceImages: refDataUrls,
      };

      // ★ 多图模式：并行发起 outputCount 次请求
      const requestCount = Math.max(1, Math.min(outputCount, 4));
      const fetchPromises = Array.from({ length: requestCount }, () =>
        fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseRequestBody),
        }).then(r => r.json().then(data => ({ ok: r.ok, data })))
      );

      const results = await Promise.allSettled(fetchPromises);

      clearInterval(progressInterval);
      setLoadingProgress(100);

      // ★ 收集所有成功的图片
      const collectedUrls: string[] = [];
      let firstError = '';

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { data } = result.value;
          if (data.success && data.image?.url) {
            collectedUrls.push(data.image.url);
          } else if (data.images) {
            collectedUrls.push(...data.images.map((img: { url: string }) => img.url));
          } else if (!firstError && data.error) {
            firstError = data.error;
          }
        } else {
          if (!firstError) firstError = result.reason?.message || '请求失败';
        }
      }

      setIsResultLoading(false);

      if (collectedUrls.length > 0) {
        setResultImages(collectedUrls);

        const newHistoryItem: EditHistoryItem = {
          id: `edit-${Date.now()}`,
          prompt: prompt,
          imageUrl: collectedUrls[0],
          timestamp: Date.now(),
        };
        setHistory(prev => [...prev.slice(0, currentHistoryIndex + 1), newHistoryItem]);
        setCurrentHistoryIndex(prev => prev + 1);
        setCurrentImageUrl(collectedUrls[0]);
        clearMask();

        if (collectedUrls.length < requestCount && firstError) {
          setError(`已生成 ${collectedUrls.length}/${requestCount} 张，部分失败: ${firstError}`);
        }
      } else if (firstError) {
        setError(firstError);
      } else {
        setError('编辑失败，未返回有效图片');
      }
    } catch (err: unknown) {
      setIsResultLoading(false);
      const errMsg = err instanceof Error ? err.message : '网络错误，请重试';
      console.error('Edit error:', err);
      setError(errMsg);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedModelKey, selectedLlmKey, currentImageUrl, aspectRatio, quality, outputCount, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex, referenceImages, imageToDataUrl, compressImageDataUrl]);

  const handleConfirmResult = useCallback((url?: string) => {
    const finalUrl = url || resultImages[0];
    if (finalUrl) {
      onConfirm({
        url: finalUrl,
        prompt: image?.prompt ? `${image.prompt} + ${prompt}` : prompt,
        aspectRatio,
      });
    }
    setPrompt('');
    setResultImages([]);
    onClose();
  }, [resultImages, prompt, image?.prompt, onConfirm, onClose, aspectRatio]);

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

  // 模型列表项组件
  const renderModelItem = (model: ServerModel, modelKey: string, isSelected: boolean, supportsMask?: boolean) => {
    const maskSupported = supportsMask !== undefined ? supportsMask : false;
    const hint = getModelHint(model.id);
    const hasDuplicate = imageModels.filter(m => m.id === model.id).length > 1;
    return (
      <button
        key={modelKey}
        onClick={() => handleModelSelect(modelKey)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
          isSelected
            ? 'bg-[#d4af37]/15 text-[#d4af37]'
            : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium flex items-center gap-1.5">
            {model.name}
            {hasDuplicate && <span className="text-[8px] px-1 py-0.5 bg-[#d4af37]/20 text-[#d4af37] rounded">{model.providerName}</span>}
            {maskSupported
              ? <span className="text-[8px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded">支持涂抹</span>
              : <span className="text-[8px] px-1 py-0.5 bg-[#d4af37]/20 text-[#d4af37] rounded">文字修图</span>
            }
          </div>
          <div className="text-[10px] text-[#666] truncate">{model.providerName}{hint ? ` · ${hint}` : ''}</div>
        </div>
        {isSelected && <Check size={12} className="text-[#d4af37] flex-shrink-0" />}
      </button>
    );
  };

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
          {/* 图片预览区域 - 无图时显示大+号 */}
          {!currentImageUrl ? (
            <div className="relative">
              {/* 大+号占位区域 */}
              <button
                onClick={() => setMainPickerOpen(!mainPickerOpen)}
                className="w-full h-[200px] bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#2a2a2a] hover:border-[#d4af37]/50 flex flex-col items-center justify-center gap-2 transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-[#2a2a2a] group-hover:bg-[#d4af37]/20 flex items-center justify-center transition-all">
                  <Plus className="h-6 w-6 text-[#888] group-hover:text-[#d4af37] transition-colors" />
                </div>
                <span className="text-xs text-[#555] group-hover:text-[#888] transition-colors">添加要修图的图片</span>
                <span className="text-[10px] text-[#444]">从画布选择或上传本地图片</span>
              </button>

              {/* 选择主图弹窗 */}
              {mainPickerOpen && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                  <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a] sticky top-0 bg-[#0d0d0d]">选择图片</div>
                  {/* 从画布选择 */}
                  {canvasImages && canvasImages.length > 0 && canvasImages.map(ci => (
                    <button
                      key={ci.id}
                      onClick={() => handleSelectMainFromCanvas(ci)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-[#aaa] hover:bg-[#1a1a1a] hover:text-white transition-all border-b border-[#1a1a1a] last:border-b-0"
                    >
                      <img src={ci.url} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" crossOrigin="anonymous" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[11px]">{ci.prompt || ci.url.split('/').pop() || '图片'}</div>
                        <div className="text-[9px] text-[#555]">{ci.originalWidth || 0}x{ci.originalHeight || 0}</div>
                      </div>
                      <Plus className="h-3 w-3 text-[#d4af37] flex-shrink-0" />
                    </button>
                  ))}
                  {/* 上传按钮 */}
                  <button
                    onClick={() => mainFileInputRef.current?.click()}
                    className="w-full flex items-center gap-2 px-2 py-2 text-left text-xs text-[#aaa] hover:bg-[#1a1a1a] hover:text-[#d4af37] transition-all"
                  >
                    <div className="w-8 h-8 rounded bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
                      <Upload className="h-3.5 w-3.5 text-[#888]" />
                    </div>
                    <span className="text-[11px]">上传本地图片</span>
                  </button>
                  <input
                    ref={mainFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSelectMainFromFile}
                  />
                </div>
              )}
            </div>
          ) : (
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

            {/* 主图标记 */}
            <div className="absolute top-1 left-1 z-10">
              <span className="text-[9px] px-1.5 py-0.5 bg-[#d4af37]/80 text-black rounded font-medium">原图</span>
            </div>

            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              style={{ cursor: isPanning ? (isPanDragging ? 'grabbing' : 'grab') : 'default' }}
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
                <img src={currentImageUrl} alt="编辑" className="absolute top-0 left-0 w-full h-full object-contain rounded" crossOrigin="anonymous" />
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
          )}

          {/* ★ 参考图区域 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-[#888] flex items-center gap-1">
                <ImageIcon className="h-3 w-3 text-[#d4af37]" />
                参考图
                {referenceImages.length > 0 && (
                  <span className="text-[#d4af37] font-medium">{referenceImages.length}</span>
                )}
              </span>
              <div className="flex items-center gap-1">
                {/* 从画布选择 */}
                {canvasImages && canvasImages.length > (currentImageUrl ? 1 : 0) && (
                  <button
                    onClick={() => setRefPickerOpen(!refPickerOpen)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[#aaa] hover:text-[#d4af37] hover:border-[#d4af37] transition-all"
                  >
                    <Plus className="h-2.5 w-2.5" />画布选图
                  </button>
                )}
                {/* 本地上传 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] rounded text-[#aaa] hover:text-[#d4af37] hover:border-[#d4af37] transition-all"
                >
                  <Upload className="h-2.5 w-2.5" />上传
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleAddRefFromFile}
                />
              </div>
            </div>

            {/* 参考图缩略图列表 */}
            {referenceImages.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {referenceImages.map((ref, idx) => (
                  <div
                    key={ref.id}
                    draggable
                    onDragStart={() => handleRefDragStart(idx)}
                    onDragOver={(e) => handleRefDragOver(e, idx)}
                    onDrop={() => handleRefDrop(idx)}
                    onDragEnd={() => { setDragRefIdx(null); setDragOverIdx(null); }}
                    className={`relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all cursor-grab group ${
                      dragOverIdx === idx ? 'border-[#d4af37] scale-105' :
                      dragRefIdx === idx ? 'border-[#666] opacity-50' :
                      'border-[#2a2a2a] hover:border-[#d4af37]/50'
                    }`}
                  >
                    <img src={ref.url} alt={`参考${idx + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
                    {/* 序号 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-center text-[#ccc]">
                      {idx + 1}
                    </div>
                    {/* 拖拽手柄 */}
                    <div className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="h-2.5 w-2.5 text-white drop-shadow" />
                    </div>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveRef(ref.id); }}
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 bg-red-500/80 rounded-bl-lg"
                    >
                      <X className="h-2.5 w-2.5 text-white" />
                    </button>
                    {/* prompt提示 */}
                    {ref.prompt && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center pointer-events-none">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[7px] text-white text-center px-0.5 line-clamp-2 max-h-full overflow-hidden">{ref.prompt.slice(0, 30)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-[#555] py-1.5 text-center border border-dashed border-[#2a2a2a] rounded-lg">
                添加参考图帮助AI更好理解修图意图
              </div>
            )}

            {/* 从画布选择参考图弹窗 */}
            {refPickerOpen && availableCanvasImages.length > 0 && (
              <div className="mt-1.5 max-h-32 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a] sticky top-0 bg-[#0d0d0d]">选择画布图片</div>
                {availableCanvasImages.map(ci => (
                  <button
                    key={ci.id}
                    onClick={() => handleAddRefFromCanvas(ci)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-[#aaa] hover:bg-[#1a1a1a] hover:text-white transition-all border-b border-[#1a1a1a] last:border-b-0"
                  >
                    <img src={ci.url} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" crossOrigin="anonymous" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11px]">{ci.prompt || ci.url.split('/').pop() || '图片'}</div>
                      <div className="text-[9px] text-[#555]">{ci.originalWidth || 0}x{ci.originalHeight || 0}</div>
                    </div>
                    <Plus className="h-3 w-3 text-[#d4af37] flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {refPickerOpen && availableCanvasImages.length === 0 && (
              <div className="mt-1.5 px-3 py-2 text-[10px] text-[#555] text-center border border-[#2a2a2a] rounded-lg bg-[#0d0d0d]">
                画布上没有其他可添加的图片
              </div>
            )}
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

          {/* 图像模型选择 - 统一列表（管理员系统） */}
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
                <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a]">图像模型</div>
                {imageModels.length > 0 ? imageModels.map(model => {
                  const key = `server::${model.providerId}::${model.id}`;
                  const isSelected = selectedModelKey === key;
                  return renderModelItem(model, key, isSelected, model.supportsMask);
                }) : (
                  <div className="px-3 py-3 text-center text-[10px] text-[#555]">
                    管理员系统中暂无图像模型
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LLM 辅助模型选择 - 列表形式 */}
          <div>
            <button
              onClick={() => setLlmListExpanded(!llmListExpanded)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-xs text-[#ccc] hover:border-[#d4af37] transition-all"
            >
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                {currentLlmModelName}
                <span className="text-[9px] text-blue-400">辅助理解</span>
              </span>
              {llmListExpanded ? <ChevronUp size={12} className="text-[#888]" /> : <ChevronDown size={12} className="text-[#888]" />}
            </button>

            {llmListExpanded && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
                <div className="px-2 py-1 text-[9px] text-[#666] uppercase tracking-wider border-b border-[#1a1a1a]">LLM 模型</div>
                {llmModels.length > 0 ? llmModels.map(model => {
                  const key = `server::${model.providerId}::${model.id}`;
                  const isSelected = selectedLlmKey === key;
                  const hasDuplicate = llmModels.filter(m => m.id === model.id).length > 1;
                  return (
                    <button
                      key={key}
                      onClick={() => handleLlmSelect(key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all border-b border-[#1a1a1a] last:border-b-0 ${
                        isSelected
                          ? 'bg-[#d4af37]/15 text-[#d4af37]'
                          : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-1.5">
                          {model.name}
                          {hasDuplicate && <span className="text-[8px] px-1 py-0.5 bg-blue-400/20 text-blue-400 rounded">{model.providerName}</span>}
                        </div>
                        <div className="text-[10px] text-[#666] truncate">{model.providerName} · 辅助理解修图意图</div>
                      </div>
                      {isSelected && <Check size={12} className="text-[#d4af37] flex-shrink-0" />}
                    </button>
                  );
                }) : (
                  <div className="px-3 py-3 text-center text-[10px] text-[#555]">
                    管理员系统中暂无LLM模型
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
          className="fixed z-[200] bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden"
          style={{ left: position.x + 360 + 40, top: position.y, maxHeight: '85vh', width: '280px' }}
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
              <div className="flex gap-2 overflow-x-auto pb-1">
                {Array.from({ length: Math.max(1, Math.min(outputCount, 4)) }, (_, i) => {
                  const ratioParts = aspectRatio.split(':').map(Number);
                  const ratioW = ratioParts[0] || 1;
                  const ratioH = ratioParts[1] || 1;
                  return (
                    <div key={i} className="relative bg-[#1a1a1a] rounded-lg border-2 border-dashed border-[#d4af37]/30 flex flex-col items-center justify-center overflow-hidden flex-shrink-0"
                      style={{ aspectRatio: `${ratioW}/${ratioH}`, width: outputCount > 1 ? '140px' : undefined }}
                    >
                      <div className="relative w-8 h-8 mb-1">
                        <div className="absolute inset-0 border-2 border-[#2a2a2a] rounded-full" />
                        <div className="absolute inset-0 border-2 border-[#d4af37] rounded-full animate-spin" />
                      </div>
                      <span className="text-[9px] text-[#666]">生成中 {outputCount > 1 ? `(${i + 1}/${outputCount})` : `${loadingProgress}%`}</span>
                    </div>
                  );
                })}
              </div>
            ) : resultImages.length > 0 ? (
              <div className={`flex gap-2 overflow-x-auto pb-1`}>
                {resultImages.map((url, idx) => {
                  const ratioParts = aspectRatio.split(':').map(Number);
                  const ratioW = ratioParts[0] || 1;
                  const ratioH = ratioParts[1] || 1;
                  return (
                    <div key={idx} className="relative bg-[#1a1a1a] rounded-lg overflow-hidden cursor-pointer group flex-shrink-0"
                      style={{ aspectRatio: `${ratioW}/${ratioH}`, width: resultImages.length > 1 ? '140px' : undefined }}
                      onClick={() => handleConfirmResult(url)}
                    >
                      <img src={url} alt={`结果 ${idx + 1}`} className="w-full h-full object-cover rounded-lg" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white bg-[#d4af37] px-2 py-1 rounded">点击使用</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
