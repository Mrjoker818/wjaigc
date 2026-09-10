import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import sharp, { type Sharp } from 'sharp';

import { downloadPublicImage } from '@/lib/safe-image-download';
import { getServerDataRoot } from '@/lib/server-data-root';

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 40_000_000;
const BASE64_DECODE_CHUNK_CHARS = 64 * 1024;
const DATA_URL_MIME_BY_HEADER: Readonly<Record<string, string>> = {
  'data:image/avif;base64,': 'image/avif',
  'data:image/gif;base64,': 'image/gif',
  'data:image/jpeg;base64,': 'image/jpeg',
  'data:image/png;base64,': 'image/png',
  'data:image/tiff;base64,': 'image/tiff',
  'data:image/webp;base64,': 'image/webp',
};

const MIME_BY_FORMAT: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

export class SafeImageInputError extends Error {
  readonly code = 'UNSAFE_IMAGE_INPUT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SafeImageInputError';
  }
}

export interface DecodedSafeImage {
  buffer: Buffer;
  mimeType: string;
}

export interface SafeImageInputOptions {
  allowRawBase64?: boolean;
  maxBytes?: number;
  maxPixels?: number;
  signal?: AbortSignal;
}

export interface ManagedMediaPath {
  namespace: 'uploads' | 'gallery';
  relativePath: string;
}

const MANAGED_MEDIA_PREFIXES = ['/uploads/', '/api/serve-upload/', '/gallery/'];
const PRIVATE_MEDIA_ROOTS = new Set(['system', 'users']);

function detectImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  if (
    buffer.length >= 6
    && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))
  ) return 'image/gif';
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 4, 8) === 'ftyp'
    && ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12))
  ) return 'image/avif';
  if (
    buffer.length >= 4
    && (
      buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
      || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
      || buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2b, 0x00]))
      || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2b]))
    )
  ) return 'image/tiff';
  return null;
}

function isBase64Character(code: number): boolean {
  return code >= 65 && code <= 90
    || code >= 97 && code <= 122
    || code >= 48 && code <= 57
    || code === 43
    || code === 47;
}

function trimWithoutCopy(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start].trim().length === 0) start += 1;
  while (end > start && value[end - 1].trim().length === 0) end -= 1;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

function decodeStrictBase64(
  value: string,
  start: number,
  end: number,
  maxBytes: number,
): Buffer {
  const length = end - start;
  const padding = value.charCodeAt(end - 1) === 61
    ? value.charCodeAt(end - 2) === 61 ? 2 : 1
    : 0;
  const estimatedBytes = Math.floor((length * 3) / 4) - padding;
  if (estimatedBytes > maxBytes) {
    throw new SafeImageInputError('Image exceeds the decoded size limit');
  }
  if (length === 0 || length % 4 !== 0) {
    throw new SafeImageInputError('Image base64 is malformed');
  }
  const contentEnd = end - padding;
  for (let index = start; index < contentEnd; index += 1) {
    if (!isBase64Character(value.charCodeAt(index))) {
      throw new SafeImageInputError('Image base64 is malformed');
    }
  }
  for (let index = contentEnd; index < end; index += 1) {
    if (value.charCodeAt(index) !== 61) {
      throw new SafeImageInputError('Image base64 is malformed');
    }
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.allocUnsafe(estimatedBytes);
    let written = 0;
    for (let offset = start; offset < end; offset += BASE64_DECODE_CHUNK_CHARS) {
      const chunkEnd = Math.min(end, offset + BASE64_DECODE_CHUNK_CHARS);
      const chunk = Buffer.from(value.slice(offset, chunkEnd), 'base64');
      written += chunk.copy(buffer, written);
    }
    if (written !== estimatedBytes) throw new Error('Decoded image length did not match base64');
  } catch (error) {
    throw new SafeImageInputError('Image base64 could not be decoded', { cause: error });
  }
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
    throw new SafeImageInputError('Image exceeds the decoded size limit');
  }
  return buffer;
}

export function decodeSafeImageInput(
  input: string,
  options: Pick<SafeImageInputOptions, 'allowRawBase64' | 'maxBytes'> = {},
): DecodedSafeImage {
  const value = trimWithoutCopy(input);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const headerProbe = value.slice(0, Math.min(value.length, 64));
  const commaIndex = headerProbe.indexOf(',');
  const header = commaIndex < 0 ? '' : headerProbe.slice(0, commaIndex + 1).toLowerCase();
  const declaredMime = DATA_URL_MIME_BY_HEADER[header];
  if (declaredMime) {
    const buffer = decodeStrictBase64(value, commaIndex + 1, value.length, maxBytes);
    const detectedMime = detectImageMimeType(buffer);
    if (!detectedMime || detectedMime !== declaredMime) {
      throw new SafeImageInputError('Image MIME does not match its decoded format');
    }
    return { buffer, mimeType: detectedMime };
  }
  if (value.startsWith('data:')) {
    throw new SafeImageInputError('Image data URL MIME is not allowed');
  }
  if (!options.allowRawBase64) {
    throw new SafeImageInputError('Raw image base64 is not allowed');
  }
  const buffer = decodeStrictBase64(value, 0, value.length, maxBytes);
  const mimeType = detectImageMimeType(buffer);
  if (!mimeType) {
    throw new SafeImageInputError('Decoded input is not a supported image');
  }
  return { buffer, mimeType };
}

export function assertSafePixelDimensions(
  width: number | undefined,
  height: number | undefined,
  maxPixels: number = DEFAULT_MAX_PIXELS,
): void {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || !width
    || !height
    || width < 1
    || height < 1
    || width * height > maxPixels
  ) {
    throw new SafeImageInputError('Image pixel dimensions exceed the safe pixel limit');
  }
}

export function resolveManagedMediaPath(input: string): ManagedMediaPath {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(input.split(/[?#]/, 1)[0]);
  } catch (error) {
    throw new SafeImageInputError('Managed image path encoding is invalid', { cause: error });
  }
  const prefix = MANAGED_MEDIA_PREFIXES.find(
    (candidate) => decodedPath.startsWith(candidate),
  );
  if (!prefix || decodedPath.includes('\\')) {
    throw new SafeImageInputError('Only managed upload paths are allowed');
  }
  const segments = decodedPath.slice(prefix.length).split('/');
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || PRIVATE_MEDIA_ROOTS.has(segments[0].toLowerCase())
  ) {
    throw new SafeImageInputError('Managed image path contains traversal');
  }
  return {
    namespace: prefix === '/gallery/' ? 'gallery' : 'uploads',
    relativePath: segments.join('/'),
  };
}

export function normalizeTrustedManagedMediaInput(
  input: string,
  trustedHosts: Iterable<string>,
): string {
  const value = input.trim();
  if (MANAGED_MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return input;
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || !MANAGED_MEDIA_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
  ) {
    return input;
  }

  const allowedHosts = new Set(
    Array.from(trustedHosts, (host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowedHosts.has(parsed.host.toLowerCase())
    ? parsed.pathname
    : input;
}

export function safeSharp(
  buffer: Buffer,
  options: Pick<SafeImageInputOptions, 'maxPixels' | 'signal'> = {},
): Sharp {
  options.signal?.throwIfAborted();
  const pipeline = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: options.maxPixels ?? DEFAULT_MAX_PIXELS,
  });
  const abortPipeline = () => {
    const abortError = options.signal?.reason instanceof Error
      ? options.signal.reason
      : new SafeImageInputError('Image processing was aborted');
    pipeline.once('error', () => undefined);
    pipeline.destroy(abortError);
  };
  options.signal?.addEventListener('abort', abortPipeline, { once: true });
  pipeline.once('close', () => options.signal?.removeEventListener('abort', abortPipeline));
  if (options.signal?.aborted) abortPipeline();
  return pipeline;
}

export async function withSafeSharp<T>(
  buffer: Buffer,
  options: Pick<SafeImageInputOptions, 'maxPixels' | 'signal'>,
  operation: (pipeline: Sharp) => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  const pipeline = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: options.maxPixels ?? DEFAULT_MAX_PIXELS,
  });
  const abortPipeline = () => {
    const abortError = options.signal?.reason instanceof Error
      ? options.signal.reason
      : new SafeImageInputError('Image processing was aborted');
    pipeline.once('error', () => undefined);
    pipeline.destroy(abortError);
  };
  options.signal?.addEventListener('abort', abortPipeline, { once: true });
  try {
    const result = await operation(pipeline);
    options.signal?.throwIfAborted();
    return result;
  } finally {
    options.signal?.removeEventListener('abort', abortPipeline);
  }
}

async function validateDecodedImage(
  image: DecodedSafeImage,
  options: SafeImageInputOptions,
): Promise<DecodedSafeImage> {
  try {
    const metadata = await withSafeSharp(
      image.buffer,
      options,
      pipeline => pipeline.metadata(),
    );
    options.signal?.throwIfAborted();
    assertSafePixelDimensions(metadata.width, metadata.height, options.maxPixels);
    const sharpMime = metadata.format ? MIME_BY_FORMAT[metadata.format] : undefined;
    if (!sharpMime || sharpMime !== image.mimeType) {
      throw new SafeImageInputError('Image format validation failed');
    }
    return image;
  } catch (error) {
    if (error instanceof SafeImageInputError) throw error;
    throw new SafeImageInputError('Image cannot be decoded safely', { cause: error });
  }
}

async function loadManagedMedia(
  input: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<DecodedSafeImage> {
  const managed = resolveManagedMediaPath(input);
  const relativePath = managed.relativePath.split('/').join(path.sep);
  const serverDataRoot = path.resolve(getServerDataRoot());
  const dataUploadsRoot = path.resolve(serverDataRoot, managed.namespace);
  const publicRoot = path.resolve(process.cwd(), 'public', managed.namespace);
  const roots = managed.namespace === 'gallery'
    ? [publicRoot]
    : input.startsWith('/api/serve-upload/')
      ? [dataUploadsRoot, serverDataRoot, publicRoot]
      : [publicRoot, dataUploadsRoot];

  for (const root of roots) {
    signal?.throwIfAborted();
    const candidate = path.resolve(root, relativePath);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) continue;
    try {
      const [resolvedRoot, resolvedCandidate] = await Promise.all([
        realpath(root),
        realpath(candidate),
      ]);
      const relativeCandidate = path.relative(resolvedRoot, resolvedCandidate);
      if (
        !relativeCandidate
        || relativeCandidate === '..'
        || relativeCandidate.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeCandidate)
      ) {
        throw new SafeImageInputError('Managed image resolves outside the allowed media root');
      }
      signal?.throwIfAborted();
      const beforeRead = await stat(resolvedCandidate);
      signal?.throwIfAborted();
      if (!beforeRead.isFile() || beforeRead.size <= 0 || beforeRead.size > maxBytes) {
        throw new SafeImageInputError('Managed image exceeds the size limit');
      }
      const buffer = await readFile(resolvedCandidate, { signal });
      signal?.throwIfAborted();
      if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
        throw new SafeImageInputError('Managed image exceeds the size limit');
      }
      const mimeType = detectImageMimeType(buffer);
      if (!mimeType) throw new SafeImageInputError('Managed file is not a supported image');
      return { buffer, mimeType };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (error instanceof SafeImageInputError) throw error;
    }
  }
  throw new SafeImageInputError('Managed image could not be read');
}

export async function loadSafeImageInput(
  input: string,
  options: SafeImageInputOptions = {},
): Promise<DecodedSafeImage> {
  const value = trimWithoutCopy(input);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  options.signal?.throwIfAborted();

  let image: DecodedSafeImage;
  if (value.startsWith('data:') || options.allowRawBase64 && !/^(?:https?:|\/)/i.test(value)) {
    image = decodeSafeImageInput(value, {
      allowRawBase64: options.allowRawBase64,
      maxBytes,
    });
  } else if (MANAGED_MEDIA_PREFIXES.some(prefix => value.startsWith(prefix))) {
    image = await loadManagedMedia(value, maxBytes, options.signal);
  } else if (value.startsWith('http://') || value.startsWith('https://')) {
    const downloaded = await downloadPublicImage(value, {
      maxBytes,
      timeoutMs: 30_000,
      signal: options.signal,
    });
    const detectedMime = detectImageMimeType(downloaded.buffer);
    if (!detectedMime || detectedMime !== downloaded.mimeType) {
      throw new SafeImageInputError('Remote image MIME does not match its bytes');
    }
    image = { buffer: downloaded.buffer, mimeType: detectedMime };
  } else {
    throw new SafeImageInputError('Image input must use managed media, data URL, or public HTTP(S)');
  }

  return validateDecodedImage(image, { ...options, maxBytes });
}
