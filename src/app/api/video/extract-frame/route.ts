import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { isSafeVideoSource } from '@/lib/api-validator';

// 视频抽帧：支持 first/last/at/N-grid 四种模式
// POST body:
//   { videoUrl: string; mode?: 'first'|'last'|'at'|'grid'; time?: number; gridCount?: number }
//   兼容旧字段 frame: 'last' | number
// 返回:
//   单帧模式: { success: true, imageUrl: string }
//   grid 模式: { success: true, frames: [{index, time, imageUrl}...], gridImageUrl?: string }

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

async function downloadVideo(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`下载视频失败: HTTP ${resp.status}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(destPath, buf);
}

function resolveLocalVideoPath(videoUrl: string): string | null {
  if (videoUrl.startsWith('/api/serve-upload/') || videoUrl.startsWith('/uploads/')) {
    const filename = videoUrl.split('/').pop();
    if (!filename) return null;
    const local = join(UPLOAD_DIR, filename);
    return existsSync(local) ? local : null;
  }
  return null;
}

// 获取视频时长（秒）
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(0));
    proc.on('close', () => {
      const dur = parseFloat(out.trim());
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    });
  });
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve({ ok: false, stderr }));
    proc.on('close', (code) => {
      resolve({ ok: code === 0, stderr });
    });
  });
}

async function extractSingleFrame(
  videoPath: string,
  timeSec: number,
  outPath: string,
): Promise<boolean> {
  // -ss 放在 -i 之前为 seek 模式（快），但对 first 帧需要精确，所以放在 -i 之后
  const args: string[] = [];
  if (timeSec <= 0) {
    // 首帧：跳过少量帧找第一个关键帧
    args.push('-i', videoPath, '-frames:v', '1', '-q:v', '2', '-vsync', 'vfr', outPath);
  } else {
    args.push('-ss', String(timeSec), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath);
  }
  const { ok, stderr } = await runFfmpeg(args);
  if (!ok) {
    console.warn('[extract-frame] single frame ffmpeg failed:', stderr.slice(-300));
  }
  return ok && existsSync(outPath);
}

async function extractLastFrame(videoPath: string, outPath: string): Promise<boolean> {
  // 优先 -sseof 取末尾，失败则通过 duration 计算
  const { ok, stderr } = await runFfmpeg([
    '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath,
  ]);
  if (ok && existsSync(outPath)) return true;
  console.warn('[extract-frame] last frame via sseof failed, fallback to duration:', stderr.slice(-200));
  const dur = await getVideoDuration(videoPath);
  if (dur > 0) {
    return extractSingleFrame(videoPath, Math.max(0, dur - 0.1), outPath);
  }
  return false;
}

async function extractGridFrames(
  videoPath: string,
  gridCount: number,
): Promise<{ frames: { index: number; time: number; imageUrl: string }[] }> {
  const n = Math.max(2, Math.min(9, gridCount || 4));
  const dur = await getVideoDuration(videoPath);
  if (dur <= 0.3) {
    throw new Error('无法读取视频时长，无法生成网格');
  }
  const frames: { index: number; time: number; imageUrl: string }[] = [];
  // 均匀取点（避开首尾 5%）
  const start = dur * 0.05;
  const end = dur * 0.95;
  const step = (end - start) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? (start + end) / 2 : start + step * i;
    const filename = `frame-${randomUUID()}.jpg`;
    const outPath = join(UPLOAD_DIR, filename);
    const ok = await extractSingleFrame(videoPath, t, outPath);
    if (ok) {
      frames.push({ index: i, time: Number(t.toFixed(2)), imageUrl: `/api/serve-upload/${filename}` });
    }
  }
  return { frames };
}

export async function POST(req: Request) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await req.json();
    const { videoUrl } = body || {};
    if (!videoUrl || typeof videoUrl !== 'string') {
      return NextResponse.json({ error: 'videoUrl 必填' }, { status: 400 });
    }
    if (!isSafeVideoSource(videoUrl)) {
      return NextResponse.json({ error: '视频地址无效或不允许访问内网地址' }, { status: 400 });
    }

    // 解析 mode：兼容旧字段 frame
    let mode: 'first' | 'last' | 'at' | 'grid' = 'last';
    let timeSec = 0;
    let gridCount = 4;
    if (body.mode && ['first', 'last', 'at', 'grid'].includes(body.mode)) {
      mode = body.mode;
    } else if (body.frame === 'first' || body.frame === 'last') {
      mode = body.frame === 'first' ? 'first' : 'last';
    } else if (typeof body.frame === 'number') {
      mode = 'at';
      timeSec = body.frame;
    }
    if (typeof body.time === 'number') timeSec = body.time;
    if (typeof body.gridCount === 'number') gridCount = body.gridCount;

    // 检查 ffmpeg 是否可用（spawn error 会被 runFfmpeg 捕获，这里仅做一次快捷探测）

    await ensureUploadDir();

    // 1) 定位/下载视频
    let localVideoPath = resolveLocalVideoPath(videoUrl);
    let downloadedTempPath: string | null = null;
    if (!localVideoPath) {
      downloadedTempPath = join(tmpdir(), `v-${randomUUID()}.mp4`);
      await downloadVideo(videoUrl, downloadedTempPath);
      localVideoPath = downloadedTempPath;
    }

    try {
      if (mode === 'grid') {
        const { frames } = await extractGridFrames(localVideoPath, gridCount);
        if (frames.length === 0) {
          return NextResponse.json({ error: '网格抽帧失败' }, { status: 500 });
        }
        return NextResponse.json({ success: true, mode: 'grid', frames });
      }

      // 单帧模式
      const frameFilename = `frame-${randomUUID()}.jpg`;
      const framePath = join(UPLOAD_DIR, frameFilename);
      let ok = false;
      if (mode === 'first') {
        ok = await extractSingleFrame(localVideoPath, 0, framePath);
      } else if (mode === 'at') {
        ok = await extractSingleFrame(localVideoPath, Math.max(0, timeSec), framePath);
      } else {
        ok = await extractLastFrame(localVideoPath, framePath);
      }
      if (!ok) {
        return NextResponse.json({ error: '抽帧失败，视频可能无法解码或尚未安装 ffmpeg' }, { status: 500 });
      }
      const imageUrl = `/api/serve-upload/${frameFilename}`;
      return NextResponse.json({ success: true, mode, imageUrl });
    } finally {
      if (downloadedTempPath) {
        unlink(downloadedTempPath).catch(() => {});
      }
    }
  } catch (err: unknown) {
    console.error('[extract-frame] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '抽帧异常' }, { status: 500 });
  }
}
