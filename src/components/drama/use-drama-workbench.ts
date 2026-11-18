'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { waitForRender } from '@/lib/drama/render-client';
import { chooseReferenceImages, orderedShots, runShot } from '@/lib/drama/shot-runner';
import type { DramaProjectRecord, DramaProjectV1, DramaShot } from '@/lib/drama/types';
import {
  DramaSaveConflictError, estimateShots, pollShotTake, saveDramaProject, startEpisodeRender,
  type CreditEstimate, type ShotEstimateRequest,
} from '@/lib/drama/workbench-client';
import { findShot, fitDuration, pendingShots, updateShot, upsertTake } from '@/lib/drama/workbench-state';
import type { DramaStep, DramaWorkbenchApi, RenderState, SaveState } from './drama-context';
import { useDramaVideoModels, type DramaModelOption } from './drama-models';

const SAVE_DELAY_MS = 1200;
const MODEL_STORAGE_KEY = 'wujie-drama-video-model';

export interface UseDramaWorkbenchOptions {
  record: DramaProjectRecord;
  projectId?: string;
  onPlaceOnCanvas?: DramaWorkbenchApi['onPlaceOnCanvas'];
  onOpenCredits?: () => void;
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function readStoredModel(): string {
  try { return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function useDramaWorkbench({ record, projectId, onPlaceOnCanvas, onOpenCredits }: UseDramaWorkbenchOptions): DramaWorkbenchApi {
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
    if (batchRef.current) { toast.error('已有镜头在生成，等它完成或先停止'); return; }
    const life = lifeRef.current;
    if (!life || shotIds.length === 0) return;
    const batch = new AbortController();
    batchRef.current = batch;
    setBatchRunning(true);
    const signal = AbortSignal.any([batch.signal, life.signal]);
    let failed = 0;
    let completed = 0;
    try {
      for (const shotId of shotIds) {
        if (signal.aborted) break;
        const found = findShot(docRef.current, shotId);
        if (!found) continue;
        const model = modelForShot(found.shot);
        if (!model) { toast.error('还没有可用的视频模型', { description: '请在后台供应商设置里启用一个视频模型后再生成。' }); break; }
        const durationSec = fitDuration(found.shot.durationSec, model.durations, model.maxDuration);
        if (durationSec !== found.shot.durationSec) {
          update(current => updateShot(current, shotId, { durationSec }));
        }
        const current = docRef.current;
        const shot = findShot(current, shotId)?.shot ?? found.shot;
        const previous = orderedShots(current, found.episode.id).find(item => item.shot.id === shotId)?.previous;
        markRunning(shotId, true);
        let persistedTask = false;
        try {
          const take = await runShot({
            doc: current, shot, previous, modelId: model.key, providerId: model.providerId,
            capability: model.capability, generateAudio: generateAudio || undefined, signal,
            onTake: next => {
              update(latest => upsertTake(latest, shotId, { ...next, modelId: model.key, providerId: model.providerId }));
              // The task id is what lets a reopened page find this take again, so store it right away.
              if (next.taskId && !persistedTask) { persistedTask = true; void flushSave(); }
            },
          });
          if (take.status === 'completed') completed += 1;
          else {
            failed += 1;
            if (take.error && /积分不足|余额不足/u.test(take.error)) { creditsToast(take.error); break; }
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
    if (life.signal.aborted) return;
    if (batch.signal.aborted) toast('已停止生成', { description: '正在生成的镜头已提交给供应商，完成后仍会扣费并回到镜头上。' });
    else if (shotIds.length > 1) {
      if (failed) toast.error(`${completed} 个镜头已生成，${failed} 个失败`, { description: '失败的镜头可在镜头步骤里重拍。' });
      else toast.success(`${completed} 个镜头已生成`);
    } else if (failed === 0 && completed === 1) toast.success('镜头已生成');
    void flushSave();
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
      referenceImages: chooseReferenceImages(shot, doc.cast, model.capability).length,
    }];
  }), [episode, modelForShot, generateAudio, doc.cast]);
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

  const renderEpisode = useCallback(async () => {
    if (!episode || render.status === 'rendering') return;
    const missing = pendingShots(episode).length;
    if (missing) { toast.error(`还有 ${missing} 个镜头没有可用的视频`, { description: '先在镜头步骤里生成或选定这些镜头，再渲染成片。' }); return; }
    if (!await flushSave()) { toast.error('剧本还没保存成功，暂时不能渲染', { description: '检查顶栏的保存状态，保存成功后再试。' }); return; }
    let taskId: string;
    try {
      taskId = await startEpisodeRender(record.id, episode.id);
    } catch (error) {
      setRender({ status: 'failed', progress: 0, error: errorText(error, '成片渲染没有启动') });
      return;
    }
    update(current => ({ ...current, timeline: { ...current.timeline, lastRender: { taskId, episodeId: episode.id, status: 'processing', createdAt: Date.now() } } }));
    await followRender(taskId, episode.id);
  }, [episode, render.status, flushSave, record.id, update, followRender]);

  // A render that was running when the page closed keeps going on the server; pick its progress up again.
  useEffect(() => {
    const last = docRef.current.timeline.lastRender;
    if (last?.status === 'processing') void followRender(last.taskId, last.episodeId ?? '');
  }, [followRender]);

  return {
    doc, episode, update, replaceDoc, setEpisodeId, step, setStep, selectedShotId, selectShot,
    models, modelsLoading, defaultModel, setDefaultModelKey, modelForShot, generateAudio, setGenerateAudio,
    runningShotIds, batchRunning, generateShots, stopGeneration, estimate, busyLabel, runJob,
    dramaId: record.id, projectId, saveState, flushSave, render, renderEpisode, onPlaceOnCanvas,
  };
}

