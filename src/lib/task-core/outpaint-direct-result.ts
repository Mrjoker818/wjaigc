import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { fetchImageBuffer } from '@/lib/fetch-image-buffer';
import { isS3Available, uploadImageToS3Abortable } from '@/lib/s3-storage';

export interface OutpaintResultSize {
  targetW: number;
  targetH: number;
  genW: number;
  genH: number;
}

export function readOutpaintResultSize(value: unknown): OutpaintResultSize | null {
  if (!value || typeof value !== 'object') return null;
  const size = value as Record<string, unknown>;
  const valid = (dimension: unknown): dimension is number =>
    typeof dimension === 'number' && Number.isSafeInteger(dimension) && dimension > 0;
  if (!valid(size.targetW) || !valid(size.targetH) || !valid(size.genW) || !valid(size.genH)) return null;
  return { targetW: size.targetW, targetH: size.targetH, genW: size.genW, genH: size.genH };
}

async function awaitBeforeDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([operation, deadline]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Persist a durably accepted direct result without trusting or returning its provider URL. */
export async function persistOutpaintDirectResult(url: string, size: OutpaintResultSize): Promise<string> {
  const overallDeadline = AbortSignal.timeout(120_000);
  const persistence = (async (): Promise<string> => {
    const resultBuffer = await fetchImageBuffer(url, { maxBytes: 50 * 1024 * 1024 });
    overallDeadline.throwIfAborted();
    const jpeg = await sharp(resultBuffer)
      .resize(size.targetW, size.targetH, { fit: 'fill' })
      .jpeg({ quality: 92 })
      .toBuffer();
    overallDeadline.throwIfAborted();
    if (isS3Available()) {
      const uploadDeadline = AbortSignal.timeout(60_000);
      const upload = uploadImageToS3Abortable(jpeg, `outpaint_${randomUUID()}.jpg`, 'image/jpeg', uploadDeadline);
      const persisted = await awaitBeforeDeadline(upload, uploadDeadline);
      overallDeadline.throwIfAborted();
      if (persisted) return persisted;
    }
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  })();
  return await awaitBeforeDeadline(persistence, overallDeadline);
}
