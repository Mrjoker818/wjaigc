import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// 视频抽帧：使用 ffmpeg 抽取最后一帧（或指定秒数的帧）
// POST body: { videoUrl: string; frame?: 'last' | number }
// 返回: { success: true, imageUrl: string }  (本地静态路径，可直接访问)

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

async function extractFrameWithFfmpeg(
  videoPath: string,
  frame: 'last' | number,
  outPath: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['-y'];
    if (frame === 'last') {
      // 接近末尾截取：-sseof -0.1
      args.push('-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2');
    } else {
      args.push('-ss', String(frame), '-i', videoPath, '-frames:v', '1', '-q:v', '2');
    }
    args.push(outPath);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('[extract-frame] ffmpeg failed:', stderr.slice(-300));
        resolve(false);
      } else {
        resolve(existsSync(outPath));
      }
    });
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { videoUrl, frame = 'last' } = body || {};
    if (!videoUrl || typeof videoUrl !== 'string') {
      return NextResponse.json({ error: 'videoUrl 必填' }, { status: 400 });
    }

    await ensureUploadDir();

    // 1) 定位/下载视频
    let localVideoPath = resolveLocalVideoPath(videoUrl);
    let downloadedTempPath: string | null = null;
    if (!localVideoPath) {
      downloadedTempPath = join(tmpdir(), `v-${randomUUID()}.mp4`);
      await downloadVideo(videoUrl, downloadedTempPath);
      localVideoPath = downloadedTempPath;
    }

    // 2) ffmpeg 抽帧
    const frameFilename = `frame-${randomUUID()}.jpg`;
    const framePath = join(UPLOAD_DIR, frameFilename);
    const ok = await extractFrameWithFfmpeg(localVideoPath, frame, framePath);

    if (downloadedTempPath) {
      unlink(downloadedTempPath).catch(() => {});
    }
    if (!ok) {
      return NextResponse.json({ error: '抽帧失败，视频可能无法解码' }, { status: 500 });
    }

    const imageUrl = `/api/serve-upload/${frameFilename}`;
    return NextResponse.json({ success: true, imageUrl });
  } catch (err: any) {
    console.error('[extract-frame] error:', err);
    return NextResponse.json({ error: err?.message || '抽帧异常' }, { status: 500 });
  }
}
