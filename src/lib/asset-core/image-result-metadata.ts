import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

export interface CompletedImageDescriptor {
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  byteSize?: number;
}

export type InspectCompletedImage = (url: string) => Promise<Omit<CompletedImageDescriptor, 'url'>>;

const MAX_COMPLETED_IMAGES = 16;

function positiveSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function normalizeDescriptor(value: unknown, url: string): CompletedImageDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { url };
  const candidate = value as Record<string, unknown>;
  const width = positiveSafeInteger(candidate.width);
  const height = positiveSafeInteger(candidate.height);
  const byteSize = positiveSafeInteger(candidate.byteSize);
  const mimeType = typeof candidate.mimeType === 'string' && candidate.mimeType.length <= 128
    ? candidate.mimeType
    : undefined;
  return {
    url,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(mimeType ? { mimeType } : {}),
    ...(byteSize === undefined ? {} : { byteSize }),
  };
}

function isComplete(value: CompletedImageDescriptor): boolean {
  return value.width !== undefined
    && value.height !== undefined
    && value.mimeType !== undefined
    && value.byteSize !== undefined;
}

async function inspectSafeImage(url: string): Promise<Omit<CompletedImageDescriptor, 'url'>> {
  const decoded = await loadSafeImageInput(url, {
    maxBytes: 25 * 1024 * 1024,
    maxPixels: 80_000_000,
  });
  const metadata = await safeSharp(decoded.buffer, { maxPixels: 80_000_000 }).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    mimeType: decoded.mimeType,
    byteSize: decoded.buffer.byteLength,
  };
}

export async function enrichCompletedImageResult(
  result: Record<string, unknown>,
  inspect: InspectCompletedImage = inspectSafeImage,
): Promise<Record<string, unknown>> {
  const urls = Array.from(new Set([
    ...(Array.isArray(result.imageUrls) ? result.imageUrls : []),
    result.imageUrl,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)))
    .slice(0, MAX_COMPLETED_IMAGES);
  if (urls.length === 0) return structuredClone(result);

  const existing = new Map<string, CompletedImageDescriptor>();
  if (Array.isArray(result.images)) {
    for (const item of result.images) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const url = (item as Record<string, unknown>).url;
      if (typeof url === 'string' && urls.includes(url)) {
        existing.set(url, normalizeDescriptor(item, url));
      }
    }
  }

  const images = await Promise.all(urls.map(async (url) => {
    const current = existing.get(url) ?? { url };
    if (isComplete(current)) return current;
    try {
      const inspected = normalizeDescriptor(await inspect(url), url);
      return normalizeDescriptor({ ...current, ...inspected }, url);
    } catch {
      return current;
    }
  }));

  return { ...structuredClone(result), images };
}
