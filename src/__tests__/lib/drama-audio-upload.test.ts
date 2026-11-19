import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { probeAudioSeconds, sniffAudioFormat } from '@/lib/drama/audio-upload';

function hasBinary(name: string): boolean {
  try { execFileSync(name, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe('probeAudioSeconds', () => {
  // ffprobe reports format=duration as N/A on a pipe, which once rejected every upload.
  it.skipIf(!hasBinary('ffmpeg') || !hasBinary('ffprobe'))('reads the length of a real MP3 and WAV from stdin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drama-audio-'));
    try {
      for (const [format, seconds] of [['mp3', 5], ['wav', 3]] as const) {
        const file = join(dir, `tone.${format}`);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ac', '1', file]);
        const bytes = new Uint8Array(readFileSync(file));
        expect(sniffAudioFormat(bytes)).toBe(format);
        expect(await probeAudioSeconds(bytes, format)).toBeCloseTo(seconds, 0);
      }
      expect(await probeAudioSeconds(new Uint8Array(64), 'mp3')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
