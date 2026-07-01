/**
 * 视频工具统一API
 * POST /api/video/tools
 * 支持 action: extract-frames | concat | add-audio | trim | thumbnail
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/** 将URL转为本地文件路径（下载远程URL） */
async function urlToLocalPath(url: string): Promise<string> {
  if (url.startsWith('http')) {
    const resp = await fetch(url);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = url.includes('.mp4') ? 'mp4' : url.includes('.webm') ? 'webm' : 'mp4';
    const fname = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const fpath = join(UPLOAD_DIR, fname);
    await writeFile(fpath, buf);
    return fpath;
  }
  // 本地路径
  if (url.startsWith('/uploads/')) {
    return join(process.cwd(), 'public', url);
  }
  return join(process.cwd(), 'public', url.replace(/^\//, ''));
}

/** 检查ffmpeg是否可用 */
async function checkFFmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    
    await ensureUploadDir();
    const ffmpegAvailable = await checkFFmpeg();
    
    switch (action) {
      case 'info': {
        return NextResponse.json({
          ffmpegAvailable,
          supportedActions: ['extract-frames', 'trim', 'concat', 'add-audio', 'add-audio-to-video', 'thumbnail'],
          supportedModes: ['fps', 'uniform', 'first_last', 'keyframes'],
        });
      }
      case 'extract-frames': {
        const { videoUrl, mode = 'uniform', count = 8, fps = 1 } = body;
        if (!videoUrl) return NextResponse.json({ error: '缺少videoUrl' }, { status: 400 });
        
        if (!ffmpegAvailable) {
          return NextResponse.json({
            error: 'ffmpeg 不可用，视频抽帧功能需要服务器安装ffmpeg',
            frames: [],
            firstFrameUrl: null,
            lastFrameUrl: null,
          }, { status: 503 });
        }
        
        const localVideo = await urlToLocalPath(videoUrl);
        const frameDir = join(UPLOAD_DIR, `frames-${Date.now()}`);
        await mkdir(frameDir, { recursive: true });
        
        const frames: { url: string; timestamp: number }[] = [];
        let firstFrameUrl = '';
        let lastFrameUrl = '';
        
        try {
          if (mode === 'fps') {
            // 每秒抽N帧
            await execFileAsync('ffmpeg', [
              '-i', localVideo, '-vf', `fps=${fps}`, '-q:v', '2',
              join(frameDir, 'frame-%04d.jpg')
            ], { timeout: 60000 });
          } else if (mode === 'first_last') {
            // 首尾帧
            await execFileAsync('ffmpeg', ['-i', localVideo, '-vframes', '1', '-q:v', '2', join(frameDir, 'first.jpg')], { timeout: 30000 });
            await execFileAsync('ffmpeg', ['-sseof', '-0.1', '-i', localVideo, '-vframes', '1', '-q:v', '2', join(frameDir, 'last.jpg')], { timeout: 30000 });
          } else if (mode === 'uniform' || mode === 'total_frames') {
            // 均匀抽N帧
            const n = Math.max(2, Math.min(64, Number(count) || 8));
            await execFileAsync('ffmpeg', [
              '-i', localVideo, '-vf', `fps=1/${n}`, '-vframes', String(n), '-q:v', '2',
              join(frameDir, 'frame-%04d.jpg')
            ], { timeout: 60000 });
          }
          
          // 读取生成的帧
          const { readdir } = await import('fs/promises');
          const files = (await readdir(frameDir)).filter(f => f.endsWith('.jpg')).sort();
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const urlPath = `/uploads/${frameDir.split('/').pop()}/${f}`;
            frames.push({ url: urlPath, timestamp: i });
            if (i === 0) firstFrameUrl = urlPath;
            if (i === files.length - 1) lastFrameUrl = urlPath;
          }
        } finally {
          // 清理临时视频文件（如果是下载的）
          if (videoUrl.startsWith('http') && existsSync(localVideo)) {
            await unlink(localVideo).catch(() => {});
          }
        }
        
        return NextResponse.json({
          success: true,
          frames,
          firstFrameUrl,
          lastFrameUrl,
          totalFrames: frames.length,
        });
      }
      
      case 'add-audio': {
        const { videoUrl, audioUrl, volume = 1.0 } = body;
        if (!videoUrl || !audioUrl) return NextResponse.json({ error: '缺少videoUrl或audioUrl' }, { status: 400 });
        
        if (!ffmpegAvailable) {
          return NextResponse.json({ error: 'ffmpeg不可用，无法合成音视频' }, { status: 503 });
        }
        
        const localVideo = await urlToLocalPath(videoUrl);
        const localAudio = await urlToLocalPath(audioUrl);
        const outName = `av-${Date.now()}.mp4`;
        const outPath = join(UPLOAD_DIR, outName);
        
        try {
          await execFileAsync('ffmpeg', [
            '-i', localVideo, '-i', localAudio,
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
            '-filter:a', `volume=${volume}`,
            '-shortest', '-y', outPath
          ], { timeout: 120000 });
        } finally {
          if (videoUrl.startsWith('http') && existsSync(localVideo)) await unlink(localVideo).catch(() => {});
          if (audioUrl.startsWith('http') && existsSync(localAudio)) await unlink(localAudio).catch(() => {});
        }
        
        return NextResponse.json({
          success: true,
          videoUrl: `/uploads/${outName}`,
        });
      }
      
      case 'concat': {
        const { videoUrls } = body;
        if (!Array.isArray(videoUrls) || videoUrls.length < 2) {
          return NextResponse.json({ error: '需要videoUrls数组(至少2个)' }, { status: 400 });
        }
        
        if (!ffmpegAvailable) {
          return NextResponse.json({ error: 'ffmpeg不可用，无法拼接视频' }, { status: 503 });
        }
        
        // 下载所有视频
        const localPaths: string[] = [];
        for (const url of videoUrls) {
          localPaths.push(await urlToLocalPath(url));
        }
        
        // 创建concat文件列表
        const listPath = join(UPLOAD_DIR, `concat-${Date.now()}.txt`);
        const listContent = localPaths.map(p => `file '${p}'`).join('\n');
        await writeFile(listPath, listContent);
        
        const outName = `concat-${Date.now()}.mp4`;
        const outPath = join(UPLOAD_DIR, outName);
        
        try {
          await execFileAsync('ffmpeg', [
            '-f', 'concat', '-safe', '0', '-i', listPath,
            '-c', 'copy', '-y', outPath
          ], { timeout: 180000 });
        } finally {
          await unlink(listPath).catch(() => {});
          for (const p of localPaths) {
            if (existsSync(p) && videoUrls[localPaths.indexOf(p)]?.startsWith('http')) {
              await unlink(p).catch(() => {});
            }
          }
        }
        
        return NextResponse.json({
          success: true,
          videoUrl: `/uploads/${outName}`,
        });
      }
      
      case 'trim': {
        const { videoUrl, startTime = 0, endTime } = body;
        if (!videoUrl) return NextResponse.json({ error: '缺少videoUrl' }, { status: 400 });
        
        if (!ffmpegAvailable) {
          return NextResponse.json({ error: 'ffmpeg不可用' }, { status: 503 });
        }
        
        const localVideo = await urlToLocalPath(videoUrl);
        const outName = `trim-${Date.now()}.mp4`;
        const outPath = join(UPLOAD_DIR, outName);
        
        try {
          const args = ['-i', localVideo, '-ss', String(startTime)];
          if (endTime && endTime > startTime) {
            args.push('-t', String(endTime - startTime));
          }
          args.push('-c', 'copy', '-y', outPath);
          await execFileAsync('ffmpeg', args, { timeout: 60000 });
        } finally {
          if (videoUrl.startsWith('http') && existsSync(localVideo)) await unlink(localVideo).catch(() => {});
        }
        
        return NextResponse.json({
          success: true,
          videoUrl: `/uploads/${outName}`,
        });
      }
      
      case 'thumbnail': {
        const { videoUrl, timestamp = 0 } = body;
        if (!videoUrl) return NextResponse.json({ error: '缺少videoUrl' }, { status: 400 });
        
        if (!ffmpegAvailable) {
          return NextResponse.json({ error: 'ffmpeg不可用' }, { status: 503 });
        }
        
        const localVideo = await urlToLocalPath(videoUrl);
        const outName = `thumb-${Date.now()}.jpg`;
        const outPath = join(UPLOAD_DIR, outName);
        
        try {
          await execFileAsync('ffmpeg', [
            '-ss', String(timestamp), '-i', localVideo,
            '-vframes', '1', '-q:v', '2', '-y', outPath
          ], { timeout: 30000 });
        } finally {
          if (videoUrl.startsWith('http') && existsSync(localVideo)) await unlink(localVideo).catch(() => {});
        }
        
        return NextResponse.json({
          success: true,
          thumbnailUrl: `/uploads/${outName}`,
        });
      }
      
      default:
        return NextResponse.json({ error: `不支持的action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[video/tools] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '视频处理失败' },
      { status: 500 }
    );
  }
}
