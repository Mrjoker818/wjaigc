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

/** Length in seconds read by ffprobe from stdin, or null when ffprobe cannot tell. */
export function probeAudioSeconds(bytes: Uint8Array, format: GeneratedAudioFormat): Promise<number | null> {
  return new Promise(resolve => {
    const child = spawn('ffprobe', ['-v', 'error', '-protocol_whitelist', 'pipe', '-f', format, '-i', 'pipe:0',
      '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000, killSignal: 'SIGKILL',
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { if (out.length < 256) out += chunk.toString('utf8'); });
    child.on('error', () => resolve(null));
    child.stdin.on('error', () => undefined);
    child.once('close', code => {
      const seconds = Number.parseFloat(out.trim());
      resolve(code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    child.stdin.end(Buffer.from(bytes));
  });
}
