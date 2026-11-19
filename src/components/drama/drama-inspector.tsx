'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, ImagePlus, Loader2, Mic, RotateCcw, Scissors, Stethoscope, X } from 'lucide-react';
import { mentionCandidates, mergeMentionIds } from '@/lib/drama/mentions';
import { CLIP_SPEED_RANGE, CLIP_VOLUME_MAX, MIN_CLIP_SEC, STILL_MOTIONS, type StillMotion } from '@/lib/drama/render';
import { shotFilmLength } from '@/lib/drama/timeline';
import { activeTake, type DramaClipEdit, type DramaShot } from '@/lib/drama/types';
import { chooseFirstFrame, chooseLastFrame, shotReferenceImages } from '@/lib/drama/shot-runner';
import { applyRetakeSuggestion, estimateShots } from '@/lib/drama/workbench-client';
import { currentVoiceover, shotSpeaker } from '@/lib/drama/voiceover';
import { findShot, fitDuration, orderedPrevious, updateShot } from '@/lib/drama/workbench-state';
import { diagnoseFailure, listFailureTypes, type VideoFailureType } from '@/lib/video-director/retake-diagnosis';
import { useDrama } from './drama-context';
import { MentionTextarea } from './mention-textarea';
import { ShotReadinessList } from './drama-readiness';

const FIRST_FRAME_TEXT = {
  user: '首帧：这一镜的关键帧',
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
  const {
    doc, update, models, modelForShot, generateShots, runningShotIds, batchRunning, generateAudio,
    keyframeShotIds, generateKeyframes, imageModel, voiceoverShotIds, generateVoiceovers,
  } = useDrama();
  const [failure, setFailure] = useState<VideoFailureType | ''>('');
  const found = findShot(doc, shotId);
  if (!found) return null;
  const { shot, episode } = found;
  const model = modelForShot(shot);
  const previous = orderedPrevious(doc, episode.id, shot.id);
  const location = doc.locations.find(item => item.id === shot.sceneId);
  const firstFrame = model ? chooseFirstFrame(shot, previous, location, model.capability) : { source: 'none' as const };
  // The previous shot's frame is extracted only at submit time; its video URL stands in so the count matches.
  const firstFrameStandIn = firstFrame.url ?? ('previousVideoUrl' in firstFrame ? firstFrame.previousVideoUrl : undefined);
  const lastFrame = model ? chooseLastFrame(shot, model.capability, firstFrameStandIn) : undefined;
  const references = model
    ? shotReferenceImages(shot, doc.cast, model.capability, [firstFrameStandIn, lastFrame], doc.props)
    : [];
  const ratio = (shot.aspectRatio || doc.aspectRatio).replace(':', ' / ');
  const diagnosis = failure ? diagnoseFailure(failure) : null;
  const running = runningShotIds.has(shot.id);
  const set = (patch: Parameters<typeof updateShot>[2]) => update(current => updateShot(current, shot.id, patch));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-base font-bold">镜头 {String(shot.index + 1).padStart(2, '0')} · {found.scene.heading}</h2>
        <button type="button" className="drama-btn drama-btn--quiet ml-auto px-2" aria-label="关闭检查器" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
      <ShotReadinessList episodeId={episode.id} shot={shot} />

      <div className="flex flex-col gap-1">
        <span className="drama-label" id="drama-prompt-label">画面提示词（输入 @ 引用角色或道具）</span>
        <MentionTextarea className="drama-input min-h-28 w-full resize-y" maxLength={8000} value={shot.prompt} ariaLabel="画面提示词"
          candidates={mentionCandidates(doc)}
          onChange={prompt => update(current => updateShot(current, shot.id, item => ({ ...item, prompt, ...mergeMentionIds(item, prompt, current) })))} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="drama-label">台词</span>
        <textarea className="drama-input min-h-14 resize-y" maxLength={2000} value={shot.dialogue ?? ''} onChange={event => set({ dialogue: event.target.value })} />
      </label>
      {shot.dialogue?.trim() ? <VoiceoverPanel shotId={shot.id} busy={voiceoverShotIds.has(shot.id)} onRecord={() => void generateVoiceovers([shot.id])} /> : null}
      <StillPanel shotId={shot.id} />
      <ClipEditPanel shotId={shot.id} />

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

      {doc.props.length ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="drama-label mb-1">出场道具</legend>
          <div className="flex flex-wrap gap-1">
            {doc.props.map(prop => {
              const on = shot.propIds?.includes(prop.id) ?? false;
              return (
                <button key={prop.id} type="button" className="drama-btn min-h-8 px-2 text-xs" aria-pressed={on}
                  onClick={() => set({ propIds: on ? shot.propIds?.filter(id => id !== prop.id) : [...(shot.propIds ?? []), prop.id] })}>
                  {prop.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="drama-keyframe">
        <h3 id="drama-keyframe" className="text-sm font-semibold">关键帧</h3>
        <div className="grid grid-cols-2 gap-2">
          <FrameTile label="首帧" alt="这一镜的关键帧" url={shot.firstFrameUrl} ratio={ratio}
            busy={keyframeShotIds.has(shot.id)} onDraw={() => void generateKeyframes([shot.id])} onClear={() => set({ firstFrameUrl: undefined, still: undefined })} />
          <FrameTile label="尾帧" alt="这一镜的尾帧" url={shot.lastFrameUrl} ratio={ratio}
            busy={keyframeShotIds.has(`${shot.id}:last`)} onDraw={() => void generateKeyframes([shot.id], 'last')} onClear={() => set({ lastFrameUrl: undefined })} />
        </div>
        <p className="drama-label">
          {imageModel ? `用 ${imageModel.name} 画，按图像模型价格扣费。` : '按后台默认图像模型价格扣费。'}
          {model && !model.capability.imageToVideo ? '当前视频模型不接受首帧图片，关键帧不会用上。' : '有首帧时，视频从这张图开始。'}
          {shot.lastFrameUrl && model?.capability.imageToVideo && !model.capability.firstLastFrame ? '当前视频模型不支持首尾帧，尾帧不会用上。' : ''}
          {!shot.lastFrameUrl && model?.capability.firstLastFrame ? '再画一张尾帧，视频会停在那张图上，动作更可控。' : ''}
        </p>
      </section>

      <section className="drama-panel flex flex-col gap-2 p-3" aria-label="下一次生成会用的素材">
        <p className="text-xs">{FIRST_FRAME_TEXT[firstFrame.source]}</p>
        {lastFrame ? <p className="text-xs">尾帧：这一镜的尾帧（首尾帧模式）</p> : null}
        <p className="text-xs text-[var(--drama-muted)]">
          角色和道具参考图 {references.length} 张{model ? `（模型最多接受 ${model.capability.maxReferenceImages} 张）` : ''}
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

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const round1 = (value: number) => Math.round(value * 10) / 10;
const withoutClipEdit = (item: DramaShot): DramaShot => {
  const next = { ...item };
  delete next.clipEdit;
  return next;
};

const MOTION_LABEL: Record<StillMotion, string> = { 'push-in': '推近', 'pull-out': '拉远', 'pan-left': '左移', 'pan-right': '右移' };

/**
 * Use the first frame in the film instead of a video: a slow camera move over the still. Free of credits,
 * so a shot can go into the film before (or instead of) paying for its video.
 */
function StillPanel({ shotId }: { shotId: string }) {
  const { doc, update } = useDrama();
  const shot = findShot(doc, shotId)?.shot;
  if (!shot?.firstFrameUrl) return null;
  const motion = shot.still?.motion;
  const hasVideo = Boolean(activeTake(shot));
  const set = (next: StillMotion | undefined) => update(current => updateShot(current, shotId, item => {
    const copy = { ...item };
    if (next) copy.still = { motion: next }; else delete copy.still;
    return copy;
  }));
  return (
    <section className="drama-panel flex flex-col gap-2 p-3" aria-labelledby="drama-still">
      <h3 id="drama-still" className="flex items-center gap-1.5 text-sm font-semibold"><Film className="h-4 w-4" />静帧镜头</h3>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(motion)} onChange={event => set(event.target.checked ? 'push-in' : undefined)} />
        成片里用首帧加运镜代替视频
      </label>
      {motion ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="运镜">
          {STILL_MOTIONS.map(value => (
            <button key={value} type="button" className="drama-btn min-h-8 px-2 text-xs" aria-pressed={motion === value} onClick={() => set(value)}>
              {MOTION_LABEL[value]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="drama-label">
        不扣积分，按这一镜的时长（{shot.durationSec} 秒）渲染。{motion && hasVideo ? '已生成的视频保留着，取消勾选就换回视频。' : ''}
        {!motion && !hasVideo ? '还没有视频时，用它先把整集拼出来看节奏。' : ''}
      </p>
    </section>
  );
}

/** Cut of the selected take in the film: in and out points taken from the preview, speed and the take's own volume. Free of credits. */
function ClipEditPanel({ shotId }: { shotId: string }) {
  const { doc, update } = useDrama();
  const video = useRef<HTMLVideoElement>(null);
  const [fileSec, setFileSec] = useState<number | null>(null);
  const shot = findShot(doc, shotId)?.shot;
  const take = shot ? activeTake(shot) : undefined;
  if (!shot || !take?.videoUrl || shot.still) return null;
  const edit = shot.clipEdit ?? {};
  const total = fileSec ?? shot.durationSec;
  const start = Math.min(edit.trimStartSec ?? 0, total);
  const end = Math.min(edit.trimEndSec ?? total, total);
  const speed = edit.speed ?? 1;
  const volume = edit.volume ?? 1;
  const edited = start > 0 || end < total || speed !== 1 || volume !== 1;
  const setEdit = (patch: DramaClipEdit) => update(current => updateShot(current, shotId, item => {
    const next = { ...item.clipEdit, ...patch };
    // Defaults are dropped so an untouched shot keeps no clipEdit at all.
    if (!next.trimStartSec) delete next.trimStartSec;
    if (next.trimEndSec === undefined || next.trimEndSec >= total) delete next.trimEndSec;
    if (next.speed === 1) delete next.speed;
    if (next.volume === 1) delete next.volume;
    return Object.keys(next).length ? { ...item, clipEdit: next } : withoutClipEdit(item);
  }));
  const mark = (which: 'in' | 'out') => {
    const at = round1(video.current?.currentTime ?? 0);
    if (which === 'in') {
      if (end - at < MIN_CLIP_SEC) return;
      setEdit({ trimStartSec: at });
    } else {
      if (at - start < MIN_CLIP_SEC) return;
      setEdit({ trimEndSec: at });
    }
  };

  return (
    <section className="drama-panel flex flex-col gap-2 p-3" aria-labelledby="drama-clip-edit">
      <h3 id="drama-clip-edit" className="flex items-center gap-1.5 text-sm font-semibold"><Scissors className="h-4 w-4" />剪辑</h3>
      <video ref={video} src={take.videoUrl} poster={take.thumbnailUrl} controls preload="metadata" className="w-full rounded bg-[var(--drama-ink)]"
        aria-label="选用的视频" onLoadedMetadata={event => { const d = event.currentTarget.duration; if (Number.isFinite(d) && d > 0) setFileSec(round1(d)); }} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="drama-btn px-2 text-xs" onClick={() => mark('in')}>入点设在当前位置</button>
        <button type="button" className="drama-btn px-2 text-xs" onClick={() => mark('out')}>出点设在当前位置</button>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="drama-label shrink-0">入点</span>
          <input className="drama-input min-w-0 font-mono" type="number" min={0} max={round1(end - MIN_CLIP_SEC)} step={0.1} value={round1(start)} aria-label="入点 秒"
            onChange={event => setEdit({ trimStartSec: Math.max(0, Math.min(end - MIN_CLIP_SEC, Number(event.target.value) || 0)) })} />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="drama-label shrink-0">出点</span>
          <input className="drama-input min-w-0 font-mono" type="number" min={round1(start + MIN_CLIP_SEC)} max={total} step={0.1} value={round1(end)} aria-label="出点 秒"
            onChange={event => setEdit({ trimEndSec: Math.min(total, Math.max(start + MIN_CLIP_SEC, Number(event.target.value) || total)) })} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="drama-label mb-1">速度</legend>
        <div className="flex flex-wrap gap-1">
          {SPEEDS.filter(value => value >= CLIP_SPEED_RANGE[0] && value <= CLIP_SPEED_RANGE[1]).map(value => (
            <button key={value} type="button" className="drama-btn min-h-8 px-2 font-mono text-xs" aria-pressed={speed === value} onClick={() => setEdit({ speed: value })}>{value}×</button>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-xs">
        <span className="drama-label shrink-0">原声音量</span>
        <input type="range" min={0} max={CLIP_VOLUME_MAX * 100} step={10} value={Math.round(volume * 100)} aria-label="原声音量" className="min-w-0 flex-1"
          onChange={event => setEdit({ volume: Number(event.target.value) / 100 })} />
        <span className="w-10 font-mono text-[var(--drama-muted)]">{Math.round(volume * 100)}%</span>
      </label>
      <div className="flex items-center gap-2">
        <span className="drama-label flex-1 font-mono">成片里约 {round1(shotFilmLength({ durationSec: total, clipEdit: shot.clipEdit }))} 秒 · 原片 {round1(total)} 秒</span>
        {edited ? (
          <button type="button" className="drama-btn drama-btn--quiet px-2 text-xs"
            onClick={() => update(current => updateShot(current, shotId, withoutClipEdit))}>还原</button>
        ) : null}
      </div>
      <p className="drama-label">只影响渲染出的成片，不扣积分，原视频不变。重拍后入点出点沿用到新的视频上。</p>
    </section>
  );
}

/** Who says the line, and its recording. An edited line marks the old recording as stale; it is then left out of the render. */
function VoiceoverPanel({ shotId, busy, onRecord }: { shotId: string; busy: boolean; onRecord: () => void }) {
  const { doc, update } = useDrama();
  const shot = findShot(doc, shotId)?.shot;
  if (!shot) return null;
  const speaker = shotSpeaker(shot, doc.cast);
  const voiceover = currentVoiceover(shot);
  const stale = Boolean(shot.voiceoverUrl && !voiceover);
  return (
    <section className="drama-panel flex flex-col gap-2 p-3" aria-labelledby="drama-voiceover">
      <h3 id="drama-voiceover" className="flex items-center gap-1.5 text-sm font-semibold"><Mic className="h-4 w-4" />配音</h3>
      {doc.cast.length ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="drama-label shrink-0">说话人</span>
          <select className="drama-input flex-1" value={shot.speakerId ?? ''}
            onChange={event => update(current => updateShot(current, shot.id, { speakerId: event.target.value || undefined }))}>
            <option value="">{speaker && !shot.speakerId ? `镜头里第一个角色（${speaker.name}）` : '镜头里第一个角色'}</option>
            {doc.cast.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      ) : null}
      {voiceover ? <audio src={voiceover} controls preload="none" className="h-9 w-full" aria-label="这一镜的配音" /> : null}
      {stale ? <p className="text-xs text-[var(--drama-gold)]">台词改过了，旧配音不会混进成片。重新生成一次。</p> : null}
      <div className="flex gap-1">
        <button type="button" className="drama-btn flex-1 px-2 text-xs" disabled={busy} onClick={onRecord}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Mic className="h-3.5 w-3.5" />}
          {busy ? '正在生成配音' : voiceover ? '重新生成配音' : '生成配音'}
        </button>
        {shot.voiceoverUrl ? (
          <button type="button" className="drama-btn px-2 text-xs" disabled={busy} aria-label="清除配音"
            onClick={() => update(current => updateShot(current, shot.id, { voiceoverUrl: undefined, voiceoverText: undefined }))}>
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <p className="drama-label">用后台的语音模型生成，不扣积分。渲染成片时混在这一镜上，原声会调低。</p>
    </section>
  );
}

function FrameTile({ label, alt, url, ratio, busy, onDraw, onClear }: {
  label: string; alt: string; url?: string; ratio: string; busy: boolean; onDraw: () => void; onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-md bg-[var(--drama-ink)]" style={{ aspectRatio: ratio }}>
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={alt} className="h-full w-full object-contain" />
          : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-[var(--drama-muted)]">还没有{label}</span>}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px]">{label}</span>
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55" role="status">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /><span className="sr-only">正在画{label}</span>
          </span>
        ) : null}
      </div>
      <div className="flex gap-1">
        <button type="button" className="drama-btn flex-1 px-2 text-xs" disabled={busy} onClick={onDraw}>
          <ImagePlus className="h-3.5 w-3.5" />{url ? `重画${label}` : `画${label}`}
        </button>
        {url ? (
          <button type="button" className="drama-btn px-2 text-xs" disabled={busy} aria-label={`清除${label}`} onClick={onClear}>
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
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
