'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { X, Pencil, Eraser, Trash2, Loader2, Check, Sparkles, History, Image as ImageIcon, ChevronDown, ChevronUp, Plus, Minus, Maximize2, GripVertical, Upload, RefreshCw, FileText } from 'lucide-react';
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
  apiDisplayName?: string;
}

/** 参考图条目 */
interface ReferenceImage {
  id: string;
  url: string;
  prompt?: string;
}

/** 修正常见的提供商名称拼写错误 */
function fixProviderName(name: string): string {
  if (!name) return name;
  return name
    .replace(/\bimgae\b/gi, 'image')
    .replace(/\bAPImart imgae\b/gi, 'APImart image');
}

interface ImageEditorProps {
  image: CanvasImage | null;
  onClose: () => void;
  onConfirm: (result: { url: string; prompt: string; aspectRatio?: string }) => void;
  /** 画布上的所有图片，用于选择参考图 */
  canvasImages?: CanvasImage[];
  connectionStart?: { x: number; y: number };
  initialAspectRatio?: string;
  initialQuality?: string;
  initialCount?: number;
  onParamsChange?: (params: { aspectRatio: string; quality: string; count: number }) => void;
  /** 当前主题风格 */
  themeStyle?: 'gold' | 'monochrome';
}

// 生图数量选项
const COUNTS = [1, 2, 3, 4];

// 模型功能描述映射（按模型ID关键词匹配）
// 支持涂抹 = 模型原生支持 mask 参数或通过 chat/completions 可靠理解蒙版参考图
// 不支持涂抹 = 模型无法可靠理解蒙版，仅支持文字描述修图
const MODEL_HINTS: Record<string, string> = {
  'gpt-image-2': '支持涂抹+文字修图，AI精准理解蒙版区域',
  'dall-e-3': '支持涂抹+文字修图，创意风格变换',
  'gemini-2.5-flash-image': '仅文字修图，不支持画笔涂抹',
  'gemini-3-pro-image': '仅文字修图，不支持画笔涂抹，细节还原更好',
  'gemini-3.1-flash-image': '仅文字修图，不支持画笔涂抹，平衡速度与质量',
  'flux': '支持涂抹+文字修图，高质量图像生成',
  'sdxl': '支持涂抹+文字修图，Stable Diffusion系列',
  'stable-diffusion': '支持涂抹+文字修图，Stable Diffusion系列',
};

import { getModelDisplayName } from '@/lib/model-name-map';
import { MODEL_ASPECT_RATIOS, MODEL_QUALITIES, DEFAULT_ASPECT_RATIOS, DEFAULT_QUALITIES, QUALITY_DISPLAY_NAMES, findModelConfig } from '@/lib/canvas-generation-group';
import { taskEventsClient } from '@/lib/task-events-client';
import { constrainFloatingPanelPosition, getCenteredFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport, type FloatingPanelPosition } from '@/lib/floating-panel-position';
import { getPromptTemplates, searchTemplates, type PromptTemplate } from '@/lib/prompt-templates';

function getModelHint(modelId: string): string {
  for (const [key, hint] of Object.entries(MODEL_HINTS)) {
    if (modelId.includes(key)) return hint;
  }
  return '';
}

/** 前端兜底：将纯英文 API 错误翻译为中文友好提示 */
function translateErrorFrontend(msg: string): string {
  if (!msg) return '编辑失败，请重试';
  const lower = msg.toLowerCase();
  if (lower.includes('try again later') || lower.includes('please wait')) {
    return '当前模型暂时不可用，请稍后重试或切换其他模型';
  }
  if (lower.includes('insufficient balance') || lower.includes('insufficient')) {
    return 'API 余额不足，请联系管理员充值';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '请求过于频繁，请稍后再试';
  }
  if (lower.includes('model not found')) {
    return '模型不存在或已下线，请尝试切换其他模型';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '请求超时，请稍后重试';
  }
  // 纯英文兜底
  if (/^[a-zA-Z]/.test(msg) && !/[\u4e00-\u9fff]/.test(msg)) {
    return `API 返回错误: ${msg.replace(/\s*\(request id:.*?\)\s*/i, '').trim()}`;
  }
  return msg;
}

export function ImageEditor({ image, onClose, onConfirm, canvasImages, connectionStart, initialAspectRatio, initialQuality, initialCount, onParamsChange, themeStyle = 'gold' }: ImageEditorProps) {
  // ★ 主题变量系统
  const isMonochrome = themeStyle === 'monochrome';
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  // 面板容器
  const thPanel = isMonochrome
    ? 'bg-white border-gray-200'
    : 'bg-[#1a1a1a] border-white/[0.08]';

  // 头部背景
  const thHeader = isMonochrome
    ? 'bg-gradient-to-r from-gray-50 to-white border-gray-200'
    : 'bg-gradient-to-r from-[#1a1a1a] to-[#141414] border-white/[0.08]';

  // 标题文字
  const thTitle = isMonochrome ? 'text-gray-900' : 'text-gray-100';

  // 强调色（蓝/金）
  const thAccent = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const thAccentIcon = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';

  // 强调色背景类（用于按钮高亮、选中状态）
  const thAccentBg = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const thAccentBgText = isMonochrome ? 'text-white' : 'text-black';
  const thAccentBgHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const thAccentLight = isMonochrome ? 'bg-blue-50' : 'bg-[#d4af37]/10';
  const thAccentLightText = isMonochrome ? 'text-blue-600' : 'text-[#d4af37]';
  const thAccentBorder = isMonochrome ? 'border-blue-300' : 'border-[#d4af37]';

  // 次要/背景色
  const thBg = isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]';
  const thBgDeep = isMonochrome ? 'bg-white' : 'bg-[#141414]';
  const thBgHover = isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#1a1a1a]';
  const thBorder = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const thBorderLight = isMonochrome ? 'border-gray-100' : 'border-white/[0.06]';

  // 文字色
  const thText = isMonochrome ? 'text-gray-800' : 'text-gray-100';
  const thTextSecondary = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const thTextMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const thTextDim = isMonochrome ? 'text-gray-300' : 'text-gray-600';
  const thTextPlaceholder = isMonochrome ? 'placeholder:text-gray-400' : 'placeholder:text-gray-600';

  // 输入框
  const thInput = isMonochrome
    ? 'bg-white border-gray-200 text-gray-800 focus:border-blue-400'
    : 'bg-[#111] border-white/[0.08] text-gray-100 focus:border-[#d4af37]';

  // 按钮
  const thBtnSecondary = isMonochrome
    ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
    : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-white/[0.08]';

  // 渐变主按钮
  const thBtnPrimary = isMonochrome
    ? 'bg-blue-500 hover:bg-blue-600 text-white'
    : 'bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black';

  // 关闭按钮
  const thCloseBtn = isMonochrome
    ? 'hover:bg-blue-50 text-blue-400'
    : 'hover:bg-[#2a2a2a] text-gray-400';

  // 下拉菜单
  const thDropdown = isMonochrome
    ? 'bg-white border-gray-200'
    : 'bg-[#222] border-white/[0.1]';

  // 下拉选项
  const thDropdownItem = isMonochrome
    ? 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-gray-100'
    : 'text-gray-300 hover:bg-[#2a2a2a] hover:text-white border-white/[0.06]';

  // 下拉选项选中
  const thDropdownItemSelected = isMonochrome
    ? 'bg-gray-100 text-gray-900'
    : `${thAccentLight} ${thAccentLightText}`;

  // 标签徽章
  const thBadgeTag = isMonochrome
    ? 'bg-gray-100 text-gray-600'
    : 'bg-[#2a2a2a] text-gray-400';

  // 虚线边框
  const thBorderDashed = isMonochrome
    ? 'border-dashed border-gray-300'
    : 'border-dashed border-white/[0.08]';

  // 进度/加载框
  const thLoadingBorder = isMonochrome
    ? 'border-gray-300'
    : 'border-[#d4af37]/20';

  // 滚动条
  const thSelectOption = isMonochrome
    ? 'text-gray-800 bg-white'
    : 'text-gray-100 bg-[#1a1a1a]';
  // 状态管理
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  // 蒙版撤销栈（保存每笔开始前的 ImageData 快照）
  const [maskHistory, setMaskHistory] = useState<ImageData[]>([]);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio || '1:1');
  const [quality, setQuality] = useState(initialQuality || 'high');
  const [outputCount, setOutputCount] = useState(initialCount || 1);

  // 提示词模板触发状态
  const [showTemplatePopup, setShowTemplatePopup] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templatePopupIndex, setTemplatePopupIndex] = useState(0);
  const filteredTemplates = templateSearch ? searchTemplates(templateSearch) : getPromptTemplates();

  // 模型选择：使用 "server::<providerId>::<modelId>" 作为 key
  const [selectedModelKey, setSelectedModelKey] = useState('');

  // 根据当前选择的模型动态计算可用的画面比例和质量
  const availableRatios = findModelConfig(MODEL_ASPECT_RATIOS, selectedModelKey.split('::').pop() || '') || DEFAULT_ASPECT_RATIOS;
  const availableQualities = findModelConfig(MODEL_QUALITIES, selectedModelKey.split('::').pop() || '') || DEFAULT_QUALITIES;
  const [modelListExpanded, setModelListExpanded] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageUrl, setCurrentImageUrl] = useState(image?.url || '');

  // 进度计时 & 取消
  const [editStartTime, setEditStartTime] = useState<number | null>(null);
  const editStartTimeRef = useRef<number | null>(null);
  const [editElapsed, setEditElapsed] = useState(0);
  const [editTotalTime, setEditTotalTime] = useState<number | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const editTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 结果图片状态
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [selectedResultIndexes, setSelectedResultIndexes] = useState<Set<number>>(new Set());
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

  // ★ @图片提及
  const [atImagePickerOpen, setAtImagePickerOpen] = useState(false);
  const [atImageFilter, setAtImageFilter] = useState('');
  const [atImageIndex, setAtImageIndex] = useState(0); // 光标位置，用于定位下拉菜单
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atDropdownRef = useRef<HTMLDivElement>(null);

  // ★ 多轮上下文历史（最近5轮编辑记录，用于LLM连续理解）
  const [editContextHistory, setEditContextHistory] = useState<Array<{userPrompt: string; llmInstruction: string}>>([]);

  // ★ LLM自动区域识别 + 自动Mask
  const [autoMaskPreview, setAutoMaskPreview] = useState<string | null>(null); // 预览用data URL

  // ★ 进度计时器

  // ★ @图片提及：画布图片列表（带编号）
  const canvasImagesWithNumbers = useMemo(() => {
    if (!canvasImages || canvasImages.length === 0) return [];
    return canvasImages.map((img, idx) => ({
      ...img,
      displayLabel: img.prompt ? `#${idx + 1} ${img.prompt.slice(0, 20)}` : `#${idx + 1} 画布图片`,
      number: idx + 1,
    }));
  }, [canvasImages]);

  const filteredAtImages = useMemo(() => {
    if (!atImagePickerOpen) return [];
    const filter = atImageFilter.toLowerCase();
    return canvasImagesWithNumbers.filter(img => {
      if (!filter) return true;
      return img.displayLabel.toLowerCase().includes(filter) || (img.prompt || '').toLowerCase().includes(filter);
    }).slice(0, 8);
  }, [atImagePickerOpen, atImageFilter, canvasImagesWithNumbers]);

  const handleSelectAtImage = useCallback((img: typeof canvasImagesWithNumbers[number]) => {
    // 将图片添加为参考图
    const alreadyRef = referenceImages.some(r => r.url === img.url);
    if (!alreadyRef) {
      setReferenceImages(prev => [...prev, { id: `at-${img.id}`, url: img.url, prompt: img.prompt }]);
    }
    // 替换 @xxx 为 @图片#N
    const val = prompt;
    const lastAtIndex = val.lastIndexOf('@');
    if (lastAtIndex >= 0) {
      const before = val.slice(0, lastAtIndex);
      setPrompt(before + `@图片#${img.number} `);
    }
    setAtImagePickerOpen(false);
    setAtImageFilter('');
  }, [prompt, referenceImages]);

  useEffect(() => {
    if (editStartTime && !editTotalTime) {
      editTimerRef.current = setInterval(() => {
        setEditElapsed(Math.floor((Date.now() - editStartTime) / 1000));
      }, 1000);
    }
    return () => {
      if (editTimerRef.current) clearInterval(editTimerRef.current);
    };
  }, [editStartTime, editTotalTime]);

  // 点击外部关闭 @提及下拉和模板弹层
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showTemplatePopup && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowTemplatePopup(false);
      }
      if (atImagePickerOpen && atDropdownRef.current && !atDropdownRef.current.contains(e.target as Node) && textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setAtImagePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplatePopup, atImagePickerOpen]);

  // 格式化时间 mm:ss
  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 取消当前编辑任务
  const handleCancelEdit = async () => {
    if (editTaskId) {
      try { await fetch('/api/cancel-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: editTaskId }) }); } catch {}
    }
    setIsLoading(false);
    setIsResultLoading(false); // ★ 修复：取消时也要重置结果加载状态，否则"生成中"不消失
    setLoadingProgress(0);
    if (editStartTime) setEditTotalTime(Math.floor((Date.now() - editStartTime) / 1000));
    setEditStartTime(null);
    editStartTimeRef.current = null;
    setEditTaskId(null);
    if (editTimerRef.current) { clearInterval(editTimerRef.current); editTimerRef.current = null; }
  };

  // ★ 输入框展开状态
  const [promptExpanded, setPromptExpanded] = useState(false);

  const [pendingAutoRegions, setPendingAutoRegions] = useState<Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }>>([]);

  // 当前选中的图像模型
  const currentImageModel = (() => {
    if (!selectedModelKey.startsWith('server::')) return null;
    const parts = selectedModelKey.split('::');
    const providerId = parts[1];
    const modelId = parts.slice(2).join('::');
    return imageModels.find(m => m.providerId === providerId && m.id === modelId) || null;
  })();

  // 当前选中的图像模型显示名
  const selectedModel = currentImageModel ? `${currentImageModel.name || currentImageModel.id}` : '';

  // 当前选中的图像模型是否支持蒙版涂抹
  // 后端统一使用 images/generations + 视觉参考蒙版路径（通用，不针对特定供应商）
  // - supportsMask=true: 绝大多数图像模型，蒙版作为视觉参考图 + prompt 语义描述
  // - supportsMask=false: Gemini 系列，AI 无法可靠理解蒙版语义，仅支持文字修图
  const currentModelSupportsMask = (() => {
    if (!currentImageModel) return false; // 无模型信息时默认不支持（用户未选择模型）
    if (currentImageModel.supportsMask !== undefined) return currentImageModel.supportsMask;
    // 降级判断：默认支持（后端通用蒙版方案）
    return true;
  })();

  // 当前选中的图像模型名称（始终显示供应商名称）
  const currentModelName = currentImageModel
    ? `${currentImageModel.apiDisplayName || getModelDisplayName(currentImageModel.id)}${currentImageModel.providerName ? ` (${fixProviderName(currentImageModel.providerName)})` : ''}`
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
    ? `${currentLlmModel.name}${currentLlmModel.providerName ? ` (${fixProviderName(currentLlmModel.providerName)})` : ''}`
    : '选择LLM模型';

  // 图片预览区缩放/平移状态
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanDragging, setIsPanDragging] = useState(false);
  const isPanDraggingRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 });
  // 缩放后待设置的滚动位置（React DOM 更新后生效）
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handlePreviewWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const container = previewContainerRef.current;
    if (!container) return;

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.min(5, Math.max(0.5, previewZoom + delta));
    if (newZoom === previewZoom) return;

    // 以鼠标位置为中心缩放：计算缩放后应设置的滚动位置
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const absX = container.scrollLeft + mouseX;
    const absY = container.scrollTop + mouseY;

    const scaledAbsX = absX * (newZoom / previewZoom);
    const scaledAbsY = absY * (newZoom / previewZoom);

    // 先保存目标滚动位置，等 React DOM 更新后再应用
    pendingScrollRef.current = {
      left: scaledAbsX - mouseX,
      top: scaledAbsY - mouseY,
    };

    setPreviewZoom(newZoom);
  }, [previewZoom]);

  // 缩放后 DOM 更新完毕再设置滚动位置，避免跳动
  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (pending === null) return;
    pendingScrollRef.current = null;
    const container = previewContainerRef.current;
    if (!container) return;
    // 使用 requestAnimationFrame 确保浏览器已完成布局计算
    requestAnimationFrame(() => {
      container.scrollLeft = pending.left;
      container.scrollTop = pending.top;
    });
  }, [previewZoom]);

  // 空格键 + 鼠标左键拖动平移（使用 ref 避免重新渲染导致跳动）

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
        isPanDraggingRef.current = false;
        setIsPanDragging(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!isSpaceHeld) return;
    e.preventDefault();
    e.stopPropagation();
    const container = previewContainerRef.current;
    if (!container) return;

    // 在 mousedown 时立即捕获滚动位置，避免 React 重渲染导致跳动
    const scrollX = container.scrollLeft;
    const scrollY = container.scrollTop;
    panStartRef.current = { x: e.clientX, y: e.clientY, scrollX, scrollY };
    isPanDraggingRef.current = true;
    setIsPanDragging(true);

    // 直接在 mousedown 时绑定 window 级别事件，避免 useEffect 延迟
    const onMove = (me: MouseEvent) => {
      if (!isPanDraggingRef.current) return;
      const c = previewContainerRef.current;
      if (!c) return;
      const dx = me.clientX - panStartRef.current.x;
      const dy = me.clientY - panStartRef.current.y;
      c.scrollLeft = panStartRef.current.scrollX - dx;
      c.scrollTop = panStartRef.current.scrollY - dy;
    };
    const onUp = () => {
      isPanDraggingRef.current = false;
      setIsPanDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isSpaceHeld]);

  const resetPreviewView = useCallback(() => {
    setPreviewZoom(1);
    if (previewContainerRef.current) {
      previewContainerRef.current.scrollLeft = 0;
      previewContainerRef.current.scrollTop = 0;
    }
  }, []);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const llmWarningShownRef = useRef(false);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 260, height: 260 });
  const [canvasSize, setCanvasSize] = useState({ width: 260, height: 260 });

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [panelViewport, setPanelViewport] = useState(getFloatingPanelViewport);
  const panelWidth = Math.min(440, Math.max(0, panelViewport.width - 16));
  const panelMaxHeight = Math.max(0, Math.min(panelViewport.height - 16, panelViewport.height * 0.85));
  const narrowPanel = panelViewport.width < 640;
  const inlineResults = panelViewport.width < 1024;
  const hasResults = isResultLoading || resultImages.length > 0;
  const resultWidth = resultImages.length > 1 ? 440 : 380;
  const [position, setPosition] = useState<FloatingPanelPosition>(() => {
    const viewport = getFloatingPanelViewport();
    const centered = getCenteredFloatingPanelPosition({
      viewportWidth: viewport.width, viewportHeight: viewport.height,
      panelWidth: Math.min(440, Math.max(0, viewport.width - 16)),
      panelHeight: Math.min(viewport.height * 0.85, 680), margin: 8,
    });
    return { x: centered.x + viewport.left, y: centered.y + viewport.top };
  });

  useEffect(() => {
    const update = (): void => setPanelViewport(getFloatingPanelViewport());
    update();
    return subscribeFloatingPanelViewport(update);
  }, []);
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const fitPanelPosition = useCallback((x: number, y: number): FloatingPanelPosition => {
    const viewport = getFloatingPanelViewport();
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? Math.min(440, Math.max(0, viewport.width - 16));
    const next = constrainFloatingPanelPosition({
      x: x - viewport.left, y: y - viewport.top,
      viewportWidth: viewport.width, viewportHeight: viewport.height,
      panelWidth: width + (viewport.width >= 1024 && hasResults && !isMinimized ? 20 + resultWidth : 0),
      panelHeight: rect?.height ?? 0, margin: 8,
    });
    return { x: next.x + viewport.left, y: next.y + viewport.top };
  }, [hasResults, isMinimized, resultWidth]);

  // A drag can outlive a result-width change; installed listeners must use
  // the geometry callback from the latest committed layout throughout.
  const latestFitPanelPositionRef = useRef(fitPanelPosition);
  useLayoutEffect(() => {
    latestFitPanelPositionRef.current = fitPanelPosition;
  }, [fitPanelPosition]);

  // Commit viewport-limited dimensions before measuring/clamping position.
  // The same visible viewport drives flow layout, size and keyboard offsets.
  useLayoutEffect(() => {
    const fit = (): void => {
      setPosition(previous => {
        const next = fitPanelPosition(previous.x, previous.y);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (containerRef.current) observer.observe(containerRef.current);
    if (resultContainerRef.current) observer.observe(resultContainerRef.current);
    return () => observer.disconnect();
  }, [panelViewport, isMinimized, fitPanelPosition]);

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
              apiDisplayName: (m.name && m.name !== m.id) ? m.name : '',
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

  // 初始化模型选择（优先恢复上次选择，其次使用生成面板当前模型，否则默认选第一个）
  useEffect(() => {
    if (imageModels.length === 0) return;
    // 1. 优先恢复上次选择
    const saved = localStorage.getItem('wujie_edit_selected_model');
    if (saved && imageModels.some(m => `server::${m.providerId}::${m.id}` === saved)) {
      setSelectedModelKey(saved);
      return;
    }
    // 2. 其次使用图像生成面板当前选择的模型
    try {
      const genModelRaw = localStorage.getItem('wujie_selected_model');
      if (genModelRaw) {
        const genModel = JSON.parse(genModelRaw);
        if (genModel.providerId && genModel.model) {
          const genKey = `server::${genModel.providerId}::${genModel.model}`;
          if (imageModels.some(m => `server::${m.providerId}::${m.id}` === genKey)) {
            setSelectedModelKey(genKey);
            return;
          }
        }
      }
    } catch {}
    // 3. 兜底：默认选第一个
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
    // 切换模型后自动调整画面比例和质量
    const modelId = key.split('::').pop() || '';
    const newRatios = findModelConfig(MODEL_ASPECT_RATIOS, modelId) || DEFAULT_ASPECT_RATIOS;
    if (!newRatios.includes(aspectRatio)) setAspectRatio(newRatios[0]);
    const newQualities = findModelConfig(MODEL_QUALITIES, modelId) || DEFAULT_QUALITIES;
    if (!newQualities.includes(quality)) setQuality(newQualities[0]);
  }, [aspectRatio, quality]);

  const handleLlmSelect = useCallback((key: string) => {
    setSelectedLlmKey(key);
    setLlmListExpanded(false);
    localStorage.setItem('wujie_edit_selected_llm', key);
  }, []);

  // 同步参数变化
  useEffect(() => {
    onParamsChange?.({ aspectRatio, quality, count: outputCount });
  }, [aspectRatio, quality, outputCount, onParamsChange]);

  // ★ 连接SSE任务事件推送（taskEventsClient 是全局单例，connect() 幂等安全，无需 disconnect cleanup）
  useEffect(() => {
    taskEventsClient.connect();
    // 不调用 disconnect()：此组件仅作消费端；断开会影响其他组件的SSE接收
  }, []);

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
    // 坐标缩放：canvas 显示尺寸(rect.width/height) 与 像素尺寸(canvas.width/height) 不一致时
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    ctx.lineWidth = brushSize * Math.max(scaleX, scaleY);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      // 橡皮擦：使用 destination-out 擦除像素 alpha
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      // 画笔：红色半透明标记蒙版区域
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    }
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.globalCompositeOperation = 'source-over';
  }, [brushSize, tool]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !currentModelSupportsMask) return;
    // 手动画笔与自动mask互斥：开始手绘时清除自动mask
    if (autoMaskPreview) {
      setAutoMaskPreview(null);
      setPendingAutoRegions([]);
    }
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 保存快照用于撤销（限制20步）
    try {
      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setMaskHistory(prev => [...prev.slice(-19), snapshot]);
    } catch {}
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [currentModelSupportsMask, autoMaskPreview]);

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
    setMaskHistory([]);
  }, []);

  // 撤销上一笔
  const undoMask = useCallback(() => {
    setMaskHistory(prev => {
      if (prev.length === 0) return prev;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        const last = prev[prev.length - 1];
        ctx.putImageData(last, 0, 0);
      }
      return prev.slice(0, -1);
    });
  }, []);

  const exportMask = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 检测是否有涂抹内容（alpha > 10 的像素）
    let hasMask = false;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] > 10) { hasMask = true; break; }
    }
    if (!hasMask) return null;

    // 先在280px画布上生成黑白数据
    const bwCanvas = document.createElement('canvas');
    bwCanvas.width = canvas.width;
    bwCanvas.height = canvas.height;
    const bwCtx = bwCanvas.getContext('2d');
    if (!bwCtx) return null;
    const resultData = bwCtx.createImageData(canvas.width, canvas.height);
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
        resultData.data[i + 3] = 255;
      }
    }
    bwCtx.putImageData(resultData, 0, 0);

    // 获取原图尺寸（上限2048），将280px mask缩放到原图分辨率
    const origW = image?.originalWidth || image?.width || canvas.width;
    const origH = image?.originalHeight || image?.height || canvas.height;
    const maxEdge = 2048;
    const scale = Math.min(maxEdge / Math.max(origW, origH), 1);
    const targetW = Math.round(origW * scale);
    const targetH = Math.round(origH * scale);

    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = targetW;
    scaledCanvas.height = targetH;
    const scaledCtx = scaledCanvas.getContext('2d');
    if (!scaledCtx) return null;
    // 缩放绘制
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.imageSmoothingQuality = 'high';
    scaledCtx.drawImage(bwCanvas, 0, 0, targetW, targetH);

    // ★ 通用黑白格式 mask：白色=编辑区域, 黑色=保留区域
    // 后端会根据不同 API 路径自动转换格式（如 images.edit 需要透明=编辑格式）
    return scaledCanvas.toDataURL('image/png');
  }, [image]);

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
    if (!selectedLlmKey) {
      // 软提醒：建议选择LLM协作模型
      setError('建议选择LLM协作模型，可智能分析原图内容并优化编辑指令，效果更精准。如仍要继续，请再次点击"开始修图"');
      // 标记已提醒过，下次点击不再提醒
      if (!llmWarningShownRef.current) {
        llmWarningShownRef.current = true;
        return;
      }
    }
    llmWarningShownRef.current = false;

    setError(null);
    setIsLoading(true);
    setIsResultLoading(true);
    setResultImages([]);
    setSelectedResultIndexes(new Set());
    setLoadingProgress(0);
    setEditStartTime(Date.now());
    editStartTimeRef.current = Date.now();
    setEditTotalTime(null);

    let progressIntervalId: ReturnType<typeof setInterval> | null = null;
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
        if (editStartTimeRef.current) {
          setEditTotalTime(Math.round((Date.now() - editStartTimeRef.current) / 1000));
        }
        return;
      }
      const maskDataUrl = currentModelSupportsMask ? exportMask() : (() => {
        // 检查用户是否在画布上涂抹了内容
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
          const hasStrokes = imageData?.data.some((v: number, i: number) => i % 4 === 3 && v > 10);
          if (hasStrokes) {
            console.warn('[ImageEditor] 当前模型不支持蒙版涂抹，您绘制的区域将被忽略');
          }
        }
        return null;
      })();
      const progressInterval = setInterval(() => {
        setLoadingProgress(prev => Math.min(prev + 10, 90));
      }, 500);
      progressIntervalId = progressInterval;

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

      // ★ 构建请求体（含 count，后端仅做1次LLM协作 + count次图像生成）
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
        editHistory: editContextHistory.slice(-5),
        count: Math.max(1, Math.min(outputCount, 4)),
      };

      // ★ 提交+轮询模式：提交单个任务（后端内部处理多张输出）
      const taskIds: string[] = [];

      // 提交任务
      try {
        const submitResp = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseRequestBody),
        });
        const submitData = await submitResp.json();
        if (submitData.success && submitData.taskId) {
          taskIds.push(submitData.taskId);
          setEditTaskId(submitData.taskId);
        } else if (!submitData.success) {
          clearInterval(progressInterval);
          setIsResultLoading(false);
          setError(translateErrorFrontend(submitData.error || '提交失败'));
          setIsLoading(false);
          if (editStartTimeRef.current) {
            setEditTotalTime(Math.round((Date.now() - editStartTimeRef.current) / 1000));
          }
          return;
        }
      } catch (submitErr: unknown) {
        clearInterval(progressInterval);
        setIsResultLoading(false);
        const errMsg = submitErr instanceof Error ? submitErr.message : '提交失败，请重试';
        setError(errMsg);
        setIsLoading(false);
        if (editStartTimeRef.current) {
          setEditTotalTime(Math.round((Date.now() - editStartTimeRef.current) / 1000));
        }
        return;
      }

      if (taskIds.length === 0) {
        clearInterval(progressInterval);
        setIsResultLoading(false);
        setError('提交失败，未获得任务ID');
        setIsLoading(false);
        return;
      }

      // ★ 轮询所有任务直到完成
      const collectedUrls: string[] = [];
      let firstError = '';
      let collectedLlmInstruction = '';
      let collectedEditRegions: Array<{ label: string; bounds: { x: number; y: number; width: number; height: number } }> = [];
      const completedTasks = new Set<string>();
      const maxPollTime = 1500000; // ★ 25分钟超时（兼容慢速API）
      const pollStart = Date.now();
      let pollCount = 0;

      // 等待500ms让后端完成任务创建，避免首次轮询时任务尚未存储
      await new Promise(r => setTimeout(r, 500));

      while (completedTasks.size < taskIds.length && (Date.now() - pollStart) < maxPollTime) {
        // 并行轮询所有未完成的任务
        const pendingTaskIds = taskIds.filter(id => !completedTasks.has(id));
        const pollPromises = pendingTaskIds.map(async (taskId) => {
          try {
            const pollResp = await fetch('/api/poll-task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, model: currentImageModel?.id || selectedModelKey.split('::').pop() || '', providerId: currentImageModel?.providerId || selectedModelKey.split('::')[1] || '' }),
            });
            const pollData = await pollResp.json();
            return { taskId, pollData };
          } catch (err) {
            return { taskId, pollData: null };
          }
        });

        const pollResults = await Promise.all(pollPromises);

        for (const { taskId, pollData } of pollResults) {
          if (!pollData) continue;

          // ★ 调试日志：追踪轮询响应
          pollCount++;
          if (pollCount <= 5 || pollCount % 10 === 0) {
            console.info(`[image-editor] poll #${pollCount} taskId=${taskId} status=${pollData.status} hasResult=${!!pollData.result} success=${pollData.success}`);
          }

          if (pollData.status === 'completed' && pollData.result) {
            completedTasks.add(taskId);
            const data = pollData.result;
            // ★ 优先使用 images 数组（后端存储 image:images[0] + images:[all]，
            //   count>1 时 images 数组包含所有生成结果，data.image 只是第一张）
            if (data.images && Array.isArray(data.images) && data.images.length > 0) {
              collectedUrls.push(...data.images.map((img: { url: string }) => img.url));
              if (!collectedLlmInstruction && data.llmInstruction) {
                collectedLlmInstruction = data.llmInstruction;
              }
              if (collectedEditRegions.length === 0 && data.editRegions && Array.isArray(data.editRegions) && data.editRegions.length > 0) {
                collectedEditRegions = data.editRegions;
              }
            } else if (data.success && data.image?.url) {
              collectedUrls.push(data.image.url);
              if (!collectedLlmInstruction && data.llmInstruction) {
                collectedLlmInstruction = data.llmInstruction;
              }
              if (collectedEditRegions.length === 0 && data.editRegions && Array.isArray(data.editRegions) && data.editRegions.length > 0) {
                collectedEditRegions = data.editRegions;
              }
            } else if (!firstError && data.error) {
              firstError = translateErrorFrontend(data.error);
            }
          } else if (pollData.status === 'failed') {
            completedTasks.add(taskId);
            if (!firstError) firstError = translateErrorFrontend(pollData.error || pollData.message || '编辑失败');
          } else if (pollData.status === 'error') {
            // 任务不存在或已过期（可能是服务重启导致内存清空）
            completedTasks.add(taskId);
            if (!firstError) firstError = translateErrorFrontend(pollData.error || '任务已过期，请重新提交');
          }

          // 更新进度条（基于已完成任务数）
          const progress = Math.round((completedTasks.size / taskIds.length) * 100);
          setLoadingProgress(progress);
        }

        // 如果还有未完成的任务，等待后继续轮询
        if (completedTasks.size < taskIds.length) {
          pollCount++;
          // ★ 动态轮询间隔：前10次1秒，10-25次1.5秒，之后2秒
          const waitMs = pollCount <= 10 ? 1000 : pollCount <= 25 ? 1500 : 2000;
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      clearInterval(progressInterval);
      setLoadingProgress(100);
      setIsResultLoading(false);
      if (editStartTimeRef.current) {
        setEditTotalTime(Math.round((Date.now() - editStartTimeRef.current) / 1000));
      }

      // 处理超时
      if (completedTasks.size < taskIds.length && collectedUrls.length === 0) {
        setError(firstError || '编辑超时，请稍后重试');
      } else if (collectedUrls.length > 0) {
        setResultImages(collectedUrls);
        setSelectedResultIndexes(new Set(collectedUrls.map((_, i) => i)));

        // ★ 更新多轮上下文历史（保留最近5轮）
        setEditContextHistory(prev => [
          ...prev.slice(-4),
          { userPrompt: prompt, llmInstruction: collectedLlmInstruction || prompt },
        ]);

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

        // ★ LLM自动区域识别：生成自动mask预览供用户确认
        if (collectedEditRegions.length > 0) {
          try {
            const origW = image?.originalWidth || image?.width || 400;
            const origH = image?.originalHeight || image?.height || 400;
            const previewCanvas = document.createElement('canvas');
            previewCanvas.width = origW;
            previewCanvas.height = origH;
            const previewCtx = previewCanvas.getContext('2d');
            if (previewCtx) {
              // 黑色背景（保留区域）
              previewCtx.fillStyle = '#000000';
              previewCtx.fillRect(0, 0, origW, origH);
              // 白色椭圆（编辑区域）
              previewCtx.fillStyle = '#ffffff';
              for (const region of collectedEditRegions) {
                const cx = (region.bounds.x + region.bounds.width / 2) * origW;
                const cy = (region.bounds.y + region.bounds.height / 2) * origH;
                const rx = (region.bounds.width / 2) * origW;
                const ry = (region.bounds.height / 2) * origH;
                previewCtx.beginPath();
                previewCtx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
                previewCtx.fill();
              }
              setAutoMaskPreview(previewCanvas.toDataURL('image/png'));
              setPendingAutoRegions(collectedEditRegions);
            }
          } catch (maskErr) {
            console.warn('Auto mask preview generation failed:', maskErr);
          }
        }

        if (collectedUrls.length < outputCount && firstError) {
          setError(`已生成 ${collectedUrls.length}/${outputCount} 张，部分失败: ${firstError}`);
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
      // Ensure progressInterval is always cleaned up
      if (progressIntervalId) clearInterval(progressIntervalId);
    }
  }, [prompt, selectedModelKey, selectedLlmKey, currentImageUrl, aspectRatio, quality, outputCount, currentModelSupportsMask, exportMask, clearMask, currentHistoryIndex, referenceImages, imageToDataUrl, compressImageDataUrl]);

  // ★ 确认使用自动Mask（将预览mask绘制到Canvas上，与手动mask互斥）
  const handleConfirmAutoMask = useCallback(() => {
    if (autoMaskPreview) {
      // 将自动mask绘制到画布上
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          };
          img.src = autoMaskPreview;
        }
      }
    }
    setAutoMaskPreview(null);
    setPendingAutoRegions([]);
  }, [autoMaskPreview]);

  // ★ 取消自动Mask
  const handleCancelAutoMask = useCallback(() => {
    setAutoMaskPreview(null);
    setPendingAutoRegions([]);
  }, []);

  const handleConfirmResult = useCallback((url?: string) => {
    if (url) {
      // 单张点击使用
      onConfirm({
        url,
        prompt: image?.prompt ? `${image.prompt} + ${prompt}` : prompt,
        aspectRatio,
      });
    } else {
      // 确认使用 - 发送所有选中的结果
      const selectedUrls = resultImages.filter((_, i) => selectedResultIndexes.has(i));
      for (const sUrl of selectedUrls) {
        onConfirm({
          url: sUrl,
          prompt: image?.prompt ? `${image.prompt} + ${prompt}` : prompt,
          aspectRatio,
        });
      }
    }
    setPrompt('');
    setResultImages([]);
    setSelectedResultIndexes(new Set());
    setEditContextHistory([]);
    setAutoMaskPreview(null);
    setPendingAutoRegions([]);
    onClose();
  }, [resultImages, selectedResultIndexes, prompt, image?.prompt, onConfirm, onClose, aspectRatio]);

  const handleHistoryClick = useCallback((index: number) => {
    const historyItem = history[index];
    if (historyItem) {
      setCurrentImageUrl(historyItem.imageUrl);
      setCurrentHistoryIndex(index);
    }
  }, [history]);

  // 拖拽
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // 只允许从header区域拖拽面板
    const target = e.target as HTMLElement;
    const header = target.closest('[data-panel-header]');
    if (!header || target.closest('button, input, select, textarea, a') || e.button !== 0) return;
    dragCleanupRef.current?.();
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
    const onMove = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      setPosition(latestFitPanelPositionRef.current(event.clientX - offset.x, event.clientY - offset.y));
    };
    const onUp = (): void => {
      setPosition(previous => {
        const next = latestFitPanelPositionRef.current(previous.x, previous.y);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    window.addEventListener('pointercancel', onUp);
    dragCleanupRef.current = onUp;
  }, []);

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
    const hint = getModelHint(model.id);
    const maskSupported = supportsMask ?? model.supportsMask ?? false;
    return (
      <button
        key={modelKey}
        onClick={() => handleModelSelect(modelKey)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-all border-b ${thBorderLight} last:border-b-0 ${
          isSelected
            ? `${thAccentLight} ${thAccentLightText}`
            : thDropdownItem
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{model.apiDisplayName || getModelDisplayName(model.id)}</span>
            {model.providerName && <span className={`shrink-0 text-[10px] px-1 py-0.5 ${thAccentLight} ${thAccentLightText} rounded`}>{fixProviderName(model.providerName)}</span>}
            {maskSupported
              ? <span className="shrink-0 text-[10px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded">支持涂抹</span>
              : <span className="shrink-0 text-[10px] px-1 py-0.5 bg-orange-500/20 text-orange-400 rounded">仅文字修图</span>
            }
          </div>
          <div className={`text-xs ${thTextMuted} truncate`}>{fixProviderName(model.providerName)}{hint ? ` · ${hint}` : ''}</div>
        </div>
        {isSelected && <Check size={12} className={`${isMonochrome ? "text-blue-500" : "text-[#d4af37]"} flex-shrink-0`} />}
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
              <stop offset="0%" stopColor={isMonochrome ? "#374151" : "#d4af37"} />
              <stop offset="100%" stopColor={isMonochrome ? "#6b7280" : "#b8860b"} />
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
            stroke={isMonochrome ? "#374151" : "#d4af37"}
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
              stroke={isMonochrome ? "#374151" : "#d4af37"}
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
        className={`fixed z-[200] flex min-w-0 flex-col ${isDragging ? '' : thPanel} rounded-xl overflow-hidden`}
        style={{
          left: position.x,
          top: position.y,
          width: panelWidth,
          maxHeight: panelMaxHeight,
          backgroundColor: isMonochrome ? '#fff' : '#1a1a1a',
          border: isDragging
            ? `1px solid ${isMonochrome ? '#2563eb' : '#d4af37'}`
            : `1px solid ${isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: isDragging
            ? (isMonochrome ? '0 0 24px rgba(37,99,235,0.25), 0 25px 50px -12px rgba(0,0,0,0.25)' : '0 0 24px rgba(212,175,55,0.3), 0 25px 50px -12px rgba(0,0,0,0.5)')
            : (isMonochrome ? '0 25px 50px -12px rgba(0,0,0,0.25)' : '0 25px 50px -12px rgba(0,0,0,0.5)'),
        }}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        data-popup
      >
        {/* Header - 可拖拽 */}
        <div
          data-panel-header
          className={`flex min-w-0 items-center gap-2 px-3 py-2 cursor-move select-none shrink-0 ${isMinimized ? 'rounded-xl' : ''}`}
          style={{ borderBottom: isMinimized ? 'none' : `1px solid ${isMonochrome ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}` }}
          onMouseDown={handleDragStart}
        >
          <GripVertical size={14} className="shrink-0" style={{ color: isMonochrome ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)' }} />
          <Pencil size={15} className="shrink-0" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }} />
          <span className="shrink-0 whitespace-nowrap text-base font-semibold" style={{ color: isMonochrome ? '#6b6b6b' : '#d4af37' }}>
            语言修图
          </span>
          {selectedModel && (
            <span className="min-w-0 flex-1 truncate text-xs px-1.5 py-0.5 rounded" title={selectedModel} style={{ color: isMonochrome ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)', background: isMonochrome ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)' }}>
              {selectedModel}
            </span>
          )}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            aria-label={isMinimized ? '展开语言修图' : '最小化语言修图'}
            className="flex h-11 w-11 shrink-0 items-center justify-center p-1 rounded-md transition-colors"
            style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => (e.currentTarget.style.color = isMonochrome ? '#000' : '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => { setEditContextHistory([]); setAutoMaskPreview(null); setPendingAutoRegions([]); onClose(); }}
            aria-label="关闭语言修图"
            className="flex h-11 w-11 shrink-0 items-center justify-center p-1 rounded-md transition-colors"
            style={{ color: isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => (e.currentTarget.style.color = isMonochrome ? '#000' : '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = isMonochrome ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        {/* Keep the original canvas mounted when folded so its pixels and
            undo snapshots survive restore and viewport reflow. */}
        <div className="min-h-0 min-w-0 overflow-y-auto p-4 space-y-3.5" style={{ display: isMinimized ? 'none' : undefined }}>
          {/* 图片预览区域 - 无图时显示大+号 */}
          {!currentImageUrl ? (
            <div className="relative">
              {/* 大+号占位区域 */}
              <button
                onClick={() => setMainPickerOpen(!mainPickerOpen)}
                className={`w-full h-[200px] ${thBg} rounded-lg border-2 ${thBorderDashed} hover:border-current flex flex-col items-center justify-center gap-2 transition-all group ${isMonochrome ? 'hover:border-gray-400' : 'hover:border-[#d4af37]/50'}`}
              >
                <div className={`w-12 h-12 rounded-full ${isMonochrome ? 'bg-gray-200 group-hover:bg-gray-300' : 'bg-[#2a2a2a] group-hover:bg-[#d4af37]/20'} flex items-center justify-center transition-all`}>
                  <Plus className={`h-6 w-6 ${thTextMuted} ${isMonochrome ? 'group-hover:text-blue-500' : 'group-hover:text-[#d4af37]'} transition-colors`} />
                </div>
                <span className={`text-xs ${thTextMuted} ${isMonochrome ? 'group-hover:text-gray-600' : 'group-hover:text-gray-400'} transition-colors`}>添加要修图的图片</span>
                <span className={`text-xs ${thTextDim}`}>从画布选择或上传本地图片</span>
              </button>

              {/* 选择主图弹窗 */}
              {mainPickerOpen && (
                <div className={`mt-2 max-h-48 overflow-y-auto rounded-lg border ${thDropdown}`}>
                  <div className={`px-2 py-1 text-xs ${thTextMuted} uppercase tracking-wider border-b ${thBorderLight} sticky top-0 ${thBgDeep}`}>选择图片</div>
                  {/* 从画布选择 */}
                  {canvasImages && canvasImages.length > 0 && canvasImages.map(ci => (
                    <button
                      key={ci.id}
                      onClick={() => handleSelectMainFromCanvas(ci)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm ${thDropdownItem} transition-all border-b ${thBorderLight} last:border-b-0`}
                    >
                      <img src={ci.url} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" crossOrigin="anonymous" />
                      <div className="flex-1 min-w-0">
                        <div className={`truncate text-sm`}>{ci.prompt || ci.url.split('/').pop() || '图片'}</div>
                        <div className={`text-xs ${thTextMuted}`}>{ci.originalWidth || 0}x{ci.originalHeight || 0}</div>
                      </div>
                      <Plus className={`h-3 w-3 ${thAccentIcon} flex-shrink-0`} />
                    </button>
                  ))}
                  {/* 上传按钮 */}
                  <button
                    onClick={() => mainFileInputRef.current?.click()}
                    className={`w-full flex items-center gap-2 px-2 py-2 text-left text-sm ${thDropdownItem} ${isMonochrome ? 'hover:text-gray-900' : 'hover:text-[#d4af37]'} transition-all`}
                  >
                    <div className={`w-8 h-8 rounded ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'} flex items-center justify-center flex-shrink-0`}>
                      <Upload className={`h-3.5 w-3.5 ${isMonochrome ? "text-blue-400" : thTextMuted}`} />
                    </div>
                    <span className="text-sm">上传本地图片</span>
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
            className={`relative ${thBg} rounded-lg`}
            style={{ 
              height: Math.min(imageDisplaySize.height + 32, 280),
              minHeight: 200,
            }}
          >
            {/* 缩放工具 - 固定在容器右上角 */}
            <div className="absolute top-1 right-1 z-20 flex items-center gap-0.5" onMouseDown={e => e.stopPropagation()}>

              <button
                onClick={(e) => { e.stopPropagation(); setPreviewZoom(prev => Math.min(5, prev + 0.25)); }}
                className={`p-1 rounded ${isMonochrome ? 'bg-gray-200/80 text-gray-500 hover:text-gray-800' : 'bg-[#2a2a2a]/80 text-gray-400 hover:text-white'} transition-colors`}
                title="放大"
              >
                <Plus className="h-3 w-3" />
              </button>
              <span className={`text-xs ${thAccent} font-mono px-0.5 min-w-[32px] text-center`}>{Math.round(previewZoom * 100)}%</span>
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewZoom(prev => Math.max(0.2, prev - 0.25)); }}
                className={`p-1 rounded ${isMonochrome ? 'bg-gray-200/80 text-gray-500 hover:text-gray-800' : 'bg-[#2a2a2a]/80 text-gray-400 hover:text-white'} transition-colors`}
                title="缩小"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); resetPreviewView(); }}
                className={`p-1 rounded ${isMonochrome ? 'bg-gray-200/80 text-gray-500 hover:text-gray-800' : 'bg-[#2a2a2a]/80 text-gray-400 hover:text-white'} transition-colors`}
                title="重置视图"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>

            {/* 更换图片按钮 - 固定在容器左上角，主图标记右侧 */}
            <div className="absolute top-1 left-1 z-20 flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
              <span className={`text-xs px-1.5 py-0.5 ${isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37]/80 text-black'} rounded font-medium`}>原图</span>
              <button
                onClick={(e) => { e.stopPropagation(); setMainPickerOpen(!mainPickerOpen); }}
                className={`p-0.5 rounded ${isMonochrome ? 'bg-gray-200/80 text-gray-500 hover:text-gray-800' : 'bg-[#2a2a2a]/80 text-gray-400 hover:text-[#d4af37]'} transition-colors`}
                title="更换图片"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              {mainPickerOpen && (
                <div className={`absolute top-full left-0 mt-1 min-w-[180px] max-h-48 overflow-y-auto rounded-lg border ${thDropdown} z-30`}>
                  <div className={`px-2 py-1 text-xs ${thTextMuted} uppercase tracking-wider border-b ${thBorderLight} sticky top-0 ${thBgDeep}`}>更换图片</div>
                  {canvasImages && canvasImages.length > 0 && canvasImages.filter(ci => ci.url !== currentImageUrl).map(ci => (
                    <button
                      key={ci.id}
                      onClick={() => { handleSelectMainFromCanvas(ci); setMainPickerOpen(false); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm ${thDropdownItem} transition-all border-b ${thBorderLight} last:border-b-0`}
                    >
                      <img src={ci.url} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" crossOrigin="anonymous" />
                      <div className="flex-1 min-w-0">
                        <div className={`truncate text-sm`}>{ci.prompt || ci.url.split('/').pop() || '图片'}</div>
                        <div className={`text-xs ${thTextMuted}`}>{ci.originalWidth || 0}x{ci.originalHeight || 0}</div>
                      </div>
                    </button>
                  ))}
                  {(!canvasImages || canvasImages.filter(ci => ci.url !== currentImageUrl).length === 0) && (
                    <div className={`px-2 py-3 text-xs ${thTextMuted} text-center`}>画布上没有其他图片</div>
                  )}
                  <button
                    onClick={() => { mainFileInputRef.current?.click(); setMainPickerOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2 py-2 text-left text-sm ${thDropdownItem} ${isMonochrome ? 'hover:text-gray-900' : 'hover:text-[#d4af37]'} transition-all`}
                  >
                    <div className={`w-8 h-8 rounded ${isMonochrome ? 'bg-gray-200' : 'bg-[#2a2a2a]'} flex items-center justify-center flex-shrink-0`}>
                      <Upload className={`h-3.5 w-3.5 ${isMonochrome ? "text-blue-400" : thTextMuted}`} />
                    </div>
                    <span className="text-sm">上传本地图片</span>
                  </button>
                </div>
              )}
            </div>

            {/* 画笔涂抹提示 - 固定在容器底部 */}
            {currentModelSupportsMask && !isSpaceHeld && (
            <div className="absolute bottom-1 left-1 right-1 z-20 flex items-center justify-center pointer-events-none">
              <div className={`flex items-center gap-1 px-2 py-0.5 ${isMonochrome ? 'bg-white/80 border border-gray-200' : 'bg-[#1a1a1a] border border-white/[0.08]'} rounded`}>
                <Pencil className={`h-3 w-3 ${thAccentIcon}`} />
                <span className={`text-xs ${thAccent}`}>涂抹区域 + 文字描述 = 精准修图</span>
              </div>
            </div>
            )}

            {/* 滚动容器 - 仅图片内容滚动 */}
            <div
              className="w-full h-full overflow-auto rounded-lg"
              ref={previewContainerRef}
              onWheel={handlePreviewWheel}
              onMouseDown={handlePanStart}
              style={{ 
                cursor: isSpaceHeld ? (isPanDragging ? 'grabbing' : 'grab') : 'default',
              }}
            >
            <div
              className="flex items-center justify-center"
              style={{ 
                minWidth: previewZoom > 1 ? `${imageDisplaySize.width * previewZoom}px` : '100%',
                minHeight: previewZoom > 1 ? `${imageDisplaySize.height * previewZoom}px` : '100%',
              }}
            >
              <div
                className="relative flex-shrink-0"
                style={{
                  width: imageDisplaySize.width * previewZoom,
                  height: imageDisplaySize.height * previewZoom,
                }}
              >
                <img src={currentImageUrl} alt="编辑" className="absolute top-0 left-0 w-full h-full object-contain rounded" crossOrigin="anonymous" />
                <canvas
                  ref={canvasRef}
                  className={`absolute top-0 left-0 w-full h-full ${currentModelSupportsMask && !isSpaceHeld ? 'cursor-crosshair' : 'pointer-events-none'}`}
                  style={{ width: imageDisplaySize.width * previewZoom, height: imageDisplaySize.height * previewZoom }}
                  onMouseDown={!isSpaceHeld ? handleMouseDown : undefined}
                  onMouseMove={!isSpaceHeld ? handleMouseMove : undefined}
                  onMouseUp={!isSpaceHeld ? handleMouseUp : undefined}
                  onMouseLeave={!isSpaceHeld ? handleMouseUp : undefined}
                />
              </div>
            </div>
            </div>
          </div>
          )}

          {/* ★ 参考图区域 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-sm ${thTextSecondary} flex items-center gap-1`}>
                <ImageIcon className={`h-3 w-3 ${thAccentIcon}`} />
                参考图
                {referenceImages.length > 0 && (
                  <span className={`${thAccent} font-medium`}>{referenceImages.length}</span>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                {/* 从画布选择 */}
                {canvasImages && canvasImages.length > (currentImageUrl ? 1 : 0) && (
                  <button
                    onClick={() => setRefPickerOpen(!refPickerOpen)}
                    className={`flex items-center gap-1 px-2 py-1 text-xs ${thBg} border ${thBorder} rounded ${isMonochrome ? 'text-gray-500 hover:text-gray-900 hover:border-gray-400' : 'text-gray-400 hover:text-[#d4af37] hover:border-[#d4af37]'} transition-all`}
                  >
                    <Plus className="h-3 w-3" />画布选图
                  </button>
                )}
                {/* 本地上传 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-1 px-2 py-1 text-xs ${thBg} border ${thBorder} rounded ${isMonochrome ? 'text-gray-500 hover:text-gray-900 hover:border-gray-400' : 'text-gray-400 hover:text-[#d4af37] hover:border-[#d4af37]'} transition-all`}
                >
                  <Upload className="h-3 w-3" />上传
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
                      dragOverIdx === idx ? (isMonochrome ? 'border-gray-600' : 'border-[#d4af37]') + ' scale-105' :
                      dragRefIdx === idx ? (isMonochrome ? 'border-gray-400 opacity-50' : 'border-[#666] opacity-50') :
                      isMonochrome ? 'border-gray-200 hover:border-gray-400' : 'border-white/[0.08] hover:border-white/[0.15]'
                    }`}
                  >
                    <img src={ref.url} alt={`参考${idx + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
                    {/* 序号 */}
                    <div className={`absolute bottom-0 left-0 right-0 ${isMonochrome ? 'bg-white/70' : 'bg-black/60'} text-[8px] text-center ${isMonochrome ? 'text-gray-600' : 'text-[#ccc]'}`}>
                      {idx + 1}
                    </div>
                    {/* 拖拽手柄 */}
                    <div className="absolute top-0 left-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className={`h-2.5 w-2.5 ${isMonochrome ? "text-gray-400 drop-shadow" : "text-white drop-shadow"}`} />
                    </div>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveRef(ref.id); }}
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 bg-red-500/80 rounded-bl-lg"
                    >
                      <X className={`h-2.5 w-2.5 ${isMonochrome ? "text-gray-500" : "text-white"}`} />
                    </button>
                    {/* prompt提示 */}
                    {ref.prompt && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center pointer-events-none">
                        <span className={`opacity-0 group-hover:opacity-100 transition-opacity text-[7px] ${isMonochrome ? "text-gray-800" : "text-white"} text-center px-0.5 line-clamp-2 max-h-full overflow-hidden`}>{ref.prompt.slice(0, 30)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-xs ${thTextMuted} py-1.5 text-center border ${thBorderDashed} rounded-lg`}>
                添加参考图帮助AI更好理解修图意图
              </div>
            )}

            {/* 从画布选择参考图弹窗 */}
            {refPickerOpen && availableCanvasImages.length > 0 && (
              <div className={`mt-1.5 max-h-32 overflow-y-auto rounded-lg border ${thDropdown}`}>
                <div className={`px-2 py-1 text-xs ${thTextMuted} uppercase tracking-wider border-b ${thBorderLight} sticky top-0 ${thBgDeep}`}>选择画布图片</div>
                {availableCanvasImages.map(ci => (
                  <button
                    key={ci.id}
                    onClick={() => handleAddRefFromCanvas(ci)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm ${thDropdownItem} transition-all border-b ${thBorderLight} last:border-b-0`}
                  >
                    <img src={ci.url} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" crossOrigin="anonymous" />
                    <div className="flex-1 min-w-0">
                      <div className={`truncate text-sm`}>{ci.prompt || ci.url.split('/').pop() || '图片'}</div>
                      <div className={`text-xs ${thTextMuted}`}>{ci.originalWidth || 0}x{ci.originalHeight || 0}</div>
                    </div>
                    <Plus className={`h-3 w-3 ${thAccentIcon} flex-shrink-0`} />
                  </button>
                ))}
              </div>
            )}
            {refPickerOpen && availableCanvasImages.length === 0 && (
              <div className={`mt-1.5 px-3 py-2 text-xs ${thTextMuted} text-center border ${thBorder} rounded-lg ${thBgDeep}`}>
                画布上没有其他可添加的图片
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 画笔工具 - 始终显示 */}
          <div className={narrowPanel ? 'grid grid-cols-2 gap-1.5 px-1' : 'flex flex-wrap items-center gap-1.5 px-1'}>
            <button
              onClick={() => currentModelSupportsMask && setTool('brush')}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                !currentModelSupportsMask
                  ? isMonochrome ? 'bg-gray-100 text-gray-300 border border-gray-100 cursor-not-allowed' : 'bg-[#1a1a1a] text-gray-600 border border-white/[0.04] cursor-not-allowed'
                  : tool === 'brush'
                    ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                    : isMonochrome ? 'bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200' : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-white/[0.08]'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />画笔
            </button>
            <button
              onClick={() => currentModelSupportsMask && setTool('eraser')}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                !currentModelSupportsMask
                  ? isMonochrome ? 'bg-gray-100 text-gray-300 border border-gray-100 cursor-not-allowed' : 'bg-[#1a1a1a] text-gray-600 border border-white/[0.04] cursor-not-allowed'
                  : tool === 'eraser'
                    ? isMonochrome ? 'bg-blue-500 text-white' : 'bg-[#d4af37] text-black'
                    : isMonochrome ? 'bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200' : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-white/[0.08]'
              }`}
            >
              <Eraser className="h-3.5 w-3.5" />橡皮
            </button>
            <button
              onClick={() => currentModelSupportsMask && undoMask()}
              disabled={!currentModelSupportsMask || maskHistory.length === 0}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                !currentModelSupportsMask || maskHistory.length === 0
                  ? isMonochrome ? 'bg-gray-100 text-gray-300 border border-gray-100 cursor-not-allowed' : 'bg-[#1a1a1a] text-gray-600 border border-white/[0.04] cursor-not-allowed'
                  : isMonochrome ? 'bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200' : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-white/[0.08]'
              }`}
            >
              <History className="h-3.5 w-3.5" />撤销
            </button>
            <button
              onClick={() => currentModelSupportsMask && clearMask()}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                !currentModelSupportsMask
                  ? isMonochrome ? 'bg-gray-100 text-gray-300 border border-gray-100 cursor-not-allowed' : 'bg-[#1a1a1a] text-gray-600 border border-white/[0.04] cursor-not-allowed'
                  : isMonochrome ? 'bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200' : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-white/[0.08]'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />清除
            </button>
            <div className={narrowPanel ? 'col-span-2 flex items-center justify-end gap-1.5 pt-1' : 'ml-auto flex items-center gap-1.5'}>
            <span className={`text-xs ${thTextMuted}`}>笔触</span>
            <input
              type="range"
              min="10"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={!currentModelSupportsMask}
              style={{ height: 44, background: 'transparent' }}
              className={`w-16 rounded appearance-none [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[2px] [&::-webkit-slider-thumb]:-mt-1 [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[2px] ${isMonochrome
                ? 'accent-gray-900 [&::-webkit-slider-runnable-track]:bg-gray-200 [&::-moz-range-track]:bg-gray-200'
                : 'accent-[#d4af37] [&::-webkit-slider-runnable-track]:bg-[#2a2a2a] [&::-moz-range-track]:bg-[#2a2a2a]'} ${!currentModelSupportsMask ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
            />
            <span className={`text-xs font-mono w-5 text-center ${currentModelSupportsMask ? (isMonochrome ? 'text-gray-900' : 'text-[#d4af37]') : (isMonochrome ? 'text-gray-300' : 'text-gray-600')}`}>{brushSize}</span>
            </div>
          </div>

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 编辑指令 */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                const val = e.target.value;
                // @图片提及检测
                const lastAtIndex = val.lastIndexOf('@');
                if (lastAtIndex >= 0) {
                  const afterAt = val.slice(lastAtIndex + 1);
                  const textBeforeAt = val.slice(0, lastAtIndex);
                  // @前面必须是空白或开头
                  const isValidTrigger = textBeforeAt === '' || /[\s\n]$/.test(textBeforeAt);
                  if (isValidTrigger && !afterAt.includes(' ') && !afterAt.includes('\n') && afterAt.length <= 20) {
                    setAtImagePickerOpen(true);
                    setAtImageFilter(afterAt);
                  } else {
                    setAtImagePickerOpen(false);
                  }
                } else {
                  setAtImagePickerOpen(false);
                }
                // /模板检测
                if (val.endsWith('/')) {
                  setShowTemplatePopup(true);
                  setTemplateSearch('');
                  setTemplatePopupIndex(0);
                } else if (showTemplatePopup) {
                  const slashIdx = val.lastIndexOf('/');
                  if (slashIdx >= 0) {
                    const afterSlash = val.slice(slashIdx + 1);
                    if (!afterSlash.includes(' ') && !afterSlash.includes('\n')) {
                      setTemplateSearch(afterSlash);
                      setTemplatePopupIndex(0);
                    } else {
                      setShowTemplatePopup(false);
                    }
                  } else {
                    setShowTemplatePopup(false);
                  }
                }
              }}
              onKeyDown={(e) => {
                // @图片下拉键盘导航
                if (atImagePickerOpen && filteredAtImages.length > 0) {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAtImageIndex((i) => (i - 1 + filteredAtImages.length) % filteredAtImages.length);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAtImageIndex((i) => (i + 1) % filteredAtImages.length);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSelectAtImage(filteredAtImages[atImageIndex]);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setAtImagePickerOpen(false);
                  }
                  return;
                }
                if (showTemplatePopup && filteredTemplates.length > 0) {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setTemplatePopupIndex((i) => (i - 1 + filteredTemplates.length) % filteredTemplates.length);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setTemplatePopupIndex((i) => (i + 1) % filteredTemplates.length);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const tpl = filteredTemplates[templatePopupIndex];
                    if (tpl) {
                      const val = prompt;
                      const slashIdx = val.lastIndexOf('/');
                      const before = val.slice(0, slashIdx);
                      setPrompt(before + tpl.content);
                      setShowTemplatePopup(false);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowTemplatePopup(false);
                  }
                } else {
                  handleKeyDown(e);
                }
              }}
              placeholder="描述修改内容，如：把背景换成日落... (输入 / 模板 · @ 引用图片)"
              className={`w-full ${promptExpanded ? 'h-32' : 'h-14'} ${thInput} rounded-lg px-3 py-2 text-sm ${thTextPlaceholder} resize-none transition-all duration-200`}
            />
            {showTemplatePopup && filteredTemplates.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl z-50">
                {filteredTemplates.slice(0, 20).map((tpl, i) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      const val = prompt;
                      const slashIdx = val.lastIndexOf('/');
                      const before = val.slice(0, slashIdx);
                      setPrompt(before + tpl.content);
                      setShowTemplatePopup(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-white/5 last:border-0 transition-colors group/tpl relative ${i === templatePopupIndex ? 'bg-[#d4af37]/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-2">
                      {tpl.thumbnail ? (
                        <img src={tpl.thumbnail} alt={tpl.name} className="w-6 h-6 rounded object-cover flex-shrink-0 border border-white/10" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 flex-shrink-0 text-gold-muted/50" />
                      )}
                      <span className="font-medium truncate">{tpl.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate mt-0.5 pl-8">{tpl.content}</div>
                    {tpl.thumbnail && (
                      <div className="absolute left-full ml-2 top-0 z-[60] hidden group-hover/tpl:block">
                        <div className="rounded-lg shadow-2xl overflow-hidden border border-white/10 bg-[#1a1a1a]">
                          <img src={tpl.thumbnail} alt={tpl.name} className="w-36 h-36 object-cover" />
                          <div className="px-2 py-1 text-[10px] truncate text-gold-muted">{tpl.name}</div>
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* @图片提及下拉菜单 */}
            {atImagePickerOpen && filteredAtImages.length > 0 && (
              <div
                ref={atDropdownRef}
                className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-lg border border-[#d4af37]/30 bg-[#1a1a1a] shadow-[0_0_15px_rgba(212,175,55,0.15)] z-50"
              >
                <div className="px-2 py-1 text-[10px] text-gray-500 border-b border-white/5">
                  输入 @ 引用画布图片作为参考
                </div>
                {filteredAtImages.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => handleSelectAtImage(img)}
                    className={`w-full text-left px-2 py-1.5 text-sm border-b border-white/5 last:border-0 transition-colors flex items-center gap-2 ${i === atImageIndex ? 'bg-[#d4af37]/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                  >
                    <img
                      src={img.url}
                      alt=""
                      className="w-8 h-8 rounded object-cover flex-shrink-0 border border-white/10"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="truncate flex-1">{img.displayLabel}</span>
                    <span className="text-[10px] text-gray-500 flex-shrink-0">#{img.number}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPromptExpanded(!promptExpanded)}
              className={`absolute right-1.5 ${promptExpanded ? 'bottom-1.5' : 'bottom-1.5'} p-0.5 rounded ${isMonochrome ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-[#2a2a2a] text-gray-500'} transition-colors`}
              title={promptExpanded ? '收起输入框' : '展开输入框'}
            >
              {promptExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <p className={`text-xs ${thTextMuted} mt-0.5`}>Enter 提交 · Shift+Enter 换行</p>
          </div>

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 图像模型选择 - 执行修图 */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-xs ${thTextSecondary} font-medium`}>图像模型</span>
              <span className="text-[10px] text-green-400/70 bg-green-400/10 px-1.5 py-0.5 rounded">执行修图</span>
            </div>
            <button
              onClick={() => setModelListExpanded(!modelListExpanded)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg ${thInput} text-sm ${isMonochrome ? "hover:border-gray-400" : "hover:border-[#d4af37]"} transition-all`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentModelSupportsMask ? 'bg-green-500' : 'bg-amber-500'}`} />
                <span className="truncate">{currentModelName}</span>
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <span className={`text-xs ${currentModelSupportsMask ? 'text-green-500' : 'text-amber-500'}`}>
                  {currentModelSupportsMask ? '支持涂抹' : '仅文字修图'}
                </span>
                {modelListExpanded ? <ChevronUp size={12} className={thTextSecondary} /> : <ChevronDown size={12} className={thTextSecondary} />}
              </span>
            </button>

            {modelListExpanded && (
              <div className={`mt-1 max-h-56 overflow-y-auto rounded-lg border ${thDropdown}`}>
                <div className={`px-2 py-1 text-sm ${thTextMuted} uppercase tracking-wider border-b ${thBorderLight}`}>图像模型</div>
                {imageModels.length > 0 ? imageModels.map(model => {
                  const key = `server::${model.providerId}::${model.id}`;
                  const isSelected = selectedModelKey === key;
                  return renderModelItem(model, key, isSelected, model.supportsMask);
                }) : (
                  <div className={`px-3 py-3 text-center text-xs ${thTextMuted}`}>
                    管理员系统中暂无图像模型
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* LLM 协作模型 - 分析原图+优化指令 */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-xs ${thTextSecondary} font-medium`}>LLM 协作模型</span>
              <span className="text-[10px] text-blue-400/70 bg-blue-400/10 px-1.5 py-0.5 rounded">分析原图 + 优化指令</span>
            </div>
            <button
              onClick={() => setLlmListExpanded(!llmListExpanded)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg ${thInput} text-sm ${isMonochrome ? (selectedLlmKey ? "hover:border-blue-400" : "border-blue-400") : (selectedLlmKey ? "hover:border-[#d4af37]" : "border-[#d4af37]/50")} transition-all`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${selectedLlmKey ? "bg-blue-400" : isMonochrome ? "bg-blue-500 animate-pulse" : "bg-[#d4af37] animate-pulse"}`} />
                <span className="truncate">{currentLlmModelName}</span>
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <span className={`text-xs ${selectedLlmKey ? "text-blue-400" : isMonochrome ? "text-blue-500" : "text-[#d4af37]"}`}>
                  {selectedLlmKey ? '协作模式' : '请选择'}
                </span>
                {llmListExpanded ? <ChevronUp size={12} className={thTextSecondary} /> : <ChevronDown size={12} className={thTextSecondary} />}
              </span>
            </button>

            {llmListExpanded && (
              <div className={`mt-1 max-h-48 overflow-y-auto rounded-lg border ${thDropdown}`}>
                <div className={`px-2 py-1 text-sm ${thTextMuted} uppercase tracking-wider border-b ${thBorderLight}`}>
                  LLM 模型 — 分析原图内容，优化编辑指令
                </div>
                {llmModels.length > 0 ? llmModels.map(model => {
                  const key = `server::${model.providerId}::${model.id}`;
                  const isSelected = selectedLlmKey === key;
                  return (
                    <button
                      key={key}
                      onClick={() => handleLlmSelect(key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-all border-b ${thBorderLight} last:border-b-0 ${
                        isSelected
                          ? `${thAccentLight} ${thAccentLightText}`
                          : thDropdownItem
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate">{model.name}</span>
                          {model.providerName && <span className="shrink-0 text-[10px] px-1 py-0.5 bg-blue-400/20 text-blue-400 rounded">{fixProviderName(model.providerName)}</span>}
                        </div>
                        <div className={`text-xs ${thTextMuted} truncate`}>{fixProviderName(model.providerName)} · 分析原图+优化指令</div>
                      </div>
                      {isSelected && <Check size={12} className={`${isMonochrome ? "text-blue-500" : "text-[#d4af37]"} flex-shrink-0`} />}
                    </button>
                  );
                }) : (
                  <div className={`px-3 py-3 text-center text-xs ${thTextMuted}`}>
                    管理员系统中暂无LLM模型
                  </div>
                )}
              </div>
            )}
            {!selectedLlmKey && (
              <div className={`mt-0.5 text-xs flex items-center gap-1 ${isMonochrome ? "text-gray-500" : "text-[#d4af37]/70"}`}>
                <Sparkles className="h-2.5 w-2.5" />
                选择LLM模型可智能分析原图，生成精准编辑指令
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 协作流程指示 */}
          {selectedLlmKey && selectedModelKey && (
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded ${thBgDeep} border ${thBorderLight}`}>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="text-[10px] text-blue-400">LLM分析</span>
              </div>
              <span className={`text-[10px] ${isMonochrome ? "text-gray-300" : "text-gray-600"}`}>→</span>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isMonochrome ? "bg-gray-700" : "bg-[#d4af37]"}`} />
                <span className={`text-[10px] ${isMonochrome ? "text-blue-500" : "text-[#d4af37]"}`}>优化指令</span>
              </div>
              <span className={`text-[10px] ${isMonochrome ? "text-gray-300" : "text-gray-600"}`}>→</span>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-[10px] text-green-500">图像执行</span>
              </div>
            </div>
          )}

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 参数行 - 画面比例/质量/生图数量 一行三列 */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={`text-xs ${thTextSecondary} mb-1 block`}>画面比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className={`w-full px-2.5 py-2 ${thInput} rounded text-sm appearance-none cursor-pointer focus:outline-none`}
              >
                {availableRatios.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className={`text-xs ${thTextSecondary} mb-1 block`}>图片质量</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className={`w-full px-2.5 py-2 ${thInput} rounded text-sm appearance-none cursor-pointer focus:outline-none`}
              >
                {availableQualities.map(q => <option key={q} value={q}>{QUALITY_DISPLAY_NAMES[q] || q}</option>)}
              </select>
            </div>
            <div>
              <label className={`text-xs ${thTextSecondary} mb-1 block`}>生图数量</label>
              <select
                value={outputCount}
                onChange={(e) => setOutputCount(Number(e.target.value))}
                className={`w-full px-2.5 py-2 ${thInput} rounded text-sm appearance-none cursor-pointer focus:outline-none`}
              >
                {COUNTS.map(c => <option key={c} value={c}>{c}张</option>)}
              </select>
            </div>
          </div>

          {/* 错误 */}
          {error && (
            <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* 分隔线 */}
          <div className={`border-t ${thBorderLight}`} />

          {/* 生成按钮 */}
          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim() || !selectedModelKey}
            className={`w-full py-2 rounded-lg ${isMonochrome ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gradient-to-r from-[#d4af37] to-[#b8860b] hover:from-[#daa520] hover:to-[#cd9b1d] text-black"} text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />修改中...</>
            ) : (
              <><Sparkles className="h-4 w-4" />开始修改</>
            )}
          </button>

          {/* 编辑历史 */}
          {history.length > 0 && (
            <div className={`pt-2 border-t ${thBorder}`}>
              <div className={`flex items-center gap-1.5 text-sm ${thTextSecondary} mb-1`}>
                <History className="h-3 w-3" />
                <span className={`font-medium ${isMonochrome ? "text-gray-900" : "text-[#d4af37]"}`}>编辑历史</span>
              </div>
              <div className="max-h-20 overflow-y-auto space-y-0.5">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryClick(index)}
                    className={`w-full text-left px-2 py-1 rounded text-xs transition-all flex items-center gap-1 ${
                      index === currentHistoryIndex
                        ? `${isMonochrome ? 'bg-gray-200 text-gray-900' : 'bg-[#d4af37]/20 text-[#d4af37]'}`
                        : `${isMonochrome ? 'bg-gray-100 text-gray-500 hover:text-gray-900' : 'bg-[#1a1a1a] text-gray-400 hover:text-white'}`
                    }`}
                  >
                    <span>#{index + 1}</span>
                    <span className="truncate flex-1">{item.prompt}</span>
                    {index === currentHistoryIndex && <Check className={`h-3 w-3 ${isMonochrome ? "text-blue-500" : "text-[#d4af37]"} flex-shrink-0`} />}
                  </button>
                ))}
              </div>
            </div>
          )}
      {/* One result subtree: visible-viewport mobile flow, desktop side panel. */}
      {(isResultLoading || resultImages.length > 0) && (
        <div
          ref={resultContainerRef}
          className={`${inlineResults ? 'relative w-full min-w-0' : 'fixed z-[201] overflow-y-auto'} ${isMonochrome ? "bg-white border border-gray-200" : "bg-[#1a1a1a] border border-white/[0.08]"} rounded-xl shadow-2xl overflow-x-hidden`}
          style={inlineResults ? undefined : {
            left: position.x + panelWidth + 20, top: position.y, width: resultWidth, margin: 0,
            maxHeight: Math.max(0, Math.min(panelMaxHeight, panelViewport.top + panelViewport.height - 8 - position.y)),
          }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          data-popup
        >
          <div className={`flex items-center justify-between px-3 py-2 border-b ${thBorder}`}>
            <h3 className={`text-sm font-medium ${thText} flex items-center gap-1.5`}>
              <ImageIcon className={`h-3.5 w-3.5 ${isMonochrome ? "text-blue-500" : "text-[#d4af37]"}`} />
              修图结果
            </h3>
            {resultImages.length > 0 && (
              <button
                onClick={() => handleConfirmResult()}
                className={`px-2 py-0.5 text-xs ${isMonochrome ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-[#d4af37] hover:bg-[#daa520] text-black"} rounded font-medium transition-all`}
              >
                确认使用{resultImages.length > 1 && selectedResultIndexes.size > 0 ? ` (${selectedResultIndexes.size})` : ''}
              </button>
            )}
          </div>
          <div className="p-3">
            {isResultLoading ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: Math.max(1, Math.min(outputCount, 4)) }, (_, i) => {
                    const ratioParts = aspectRatio.split(':').map(Number);
                    const ratioW = ratioParts[0] || 1;
                    const ratioH = ratioParts[1] || 1;
                    return (
                      <div key={i} className={`relative ${isMonochrome ? "bg-gray-50" : "bg-[#1a1a1a]"} rounded-lg border-2 border-dashed ${isMonochrome ? "border-gray-300" : "border-white/[0.06]"} flex flex-col items-center justify-center overflow-hidden flex-shrink-0`}
                        style={{ aspectRatio: `${ratioW}/${ratioH}`, width: outputCount > 1 ? '200px' : '320px', maxWidth: '100%', maxHeight: '400px' }}
                      >
                        <div className="relative w-8 h-8 mb-1">
                          <div className={`absolute inset-0 border-2 ${isMonochrome ? "border-gray-200" : "border-white/[0.06]"} rounded-full`} />
                          <div className={`absolute inset-0 border-2 ${isMonochrome ? "border-gray-900" : "border-[#d4af37]"} rounded-full animate-spin`} />
                        </div>
                        <span className={`text-xs ${thTextMuted}`}>生成中 {outputCount > 1 ? `(${i + 1}/${outputCount})` : `${loadingProgress}%`}</span>
                      </div>
                    );
                  })}
                </div>
                {/* 进度信息栏：已用时间 + 取消按钮 */}
                <div className={`flex items-center justify-between px-1 py-1.5 rounded-lg ${isMonochrome ? "bg-gray-50" : "bg-[#222]"}`}>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={thTextMuted}>
                      进度 {loadingProgress}%
                    </span>
                    {editStartTimeRef.current && (
                      <span className={thTextMuted}>
                        已用时 {Math.floor((Date.now() - editStartTimeRef.current) / 60000)}:{String(Math.floor(((Date.now() - editStartTimeRef.current) % 60000) / 1000)).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleCancelEdit}
                    className={`px-2 py-0.5 text-xs rounded font-medium transition-all ${
                      isMonochrome
                        ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
                        : "bg-[#2a2a2a] hover:bg-[#333] text-gray-300"
                    }`}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : resultImages.length > 0 ? (
              <div className="flex flex-col gap-1.5">
              <div className={`flex gap-2 overflow-x-auto pb-1`}>
                {resultImages.length > 1 && (
                  <div className="flex items-center gap-1.5 mb-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        if (selectedResultIndexes.size === resultImages.length) {
                          setSelectedResultIndexes(new Set());
                        } else {
                          setSelectedResultIndexes(new Set(resultImages.map((_, i) => i)));
                        }
                      }}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
                        selectedResultIndexes.size === resultImages.length
                          ? `${isMonochrome ? 'bg-blue-500 text-white font-medium' : 'bg-[#d4af37] text-black font-medium'}`
                          : `${isMonochrome ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a]'}`
                      }`}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        {selectedResultIndexes.size === resultImages.length && (
                          <path d="M4 8L7 11L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        )}
                      </svg>
                      全选
                    </button>
                    <span className={`text-xs ${thTextMuted}`}>已选 {selectedResultIndexes.size}/{resultImages.length}</span>
                  </div>
                )}
                {resultImages.map((url, idx) => {
                  const ratioParts = aspectRatio.split(':').map(Number);
                  const ratioW = ratioParts[0] || 1;
                  const ratioH = ratioParts[1] || 1;
                  const isSelected = selectedResultIndexes.has(idx);
                  return (
                    <div key={idx} className={`relative ${isMonochrome ? "bg-gray-50" : "bg-[#1a1a1a]"} rounded-lg overflow-hidden cursor-pointer group flex-shrink-0 ${isSelected ? `ring-2 ${isMonochrome ? "ring-gray-900" : "ring-[#d4af37]"}` : ''}`}
                      style={{ aspectRatio: `${ratioW}/${ratioH}`, width: resultImages.length > 1 ? '200px' : '100%', maxHeight: '360px' }}
                      onClick={() => {
                        // 多图时点击切换选中，单图时直接使用
                        if (resultImages.length > 1) {
                          setSelectedResultIndexes(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) { next.delete(idx); } else { next.add(idx); }
                            return next;
                          });
                        } else {
                          handleConfirmResult(url);
                        }
                      }}
                    >
                      <img src={url} alt={`结果 ${idx + 1}`} className="w-full h-full object-contain rounded-lg" />
                      {/* 选中勾选框 */}
                      {resultImages.length > 1 && (
                        <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                          isSelected ? (isMonochrome ? "bg-blue-500" : "bg-[#d4af37]") : "bg-black/40 group-hover:bg-black/60"
                        }`}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M4 8L7 11L12 5" stroke={isMonochrome ? "#111827" : "black"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        {resultImages.length > 1 ? (
                          <span className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs text-white ${isMonochrome ? "bg-blue-500" : "bg-[#d4af37]"} px-2 py-1 rounded`}>
                            {isSelected ? '取消选择' : '选择'}
                          </span>
                        ) : (
                          <span className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs text-white ${isMonochrome ? "bg-blue-500" : "bg-[#d4af37]"} px-2 py-1 rounded`}>点击使用</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {editTotalTime !== null && (
              <div className={`text-xs text-center mt-1 ${isMonochrome ? "text-gray-400" : "text-[#999]"}`}>
                总耗时 {editTotalTime}s
              </div>
            )}
          </div>
        ) : null}
        {/* ★ LLM自动区域识别 - 非阻塞内联卡片，嵌入结果框底部 */}
            {pendingAutoRegions.length > 0 && (
              <div className={`${isMonochrome ? "bg-gray-50 border border-gray-300" : "bg-[#1a1a1a] border border-white/[0.08]"} rounded-lg p-2.5 mt-2`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isMonochrome ? "#374151" : "#d4af37"} strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                    </svg>
                    <span className={`${isMonochrome ? "text-gray-900" : "text-[#d4af37]"} text-xs font-semibold`}>AI 识别到编辑区域</span>
                  </div>
                  <button
                    onClick={() => { setPendingAutoRegions([]); setAutoMaskPreview(null); }}
                    className={`${isMonochrome ? "text-gray-400 hover:text-gray-700" : "text-[#666] hover:text-[#999]"} text-xs`}
                  >✕</button>
                </div>
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {pendingAutoRegions.map((region, idx) => (
                    <span key={idx} className={`inline-flex items-center gap-1 text-xs ${isMonochrome ? "text-gray-600 bg-gray-100" : "text-gray-400 bg-[#2a2a2a]"} rounded px-1.5 py-0.5`}>
                      <span className={`${isMonochrome ? "text-gray-900" : "text-[#d4af37]"} font-mono`}>{idx + 1}</span>
                      {region.label || `区域 ${idx + 1}`}
                    </span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleConfirmAutoMask}
                    className={`px-2.5 py-1 text-xs ${isMonochrome ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-[#d4af37] hover:bg-[#daa520] text-black"} rounded font-medium transition-all`}
                  >
                    应用蒙版
                  </button>
                  <button
                    onClick={() => { setPendingAutoRegions([]); setAutoMaskPreview(null); }}
                    className={`px-2.5 py-1 text-xs ${isMonochrome ? "bg-gray-100 hover:bg-gray-200 text-gray-500" : "bg-[#2a2a2a] hover:bg-[#3a3a3a] text-[#999]"} rounded font-medium transition-all`}
                  >
                    跳过
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        </div>
      </div>

      {/* ★ LLM自动区域识别 - 内嵌在结果框底部 */}
      {/* Moved inside the result container below */}

    </>
  );
}
