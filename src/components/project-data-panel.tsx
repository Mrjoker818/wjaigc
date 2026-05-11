'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, FolderOpen, Trash2, Search, Grid3X3, List, ArrowRight, CheckSquare, Square, Image as ImageIcon } from 'lucide-react';

interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt?: string;
  model?: string;
  createdAt?: number;
}

interface ProjectDataPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectDescription: string;
  images: CanvasImage[];
  onDeleteImages: (ids: string[]) => void;
  onNavigateToImage: (imageId: string) => void;
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
  isMonochrome = false,
}: ProjectDataPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    // 延迟绑定避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredImages = images.filter(img => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (img.prompt && img.prompt.toLowerCase().includes(q)) ||
      (img.model && img.model.toLowerCase().includes(q)) ||
      img.id.includes(q)
    );
  });

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

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    onDeleteImages(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsDeleteMode(false);
  };

  const bgColor = isMonochrome ? 'bg-white' : 'bg-[#141414]';
  const borderColor = isMonochrome ? 'border-gray-200' : 'border-[#2a2a2a]';
  const textColor = isMonochrome ? 'text-gray-900' : 'text-white';
  const mutedText = isMonochrome ? 'text-gray-500' : 'text-[#888]';
  const cardBg = isMonochrome ? 'bg-gray-50' : 'bg-[#1e1e1e]';
  const hoverBg = isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#252525]';
  const accentColor = isMonochrome ? '#333' : '#d4af37';

  return (
    <div
      ref={panelRef}
      onWheel={handleWheel}
      data-popup="project-data"
      className={`fixed left-16 top-16 w-[380px] max-h-[80vh] ${bgColor} border ${borderColor} rounded-2xl shadow-2xl z-[200] flex flex-col overflow-hidden transition-all duration-200`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4" style={{ color: accentColor }} />
          <span className={`text-sm font-semibold ${textColor}`}>项目数据</span>
        </div>
        <button
          onClick={onClose}
          className={`${mutedText} hover:${textColor} transition-colors`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Project Info */}
      <div className={`px-4 py-3 border-b ${borderColor}`}>
        <h3 className={`text-base font-bold ${textColor} mb-1`}>{projectName || '未命名项目'}</h3>
        <p className={`text-xs ${mutedText} mb-2`}>{projectDescription || '暂无简介'}</p>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${mutedText}`}>
            <ImageIcon className="h-3 w-3 inline mr-1" />
            {images.length} 张图片
          </span>
        </div>
      </div>

      {/* Search & Actions */}
      <div className={`px-4 py-2.5 border-b ${borderColor} flex items-center gap-2`}>
        <div className={`flex-1 flex items-center gap-1.5 ${cardBg} rounded-lg px-2.5 py-1.5`}>
          <Search className={`h-3 w-3 ${mutedText}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索图片..."
            className={`flex-1 bg-transparent text-xs ${textColor} outline-none placeholder:${mutedText}`}
          />
        </div>
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          className={`p-1.5 rounded-lg ${cardBg} ${mutedText} hover:${textColor} transition-colors`}
          title={viewMode === 'grid' ? '列表视图' : '网格视图'}
        >
          {viewMode === 'grid' ? <List className="h-3.5 w-3.5" /> : <Grid3X3 className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => {
            setIsDeleteMode(!isDeleteMode);
            if (isDeleteMode) setSelectedIds(new Set());
          }}
          className={`p-1.5 rounded-lg transition-colors ${
            isDeleteMode
              ? 'bg-red-500/20 text-red-400'
              : `${cardBg} ${mutedText} hover:text-red-400`
          }`}
          title="批量管理"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Batch Actions Bar */}
      {isDeleteMode && (
        <div className={`px-4 py-2 border-b ${borderColor} flex items-center justify-between`}>
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
          <div className="flex items-center gap-2">
            <span className={`text-xs ${mutedText}`}>
              已选 {selectedIds.size}/{filteredImages.length}
            </span>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
              >
                删除 ({selectedIds.size})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content Grid/List */}
      <div className="flex-1 overflow-y-auto px-3 py-2" style={{ maxHeight: '50vh' }}>
        {filteredImages.length === 0 ? (
          <div className={`text-center py-8 ${mutedText}`}>
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">暂无图片数据</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-3 gap-2">
            {filteredImages.map(img => (
              <div
                key={img.id}
                className={`group relative rounded-xl overflow-hidden border ${
                  selectedIds.has(img.id)
                    ? `border-2 border-red-400`
                    : `${borderColor}`
                } ${cardBg} cursor-pointer transition-all ${hoverBg}`}
                onClick={() => {
                  if (isDeleteMode) {
                    toggleSelect(img.id);
                  } else {
                    onNavigateToImage(img.id);
                  }
                }}
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-black/20 relative overflow-hidden">
                  <img
                    src={img.url}
                    alt={img.prompt || '图片'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Hover overlay */}
                  {!isDeleteMode && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span title="定位到图片"><ArrowRight className="h-4 w-4 text-white" /></span>
                    </div>
                  )}
                  {/* Delete mode checkbox */}
                  {isDeleteMode && (
                    <div className="absolute top-1 right-1">
                      {selectedIds.has(img.id) ? (
                        <CheckSquare className="h-4 w-4 text-red-400" />
                      ) : (
                        <Square className="h-4 w-4 text-white/60" />
                      )}
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="p-1.5">
                  <p className={`text-[10px] ${mutedText} truncate`}>
                    {img.prompt ? img.prompt.slice(0, 20) + (img.prompt.length > 20 ? '...' : '') : '无描述'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredImages.map(img => (
              <div
                key={img.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
                  selectedIds.has(img.id) ? 'bg-red-500/10' : cardBg
                } cursor-pointer transition-all ${hoverBg}`}
                onClick={() => {
                  if (isDeleteMode) {
                    toggleSelect(img.id);
                  } else {
                    onNavigateToImage(img.id);
                  }
                }}
              >
                {/* Thumbnail */}
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/20 flex-shrink-0">
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${textColor} truncate`}>
                    {img.prompt ? img.prompt.slice(0, 40) : '无描述'}
                  </p>
                  <p className={`text-[10px] ${mutedText}`}>
                    {img.model || '未知模型'} · {img.createdAt ? new Date(img.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                </div>
                {/* Action */}
                {isDeleteMode ? (
                  selectedIds.has(img.id) ? (
                    <CheckSquare className="h-4 w-4 text-red-400 flex-shrink-0" />
                  ) : (
                    <Square className={`h-4 w-4 ${mutedText} flex-shrink-0`} />
                  )
                ) : (
                  <ArrowRight className={`h-3.5 w-3.5 ${mutedText} flex-shrink-0`} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
