/** Video post-production helpers. */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, mkdtemp, rm, readdir, stat, readFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServerDataRoot } from '@/lib/server-data-root';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const maxDuration = 300;

const VIDEO_DIR = path.join(getServerDataRoot(), 'generated-videos');
const VIDEO_URL_PREFIX = '/api/serve-upload/generated-videos';
const MAX_STORY_CLIPS = 12;
const MAX_CLIP_BYTES = 150 * 1024 * 1024;
const MAX_EXTRACTED_FRAMES = 30;

async function ensureDir(): Promise<void> {
  await mkdir(VIDEO_DIR, { recursive: true });
}

function assertAllowedVideoSource(url: unknown): asserts url is string {
  if (typeof url !== 'string' || !url.trim()) throw new Error('视频地址无效');
  if (url.startsWith('/')) return;

  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('仅支持 HTTPS 视频地址或本平台视频地址');
  const host = parsed.hostname.toLowerCase();
  const blockedHosts = new Set(['localhost', '::1', '0.0.0.0']);
  if (
    blockedHosts.has(host) || host.endsWith('.local') || /^127\./.test(host) ||
    /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('不允许合成内网视频地址');
  }
}

function resolveWithinDirectory(directory: string, relativePath: string): string | null {
  const resolved = path.resolve(directory, relativePath);
  const difference = path.relative(directory, resolved);
  return difference && !difference.startsWith('..') && !path.isAbsolute(difference) ? resolved : null;
}

async function readLocalVideoBuffer(url: string): Promise<Buffer | null> {
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
    const localPath = resolveWithinDirectory(dataRoot, requestPath.slice('/api/serve-upload/'.length));
    if (localPath) candidates.push(localPath);
  } else if (requestPath.startsWith('/uploads/')) {
    const localPath = resolveWithinDirectory(path.join(dataRoot, 'uploads'), requestPath.slice('/uploads/'.length));
    if (localPath) candidates.push(localPath);
  } else {
    const localPath = resolveWithinDirectory(path.join(process.cwd(), 'public'), requestPath.slice(1));
    if (localPath) candidates.push(localPath);
  }

  for (const candidate of candidates) {
    try {
      const buffer = await readFile(candidate);
      if (buffer.byteLength > MAX_CLIP_BYTES) throw new Error('视频片段过大，无法合成');
      return buffer;
    } catch (error) {
      if (error instanceof Error && error.message.includes('视频片段过大')) throw error;
    }
  }
  return null;
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const localBuffer = await readLocalVideoBuffer(url);
  if (localBuffer) return localBuffer;

  const base = process.env.COZE_PROJECT_DOMAIN_DEFAULT
    ? `https://${process.env.COZE_PROJECT_DOMAIN_DEFAULT}`
    : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
  const response = await fetch(fullUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_CLIP_BYTES) throw new Error('视频片段过大，无法合成');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_CLIP_BYTES) throw new Error('视频片段过大，无法合成');
  return buffer;
}

async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
  } catch {
    throw new Error('服务器未安装 ffmpeg，暂时无法合成视频');
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getVideoResultUrl(filename: string): string {
  return `${VIDEO_URL_PREFIX}/${filename}`;
}

function getSafeFrameTimestamp(timestamp: number, duration: number): number {
  if (duration <= 0) return Math.max(0, timestamp);
  const lastFrameLimit = Math.max(0, duration - Math.min(0.1, Math.max(0.01, duration / 10)));
  return Math.min(Math.max(0, timestamp), lastFrameLimit);
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

async function extractFrame(videoPath: string, outputPath: string, timestamp: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-ss', String(Math.max(0, timestamp)), '-i', videoPath,
    '-frames:v', '1', '-y', outputPath,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const output = await stat(outputPath);
  if (output.size === 0) throw new Error('FFmpeg did not produce a video frame');
}

async function createVideoThumbnail(videoPath: string, outputPath: string): Promise<void> {
  await extractFrame(videoPath, outputPath, 0.2);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { action, videoUrl, audioUrl, videoUrls, volume = 1.0 } = body;

    if (action === 'extract-frames') {
      assertAllowedVideoSource(videoUrl);
      await ensureDir();
      await ensureFfmpeg();

      const mode = body.mode === 'fps' || body.mode === 'first_last' || body.mode === 'keyframes'
        ? body.mode
        : 'uniform';
      const frameCount = Math.round(clampNumber(body.frameCount, 12, 1, MAX_EXTRACTED_FRAMES));
      const fps = clampNumber(body.fps, 1, 0.1, 10);
      const workDir = await mkdtemp(path.join(tmpdir(), 'wujie-frames-'));
      const token = `${Date.now()}_${randomUUID().slice(0, 8)}`;

      try {
        const videoPath = path.join(workDir, 'input.mp4');
        await writeFile(videoPath, await downloadToBuffer(videoUrl));
        const duration = await getVideoDuration(videoPath);
        const frames: Array<{ url: string; timestamp?: number }> = [];

        if (mode === 'keyframes') {
          const outputPattern = path.join(VIDEO_DIR, `keyframe_${token}_%03d.png`);
          await execFileAsync('ffmpeg', [
            '-skip_frame', 'nokey', '-i', videoPath, '-frames:v', String(frameCount), '-y', outputPattern,
          ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
          const filenames = (await readdir(VIDEO_DIR))
            .filter(name => name.startsWith(`keyframe_${token}_`) && name.endsWith('.png'))
            .sort();
          frames.push(...filenames.map(name => ({ url: getVideoResultUrl(name) })));
        } else {
          const timestamps = mode === 'first_last'
            ? [0, Math.max(0, duration - 0.1)].filter((time, index, values) => index === 0 || time !== values[0])
            : Array.from({ length: frameCount }, (_, index) => {
                if (mode === 'fps') return index / fps;
                return duration > 0 && frameCount > 1 ? (duration * index) / (frameCount - 1) : 0;
              });

          for (let index = 0; index < timestamps.length; index += 1) {
            const timestamp = timestamps[index];
            if (mode === 'fps' && duration > 0 && timestamp >= duration) break;
            const safeTimestamp = getSafeFrameTimestamp(timestamp, duration);
            const filename = `frame_${token}_${String(index + 1).padStart(3, '0')}.png`;
            await extractFrame(videoPath, path.join(VIDEO_DIR, filename), safeTimestamp);
            frames.push({ url: getVideoResultUrl(filename), timestamp: safeTimestamp });
          }
        }

        if (frames.length === 0) throw new Error('未能从视频中提取到帧');
        return NextResponse.json({ success: true, frames });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    if (action === 'to-gif' || action === 'compress') {
      assertAllowedVideoSource(videoUrl);
      await ensureDir();
      await ensureFfmpeg();

      const workDir = await mkdtemp(path.join(tmpdir(), 'wujie-video-tool-'));
      const token = `${Date.now()}_${randomUUID().slice(0, 8)}`;
      try {
        const videoPath = path.join(workDir, 'input.mp4');
        await writeFile(videoPath, await downloadToBuffer(videoUrl));

        if (action === 'to-gif') {
          const fps = Math.round(clampNumber(body.fps, 10, 1, 24));
          const width = Math.round(clampNumber(body.width, 480, 160, 1280));
          const outputName = `video_${token}.gif`;
          await execFileAsync('ffmpeg', [
            '-i', videoPath, '-vf', `fps=${fps},scale=${width}:-2:flags=lanczos`, '-loop', '0', '-y', path.join(VIDEO_DIR, outputName),
          ], { timeout: 180_000, maxBuffer: 1024 * 1024 });
          return NextResponse.json({ success: true, gifUrl: getVideoResultUrl(outputName) });
        }

        const quality = clampNumber(body.quality, 0.7, 0, 1);
        const crf = Math.round(32 - quality * 14);
        const outputName = `compressed_${token}.mp4`;
        const thumbnailName = `compressed_${token}.png`;
        const outputPath = path.join(VIDEO_DIR, outputName);
        await execFileAsync('ffmpeg', [
          '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
          '-c:a', 'aac', '-movflags', '+faststart', '-y', outputPath,
        ], { timeout: 240_000, maxBuffer: 1024 * 1024 });
        await createVideoThumbnail(outputPath, path.join(VIDEO_DIR, thumbnailName));
        return NextResponse.json({
          success: true,
          videoUrl: getVideoResultUrl(outputName),
          thumbnailUrl: getVideoResultUrl(thumbnailName),
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    if (action === 'add-audio') {
      assertAllowedVideoSource(videoUrl);
      assertAllowedVideoSource(audioUrl);
      await ensureDir();
      await ensureFfmpeg();

      const workDir = await mkdtemp(path.join(tmpdir(), 'wujie-audio-'));
      const outputName = `merged_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
      const outputPath = path.join(VIDEO_DIR, outputName);
      try {
        const videoPath = path.join(workDir, 'input.mp4');
        const audioPath = path.join(workDir, 'input.mp3');
        await writeFile(videoPath, await downloadToBuffer(videoUrl));
        await writeFile(audioPath, await downloadToBuffer(audioUrl));
        await execFileAsync('ffmpeg', [
          '-i', videoPath, '-i', audioPath,
          '-filter:a', `volume=${Math.max(0, Math.min(Number(volume) || 1, 2))}`,
          '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0', '-shortest',
          '-y', outputPath,
        ], { timeout: 100_000, maxBuffer: 1024 * 1024 });
        return NextResponse.json({ success: true, videoUrl: getVideoResultUrl(outputName) });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    if (action === 'concat-videos') {
      if (!Array.isArray(videoUrls) || videoUrls.length < 2 || videoUrls.length > MAX_STORY_CLIPS) {
        return NextResponse.json({ success: false, error: `请选择 2 至 ${MAX_STORY_CLIPS} 个视频片段` }, { status: 400 });
      }
      for (const url of videoUrls) assertAllowedVideoSource(url);

      await ensureDir();
      await ensureFfmpeg();
      const workDir = await mkdtemp(path.join(tmpdir(), 'wujie-story-'));
      const outputName = `story_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
      const outputPath = path.join(VIDEO_DIR, outputName);
      const thumbnailName = outputName.replace(/\.mp4$/i, '.jpg');
      const thumbnailPath = path.join(VIDEO_DIR, thumbnailName);
      try {
        const clipPaths: string[] = [];
        for (let index = 0; index < videoUrls.length; index += 1) {
          const clipPath = path.join(workDir, `clip-${index}.mp4`);
          await writeFile(clipPath, await downloadToBuffer(videoUrls[index]));
          clipPaths.push(clipPath);
        }
        const listPath = path.join(workDir, 'concat.txt');
        const listContents = clipPaths.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join('\n');
        await writeFile(listPath, listContents, 'utf8');
        await execFileAsync('ffmpeg', [
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          '-y', outputPath,
        ], { timeout: 280_000, maxBuffer: 1024 * 1024 });
        await execFileAsync('ffmpeg', [
          '-ss', '0.2', '-i', outputPath, '-frames:v', '1', '-q:v', '2', '-y', thumbnailPath,
        ], { timeout: 60_000, maxBuffer: 1024 * 1024 });

        return NextResponse.json({
          success: true,
          videoUrl: getVideoResultUrl(outputName),
          thumbnailUrl: getVideoResultUrl(thumbnailName),
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    return NextResponse.json({ success: false, error: `不支持的 action: ${String(action || '')}` }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '视频处理失败';
    console.error('[video/tools]', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
