/** Browser calls made by the drama workbench. Every failure throws an Error whose message can be shown to the user. */
import type { SimpleChatWorkspaceHandoffIntent } from '@/lib/simple-chat-workspace-handoff';
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

/** Writes and saves a script draft from a simple chat message sent with「发送到短剧工作台」. */
export async function createDramaFromChat(intent: SimpleChatWorkspaceHandoffIntent, fetcher: WorkbenchFetch = defaultFetch): Promise<DramaProjectRecord> {
  const response = await fetcher('/api/drama/from-chat', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(intent) });
  const data = await readJson(response);
  if (!response.ok || !data.project) fail(data, '对话内容没能写成剧本，请稍后重试');
  return data.project as DramaProjectRecord;
}

export async function planSceneShots(
  doc: DramaProjectV1, episodeId: string, sceneId: string,
  options: { shotCount?: number; shotDurationSec?: number } = {}, fetcher: WorkbenchFetch = defaultFetch, signal?: AbortSignal,
): Promise<DramaShot[]> {
  const response = await fetcher('/api/drama/plan', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'shots', doc, episodeId, sceneId, ...options }), signal,
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data.shots)) fail(data, '分镜拆解失败，请稍后重试');
  return data.shots as DramaShot[];
}

export interface ShotEstimateRequest {
  shotId: string;
  modelId: string;
  providerId?: string;
  durationSec: number;
  generateAudio?: boolean;
  referenceImages?: number;
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
}

const firstText = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

/**
 * Generates one reference image through /api/generate (charged by the normal image pricing).
 * The route answers with an image URL directly or with a task to poll.
 */
export async function generateReferenceImage(prompt: string, size: string, options: ImageOptions = {}): Promise<string> {
  const fetcher = options.fetch ?? defaultFetch;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const response = await fetcher('/api/generate', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ prompt, n: 1, size }),
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
      if (!videoUrl) return { ...take, status: 'failed', error: '任务已完成但没有返回视频地址' };
      const thumbnailUrl = firstText(data.videoThumbnailUrl, result.videoThumbnailUrl, result.thumbnailUrl);
      return { ...take, status: 'completed', videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) };
    }
    if (['failed', 'cancelled', 'timeout'].includes(String(data.status))) {
      return { ...take, status: 'failed', error: firstText(data.error) ?? '镜头生成失败' };
    }
  }
  if (options.signal?.aborted) return take;
  return { ...take, status: 'failed', error: '镜头生成超过 25 分钟仍未完成。任务可能仍在供应商处运行，稍后可在任务列表查看。' };
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
