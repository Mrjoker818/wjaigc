import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import {
  downloadPublicImage,
  type DownloadedPublicImage,
} from '@/lib/safe-image-download';
import { getServerDataRoot } from '@/lib/server-data-root';

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_PSD_BYTES = 80 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 67_108_864;
const SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const PSD_MIME_TYPES = [
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'application/octet-stream',
] as const;

type DownloadFunction = typeof downloadPublicImage;

export interface ResolveLayerSourceOptions {
  signal?: AbortSignal;
  dataRoot?: string;
  workspaceRoot?: string;
  download?: DownloadFunction;
}

export interface ResolvedLayerSourceImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export class LayerSourceImageError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LayerSourceImageError';
    this.code = code;
  }
}

function decodedBase64Size(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function decodeImageDataUrl(value: string): { buffer: Buffer; mimeType: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 === 1 || decodedBase64Size(match[2]) > MAX_SOURCE_BYTES) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_DATA_INVALID',
      'Layer source image base64 is invalid or exceeds the size limit',
    );
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_DATA_INVALID',
      'Layer source image base64 is empty or exceeds the size limit',
    );
  }
  return { buffer, mimeType: match[1] };
}

function safePathWithin(root: string, relativeInput: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativeInput);
  } catch {
    throw new LayerSourceImageError('LAYER_SOURCE_PATH_INVALID', 'Media path is invalid');
  }
  const normalizedSeparators = decoded.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/').filter(Boolean);
  if (
    segments.length === 0
    || segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\0'))
  ) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_PATH_INVALID',
      'Media path escapes the controlled media root',
    );
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_PATH_INVALID',
      'Media path escapes the controlled media root',
    );
  }
  return candidate;
}

async function readBoundedFile(filePath: string): Promise<Buffer> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new LayerSourceImageError('LAYER_SOURCE_NOT_FOUND', 'Layer source media was not found');
  }
  if (fileStat.size <= 0 || fileStat.size > MAX_SOURCE_BYTES) {
    throw new LayerSourceImageError('LAYER_SOURCE_TOO_LARGE', 'Layer source media exceeds the size limit');
  }
  return readFile(filePath);
}

async function readControlledMedia(
  imageUrl: string,
  options: ResolveLayerSourceOptions,
): Promise<Buffer> {
  const dataRoot = options.dataRoot || getServerDataRoot();
  const workspaceRoot = options.workspaceRoot || process.env.COZE_WORKSPACE_PATH || process.cwd();
  let candidates: string[] = [];
  if (imageUrl.startsWith('/api/serve-upload/')) {
    candidates = [safePathWithin(dataRoot, imageUrl.slice('/api/serve-upload/'.length))];
  } else if (imageUrl.startsWith('/uploads/')) {
    const relative = imageUrl.slice(1);
    candidates = [
      safePathWithin(dataRoot, relative),
      safePathWithin(path.join(workspaceRoot, 'public'), relative),
    ];
  } else {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_PATH_INVALID',
      'Only controlled uploaded media paths are allowed',
    );
  }

  for (const candidate of candidates) {
    try {
      return await readBoundedFile(candidate);
    } catch (error) {
      if (!(error instanceof LayerSourceImageError) || error.code !== 'LAYER_SOURCE_NOT_FOUND') {
        throw error;
      }
    }
  }
  throw new LayerSourceImageError('LAYER_SOURCE_NOT_FOUND', 'Layer source media was not found');
}

function mimeForFormat(format: string | undefined): ResolvedLayerSourceImage['mimeType'] {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  throw new LayerSourceImageError(
    'LAYER_SOURCE_FORMAT_INVALID',
    'Layer source must be a JPEG, PNG, or WebP image',
  );
}

async function validateRaster(
  buffer: Buffer,
  declaredMimeType?: string,
): Promise<ResolvedLayerSourceImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_SOURCE_PIXELS,
    }).metadata();
  } catch (error) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_DECODE_FAILED',
      'Layer source image could not be decoded safely',
      { cause: error },
    );
  }
  const mimeType = mimeForFormat(metadata.format);
  if (declaredMimeType && declaredMimeType !== mimeType) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_MIME_MISMATCH',
      'Layer source MIME type does not match its decoded format',
    );
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_SOURCE_PIXELS) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_PIXEL_LIMIT',
      'Layer source image exceeds the pixel limit',
    );
  }
  return { buffer, mimeType, width: metadata.width, height: metadata.height };
}

export async function resolveLayerSourceImage(
  imageUrl: string,
  options: ResolveLayerSourceOptions = {},
): Promise<ResolvedLayerSourceImage> {
  options.signal?.throwIfAborted();
  if (imageUrl.startsWith('data:')) {
    const decoded = decodeImageDataUrl(imageUrl);
    return validateRaster(decoded.buffer, decoded.mimeType);
  }
  if (imageUrl.startsWith('/')) {
    return validateRaster(await readControlledMedia(imageUrl, options));
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new LayerSourceImageError(
      'LAYER_SOURCE_URL_INVALID',
      'Layer source must be uploaded media or a public HTTP(S) image',
    );
  }
  const downloaded = await (options.download || downloadPublicImage)(imageUrl, {
    maxBytes: MAX_SOURCE_BYTES,
    signal: options.signal,
    allowedMimeTypes: SOURCE_MIME_TYPES,
  });
  return validateRaster(downloaded.buffer, downloaded.mimeType);
}

export async function downloadPearPsd(
  psdUrl: string,
  options: { signal?: AbortSignal; download?: DownloadFunction } = {},
): Promise<DownloadedPublicImage> {
  const downloaded = await (options.download || downloadPublicImage)(psdUrl, {
    maxBytes: MAX_PSD_BYTES,
    timeoutMs: 60_000,
    signal: options.signal,
    allowedMimeTypes: PSD_MIME_TYPES,
  });
  if (downloaded.buffer.length < 4 || downloaded.buffer.subarray(0, 4).toString('ascii') !== '8BPS') {
    throw new LayerSourceImageError(
      'LAYER_PSD_SIGNATURE_INVALID',
      'Pear artifact has an invalid PSD signature',
    );
  }
  return downloaded;
}
