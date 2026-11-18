'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Stethoscope, X } from 'lucide-react';
import { chooseFirstFrame, shotReferenceImages } from '@/lib/drama/shot-runner';
import { applyRetakeSuggestion, estimateShots } from '@/lib/drama/workbench-client';
import { findShot, fitDuration, orderedPrevious, updateShot } from '@/lib/drama/workbench-state';
import { diagnoseFailure, listFailureTypes, type VideoFailureType } from '@/lib/video-director/retake-diagnosis';
import { useDrama } from './drama-context';

const FIRST_FRAME_TEXT = {
  user: '首帧：你指定的图片',
  location: '首帧：场景图',
  'previous-shot': '首帧：上一镜头的最后一帧',
  none: '首帧：无，模型按文字生成',
} as const;

/**
 * Right column on desktop, bottom sheet on small screens. Edits the selected shot and explains
 * which first frame and references the next take will use.
 */
export function DramaInspector() {
  const { doc, selectedShotId, selectShot } = useDrama();
  const found = selectedShotId ? findShot(doc, selectedShotId) : undefined;

  if (!found) {
    return (
      <aside aria-label="镜头检查器" className="hidden w-80 shrink-0 border-l border-[var(--drama-line)] p-4 lg:block">
        <p className="drama-label">选中一个镜头，在这里调整提示词、模型、时长和参考图。</p>
      </aside>
    );
  }
  return (
    <aside aria-label="镜头检查器"
      className="fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t border-[var(--drama-line)] bg-[var(--drama-graphite)] p-4 shadow-2xl lg:static lg:z-auto lg:max-h-none lg:w-80 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
      <InspectorBody key={found.shot.id} shotId={found.shot.id} onClose={() => selectShot(null)} />
    </aside>
  );
}

function InspectorBody({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const { doc, update, models, modelForShot, generateShots, runningShotIds, batchRunning, generateAudio } = useDrama();
  const [failure, setFailure] = useState<VideoFailureType | ''>('');
  const found = findShot(doc, shotId);
  if (!found) return null;
  const { shot, episode } = found;
  const model = modelForShot(shot);
  const previous = orderedPrevious(doc, episode.id, shot.id);
  const location = doc.locations.find(item => item.id === shot.sceneId);
  const firstFrame = model ? chooseFirstFrame(shot, previous, location, model.capability) : { source: 'none' as const };
  // The previous shot's frame is extracted only at submit time; its video URL stands in so the count matches.
  const references = model
    ? shotReferenceImages(shot, doc.cast, model.capability, firstFrame.url ?? ('previousVideoUrl' in firstFrame ? firstFrame.previousVideoUrl : undefined))
    : [];
  const diagnosis = failure ? diagnoseFailure(failure) : null;
  const running = runningShotIds.has(shot.id);
  const set = (patch: Parameters<typeof updateShot>[2]) => update(current => updateShot(current, shot.id, patch));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-base font-bold">镜头 {String(shot.index + 1).padStart(2, '0')} · {found.scene.heading}</h2>
        <button type="button" className="drama-btn drama-btn--quiet ml-auto px-2" aria-label="关闭检查器" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="drama-label">画面提示词</span>
        <textarea className="drama-input min-h-28 resize-y" maxLength={8000} value={shot.prompt} onChange={event => set({ prompt: event.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="drama-label">台词</span>
        <textarea className="drama-input min-h-14 resize-y" maxLength={2000} value={shot.dialogue ?? ''} onChange={event => set({ dialogue: event.target.value })} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="drama-label">视频模型</span>
          <select className="drama-input" value={shot.modelId ?? ''} onChange={event => {
            const picked = models.find(item => item.key === event.target.value);
            const next = picked ?? modelForShot({ ...shot, modelId: undefined, providerId: undefined });
            // Models reject lengths outside their list, so show the length the new model will really use.
            const durationSec = next ? fitDuration(shot.durationSec, next.durations, next.maxDuration) : shot.durationSec;
            set({ modelId: picked?.key, providerId: picked?.providerId, durationSec });
          }}>
            <option value="">跟随默认模型{model && !shot.modelId ? `（${model.name}）` : ''}</option>
            {models.map(item => <option key={item.key} value={item.key}>{item.name} · {item.providerName}</option>)}
          </select>
        </label>
        {model ? (
          <ShotCost shotId={shot.id} modelKey={model.key} modelName={model.name} providerId={model.providerId}
            durationSec={fitDuration(shot.durationSec, model.durations, model.maxDuration)}
            generateAudio={generateAudio || Boolean(shot.dialogue || shot.audioCues)} referenceImages={references.length} />
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="drama-label">时长（秒）</span>
          {model?.durations.length ? (
            <select className="drama-input font-mono" value={shot.durationSec} onChange={event => set({ durationSec: Number(event.target.value) })}>
              {!model.durations.includes(shot.durationSec) ? <option value={shot.durationSec}>{shot.durationSec}（生成时会改成最接近的值）</option> : null}
              {model.durations.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input className="drama-input font-mono" type="number" min={1} max={model?.maxDuration ?? 60} value={shot.durationSec}
              onChange={event => set({ durationSec: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} />
          )}
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={shot.firstFrameFromPrev !== false} onChange={event => set({ firstFrameFromPrev: event.target.checked })} />
          接上一镜头
        </label>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="drama-label mb-1">出场角色</legend>
        <div className="flex flex-wrap gap-1">
          {doc.cast.length === 0 ? <span className="drama-label">设定步骤里还没有角色</span> : null}
          {doc.cast.map(member => {
            const on = shot.characterIds?.includes(member.id) ?? false;
            return (
              <button key={member.id} type="button" className="drama-btn min-h-8 px-2 text-xs" aria-pressed={on}
                onClick={() => set({ characterIds: on ? shot.characterIds?.filter(id => id !== member.id) : [...(shot.characterIds ?? []), member.id] })}>
                {member.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section className="drama-panel flex flex-col gap-2 p-3" aria-label="下一次生成会用的素材">
        <p className="text-xs">{FIRST_FRAME_TEXT[firstFrame.source]}</p>
        <p className="text-xs text-[var(--drama-muted)]">
          角色参考图 {references.length} 张{model ? `（模型最多接受 ${model.capability.maxReferenceImages} 张）` : ''}
        </p>
        {references.length ? (
          <div className="flex gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {references.map(url => <img key={url} src={url} alt="" className="h-12 w-9 rounded object-cover" />)}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="drama-retake">
        <h3 id="drama-retake" className="flex items-center gap-1.5 text-sm font-semibold"><Stethoscope className="h-4 w-4" />重拍诊断</h3>
        <select className="drama-input" aria-label="这一镜哪里不对" value={failure} onChange={event => setFailure(event.target.value as VideoFailureType | '')}>
          <option value="">这一镜哪里不对？</option>
          {listFailureTypes().map(item => <option key={item.type} value={item.type}>{item.title}</option>)}
        </select>
        {diagnosis ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--drama-muted)]">{diagnosis.description}</p>
            {diagnosis.retakeSuggestions.map(suggestion => (
              <button key={suggestion.label} type="button" className="drama-btn justify-start text-left text-xs"
                onClick={() => update(current => updateShot(current, shot.id, item => applyRetakeSuggestion(item, suggestion)))}>
                {suggestion.label}
              </button>
            ))}
            <p className="drama-label">每次只改一处，更容易看出是哪一处起作用。</p>
          </div>
        ) : null}
      </section>

      <button type="button" className="drama-btn drama-btn--primary" disabled={running || batchRunning || !model} onClick={() => void generateShots([shot.id])}>
        <RotateCcw className="h-4 w-4" />{shot.takes.length ? '按当前设置重拍' : '生成这个镜头'}
      </button>
    </div>
  );
}

interface CostSnapshot { modelKey: string; modelName: string; durationSec: number; credits: number }

/**
 * Estimated credits for the next take. When the model changes it says what the change did to the
 * length and price, because a new model can force a different duration and cost several times more.
 */
function ShotCost(props: {
  shotId: string; modelKey: string; modelName: string; providerId?: string;
  durationSec: number; generateAudio: boolean; referenceImages: number;
}) {
  const { shotId, modelKey, modelName, providerId, durationSec, generateAudio, referenceImages } = props;
  const [credits, setCredits] = useState<number | null>(null);
  const [change, setChange] = useState<{ from: CostSnapshot; to: CostSnapshot } | null>(null);
  const settled = useRef<CostSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      estimateShots([{ shotId, modelId: modelKey, providerId, durationSec, generateAudio, referenceImages }], undefined, controller.signal)
        .then(result => {
          const next: CostSnapshot = { modelKey, modelName, durationSec, credits: result.perShot[shotId] ?? result.total };
          const before = settled.current;
          if (before && before.modelKey !== next.modelKey
            && (before.durationSec !== next.durationSec || before.credits !== next.credits)) {
            setChange({ from: before, to: next });
          } else if (before && before.modelKey !== next.modelKey) setChange(null);
          settled.current = next;
          setCredits(next.credits);
        }, () => { if (!controller.signal.aborted) setCredits(null); });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [shotId, modelKey, modelName, providerId, durationSec, generateAudio, referenceImages]);

  return (
    <div className="col-span-2 flex flex-col gap-1" aria-live="polite">
      <p className="drama-label font-mono">{credits === null ? '正在估算积分…' : `这一镜预计 ${credits} 积分（提交时按实际价格扣费）`}</p>
      {change ? (
        <p className="rounded border border-[var(--drama-gold)] px-2 py-1.5 text-xs text-[var(--drama-gold)]">
          换成 {change.to.modelName} 后：
          <span className="font-mono">
            {change.from.durationSec !== change.to.durationSec ? ` ${change.from.durationSec} 秒 → ${change.to.durationSec} 秒，` : ' '}
            {change.from.credits} → {change.to.credits} 积分
          </span>
          {change.from.durationSec !== change.to.durationSec ? '。这个模型不支持原来的时长，已改成最接近的值。' : ''}
        </p>
      ) : null}
    </div>
  );
}
