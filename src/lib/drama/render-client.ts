/** Browser side of /api/drama/render: start a background render and wait for its result. */
import type { DramaTransition } from './render';

export type RenderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RenderResult {
  videoUrl: string;
  thumbnailUrl?: string;
  durationSec?: number;
}

export interface RenderClientOptions {
  fetch?: RenderFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  onProgress?: (progress: number, label?: string) => void;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** Render tasks live in the server's memory, so a restart mid-render leaves the poll with "not found". */
export const RENDER_LOST = '渲染中断了：服务器在渲染途中重启过。渲染不扣积分，点「渲染成片」重新开始即可。';

/** Polls a render task until it settles. Rejects with the server's message when the render fails. */
export async function waitForRender(taskId: string, options: RenderClientOptions = {}): Promise<RenderResult> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 25 * 60_000);
  for (let attempt = 0; now() < deadline; attempt += 1) {
    if (attempt > 0) await sleep(attempt < 5 ? 1500 : 3000);
    let data: Record<string, unknown>;
    try {
      data = await readJson(await fetcher('/api/poll-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId }),
      }));
    } catch {
      continue;
    }
    if (data.status === 'completed') {
      const result = (data.result ?? {}) as Record<string, unknown>;
      const videoUrl = text(result.videoUrl) ?? text(data.videoUrl);
      if (!videoUrl) throw new Error('成片渲染已完成，但没有返回视频地址，请重试');
      const thumbnailUrl = text(result.videoThumbnailUrl) ?? text(data.videoThumbnailUrl);
      return {
        videoUrl,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(typeof result.durationSec === 'number' ? { durationSec: result.durationSec } : {}),
      };
    }
    if (['failed', 'cancelled', 'timeout'].includes(String(data.status))) {
      const message = text(data.error);
      if (message && /不存在或已过期/u.test(message)) throw new Error(RENDER_LOST);
      throw new Error(message ?? '成片渲染失败，请确认所有镜头视频都能正常播放后重试');
    }
    if (typeof data.progress === 'number') options.onProgress?.(data.progress, text(data.label));
  }
  throw new Error('成片渲染超过 25 分钟仍未完成，请稍后在画布任务列表查看');
}

/** Stitches finished shot videos in order, keeping their audio. Free of credits. */
export async function renderShotVideos(
  videoUrls: string[], transition: DramaTransition, options: RenderClientOptions = {},
): Promise<RenderResult> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const response = await fetcher('/api/drama/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrls, transition }),
  });
  const data = await readJson(response);
  const taskId = text(data.taskId);
  if (!response.ok || !taskId) throw new Error(text(data.error) ?? '故事视频合成失败，请稍后重试');
  return waitForRender(taskId, options);
}
