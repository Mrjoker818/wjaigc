import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { randomUUID } from 'crypto';
import { isSafeVideoSource, validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getServerDataRoot } from '@/lib/server-data-root';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type ExtractMode = 'fps' | 'keyframes' | 'uniform' | 'first-last';

function resolveWithinDirectory(directory: string, requestedPath: string): string | null {
  const resolved = join(directory, requestedPath);
  const difference = relative(directory, resolved);
  return difference && !difference.startsWith('..') && !isAbsolute(difference) ? resolved : null;
}

async function readPlatformVideo(videoUrl: string): Promise<Buffer | null> {
  let pathname: string;
  try {
    pathname = new URL(videoUrl, 'http://localhost').pathname;
  } catch {
    return null;
  }

  const dataRoot = getServerDataRoot();
  const candidates: string[] = [];
  if (pathname.startsWith('/api/serve-upload/')) {
    const requestedPath = pathname.slice('/api/serve-upload/'.length);
    const uploadPath = resolveWithinDirectory(join(dataRoot, 'uploads'), requestedPath);
    const legacyPath = resolveWithinDirectory(dataRoot, requestedPath);
    if (uploadPath) candidates.push(uploadPath);
    if (legacyPath) candidates.push(legacyPath);
  } else if (pathname.startsWith('/uploads/')) {
    const requestedPath = pathname.slice('/uploads/'.length);
    const dataPath = resolveWithinDirectory(join(dataRoot, 'uploads'), requestedPath);
    const publicPath = resolveWithinDirectory(join(process.cwd(), 'public', 'uploads'), requestedPath);
    if (dataPath) candidates.push(dataPath);
    if (publicPath) candidates.push(publicPath);
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFile(candidate);
  }
  return null;
}

/**
 * 视频抽帧 API
 * POST /api/video/extract-frames
 * Body: { videoUrl, mode: 'fps'|'keyframes'|'uniform'|'first-last', fps?, count? }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuthOrReject(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await req.json();
    // 输入校验
    const _validationError = validateApiInputs(typeof body !== 'undefined' ? body : {}, {
      videoUrl: 'videoUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { videoUrl, mode = 'uniform', fps = 1, count = 6 } = body;

    if (!videoUrl) {
      return NextResponse.json({ error: '缺少 videoUrl 参数' }, { status: 400 });
    }
    if (!isSafeVideoSource(videoUrl)) {
      return NextResponse.json({ error: '视频地址无效或不允许访问内网地址' }, { status: 400 });
    }

    // 1. 下载视频到临时文件
    const workDir = join('/tmp', `vframe_${Date.now()}_${randomUUID().slice(0, 8)}`);
    await mkdir(workDir, { recursive: true });
    const videoPath = join(workDir, 'input.mp4');

    let videoBuffer: Buffer;
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      const resp = await fetch(videoUrl);
      if (!resp.ok) return NextResponse.json({ error: '视频下载失败' }, { status: 400 });
      videoBuffer = Buffer.from(await resp.arrayBuffer());
    } else {
      const localBuffer = await readPlatformVideo(videoUrl);
      if (!localBuffer) return NextResponse.json({ error: '视频文件不存在' }, { status: 400 });
      videoBuffer = localBuffer;
    }
    await writeFile(videoPath, videoBuffer);

    // 2. 根据模式构造 ffmpeg 命令
    const frameDir = join(workDir, 'frames');
    await mkdir(frameDir, { recursive: true });
    const outPattern = join(frameDir, 'frame_%04d.jpg');

    const args: string[] = ['-i', videoPath];
    
    switch (mode as ExtractMode) {
      case 'fps':
        // 每秒N帧
        args.push('-vf', `fps=${Math.max(0.1, Math.min(10, fps))}`, '-q:v', '2', outPattern);
        break;
      case 'keyframes':
        // 仅提取关键帧
        args.push('-vf', "select='eq(pict_type,I)'", '-vsync', 'vfr', '-q:v', '2', outPattern);
        break;
      case 'uniform':
        // 均匀提取N帧
        const n = Math.max(2, Math.min(30, count));
        args.push('-vf', `fps=1/${n}`, '-vframes', String(n), '-q:v', '2', outPattern);
        break;
      case 'first-last':
        // 仅首帧和尾帧
        // 首帧
        await execFileAsync('ffmpeg', ['-i', videoPath, '-vframes', '1', '-q:v', '2', join(frameDir, 'frame_0001.jpg')]);
        // 尾帧
        await execFileAsync('ffmpeg', ['-sseof', '-0.1', '-i', videoPath, '-vframes', '1', '-q:v', '2', join(frameDir, 'frame_0002.jpg')]);
        break;
      default:
        args.push('-vf', `fps=1`, '-vframes', '6', '-q:v', '2', outPattern);
    }

    if (mode !== 'first-last') {
      await execFileAsync('ffmpeg', args, { timeout: 60000 });
    }

    // 3. 获取生成的帧列表
    const { readdir } = await import('fs/promises');
    const frameFiles = (await readdir(frameDir)).filter(f => f.endsWith('.jpg')).sort();

    // 4. Copy frames into the persistent directory served by /api/serve-upload.
    const uploadDir = join(getServerDataRoot(), 'uploads', 'video-frames');
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    
    const frames: string[] = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const file = frameFiles[i];
      const destName = `vf_${Date.now()}_${i.toString().padStart(3, '0')}.jpg`;
      const src = join(frameDir, file);
      const dest = join(uploadDir, destName);
      const buf = await readFile(src);
      await writeFile(dest, buf);
      frames.push(`/api/serve-upload/video-frames/${destName}`);
    }

    // 5. 获取视频信息
    let videoInfo = { duration: 0, width: 0, height: 0 };
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration:stream=width,height',
        '-of', 'json', videoPath
      ]);
      const info = JSON.parse(stdout);
      videoInfo = {
        duration: parseFloat(info.format?.duration || '0'),
        width: info.streams?.[0]?.width || 0,
        height: info.streams?.[0]?.height || 0,
      };
    } catch {}

    // 6. 清理临时文件（异步）
    try {
      const { rm } = await import('fs/promises');
      rm(workDir, { recursive: true, force: true });
    } catch {}

    return NextResponse.json({
      success: true,
      frames,
      firstFrame: frames[0] || null,
      lastFrame: frames[frames.length - 1] || null,
      frameCount: frames.length,
      videoInfo,
      mode,
    });
  } catch (error: unknown) {
    console.error('[video/extract-frames] 抽帧失败:', error);
    const msg = error instanceof Error && 'stderr' in error && typeof (error as Error & { stderr?: unknown }).stderr === 'string'
      ? (error as Error & { stderr: string }).stderr
      : error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: '视频抽帧失败: ' + msg.slice(0, 500) },
      { status: 500 }
    );
  }
}
