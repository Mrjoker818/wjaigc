'use client';

import React, { useEffect, useId } from 'react';
import { Check, X, Zap, Cpu, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EditEngine = 'auto' | 'ai' | 'local';

export interface EngineOption {
  id: EditEngine;
  label: string;
  description: string;
  icon: React.ReactNode;
  recommended?: boolean;
  badge?: string;
}

interface EngineSelectDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  toolType: 'upscale' | 'removebg' | 'svg' | 'segment';
  onSelect: (engine: EditEngine) => void;
  onClose: () => void;
  loadingEngine?: EditEngine | null;
  selectedEngine?: EditEngine;
}

const ENGINE_OPTIONS: Record<EditEngine, Omit<EngineOption, 'id'>> = {
  auto: {
    label: '智能自动',
    description: '优先云端AI，失败自动降级到本地算法',
    icon: <Sparkles className="w-5 h-5" />,
    recommended: true,
    badge: '推荐',
  },
  ai: {
    label: '云端 AI',
    description: '使用专用AI模型，效果最佳（需API）',
    icon: <Zap className="w-5 h-5" />,
  },
  local: {
    label: '本地算法',
    description: '纯本地处理，无需联网，速度快',
    icon: <Cpu className="w-5 h-5" />,
  },
};

const TOOL_SPECIFIC_HINTS: Record<string, Record<EditEngine, string>> = {
  upscale: {
    auto: 'AI专用放大模型 → 通用AI放大',
    ai: 'SeedVR2 / Real-ESRGAN 等云端AI超分模型',
    local: '本地保真放大已随本地模型移除，不再可用',
  },
  removebg: {
    auto: 'RemoveBG专用模型 → 通用AI透明背景',
    ai: 'BRIA-RMBG / BiRefNet 等AI抠图模型',
    local: '本地 IOPaint RemoveBG 已随本地模型移除，不再可用',
  },
  svg: {
    auto: 'SVG专用模型 → LLM视觉描摹 → 本地 vtracer',
    ai: '专用矢量模型 + LLM视觉智能描摹',
    local: '本地 vtracer + potrace 算法，彩色/黑白',
  },
  segment: {
    auto: '分层专用模型 → 通用AI分割 → 本地连通域',
    ai: 'Florence / SAM 等AI分割模型',
    local: '本地连通域分割算法',
  },
};

/** 本地模型已移除的工具：不再提供「本地算法」引擎选项。 */
const LOCAL_ENGINE_REMOVED_TOOLS = new Set(['upscale', 'removebg']);

export function EngineSelectDialog({
  open,
  title,
  subtitle,
  toolType,
  onSelect,
  onClose,
  loadingEngine,
  selectedEngine,
}: EngineSelectDialogProps) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [open, onClose]);

  if (!open) return null;

  const supportsLocalEngine = !LOCAL_ENGINE_REMOVED_TOOLS.has(toolType);
  const engines: EditEngine[] = supportsLocalEngine ? ['auto', 'ai', 'local'] : ['auto', 'ai'];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby={titleId}
        className="relative w-[480px] max-w-[90vw] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-card border border-border rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          aria-label="关闭引擎选择"
          className="absolute top-4 right-4 inline-flex min-h-11 min-w-11 items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 标题 */}
        <div className="mb-5 pr-12">
          <h2 id={titleId} className="text-xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>

        {/* 引擎选项 */}
        <div className="space-y-3">
          {engines.map(engineId => {
            const opt = ENGINE_OPTIONS[engineId];
            const hint = TOOL_SPECIFIC_HINTS[toolType][engineId];
            const description = engineId === 'auto' && !supportsLocalEngine
              ? '优先使用云端专用模型，必要时尝试通用图像模型'
              : opt.description;
            const isLoading = loadingEngine === engineId;
            const isSelected = selectedEngine === engineId;
            return (
              <button
                key={engineId}
                disabled={!!loadingEngine}
                aria-pressed={selectedEngine === undefined ? undefined : isSelected}
                onClick={() => onSelect(engineId)}
                className={cn(
                  "w-full text-left p-4 rounded-xl border-2 transition-all duration-200",
                  "bg-background hover:border-primary/50 hover:bg-primary/5",
                  "border-border group relative disabled:opacity-60 disabled:cursor-not-allowed",
                  isSelected && "border-primary bg-primary/10",
                  isLoading && "border-primary bg-primary/10 pointer-events-none"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                    "bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary",
                    isLoading && "bg-primary/20 text-primary"
                  )}>
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{opt.label}</span>
                      {opt.badge && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground rounded-full">
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1.5 font-mono">{hint}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 底部提示 */}
        <p className="text-xs text-muted-foreground/60 text-center mt-4">
          按 Esc 关闭 · 引擎选择会自动记忆
        </p>
      </div>
    </div>
  );
}
