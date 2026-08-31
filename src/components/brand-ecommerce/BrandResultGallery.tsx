'use client';

import { Loader2, X, Image as ImageIcon, Sparkles, Download, RotateCw, Plus } from 'lucide-react';
import type { BrandGenerationResult } from '@/types/brand-ecommerce';

// ─── Types ────────────────────────────────────────────────────────

export type GenerateResult = BrandGenerationResult;

interface Props {
  results: GenerateResult[];
  isGenerating: boolean;
  progress: number;
  progressLabel: string;
  selectedTemplateCount: number;
  onCancel: () => void;
  onAddToCanvas: (urls?: string[]) => void;
  onRegenerateTemplate?: (templateId: string) => void;
  isMonochrome?: boolean;
  elapsedTime?: number | null;
  totalTime?: number | null;
  formatTime?: (ms: number) => string;
}

// ─── Component ────────────────────────────────────────────────

export function BrandResultGallery({
  results,
  isGenerating,
  progress,
  progressLabel,
  selectedTemplateCount,
  onCancel,
  onAddToCanvas,
  onRegenerateTemplate,
  isMonochrome = false,
  elapsedTime = 0,
  totalTime = 0,
  formatTime,
}: Props) {
  const text = isMonochrome ? 'text-gray-900' : 'text-gray-100';
  const textMuted = isMonochrome ? 'text-gray-400' : 'text-gray-500';
  const border = isMonochrome ? 'border-gray-200' : 'border-white/[0.08]';
  const accent = isMonochrome ? 'bg-blue-500' : 'bg-[#d4af37]';
  const accentHover = isMonochrome ? 'hover:bg-blue-600' : 'hover:bg-[#e0b840]';
  const accentText = isMonochrome ? 'text-blue-500' : 'text-[#d4af37]';

  const successResults = results.filter(r => r.imageUrl);

  // Group results by templateId for variant display
  const groupedResults = results.reduce<Record<string, GenerateResult[]>>((acc, r) => {
    const key = r.templateId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {isGenerating && (
        <div className={`rounded-xl border ${border} p-4`}>
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={18} className={`animate-spin ${accentText}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${text} truncate`}>{progressLabel || '正在生成...'}</p>
              <div className="flex items-center gap-2">
                <p className={`text-xs ${textMuted}`}>共 {selectedTemplateCount} 个模板</p>
                {elapsedTime !== null && elapsedTime > 0 && formatTime && (
                  <span className={`text-xs ${textMuted}`}>· 已用 {formatTime(elapsedTime)}</span>
                )}
              </div>
            </div>
            <button
              onClick={onCancel}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                isMonochrome ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#333]'
              }`}
            >
              取消
            </button>
          </div>
          <div className={`w-full h-1.5 rounded-full overflow-hidden ${isMonochrome ? 'bg-gray-200' : 'bg-[#333]'}`}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: isMonochrome ? '#3b82f6' : 'linear-gradient(90deg, #d4af37, #f0d060, #d4af37)' }}
            />
          </div>
        </div>
      )}

      {/* Results: grouped by template with variants */}
      {Object.keys(groupedResults).length > 0 && (
        <div className="space-y-3">
          {!isGenerating && totalTime !== null && totalTime > 0 && formatTime && (
            <div className={`text-xs ${textMuted} text-right`}>
              总耗时 {formatTime(totalTime)}
            </div>
          )}
          {Object.entries(groupedResults).map(([templateId, templateResults]) => {
            const successVariants = templateResults.filter(r => r.imageUrl);
            const failedVariants = templateResults.filter(r => r.error);
            const templateName = templateResults[0]?.templateName || templateId;
            const hasMultipleVariants = templateResults.length > 1 && successVariants.length > 0;

            return (
              <div key={templateId} className={`rounded-xl border overflow-hidden ${border}`}>
                {/* Template header */}
                <div className={`flex items-center justify-between px-3 py-2 ${isMonochrome ? 'bg-gray-50' : 'bg-[#1a1a1a]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${text}`}>{templateName}</span>
                    {hasMultipleVariants && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isMonochrome ? 'bg-blue-50 text-blue-500' : 'bg-[#d4af37]/10 text-[#d4af37]'}`}>
                        {successVariants.length} 个变体
                      </span>
                    )}
                  </div>
                  {onRegenerateTemplate && (
                    <button
                      onClick={() => onRegenerateTemplate(templateId)}
                      disabled={isGenerating}
                      className={`flex items-center gap-1 text-xs ${textMuted} hover:${accentText} transition-colors cursor-pointer`}
                      title="重新生成"
                    >
                      <RotateCw size={12} />
                      重新生成
                    </button>
                  )}
                </div>

                {/* Variant images */}
                {successVariants.length > 0 && (
                  <div className={`grid ${hasMultipleVariants ? 'grid-cols-2' : 'grid-cols-1'} gap-0.5 p-1`}>
                    {successVariants.map((r, i) => (
                      <div key={i} className="relative group">
                        <img
                          src={r.imageUrl}
                          alt={`${r.templateName} 变体${i + 1}`}
                          className="w-full object-cover cursor-pointer transition-opacity group-hover:opacity-90"
                          style={{ aspectRatio: r.aspectRatio || '1/1' }}
                          onClick={() => onAddToCanvas([r.imageUrl!])}
                        />
                        {/* Hover overlay with actions */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); onAddToCanvas([r.imageUrl!]); }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'} cursor-pointer`}
                          >
                            <Plus size={10} /> 画布
                          </button>
                        </div>
                        {/* Variant badge */}
                        {hasMultipleVariants && (
                          <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isMonochrome ? 'bg-white/80 text-gray-700' : 'bg-black/60 text-white/80'
                          }`}>
                            V{i + 1}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Error states */}
                {failedVariants.length > 0 && (
                  <div className={`flex items-center justify-center py-6 ${isMonochrome ? 'bg-gray-50' : 'bg-[#222]'}`}>
                    <div className="text-center px-4">
                      <X size={20} className="text-red-400 mx-auto mb-1" />
                      {Array.from(new Set(failedVariants.map(r => r.error || '生成失败'))).map(error => (
                        <p key={error} role="alert" className="text-xs text-red-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{error}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isGenerating && results.length === 0 && (
        <div className={`text-center py-10 ${textMuted}`}>
          <ImageIcon size={32} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm">尚未生成结果</p>
          <p className="text-xs mt-1">选择模板并配置参数后，点击生成按钮</p>
        </div>
      )}

      {/* Batch add to canvas */}
      {successResults.length > 0 && (
        <button
          onClick={() => onAddToCanvas()}
          className={`flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-lg text-sm font-medium ${accent} ${isMonochrome ? 'text-white' : 'text-black'} ${accentHover} transition-colors cursor-pointer`}
        >
          <Sparkles size={12} />
          全部添加到画布 ({successResults.length})
        </button>
      )}
    </div>
  );
}
