'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, FolderOpen, Trash2, Search, Grid3X3, List,
  CheckSquare, Square, Image as ImageIcon,
  Copy, Wand2, Download, ArrowUpDown,
  ChevronDown, Clock, Tag, SlidersHorizontal
} from 'lucide-react';
import JSZip from 'jszip';
import { constrainFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport } from '@/lib/floating-panel-position';

interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt?: string;
  model?: string;
  quality?: string;
  aspectRatio?: string;
  stylePreset?: string;
  category?: string;
  size?: string;
  createdAt?: number;
  negativePrompt?: string;
  modelName?: string;
  apiProvider?: string;
  mediaAvailability?: 'ready' | 'pending-persist' | 'missing' | 'recovering' | 'unrecoverable';
}

type SortOrder = 'newest' | 'oldest';

interface ProjectDataPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectDescription: string;
  images: CanvasImage[];
  onDeleteImages: (ids: string[]) => Promise<void> | void;
  onNavigateToImage: (imageId: string) => void;
  onMakeSame?: (image: CanvasImage) => void;
  isMonochrome?: boolean;
}

export function ProjectDataPanel({
  isOpen,
  onClose,
  projectName,
  projectDescription,
  images,
  onDeleteImages,
  onNavigateToImage,
  onMakeSame,
  isMonochrome = false,
}: ProjectDataPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isManageMode, setIsManageMode] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(getFloatingPanelViewport);

  useEffect(() => {
    if (!isOpen) return;
    const updateViewport = (): void => setViewport(getFloatingPanelViewport());
    updateViewport();
    return subscribeFloatingPanelViewport(updateViewport);
  }, [isOpen]);

  // 阻止滚轮事件冒泡到画布
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // 点击面板外关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredImages = images
    .filter(img => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (img.prompt && img.prompt.toLowerCase().includes(q)) ||
        (img.model && img.model.toLowerCase().includes(q)) ||
        (img.modelName && img.modelName.toLowerCase().includes(q)) ||
        img.id.includes(q)
      );
    })
    .sort((a, b) => {
      const ta = a.createdAt || 0;
      const tb = b.createdAt || 0;
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });
  const unavailableImages = images.filter((image) => (
    image.mediaAvailability === 'missing' || image.mediaAvailability === 'recovering' || image.mediaAvailability === 'unrecoverable'
  ));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredImages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredImages.map(img => img.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    await onDeleteImages(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsManageMode(false);
  };

  const handleCopyPrompt = async (img: CanvasImage) => {
    const parts: string[] = [];
    if (img.prompt) parts.push(img.prompt);
    if (img.negativePrompt) parts.push(`[反向: ${img.negativePrompt}]`);
    if (img.modelName || img.model) parts.push(`[模型: ${img.modelName || img.model}]`);
    if (img.aspectRatio) parts.push(`[比例: ${img.aspectRatio}]`);
    if (img.quality) parts.push(`[质量: ${img.quality}]`);
    const text = parts.join('\n') || '无提示词';
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(img.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(img.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const zip = new JSZip();
      const selectedImages = filteredImages.filter(img => selectedIds.has(img.id));
      let idx = 1;
      for (const img of selectedImages) {
        try {
          const resp = await fetch(img.url);
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
          const name = img.prompt
            ? `${idx}_${img.prompt.slice(0, 20).replace(/[/\\?%*:|"<>]/g, '_')}.${ext}`
            : `${idx}_image.${ext}`;
          zip.file(name, blob);
          idx++;
        } catch {
          // skip failed downloads
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName || 'assets'}_${selectedIds.size}images.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const bgColor = isMonochrome ? 'bg-white' : 'bg-[#141414]';
  const borderColor = isMonochrome ? 'border-gray-200' : 'border-[#2a2a2a]';
  const textColor = isMonochrome ? 'text-gray-900' : 'text-white';
  const mutedText = isMonochrome ? 'text-gray-500' : 'text-[#888]';
  const cardBg = isMonochrome ? 'bg-gray-50' : 'bg-[#1e1e1e]';
  const hoverBg = isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#252525]';
  const accentColor = isMonochrome ? '#333' : '#d4af37';
  const inputBg = isMonochrome ? 'bg-gray-100' : 'bg-[#1a1a1a]';
  const panelWidth = Math.min(420, Math.max(0, viewport.width - 16));
  const panelHeight = Math.min(viewport.height * 0.85, Math.max(0, viewport.height - 16));
  const panelPosition = constrainFloatingPanelPosition({
    x: 64 - viewport.left, y: 64 - viewport.top,
    viewportWidth: viewport.width, viewportHeight: viewport.height,
    panelWidth, panelHeight, margin: 8,
  });

  return (
    <div
      ref={panelRef}
      onWheel={handleWheel}
      data-popup="project-data"
      className={`fixed ${bgColor} border ${borderColor} rounded-2xl shadow-2xl z-[200] flex flex-col overflow-hidden [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&_input]:min-h-11`}
      style={{ left: viewport.left + panelPosition.x, top: viewport.top + panelPosition.y, width: panelWidth, maxHeight: panelHeight }}
    >
      {/* Header */}
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2 border-b ${borderColor}`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <FolderOpen className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
          <span className={`whitespace-nowrap text-sm font-semibold ${textColor}`}>资产库</span>
          <span className={`text-xs ${mutedText}`}>({images.length})</span>
          {unavailableImages.length > 0 && (
            <span className="text-[10px] text-amber-500">{unavailableImages.length} 个媒体需要恢复</span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="关闭资产库"
          className={`flex items-center justify-center rounded-lg ${mutedText} hover:${textColor} transition-colors`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {/* Project Info */}
      <div className={`px-4 py-2.5 border-b ${borderColor}`}>
        <h3 className={`break-words text-sm font-bold ${textColor} mb-0.5`}>{projectName || '未命名项目'}</h3>
        <p className={`break-words text-xs ${mutedText}`}>{projectDescription || '暂无简介'}</p>
      </div>

      {/* Search & Actions Bar */}
      <div className={`px-4 py-2.5 border-b ${borderColor} flex flex-wrap items-center gap-2`}>
        <div className={`min-w-0 basis-full sm:basis-0 flex-1 flex items-center gap-1.5 ${cardBg} rounded-lg px-2.5 py-1.5`}>
          <Search className={`h-3 w-3 ${mutedText}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索提示词/模型..."
            className={`min-w-0 w-full flex-1 bg-transparent text-xs ${textColor} outline-none placeholder:${mutedText}`}
          />
        </div>

        {/* Sort Button */}
        <div className="relative">
          <button
            onClick={() => setSortMenuOpen(!sortMenuOpen)}
            className={`p-1.5 rounded-lg ${cardBg} ${mutedText} hover:${textColor} transition-colors flex items-center justify-center gap-1`}
            title="排序"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
          {sortMenuOpen && (
            <div className={`absolute left-0 top-full ${bgColor} border ${borderColor} rounded-lg shadow-xl z-10 py-1 min-w-[120px]`}>
              <button
                onClick={() => { setSortOrder('newest'); setSortMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs ${sortOrder === 'newest' ? `text-[${accentColor}]` : mutedText} hover:${hoverBg}`}
              >
                <Clock className="h-3 w-3 inline mr-1.5" />最新优先
              </button>
              <button
                onClick={() => { setSortOrder('oldest'); setSortMenuOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs ${sortOrder === 'oldest' ? `text-[${accentColor}]` : mutedText} hover:${hoverBg}`}
              >
                <Clock className="h-3 w-3 inline mr-1.5 rotate-180" />最早优先
              </button>
            </div>
          )}
        </div>

        {/* View Mode Toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          className={`p-1.5 rounded-lg ${cardBg} ${mutedText} hover:${textColor} transition-colors`}
          title={viewMode === 'grid' ? '列表模式' : '大图模式'}
        >
          {viewMode === 'grid' ? <List className="h-3.5 w-3.5" /> : <Grid3X3 className="h-3.5 w-3.5" />}
        </button>

        {/* Batch Manage */}
        <button
          onClick={() => {
            setIsManageMode(!isManageMode);
            if (isManageMode) setSelectedIds(new Set());
          }}
          className={`p-1.5 rounded-lg transition-colors ${
            isManageMode
              ? 'bg-red-500/20 text-red-400'
              : `${cardBg} ${mutedText} hover:text-red-400`
          }`}
          title="批量管理"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-[10px] ml-0.5">{isManageMode ? '退出' : '管理'}</span>
        </button>
      </div>

      {/* Batch Actions Bar */}
      {isManageMode && (
        <div className={`px-4 py-2 border-b ${borderColor} flex flex-wrap items-center justify-between gap-2`}>
          <button
            onClick={selectAll}
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:${textColor} transition-colors`}
          >
            {selectedIds.size === filteredImages.length ? (
              <CheckSquare className="h-3.5 w-3.5" style={{ color: accentColor }} />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {selectedIds.size === filteredImages.length ? '取消全选' : '全选'}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs ${mutedText}`}>
              已选 {selectedIds.size}/{filteredImages.length}
            </span>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleBatchDownload}
                  disabled={downloading}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                  style={{ background: `${accentColor}22`, color: accentColor }}
                >
                  <Download className="h-3 w-3" />
                  {downloading ? '打包中...' : '下载压缩包'}
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                >
                  删除 ({selectedIds.size})
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Content Grid/List */}
      <div className="min-w-0 px-3 py-2">
        {filteredImages.length === 0 ? (
          <div className={`text-center py-8 ${mutedText}`}>
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">暂无图片数据</p>
          </div>
        ) : viewMode === 'grid' ? (
          /* ========== 大图模式 ========== */
          <div className="grid gap-2.5" style={{ gridTemplateColumns: viewport.width < 640 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))' }}>
            {filteredImages.map(img => (
              <div
                key={img.id}
                className={`group relative rounded-xl overflow-hidden border ${
                  selectedIds.has(img.id)
                    ? 'border-2 border-red-400'
                    : borderColor
                } ${cardBg} transition-all ${hoverBg}`}
              >
                {/* Thumbnail */}
                <div
                  className="aspect-square bg-black/20 relative overflow-hidden cursor-pointer"
                  onClick={() => {
                    if (isManageMode) {
                      toggleSelect(img.id);
                    } else {
                      onNavigateToImage(img.id);
                    }
                  }}
                >
                  <img
                    src={img.url}
                    alt={img.prompt || '图片'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Hover overlay - non-manage mode */}
                  {!isManageMode && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span title="定位到图片" className="text-white text-xs">点击定位</span>
                    </div>
                  )}
                  {/* Manage mode checkbox */}
                  {isManageMode && (
                    <div className="absolute top-1.5 right-1.5 cursor-pointer" onClick={() => toggleSelect(img.id)}>
                      {selectedIds.has(img.id) ? (
                        <CheckSquare className="h-4 w-4 text-red-400" />
                      ) : (
                        <Square className="h-4 w-4 text-white/60" />
                      )}
                    </div>
                  )}
                  {/* Time badge */}
                  {img.createdAt && (
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[9px] text-white/80">
                      {formatTime(img.createdAt)}
                    </div>
                  )}
                </div>

                {/* Prompt + Actions area */}
                <div className="p-2">
                  {/* Prompt box */}
                  <div className={`text-[10px] ${mutedText} leading-relaxed mb-1.5 min-h-[24px] line-clamp-2`}>
                    {img.prompt || '无提示词'}
                  </div>
                  {/* Model info */}
                  <div className="flex items-center gap-1 mb-1.5 flex-wrap">
                    {img.modelName && (
                      <span className={`inline-flex max-w-full break-all items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${inputBg}`}>
                        <Tag className="h-2.5 w-2.5" />
                        {img.modelName}
                      </span>
                    )}
                    {img.aspectRatio && (
                      <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] ${inputBg}`}>
                        {img.aspectRatio}
                      </span>
                    )}
                    {img.quality && (
                      <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] ${inputBg}`}>
                        {img.quality}
                      </span>
                    )}
                  </div>
                  {/* Action buttons */}
                  {!isManageMode && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onMakeSame?.(img); }}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors"
                        style={{ background: `${accentColor}22`, color: accentColor }}
                        title="制作同款"
                      >
                        <Wand2 className="h-3 w-3" />
                        同款
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyPrompt(img); }}
                        className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium ${inputBg} ${mutedText} hover:${textColor} transition-colors`}
                        title="复制关键词"
                      >
                        <Copy className="h-3 w-3" />
                        {copiedId === img.id ? '已复制' : '复制'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ========== 列表模式 ========== */
          <div className="flex flex-col gap-1">
            {filteredImages.map(img => (
              <div
                key={img.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl ${
                  selectedIds.has(img.id) ? 'bg-red-500/10' : cardBg
                } cursor-pointer transition-all ${hoverBg}`}
                onClick={() => {
                  if (isManageMode) {
                    toggleSelect(img.id);
                  } else {
                    onNavigateToImage(img.id);
                  }
                }}
              >
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/20 flex-shrink-0">
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${textColor} line-clamp-2 leading-relaxed`}>
                    {img.prompt || '无提示词'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {img.modelName && (
                      <span className={`inline-flex max-w-full break-all items-center gap-0.5 text-[9px] ${mutedText}`}>
                        <Tag className="h-2.5 w-2.5" />{img.modelName}
                      </span>
                    )}
                    {img.aspectRatio && (
                      <span className={`text-[9px] ${mutedText}`}>{img.aspectRatio}</span>
                    )}
                    {img.quality && (
                      <span className={`text-[9px] ${mutedText}`}>{img.quality}</span>
                    )}
                    {img.createdAt && (
                      <span className={`text-[9px] ${mutedText}`}>
                        <Clock className="h-2.5 w-2.5 inline mr-0.5" />{formatTime(img.createdAt)}
                      </span>
                    )}
                  </div>
                  {/* List mode action buttons */}
                  {!isManageMode && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onMakeSame?.(img); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                        style={{ background: `${accentColor}22`, color: accentColor }}
                      >
                        <Wand2 className="h-2.5 w-2.5" />制作同款
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyPrompt(img); }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${inputBg} ${mutedText} hover:${textColor} transition-colors`}
                      >
                        <Copy className="h-2.5 w-2.5" />{copiedId === img.id ? '已复制' : '复制关键词'}
                      </button>
                    </div>
                  )}
                </div>
                {/* Manage mode checkbox */}
                {isManageMode && (
                  <div className="flex-shrink-0 mt-1">
                    {selectedIds.has(img.id) ? (
                      <CheckSquare className="h-4 w-4 text-red-400" />
                    ) : (
                      <Square className={`h-4 w-4 ${mutedText}`} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
