'use client';

import { Check } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────

interface EcomTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptTemplate: string;
  negativePrompt: string;
  aspectRatio: string;
  category: string;
}

interface Props {
  templates: EcomTemplate[];
  selectedTemplates: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  isMonochrome?: boolean;
}

// ─── Category config ─────────────────────────────────────────

const CATEGORIES: Record<string, { label: string; icon: string; accent: { mono: string; dark: string } }> = {
  product: { label: '白底主图', icon: '⬜', accent: { mono: 'border-blue-400 bg-blue-50 text-blue-600', dark: 'border-[#4a9eff]/40 bg-[#4a9eff]/10 text-[#4a9eff]' } },
  scene: { label: '场景氛围', icon: '🏞️', accent: { mono: 'border-emerald-400 bg-emerald-50 text-emerald-600', dark: 'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]' } },
  model: { label: '模特展示', icon: '👗', accent: { mono: 'border-pink-400 bg-pink-50 text-pink-600', dark: 'border-[#f472b6]/40 bg-[#f472b6]/10 text-[#f472b6]' } },
  detail: { label: '详情组合', icon: '📱', accent: { mono: 'border-violet-400 bg-violet-50 text-violet-600', dark: 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#a78bfa]' } },
  promo: { label: '促销海报', icon: '🎨', accent: { mono: 'border-amber-400 bg-amber-50 text-amber-600', dark: 'border-[#fbbf24]/40 bg-[#fbbf24]/10 text-[#fbbf24]' } },
  social: { label: '社交媒体', icon: '📕', accent: { mono: 'border-rose-400 bg-rose-50 text-rose-600', dark: 'border-[#fb7185]/40 bg-[#fb7185]/10 text-[#fb7185]' } },
  creative: { label: '创意合成', icon: '✨', accent: { mono: 'border-orange-400 bg-orange-50 text-orange-600', dark: 'border-[#fb923c]/40 bg-[#fb923c]/10 text-[#fb923c]' } },
  brand: { label: '品牌故事', icon: '🏷️', accent: { mono: 'border-sky-400 bg-sky-50 text-sky-600', dark: 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]' } },
  tech: { label: '科技数码', icon: '💻', accent: { mono: 'border-cyan-400 bg-cyan-50 text-cyan-600', dark: 'border-[#22d3ee]/40 bg-[#22d3ee]/10 text-[#22d3ee]' } },
  banner: { label: '横版Banner', icon: '🖼️', accent: { mono: 'border-indigo-400 bg-indigo-50 text-indigo-600', dark: 'border-[#818cf8]/40 bg-[#818cf8]/10 text-[#818cf8]' } },
};

// ─── Aspect ratio visual helper ──────────────────────────────

function aspectVisual(ar: string) {
  const [w, h] = ar.split(':').map(Number);
  const maxDim = 16;
  const scale = maxDim / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// ─── Component ────────────────────────────────────────────────

export function BrandTemplateSelector({
  templates,
  selectedTemplates,
  onToggle,
  onSelectAll,
  onClearAll,
  isMonochrome = false,
}: Props) {
  const accentText = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const accentBg = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';

  // Group templates by category for better visual organization
  const groupedTemplates = templates.reduce<Record<string, EcomTemplate[]>>((acc, tpl) => {
    const cat = tpl.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tpl);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header with select all / clear */}
      <div className="flex items-center justify-between">
        <p className={`text-sm ${isMonochrome ? 'text-gray-500' : 'text-gray-400'}`}>
          选择需要生成的商品图类型（可多选）
        </p>
        <div className="flex gap-2">
          <button
            onClick={onSelectAll}
            className={`text-sm ${accentText} hover:underline cursor-pointer transition-colors`}
          >
            全选
          </button>
          <span className={textMuted}>|</span>
          <button
            onClick={onClearAll}
            className={`text-sm ${textMuted} hover:underline cursor-pointer transition-colors`}
          >
            清空
          </button>
        </div>
      </div>

      {/* Selected count badge */}
      {selectedTemplates.size > 0 && (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
          isMonochrome ? 'bg-blue-50 text-blue-600' : 'bg-[#d4af37]/10 text-[#d4af37]'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${accentBg}`} />
          已选 {selectedTemplates.size} 个模板
        </div>
      )}

      {/* Template grid grouped by category */}
      {Object.entries(groupedTemplates).map(([category, tpls]) => {
        const catConfig = CATEGORIES[category] || CATEGORIES.product;
        const catAccentClass = isMonochrome ? catConfig.accent.mono : catConfig.accent.dark;

        return (
          <div key={category}>
            {/* Category section label */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${catAccentClass} px-2 py-0.5 rounded-md`}>
                {catConfig.label}
              </span>
              <div className={`flex-1 h-px ${isMonochrome ? 'bg-gray-200' : 'bg-white/[0.06]'}`} />
            </div>

            {/* Templates in this category */}
            <div className="grid grid-cols-2 gap-2.5">
              {tpls.map(tpl => {
                const selected = selectedTemplates.has(tpl.id);
                const vis = aspectVisual(tpl.aspectRatio);
                return (
                  <button
                    key={tpl.id}
                    onClick={() => onToggle(tpl.id)}
                    className={`relative text-left p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      selected
                        ? isMonochrome
                          ? 'bg-blue-50/80 border-blue-300 shadow-sm shadow-blue-100'
                          : 'bg-[#1f1f1f] border-[#d4af37]/30 shadow-sm shadow-[#d4af37]/5'
                        : isMonochrome
                          ? 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                          : 'bg-[#1a1a1a] border-white/[0.05] hover:border-white/[0.12] hover:shadow-sm'
                    }`}
                  >
                    {/* Check indicator */}
                    {selected && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${accentBg} transition-transform duration-200`}>
                        <Check size={12} className={isMonochrome ? 'text-white' : 'text-black'} />
                      </div>
                    )}

                    <div className="flex items-start gap-2.5">
                      <span className="text-base leading-none mt-0.5 shrink-0">{tpl.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-sm font-semibold truncate ${isMonochrome ? 'text-gray-900' : 'text-gray-100'}`}>
                            {tpl.name}
                          </span>
                        </div>
                        <p className={`text-xs leading-relaxed line-clamp-2 ${textMuted}`}>
                          {tpl.description}
                        </p>
                        {/* Aspect ratio indicator */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <div
                            className={`rounded-[2px] border ${isMonochrome ? 'border-gray-300' : 'border-white/20'}`}
                            style={{ width: vis.width, height: vis.height, backgroundColor: isMonochrome ? '#e5e7eb' : '#333' }}
                          />
                          <span className={`text-[11px] font-mono ${textMuted}`}>{tpl.aspectRatio}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
