/** One implementation of per-shot generation, shared by the drama workbench and the canvas video panel. */
import { DIRECTOR_STYLES, normalizeDirectorStyle } from '@/lib/video-director/director-styles';
import { stripMentions } from './mentions';
import { activeTake, type DramaCastMember, type DramaLocation, type DramaProjectV1, type DramaProp, type DramaShot, type DramaTake } from './types';

export interface ShotModelCapability {
  /** Model accepts a first-frame image. */
  imageToVideo: boolean;
  /** Upper bound of reference images the model accepts; 0 means none. */
  maxReferenceImages: number;
  /** Model accepts a last frame together with the first frame. */
  firstLastFrame?: boolean;
}

export type FirstFrameSource = 'user' | 'location' | 'previous-shot' | 'none';

export interface FirstFrameChoice {
  source: FirstFrameSource;
  url?: string;
  /** Previous shot video whose last frame must be extracted before submitting. */
  previousVideoUrl?: string;
  /** Where the film cuts out of the previous take, when it is trimmed; that frame is taken instead of the file's last. */
  previousEndSec?: number;
}

function castImage(member: DramaCastMember): string[] {
  const locked = member.lockedImageUrl;
  if (locked) return [locked];
  return [member.imageUrlFront || member.frontUrl, member.imageUrlFace, member.imageUrlSide || member.sideUrl, member.imageUrlBack, member.imageUrlFull]
    .filter((url): url is string => Boolean(url));
}

function locationImage(location: DramaLocation | undefined): string | undefined {
  return location?.lockedImageUrl || location?.imageUrl || undefined;
}

/**
 * First-frame priority: a frame the user picked for this shot, then the previous shot's last frame so the
 * cut is continuous, then the location's reference image, which opens a scene. `previous` is the shot before
 * this one in the same scene; a shot at another location never continues from it. Models without
 * image-to-video get no first frame.
 */
export function chooseFirstFrame(
  shot: DramaShot, previous: DramaShot | undefined, location: DramaLocation | undefined, capability: ShotModelCapability,
): FirstFrameChoice {
  if (!capability.imageToVideo) return { source: 'none' };
  if (shot.firstFrameUrl) return { source: 'user', url: shot.firstFrameUrl };
  const previousVideo = previous ? activeTake(previous)?.videoUrl : undefined;
  const sameLocation = !previous?.sceneId || !shot.sceneId || previous.sceneId === shot.sceneId;
  if (previousVideo && shot.firstFrameFromPrev !== false && sameLocation) {
    const end = previous?.clipEdit?.trimEndSec;
    return { source: 'previous-shot', previousVideoUrl: previousVideo, ...(end && end > 0 ? { previousEndSec: end } : {}) };
  }
  const locationUrl = locationImage(location);
  if (locationUrl) return { source: 'location', url: locationUrl };
  return { source: 'none' };
}

/**
 * The frame the shot should end on. Only sent with a first frame, and only to models that take both;
 * other models would reject the whole request.
 */
export function chooseLastFrame(shot: DramaShot, capability: ShotModelCapability, firstFrameUrl: string | undefined): string | undefined {
  if (!capability.imageToVideo || !capability.firstLastFrame || !firstFrameUrl) return undefined;
  return shot.lastFrameUrl || undefined;
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

/** Longest text taken from one bible field; the continuity block rides on every take, so it stays short. */
const CONTINUITY_FIELD_MAX = 120;

function brief(text: string | undefined, max = CONTINUITY_FIELD_MAX): string {
  // Bible text usually ends a sentence; the block joins fields with its own punctuation.
  const flat = (text ?? '').replace(/\s+/gu, ' ').trim().replace(/[。．.，,、；;：:！!？?\s]+$/u, '');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A costume of "无" or "-" means the member wears nothing worth repeating, e.g. an animal. */
function hasValue(text: string | undefined): boolean {
  return Boolean(text?.trim()) && !/^(无|没有|-|—|none)$/iu.test(text!.trim());
}

/**
 * Lines appended to the shot prompt so clips generated one at a time cut together: how each character looks,
 * where and when the scene plays, the props, the film's look, and how this shot picks up from `previous`
 * (the shot before it in the same scene). Empty when there is nothing to keep consistent.
 */
export function shotContinuityText(
  doc: DramaProjectV1, shot: DramaShot, previous?: DramaShot, firstFrameSource?: FirstFrameSource,
): string {
  const lines: string[] = [];
  const people = (shot.characterIds ?? [])
    .map(id => doc.cast.find(member => member.id === id))
    .filter((member): member is DramaCastMember => Boolean(member))
    .map(member => {
      const traits = [
        brief(member.appearance),
        hasValue(member.costume) ? `服装 ${brief(member.costume)}` : '',
        // Unlabelled: the field also holds an animal's fur, which "发型" would misname.
        hasValue(member.hair) ? brief(member.hair, 40) : '',
      ].filter(Boolean);
      return traits.length ? `${member.name}（${traits.join('，')}）` : member.name;
    });
  if (people.length) lines.push(`人物：${people.join('；')}。每个镜头里长相和服装保持一致。`);

  const scene = doc.episodes.flatMap(episode => episode.scenes).find(item => item.shots.some(other => other.id === shot.id));
  const location = doc.locations.find(item => item.id === (shot.sceneId || scene?.locationId));
  const place = [brief(scene?.heading, 60), brief(location?.description), brief(location?.lighting, 60)].filter(Boolean);
  if (place.length) lines.push(`场景：${place.join('，')}。`);

  const props = (shot.propIds ?? [])
    .map(id => doc.props.find(item => item.id === id))
    .filter((prop): prop is DramaProp => Boolean(prop))
    .map(prop => (hasValue(prop.description) ? `${prop.name}（${brief(prop.description, 60)}）` : prop.name));
  if (props.length) lines.push(`道具：${props.join('；')}。`);

  lines.push(`画风：${DIRECTOR_STYLES[normalizeDirectorStyle(doc.style)].rule.quality}，全片统一。`);

  if (firstFrameSource === 'previous-shot') {
    lines.push('衔接：首帧就是上一镜头的最后一个画面，从这里直接往下演，不要重新开场；人物位置、朝向、运动方向和光线不变。');
  } else if (previous) {
    const before = brief(previous.actionBeat || stripMentions(previous.prompt, doc), 60);
    lines.push(`衔接：紧接上一镜头${before ? `（${before}）` : ''}，人物位置、朝向和运动方向保持一致。`);
  }
  const notes = (shot.continuityNotes ?? []).map(note => brief(note, 60)).filter(Boolean);
  if (notes.length) lines.push(`注意：${notes.join('；')}。`);
  return `【连贯要求】\n${lines.join('\n')}`;
}

export interface ShotRequestContext {
  doc: DramaProjectV1;
  shot: DramaShot;
  /** The shot before this one in the same scene. */
  previous?: DramaShot;
  /** Where the first frame came from; a frame taken from `previous` changes how the cut is described. */
  firstFrameSource?: FirstFrameSource;
  modelId: string;
  providerId?: string;
  capability: ShotModelCapability;
  /** Resolved first-frame URL (after any last-frame extraction). */
  firstFrameUrl?: string;
  /** Frame the shot ends on, already filtered by `chooseLastFrame`. */
  lastFrameUrl?: string;
  projectId?: string;
  generateAudio?: boolean;
  quality?: string;
  resolution?: string;
}

/** The generate route counts the first and last frames against the same image limit as the references. */
export function shotReferenceImages(
  shot: DramaShot, cast: DramaCastMember[], capability: ShotModelCapability, frames: Array<string | undefined> = [], props: DramaProp[] = [],
): string[] {
  const used = frames.filter((url): url is string => Boolean(url));
  return chooseReferenceImages(shot, cast, { ...capability, maxReferenceImages: capability.maxReferenceImages - used.length }, used, props);
}

/** Body for POST /api/video/generate. Billing, refunds and provider routing stay in that route. */
export function buildShotGenerateRequest(context: ShotRequestContext): Record<string, unknown> {
  const { doc, shot, capability } = context;
  const characterReferences = shotReferenceImages(shot, doc.cast, capability, [context.firstFrameUrl, context.lastFrameUrl], doc.props);
  const prompt = [
    stripMentions(shot.directedPrompt || shot.prompt, doc),
    shot.dialogue ? `台词：「${shot.dialogue}」` : '',
    shotContinuityText(doc, shot, context.previous, context.firstFrameSource),
  ].filter(Boolean).join('\n');
  return {
    prompt,
    model: context.modelId,
    ...(context.providerId ? { providerId: context.providerId } : {}),
    ...(context.firstFrameUrl
      ? context.lastFrameUrl
        ? { imageUrl: context.firstFrameUrl, lastFrameImageUrl: context.lastFrameUrl, mode: 'image2video-firstlast' }
        : { imageUrl: context.firstFrameUrl, mode: 'image2video-first' }
      : { mode: 'text2video' }),
    ...(characterReferences.length ? { characterReferences } : {}),
    aspectRatio: shot.aspectRatio || doc.aspectRatio,
    duration: shot.durationSec,
    ...(context.quality ? { quality: context.quality } : {}),
    ...(context.resolution ? { resolution: context.resolution } : {}),
    generateAudio: context.generateAudio ?? Boolean(shot.dialogue || shot.audioCues),
    // The prompt above is complete; the route's director wrapper would add text written for a language model.
    useDirector: false,
    directorMode: doc.style,
    shotId: shot.id,
    ...(context.projectId ? { projectId: context.projectId } : {}),
  };
}

export type ShotFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RunShotOptions extends Omit<ShotRequestContext, 'firstFrameUrl' | 'lastFrameUrl'> {
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

/**
 * Extracts the previous shot's closing frame through the server-side ffmpeg route: the file's last frame,
 * or the frame just before `endSec` when the film trims the take there.
 */
export async function extractLastFrame(videoUrl: string, fetcher: ShotFetch, signal?: AbortSignal, endSec?: number): Promise<string> {
  const response = await fetcher('/api/video/extract-frame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(endSec ? { videoUrl, mode: 'at', time: Math.max(0, endSec - 0.05) } : { videoUrl, mode: 'last' }), signal,
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
      ? await extractLastFrame(choice.previousVideoUrl, fetcher, options.signal, choice.previousEndSec)
      : choice.url;
    emit({});
    const lastFrameUrl = chooseLastFrame(options.shot, options.capability, firstFrameUrl);
    const body = buildShotGenerateRequest({ ...options, firstFrameSource: choice.source, firstFrameUrl, lastFrameUrl });
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

/**
 * Shots in timeline order, each paired with the shot before it in the same scene. A scene's first shot has
 * none: a new scene is a new time or place, so nothing carries over the cut.
 */
export function orderedShots(doc: DramaProjectV1, episodeId: string): Array<{ shot: DramaShot; previous?: DramaShot }> {
  const episode = doc.episodes.find(item => item.id === episodeId);
  return (episode?.scenes ?? []).flatMap(scene => scene.shots.map((shot, i) => ({ shot, previous: i > 0 ? scene.shots[i - 1] : undefined })));
}
