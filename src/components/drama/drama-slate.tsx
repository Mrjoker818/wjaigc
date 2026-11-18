'use client';

import type { DramaShot } from '@/lib/drama/types';
import { activeTake } from '@/lib/drama/types';

export type SlateState = 'idle' | 'generating' | 'selected' | 'failed';

export function slateState(shot: DramaShot, running: boolean): SlateState {
  if (running || shot.takes.some(take => take.status === 'submitted' || take.status === 'generating')) return 'generating';
  if (activeTake(shot)) return 'selected';
  if (shot.takes.at(-1)?.status === 'failed') return 'failed';
  return 'idle';
}

const STATE_TEXT: Record<SlateState, string> = {
  idle: '待拍', generating: '生成中', selected: '已选用', failed: '失败',
};

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The clapperboard strip on every shot card: scene / shot / take, the numbers a script supervisor writes on set.
 * The stripe colour is the shot state; it only moves while a take is generating.
 */
export function DramaSlate({ sceneNumber, shotNumber, shot, running = false, durationSec }: {
  sceneNumber: number;
  shotNumber: number;
  shot: DramaShot;
  running?: boolean;
  durationSec?: number;
}) {
  const state = slateState(shot, running);
  const takeNumber = Math.max(1, shot.takes.length);
  return (
    <div className="drama-slate" data-state={state}>
      <span className="drama-slate__stripes" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-3 px-2">
        <span>场 {pad(sceneNumber)}</span>
        <span>镜 {pad(shotNumber)}</span>
        <span>次 {takeNumber}</span>
        {durationSec ? <span className="ml-auto opacity-70">{durationSec}s</span> : null}
      </span>
      <span className="flex items-center px-2 opacity-80">{STATE_TEXT[state]}</span>
    </div>
  );
}
