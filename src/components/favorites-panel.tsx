'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Heart, Grid3X3, List, Search, Sparkles, Trash2, Clock, User, Copy, ChevronDown, ChevronUp, Image as ImageIcon, Download, Upload, Shuffle, Eye, ArrowRight, Tag, Filter, SortAsc, FolderOpen, CheckSquare, Square, GripHorizontal } from 'lucide-react';
import { constrainFloatingPanelPosition, getCenteredFloatingPanelPosition, getFloatingPanelViewport, subscribeFloatingPanelViewport } from '@/lib/floating-panel-position';

export interface FavoriteItem {
    id: number | string;
    userId?: string;
    imageUrl: string;
    prompt?: string;
    negativePrompt?: string;
    model?: string;
    modelName?: string;
    aspectRatio?: string;
    quality?: string;
    imageWidth?: number;
    imageHeight?: number;
    originalWidth?: number;
    originalHeight?: number;
    apiProvider?: string;
    apiBaseUrl?: string;
    sourceType?: string;
    createdAt?: string;
    username?: string;
    tags?: string[];
    useCount?: number;
}

interface FavoritesPanelProps {
    userId: string;
    onClose: () => void;
    isMonochrome?: boolean;
    onApplyParams?: (item: FavoriteItem) => void;
}

const LOCAL_KEY = 'wujie-favorites-local';

function getLocalFavorites(userId: string): FavoriteItem[] {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw);
        return Array.isArray(all) ? all.filter((f: FavoriteItem) => f.userId === userId) : [];
    } catch { return []; }
}

function saveLocalFavorites(items: FavoriteItem[]) {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        const existing: FavoriteItem[] = raw ? JSON.parse(raw) : [];
        const ids = new Set(items.map(f => String(f.id)));
        const merged = [...existing.filter(f => !ids.has(String(f.id))), ...items];
        localStorage.setItem(LOCAL_KEY, JSON.stringify(merged));
    } catch { /* ignore */ }
}

export function FavoritesPanel({ userId, onClose, isMonochrome, onApplyParams }: FavoritesPanelProps) {
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [expandedId, setExpandedId] = useState<string | number | null>(null);
    const [appliedId, setAppliedId] = useState<string | number | null>(null);
    const [previewItem, setPreviewItem] = useState<FavoriteItem | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
    const [batchMode, setBatchMode] = useState(false);
    const [sortBy, setSortBy] = useState<'time' | 'model' | 'usage'>('time');
    const [filterModel, setFilterModel] = useState<string>('all');
    const [windowSize, setWindowSize] = useState({ w: 1020, h: 720 });
    const [viewport, setViewport] = useState(getFloatingPanelViewport);
    const [position, setPosition] = useState(() => {
        const view = getFloatingPanelViewport();
        const centered = getCenteredFloatingPanelPosition({ viewportWidth: view.width, viewportHeight: view.height, panelWidth: 1020, panelHeight: 720, margin: 8 });
        return { x: view.left + centered.x, y: view.top + centered.y };
    });
    const panelRef = useRef<HTMLDivElement>(null);
    const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const updateViewport = (): void => setViewport(getFloatingPanelViewport());
        updateViewport();
        return subscribeFloatingPanelViewport(updateViewport);
    }, []);

    const panelWidth = Math.min(windowSize.w, Math.max(0, viewport.width - 16));
    const panelHeight = Math.min(windowSize.h, viewport.height * 0.9, Math.max(0, viewport.height - 16));
    const panelPosition = constrainFloatingPanelPosition({
        x: position.x - viewport.left, y: position.y - viewport.top,
        viewportWidth: viewport.width, viewportHeight: viewport.height,
        panelWidth, panelHeight, margin: 8,
    });

    // Theme colors for Monochrome - white bg, blue accent
    const mc = !!isMonochrome;
    const bg = mc ? '#ffffff' : '#141414';
    const bgCard = mc ? '#f8fafc' : 'rgba(255,255,255,0.02)';
    const bgCardHover = mc ? '#f1f5f9' : 'rgba(255,255,255,0.04)';
    const border = mc ? 'rgba(203,213,225,0.6)' : 'rgba(212,175,55,0.15)';
    const borderLight = mc ? 'rgba(203,213,225,0.3)' : 'rgba(212,175,55,0.08)';
    const accent = mc ? '#3b82f6' : '#d4af37';
    const accentBg = mc ? 'rgba(59,130,246,0.08)' : 'rgba(212,175,55,0.08)';
    const accentBgHover = mc ? 'rgba(59,130,246,0.15)' : 'rgba(212,175,55,0.15)';
    const textPrimary = mc ? '#0f172a' : '#e2e8f0';
    const textSecondary = mc ? '#475569' : '#94a3b8';
    const textMuted = mc ? '#94a3b8' : '#64748b';
    const inputBg = mc ? '#f1f5f9' : 'rgba(255,255,255,0.04)';

    const fetchFavorites = useCallback(async (p: number) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/favorites?userId=${encodeURIComponent(userId)}&page=${p}&limit=20`);
            const data = await res.json();
            if (data.success && data.favorites) {
                const items = data.favorites.map((f: Record<string, unknown>) => ({
                    id: f.id as number,
                    userId: f.user_id as string,
                    imageUrl: f.image_url as string,
                    prompt: (f.prompt as string) || '',
                    negativePrompt: (f.negative_prompt as string) || '',
                    model: (f.model as string) || '',
                    modelName: (f.model_name as string) || '',
                    aspectRatio: (f.aspect_ratio as string) || '',
                    quality: (f.quality as string) || '',
                    imageWidth: (f.image_width as number) || 0,
                    imageHeight: (f.image_height as number) || 0,
                    originalWidth: (f.original_width as number) || 0,
                    originalHeight: (f.original_height as number) || 0,
                    apiProvider: (f.api_provider as string) || '',
                    apiBaseUrl: (f.api_base_url as string) || '',
                    sourceType: (f.source_type as string) || '',
                    createdAt: String(f.created_at || ''),
                    username: (f.username as string) || '',
                    tags: (f.tags as string[]) || [],
                    useCount: (f.use_count as number) || 0,
                }));
                setFavorites(items);
                saveLocalFavorites(items);
                setTotalPages(data.pagination?.totalPages || 1);
            } else {
                const local = getLocalFavorites(userId);
                setFavorites(local);
                setTotalPages(1);
            }
        } catch {
            const local = getLocalFavorites(userId);
            setFavorites(local);
            setTotalPages(1);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => { fetchFavorites(page); }, [fetchFavorites, page]);

    const handleDelete = async (id: number | string) => {
        try {
            await fetch(`/api/favorites?id=${id}&userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
        } catch { /* fallback: just remove from local */ }
        setFavorites(prev => prev.filter(f => f.id !== id));
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) {
            try {
                const all = JSON.parse(raw);
                localStorage.setItem(LOCAL_KEY, JSON.stringify(all.filter((f: FavoriteItem) => String(f.id) !== String(id))));
            } catch { /* ignore */ }
        }
    };

    const handleBatchDelete = async () => {
        for (const id of selectedIds) {
            await handleDelete(id);
        }
        setSelectedIds(new Set());
        setBatchMode(false);
    };

    const handleApply = (item: FavoriteItem) => {
        if (onApplyParams) {
            onApplyParams(item);
            setAppliedId(item.id);
            setTimeout(() => setAppliedId(null), 1500);
        }
    };

    const handleCopyPrompt = (prompt: string) => {
        navigator.clipboard.writeText(prompt).catch(() => {});
    };

    // Export favorites as JSON
    const handleExport = () => {
        const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wujie-favorites-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Import favorites from JSON
    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target?.result as string);
                if (Array.isArray(imported)) {
                    const valid = imported.filter((f: FavoriteItem) => f.imageUrl);
                    setFavorites(prev => {
                        const existingIds = new Set(prev.map(f => String(f.id)));
                        const newItems = valid.filter((f: FavoriteItem) => !existingIds.has(String(f.id)));
                        return [...prev, ...newItems];
                    });
                    saveLocalFavorites([...favorites, ...valid]);
                }
            } catch { /* ignore invalid JSON */ }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // Random pick
    const handleRandomPick = () => {
        if (filtered.length === 0) return;
        const idx = Math.floor(Math.random() * filtered.length);
        setPreviewItem(filtered[idx]);
    };

    // Filtering and sorting
    const modelNames = [...new Set(favorites.map(f => f.modelName).filter(Boolean))];
    const filtered = (() => {
        let result = searchQuery
            ? favorites.filter(f =>
                (f.prompt || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (f.modelName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (f.username || '').toLowerCase().includes(searchQuery.toLowerCase())
            )
            : favorites;
        if (filterModel !== 'all') {
            result = result.filter(f => f.modelName === filterModel);
        }
        if (sortBy === 'model') {
            result = [...result].sort((a, b) => (a.modelName || '').localeCompare(b.modelName || ''));
        } else if (sortBy === 'usage') {
            result = [...result].sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        }
        return result;
    })();

    // Search highlight
    const highlightText = (text: string, query: string) => {
        if (!query) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return (
            <>
                {text.slice(0, idx)}
                <mark style={{ background: mc ? 'rgba(59,130,246,0.2)' : 'rgba(212,175,55,0.3)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + query.length)}</mark>
                {text.slice(idx + query.length)}
            </>
        );
    };

    // Drag to move window
    const handleDragStart = (e: React.MouseEvent) => {
        if (!panelRef.current) return;
        const rect = panelRef.current.getBoundingClientRect();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current || !panelRef.current) return;
            const dx = ev.clientX - dragRef.current.startX;
            const dy = ev.clientY - dragRef.current.startY;
            setPosition({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
        };
        const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // Resize handle
    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: windowSize.w, origH: windowSize.h };
        const onMove = (ev: MouseEvent) => {
            if (!resizeRef.current) return;
            const newW = Math.max(600, resizeRef.current.origW + (ev.clientX - resizeRef.current.startX));
            const newH = Math.max(400, resizeRef.current.origH + (ev.clientY - resizeRef.current.startY));
            setWindowSize({ w: newW, h: newH });
        };
        const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const formatTime = (ts: string) => {
        if (!ts) return '';
        const d = new Date(Number(ts));
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const toggleSelect = (id: string | number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Wheel event stop propagation to prevent canvas zoom
    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation();
    };

    return (
        <div className="fixed inset-0 z-[150]" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
            <div
                ref={panelRef}
                onClick={e => e.stopPropagation()}
                onWheel={handleWheel}
                className="fixed shadow-2xl flex flex-col overflow-hidden [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&_input]:min-h-11 [&_select]:min-h-11 [&_select]:min-w-0 [&_select]:max-w-full [&_p]:break-words"
                style={{
                    width: panelWidth,
                    height: panelHeight,
                    top: viewport.top + panelPosition.y, left: viewport.left + panelPosition.x,
                    borderRadius: 16,
                    background: bg,
                    border: `1px solid ${border}`,
                    boxShadow: mc ? '0 25px 60px rgba(0,0,0,0.12)' : '0 25px 60px rgba(0,0,0,0.5)',
                }}
            >
                {/* Title bar - draggable */}
                <div
                    onMouseDown={handleDragStart}
                    className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2 cursor-move select-none flex-shrink-0"
                    style={{ borderBottom: `1px solid ${borderLight}`, background: mc ? '#f8fafc' : 'rgba(255,255,255,0.02)' }}
                >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                        <Heart size={18} className="shrink-0" fill={accent} stroke={accent} />
                        <span className="whitespace-nowrap text-[15px] font-semibold tracking-wide" style={{ color: textPrimary }}>收藏夹</span>
                        <span className="text-xs ml-1" style={{ color: textMuted }}>{filtered.length} 项</span>
                        {batchMode && selectedIds.size > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: accentBg, color: accent }}>已选 {selectedIds.size}</span>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {/* Batch mode toggle */}
                        <button
                            onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }}
                            className="p-1.5 rounded-md transition-colors"
                            style={{ background: batchMode ? accentBg : 'transparent', color: batchMode ? accent : textMuted }}
                            title="批量管理"
                        >
                            <CheckSquare size={15} />
                        </button>
                        <button onClick={onClose} aria-label="关闭收藏夹" className="flex items-center justify-center p-1.5 rounded-md transition-colors hover:opacity-70" style={{ color: textMuted }}>
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {/* Toolbar: Search + Actions */}
                <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5" style={{ borderBottom: `1px solid ${borderLight}` }}>
                    {/* Search */}
                    <div className="min-w-0 basis-full lg:basis-0 flex-1 flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: inputBg, border: `1px solid ${borderLight}` }}>
                        <Search size={14} style={{ color: textMuted }} />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="搜索关键词、模型、用户..."
                            className="min-w-0 w-full flex-1 bg-transparent text-sm outline-none"
                            style={{ color: textPrimary }}
                        />
                    </div>
                    {/* Sort */}
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as 'time' | 'model' | 'usage')}
                        className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                        style={{ background: inputBg, border: `1px solid ${borderLight}`, color: textSecondary }}
                    >
                        <option value="time">按时间</option>
                        <option value="model">按模型</option>
                        <option value="usage">按使用</option>
                    </select>
                    {/* Filter by model */}
                    {modelNames.length > 1 && (
                        <select
                            value={filterModel}
                            onChange={e => setFilterModel(e.target.value)}
                            className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                            style={{ background: inputBg, border: `1px solid ${borderLight}`, color: textSecondary }}
                        >
                            <option value="all">全部模型</option>
                            {modelNames.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    )}
                    {/* View toggle */}
                    <div className="flex items-center rounded-lg overflow-hidden" style={{ border: `1px solid ${borderLight}` }}>
                        <button aria-label="网格视图" onClick={() => setViewMode('grid')} className="p-1.5 transition-colors" style={{ background: viewMode === 'grid' ? accentBg : 'transparent' }}>
                            <Grid3X3 size={14} style={{ color: viewMode === 'grid' ? accent : textMuted }} />
                        </button>
                        <button aria-label="列表视图" onClick={() => setViewMode('list')} className="p-1.5 transition-colors" style={{ background: viewMode === 'list' ? accentBg : 'transparent' }}>
                            <List size={14} style={{ color: viewMode === 'list' ? accent : textMuted }} />
                        </button>
                    </div>
                    {/* Action buttons */}
                    <button onClick={handleRandomPick} className="p-1.5 rounded-lg transition-colors" style={{ color: textMuted }} title="随机推荐">
                        <Shuffle size={15} />
                    </button>
                    <button onClick={handleExport} className="p-1.5 rounded-lg transition-colors" style={{ color: textMuted }} title="导出收藏">
                        <Download size={15} />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg transition-colors" style={{ color: textMuted }} title="导入收藏">
                        <Upload size={15} />
                    </button>
                    <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
                </div>

                {/* Batch action bar */}
                {batchMode && (
                    <div className="flex flex-wrap items-center gap-3 px-3 sm:px-5 py-2" style={{ background: mc ? '#eff6ff' : 'rgba(59,130,246,0.06)', borderBottom: `1px solid ${borderLight}` }}>
                        <button
                            onClick={() => setSelectedIds(new Set(filtered.map(f => f.id)))}
                            className="text-xs px-2.5 py-1 rounded-md transition-colors"
                            style={{ background: accentBg, color: accent }}
                        >全选</button>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            className="text-xs px-2.5 py-1 rounded-md transition-colors"
                            style={{ background: inputBg, color: textSecondary }}
                        >取消全选</button>
                        {selectedIds.size > 0 && (
                            <button
                                onClick={handleBatchDelete}
                                className="text-xs px-2.5 py-1 rounded-md transition-colors"
                                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                            >删除选中 ({selectedIds.size})</button>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="min-w-0 p-4" style={{ scrollbarWidth: 'thin' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-16 gap-2" style={{ color: textMuted }}>
                            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: `${accent}33`, borderTopColor: accent }} />
                            <span className="text-sm">加载中...</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16" style={{ color: textMuted }}>
                            <Heart size={40} strokeWidth={1} className="mb-3" />
                            <p className="text-sm">暂无收藏</p>
                            <p className="text-xs mt-1" style={{ color: textMuted }}>右键画布图片可添加到收藏夹</p>
                        </div>
                    ) : viewMode === 'grid' ? (
                        <div className="grid gap-3" style={{ gridTemplateColumns: viewport.width < 768 || panelWidth < 640 ? 'minmax(0, 1fr)' : panelWidth < 960 ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))' }}>
                            {filtered.map(item => (
                                <div
                                    key={item.id}
                                    className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
                                    style={{
                                        background: bgCard,
                                        border: expandedId === item.id ? `1.5px solid ${accent}` : `1px solid ${borderLight}`,
                                    }}
                                    onClick={() => {
                                        if (batchMode) { toggleSelect(item.id); return; }
                                        setExpandedId(expandedId === item.id ? null : item.id);
                                    }}
                                >
                                    {/* Selection checkbox */}
                                    {batchMode && (
                                        <div className="absolute top-2 left-2 z-10">
                                            {selectedIds.has(item.id) ? (
                                                <CheckSquare size={16} style={{ color: accent }} />
                                            ) : (
                                                <Square size={16} style={{ color: textMuted }} />
                                            )}
                                        </div>
                                    )}
                                    {/* Image */}
                                    <div className="relative aspect-square" style={{ background: mc ? '#e2e8f0' : 'rgba(255,255,255,0.05)' }}>
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                        {/* Hover overlay */}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex flex-wrap items-center justify-center gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                                            <button
                                                onClick={e => { e.stopPropagation(); handleApply(item); }}
                                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 transition-transform hover:scale-105"
                                                style={{ background: accent }}
                                            >
                                                <Sparkles size={12} />
                                                调用
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); setPreviewItem(item); }}
                                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 transition-transform hover:scale-105"
                                                style={{ background: 'rgba(0,0,0,0.5)' }}
                                            >
                                                <Eye size={12} />
                                                预览
                                            </button>
                                        </div>
                                        {/* Applied indicator */}
                                        {appliedId === item.id && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: accent, color: mc ? '#fff' : '#141414' }}>已调用</span>
                                            </div>
                                        )}
                                    </div>
                                    {/* Info */}
                                    <div className="p-2.5">
                                        <p className="text-xs truncate leading-snug" style={{ color: textPrimary }}>
                                            {highlightText(item.prompt || '无描述', searchQuery)}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {item.modelName && (
                                                <span className="max-w-full break-all text-[10px] px-1.5 py-0.5 rounded" style={{ background: accentBg, color: accent }}>{item.modelName}</span>
                                            )}
                                            {item.aspectRatio && (
                                                <span className="text-[10px]" style={{ color: textMuted }}>{item.aspectRatio}</span>
                                            )}
                                            {(item.useCount || 0) > 0 && (
                                                <span className="text-[10px]" style={{ color: textMuted }}>×{item.useCount}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* List view */
                        <div className="flex flex-col gap-2">
                            {filtered.map(item => (
                                <div
                                    key={item.id}
                                    className="flex items-start gap-3 rounded-xl p-3 transition-all duration-200 cursor-pointer"
                                    style={{
                                        background: expandedId === item.id ? accentBgHover : bgCard,
                                        border: expandedId === item.id ? `1px solid ${accent}40` : `1px solid ${borderLight}`,
                                    }}
                                    onClick={() => {
                                        if (batchMode) { toggleSelect(item.id); return; }
                                        setExpandedId(expandedId === item.id ? null : item.id);
                                    }}
                                >
                                    {/* Selection checkbox */}
                                    {batchMode && (
                                        <div className="flex-shrink-0 mt-1">
                                            {selectedIds.has(item.id) ? (
                                                <CheckSquare size={16} style={{ color: accent }} />
                                            ) : (
                                                <Square size={16} style={{ color: textMuted }} />
                                            )}
                                        </div>
                                    )}
                                    {/* Thumbnail */}
                                    <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer" style={{ background: mc ? '#e2e8f0' : 'rgba(255,255,255,0.05)' }}>
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" onClick={e => { e.stopPropagation(); setPreviewItem(item); }} />
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm truncate" style={{ color: textPrimary }}>
                                            {highlightText(item.prompt || '无描述', searchQuery)}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            {item.modelName && (
                                                <span className="max-w-full break-all text-[11px] px-1.5 py-0.5 rounded" style={{ background: accentBg, color: accent }}>{item.modelName}</span>
                                            )}
                                            {item.aspectRatio && (
                                                <span className="text-[11px]" style={{ color: textMuted }}>{item.aspectRatio}</span>
                                            )}
                                            {item.quality && (
                                                <span className="text-[11px]" style={{ color: textMuted }}>{item.quality}</span>
                                            )}
                                            {(item.useCount || 0) > 0 && (
                                                <span className="text-[11px] flex items-center gap-0.5" style={{ color: accent }}>
                                                    <Sparkles size={9} />×{item.useCount}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px]" style={{ color: textMuted }}>
                                            {item.username && (
                                                <span className="flex max-w-full break-all items-center gap-1"><User size={10} />{item.username}</span>
                                            )}
                                            {item.createdAt && (
                                                <span className="flex items-center gap-1"><Clock size={10} />{formatTime(item.createdAt)}</span>
                                            )}
                                        </div>
                                    </div>
                                    {/* Actions */}
                                    <div className="flex flex-col gap-1 flex-shrink-0">
                                        <button
                                            onClick={e => { e.stopPropagation(); handleApply(item); }}
                                            className="p-1.5 rounded-lg transition-colors"
                                            style={{ background: appliedId === item.id ? accent : accentBg, color: appliedId === item.id ? '#fff' : accent }}
                                            title="调用参数"
                                        >
                                            <Sparkles size={14} />
                                        </button>
                                        <button
                                            onClick={e => { e.stopPropagation(); setPreviewItem(item); }}
                                            className="p-1.5 rounded-lg transition-colors"
                                            style={{ color: textMuted }}
                                            title="预览"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            onClick={e => { e.stopPropagation(); handleCopyPrompt(item.prompt || ''); }}
                                            className="p-1.5 rounded-lg transition-colors"
                                            style={{ color: textMuted }}
                                            title="复制提示词"
                                        >
                                            <Copy size={14} />
                                        </button>
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                                            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
                                            style={{ color: '#ef4444' }}
                                            title="取消收藏"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Expanded detail panel */}
                {expandedId !== null && (() => {
                    const item = filtered.find(f => f.id === expandedId);
                    if (!item) return null;
                    return (
                        <div className="min-w-0 px-3 sm:px-5 py-3" style={{ borderTop: `1px solid ${borderLight}`, background: mc ? '#f8fafc' : 'rgba(255,255,255,0.01)' }}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium" style={{ color: textSecondary }}>参数详情</span>
                                <button onClick={() => setExpandedId(null)} aria-label="收起参数详情" style={{ color: textMuted }}>
                                    <ChevronDown size={14} />
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs [&>div]:min-w-0">
                                {item.prompt && (
                                    <div className="sm:col-span-2">
                                        <span style={{ color: textMuted }}>提示词</span>
                                        <p className="mt-0.5 leading-relaxed break-all" style={{ color: textPrimary }}>{item.prompt}</p>
                                    </div>
                                )}
                                {item.negativePrompt && (
                                    <div className="sm:col-span-2">
                                        <span style={{ color: textMuted }}>反向提示词</span>
                                        <p className="mt-0.5 leading-relaxed break-all" style={{ color: textSecondary }}>{item.negativePrompt}</p>
                                    </div>
                                )}
                                {item.modelName && <div><span style={{ color: textMuted }}>模型</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.modelName}</p></div>}
                                {item.aspectRatio && <div><span style={{ color: textMuted }}>比例</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.aspectRatio}</p></div>}
                                {item.quality && <div><span style={{ color: textMuted }}>质量</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.quality}</p></div>}
                                {item.apiProvider && <div><span style={{ color: textMuted }}>API提供商</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.apiProvider}</p></div>}
                                {(item.originalWidth && item.originalHeight) ? <div><span style={{ color: textMuted }}>原始尺寸</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.originalWidth} x {item.originalHeight}</p></div> : null}
                                {item.username && <div><span style={{ color: textMuted }}>收藏自</span><p className="mt-0.5" style={{ color: textPrimary }}>{item.username}</p></div>}
                                {item.createdAt && <div><span style={{ color: textMuted }}>收藏时间</span><p className="mt-0.5" style={{ color: textPrimary }}>{formatTime(item.createdAt)}</p></div>}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-3">
                                <button
                                    onClick={() => handleApply(item)}
                                    className="flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all hover:opacity-90"
                                    style={{ background: appliedId === item.id ? accent : accentBg, color: appliedId === item.id ? '#fff' : accent, border: `1px solid ${accent}40` }}
                                >
                                    <Sparkles size={14} />
                                    {appliedId === item.id ? '已调用' : '调用参数'}
                                </button>
                                <button
                                    onClick={() => handleCopyPrompt(item.prompt || '')}
                                    className="px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-all hover:opacity-80"
                                    style={{ background: inputBg, color: textSecondary, border: `1px solid ${borderLight}` }}
                                >
                                    <Copy size={14} />
                                    复制
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 px-5 py-2.5 flex-shrink-0" style={{ borderTop: `1px solid ${borderLight}` }}>
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="px-3 py-1 rounded text-xs transition-colors disabled:opacity-30"
                            style={{ background: accentBg, color: accent }}
                        >上一页</button>
                        <span className="text-xs" style={{ color: textMuted }}>{page} / {totalPages}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="px-3 py-1 rounded text-xs transition-colors disabled:opacity-30"
                            style={{ background: accentBg, color: accent }}
                        >下一页</button>
                    </div>
                )}

                </div>

                {/* Reserve the resize target outside scrolling controls. */}
                <div aria-hidden="true" className="h-11 shrink-0" />
                {/* Resize handle - bottom right */}
                <div
                    onMouseDown={handleResizeStart}
                    title="调整收藏夹大小"
                    className="absolute bottom-0 right-0 w-11 h-11 cursor-se-resize flex items-center justify-center"
                    style={{ color: textMuted }}
                >
                    <GripHorizontal size={12} className="rotate-[-45deg]" />
                </div>

                {/* Preview modal */}
                {previewItem && (
                    <div
                        className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto"
                        style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 16 }}
                        onClick={() => setPreviewItem(null)}
                    >
                        <div
                            className="relative min-w-0 w-[calc(100%_-_16px)] max-w-[640px] max-h-[calc(100%_-_16px)] flex flex-col lg:flex-row gap-4 overflow-y-auto overscroll-contain"
                            style={{ background: bg, borderRadius: 12, padding: 16, border: `1px solid ${border}`, flexDirection: viewport.width < 1024 ? 'column' : 'row' }}
                            onClick={e => e.stopPropagation()}
                        >
                            <img
                                src={previewItem.imageUrl}
                                alt=""
                                className="w-full max-h-40 lg:max-h-[60vh] lg:max-w-[50%] object-contain rounded-lg"
                            />
                            <div className="flex-1 min-w-0 w-full lg:max-w-[300px] flex flex-col">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm font-semibold" style={{ color: textPrimary }}>图片详情</span>
                                    <button onClick={() => setPreviewItem(null)} aria-label="关闭图片详情" style={{ color: textMuted }}>
                                        <X size={16} />
                                    </button>
                                </div>
                                {previewItem.prompt && (
                                    <div className="mb-3">
                                        <span className="text-xs" style={{ color: textMuted }}>提示词</span>
                                        <p className="text-sm mt-1 leading-relaxed break-all" style={{ color: textPrimary }}>{previewItem.prompt}</p>
                                    </div>
                                )}
                                {previewItem.negativePrompt && (
                                    <div className="mb-3">
                                        <span className="text-xs" style={{ color: textMuted }}>反向提示词</span>
                                        <p className="text-sm mt-1 leading-relaxed break-all" style={{ color: textSecondary }}>{previewItem.negativePrompt}</p>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-4 [&>div]:min-w-0">
                                    {previewItem.modelName && <div><span style={{ color: textMuted }}>模型</span><p style={{ color: textPrimary }}>{previewItem.modelName}</p></div>}
                                    {previewItem.aspectRatio && <div><span style={{ color: textMuted }}>比例</span><p style={{ color: textPrimary }}>{previewItem.aspectRatio}</p></div>}
                                    {previewItem.quality && <div><span style={{ color: textMuted }}>质量</span><p style={{ color: textPrimary }}>{previewItem.quality}</p></div>}
                                    {(previewItem.originalWidth && previewItem.originalHeight) && <div><span style={{ color: textMuted }}>尺寸</span><p style={{ color: textPrimary }}>{previewItem.originalWidth}×{previewItem.originalHeight}</p></div>}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-auto">
                                    <button
                                        onClick={() => { handleApply(previewItem); setPreviewItem(null); }}
                                        className="flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
                                        style={{ background: accent, color: '#fff' }}
                                    >
                                        <Sparkles size={13} />
                                        调用参数
                                    </button>
                                    <button
                                        aria-label="复制提示词"
                                        onClick={() => handleCopyPrompt(previewItem.prompt || '')}
                                        className="px-3 py-2 rounded-lg text-sm"
                                        style={{ background: inputBg, color: textSecondary, border: `1px solid ${borderLight}` }}
                                    >
                                        <Copy size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
