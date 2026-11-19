'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { mergeMentionIds } from '@/lib/drama/mentions';
import { CAMERA_MOVES, chosenShotValue, SHOT_SIZES } from '@/lib/drama/shot-language';
import type { DramaShot } from '@/lib/drama/types';
import { polishShotPrompt } from '@/lib/drama/workbench-client';
import { updateShot } from '@/lib/drama/workbench-state';
import { useDrama } from './drama-context';

type Snapshot = Pick<DramaShot, 'prompt' | 'directedPrompt' | 'shotSize' | 'cameraMotion' | 'cameraMove' | 'lighting' | 'audioCues'>;

function snapshot(shot: DramaShot): Snapshot {
  const { prompt, directedPrompt, shotSize, cameraMotion, cameraMove, lighting, audioCues } = shot;
  return { prompt, directedPrompt, shotSize, cameraMotion, cameraMove, lighting, audioCues };
}

/**
 * The polish button beside the prompt label, and the "undo" line under the prompt once it ran.
 * `undo` lives in the inspector so a manual edit of the prompt can drop it.
 */
export function usePromptPolish(shot: DramaShot) {
  const { doc, update } = useDrama();
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const polish = async () => {
    if (busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const result = await polishShotPrompt(doc, shot.id, undefined, controller.signal);
      if (controller.signal.aborted) return;
      setUndo(snapshot(shot));
      update(current => updateShot(current, shot.id, item => ({
        ...item,
        prompt: result.prompt,
        directedPrompt: undefined,
        ...(result.shotSize ? { shotSize: result.shotSize } : {}),
        ...(result.cameraMotion ? { cameraMotion: result.cameraMotion, cameraMove: result.cameraMotion } : {}),
        ...(result.lighting ? { lighting: result.lighting } : {}),
        ...(result.audioCues ? { audioCues: result.audioCues } : {}),
        ...mergeMentionIds(item, result.prompt, current),
      })));
    } catch (error) {
      if (!controller.signal.aborted) toast.error('润色失败', { description: error instanceof Error ? error.message : '请稍后重试' });
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(false);
    }
  };

  const restore = () => {
    if (!undo) return;
    update(current => updateShot(current, shot.id, item => ({ ...item, ...undo })));
    setUndo(null);
  };

  return { busy, polish, canUndo: Boolean(undo), restore, dropUndo: () => setUndo(null) };
}

export function PolishButton({ busy, onPolish }: { busy: boolean; onPolish: () => void }) {
  return (
    <button type="button" className="drama-btn drama-btn--quiet min-h-8 gap-1 whitespace-nowrap px-2 text-xs" disabled={busy} onClick={onPolish}
      title="用对话模型按导演写法改写，并填好景别、运镜、光线和声音。不扣积分。">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
      {busy ? '润色中' : '润色'}
    </button>
  );
}

function OptionSelect({ label, value, options, onChange }: {
  label: string; value: string; options: readonly string[]; onChange: (value: string) => void;
}) {
  // Older shots may hold a value outside the list; keep it selectable so it is not silently replaced.
  const extra = value && !options.includes(value) ? value : '';
  return (
    <label className="flex flex-col gap-1">
      <span className="drama-label">{label}</span>
      <select className="drama-input" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">不指定</option>
        {extra ? <option value={extra}>{extra}</option> : null}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/** Shot size, camera move, light and sound. They are added to the prompt as one "镜头：…" line. */
export function ShotLanguageFields({ shot }: { shot: DramaShot }) {
  const { update } = useDrama();
  const set = (patch: Partial<DramaShot>) => update(current => updateShot(current, shot.id, patch));
  return (
    <fieldset className="grid grid-cols-2 gap-3">
      <legend className="drama-label mb-1">镜头语言（加在画面描述后面发给视频模型）</legend>
      <OptionSelect label="景别" value={chosenShotValue(shot.shotSize)} options={SHOT_SIZES} onChange={shotSize => set({ shotSize })} />
      <OptionSelect label="运镜" value={chosenShotValue(shot.cameraMove || shot.cameraMotion)} options={CAMERA_MOVES}
        onChange={move => set({ cameraMotion: move, cameraMove: move })} />
      <label className="col-span-2 flex flex-col gap-1">
        <span className="drama-label">光线</span>
        <input className="drama-input" maxLength={200} placeholder="例如：窗侧光，暖色" value={shot.lighting ?? ''}
          onChange={event => set({ lighting: event.target.value })} />
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        <span className="drama-label">声音（填了会让模型一起生成音效）</span>
        <input className="drama-input" maxLength={200} placeholder="例如：远处雷声，雨打窗户" value={shot.audioCues ?? ''}
          onChange={event => set({ audioCues: event.target.value })} />
      </label>
    </fieldset>
  );
}
