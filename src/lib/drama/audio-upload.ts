/** Checks for audio the user uploads to the workbench: background music and character voice samples. */
import 'server-only';
import { spawn } from 'node:child_process';
import type { GeneratedAudioFormat } from '@/lib/generated-audio-storage';

/** MP3 or WAV by their first bytes; the audio store decodes the whole file again before keeping it. */
export function sniffAudioFormat(bytes: Uint8Array): GeneratedAudioFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (bytes.length >= 3 && (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'mp3';
  return null;
}

/**
 * Length in seconds read by ffprobe from stdin, or null when ffprobe cannot tell.
 * ffprobe gives no format duration for a pipe it cannot seek, so this takes the end of the last packet.
 */
export function probeAudioSeconds(bytes: Uint8Array, format: GeneratedAudioFormat): Promise<number | null> {
  return new Promise(resolve => {
    const child = spawn('ffprobe', ['-v', 'error', '-protocol_whitelist', 'pipe', '-f', format, '-i', 'pipe:0',
      '-select_streams', 'a:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000, killSignal: 'SIGKILL',
    });
    // Only the end of the furthest packet matters; long files print one line per packet.
    let end = 0;
    let rest = '';
    const take = (line: string) => {
      const [pts, duration] = line.split(',').map(value => Number.parseFloat(value));
      if (Number.isFinite(pts)) end = Math.max(end, pts + (Number.isFinite(duration) ? duration : 0));
    };
    child.stdout.on('data', (chunk: Buffer) => {
      const lines = (rest + chunk.toString('utf8')).split('\n');
      rest = lines.pop() ?? '';
      lines.forEach(take);
    });
    child.on('error', () => resolve(null));
    child.stdin.on('error', () => undefined);
    child.once('close', code => {
      take(rest);
      resolve(code === 0 && end > 0 ? end : null);
    });
    child.stdin.end(Buffer.from(bytes));
  });
}
