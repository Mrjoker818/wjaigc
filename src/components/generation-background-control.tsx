'use client';

import React from 'react';
import { Check, Image as ImageIcon } from 'lucide-react';
import { getModelCapabilities } from '@/lib/model-capabilities';
import type { ImageBackgroundMode, ImageOutputPreference } from '@/lib/image-generation-output';

interface GenerationBackgroundControlProps {
  modelId: string;
  value: ImageOutputPreference;
  onChange: (value: ImageOutputPreference) => void;
  themeStyle?: 'gold' | 'monochrome';
}

const OPTIONS: Array<{ value: ImageBackgroundMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'transparent', label: '透明' },
  { value: 'opaque', label: '不透明' },
];

export function GenerationBackgroundControl({
  modelId,
  value,
  onChange,
  themeStyle = 'gold',
}: GenerationBackgroundControlProps) {
  const supportsBackground = Boolean(modelId) && getModelCapabilities(modelId).supportsBackground;
  const monochrome = themeStyle === 'monochrome';

  return (
    <div className="space-y-1.5" data-testid="generation-background-control">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        背景
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="生成图片背景">
        {OPTIONS.map((option) => {
          const disabled = option.value === 'transparent' && !supportsBackground;
          const selected = value.background === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange({
                background: option.value,
                outputFormat: option.value === 'transparent' ? 'png' : value.outputFormat,
              })}
              className={`flex h-8 items-center justify-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                selected
                  ? monochrome
                    ? 'border-black bg-black text-white'
                    : 'border-[#d4af37] bg-[#d4af37]/15 text-[#d4af37]'
                  : 'border-border bg-background/40 text-muted-foreground hover:border-muted-foreground/50'
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {selected && <Check className="h-3 w-3" aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {!supportsBackground
          ? '当前模型不支持原生透明背景'
          : value.background === 'transparent'
            ? '真正透明的 PNG（含 Alpha 通道）'
            : '透明模式不会自动调用二次去背景服务'}
      </p>
    </div>
  );
}
