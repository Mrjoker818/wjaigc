'use client';

import { ImagePlus, LockKeyhole } from 'lucide-react';
import type { EffectReverseSource } from '../effect-reverse-engineering-panel';
import { REVERSE_COPY } from './i18n';

interface Props {
  source: EffectReverseSource;
  onSelect?: (source: EffectReverseSource) => void;
}

export function EffectReverseSourcePanel({ source, onSelect }: Props) {
  return (
    <aside
      data-testid="effect-reverse-source-panel"
      data-panel="source-panel"
      className="flex min-h-0 flex-col gap-3 border-r border-white/10 p-3 max-[960px]:border-b max-[960px]:border-r-0"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImagePlus className="h-4 w-4 text-[#d4af37]" />
        {REVERSE_COPY.source}
      </div>
      <button
        type="button"
        className="overflow-hidden border border-[#d4af37]/50 bg-black/20 text-left"
        onClick={() => onSelect?.(source)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.imageUrl}
          alt={source.label || source.imageId}
          className="aspect-square w-full object-contain"
          draggable={false}
        />
      </button>
      <div className="space-y-1 text-[11px] text-neutral-400">
        <div className="flex items-center gap-1 text-neutral-200">
          <LockKeyhole className="h-3 w-3" />
          {REVERSE_COPY.frozenSource}
        </div>
        <div className="truncate">{source.label || source.imageId}</div>
        <div className="truncate">{REVERSE_COPY.project}：{source.projectId}</div>
        <div className="truncate">{REVERSE_COPY.version}：{source.versionId}</div>
      </div>
    </aside>
  );
}
