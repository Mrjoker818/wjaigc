'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  applyBibleImage, autopilotPlan, bibleImageRequest, withinQuote,
  type AutopilotChoices, type AutopilotQuote, type AutopilotRun, type AutopilotStage, type BibleGap, type PaidStage,
} from '@/lib/drama/autopilot';
import { keyframePrompt, keyframeReferences, locationImageRatio, type KeyframeKind } from '@/lib/drama/reference-prompts';
import { waitForRender } from '@/lib/drama/render-client';
import { chooseReferenceImages, isRetryableTake, orderedShots, runShot } from '@/lib/drama/shot-runner';
import type { DramaProjectRecord, DramaProjectV1, DramaShot } from '@/lib/drama/types';
import {
  DramaSaveConflictError, estimateShots, generateReferenceImage, generateVoiceover, persistImage, planSceneShots, pollShotTake, saveDramaProject,
  startEpisodeRender,
  type CreditEstimate, type ShotEstimateRequest,
} from '@/lib/drama/workbench-client';
import { findShot, fitDuration, pendingShots, setSceneShots, updateShot, upsertTake } from '@/lib/drama/workbench-state';
import { shotVoice } from '@/lib/drama/voiceover';
import type { DramaStep, DramaWorkbenchApi, RenderState, SaveState } from './drama-context';
import { useDramaImageModels, useDramaVideoModels, useDramaVoiceAvailable, VOICE_MODEL_MISSING, type DramaModelOption } from './drama-models';

const SAVE_DELAY_MS = 1200;
const MODEL_STORAGE_KEY = 'wujie-drama-video-model';
const IMAGE_MODEL_STORAGE_KEY = 'wujie-drama-image-model';
/** Keyframes are drawn a few at a time so one slow image does not hold the rest. */
const KEYFRAME_CONCURRENCY = 3;
/** Speech requests are short; two at a time keeps the provider from rate limiting a batch. */
const VOICEOVER_CONCURRENCY = 2;
/** A failed take the server marked safe to resubmit gets one more attempt after this pause. */
const AUTO_RETRY_DELAY_MS = 5000;

const AUTOPILOT_STAGE_LABEL: Record<AutopilotStage, string> = {
  bible: '画设定图', keyframes: '画关键帧', shots: '生成镜头', voiceover: '录配音', render: '渲染成片',
};

export interface UseDramaWorkbenchOptions {
  record: DramaProjectRecord;
  projectId?: string;
  onPlaceOnCanvas?: DramaWorkbenchApi['onPlaceOnCanvas'];
  onPlaceImageOnCanvas?: DramaWorkbenchApi['onPlaceImageOnCanvas'];
  canvasMedia?: DramaWorkbenchApi['canvasMedia'];
  onOpenCredits?: () => void;
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function readStored(key: string): string {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

const readStoredModel = () => readStored(MODEL_STORAGE_KEY);
const readStoredImageModel = () => readStored(IMAGE_MODEL_STORAGE_KEY);

const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
});

export function useDramaWorkbench({
  record, projectId, onPlaceOnCanvas, onPlaceImageOnCanvas, canvasMedia, onOpenCredits,
}: UseDramaWorkbenchOptions): DramaWorkbenchApi {
  const [doc, setDoc] = useState<DramaProjectV1>(record.doc);
  const docRef = useRef(record.doc);
  const versionRef = useRef(record.version);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | null>(null);
  const scheduleRef = useRef<() => void>(() => undefined);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  /** Aborted when the workbench unmounts, so polling loops stop writing into a closed page. */
  const lifeRef = useRef<AbortController | null>(null);

  // Saves the latest document. Concurrent callers wait for the save in flight, so a resolved true means "on the server".
  const saveNow = useCallback(async (): Promise<boolean> => {
    while (savingRef.current) await savingRef.current;
    if (conflictRef.current) return false;
    if (!dirtyRef.current) return true;
    const snapshot = docRef.current;
    dirtyRef.current = false;
    setSaveState('saving');
    const run = (async () => {
      try {
        const saved = await saveDramaProject(record.id, versionRef.current, snapshot);
        versionRef.current = saved.version;
        setSaveState(dirtyRef.current ? 'dirty' : 'saved');
        if (dirtyRef.current) scheduleRef.current();
        return true;
      } catch (error) {
        dirtyRef.current = true;
        if (error instanceof DramaSaveConflictError) {
          conflictRef.current = true;
          setSaveState('conflict');
        } else {
          setSaveState('error');
        }
        return false;
      }
    })();
    savingRef.current = run;
    try { return await run; } finally { if (savingRef.current === run) savingRef.current = null; }
  }, [record.id]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void saveNow(); }, SAVE_DELAY_MS);
  }, [saveNow]);
  scheduleRef.current = scheduleSave;

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    return saveNow();
  }, [saveNow]);

  const commit = useCallback((next: DramaProjectV1) => {
    if (next === docRef.current) return;
    docRef.current = next;
    setDoc(next);
    dirtyRef.current = true;
    if (!conflictRef.current) setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  const update = useCallback((edit: (current: DramaProjectV1) => DramaProjectV1) => commit(edit(docRef.current)), [commit]);

  // Keep unsaved edits: save on leave and warn before the tab closes with a save pending.
  useEffect(() => {
    const life = new AbortController();
    lifeRef.current = life;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current && !conflictRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      life.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void saveNow();
    };
  }, [saveNow]);

  const [episodeId, setEpisodeId] = useState(record.doc.episodes[0]?.id ?? '');
  const episode = doc.episodes.find(item => item.id === episodeId) ?? doc.episodes[0];
  const [step, setStep] = useState<DramaStep>(record.doc.episodes.length ? 'board' : 'script');
  const [selectedShotId, selectShot] = useState<string | null>(null);

  const replaceDoc = useCallback((next: DramaProjectV1) => {
    commit(next);
    setEpisodeId(next.episodes[0]?.id ?? '');
    selectShot(null);
  }, [commit]);

  // --- Models ---
  const { models, loading: modelsLoading } = useDramaVideoModels();
  const [defaultModelKey, setDefaultModelKeyState] = useState(readStoredModel);
  const defaultModel = models.find(model => model.key === defaultModelKey) ?? models.find(model => model.isDefault) ?? models[0];
  const setDefaultModelKey = useCallback((key: string) => {
    setDefaultModelKeyState(key);
    try { window.localStorage.setItem(MODEL_STORAGE_KEY, key); } catch { /* private mode */ }
  }, []);
  const modelForShot = useCallback((shot: DramaShot): DramaModelOption | undefined => {
    if (!shot.modelId) return defaultModel;
    return models.find(model => model.key === shot.modelId)
      ?? models.find(model => model.modelId === shot.modelId && (!shot.providerId || model.providerId === shot.providerId))
      ?? defaultModel;
  }, [models, defaultModel]);
  const [generateAudio, setGenerateAudio] = useState(false);

  // --- Shot generation ---
  const [runningShotIds, setRunningShotIds] = useState<ReadonlySet<string>>(() => new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const batchRef = useRef<AbortController | null>(null);
  const markRunning = useCallback((id: string, running: boolean) => {
    setRunningShotIds(previous => {
      const next = new Set(previous);
      if (running) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const creditsToast = useCallback((message: string) => {
    toast.error('积分不足，已停止生成', {
      description: message,
      ...(onOpenCredits ? { action: { label: '去充值', onClick: onOpenCredits } } : {}),
    });
  }, [onOpenCredits]);

  const generateShots = useCallback(async (shotIds: string[]) => {
    if (batchRef.current) { toast.error('已有镜头在生成，等它完成或先停止'); return false; }
    const life = lifeRef.current;
    if (!life) return false;
    if (shotIds.length === 0) return true;
    const batch = new AbortController();
    batchRef.current = batch;
    setBatchRunning(true);
    const signal = AbortSignal.any([batch.signal, life.signal]);
    let failed = 0;
    let completed = 0;
    let lastError: string | undefined;
    let halted = false;
    try {
      for (const shotId of shotIds) {
        if (signal.aborted) break;
        const found = findShot(docRef.current, shotId);
        if (!found) continue;
        const model = modelForShot(found.shot);
        if (!model) { toast.error('还没有可用的视频模型', { description: '请在后台供应商设置里启用一个视频模型后再生成。' }); halted = true; break; }
        const durationSec = fitDuration(found.shot.durationSec, model.durations, model.maxDuration);
        if (durationSec !== found.shot.durationSec) {
          update(current => updateShot(current, shotId, { durationSec }));
        }
        markRunning(shotId, true);
        try {
          const attempt = () => {
            const current = docRef.current;
            const shot = findShot(current, shotId)?.shot ?? found.shot;
            const previous = orderedShots(current, found.episode.id).find(item => item.shot.id === shotId)?.previous;
            let persistedTask = false;
            return runShot({
              doc: current, shot, previous, modelId: model.key, providerId: model.providerId,
              capability: model.capability, generateAudio: generateAudio || undefined, signal,
              onTake: next => {
                update(latest => upsertTake(latest, shotId, { ...next, modelId: model.key, providerId: model.providerId }));
                // The task id is what lets a reopened page find this take again, so store it right away.
                if (next.taskId && !persistedTask) { persistedTask = true; void flushSave(); }
              },
            });
          };
          let take = await attempt();
          if (isRetryableTake(take) && !signal.aborted) {
            // A new take has a new id, so the generate route sees a new idempotency key and submits again.
            await pause(AUTO_RETRY_DELAY_MS, signal);
            if (!signal.aborted) take = await attempt();
          }
          if (take.status === 'completed') completed += 1;
          else {
            failed += 1;
            lastError = take.error;
            if (take.error && /积分不足|余额不足/u.test(take.error)) { creditsToast(take.error); lastError = undefined; halted = true; break; }
          }
        } catch (error) {
          if (signal.aborted) break;
          failed += 1;
          toast.error('镜头生成失败', { description: errorText(error, '请稍后重试') });
        } finally {
          markRunning(shotId, false);
        }
      }
    } finally {
      batchRef.current = null;
      setBatchRunning(false);
    }
    if (life.signal.aborted) return false;
    if (batch.signal.aborted) toast('已停止生成', { description: '正在生成的镜头已提交给供应商，完成后仍会扣费并回到镜头上。' });
    else if (shotIds.length > 1) {
      if (failed) toast.error(`${completed} 个镜头已生成，${failed} 个失败`, { description: '失败的镜头可在镜头步骤里重拍。' });
      else toast.success(`${completed} 个镜头已生成`);
    } else if (failed === 0 && completed === 1) toast.success('镜头已生成');
    else if (lastError) toast.error('镜头生成失败', { description: lastError });
    void flushSave();
    return !batch.signal.aborted && !halted;
  }, [creditsToast, flushSave, generateAudio, markRunning, modelForShot, update]);

  const stopGeneration = useCallback(() => batchRef.current?.abort(), []);

  // Takes still generating when the page closed: keep polling them so results are not lost.
  useEffect(() => {
    const life = lifeRef.current;
    if (!life) return;
    const pending = docRef.current.episodes.flatMap(item => item.scenes.flatMap(scene => scene.shots.flatMap(shot =>
      shot.takes.filter(take => take.status === 'submitted' || take.status === 'generating').map(take => ({ shotId: shot.id, take })))));
    for (const { shotId, take } of pending) {
      markRunning(shotId, true);
      void pollShotTake(take, take.modelId, take.providerId, { signal: life.signal }).then(result => {
        if (life.signal.aborted) return;
        update(latest => upsertTake(latest, shotId, result));
        markRunning(shotId, false);
      });
    }
  }, [markRunning, update]);

  // --- Credit estimate for the shots that still need a take ---
  const [estimate, setEstimate] = useState<CreditEstimate | null>(null);
  const estimateRequest = useMemo<ShotEstimateRequest[]>(() => pendingShots(episode).flatMap(shot => {
    const model = modelForShot(shot);
    if (!model) return [];
    return [{
      shotId: shot.id, modelId: model.key, providerId: model.providerId,
      durationSec: fitDuration(shot.durationSec, model.durations, model.maxDuration),
      generateAudio: generateAudio || Boolean(shot.dialogue || shot.audioCues),
      referenceImages: chooseReferenceImages(shot, doc.cast, model.capability, [], doc.props).length,
    }];
  }), [episode, modelForShot, generateAudio, doc.cast, doc.props]);
  const estimateKey = JSON.stringify(estimateRequest);
  useEffect(() => {
    const shots = JSON.parse(estimateKey) as ShotEstimateRequest[];
    if (shots.length === 0) { setEstimate(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      estimateShots(shots, undefined, controller.signal).then(setEstimate, () => { if (!controller.signal.aborted) setEstimate(null); });
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [estimateKey]);

  // --- Keyframes: the opening still of each shot, drawn with an image model ---
  const { models: imageModels } = useDramaImageModels();
  const voiceAvailable = useDramaVoiceAvailable();
  const [imageModelKey, setImageModelKeyState] = useState(readStoredImageModel);
  const imageModel = imageModels.find(model => model.key === imageModelKey) ?? imageModels.find(model => model.isDefault) ?? imageModels[0];
  const setImageModelKey = useCallback((key: string) => {
    setImageModelKeyState(key);
    try { window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, key); } catch { /* private mode */ }
  }, []);
  const [keyframeShotIds, setKeyframeShotIds] = useState<ReadonlySet<string>>(() => new Set());
  const keyframeRef = useRef(new Set<string>());
  const markKeyframe = useCallback((id: string, on: boolean) => {
    if (on) keyframeRef.current.add(id); else keyframeRef.current.delete(id);
    setKeyframeShotIds(new Set(keyframeRef.current));
  }, []);

  const generateKeyframes = useCallback(async (shotIds: string[], kind: KeyframeKind = 'first', stop?: AbortSignal) => {
    const life = lifeRef.current;
    const busyKey = (shotId: string) => (kind === 'last' ? `${shotId}:last` : shotId);
    const queue = shotIds.filter(id => !keyframeRef.current.has(busyKey(id)));
    if (!life) return false;
    if (queue.length === 0) return true;
    queue.forEach(id => markKeyframe(busyKey(id), true));
    const noun = kind === 'last' ? '尾帧' : '关键帧';
    const total = queue.length;
    let completed = 0;
    let lastError: string | undefined;
    let outOfCredits = false;
    const drawOne = async (shotId: string) => {
      try {
        if (outOfCredits || life.signal.aborted || stop?.aborted) return;
        const current = docRef.current;
        const found = findShot(current, shotId);
        if (!found) return;
        const url = await generateReferenceImage(
          keyframePrompt(found.shot, current, kind),
          locationImageRatio(found.shot.aspectRatio || current.aspectRatio),
          {
            ...(imageModel ? { model: imageModel.key, providerId: imageModel.providerId } : {}),
            referenceImages: keyframeReferences(found.shot, current, imageModel?.maxReferenceImages ?? 0, kind),
          },
        );
        const saved = await persistImage(url);
        if (life.signal.aborted) return;
        update(latest => updateShot(latest, shotId, kind === 'last' ? { lastFrameUrl: saved } : { firstFrameUrl: saved }));
        completed += 1;
      } catch (error) {
        lastError = errorText(error, `${noun}生成失败`);
        if (/积分不足|余额不足/u.test(lastError)) outOfCredits = true;
      } finally {
        markKeyframe(busyKey(shotId), false);
      }
    };
    const workers = Array.from({ length: Math.min(KEYFRAME_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await drawOne(next);
    });
    await Promise.all(workers);
    if (life.signal.aborted) return false;
    if (outOfCredits && lastError) { creditsToast(lastError); return false; }
    if (stop?.aborted) { void flushSave(); return false; }
    const failed = total - completed;
    if (failed === 0) toast.success(total > 1 ? `${completed} 张${noun}已生成` : `${noun}已生成`);
    else if (completed) toast.error(`${completed} 张${noun}已生成，${failed} 张失败`, { description: lastError });
    else toast.error(`${noun}生成失败`, { description: lastError });
    void flushSave();
    return true;
  }, [creditsToast, flushSave, imageModel, markKeyframe, update]);

  // --- Voiceover: each line recorded in its speaker's voice, mixed in when the episode renders ---
  const [voiceoverShotIds, setVoiceoverShotIds] = useState<ReadonlySet<string>>(() => new Set());
  const voiceoverRef = useRef(new Set<string>());
  const markVoiceover = useCallback((id: string, on: boolean) => {
    if (on) voiceoverRef.current.add(id); else voiceoverRef.current.delete(id);
    setVoiceoverShotIds(new Set(voiceoverRef.current));
  }, []);

  const generateVoiceovers = useCallback(async (shotIds: string[]) => {
    const life = lifeRef.current;
    if (!voiceAvailable) { toast.error('还不能生成配音', { description: VOICE_MODEL_MISSING }); return; }
    const queue = shotIds.filter(id => !voiceoverRef.current.has(id) && findShot(docRef.current, id)?.shot.dialogue?.trim());
    if (!life || queue.length === 0) return;
    queue.forEach(id => markVoiceover(id, true));
    const total = queue.length;
    let completed = 0;
    let lastError: string | undefined;
    let denied = false;
    const recordOne = async (shotId: string) => {
      try {
        if (denied || life.signal.aborted) return;
        const current = docRef.current;
        const shot = findShot(current, shotId)?.shot;
        const line = shot?.dialogue?.trim();
        if (!shot || !line) return;
        const url = await generateVoiceover(line, shotVoice(shot, current.cast));
        if (life.signal.aborted) return;
        update(latest => updateShot(latest, shotId, { voiceoverUrl: url, voiceoverText: line }));
        completed += 1;
      } catch (error) {
        lastError = errorText(error, '配音生成失败');
        // No permission or no speech model configured: every other line would fail the same way.
        if (/语音生成|权限|语音模型/u.test(lastError)) denied = true;
      } finally {
        markVoiceover(shotId, false);
      }
    };
    const workers = Array.from({ length: Math.min(VOICEOVER_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await recordOne(next);
    });
    await Promise.all(workers);
    if (life.signal.aborted) return;
    const failed = total - completed;
    if (failed === 0) toast.success(total > 1 ? `${completed} 段配音已生成` : '配音已生成');
    else if (completed) toast.error(`${completed} 段配音已生成，${failed} 段失败`, { description: lastError });
    else toast.error('配音生成失败', { description: lastError });
    void flushSave();
  }, [flushSave, markVoiceover, update, voiceAvailable]);

  const keyframeRequest = useMemo<ShotEstimateRequest[]>(() => {
    if (!imageModel || !episode) return [];
    return episode.scenes.flatMap(scene => scene.shots).filter(shot => !shot.firstFrameUrl).map(shot => ({
      shotId: shot.id, modelId: imageModel.key, providerId: imageModel.providerId, durationSec: 1, kind: 'image' as const,
      referenceImages: keyframeReferences(shot, doc, imageModel.maxReferenceImages).length,
    }));
  }, [imageModel, episode, doc]);
  const [keyframeEstimate, setKeyframeEstimate] = useState<CreditEstimate | null>(null);
  const keyframeKey = JSON.stringify(keyframeRequest);
  useEffect(() => {
    const shots = JSON.parse(keyframeKey) as ShotEstimateRequest[];
    if (shots.length === 0) { setKeyframeEstimate(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      estimateShots(shots, undefined, controller.signal).then(setKeyframeEstimate, () => { if (!controller.signal.aborted) setKeyframeEstimate(null); });
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [keyframeKey]);

  // --- One planner or image job at a time ---
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const busyRef = useRef(false);
  const runJob = useCallback(async (label: string, job: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) { toast.error('上一个操作还没完成，请稍等'); return false; }
    busyRef.current = true;
    setBusyLabel(label);
    try {
      await job();
      return true;
    } catch (error) {
      toast.error(`${label}失败`, { description: errorText(error, '请稍后重试') });
      return false;
    } finally {
      busyRef.current = false;
      setBusyLabel(null);
    }
  }, []);

  // --- Final render ---
  const [render, setRender] = useState<RenderState>({ status: 'idle', progress: 0 });
  const followRender = useCallback(async (taskId: string, renderEpisodeId: string) => {
    const life = lifeRef.current;
    setRender({ status: 'rendering', progress: 2 });
    try {
      const result = await waitForRender(taskId, { onProgress: progress => { if (!life?.signal.aborted) setRender({ status: 'rendering', progress }); } });
      if (life?.signal.aborted) return;
      update(current => ({ ...current, timeline: { ...current.timeline, lastRender: {
        taskId, episodeId: renderEpisodeId, status: 'completed', videoUrl: result.videoUrl,
        ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
        ...(result.durationSec ? { durationSec: result.durationSec } : {}), createdAt: Date.now(),
      } } }));
      setRender({ status: 'idle', progress: 100 });
      toast.success('成片已渲染');
    } catch (error) {
      if (life?.signal.aborted) return;
      const message = errorText(error, '成片渲染失败');
      update(current => ({ ...current, timeline: { ...current.timeline, lastRender: {
        taskId, episodeId: renderEpisodeId, status: 'failed', error: message, createdAt: Date.now(),
      } } }));
      setRender({ status: 'failed', progress: 0, error: message });
    }
  }, [update]);

  const renderEpisode = useCallback(async (targetId?: string) => {
    const target = docRef.current.episodes.find(item => item.id === (targetId ?? episode?.id));
    if (!target || render.status === 'rendering') return;
    const missing = pendingShots(target).length;
    if (missing) { toast.error(`还有 ${missing} 个镜头没有可用的视频`, { description: '先在镜头步骤里生成或选定这些镜头，再渲染成片。' }); return; }
    if (!await flushSave()) { toast.error('剧本还没保存成功，暂时不能渲染', { description: '检查顶栏的保存状态，保存成功后再试。' }); return; }
    let taskId: string;
    try {
      taskId = await startEpisodeRender(record.id, target.id);
    } catch (error) {
      setRender({ status: 'failed', progress: 0, error: errorText(error, '成片渲染没有启动') });
      return;
    }
    update(current => ({ ...current, timeline: { ...current.timeline, lastRender: { taskId, episodeId: target.id, status: 'processing', createdAt: Date.now() } } }));
    await followRender(taskId, target.id);
  }, [episode, render.status, flushSave, record.id, update, followRender]);

  // A render that was running when the page closed keeps going on the server; pick its progress up again.
  useEffect(() => {
    const last = docRef.current.timeline.lastRender;
    if (last?.status === 'processing') void followRender(last.taskId, last.episodeId ?? '');
  }, [followRender]);

  // --- One-click film: fills only what the episode still lacks, after the user agreed to the price ---
  const [autopilot, setAutopilot] = useState<AutopilotRun | null>(null);
  const autopilotRef = useRef<AbortController | null>(null);
  // The run awaits several stages; each stage must use the newest callbacks, not the ones from when it started.
  const latestRef = useRef({ generateShots, generateKeyframes, generateVoiceovers, renderEpisode });
  latestRef.current = { generateShots, generateKeyframes, generateVoiceovers, renderEpisode };
  const needsKeyframe = useCallback((shot: DramaShot) => Boolean(modelForShot(shot)?.capability.imageToVideo), [modelForShot]);

  const quoteAutopilot = useCallback(async (): Promise<AutopilotQuote | null> => {
    const episodeId = episode?.id;
    if (!episodeId) return null;
    if (busyRef.current || autopilotRef.current) { toast.error('上一个操作还没完成，请稍等'); return null; }
    // Scenes without shots cannot be priced; splitting them is free, so it happens before the quote.
    const empty = autopilotPlan(docRef.current, episodeId).scenes;
    if (empty.length) {
      busyRef.current = true;
      setBusyLabel('拆解分镜');
      try {
        for (const sceneId of empty) {
          const shots = await planSceneShots(docRef.current, episodeId, sceneId);
          update(current => setSceneShots(current, sceneId, shots));
        }
      } catch (error) {
        toast.error('拆解分镜失败', { description: errorText(error, '请稍后重试') });
        return null;
      } finally {
        busyRef.current = false;
        setBusyLabel(null);
      }
    }
    const current = docRef.current;
    const plan = autopilotPlan(current, episodeId, needsKeyframe);
    // Keyframes and shots are drawn after the bible images exist, so they are priced with those references.
    const filled = plan.bible.reduce((next, item) => applyBibleImage(next, item, `pending:${item.key}`), current);
    const image = imageModel;
    const bibleRequests = image
      ? plan.bible.map(item => ({ shotId: item.key, modelId: image.key, providerId: image.providerId, durationSec: 1, kind: 'image' as const }))
      : plan.bible.length ? null : [];
    const keyframeRequests = image
      ? plan.keyframes.flatMap(id => {
        const shot = findShot(filled, id)?.shot;
        return shot ? [{
          shotId: id, modelId: image.key, providerId: image.providerId, durationSec: 1, kind: 'image' as const,
          referenceImages: keyframeReferences(shot, filled, image.maxReferenceImages).length,
        }] : [];
      })
      : plan.keyframes.length ? null : [];
    const shotRequests: ShotEstimateRequest[] = [];
    let unpricedShot = false;
    for (const id of plan.shots) {
      const shot = findShot(filled, id)?.shot;
      const model = shot && modelForShot(shot);
      if (!shot || !model) { unpricedShot = true; continue; }
      shotRequests.push({
        shotId: id, modelId: model.key, providerId: model.providerId,
        durationSec: fitDuration(shot.durationSec, model.durations, model.maxDuration),
        generateAudio: generateAudio || Boolean(shot.dialogue || shot.audioCues),
        referenceImages: chooseReferenceImages(shot, filled.cast, model.capability, [], filled.props).length,
      });
    }
    const credits: AutopilotQuote['credits'] = {};
    const seen: { balance?: number } = {};
    const price = async (stage: PaidStage, requests: ShotEstimateRequest[] | null) => {
      if (requests === null) return;
      if (requests.length === 0) { credits[stage] = 0; return; }
      try {
        const result = await estimateShots(requests);
        credits[stage] = result.total;
        seen.balance = result.balance;
      } catch { /* left unpriced; the dialog says so */ }
    };
    await Promise.all([price('bible', bibleRequests), price('keyframes', keyframeRequests), price('shots', unpricedShot ? null : shotRequests)]);
    return { episodeId, plan, credits, ...(seen.balance !== undefined ? { balance: seen.balance } : {}) };
  }, [episode?.id, generateAudio, imageModel, modelForShot, needsKeyframe, update]);

  const drawBible = useCallback(async (items: BibleGap[], signal: AbortSignal): Promise<boolean> => {
    const queue = [...items];
    let failed = 0;
    let lastError: string | undefined;
    let outOfCredits = false;
    const drawOne = async (item: BibleGap) => {
      const request = bibleImageRequest(docRef.current, item);
      if (!request || outOfCredits || signal.aborted) return;
      try {
        const url = await persistImage(await generateReferenceImage(request.prompt, request.aspectRatio,
          imageModel ? { model: imageModel.key, providerId: imageModel.providerId } : {}));
        // A stopped run keeps the image it already paid for; only a closed page drops it.
        if (lifeRef.current?.signal.aborted) return;
        update(latest => applyBibleImage(latest, item, url));
      } catch (error) {
        failed += 1;
        lastError = errorText(error, '设定图生成失败');
        if (/积分不足|余额不足/u.test(lastError)) outOfCredits = true;
      }
    };
    const workers = Array.from({ length: Math.min(KEYFRAME_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await drawOne(next);
    });
    await Promise.all(workers);
    void flushSave();
    if (outOfCredits && lastError) { creditsToast(lastError); return false; }
    if (failed) toast.error(`${failed} 张设定图没有生成成功`, { description: `${lastError ?? ''}。这些角色或场景的镜头会只按文字描述生成，之后可在设定步骤补画。` });
    return !signal.aborted;
  }, [creditsToast, flushSave, imageModel, update]);

  const runAutopilot = useCallback(async (quote: AutopilotQuote, choices: AutopilotChoices) => {
    const life = lifeRef.current;
    if (!life || autopilotRef.current) return;
    if (busyRef.current || batchRef.current) { toast.error('上一个操作还没完成，请稍等'); return; }
    const open = () => autopilotPlan(docRef.current, quote.episodeId, needsKeyframe);
    if (!withinQuote(quote, open())) {
      toast.error('剧本在报价后有改动，价格可能变了', { description: '重新打开一键成片，按最新的价格确认。' });
      return;
    }
    const run = new AbortController();
    autopilotRef.current = run;
    const signal = AbortSignal.any([run.signal, life.signal]);
    busyRef.current = true;
    const at: { stage: AutopilotStage } = { stage: 'bible' };
    const enter = (next: AutopilotStage) => {
      at.stage = next;
      setAutopilot({ quote, choices, stage: next });
      setBusyLabel(`一键成片 · ${AUTOPILOT_STAGE_LABEL[next]}`);
    };
    let finished = false;
    try {
      if (choices.bible && open().bible.length) {
        enter('bible');
        if (!await drawBible(open().bible, signal)) return;
      }
      if (signal.aborted) return;
      if (choices.keyframes && open().keyframes.length) {
        enter('keyframes');
        if (!await latestRef.current.generateKeyframes(open().keyframes, 'first', signal)) return;
      }
      if (signal.aborted) return;
      if (open().shots.length) {
        enter('shots');
        if (!await latestRef.current.generateShots(open().shots)) return;
        const left = open().shots.length;
        if (left) {
          toast.error(`一键成片停在镜头这一步：${left} 个镜头没有生成成功`, { description: '在镜头步骤里重拍它们，再点一键成片继续，已完成的不会重做。' });
          return;
        }
      }
      if (signal.aborted) return;
      if (choices.voiceover && voiceAvailable && open().voiceovers.length) {
        enter('voiceover');
        await latestRef.current.generateVoiceovers(open().voiceovers);
      }
      if (signal.aborted) return;
      if (choices.render) {
        enter('render');
        busyRef.current = false;
        setBusyLabel(null);
        await latestRef.current.renderEpisode(quote.episodeId);
      }
      finished = true;
    } finally {
      autopilotRef.current = null;
      busyRef.current = false;
      setBusyLabel(null);
      setAutopilot(null);
      if (!life.signal.aborted) {
        // A stop during the shots stage already got its own toast from the shot batch.
        if (run.signal.aborted && at.stage !== 'shots') toast('一键成片已停止', { description: '已完成的部分都保留了，再点一键成片会从停下的地方继续。' });
        else if (finished && !choices.render) toast.success('一键成片已完成', { description: '镜头都已备齐，可以在成片步骤渲染。' });
      }
    }
  }, [drawBible, needsKeyframe, voiceAvailable]);

  const stopAutopilot = useCallback(() => {
    autopilotRef.current?.abort();
    batchRef.current?.abort();
  }, []);

  return {
    doc, episode, update, replaceDoc, setEpisodeId, step, setStep, selectedShotId, selectShot,
    models, modelsLoading, defaultModel, setDefaultModelKey, modelForShot, generateAudio, setGenerateAudio,
    runningShotIds, batchRunning, generateShots, stopGeneration, estimate,
    imageModels, imageModel, setImageModelKey, keyframeShotIds, generateKeyframes, voiceoverShotIds, generateVoiceovers,
    keyframeEstimate, busyLabel, runJob,
    dramaId: record.id, projectId, saveState, flushSave, render, renderEpisode, onPlaceOnCanvas, onPlaceImageOnCanvas, canvasMedia,
    autopilot, quoteAutopilot, runAutopilot, stopAutopilot, voiceAvailable,
  };
}

