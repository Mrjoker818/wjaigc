/** Video post-production helpers. */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const maxDuration = 300;

const VIDEO_DIR = path.join(process.cwd(), 'public', 'generated-videos');
const MAX_STORY_CLIPS = 12;
const MAX_CLIP_BYTES = 150 * 1024 * 1024;

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

async function downloadToBuffer(url: string): Promise<Buffer> {
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { action, videoUrl, audioUrl, videoUrls, volume = 1.0 } = body;

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
        return NextResponse.json({ success: true, videoUrl: `/generated-videos/${outputName}` });
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
          videoUrl: `/generated-videos/${outputName}`,
          thumbnailUrl: `/generated-videos/${thumbnailName}`,
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
