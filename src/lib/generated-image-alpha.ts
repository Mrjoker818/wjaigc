import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_GENERATED_IMAGE_PIXELS = 40_000_000;

export type AlphaVerificationStatus = 'verified' | 'opaque' | 'unverified' | 'invalid';

export interface GeneratedImageAlphaVerification {
  status: AlphaVerificationStatus;
  format?: string;
  hasAlphaChannel?: boolean;
  hasTransparentPixels?: boolean;
  width?: number;
  height?: number;
}

export interface GeneratedImageAlphaSetVerification {
  requested: true;
  status: AlphaVerificationStatus;
  items: Array<GeneratedImageAlphaVerification & { imageUrl: string }>;
}

async function loadInput(input: Buffer | string): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const loaded = await loadSafeImageInput(input, {
      maxBytes: MAX_GENERATED_IMAGE_BYTES,
      maxPixels: MAX_GENERATED_IMAGE_PIXELS,
      signal: controller.signal,
    });
    return loaded.buffer;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyGeneratedImageAlpha(
  input: Buffer | string,
): Promise<GeneratedImageAlphaVerification> {
  try {
    const buffer = await loadInput(input);
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_GENERATED_IMAGE_BYTES) {
      return { status: 'invalid' };
    }
    const metadata = await safeSharp(buffer, {
      maxPixels: MAX_GENERATED_IMAGE_PIXELS,
    }).metadata();
    const format = metadata.format || undefined;
    const base = {
      format,
      width: metadata.width,
      height: metadata.height,
    };
    if (!['png', 'webp'].includes(format || '')) {
      return { status: 'invalid', ...base };
    }
    const hasAlphaChannel = metadata.hasAlpha === true || metadata.channels === 4;
    if (!hasAlphaChannel) {
      return {
        status: 'opaque',
        ...base,
        hasAlphaChannel: false,
        hasTransparentPixels: false,
      };
    }

    const alphaChannel = await safeSharp(buffer, {
      maxPixels: MAX_GENERATED_IMAGE_PIXELS,
    }).extractChannel('alpha').raw().toBuffer();
    const hasTransparentPixels = alphaChannel.some((value) => value < 255);
    return {
      status: hasTransparentPixels ? 'verified' : 'opaque',
      ...base,
      hasAlphaChannel: true,
      hasTransparentPixels,
    };
  } catch {
    return {
      status: typeof input === 'string' && /^https?:\/\//i.test(input)
        ? 'unverified'
        : 'invalid',
    };
  }
}

export async function verifyGeneratedImageAlphaSet(
  imageInputs: Array<Buffer | string>,
): Promise<GeneratedImageAlphaSetVerification> {
  const items = await Promise.all(imageInputs.map(async (imageInput, index) => ({
    imageUrl: typeof imageInput === 'string' ? imageInput : `buffer:${index}`,
    ...await verifyGeneratedImageAlpha(imageInput),
  })));
  const statuses = items.map(item => item.status);
  const status: AlphaVerificationStatus = statuses.length > 0 && statuses.every(value => value === 'verified')
    ? 'verified'
    : statuses.includes('opaque')
      ? 'opaque'
      : statuses.includes('invalid')
        ? 'invalid'
        : 'unverified';
  return { requested: true, status, items };
}
