import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { mkdir, open, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { isSafeVideoSource } from '@/lib/api-validator';
import { getServerDataRoot } from '@/lib/server-data-root';
import { readServeUploadExportLocal, readServeUploadMediaLocal } from '@/lib/serve-upload-local-storage';

// 视频抽帧：支持 first/last/at/N-grid 四种模式
// POST body:
//   { videoUrl: string; mode?: 'first'|'last'|'at'|'grid'; time?: number; gridCount?: number }
//   兼容旧字段 frame: 'last' | number
// 返回:
//   单帧模式: { success: true, imageUrl: string }
//   grid 模式: { success: true, frames: [{index, time, imageUrl}...], gridImageUrl?: string }

const uploadDir = (): string => join(getServerDataRoot(), 'uploads');

async function ensureUploadDir() {
  if (!existsSync(uploadDir())) {
    await mkdir(uploadDir(), { recursive: true });
  }
}

async function downloadVideo(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!resp.ok) throw new Error(`下载视频失败: HTTP ${resp.status}`);
  if (Number(resp.headers.get('content-length') || 0) > 150 * 1024 * 1024) {
    await resp.body?.cancel();
    throw new Error('视频超过150MB');
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('视频响应缺少内容');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 150 * 1024 * 1024) throw new Error('视频超过150MB');
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks, size);
}

// 获取视频时长（秒）
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, windowsHide: true });
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
    const proc = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, windowsHide: true });
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
  // Reverse only the final short window so the chosen frame is the actual last frame.
  const { ok, stderr } = await runFfmpeg([
    '-sseof', '-0.1', '-i', videoPath, '-vf', 'reverse', '-frames:v', '1', '-q:v', '2', outPath,
  ]);
  if (ok && existsSync(outPath)) return true;
  // A one-frame or sparse clip can have no frame within 100ms of EOF. Decode
  // sequentially into one updated JPEG, bounded by the existing process timeout.
  console.warn('[extract-frame] last seek empty, decoding through EOF:', stderr.slice(-200));
  const fallback = await runFfmpeg(['-i', videoPath, '-vsync', '0', '-update', '1', '-q:v', '2', outPath]);
  return fallback.ok && existsSync(outPath);
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
    const outPath = join(uploadDir(), filename);
    const ok = await extractSingleFrame(videoPath, t, outPath);
    if (ok) {
      frames.push({ index: i, time: Number(t.toFixed(2)), imageUrl: `/api/serve-upload/uploads/${filename}` });
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

    // CPU works on a private temporary copy; never route a managed relative URL to fetch.
    const downloadedTempPath = join(tmpdir(), `v-${randomUUID()}.mp4`);
    let ownsDownloadedTemp = false;
    try {
      let bytes: Buffer;
      if (videoUrl.startsWith('/')) {
        const pathname = decodeURIComponent(new URL(videoUrl, 'http://localhost').pathname);
        const managed = pathname.startsWith('/api/serve-upload/');
        const relativePath = managed ? pathname.slice('/api/serve-upload/'.length) : pathname.slice(1);
        // Only explicit legacy URLs or an original flat managed name may use public fallback.
        const allowLegacy = pathname.startsWith('/uploads/') || (managed && !relativePath.includes('/'));
        const local = managed && relativePath.startsWith('exports/')
          ? await readServeUploadExportLocal(getServerDataRoot(), relativePath.slice('exports/'.length), 150 * 1024 * 1024)
          : await readServeUploadMediaLocal(getServerDataRoot(), process.cwd(), relativePath, allowLegacy);
        if (!local) return NextResponse.json({ error: '视频文件不存在' }, { status: 404 });
        if (local.byteLength > 150 * 1024 * 1024) return NextResponse.json({ error: '视频超过150MB' }, { status: 413 });
        bytes = local;
      } else bytes = await downloadVideo(videoUrl);
      const handle = await open(downloadedTempPath, 'wx');
      ownsDownloadedTemp = true;
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      const localVideoPath = downloadedTempPath;
      if (mode === 'grid') {
        const { frames } = await extractGridFrames(localVideoPath, gridCount);
        if (frames.length === 0) {
          return NextResponse.json({ error: '网格抽帧失败' }, { status: 500 });
        }
        return NextResponse.json({ success: true, mode: 'grid', frames });
      }

      // 单帧模式
      const frameFilename = `frame-${randomUUID()}.jpg`;
      const framePath = join(uploadDir(), frameFilename);
      let ok = false;
      if (mode === 'first') {
        ok = await extractSingleFrame(localVideoPath, 0, framePath);
      } else if (mode === 'at') {
        ok = await extractSingleFrame(localVideoPath, Math.max(0, timeSec), framePath);
      } else {
        ok = await extractLastFrame(localVideoPath, framePath);
      }
      if (!ok) {
        await unlink(framePath).catch(() => undefined);
        return NextResponse.json({ error: '抽帧失败，视频可能无法解码或尚未安装 ffmpeg' }, { status: 500 });
      }
      const imageUrl = `/api/serve-upload/uploads/${frameFilename}`;
      return NextResponse.json({ success: true, mode, imageUrl });
    } finally {
      if (ownsDownloadedTemp) await unlink(downloadedTempPath).catch(() => undefined);
    }
  } catch (err: unknown) {
    console.error('[extract-frame] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '抽帧异常' }, { status: 500 });
  }
}
