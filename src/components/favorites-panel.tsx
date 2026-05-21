'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Heart, Grid3X3, List, Search, Sparkles, Trash2, Clock, User, Copy, ChevronDown, ChevronUp, Image as ImageIcon } from 'lucide-react';

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
    const panelRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

    const accent = isMonochrome ? '#a0a0a0' : '#d4af37';
    const accentBg = isMonochrome ? 'rgba(160,160,160,0.1)' : 'rgba(212,175,55,0.08)';
    const accentBgHover = isMonochrome ? 'rgba(160,160,160,0.18)' : 'rgba(212,175,55,0.15)';

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

    const handleApply = (item: FavoriteItem) => {
        if (onApplyParams) {
            onApplyParams(item);
            setAppliedId(item.id);
            setTimeout(() => setAppliedId(null), 1500);
        }
    };

    const filtered = searchQuery
        ? favorites.filter(f =>
            (f.prompt || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (f.modelName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (f.username || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        : favorites;

    // Drag to move window
    const handleDragStart = (e: React.MouseEvent) => {
        if (!panelRef.current) return;
        const rect = panelRef.current.getBoundingClientRect();
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current || !panelRef.current) return;
            const dx = ev.clientX - dragRef.current.startX;
            const dy = ev.clientY - dragRef.current.startY;
            panelRef.current.style.left = `${dragRef.current.origX + dx}px`;
            panelRef.current.style.top = `${dragRef.current.origY + dy}px`;
            panelRef.current.style.transform = 'none';
        };
        const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const formatTime = (ts: string) => {
        if (!ts) return '';
        const d = new Date(Number(ts));
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
            <div
                ref={panelRef}
                onClick={e => e.stopPropagation()}
                className="fixed shadow-2xl flex flex-col overflow-hidden"
                style={{
                    width: 680, maxHeight: '80vh',
                    top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    borderRadius: 16,
                    background: isMonochrome ? '#1e1e1e' : '#141414',
                    border: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.2)' : 'rgba(212,175,55,0.2)'}`,
                }}
            >
                {/* Title bar - draggable */}
                <div
                    onMouseDown={handleDragStart}
                    className="flex items-center justify-between px-5 py-3 cursor-move select-none"
                    style={{ borderBottom: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.12)' : 'rgba(212,175,55,0.12)'}` }}
                >
                    <div className="flex items-center gap-2.5">
                        <Heart size={18} fill={accent} stroke={accent} />
                        <span className="text-[15px] font-semibold text-foreground tracking-wide">收藏夹</span>
                        <span className="text-xs text-muted-foreground/60 ml-1">{filtered.length} 项</span>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-md hover:bg-muted/30 transition-colors">
                        <X size={16} className="text-muted-foreground" />
                    </button>
                </div>

                {/* Search + View toggle */}
                <div className="flex items-center gap-3 px-5 py-2.5" style={{ borderBottom: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.08)' : 'rgba(212,175,55,0.08)'}` }}>
                    <div className="flex-1 flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: isMonochrome ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.12)' : 'rgba(212,175,55,0.1)'}` }}>
                        <Search size={14} className="text-muted-foreground/50" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="搜索关键词、模型、用户..."
                            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
                        />
                    </div>
                    <div className="flex items-center rounded-lg overflow-hidden" style={{ border: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.12)' : 'rgba(212,175,55,0.1)'}` }}>
                        <button onClick={() => setViewMode('grid')} className="p-1.5 transition-colors" style={{ background: viewMode === 'grid' ? accentBg : 'transparent' }}>
                            <Grid3X3 size={14} style={{ color: viewMode === 'grid' ? accent : 'var(--muted-foreground)' }} />
                        </button>
                        <button onClick={() => setViewMode('list')} className="p-1.5 transition-colors" style={{ background: viewMode === 'list' ? accentBg : 'transparent' }}>
                            <List size={14} style={{ color: viewMode === 'list' ? accent : 'var(--muted-foreground)' }} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: 'thin' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground/60">
                            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: `${accent}33`, borderTopColor: accent }} />
                            <span className="text-sm">加载中...</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50">
                            <Heart size={40} strokeWidth={1} className="mb-3" />
                            <p className="text-sm">暂无收藏</p>
                            <p className="text-xs mt-1">右键画布图片可添加到收藏夹</p>
                        </div>
                    ) : viewMode === 'grid' ? (
                        <div className="grid grid-cols-3 gap-3">
                            {filtered.map(item => (
                                <div
                                    key={item.id}
                                    className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
                                    style={{
                                        background: isMonochrome ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.02)',
                                        border: expandedId === item.id ? `1.5px solid ${accent}` : `1px solid ${isMonochrome ? 'rgba(160,160,160,0.1)' : 'rgba(212,175,55,0.08)'}`,
                                    }}
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                >
                                    {/* Image */}
                                    <div className="relative aspect-square bg-muted/20">
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                        {/* Hover overlay */}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                                            <button
                                                onClick={e => { e.stopPropagation(); handleApply(item); }}
                                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 transition-transform hover:scale-105"
                                                style={{ background: accent }}
                                            >
                                                <Sparkles size={12} />
                                                调用参数
                                            </button>
                                        </div>
                                        {/* Applied indicator */}
                                        {appliedId === item.id && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: accent, color: isMonochrome ? '#1e1e1e' : '#141414' }}>已调用</span>
                                            </div>
                                        )}
                                    </div>
                                    {/* Info */}
                                    <div className="p-2.5">
                                        <p className="text-xs text-foreground/80 truncate leading-snug">{item.prompt || '无描述'}</p>
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                            {item.modelName && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: accentBg, color: accent }}>{item.modelName}</span>
                                            )}
                                            {item.aspectRatio && (
                                                <span className="text-[10px] text-muted-foreground/50">{item.aspectRatio}</span>
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
                                        background: expandedId === item.id ? accentBgHover : isMonochrome ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.015)',
                                        border: expandedId === item.id ? `1px solid ${accent}40` : `1px solid ${isMonochrome ? 'rgba(160,160,160,0.08)' : 'rgba(212,175,55,0.06)'}`,
                                    }}
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                >
                                    {/* Thumbnail */}
                                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/20 flex-shrink-0">
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-foreground/85 truncate">{item.prompt || '无描述'}</p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            {item.modelName && (
                                                <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: accentBg, color: accent }}>{item.modelName}</span>
                                            )}
                                            {item.aspectRatio && (
                                                <span className="text-[11px] text-muted-foreground/50">{item.aspectRatio}</span>
                                            )}
                                            {item.quality && (
                                                <span className="text-[11px] text-muted-foreground/50">{item.quality}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/40">
                                            {item.username && (
                                                <span className="flex items-center gap-1"><User size={10} />{item.username}</span>
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
                                            style={{ background: appliedId === item.id ? accent : accentBg, color: appliedId === item.id ? (isMonochrome ? '#1e1e1e' : '#141414') : accent }}
                                            title="调用参数"
                                        >
                                            <Sparkles size={14} />
                                        </button>
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                                            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
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
                        <div className="px-5 py-3" style={{ borderTop: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.12)' : 'rgba(212,175,55,0.12)'}`, background: isMonochrome ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.01)' }}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-muted-foreground/70">参数详情</span>
                                <button onClick={() => setExpandedId(null)} className="text-muted-foreground/40 hover:text-foreground transition-colors">
                                    <ChevronDown size={14} />
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                                {item.prompt && (
                                    <div className="col-span-2">
                                        <span className="text-muted-foreground/50">提示词</span>
                                        <p className="text-foreground/80 mt-0.5 leading-relaxed break-all">{item.prompt}</p>
                                    </div>
                                )}
                                {item.negativePrompt && (
                                    <div className="col-span-2">
                                        <span className="text-muted-foreground/50">反向提示词</span>
                                        <p className="text-foreground/60 mt-0.5 leading-relaxed break-all">{item.negativePrompt}</p>
                                    </div>
                                )}
                                {item.modelName && <div><span className="text-muted-foreground/50">模型</span><p className="text-foreground/80 mt-0.5">{item.modelName}</p></div>}
                                {item.aspectRatio && <div><span className="text-muted-foreground/50">比例</span><p className="text-foreground/80 mt-0.5">{item.aspectRatio}</p></div>}
                                {item.quality && <div><span className="text-muted-foreground/50">质量</span><p className="text-foreground/80 mt-0.5">{item.quality}</p></div>}
                                {item.apiProvider && <div><span className="text-muted-foreground/50">API提供商</span><p className="text-foreground/80 mt-0.5">{item.apiProvider}</p></div>}
                                {(item.originalWidth && item.originalHeight) ? <div><span className="text-muted-foreground/50">原始尺寸</span><p className="text-foreground/80 mt-0.5">{item.originalWidth} x {item.originalHeight}</p></div> : null}
                                {item.username && <div><span className="text-muted-foreground/50">收藏自</span><p className="text-foreground/80 mt-0.5">{item.username}</p></div>}
                                {item.createdAt && <div><span className="text-muted-foreground/50">收藏时间</span><p className="text-foreground/80 mt-0.5">{formatTime(item.createdAt)}</p></div>}
                            </div>
                            {/* Apply button */}
                            <button
                                onClick={() => handleApply(item)}
                                className="w-full mt-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all hover:brightness-110"
                                style={{ background: appliedId === item.id ? accent : accentBg, color: appliedId === item.id ? (isMonochrome ? '#1e1e1e' : '#141414') : accent, border: `1px solid ${accent}40` }}
                            >
                                <Sparkles size={14} />
                                {appliedId === item.id ? '已调用' : '调用参数到生成面板'}
                            </button>
                        </div>
                    );
                })()}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 px-5 py-2.5" style={{ borderTop: `1px solid ${isMonochrome ? 'rgba(160,160,160,0.08)' : 'rgba(212,175,55,0.08)'}` }}>
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="px-3 py-1 rounded text-xs transition-colors disabled:opacity-30"
                            style={{ background: accentBg, color: accent }}
                        >
                            上一页
                        </button>
                        <span className="text-xs text-muted-foreground/50">{page} / {totalPages}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="px-3 py-1 rounded text-xs transition-colors disabled:opacity-30"
                            style={{ background: accentBg, color: accent }}
                        >
                            下一页
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
