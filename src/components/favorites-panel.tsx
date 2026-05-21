'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Heart, Trash2, ChevronLeft, ChevronRight, Copy, ExternalLink } from 'lucide-react';

interface FavoriteItem {
  id: number;
  user_id: string;
  username: string;
  image_url: string;
  prompt: string;
  negative_prompt: string;
  model: string;
  model_name: string;
  aspect_ratio: string;
  quality: string;
  image_width: number;
  image_height: number;
  original_width: number;
  original_height: number;
  api_provider: string;
  api_base_url: string;
  source_type: string;
  created_at: number;
}

interface FavoritesPanelProps {
  userId: string;
  onClose: () => void;
  isMonochrome: boolean;
}

export function FavoritesPanel({ userId, onClose, isMonochrome }: FavoritesPanelProps) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<FavoriteItem | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // localStorage 兜底读写
  const getLocalFavorites = (): FavoriteItem[] => {
    try { const raw = localStorage.getItem('wujie-favorites-local'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  };
  const saveLocalFavorites = (items: FavoriteItem[]) => {
    try { localStorage.setItem('wujie-favorites-local', JSON.stringify(items)); } catch { /* ignore */ }
  };

  const fetchFavorites = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/favorites?userId=${encodeURIComponent(userId)}&page=${p}&limit=20`);
      const data = await res.json();
      if (data.success) {
        setFavorites(data.favorites);
        setTotalPages(data.pagination.totalPages);
        setTotal(data.pagination.total);
        // 同步到本地缓存
        if (p === 1 && data.favorites.length > 0) {
          saveLocalFavorites(data.favorites);
        }
      } else {
        // API失败 → localStorage兜底
        const local = getLocalFavorites().filter(f => f.user_id === userId);
        const start = (p - 1) * 20;
        const pageItems = local.slice(start, start + 20);
        setFavorites(pageItems);
        setTotalPages(Math.max(1, Math.ceil(local.length / 20)));
        setTotal(local.length);
      }
    } catch (err) {
      // 网络错误 → localStorage兜底
      console.error('[Favorites] fetch error, falling back to localStorage:', err);
      const local = getLocalFavorites().filter(f => f.user_id === userId);
      const start = (p - 1) * 20;
      const pageItems = local.slice(start, start + 20);
      setFavorites(pageItems);
      setTotalPages(Math.max(1, Math.ceil(local.length / 20)));
      setTotal(local.length);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchFavorites(page); }, [page, fetchFavorites]);

  const handleRemove = async (id: number) => {
    try {
      const res = await fetch(`/api/favorites?id=${id}&userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setFavorites(prev => prev.filter(f => f.id !== id));
        setTotal(prev => prev - 1);
        if (selectedItem?.id === id) setSelectedItem(null);
        // 同步本地缓存
        const local = getLocalFavorites();
        saveLocalFavorites(local.filter(f => f.id !== id));
      } else {
        // API失败 → 本地删除
        setFavorites(prev => prev.filter(f => f.id !== id));
        setTotal(prev => prev - 1);
        if (selectedItem?.id === id) setSelectedItem(null);
        const local = getLocalFavorites();
        saveLocalFavorites(local.filter(f => f.id !== id));
      }
    } catch (err) {
      // 网络错误 → 本地删除
      console.error('[Favorites] remove error, falling back to localStorage:', err);
      setFavorites(prev => prev.filter(f => f.id !== id));
      setTotal(prev => prev - 1);
      if (selectedItem?.id === id) setSelectedItem(null);
      const local = getLocalFavorites();
      saveLocalFavorites(local.filter(f => f.id !== id));
    }
  };

  const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch { /* ignore */ }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Theme colors
  const bg = isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]';
  const bgCard = isMonochrome ? 'bg-gray-50 border-gray-200' : 'bg-[#222] border-[#333]';
  const bgCardHover = isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#2a2a2a]';
  const textPrimary = isMonochrome ? 'text-gray-900' : 'text-white';
  const textSecondary = isMonochrome ? 'text-gray-500' : 'text-[#999]';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-[#666]';
  const border = isMonochrome ? 'border-gray-200' : 'border-[#333]';
  const accent = isMonochrome ? 'text-rose-500' : 'text-[#d4af37]';
  const btnPrimary = isMonochrome ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-[#d4af37] text-black hover:bg-[#c9a030]';

  return (
    <div className={`fixed inset-0 z-[200] flex ${bg} ${textPrimary}`}>
      {/* Sidebar - Favorites Grid */}
      <div className={`w-full ${selectedItem ? 'lg:w-1/2' : ''} flex flex-col border-r ${border}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border} shrink-0`}>
          <div className="flex items-center gap-2">
            <Heart className={`w-5 h-5 ${accent}`} fill="currentColor" />
            <h2 className="text-lg font-semibold">收藏夹</h2>
            <span className={`text-xs ${textMuted} ml-1`}>{total} 项</span>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#333]'} transition-colors`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && favorites.length === 0 ? (
            <div className={`flex items-center justify-center h-40 ${textMuted}`}>
              <div className="animate-spin w-6 h-6 border-2 border-current border-t-transparent rounded-full mr-2" />
              加载中...
            </div>
          ) : favorites.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-40 ${textMuted}`}>
              <Heart className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">暂无收藏</p>
              <p className="text-xs mt-1">右键点击画布中的图片可添加到收藏夹</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {favorites.map(item => (
                <div
                  key={item.id}
                  className={`relative group cursor-pointer rounded-lg overflow-hidden border ${bgCard} ${bgCardHover} transition-all ${
                    selectedItem?.id === item.id ? (isMonochrome ? 'ring-2 ring-gray-900' : 'ring-2 ring-[#d4af37]') : ''
                  }`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={item.image_url}
                      alt={item.prompt || '收藏图片'}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end">
                    <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-xs truncate">{item.prompt || '无提示词'}</p>
                    </div>
                  </div>
                  {/* Remove button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(item.id); }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={`flex items-center justify-center gap-3 px-4 py-3 border-t ${border} shrink-0`}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-100 disabled:opacity-30' : 'hover:bg-[#333] disabled:opacity-30'} transition-colors`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className={`text-xs ${textSecondary}`}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-100 disabled:opacity-30' : 'hover:bg-[#333] disabled:opacity-30'} transition-colors`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedItem && (
        <div className={`hidden lg:flex w-1/2 flex-col ${bg}`}>
          <div className={`flex items-center justify-between px-5 py-4 border-b ${border} shrink-0`}>
            <h3 className="font-medium">详细信息</h3>
            <button onClick={() => setSelectedItem(null)} className={`p-1.5 rounded-lg ${isMonochrome ? 'hover:bg-gray-100' : 'hover:bg-[#333]'} transition-colors`}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {/* Preview image */}
            <div className="rounded-lg overflow-hidden mb-5">
              <img
                src={selectedItem.image_url}
                alt={selectedItem.prompt || '收藏图片'}
                className="w-full object-contain max-h-[50vh]"
              />
            </div>

            {/* Prompt */}
            {selectedItem.prompt && (
              <div className={`mb-4 p-3 rounded-lg ${bgCard} border`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-medium ${textSecondary}`}>提示词</span>
                  <button onClick={() => copyPrompt(selectedItem.prompt)} className={`text-xs ${accent} hover:underline flex items-center gap-1`}>
                    <Copy className="w-3 h-3" /> {copiedPrompt ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="text-sm leading-relaxed">{selectedItem.prompt}</p>
              </div>
            )}

            {/* Negative Prompt */}
            {selectedItem.negative_prompt && (
              <div className={`mb-4 p-3 rounded-lg ${bgCard} border`}>
                <span className={`text-xs font-medium ${textSecondary}`}>反向提示词</span>
                <p className="text-sm mt-1">{selectedItem.negative_prompt}</p>
              </div>
            )}

            {/* Parameters Grid */}
            <div className={`grid grid-cols-2 gap-3 mb-4`}>
              {selectedItem.model_name && (
                <InfoCard label="模型" value={selectedItem.model_name} isMonochrome={isMonochrome} />
              )}
              {selectedItem.aspect_ratio && (
                <InfoCard label="画面比例" value={selectedItem.aspect_ratio} isMonochrome={isMonochrome} />
              )}
              {selectedItem.quality && (
                <InfoCard label="质量" value={selectedItem.quality} isMonochrome={isMonochrome} />
              )}
              {selectedItem.image_width && selectedItem.image_height && (
                <InfoCard label="尺寸" value={`${selectedItem.image_width}×${selectedItem.image_height}`} isMonochrome={isMonochrome} />
              )}
              {selectedItem.original_width && selectedItem.original_height && (
                <InfoCard label="原始尺寸" value={`${selectedItem.original_width}×${selectedItem.original_height}`} isMonochrome={isMonochrome} />
              )}
              {selectedItem.api_provider && (
                <InfoCard label="API 提供商" value={selectedItem.api_provider} isMonochrome={isMonochrome} />
              )}
              {selectedItem.source_type && (
                <InfoCard label="来源" value={selectedItem.source_type === 'generated' ? 'AI生成' : selectedItem.source_type} isMonochrome={isMonochrome} />
              )}
            </div>

            {/* User & Time */}
            <div className={`p-3 rounded-lg ${bgCard} border flex items-center justify-between`}>
              <div>
                <span className={`text-xs ${textMuted}`}>收藏自</span>
                <p className={`text-sm ${textSecondary}`}>{selectedItem.username || selectedItem.user_id}</p>
              </div>
              <div className="text-right">
                <span className={`text-xs ${textMuted}`}>收藏时间</span>
                <p className={`text-sm ${textSecondary}`}>{formatDate(selectedItem.created_at)}</p>
              </div>
            </div>

            {/* Open in new tab */}
            <a
              href={selectedItem.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-lg ${btnPrimary} text-sm font-medium transition-colors`}
            >
              <ExternalLink className="w-4 h-4" /> 在新标签页打开原图
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, isMonochrome }: { label: string; value: string; isMonochrome: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg ${isMonochrome ? 'bg-gray-50 border border-gray-100' : 'bg-[#1f1f1f] border border-[#2a2a2a]'}`}>
      <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-[#555]'}`}>{label}</span>
      <p className={`text-sm mt-0.5 truncate ${isMonochrome ? 'text-gray-700' : 'text-[#ccc]'}`}>{value}</p>
    </div>
  );
}
