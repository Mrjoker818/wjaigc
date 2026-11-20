/** Browser calls made by the drama workbench. Every failure throws an Error whose message can be shown to the user. */
import type { SimpleChatWorkspaceHandoffIntent } from '@/lib/simple-chat-workspace-handoff';
import type { PolishedShot } from './polish';
import { uncertainDramaSubmission } from './receipt-client';
import type { DramaProjectRecord, DramaProjectV1, DramaShot, DramaTake } from './types';

export type WorkbenchFetch = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: WorkbenchFetch = (input, init) => fetch(input, init);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function fail(data: Record<string, unknown>, fallback: string): never {
  throw new Error(typeof data.error === 'string' && data.error ? data.error : fallback);
}

/** Thrown when another window saved first; the caller reloads before editing again. */
export class DramaSaveConflictError extends Error {
  constructor(message: string, readonly currentVersion?: number) {
    super(message);
    this.name = 'DramaSaveConflictError';
  }
}

export async function loadDramaProject(id: string, fetcher: WorkbenchFetch = defaultFetch): Promise<DramaProjectRecord> {
  const response = await fetcher(`/api/drama/projects/${encodeURIComponent(id)}`);
  const data = await readJson(response);
  if (!response.ok || !data.project) fail(data, '剧本项目读取失败，请稍后重试');
  return data.project as DramaProjectRecord;
}

export interface DramaProjectSummary { id: string; title: string; version: number; updatedAt: number }

export class DramaCreationUnknownError extends Error {
  constructor() { super('创建结果未确认，请先返回短剧列表核对，避免重复创建'); this.name = 'DramaCreationUnknownError'; }
}

export async function listDramaProjects(projectId: string | undefined, fetcher: WorkbenchFetch = defaultFetch): Promise<DramaProjectSummary[]> {
  const response = await fetcher(`/api/drama/projects${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data.projects)) fail(data, '剧本项目列表读取失败，请稍后重试');
  return data.projects as DramaProjectSummary[];
}

export async function createDramaProject(
  doc: DramaProjectV1, projectId: string | undefined, fetcher: WorkbenchFetch = defaultFetch,
): Promise<DramaProjectRecord> {
  const response = await fetcher('/api/drama/projects', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ doc, ...(projectId ? { projectId } : {}) }),
  });
  const data = await readJson(response);
  if ((response.ok && (!data.project || typeof data.project !== 'object' || typeof (data.project as Record<string, unknown>).id !== 'string')) || response.status >= 500) throw new DramaCreationUnknownError();
  if (!response.ok || !data.project) fail(data, '剧本项目创建失败，请稍后重试');
  return data.project as DramaProjectRecord;
}

export async function saveDramaProject(
  id: string, version: number, doc: DramaProjectV1, fetcher: WorkbenchFetch = defaultFetch,
): Promise<DramaProjectRecord> {
  const response = await fetcher(`/api/drama/projects/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ version, doc }),
  });
  const data = await readJson(response);
  if (response.status === 409) {
    throw new DramaSaveConflictError(
      typeof data.error === 'string' ? data.error : '这个剧本已在其他窗口修改过，请载入最新版本',
      typeof data.currentVersion === 'number' ? data.currentVersion : undefined,
    );
  }
  if (!response.ok || !data.project) fail(data, '剧本项目保存失败，请稍后重试');
  return data.project as DramaProjectRecord;
}

export interface ScriptRequest {
  planner?: { providerId: string; modelId: string };
  idea: string;
  title?: string;
  genre?: string;
  style?: string;
  aspectRatio?: string;
  episodeCount?: number;
  episodeDurationSec?: number;
}

export async function planDramaScript(input: ScriptRequest, fetcher: WorkbenchFetch = defaultFetch, signal?: AbortSignal): Promise<DramaProjectV1> {
  const response = await fetcher('/api/drama/plan', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'script', ...input }), signal,
  });
  const data = await readJson(response);
  if (!response.ok || !data.doc) fail(data, '剧本生成失败，请稍后重试');
  return data.doc as DramaProjectV1;
}

export interface AdaptRequest {
  text: string;
  title?: string;
  style?: string;
  aspectRatio?: string;
  episodeDurationSec?: number;
  projectId?: string;
}

export interface AdaptResult { dramaId: string; adaptedParts: number; totalParts: number }

/** Starts adapting a long text on the server and returns its task id and how many parts it was split into. */
export async function startAdaptation(input: AdaptRequest, fetcher: WorkbenchFetch = defaultFetch): Promise<{ taskId: string; parts: number }> {
  const response = await fetcher('/api/drama/adapt', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  const data = await readJson(response);
  if (!response.ok || typeof data.taskId !== 'string') fail(data, '小说改编没有启动，请稍后重试');
  return { taskId: data.taskId, parts: typeof data.parts === 'number' ? data.parts : 0 };
}

/** Polls an adaptation until it settles. Each part takes about a minute. */
export async function waitForAdaptation(taskId: string, options: {
  fetch?: WorkbenchFetch; sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number;
  onProgress?: (progress: number, label?: string) => void;
} = {}): Promise<AdaptResult> {
  const fetcher = options.fetch ?? defaultFetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 30 * 60_000);
  while (now() < deadline) {
    await sleep(3000);
    let data: Record<string, unknown>;
    try {
      data = await readJson(await fetcher('/api/poll-task', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ taskId }) }));
    } catch {
      continue;
    }
    if (data.status === 'completed') {
      const result = (data.result ?? {}) as Record<string, unknown>;
      if (typeof result.dramaId !== 'string') throw new Error('改编已完成，但没有返回剧本，请在下面的列表里查看');
      return {
        dramaId: result.dramaId,
        adaptedParts: Number(result.adaptedParts) || 0,
        totalParts: Number(result.totalParts) || 0,
      };
    }
    if (['failed', 'cancelled', 'timeout'].includes(String(data.status))) fail(data, '小说改编失败，请稍后重试');
    if (typeof data.progress === 'number') options.onProgress?.(data.progress, typeof data.label === 'string' ? data.label : undefined);
  }
  throw new Error('改编超过 30 分钟仍未完成。服务器会继续改编，完成后剧本会出现在列表里');
}

/** Writes and saves a script draft from a simple chat message sent with「发送到短剧工作台」. */
export async function createDramaFromChat(intent: SimpleChatWorkspaceHandoffIntent, fetcher: WorkbenchFetch = defaultFetch): Promise<DramaProjectRecord> {
  const response = await fetcher('/api/drama/from-chat', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(intent) });
  const data = await readJson(response);
  if (!response.ok || !data.project) fail(data, '对话内容没能写成剧本，请稍后重试');
  return data.project as DramaProjectRecord;
}

export async function planSceneShots(
  doc: DramaProjectV1, episodeId: string, sceneId: string,
  options: { shotCount?: number; shotDurationSec?: number; allowedDurations?: number[] } = {}, fetcher: WorkbenchFetch = defaultFetch, signal?: AbortSignal,
): Promise<DramaShot[]> {
  const response = await fetcher('/api/drama/plan', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'shots', doc, episodeId, sceneId, ...options }), signal,
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data.shots)) fail(data, '分镜拆解失败，请稍后重试');
  return data.shots as DramaShot[];
}

/** Asks the chat model to rewrite one shot's description with shot size, camera move, light and sound. */
export async function polishShotPrompt(
  doc: DramaProjectV1, shotId: string, fetcher: WorkbenchFetch = defaultFetch, signal?: AbortSignal,
): Promise<PolishedShot> {
  const response = await fetcher('/api/drama/plan', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'polish', doc, shotId }), signal,
  });
  const data = await readJson(response);
  const shot = data.shot as PolishedShot | undefined;
  if (!response.ok || typeof shot?.prompt !== 'string') fail(data, '润色失败，请稍后重试');
  return shot;
}

export interface ShotEstimateRequest {
  shotId: string;
  modelId: string;
  providerId?: string;
  durationSec: number;
  generateAudio?: boolean;
  referenceImages?: number;
  /** 'image' prices a keyframe with the image model; the default prices the shot video. */
  kind?: 'video' | 'image';
}

export interface CreditEstimate {
  total: number;
  perShot: Record<string, number>;
  balance: number;
}

export async function estimateShots(shots: ShotEstimateRequest[], fetcher: WorkbenchFetch = defaultFetch, signal?: AbortSignal): Promise<CreditEstimate> {
  const response = await fetcher('/api/drama/estimate', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ shots }), signal,
  });
  const data = await readJson(response);
  if (!response.ok || typeof data.total !== 'number') fail(data, '积分估算失败');
  return {
    total: data.total,
    perShot: (data.perShot ?? {}) as Record<string, number>,
    balance: typeof data.balance === 'number' ? data.balance : 0,
  };
}

export interface ImageOptions {
  fetch?: WorkbenchFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  /** `providerId::modelId` from the image catalog; omitted means the server's default image model. */
  model?: string;
  providerId?: string;
  /** Locked cast and location images the image model should keep consistent with. */
  referenceImages?: string[];
}

const firstText = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

/**
 * Generates one reference image through /api/generate (charged by the normal image pricing).
 * The route answers with an image URL directly or with a task to poll.
 */
export async function generateReferenceImage(prompt: string, aspectRatio: string, options: ImageOptions = {}): Promise<string> {
  const fetcher = options.fetch ?? defaultFetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const response = await fetcher('/api/generate', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({
      prompt, n: 1, aspectRatio,
      ...(options.model ? { model: options.model } : {}),
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(options.referenceImages?.length ? { referenceImages: options.referenceImages } : {}),
    }),
  });
  const data = await readJson(response);
  if (!response.ok || data.success === false) fail(data, '设定图生成失败，请稍后重试');
  const direct = firstText(data.imageUrl, data.url, Array.isArray(data.directImageUrls) ? data.directImageUrls[0] : undefined);
  if (direct) return direct;
  const taskId = firstText(data.taskId, Array.isArray(data.taskIds) ? data.taskIds[0] : undefined);
  if (!taskId) throw new Error('设定图生成没有返回结果，请重试');
  const deadline = now() + (options.timeoutMs ?? 5 * 60_000);
  while (now() < deadline) {
    await sleep(2500);
    let polled: Record<string, unknown>;
    try {
      polled = await readJson(await fetcher('/api/poll-task', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ taskId }) }));
    } catch {
      continue;
    }
    if (polled.status === 'completed') {
      const result = (polled.result ?? {}) as Record<string, unknown>;
      const url = firstText(polled.imageUrl, result.imageUrl, polled.url);
      if (url) return url;
      throw new Error('设定图已生成但没有返回图片地址，请重试');
    }
    if (['failed', 'cancelled', 'timeout'].includes(String(polled.status))) fail(polled, '设定图生成失败，请稍后重试');
  }
  throw new Error('设定图生成超过 5 分钟仍未完成，请稍后重试');
}

/** Copies a provider URL into local storage so the reference does not expire. Falls back to the original URL. */
export async function persistImage(url: string, fetcher: WorkbenchFetch = defaultFetch): Promise<string> {
  if (!url || url.startsWith('/') || url.startsWith('data:')) return url;
  try {
    const response = await fetcher('/api/save-image', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ imageUrl: url, mediaType: 'image' }) });
    const data = await readJson(response);
    return response.ok && typeof data.url === 'string' && data.url ? data.url : url;
  } catch {
    return url;
  }
}

/** Image types the upload route accepts; the file picker offers only these. */
export const REFERENCE_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';

/** Shown when an image is over the upload route's edge limit; the importer shrinks the image when it sees it. */
export const IMAGE_TOO_BIG = '图片尺寸太大，缩小后再上传';

/** The upload route answers in English; these say what to change in the user's words. */
function uploadError(status: number, message: unknown): string {
  const text = typeof message === 'string' ? message : '';
  const size = /max (\d+)MB/i.exec(text);
  if (size) return `图片超过 ${size[1]}MB，压缩后再上传`;
  if (/dimension|edge|too large|pixels/i.test(text)) return IMAGE_TOO_BIG;
  if (/format|raster|does not match|allowed/i.test(text)) return '只能上传 PNG、JPG、WebP、GIF、BMP 或 AVIF 图片';
  if (status === 401) return '登录已过期，刷新页面重新登录后再上传';
  return '图片上传失败，请稍后重试';
}

/** Uploads a reference image the user picked and returns its stored URL. Costs no credits. */
export async function uploadReferenceImage(file: File, fetcher: WorkbenchFetch = defaultFetch): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetcher('/api/upload', { method: 'POST', body });
  } catch {
    throw new Error('网络中断，图片没有上传，请重试');
  }
  const data = await readJson(response);
  if (!response.ok || typeof data.url !== 'string' || !data.url) throw new Error(uploadError(response.status, data.error));
  return data.url;
}

/** Uploads background music (MP3 or WAV) for the episode. Costs no credits. */
export async function uploadDramaMusic(file: File, fetcher: WorkbenchFetch = defaultFetch): Promise<{ url: string; name: string }> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetcher('/api/drama/music', { method: 'POST', body });
  } catch {
    throw new Error('网络中断，音乐没有上传，请重试');
  }
  const data = await readJson(response);
  if (!response.ok || typeof data.audioUrl !== 'string' || !data.audioUrl) fail(data, '音乐上传失败，请稍后重试');
  return { url: data.audioUrl, name: typeof data.name === 'string' && data.name ? data.name : file.name };
}

/** Uploads a character's voice sample (MP3 or WAV, 2–15 seconds, up to 15MB). Costs no credits. */
export async function uploadVoiceSample(
  file: File, fetcher: WorkbenchFetch = defaultFetch,
): Promise<{ url: string; name: string; durationSec?: number }> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetcher('/api/drama/voice-sample', { method: 'POST', body });
  } catch {
    throw new Error('网络中断，声音样本没有上传，请重试');
  }
  const data = await readJson(response);
  if (!response.ok || typeof data.audioUrl !== 'string' || !data.audioUrl) fail(data, '声音样本上传失败，请稍后重试');
  return {
    url: data.audioUrl,
    name: typeof data.name === 'string' && data.name ? data.name : file.name,
    ...(typeof data.durationSec === 'number' ? { durationSec: data.durationSec } : {}),
  };
}

/** Uploads a shot video (MP4, WebM or MOV, up to 48MB) and returns its stored URL. Costs no credits. */
export async function uploadDramaClip(file: File, fetcher: WorkbenchFetch = defaultFetch): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetcher('/api/drama/clip', { method: 'POST', body });
  } catch {
    throw new Error('网络中断，视频没有上传，请重试');
  }
  const data = await readJson(response);
  if (!response.ok || typeof data.videoUrl !== 'string' || !data.videoUrl) fail(data, '视频上传失败，请稍后重试');
  return data.videoUrl;
}

/** Records one line with the admin's text-to-speech model through /api/audio/generate. Costs no credits. */
export async function generateVoiceover(text: string, voice: string, fetcher: WorkbenchFetch = defaultFetch): Promise<string> {
  const response = await fetcher('/api/audio/generate', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text, voice, format: 'mp3' }),
  });
  const data = await readJson(response);
  if (response.status === 403) fail(data, '当前账号还没有开通语音生成，请联系管理员开通后再生成配音');
  if (!response.ok || data.success === false) fail(data, '配音生成失败，请稍后重试');
  if (typeof data.audioUrl !== 'string' || !data.audioUrl) throw new Error('配音已生成但没有返回音频地址，请重试');
  return data.audioUrl;
}

/** Starts a background render of a saved episode and returns its task id. The project must be saved first. */
export async function startEpisodeRender(dramaId: string, episodeId: string, fetcher: WorkbenchFetch = defaultFetch): Promise<string> {
  const response = await fetcher('/api/drama/render', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ dramaId, episodeId }),
  });
  const data = await readJson(response);
  if (!response.ok || typeof data.taskId !== 'string') fail(data, '成片渲染没有启动，请稍后重试');
  return data.taskId;
}

/**
 * Follows a take that was still generating when the page closed. A take without a task id never reached the
 * provider as far as this page knows, so it is reported as failed instead of polled.
 */
export async function pollShotTake(
  take: DramaTake, modelId: string | undefined, providerId: string | undefined,
  options: ImageOptions & { signal?: AbortSignal } = {},
): Promise<DramaTake> {
  if (!take.taskId) {
    return { ...take, status: 'failed', error: '页面关闭前没有拿到任务编号。请先在任务列表确认是否已扣费，再决定是否重拍。' };
  }
  const fetcher = options.fetch ?? defaultFetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 25 * 60_000);
  for (let attempt = 0; now() < deadline && !options.signal?.aborted; attempt += 1) {
    if (attempt > 0) await sleep(attempt < 5 ? 3000 : 6000);
    let data: Record<string, unknown>;
    try {
      data = await readJson(await fetcher('/api/poll-task', {
        method: 'POST', headers: JSON_HEADERS, signal: options.signal,
        body: JSON.stringify({ taskId: take.taskId, ...(modelId ? { model: modelId } : {}), ...(providerId ? { providerId } : {}) }),
      }));
    } catch {
      continue;
    }
    if (data.status === 'completed') {
      const result = (data.result ?? {}) as Record<string, unknown>;
      const videoUrl = firstText(data.videoUrl, result.videoUrl);
      if (!videoUrl) return { ...take, status: 'generating', retryable: false, error: '原任务已生成，视频地址尚待回读，请恢复原回执' };
      const thumbnailUrl = firstText(data.videoThumbnailUrl, result.videoThumbnailUrl, result.thumbnailUrl);
      return { ...take, status: 'completed', videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) };
    }
    if (uncertainDramaSubmission(data.error)) return { ...take, status: 'generating', retryable: false, error: '原供应商提交结果尚未确认，请核对原任务，勿重复生成' };
    if (['failed', 'cancelled'].includes(String(data.status))) {
      return { ...take, status: 'failed', error: firstText(data.error) ?? '镜头生成失败', ...(data.retryable === true ? { retryable: true } : {}) };
    }
  }
  if (options.signal?.aborted) return take;
  return { ...take, status: 'generating', retryable: false, error: '原任务暂未返回结果，已保留任务编号，请稍后恢复查询' };
}

export interface RetakeSuggestion {
  label: string;
  patch: Record<string, unknown>;
  promptPrepend?: string;
  promptAppend?: string;
}

export interface RetakeDiagnosis {
  title: string;
  description: string;
  suggestions: RetakeSuggestion[];
}

export async function diagnoseRetake(failureType: string, shot: DramaShot, fetcher: WorkbenchFetch = defaultFetch): Promise<RetakeDiagnosis> {
  const response = await fetcher('/api/video/director/diagnose', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ failureType, prompt: shot.prompt, aspectRatio: shot.aspectRatio, duration: shot.durationSec }),
  });
  const data = await readJson(response);
  const diagnosis = (data.diagnosis ?? {}) as Record<string, unknown>;
  if (!response.ok || typeof diagnosis.title !== 'string') fail(data, '重拍诊断失败，请稍后重试');
  return {
    title: diagnosis.title,
    description: typeof diagnosis.description === 'string' ? diagnosis.description : '',
    suggestions: Array.isArray(data.retakeSuggestions) ? data.retakeSuggestions as RetakeSuggestion[] : [],
  };
}

/** Applies a diagnosis suggestion to the shot: prompt additions and the fields the workbench understands. */
export function applyRetakeSuggestion(shot: DramaShot, suggestion: RetakeSuggestion): DramaShot {
  const prompt = [suggestion.promptPrepend, shot.prompt, suggestion.promptAppend].filter(Boolean).join(suggestion.promptPrepend || suggestion.promptAppend ? '，' : '');
  const patch = suggestion.patch;
  const duration = typeof patch.duration === 'number' ? patch.duration : undefined;
  return {
    ...shot,
    prompt: prompt.slice(0, 8000),
    ...(typeof patch.shotSize === 'string' ? { shotSize: patch.shotSize } : {}),
    ...(typeof patch.cameraMovement === 'string' ? { cameraMotion: patch.cameraMovement, cameraMove: patch.cameraMovement } : {}),
    ...(patch.disableLastFrame === true ? { firstFrameFromPrev: false } : {}),
    ...(duration ? { duration, durationSec: duration } : {}),
    retakeCount: (shot.retakeCount ?? 0) + 1,
  };
}
