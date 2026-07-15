'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bookmark, Plus, Trash2, Star, Save, ChevronDown, Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────

export interface BrandAssetData {
  id: string;
  name: string;
  brandName: string;
  brandColors: string[];
  styleExtra: string;
  sceneDesc: string;
  referenceImageUrl: string;
  productImageUrl: string;
  productDesc: string;
  mainText: string;
  secondaryText: string;
  accentSymbol: string;
  selectedModel: string;
  isDefault: boolean;
}

interface Props {
  /** Current settings state to save */
  currentSettings: {
    productDesc: string;
    styleExtra: string;
    sceneDesc: string;
    brandColors: string[];
    refImage: string;
    productImage: string;
    selectedModel: string;
    mainText: string;
    secondaryText: string;
    accentSymbol: string;
  };
  /** Callback to apply loaded settings */
  onApply: (settings: BrandAssetData) => void;
  /** Current user ID */
  userId: string;
  isMonochrome?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────

export function BrandAssetManager({ currentSettings, onApply, userId, isMonochrome = false }: Props) {
  const [assets, setAssets] = useState<BrandAssetData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Theme
  const bg = isMonochrome ? 'bg-white' : 'bg-[#1a1a1a]';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textSub = isMonochrome ? 'text-gray-500' : 'text-gray-400';
  const accent = isMonochrome ? '#2563eb' : '#d4af37';

  // ─── Load assets on mount ───
  useEffect(() => {
    if (!userId) return;
    setIsLoading(true);
    fetch(`/api/brand-assets?userId=${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.assets) {
          setAssets(data.assets.map((a: Record<string, unknown>) => mapDbToAsset(a)));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [userId]);

  // ─── Close dropdown on outside click ───
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Save current settings as new brand asset ───
  const handleSave = useCallback(async () => {
    if (!saveName.trim()) return;
    setIsSaving(true);
    try {
      const resp = await fetch('/api/brand-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          userId,
          name: saveName.trim(),
          brandName: '',
          brandColors: currentSettings.brandColors,
          styleExtra: currentSettings.styleExtra,
          sceneDesc: currentSettings.sceneDesc,
          referenceImageUrl: currentSettings.refImage,
          productImageUrl: currentSettings.productImage,
          productDesc: currentSettings.productDesc,
          mainText: currentSettings.mainText,
          secondaryText: currentSettings.secondaryText,
          accentSymbol: currentSettings.accentSymbol,
          selectedModel: currentSettings.selectedModel,
        }),
      });
      const data = await resp.json();
      if (data.success && data.asset) {
        setAssets(prev => [mapDbToAsset(data.asset), ...prev.filter(a => a.id !== data.asset.id)]);
        setShowSaveDialog(false);
        setSaveName('');
      }
    } catch {
      /* ignore */
    }
    setIsSaving(false);
  }, [saveName, userId, currentSettings]);

  // ─── Load asset and apply ───
  const handleLoad = useCallback((asset: BrandAssetData) => {
    onApply(asset);
    setShowDropdown(false);
  }, [onApply]);

  // ─── Delete asset ───
  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/api/brand-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      if ((await resp.json()).success) {
        setAssets(prev => prev.filter(a => a.id !== id));
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Set as default ───
  const handleSetDefault = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/api/brand-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setDefault', userId, id }),
      });
      if ((await resp.json()).success) {
        setAssets(prev => prev.map(a => ({ ...a, isDefault: a.id === id })));
      }
    } catch { /* ignore */ }
  }, [userId]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setShowDropdown(v => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isMonochrome ? 'text-gray-600 hover:bg-gray-100 border border-gray-200' : 'text-gray-300 hover:bg-[#2a2a2a] border border-white/[0.08]'}`}
      >
        <Bookmark size={12} />
        品牌方案
        {assets.length > 0 && (
          <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/20 text-[#d4af37]'}`}>
            {assets.length}
          </span>
        )}
        <ChevronDown size={10} className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {showDropdown && (
        <div className={`absolute top-full left-0 mt-1 w-72 rounded-xl shadow-2xl overflow-hidden z-50 ${bg} border ${border}`}>
          {/* Header */}
          <div className={`flex items-center justify-between px-3 py-2 border-b ${border}`}>
            <span className={`text-xs font-semibold ${text}`}>已保存的品牌方案</span>
            <button
              onClick={() => { setShowSaveDialog(true); setShowDropdown(false); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors"
              style={{ color: accent, background: isMonochrome ? 'rgba(37,99,235,0.08)' : 'rgba(212,175,55,0.1)' }}
            >
              <Plus size={10} /> 保存当前
            </button>
          </div>

          {/* Asset list */}
          <div className="max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className={`flex items-center justify-center py-6 ${textSub}`}>
                <Loader2 size={14} className="animate-spin mr-2" /> 加载中...
              </div>
            ) : assets.length === 0 ? (
              <div className={`py-6 text-center text-xs ${textSub}`}>
                暂无保存的品牌方案<br />
                <span className="text-[10px]">点击&ldquo;保存当前&rdquo;将当前设置保存为品牌方案</span>
              </div>
            ) : (
              assets.map(asset => (
                <div
                  key={asset.id}
                  onClick={() => handleLoad(asset)}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors group ${isMonochrome ? 'hover:bg-gray-50' : 'hover:bg-[#2a2a2a]'}`}
                >
                  {/* Star for default */}
                  <button
                    onClick={(e) => handleSetDefault(asset.id, e)}
                    className="shrink-0 cursor-pointer transition-colors"
                    style={{ color: asset.isDefault ? accent : isMonochrome ? '#d1d5db' : '#555' }}
                    title={asset.isDefault ? '默认方案' : '设为默认'}
                  >
                    <Star size={12} fill={asset.isDefault ? accent : 'none'} />
                  </button>

                  {/* Asset info */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium truncate ${text}`}>
                      {asset.name}
                      {asset.isDefault && (
                        <span className="ml-1 text-[10px] font-normal" style={{ color: accent }}>默认</span>
                      )}
                    </div>
                    <div className={`text-[10px] truncate ${textSub}`}>
                      {asset.productDesc?.slice(0, 30) || '无描述'}
                      {asset.brandColors?.length > 0 && (
                        <span className="ml-1.5 inline-flex gap-0.5">
                          {asset.brandColors.slice(0, 3).map((c, i) => (
                            <span key={i} className="inline-block w-2 h-2 rounded-full border border-white/10" style={{ background: c }} />
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDelete(asset.id, e)}
                    className={`shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded transition-all cursor-pointer ${isMonochrome ? 'text-gray-400 hover:text-red-500' : 'text-gray-500 hover:text-red-400'}`}
                    title="删除方案"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Save dialog */}
      {showSaveDialog && (
        <div className={`absolute top-full left-0 mt-1 w-72 rounded-xl shadow-2xl overflow-hidden z-50 ${bg} border ${border}`}>
          <div className={`px-3 py-2 border-b ${border}`}>
            <span className={`text-xs font-semibold ${text}`}>保存品牌方案</span>
          </div>
          <div className="p-3">
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="输入方案名称，如：品牌A主视觉"
              className={`w-full px-3 py-2 rounded-lg text-xs border ${border} ${isMonochrome ? 'bg-gray-50 text-gray-900 placeholder:text-gray-400' : 'bg-[#111] text-gray-100 placeholder:text-gray-500'} focus:outline-none focus:ring-2`}
              style={{ '--tw-ring-color': `${accent}40` } as React.CSSProperties}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleSave}
                disabled={!saveName.trim() || isSaving}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-black cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: accent }}
              >
                {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                {isSaving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => { setShowSaveDialog(false); setSaveName(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${isMonochrome ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-400 hover:bg-[#2a2a2a]'}`}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper: Map DB row to frontend BrandAssetData ────────────────────────

function mapDbToAsset(row: Record<string, unknown>): BrandAssetData {
  return {
    id: row.id as string,
    name: row.name as string || '未命名方案',
    brandName: row.brand_name as string || '',
    brandColors: Array.isArray(row.brand_colors) ? row.brand_colors as string[] : [],
    styleExtra: row.style_extra as string || '',
    sceneDesc: row.scene_desc as string || '',
    referenceImageUrl: row.reference_image_url as string || '',
    productImageUrl: row.product_image_url as string || '',
    productDesc: row.product_desc as string || '',
    mainText: row.main_text as string || '',
    secondaryText: row.secondary_text as string || '',
    accentSymbol: row.accent_symbol as string || '',
    selectedModel: row.selected_model as string || '',
    isDefault: row.is_default as boolean || false,
  };
}
