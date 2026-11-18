/** Bounded reads of platform or HTTPS video sources, shared by the video tools and the drama renderer. */
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServerDataRoot } from '@/lib/server-data-root';
import type { RenderClip } from '@/lib/drama/render';

const execFileAsync = promisify(execFile);

export const MAX_CLIP_BYTES = 150 * 1024 * 1024;
export const CLIP_TOO_LARGE = '视频片段过大，无法合成';

function resolveWithinDirectory(directory: string, relativePath: string): string | null {
  const resolved = path.resolve(directory, relativePath);
  const difference = path.relative(directory, resolved);
  return difference && !difference.startsWith('..') && !path.isAbsolute(difference) ? resolved : null;
}

async function readClipBuffer(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > MAX_CLIP_BYTES) throw new Error(CLIP_TOO_LARGE);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function* readResponseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      yield value;
    }
  } finally {
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readLocalVideoBuffer(url: string): Promise<Buffer | null> {
  if (!url.startsWith('/')) return null;

  let requestPath: string;
  try {
    requestPath = decodeURIComponent(url.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }

  const dataRoot = getServerDataRoot();
  const candidates: string[] = [];
  if (requestPath.startsWith('/api/serve-upload/')) {
    // Same lookup order as /api/serve-upload: generated media is stored under uploads/ first.
    const relative = requestPath.slice('/api/serve-upload/'.length);
    for (const root of [path.join(dataRoot, 'uploads'), dataRoot]) {
      const localPath = resolveWithinDirectory(root, relative);
      if (localPath) candidates.push(localPath);
    }
  } else if (requestPath.startsWith('/uploads/')) {
    const localPath = resolveWithinDirectory(path.join(dataRoot, 'uploads'), requestPath.slice('/uploads/'.length));
    if (localPath) candidates.push(localPath);
  } else {
    const localPath = resolveWithinDirectory(path.join(process.cwd(), 'public'), requestPath.slice(1));
    if (localPath) candidates.push(localPath);
  }

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).size > MAX_CLIP_BYTES) throw new Error(CLIP_TOO_LARGE);
      // The inclusive end allows one extra byte to detect growth after stat.
      return await readClipBuffer(createReadStream(candidate, { end: MAX_CLIP_BYTES }));
    } catch (error) {
      if (error instanceof Error && error.message === CLIP_TOO_LARGE) throw error;
    }
  }
  return null;
}

/** Origin for a platform path: the project domain (which may already carry a protocol), else this server. */
export function platformBaseUrl(): string {
  const domain = (process.env.COZE_PROJECT_DOMAIN_DEFAULT || '').trim().replace(/\/+$/, '');
  if (!domain) return `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

export async function downloadToBuffer(url: string): Promise<Buffer> {
  const localBuffer = await readLocalVideoBuffer(url);
  if (localBuffer) return localBuffer;

  const fullUrl = url.startsWith('http') ? url : `${platformBaseUrl()}${url}`;
  const response = await fetch(fullUrl, { signal: AbortSignal.timeout(90_000) });
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (!response.ok || contentLength > MAX_CLIP_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);
    throw new Error(CLIP_TOO_LARGE);
  }
  return response.body ? readClipBuffer(readResponseChunks(response.body)) : Buffer.alloc(0);
}

export async function probeRenderClip(videoPath: string): Promise<RenderClip & { width: number; height: number }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', videoPath,
  ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find(stream => stream.codec_type === 'video');
  const durationSec = Number.parseFloat(parsed.format?.duration ?? '');
  if (!video || !Number.isFinite(durationSec) || durationSec <= 0) throw new Error('视频片段无法解析，无法合成');
  return {
    path: videoPath, durationSec,
    hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === 'audio')),
    width: video.width || 1280, height: video.height || 720,
  };
}
