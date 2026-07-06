/**
 * 视频工具 API
 * POST /api/video/tools
 * action: 'add-audio' - 将音频合成到视频中
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const maxDuration = 120;

const VIDEO_DIR = path.join(process.cwd(), 'public', 'generated-videos');

async function ensureDir() {
  try { await mkdir(VIDEO_DIR, { recursive: true }); } catch {}
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const base = process.env.COZE_PROJECT_DOMAIN_DEFAULT 
    ? `https://${process.env.COZE_PROJECT_DOMAIN_DEFAULT}` 
    : `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
  const resp = await fetch(fullUrl);
  if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, videoUrl, audioUrl, volume = 1.0 } = body;

    if (action === 'add-audio') {
      if (!videoUrl || !audioUrl) {
        return NextResponse.json({ success: false, error: '缺少视频或音频URL' }, { status: 400 });
      }

      await ensureDir();
      console.log('[VideoTools] add-audio:', { videoUrl, audioUrl, volume });

      const videoBuf = await downloadToBuffer(videoUrl);
      const audioBuf = await downloadToBuffer(audioUrl);

      const tmpDir = '/tmp';
      const videoPath = path.join(tmpDir, `vid_${randomUUID()}.mp4`);
      const audioPath = path.join(tmpDir, `aud_${randomUUID()}.mp3`);
      const outFilename = `merged_${Date.now()}_${randomUUID().slice(0,8)}.mp4`;
      const outPath = path.join(VIDEO_DIR, outFilename);

      await writeFile(videoPath, videoBuf);
      await writeFile(audioPath, audioBuf);

      try {
        // 检查ffmpeg是否可用
        try {
          await execFileAsync('which', ['ffmpeg']);
        } catch {
          return NextResponse.json({ 
            success: false, 
            error: '服务器未安装ffmpeg，无法合成音频和视频' 
          }, { status: 500 });
        }

        await execFileAsync('ffmpeg', [
          '-i', videoPath,
          '-i', audioPath,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-y',
          outPath
        ], { timeout: 100000 });

        const resultUrl = `/generated-videos/${outFilename}`;
        return NextResponse.json({ success: true, videoUrl: resultUrl });

      } finally {
        try { require('fs').unlinkSync(videoPath); } catch {}
        try { require('fs').unlinkSync(audioPath); } catch {}
      }
    }

    return NextResponse.json({ success: false, error: `不支持的action: ${action}` }, { status: 400 });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('[VideoTools] error:', err);
    return NextResponse.json({ success: false, error: err.message || '视频处理失败' }, { status: 500 });
  }
}
