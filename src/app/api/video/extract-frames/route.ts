import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { isSafeVideoSource, validateApiInputs } from '@/lib/api-validator';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getServerDataRoot } from '@/lib/server-data-root';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type ExtractMode = 'fps' | 'keyframes' | 'uniform' | 'first-last';

async function probeVideo(videoPath: string): Promise<{ duration: number; width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=duration,width,height',
      '-of', 'json', videoPath,
    ], { timeout: 15_000, windowsHide: true });
    const { format, streams } = JSON.parse(stdout);
    const stream = streams?.[0];
    const durations = [Number(stream?.duration), Number(format?.duration)];
    return {
      duration: durations.find(value => Number.isFinite(value) && value > 0) ?? 0,
      width: stream?.width || 0,
      height: stream?.height || 0,
    };
  } catch {
    return { duration: 0, width: 0, height: 0 };
  }
}

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

  let workDir: string | undefined;
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
    workDir = await mkdtemp(join(tmpdir(), 'wujie-video-frames-'));
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
    const videoInfo = await probeVideo(videoPath);

    // 2. 根据模式构造 ffmpeg 命令
    const frameDir = join(workDir, 'frames');
    await mkdir(frameDir, { recursive: true });
    const outPattern = join(frameDir, 'frame_%04d.jpg');

    const args: string[] = ['-hide_banner', '-loglevel', 'error', '-i', videoPath];
    
    switch (mode as ExtractMode) {
      case 'fps':
        // 每秒N帧
        args.push('-vf', `fps=${Math.max(0.1, Math.min(10, fps))}`, '-q:v', '2', outPattern);
        break;
      case 'keyframes':
        // 仅提取关键帧
        args.push('-vf', "select='eq(pict_type,I)'", '-vsync', 'vfr', '-q:v', '2', outPattern);
        break;
      case 'uniform': {
        const requested = Math.trunc(Number(count));
        const n = Number.isFinite(requested) ? Math.max(2, Math.min(30, requested)) : 6;
        const samplesPerSecond = videoInfo.duration > 0 ? n / videoInfo.duration : 1;
        args.push('-vf', `fps=${samplesPerSecond}:start_time=0`, '-vframes', String(n), '-q:v', '2', outPattern);
        break;
      }
      case 'first-last':
        // 仅首帧和尾帧
        // 首帧
        await execFileAsync('ffmpeg', ['-i', videoPath, '-vframes', '1', '-q:v', '2', join(frameDir, 'frame_0001.jpg')], { timeout: 60_000 });
        // 尾帧
        await execFileAsync('ffmpeg', ['-sseof', '-0.1', '-i', videoPath, '-vframes', '1', '-q:v', '2', join(frameDir, 'frame_0002.jpg')], { timeout: 60_000 });
        break;
      default:
        args.push('-vf', `fps=1`, '-vframes', '6', '-q:v', '2', outPattern);
    }

    if (mode !== 'first-last') {
      await execFileAsync('ffmpeg', args, { timeout: 60000 });
    }

    // 3. 获取生成的帧列表
    const frameFiles = (await readdir(frameDir)).filter(f => f.endsWith('.jpg')).sort();

    // 4. Copy frames into the persistent directory served by /api/serve-upload.
    const uploadDir = join(getServerDataRoot(), 'uploads', 'video-frames');
    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });
    
    const frames: string[] = [];
    const batchId = randomUUID();
    for (let i = 0; i < frameFiles.length; i++) {
      const file = frameFiles[i];
      const destName = `vf_${batchId}_${i.toString().padStart(3, '0')}.jpg`;
      const src = join(frameDir, file);
      const dest = join(uploadDir, destName);
      const buf = await readFile(src);
      await writeFile(dest, buf);
      frames.push(`/api/serve-upload/video-frames/${destName}`);
    }

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
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(error => {
        console.warn('[video/extract-frames] 临时文件清理失败:', error);
      });
    }
  }
}
