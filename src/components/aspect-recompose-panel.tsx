'use client';

import { ASPECT_RECOMPOSE_RATIOS, type AspectRecomposeRatio } from '@/lib/aspect-recompose';

export interface AspectRecomposePanelProps {
  targetRatio: AspectRecomposeRatio;
  processing: boolean;
  isMonochrome?: boolean;
  onTargetRatioChange: (targetRatio: AspectRecomposeRatio) => void;
  onConfirm: (ratio: string) => void;
  onClose: () => void;
}

export function AspectRecomposePanel({
  targetRatio,
  processing,
  isMonochrome,
  onTargetRatioChange,
  onConfirm,
  onClose,
}: AspectRecomposePanelProps) {
  return (
    <div
      className={`absolute top-full left-1/2 z-50 mt-2 w-80 -translate-x-1/2 border p-3 shadow-2xl ${isMonochrome ? 'border-gray-200 bg-white' : 'border-white/[0.12] bg-[#141418]'}`}
      style={{ borderRadius: 8 }}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      data-popup="aspect-recompose"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className={`text-xs font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>横竖智能重组</div>
          <div className={`mt-1 text-[11px] ${isMonochrome ? 'text-gray-500' : 'text-white/55'}`}>手动选择目标比例，重新组织原图内容与版式</div>
        </div>
        <button type="button" onClick={onClose} className={`px-2 py-1 text-xs ${isMonochrome ? 'text-gray-500 hover:text-gray-900' : 'text-white/55 hover:text-white'}`}>关闭</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ASPECT_RECOMPOSE_RATIOS.map((ratio) => {
          const selected = ratio.value === targetRatio;
          const previewHeight = ratio.width >= ratio.height ? 16 : 24;
          const previewWidth = Math.max(12, Math.round(previewHeight * ratio.width / ratio.height));
          return (
            <button
              type="button"
              key={ratio.value}
              onClick={() => onTargetRatioChange(ratio.value)}
              className={`flex h-14 items-center gap-2 border px-2 text-left text-xs transition-colors ${selected ? isMonochrome ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-[#d4af37] bg-[#d4af37]/15 text-[#f0d67a]' : isMonochrome ? 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100' : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'}`}
              style={{ borderRadius: 6 }}
            >
              <span className={`flex h-7 w-7 items-center justify-center ${isMonochrome ? 'bg-white' : 'bg-black/25'}`}>
                <span className={`block border ${selected ? isMonochrome ? 'border-cyan-500' : 'border-[#d4af37]' : isMonochrome ? 'border-gray-400' : 'border-white/45'}`} style={{ width: previewWidth, height: previewHeight }} />
              </span>
              <span><span className="block font-semibold">{ratio.value}</span><span className="block text-[10px] opacity-70">{ratio.label}</span></span>
            </button>
          );
        })}
      </div>

      <div className={`mt-3 border-t pt-3 text-[11px] leading-relaxed ${isMonochrome ? 'border-gray-100 text-gray-500' : 'border-white/[0.08] text-white/50'}`}>
        原图不会被覆盖。AI 将保留主体、元素、品牌标识和可识别文字，并在新比例内重新排版；含文字的结果建议人工复核。
      </div>
      <button
        type="button"
        onClick={() => onConfirm(targetRatio)}
        disabled={processing}
        className={`mt-3 w-full px-3 py-2 text-xs font-semibold transition-colors ${processing ? isMonochrome ? 'bg-gray-100 text-gray-400' : 'bg-white/5 text-white/35' : isMonochrome ? 'bg-cyan-600 text-white hover:bg-cyan-700' : 'bg-[#d4af37] text-black hover:bg-[#e1c45d]'}`}
        style={{ borderRadius: 6 }}
      >
        {processing ? '正在重组...' : `按 ${targetRatio} 开始重组`}
      </button>
    </div>
  );
}
