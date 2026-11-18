/** One implementation of per-shot generation, shared by the drama workbench and the canvas video panel. */
import { activeTake, type DramaCastMember, type DramaLocation, type DramaProjectV1, type DramaProp, type DramaShot, type DramaTake } from './types';

export interface ShotModelCapability {
  /** Model accepts a first-frame image. */
  imageToVideo: boolean;
  /** Upper bound of reference images the model accepts; 0 means none. */
  maxReferenceImages: number;
}

export type FirstFrameSource = 'user' | 'location' | 'previous-shot' | 'none';

export interface FirstFrameChoice {
  source: FirstFrameSource;
  url?: string;
  /** Previous shot video whose last frame must be extracted before submitting. */
  previousVideoUrl?: string;
}

function castImage(member: DramaCastMember): string[] {
  const locked = member.lockedImageUrl;
  if (locked) return [locked];
  return [member.imageUrlFront || member.frontUrl, member.imageUrlSide || member.sideUrl, member.imageUrlFull]
    .filter((url): url is string => Boolean(url));
}

function locationImage(location: DramaLocation | undefined): string | undefined {
  return location?.lockedImageUrl || location?.imageUrl || undefined;
}

/**
 * First-frame priority: a frame the user picked for this shot, then the location's reference image,
 * then the previous shot's last frame. Models without image-to-video get no first frame.
 */
export function chooseFirstFrame(
  shot: DramaShot, previous: DramaShot | undefined, location: DramaLocation | undefined, capability: ShotModelCapability,
): FirstFrameChoice {
  if (!capability.imageToVideo) return { source: 'none' };
  if (shot.firstFrameUrl) return { source: 'user', url: shot.firstFrameUrl };
  const locationUrl = locationImage(location);
  if (locationUrl) return { source: 'location', url: locationUrl };
  const previousVideo = previous ? activeTake(previous)?.videoUrl : undefined;
  if (previousVideo && shot.firstFrameFromPrev !== false) return { source: 'previous-shot', previousVideoUrl: previousVideo };
  return { source: 'none' };
}

/**
 * References for this shot, capped at the model limit: one image per character, then one per prop the shot
 * shows, then the characters' extra views. Identity drift is the worse failure, so characters go first,
 * but a prop sheet is worth more than a second angle of someone already covered.
 */
export function chooseReferenceImages(
  shot: DramaShot, cast: DramaCastMember[], capability: ShotModelCapability, exclude: string[] = [], props: DramaProp[] = [],
): string[] {
  const limit = Math.max(0, Math.floor(capability.maxReferenceImages));
  if (limit === 0) return [];
  const perMember = (shot.characterIds ?? [])
    .map(id => cast.find(member => member.id === id))
    .filter((member): member is DramaCastMember => Boolean(member))
    .map(castImage);
  const propImages = (shot.propIds ?? [])
    .map(id => props.find(item => item.id === id))
    .map(prop => prop?.lockedImageUrl || prop?.imageUrl);
  const rounds = Math.max(0, ...perMember.map(images => images.length));
  const candidates = [
    ...perMember.map(images => images[0]),
    ...propImages,
    ...Array.from({ length: Math.max(0, rounds - 1) }, (_, i) => perMember.map(images => images[i + 1])).flat(),
  ];
  const seen = new Set(exclude);
  const picked: string[] = [];
  for (const url of candidates) {
    if (picked.length >= limit) break;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    picked.push(url);
  }
  return picked;
}

export interface ShotRequestContext {
  doc: DramaProjectV1;
  shot: DramaShot;
  previous?: DramaShot;
  modelId: string;
  providerId?: string;
  capability: ShotModelCapability;
  /** Resolved first-frame URL (after any last-frame extraction). */
  firstFrameUrl?: string;
  projectId?: string;
  generateAudio?: boolean;
  quality?: string;
  resolution?: string;
}

/** The generate route counts the first frame against the same image limit as the references. */
export function shotReferenceImages(
  shot: DramaShot, cast: DramaCastMember[], capability: ShotModelCapability, firstFrameUrl?: string, props: DramaProp[] = [],
): string[] {
  if (!firstFrameUrl) return chooseReferenceImages(shot, cast, capability, [], props);
  return chooseReferenceImages(shot, cast, { ...capability, maxReferenceImages: capability.maxReferenceImages - 1 }, [firstFrameUrl], props);
}

/** Body for POST /api/video/generate. Billing, refunds and provider routing stay in that route. */
export function buildShotGenerateRequest(context: ShotRequestContext): Record<string, unknown> {
  const { doc, shot, capability } = context;
  const characterReferences = shotReferenceImages(shot, doc.cast, capability, context.firstFrameUrl, doc.props);
  const prompt = [shot.directedPrompt || shot.prompt, shot.dialogue ? `台词：「${shot.dialogue}」` : '']
    .filter(Boolean).join('\n');
  return {
    prompt,
    model: context.modelId,
    ...(context.providerId ? { providerId: context.providerId } : {}),
    ...(context.firstFrameUrl ? { imageUrl: context.firstFrameUrl, mode: 'image2video-first' } : { mode: 'text2video' }),
    ...(characterReferences.length ? { characterReferences } : {}),
    aspectRatio: shot.aspectRatio || doc.aspectRatio,
    duration: shot.durationSec,
    ...(context.quality ? { quality: context.quality } : {}),
    ...(context.resolution ? { resolution: context.resolution } : {}),
    generateAudio: context.generateAudio ?? Boolean(shot.dialogue || shot.audioCues),
    useDirector: true,
    directorMode: doc.style,
    shotId: shot.id,
    ...(context.projectId ? { projectId: context.projectId } : {}),
  };
}

export type ShotFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RunShotOptions extends Omit<ShotRequestContext, 'firstFrameUrl'> {
  fetch?: ShotFetch;
  signal?: AbortSignal;
  /** Called whenever the take changes so the UI can save progress. */
  onTake?: (take: DramaTake) => void;
  pollIntervalMs?: (attempt: number) => number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); }, { once: true });
});

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' && data.error ? data.error : fallback;
}

/** Failures another submission cannot fix: the balance, or a model that does not accept these inputs. */
const PERMANENT_FAILURE = /积分不足|余额不足|充值|不支持|不接受|capability|CAPABILITY|unsupported/u;

/**
 * A failed take may be submitted again only when the server marked it retryable and the reason is not
 * one a retry would hit again. Timeouts and dropped connections stay manual: the first task may still run.
 */
export function isRetryableTake(take: DramaTake): boolean {
  return take.status === 'failed' && take.retryable === true && !PERMANENT_FAILURE.test(take.error ?? '');
}

/** Extracts the last frame of the previous shot through the server-side ffmpeg route. */
export async function extractLastFrame(videoUrl: string, fetcher: ShotFetch, signal?: AbortSignal): Promise<string> {
  const response = await fetcher('/api/video/extract-frame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl, mode: 'last' }), signal,
  });
  const data = await readJson(response);
  if (!response.ok || typeof data.imageUrl !== 'string' || !data.imageUrl) {
    throw new Error(errorText(data, '上一镜头尾帧提取失败，可在检查器里手动指定首帧后重试'));
  }
  return data.imageUrl;
}

/** Submits one take for a shot and polls until it settles. Failed takes carry the server's error text. */
export async function runShot(options: RunShotOptions): Promise<DramaTake> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const take: DramaTake = { id: `take_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, status: 'submitted', createdAt: now() };
  const emit = (patch: Partial<DramaTake>) => { Object.assign(take, patch); options.onTake?.({ ...take }); };
  try {
    const location = options.doc.locations.find(item => item.id === options.shot.sceneId);
    const choice = chooseFirstFrame(options.shot, options.previous, location, options.capability);
    const firstFrameUrl = choice.source === 'previous-shot' && choice.previousVideoUrl
      ? await extractLastFrame(choice.previousVideoUrl, fetcher, options.signal)
      : choice.url;
    emit({});
    const body = buildShotGenerateRequest({ ...options, firstFrameUrl });
    const submit = await fetcher('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'idempotency-key': `drama:${options.shot.id}:${take.id}` },
      body: JSON.stringify(body), signal: options.signal,
    });
    const submitted = await readJson(submit);
    if (!submit.ok || typeof submitted.taskId !== 'string') {
      emit({ status: 'failed', error: errorText(submitted, '镜头提交失败'), ...(submitted.retryable === true ? { retryable: true } : {}) });
      return { ...take };
    }
    emit({ taskId: submitted.taskId, status: 'generating', ...(typeof submitted.creditCost === 'number' ? { credits: submitted.creditCost } : {}) });

    const deadline = now() + (options.timeoutMs ?? 25 * 60_000);
    const interval = options.pollIntervalMs ?? (attempt => (attempt < 3 ? 2000 : attempt < 20 ? 4000 : 6000));
    for (let attempt = 0; now() < deadline; attempt += 1) {
      await sleep(interval(attempt), options.signal);
      let polled: Response;
      try {
        polled = await fetcher('/api/poll-task', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: take.taskId, model: options.modelId, providerId: options.providerId }),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        continue;
      }
      const data = await readJson(polled);
      if (data.status === 'completed') {
        const result = (data.result ?? {}) as Record<string, unknown>;
        const videoUrl = [data.videoUrl, result.videoUrl].find((value): value is string => typeof value === 'string' && value.length > 0);
        if (!videoUrl) { emit({ status: 'failed', error: '任务已完成但没有返回视频地址' }); return { ...take }; }
        const thumbnailUrl = [data.videoThumbnailUrl, result.videoThumbnailUrl, result.thumbnailUrl]
          .find((value): value is string => typeof value === 'string' && value.length > 0);
        emit({ status: 'completed', videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) });
        return { ...take };
      }
      if (['failed', 'cancelled', 'timeout'].includes(String(data.status))) {
        emit({ status: 'failed', error: errorText(data, '镜头生成失败'), ...(data.retryable === true ? { retryable: true } : {}) });
        return { ...take };
      }
    }
    emit({ status: 'failed', error: '镜头生成超过 25 分钟仍未完成。任务可能仍在供应商处运行，稍后可在任务列表查看。' });
    return { ...take };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    emit({ status: 'failed', error: error instanceof Error ? error.message : '镜头生成失败' });
    return { ...take };
  }
}

/** Shots in timeline order, each paired with the shot before it. */
export function orderedShots(doc: DramaProjectV1, episodeId: string): Array<{ shot: DramaShot; previous?: DramaShot }> {
  const episode = doc.episodes.find(item => item.id === episodeId);
  const shots = episode ? episode.scenes.flatMap(scene => scene.shots) : [];
  return shots.map((shot, i) => ({ shot, previous: i > 0 ? shots[i - 1] : undefined }));
}
