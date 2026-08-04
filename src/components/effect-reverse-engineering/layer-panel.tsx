'use client';

import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { EffectReverseRegion } from '@/lib/effect-reverse-engineering/types';
import { addManualRegion, moveRegion, removeRegion, updateRegion } from '@/lib/effect-reverse-engineering/layer-operations';
import { REVERSE_COPY } from './i18n';

interface Props {
  regions: EffectReverseRegion[];
  analyzerAvailable: boolean;
  onChange: (regions: EffectReverseRegion[]) => void;
  onAnalyze: () => void;
}

export function EffectReverseLayerPanel({ regions, analyzerAvailable, onChange, onAnalyze }: Props) {
  const update = (id: string, patch: Partial<EffectReverseRegion>) => onChange(updateRegion(regions, id, patch));
  const move = (index: number, direction: -1 | 1) => onChange(moveRegion(regions, index, direction));
  const addRegion = () => onChange(addManualRegion(regions, `region-${Date.now()}`, REVERSE_COPY.regionLabel(regions.length + 1)));

  return (
    <aside
      data-testid="effect-reverse-layer-panel"
      data-panel="layer-panel"
      className="flex min-h-0 w-[280px] shrink-0 flex-col gap-3 border-l border-white/10 p-3 max-[1100px]:w-[240px] max-[960px]:w-full max-[960px]:border-l-0 max-[960px]:border-t"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{REVERSE_COPY.layers}</h2>
        <button type="button" onClick={addRegion} className="text-xs text-[#d4af37]">
          + {REVERSE_COPY.addRegion}
        </button>
      </div>
      <button
        type="button"
        disabled={!analyzerAvailable}
        onClick={onAnalyze}
        title={analyzerAvailable ? REVERSE_COPY.analyzerAuthorized : REVERSE_COPY.analyzerUnavailable}
        className="border border-white/10 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        {analyzerAvailable ? REVERSE_COPY.analysis : REVERSE_COPY.manualMode}
        <span className="mt-1 block text-[11px] text-amber-300">{REVERSE_COPY.notAnalyzed}</span>
      </button>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {regions.map((region, index) => (
          <div key={region.id} className="border border-white/10 p-2 text-xs">
            <div className="flex items-center gap-1">
              <button type="button" title={region.visible ? REVERSE_COPY.hidden : REVERSE_COPY.visible} onClick={() => update(region.id, { visible: !region.visible })}>
                {region.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button type="button" title={region.locked ? REVERSE_COPY.unlocked : REVERSE_COPY.locked} onClick={() => update(region.id, { locked: !region.locked })}>
                {region.locked ? <Lock className="h-3.5 w-3.5 text-amber-300" /> : <LockOpen className="h-3.5 w-3.5" />}
              </button>
              <input
                aria-label={`${REVERSE_COPY.rename} ${region.label}`}
                disabled={region.locked}
                value={region.label}
                onChange={(event) => update(region.id, { label: event.target.value })}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
              <button type="button" title={REVERSE_COPY.remove} onClick={() => onChange(removeRegion(regions, region.id))}>
                <Trash2 className="h-3.5 w-3.5 text-red-300" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1">
              <button type="button" title={REVERSE_COPY.moveUp} onClick={() => move(index, -1)}><ChevronUp className="h-3.5 w-3.5" /></button>
              <button type="button" title={REVERSE_COPY.moveDown} onClick={() => move(index, 1)}><ChevronDown className="h-3.5 w-3.5" /></button>
              {region.inferred && <span className="text-amber-300">{REVERSE_COPY.inferred}</span>}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
