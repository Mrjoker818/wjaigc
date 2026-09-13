import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PersistedVideoFileMetadata {
  byteSize: number;
  mimeType: string;
  width?: number;
  height?: number;
}

function positiveSafeInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function mimeTypeForVideoPath(filePath: string): string {
  return extname(filePath).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
}

export function parseFfprobeVideoDimensions(value: unknown): {
  width?: number;
  height?: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const streams = (value as Record<string, unknown>).streams;
  if (!Array.isArray(streams)) return {};
  const stream = streams.find((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return record.codec_type === 'video' || (
      positiveSafeInteger(record.width) !== undefined
      && positiveSafeInteger(record.height) !== undefined
    );
  });
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) return {};
  const record = stream as Record<string, unknown>;
  const width = positiveSafeInteger(record.width);
  const height = positiveSafeInteger(record.height);
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

export async function inspectPersistedVideoFile(
  filePath: string,
  byteSize: number,
): Promise<PersistedVideoFileMetadata> {
  const base = {
    byteSize,
    mimeType: mimeTypeForVideoPath(filePath),
  };
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type,width,height',
      '-of', 'json',
      filePath,
    ], {
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return {
      ...base,
      ...parseFfprobeVideoDimensions(JSON.parse(stdout)),
    };
  } catch (error) {
    console.warn('[video-file-metadata] ffprobe unavailable or rejected the persisted video:', error);
    return base;
  }
}
