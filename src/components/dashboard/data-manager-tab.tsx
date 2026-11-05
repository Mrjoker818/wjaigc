'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import DataManagerImage from './data-manager-image';
import {
  Search, Image, User, Users, Download, RefreshCw,
  ChevronLeft, ChevronRight, Eye, XCircle, Server,
  Database, Loader2, Grid3X3, LayoutGrid, Upload,
} from 'lucide-react';

/* ── Types ── */
interface ImageRecord {
  id: string;
  url: string;
  prompt?: string;
  model?: string;
  quality?: string;
  aspectRatio?: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  originalWidth?: number;
  originalHeight?: number;
  source: 'generated' | 'uploaded' | 'edited' | 'unknown';
  apiProvider?: string;
  userId?: string;
  userName?: string;
}

interface UserStat {
  userId: string;
  userName: string;
  totalImages: number;
  generated: number;
  uploaded: number;
  edited: number;
  projectCount: number;
}

interface DataStats {
  totalUsers: number;
  filteredUsers: number;
  totalImages: number;
  generated: number;
  uploaded: number;
  edited: number;
  userStats: UserStat[];
}

interface DataManagerTabProps {
  isDark: boolean;
  isMonochrome?: boolean;
  textPrimary: string;
  textSecondary: string;
  softClass: string;
  inputClass: string;
  accentBgClass: string;
  accentTextOnBgClass: string;
  accentHoverBgClass: string;
}

interface DataPayload { images: ImageRecord[]; total: number; stats: DataStats }

function isDataPayload(value: unknown): value is DataPayload {
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!object(value) || !Array.isArray(value.images) || !count(value.total) || !object(value.stats)) return false;
  const stats = value.stats;
  if (!['totalUsers', 'filteredUsers', 'totalImages', 'generated', 'uploaded', 'edited'].every(k => count(stats[k]))
    || !Array.isArray(stats.userStats)) return false;
  if (!stats.userStats.every((u: unknown): boolean => object(u) && typeof u.userId === 'string' && typeof u.userName === 'string'
    && ['totalImages', 'generated', 'uploaded', 'edited', 'projectCount'].every(k => count(u[k])))) return false;
  return value.images.every((image: unknown): boolean => object(image)
    && ['id', 'url', 'projectId', 'projectName'].every(k => typeof image[k] === 'string')
    && typeof image.createdAt === 'number' && Number.isFinite(image.createdAt)
    && typeof image.source === 'string' && ['generated', 'uploaded', 'edited', 'unknown'].includes(image.source)
    && ['prompt', 'model', 'quality', 'aspectRatio', 'apiProvider', 'userId', 'userName'].every(k => image[k] === undefined || typeof image[k] === 'string')
    && ['originalWidth', 'originalHeight'].every(k => image[k] === undefined || (typeof image[k] === 'number' && Number.isFinite(image[k]))));
}

/* ── Helpers ── */
function formatTime(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'generated': return 'AI生成';
    case 'uploaded': return '上传';
    case 'edited': return '编辑';
    default: return '其他';
  }
}

function sourceBadgeClass(s: string, isDark: boolean): string {
  switch (s) {
    case 'generated': return isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-50 text-purple-600';
    case 'uploaded': return isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600';
    case 'edited': return isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600';
    default: return isDark ? 'bg-white/10 text-white/50' : 'bg-gray-100 text-gray-500';
  }
}

/* ── Component ── */
export default function DataManagerTab({
  isDark, isMonochrome, textPrimary, textSecondary,
  softClass, inputClass, accentBgClass, accentTextOnBgClass, accentHoverBgClass,
}: DataManagerTabProps) {
  // State
  const [view, setView] = useState<'overview' | 'gallery' | 'users'>('overview');
  const [returnView, setReturnView] = useState<'overview' | 'users'>('overview');
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [stats, setDataStats] = useState<DataStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(24);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [loadError, setLoadError] = useState('');
  const requestVersion = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exportingRef = useRef(false);
  const [exportState, setExportState] = useState<{status:'idle'|'loading'|'complete'|'error';count:number;total:number|null;error:string}>({status:'idle',count:0,total:null,error:''});

  // Load data
  const loadData = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError('');
    let redirectingPage = false;
    let failure = '数据读取失败，请检查网络后重试。';
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(source && { source }),
        ...(search && { search }),
        ...(filterUserId && { userId: filterUserId }),
      });
      const res = await fetch(`/api/admin/user-images?${params}`, { credentials: 'include' });
      if (!res.ok) {
        failure = `数据读取失败（HTTP ${res.status}），请重试。`;
        throw new Error('DATA_READ_HTTP');
      }
      failure = '数据响应格式异常，请重试。';
      const data: unknown = await res.json();
      if (!isDataPayload(data)) throw new Error('DATA_READ_FORMAT');
      if (version !== requestVersion.current) return;
      const acceptedImages=data.images,acceptedTotal=data.total,acceptedStats=data.stats;
      const lastPage = Math.max(1,Math.ceil(acceptedTotal/pageSize));
      if(page>lastPage){redirectingPage=true;setPage(lastPage);return;}
      setImages(acceptedImages);
      setTotal(acceptedTotal);
      setDataStats(acceptedStats);
      setSelectedImage(current=>{
        if(!current?.id||!current.projectId||!current.userId)return current;
        return acceptedImages.find(image=>image.id===current.id&&image.projectId===current.projectId&&image.userId===current.userId)??current;
      });
    } catch {
      if (version !== requestVersion.current) return;
      setLoadError(failure);
      setImages([]);
      setTotal(0);
      setDataStats(null);
    } finally {
      if (!redirectingPage && version === requestVersion.current) setLoading(false);
    }
  }, [page, pageSize, source, search, filterUserId]);

  useEffect(() => {
    void loadData();
    return () => { requestVersion.current += 1; };
  }, [loadData]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Export handler
  const handleExport = async (): Promise<void> => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExportState({status:'loading',count:0,total:null,error:''});
    // Capture these once. Changing the gallery while exporting must not mix
    // users, sources or searches across the file's subsequent pages.
    const filters = {
      ...(source && { source }), ...(search && { search }), ...(filterUserId && { userId: filterUserId }),
    };
    let failure = '导出失败，请检查网络后重新导出。';
    try {
      const imagesToExport: ImageRecord[] = [], identities = new Set<string>();
      let expectedTotal: number | null = null, exportPage = 1;
      do {
        if (!rootRef.current?.isConnected) return;
        const params = new URLSearchParams({page:String(exportPage),pageSize:'100',...filters});
        failure = '导出失败，请检查网络后重新导出。';
        const res = await fetch(`/api/admin/user-images?${params}`, { credentials: 'include' });
        if (!rootRef.current?.isConnected) return;
        if (!res.ok) { failure = `导出失败（HTTP ${res.status}），请重新导出。`; throw new Error('DATA_EXPORT_HTTP'); }
        failure = '导出数据格式异常，请重新导出。';
        const data: unknown = await res.json();
        if (!rootRef.current?.isConnected) return;
        if (!isDataPayload(data) || !('page' in data) || data.page !== exportPage
          || !('pageSize' in data) || data.pageSize !== 100) throw new Error('DATA_EXPORT_FORMAT');
        if (expectedTotal === null) expectedTotal = data.total;
        if (data.total !== expectedTotal) { failure = '导出期间数据发生变化，请重新导出。'; throw new Error('DATA_EXPORT_CHANGED'); }
        failure = '导出分页不完整或包含重复数据，请重新导出。';
        if (data.images.length !== Math.min(100,expectedTotal-imagesToExport.length)) throw new Error('DATA_EXPORT_INCOMPLETE');
        for (const image of data.images) {
          const identity = JSON.stringify([image.userId??'',image.projectId,image.id]);
          if (identities.has(identity)) throw new Error('DATA_EXPORT_DUPLICATE');
          identities.add(identity); imagesToExport.push(image);
        }
        setExportState({status:'loading',count:imagesToExport.length,total:expectedTotal,error:''});
        exportPage++;
      } while (imagesToExport.length < expectedTotal);
      failure = '导出数据格式异常，请重新导出。';
      const exportData = imagesToExport.map((img: ImageRecord) => ({
        id: img.id,
        prompt: img.prompt || '',
        model: img.model || '',
        source: img.source,
        userName: img.userName || '',
        userId: img.userId || '',
        createdAt: img.createdAt ? new Date(img.createdAt).toISOString() : '',
        projectName: img.projectName || '',
        apiProvider: img.apiProvider || '',
      }));
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      if (!rootRef.current?.isConnected) return;
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `wujie-data-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
      } finally { URL.revokeObjectURL(url); }
      setExportState({status:'complete',count:exportData.length,total:exportData.length,error:''});
    } catch {
      if (rootRef.current?.isConnected) setExportState({status:'error',count:0,total:null,error:failure});
    } finally {
      exportingRef.current = false;
    }
  };

  /* ── Sub-views ── */

  // Overview: stats cards + user ranking
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Database, label: '总内容数', value: stats?.totalImages ?? 0, color: isDark ? 'text-blue-400' : 'text-blue-600', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-50' },
          { icon: Image, label: 'AI生成', value: stats?.generated ?? 0, color: isDark ? 'text-purple-400' : 'text-purple-600', bg: isDark ? 'bg-purple-500/10' : 'bg-purple-50' },
          { icon: Upload, label: '用户上传', value: stats?.uploaded ?? 0, color: isDark ? 'text-green-400' : 'text-green-600', bg: isDark ? 'bg-green-500/10' : 'bg-green-50' },
          { icon: Users, label: '总用户', value: stats?.totalUsers ?? 0, color: isDark ? 'text-amber-400' : 'text-amber-600', bg: isDark ? 'bg-amber-500/10' : 'bg-amber-50' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${softClass}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                <card.icon size={18} className={card.color} />
              </div>
              <div>
                <div className={`text-xs ${textSecondary}`}>{card.label}</div>
                <div className={`text-xl font-bold ${textPrimary}`}>{card.value.toLocaleString('zh-CN')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* User Data Ranking */}
      <div className={`rounded-xl border p-5 ${softClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className={`text-sm font-semibold ${textPrimary}`}>用户数据排行</h3>
          <button
            onClick={() => setView('users')}
            className={`text-xs ${isDark ? 'text-[#d4af37] hover:text-[#e5c74e]' : 'text-blue-600 hover:text-blue-700'} cursor-pointer transition-colors`}
          >
            查看全部 →
          </button>
        </div>
        <div className="space-y-2">
          {(stats?.userStats || []).slice(0, 10).map((u, i) => (
            <button
              key={u.userId}
              type="button"
              aria-label={`查看用户 ${u.userName} 的内容`}
              className={`flex w-full min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-left cursor-pointer transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
              onClick={() => { setPage(1); setReturnView('overview'); setFilterUserId(u.userId); setView('gallery'); }}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-amber-50 text-amber-600') : (isDark ? 'bg-white/5 text-white/40' : 'bg-gray-100 text-gray-400')}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium truncate max-md:whitespace-normal max-md:overflow-visible ${textPrimary}`}>{u.userName}</div>
                <div className={`whitespace-normal text-xs ${textSecondary}`}>
                  {u.projectCount} 个项目 · {u.generated} 生成 · {u.uploaded} 上传
                </div>
              </div>
              <div className={`text-sm font-semibold ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
                {u.totalImages}
              </div>
            </button>
          ))}
          {(!stats?.userStats || stats.userStats.length === 0) && (
            <div className={`text-center py-6 text-sm ${textSecondary}`}>暂无用户数据</div>
          )}
        </div>
      </div>
    </div>
  );

  // Gallery: filterable image grid/list
  const renderGallery = () => {
    // Find the filtered user name
    const filteredUser = stats?.userStats?.find(u => u.userId === filterUserId);
    return (
    <div className="space-y-4">
      {/* Breadcrumb: always visible, consistent navigation */}
      <div role="navigation" aria-label="数据内容导航" className={`flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-lg ${isDark ? 'bg-white/[0.03] border border-white/5' : 'bg-gray-50 border border-gray-100'}`}>
        <button
          onClick={() => { setPage(1); setFilterUserId(''); setView(returnView); }}
          className={`flex items-center gap-1.5 text-sm cursor-pointer transition-colors ${isDark ? 'text-white/40 hover:text-white/70' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <ChevronLeft size={14} />
          {returnView === 'overview' ? '概览' : '用户数据'}
        </button>
        <ChevronRight size={12} className={textSecondary} />
        <span className={`text-sm font-medium ${textPrimary}`}>内容库</span>
        {filterUserId && filteredUser && (
          <>
            <ChevronRight size={12} className={textSecondary} />
            <span className={`text-sm font-medium ${isDark ? 'text-[#d4af37]' : 'text-amber-600'}`}>{filteredUser.userName}</span>
          </>
        )}
        <div className="flex-1" />
        {/* Quick links to all sub-views */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setPage(1); setFilterUserId(''); setView('overview'); }}
            className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${returnView === 'overview' ? (isDark ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-amber-50 text-amber-600') : (isDark ? 'text-white/40 hover:text-white/60' : 'text-gray-400 hover:text-gray-600')}`}
          >概览</button>
          <button
            onClick={() => { setPage(1); setFilterUserId(''); setView('users'); }}
            className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${view === 'gallery' && !filterUserId ? (isDark ? 'bg-[#d4af37]/10 text-[#d4af37]' : 'bg-amber-50 text-amber-600') : (isDark ? 'text-white/40 hover:text-white/60' : 'text-gray-400 hover:text-gray-600')}`}
          >用户列表</button>
        </div>
      </div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`relative flex-1 min-w-[200px] max-w-[300px]`}>
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`} />
          <input
            className={`w-full h-9 pl-9 pr-3 rounded-lg border text-sm ${inputClass}`}
            placeholder="搜索提示词、模型..."
            value={search}
            onChange={e => { setPage(1); setSearch(e.target.value); }}
          />
        </div>
        <select
          className={`h-9 px-3 rounded-lg border text-sm ${inputClass} cursor-pointer`}
          value={source}
          onChange={e => { setPage(1); setSource(e.target.value); }}
        >
          <option value="">全部来源</option>
          <option value="generated">AI生成</option>
          <option value="uploaded">上传</option>
          <option value="edited">编辑</option>
        </select>
        {filterUserId && filteredUser && (
          <div className={`flex max-w-full flex-wrap items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs ${isDark ? 'bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
            <User size={12} />
            <span>{filteredUser.userName}</span>
            <button
              onClick={() => { setPage(1); setFilterUserId(''); }}
              aria-label="清除用户筛选"
              className="ml-1 cursor-pointer hover:opacity-70"
            >
              <XCircle size={13} />
            </button>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={handleExport}
            aria-label="导出"
            disabled={exportState.status === 'loading'}
            className={`flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait ${isDark ? 'bg-white/5 text-white/70 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {exportState.status === 'loading' ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : <Download size={12} />}
            {exportState.status === 'loading' ? '导出中' : '导出'}
          </button>
          <button
            onClick={() => loadData()}
            className={`flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors ${isDark ? 'bg-white/5 text-white/70 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <RefreshCw size={12} /> 刷新
          </button>
          <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setLayout('grid')}
              aria-label="网格视图" aria-pressed={layout === 'grid'}
              className={`p-2 cursor-pointer transition-colors ${layout === 'grid' ? (isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900') : (isDark ? 'text-white/40 hover:bg-white/5' : 'text-gray-400 hover:bg-gray-50')}`}
            >
              <Grid3X3 size={14} />
            </button>
            <button
              onClick={() => setLayout('list')}
              aria-label="列表视图" aria-pressed={layout === 'list'}
              className={`p-2 cursor-pointer transition-colors ${layout === 'list' ? (isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900') : (isDark ? 'text-white/40 hover:bg-white/5' : 'text-gray-400 hover:bg-gray-50')}`}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Results info */}
      {!loading && !loadError && <div className={`flex items-center justify-between text-xs ${textSecondary}`}>
        <span>共 {total} 条结果{filterUserId ? ` (已筛选用户)` : ''}</span>
        <span>第 {page}/{totalPages} 页</span>
      </div>}

      {/* Content */}
      {loading ? (
        <div role="status" className="flex items-center justify-center py-20">
          <Loader2 size={24} className={`animate-spin ${isDark ? 'text-[#d4af37]' : 'text-blue-500'}`} />
          <span className={`ml-3 text-sm ${textSecondary}`}>加载数据中...</span>
        </div>
      ) : loadError ? null : images.length === 0 ? (
        <div className={`text-center py-20 ${textSecondary}`}>
          <Database size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无数据</p>
          <p className="text-xs mt-1">用户生成内容后将在此显示</p>
        </div>
      ) : layout === 'grid' ? (
        /* Grid view */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {images.map(img => (
            <button
              key={img.id}
              type="button"
              aria-label={`查看图片：${img.prompt || img.model || '未命名图片'}`}
              className={`group relative w-full rounded-xl border overflow-hidden text-left cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg ${softClass}`}
              onClick={e => { detailReturnFocusRef.current = e.currentTarget; setSelectedImage(img); }}
            >
              <div className="aspect-square bg-black/10">
                <DataManagerImage
                  key={img.url}
                  src={img.url}
                  alt={img.prompt || '图片'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <Eye size={20} className="text-white" />
              </div>
              {/* Source badge */}
              <span className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sourceBadgeClass(img.source, isDark)}`}>
                {sourceLabel(img.source)}
              </span>
              {/* Info bar */}
              <div className={`absolute max-md:static bottom-0 inset-x-0 p-2 max-md:bg-card max-md:bg-none ${isDark ? 'bg-gradient-to-t from-black/80 to-transparent' : 'bg-gradient-to-t from-white/90 to-transparent'}`}>
                <div className="text-[11px] font-medium truncate max-md:whitespace-normal max-md:overflow-visible max-md:text-foreground text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">{img.model || '-'}</div>
                <div className="text-[10px] truncate max-md:whitespace-normal max-md:overflow-visible max-md:text-muted-foreground text-white/70">{formatTime(img.createdAt)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="space-y-1">
          {images.map(img => (
            <button
              key={img.id}
              type="button"
              aria-label={`查看图片：${img.prompt || img.model || '未命名图片'}`}
              className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 rounded-lg text-left cursor-pointer transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
              onClick={e => { detailReturnFocusRef.current = e.currentTarget; setSelectedImage(img); }}
            >
              <div className={`w-12 h-12 rounded-lg overflow-hidden shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                <DataManagerImage key={img.url} src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate max-md:whitespace-normal max-md:overflow-visible ${textPrimary}`}>
                  {img.prompt ? (img.prompt.length > 60 ? img.prompt.slice(0, 60) + '...' : img.prompt) : '(无提示词)'}
                </div>
                <div className={`whitespace-normal text-xs mt-0.5 ${textSecondary}`}>
                  {img.model || '-'} · {img.projectName} · {formatTime(img.createdAt)}
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${sourceBadgeClass(img.source, isDark)}`}>
                {sourceLabel(img.source)}
              </span>
              <div className={`whitespace-normal text-xs max-w-full sm:shrink-0 ${textSecondary}`}>{img.userName || '-'}</div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            aria-label="上一页"
            disabled={page === 1}
            className={`p-2 rounded-lg cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <ChevronLeft size={16} />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            if (p > totalPages) return null;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`w-8 h-8 rounded-lg text-xs font-medium cursor-pointer transition-colors ${p === page ? (isDark ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'bg-blue-50 text-blue-600') : (isDark ? 'text-white/50 hover:bg-white/5' : 'text-gray-500 hover:bg-gray-50')}`}
              >
                {p}
              </button>
            );
          })}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            aria-label="下一页"
            disabled={page === totalPages}
            className={`p-2 rounded-lg cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
    );
  };

  // Users: detailed user data listing
  const renderUsers = () => (
    <div className="space-y-4">
      <div className={`rounded-xl border p-5 ${softClass}`}>
        <h3 className={`text-sm font-semibold mb-4 ${textPrimary}`}>用户数据概览</h3>
        <div role="region" aria-label="用户数据表，可横向滚动" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className={`border-b ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>用户</th>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>项目数</th>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>总内容</th>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>AI生成</th>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>上传</th>
                <th className={`text-left py-2 px-3 text-xs font-medium ${textSecondary}`}>编辑</th>
                <th className={`text-right py-2 px-3 text-xs font-medium ${textSecondary}`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.userStats || []).map(u => (
                <tr key={u.userId} className={`border-b transition-colors ${isDark ? 'border-white/5 hover:bg-white/[0.02]' : 'border-gray-50 hover:bg-gray-50/50'}`}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isDark ? 'bg-white/10 text-white/60' : 'bg-gray-100 text-gray-500'}`}>
                        {(u.userName || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={`font-medium ${textPrimary}`}>{u.userName}</div>
                        <div className={`text-[10px] ${textSecondary}`}>{u.userId}</div>
                      </div>
                    </div>
                  </td>
                  <td className={`py-2.5 px-3 ${textPrimary}`}>{u.projectCount}</td>
                  <td className={`py-2.5 px-3 font-semibold ${textPrimary}`}>{u.totalImages}</td>
                  <td className="py-2.5 px-3"><span className={isDark ? 'text-purple-400' : 'text-purple-600'}>{u.generated}</span></td>
                  <td className="py-2.5 px-3"><span className={isDark ? 'text-blue-400' : 'text-blue-600'}>{u.uploaded}</span></td>
                  <td className="py-2.5 px-3"><span className={isDark ? 'text-amber-400' : 'text-amber-600'}>{u.edited}</span></td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => { setPage(1); setReturnView('users'); setFilterUserId(u.userId); setView('gallery'); }}
                      className={`text-xs px-3 py-1 rounded-lg cursor-pointer transition-colors ${isDark ? 'text-[#d4af37] hover:bg-[#d4af37]/10' : 'text-blue-600 hover:bg-blue-50'}`}
                    >
                      查看内容
                    </button>
                  </td>
                </tr>
              ))}
              {(!stats?.userStats || stats.userStats.length === 0) && (
                <tr>
                  <td colSpan={7} className={`text-center py-8 text-sm ${textSecondary}`}>暂无用户数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // Image detail modal
  const renderImageDetail = () => {
    if (!selectedImage) return null;
    return (
        <DialogContent
          showCloseButton={false}
          className={`block w-[calc(100vw-2rem)] max-w-3xl sm:max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-0 [overflow-wrap:anywhere] [&_svg]:shrink-0 [&_button]:min-h-11 [&_button]:min-w-11 rounded-2xl ${isDark ? 'bg-[#1a1a1a] border border-white/10' : 'bg-white border border-gray-200'} shadow-2xl`}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = detailReturnFocusRef.current;
            if (target?.isConnected) target.focus(); else rootRef.current?.focus();
          }}
        >
          <div className={`sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b p-3 ${isDark ? 'border-white/10 bg-[#1a1a1a]' : 'border-gray-200 bg-white'}`}>
          <div className="min-w-0">
          <DialogTitle className="text-base">图片详情</DialogTitle>
          <DialogDescription className="mt-1">查看图片和生成信息</DialogDescription>
          </div>
          {/* Close button */}
          <DialogClose asChild><button
            type="button"
            aria-label="关闭图片详情"
            className={`flex shrink-0 items-center justify-center p-1.5 rounded-full cursor-pointer transition-colors ${isDark ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <XCircle size={18} />
          </button></DialogClose>
          </div>

          <div className="flex flex-col md:flex-row">
            {/* Image */}
            <div className="md:w-1/2 bg-black/5">
              <DataManagerImage
                key={JSON.stringify([selectedImage.userId,selectedImage.projectId,selectedImage.id,selectedImage.url])}
                src={selectedImage.url}
                alt={selectedImage.prompt || '图片详情'}
                className="w-full h-auto max-h-[60vh] object-contain"
                loading="eager"
                onRetry={loadData}
              />
            </div>
            {/* Info */}
            <div className="md:w-1/2 p-5 space-y-4">
              <div>
                <div className={`text-xs font-medium mb-1 ${textSecondary}`}>提示词</div>
                <div className={`text-sm ${textPrimary}`}>{selectedImage.prompt || '(无)'}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>来源</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeClass(selectedImage.source, isDark)}`}>
                    {sourceLabel(selectedImage.source)}
                  </span>
                </div>
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>模型</div>
                  <div className={`text-sm ${textPrimary}`}>{selectedImage.model || '-'}</div>
                </div>
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>用户</div>
                  <div className={`text-sm ${textPrimary}`}>{selectedImage.userName || '-'}</div>
                </div>
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>创建时间</div>
                  <div className={`text-sm ${textPrimary}`}>{formatTime(selectedImage.createdAt)}</div>
                </div>
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>项目</div>
                  <div className={`text-sm ${textPrimary}`}>{selectedImage.projectName || '-'}</div>
                </div>
                <div>
                  <div className={`text-xs font-medium mb-1 ${textSecondary}`}>API提供商</div>
                  <div className={`text-sm ${textPrimary}`}>{selectedImage.apiProvider || '-'}</div>
                </div>
                {selectedImage.originalWidth && selectedImage.originalHeight && (
                  <div>
                    <div className={`text-xs font-medium mb-1 ${textSecondary}`}>尺寸</div>
                    <div className={`text-sm ${textPrimary}`}>{selectedImage.originalWidth}×{selectedImage.originalHeight}</div>
                  </div>
                )}
                {selectedImage.quality && (
                  <div>
                    <div className={`text-xs font-medium mb-1 ${textSecondary}`}>质量</div>
                    <div className={`text-sm ${textPrimary}`}>{selectedImage.quality}</div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <a
                  href={selectedImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-11 min-w-11 items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${isDark ? 'bg-white/5 text-white/70 hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  <Download size={12} /> 下载原图
                </a>
              </div>
            </div>
          </div>
        </DialogContent>
    );
  };

  return (
    <Dialog open={Boolean(selectedImage)} onOpenChange={open => { if (!open) setSelectedImage(null); }}>
    <div ref={rootRef} tabIndex={-1} aria-busy={loading} className="h-full overflow-y-auto p-4 sm:p-6 [overflow-wrap:anywhere] [&_.grid>*]:min-w-0 [&_svg]:shrink-0 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_input:not([type=checkbox])]:min-h-11 max-md:[&_input:not([type=checkbox])]:text-base max-md:[&_select]:min-h-11 max-md:[&_select]:text-base max-md:[&_textarea]:text-base">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className={`text-xl font-bold ${textPrimary}`}>数据管理</h1>
          <p className={`text-sm ${textSecondary}`}>查看和管理用户生成内容</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher */}
          <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            {([
              { key: 'overview' as const, label: '概览', Icon: Server },
              { key: 'gallery' as const, label: '内容库', Icon: Image },
              { key: 'users' as const, label: '用户数据', Icon: User },
            ] as const).map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${view === v.key ? (isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900') : (isDark ? 'text-white/40 hover:bg-white/5' : 'text-gray-400 hover:bg-gray-50')}`}
              >
                <v.Icon size={14} /> {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {(exportState.status === 'loading' || exportState.status === 'complete') && <div role="status" aria-label="数据导出状态" className="mb-4 whitespace-normal text-sm text-foreground">
        {exportState.status === 'loading' ? `正在导出：${exportState.count}${exportState.total === null ? '' : ` / ${exportState.total}`} 条` : `已准备 ${exportState.count} 条数据，请查看浏览器下载。`}
      </div>}
      {exportState.status === 'error' && <div role="alert" aria-label="数据导出失败" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">
        <span className="min-w-0 flex-1">{exportState.error}</span>
        <button type="button" onClick={handleExport} className={`min-h-11 min-w-11 rounded-lg border px-3 ${inputClass}`}>重新导出</button>
      </div>}
      {loadError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">
        <span className="min-w-0 flex-1">{loadError}</span>
        <button type="button" onClick={() => void loadData()} className={`min-h-11 min-w-11 rounded-lg border px-3 ${inputClass}`}>重试</button>
      </div>}
      {loading && view !== 'gallery' && <div role="status" className={`py-8 text-sm ${textSecondary}`}>加载数据中...</div>}
      {view === 'overview' && !loading && !loadError && renderOverview()}
      {view === 'gallery' && renderGallery()}
      {view === 'users' && !loading && !loadError && renderUsers()}

      {/* Image detail modal */}
      {selectedImage && renderImageDetail()}
    </div>
    </Dialog>
  );
}
