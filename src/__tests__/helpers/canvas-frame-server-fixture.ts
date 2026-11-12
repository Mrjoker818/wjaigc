import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

const exec = promisify(execFile);
export const CANVAS_FRAME_SOURCE = '/uploads/owned-canvas-frame.mp4';
const FRAME_PATH = /^\/api\/serve-upload\/generated-videos\/(frame_\d+_[a-f0-9]{8}_001\.png)$/u;

export async function createCanvasFrameServerFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'wujie-canvas-frame-'));
  // Only remove the private directory allocated by this call.
  const close = () => rm(root, { recursive: true, force: true });
  try {
    await mkdir(path.join(root, 'uploads'));
    const source = path.join(root, CANVAS_FRAME_SOURCE.slice(1));
    await exec('ffmpeg', [
      '-nostdin', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=20:d=0.5',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=20:d=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart', source,
    ], { timeout: 15_000, windowsHide: true });
    const clip = await readFile(source);
    return {
      root, clip, close,
      async extract(
        post: (request: NextRequest) => Promise<Response>,
        origin: string, raw: string,
      ) {
        const payload: Record<string, unknown> = JSON.parse(raw);
        if (Object.keys(payload).sort().join(',') !== 'action,fps,frameCount,mode,timestamp,videoUrl'
          || payload.action !== 'extract-frames' || payload.mode !== 'single'
          || payload.videoUrl !== CANVAS_FRAME_SOURCE || payload.frameCount !== 1 || payload.fps !== 1
          || typeof payload.timestamp !== 'number' || !Number.isFinite(payload.timestamp)
          || payload.timestamp < 0) {
          throw Error('Unexpected request outside the owned single-frame fixture');
        }
        const response = await post(new NextRequest(origin + '/api/video/tools', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
        }));
        const body = await response.json();
        const frame = body?.frames?.[0];
        const filename = typeof frame?.url === 'string' ? FRAME_PATH.exec(frame.url)?.[1] : undefined;
        if (response.ok && (body.frames.length !== 1 || !filename || frame.timestamp !== payload.timestamp)) {
          throw Error('Unexpected result from the owned single-frame server');
        }
        if (!response.ok && (response.status !== 400 || payload.timestamp < 1.5 || body.success !== false)) {
          throw Error('Unexpected status from the owned single-frame server: ' + response.status);
        }
        const buffer = filename ? await readFile(path.join(root, 'generated-videos', filename)) : undefined;
        const pixels = buffer ? await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : undefined;
        const i = (45 * 160 + 80) * 4;
        if (pixels && (pixels.info.width !== 160 || pixels.info.height !== 90
          || pixels.info.channels !== 4 || pixels.data[i + 3] !== 255)) {
          throw Error('Expected the actual decoded 160 × 90 frame');
        }
        return {
          status: response.status,
          body,
          timestamp: payload.timestamp,
          frame: buffer && pixels ? {
            url: frame.url as string,
            buffer,
            center: [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]],
          } : undefined,
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
