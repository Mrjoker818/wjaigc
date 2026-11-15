import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  mimeTypeForVideoPath,
  parseFfprobeVideoDimensions,
  stripVideoAudioTrack,
} from '@/lib/asset-core/video-file-metadata';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function streamTypes(video: Buffer): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'wujie-video-test-'));
  try {
    const file = join(directory, 'probe.mp4');
    writeFileSync(file, video);
    const output = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file,
    ], { encoding: 'utf8' });
    return output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('persisted video metadata', () => {
  it('selects the video stream instead of an earlier audio stream', () => {
    expect(parseFfprobeVideoDimensions({
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', width: 720, height: 1280 },
      ],
    })).toEqual({ width: 720, height: 1280 });
  });

  it('rejects missing, fractional, or non-positive dimensions', () => {
    expect(parseFfprobeVideoDimensions({
      streams: [{ codec_type: 'video', width: 0, height: 1279.5 }],
    })).toEqual({});
    expect(parseFfprobeVideoDimensions({ streams: [] })).toEqual({});
  });

  it('preserves the MIME type implied by MP4, WebM, MOV, and M4V files', () => {
    expect(mimeTypeForVideoPath('/tmp/result.mp4')).toBe('video/mp4');
    expect(mimeTypeForVideoPath('/tmp/result.webm')).toBe('video/webm');
    expect(mimeTypeForVideoPath('/tmp/result.mov')).toBe('video/quicktime');
    expect(mimeTypeForVideoPath('/tmp/result.m4v')).toBe('video/x-m4v');
  });

  it('rejects an unsafe extension before touching the filesystem', async () => {
    await expect(stripVideoAudioTrack(Buffer.alloc(0), '../mp4')).rejects.toThrow('Unsupported video extension');
  });

  it.runIf(hasFfmpeg())('removes the audio track and keeps the video stream', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wujie-video-test-'));
    let source: Buffer;
    try {
      const file = join(directory, 'source.mp4');
      execFileSync('ffmpeg', [
        '-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
      ]);
      source = readFileSync(file);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(streamTypes(source)).toEqual(expect.arrayContaining(['video', 'audio']));

    const muted = await stripVideoAudioTrack(source, 'mp4');
    expect(streamTypes(muted)).toEqual(['video']);
  }, 30_000);
});
