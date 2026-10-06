import JSZip, { type JSZipObject } from 'jszip';
import sharp from 'sharp';

import { evaluateRemoveBgOutput } from '@/lib/image-tools/remove-bg-quality';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';
import type { ApiProvider } from '@/lib/universal-api-types';
import { createImageEditProviderCall, type ImageEditProviderCallOptions } from '@/lib/image-edit-provider-boundary';

const DEFAULT_ENDPOINT_PATH = '/v1.0/removebg';
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 8;
const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;

export interface RemoveBgProviderOptions {
  requestProfile: 'removebg-multipart' | 'images-generations';
  imageInput: 'file' | 'url';
  responseMode: 'png' | 'webp' | 'zip';
  endpointPath: string;
  apiKeyHeader: 'X-Api-Key' | 'Authorization';
  transparentOutputRequired: boolean;
  maxInputMegapixels: number;
  zipColorFile: string;
  zipAlphaFile: string;
}

export interface DedicatedRemoveBgResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/webp';
  directUrl?: string;
}

export interface DedicatedRemoveBgRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  execution?: ImageEditProviderCallOptions;
}

export class RemoveBgProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RemoveBgProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeEndpointPath(value: string | undefined): string {
  const candidate = value?.trim();
  if (
    !candidate
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || candidate.includes('\0')
  ) return DEFAULT_ENDPOINT_PATH;
  try {
    const parsed = new URL(candidate, 'https://removebg.invalid');
    if (parsed.origin !== 'https://removebg.invalid' || parsed.pathname.includes('/../')) {
      return DEFAULT_ENDPOINT_PATH;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_ENDPOINT_PATH;
  }
}

function safeZipPath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim().replace(/\\/g, '/');
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) return fallback;
  const segments = candidate.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    return fallback;
  }
  return segments.join('/');
}

export function parseRemoveBgProviderOptions(
  advancedParams: Record<string, string> | undefined,
): RemoveBgProviderOptions {
  const params = advancedParams || {};
  return {
    requestProfile: oneOf(
      params.removeBgRequestProfile,
      ['removebg-multipart', 'images-generations'] as const,
      'images-generations',
    ),
    imageInput: oneOf(params.removeBgImageInput, ['file', 'url'] as const, 'file'),
    responseMode: oneOf(params.removeBgResponseMode, ['png', 'webp', 'zip'] as const, 'png'),
    endpointPath: safeEndpointPath(params.removeBgEndpointPath),
    apiKeyHeader: oneOf(
      params.removeBgApiKeyHeader,
      ['X-Api-Key', 'Authorization'] as const,
      'X-Api-Key',
    ),
    transparentOutputRequired: params.removeBgTransparentOutput !== 'false',
    maxInputMegapixels: boundedInteger(params.removeBgMaxInputMegapixels, 10, 1, 40),
    zipColorFile: safeZipPath(params.removeBgZipColorFile, 'result/color.png'),
    zipAlphaFile: safeZipPath(params.removeBgZipAlphaFile, 'result/alpha.png'),
  };
}

function responseMimeType(response: Response): string {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

async function readBoundedResponse(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_TOO_LARGE', 'RemoveBG response exceeds the size limit');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_RESPONSE_BYTES) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_TOO_LARGE', 'RemoveBG response is empty or exceeds the size limit');
  }
  return buffer;
}

function assertSafeZipEntryName(entry: JSZipObject): string {
  const originalName = entry.unsafeOriginalName || entry.name;
  const normalized = originalName.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP contains an unsafe file path');
  }
  return normalized;
}

interface SizedZipEntry extends JSZipObject {
  _data?: { uncompressedSize?: unknown };
}

function assertBoundedZipEntry(entry: JSZipObject): void {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize;
  if (!Number.isSafeInteger(size) || Number(size) <= 0 || Number(size) > MAX_ZIP_ENTRY_BYTES) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP entry exceeds the size limit');
  }
}

async function decodeZipOutput(
  archive: Buffer,
  options: RemoveBgProviderOptions,
): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive, { createFolders: false });
  } catch (error) {
    throw new RemoveBgProviderError(
      'REMOVE_BG_OUTPUT_INVALID',
      'RemoveBG ZIP could not be decoded safely',
      false,
      { cause: error },
    );
  }
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP has an invalid number of files');
  }
  const byName = new Map<string, JSZipObject>();
  for (const entry of entries) {
    const name = assertSafeZipEntryName(entry);
    assertBoundedZipEntry(entry);
    if (byName.has(name)) {
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP contains duplicate file paths');
    }
    byName.set(name, entry);
  }
  const colorEntry = byName.get(options.zipColorFile);
  const alphaEntry = byName.get(options.zipAlphaFile);
  if (!colorEntry || !alphaEntry || colorEntry === alphaEntry) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP is missing its color or alpha output');
  }

  const [colorBuffer, alphaBuffer] = await Promise.all([
    colorEntry.async('nodebuffer'),
    alphaEntry.async('nodebuffer'),
  ]);
  if (colorBuffer.length > MAX_ZIP_ENTRY_BYTES || alphaBuffer.length > MAX_ZIP_ENTRY_BYTES) {
    throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP output exceeds the size limit');
  }
  try {
    const [colorMetadata, alphaMetadata] = await Promise.all([
      safeSharp(colorBuffer).metadata(),
      safeSharp(alphaBuffer).metadata(),
    ]);
    if (
      !colorMetadata.width
      || !colorMetadata.height
      || colorMetadata.width !== alphaMetadata.width
      || colorMetadata.height !== alphaMetadata.height
    ) {
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP color and alpha dimensions do not match');
    }
    const [color, alpha] = await Promise.all([
      safeSharp(colorBuffer).removeAlpha().raw().toBuffer(),
      safeSharp(alphaBuffer).greyscale().extractChannel(0).raw().toBuffer(),
    ]);
    const pixelCount = colorMetadata.width * colorMetadata.height;
    if (color.length !== pixelCount * 3 || alpha.length !== pixelCount) {
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG ZIP channel data is malformed');
    }
    const rgba = Buffer.allocUnsafe(pixelCount * 4);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const rgbOffset = pixel * 3;
      const rgbaOffset = pixel * 4;
      rgba[rgbaOffset] = color[rgbOffset];
      rgba[rgbaOffset + 1] = color[rgbOffset + 1];
      rgba[rgbaOffset + 2] = color[rgbOffset + 2];
      rgba[rgbaOffset + 3] = alpha[pixel];
    }
    return await sharp(rgba, {
      raw: {
        width: colorMetadata.width,
        height: colorMetadata.height,
        channels: 4,
      },
      failOn: 'error',
      limitInputPixels: 40_000_000,
    })
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof RemoveBgProviderError) throw error;
    throw new RemoveBgProviderError(
      'REMOVE_BG_OUTPUT_INVALID',
      'RemoveBG ZIP images could not be decoded safely',
      false,
      { cause: error },
    );
  }
}

export async function decodeDedicatedRemoveBgResponse(
  response: Response,
  sourceBuffer: Buffer,
  options: RemoveBgProviderOptions,
): Promise<DedicatedRemoveBgResult> {
  const mimeType = responseMimeType(response);
  const payload = await readBoundedResponse(response);
  let output: Buffer;
  let outputMimeType: DedicatedRemoveBgResult['mimeType'];

  if (options.responseMode === 'zip') {
    if (!['application/zip', 'application/x-zip-compressed'].includes(mimeType)) {
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG provider did not return a ZIP response');
    }
    output = await decodeZipOutput(payload, options);
    outputMimeType = 'image/png';
  } else {
    const expectedMime = options.responseMode === 'webp' ? 'image/webp' : 'image/png';
    if (mimeType !== expectedMime) {
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', `RemoveBG provider did not return ${expectedMime}`);
    }
    try {
      const metadata = await safeSharp(payload).metadata();
      const actualMime = metadata.format === 'webp' ? 'image/webp' : metadata.format === 'png' ? 'image/png' : null;
      if (actualMime !== expectedMime) {
        throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG response MIME does not match its bytes');
      }
    } catch (error) {
      if (error instanceof RemoveBgProviderError) throw error;
      throw new RemoveBgProviderError('REMOVE_BG_OUTPUT_INVALID', 'RemoveBG response is not a valid image', false, { cause: error });
    }
    output = payload;
    outputMimeType = expectedMime;
  }

  if (options.transparentOutputRequired) {
    const quality = await evaluateRemoveBgOutput(sourceBuffer, output);
    if (!quality.ok) {
      throw new RemoveBgProviderError(
        'REMOVE_BG_OUTPUT_INVALID',
        `RemoveBG output failed quality validation: ${quality.code || 'UNKNOWN'}`,
      );
    }
  }
  return { buffer: output, mimeType: outputMimeType };
}

function joinEndpoint(baseUrl: string, endpointPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new RemoveBgProviderError('REMOVE_BG_PROVIDER_CONFIG_INVALID', 'RemoveBG provider base URL is invalid');
  }
  return `${base}${endpointPath}`;
}

function providerHeaders(provider: Pick<ApiProvider, 'apiKey'>, options: RemoveBgProviderOptions): Record<string, string> {
  return options.apiKeyHeader === 'Authorization'
    ? { Authorization: `Bearer ${provider.apiKey}` }
    : { 'X-Api-Key': provider.apiKey };
}

export async function submitDedicatedRemoveBg(
  provider: ApiProvider,
  sourceUrl: string,
  requestOptions: DedicatedRemoveBgRequestOptions = {},
): Promise<DedicatedRemoveBgResult> {
  const execution = requestOptions.execution;
  const callerSignal = requestOptions.signal;
  const timeoutMs = requestOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Only the server-owned scalars and parsed settings survive source preparation.
  const snapshot = { id: provider.id, isEnabled: provider.isEnabled, baseUrl: provider.baseUrl, apiKey: provider.apiKey,
    selectedModel: provider.selectedModel || provider.selectedModels?.[0] };
  const options = parseRemoveBgProviderOptions(provider.advancedParams);
  const call = createImageEditProviderCall(execution ? { ...execution, responseMaxBytes: MAX_RESPONSE_BYTES } : undefined,
    snapshot.selectedModel ?? '', 'image');
  let endpoint: string;
  try {
    if (execution && (execution.providerId !== snapshot.id || !snapshot.selectedModel?.trim())) {
      throw new Error('Invalid RemoveBG execution identity');
    }
    if (!snapshot.isEnabled || !snapshot.apiKey.trim()) {
      throw new RemoveBgProviderError('REMOVE_BG_PROVIDER_CONFIG_INVALID', 'RemoveBG provider is disabled or missing its API key');
    }
    endpoint = joinEndpoint(snapshot.baseUrl, options.endpointPath);
    if (execution) new URL(endpoint);
    callerSignal?.throwIfAborted();
  } catch (error) { call.stop(error); throw error; }
  const controller = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
  const timeout = setTimeout(
    () => controller.abort(new RemoveBgProviderError('REMOVE_BG_PROVIDER_TIMEOUT', 'RemoveBG provider request timed out', true)),
    timeoutMs,
  );
  let rejected = false;
  try {
    const source = await loadSafeImageInput(sourceUrl, {
      maxBytes: MAX_SOURCE_BYTES,
      maxPixels: options.maxInputMegapixels * 1_000_000,
      signal,
    });
    signal.throwIfAborted();
    const headers = providerHeaders(snapshot, options);
    let body: BodyInit;
    if (options.requestProfile === 'removebg-multipart') {
      const form = new FormData();
      form.append(
        'image_file',
        new Blob([Uint8Array.from(source.buffer)], { type: source.mimeType }),
        'source-image',
      );
      form.append('size', 'auto');
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      const encoded = `data:${source.mimeType};base64,${source.buffer.toString('base64')}`;
      body = JSON.stringify({
        model: snapshot.selectedModel,
        image: options.imageInput === 'url' && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : encoded,
        response_format: options.responseMode === 'webp' ? 'webp' : 'png',
      });
    }
    const response = await call.transport(endpoint, {
      method: 'POST',
      headers,
      body,
      signal,
      redirect: 'error',
    });
    signal.throwIfAborted();
    if (!response.ok) {
      rejected = true;
      throw new RemoveBgProviderError(
        'REMOVE_BG_PROVIDER_REJECTED',
        `RemoveBG provider returned HTTP ${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    const result = await decodeDedicatedRemoveBgResponse(response, source.buffer, options);
    signal.throwIfAborted();
    if (!execution) return result;
    const { persistAssetBytes } = await import('@/lib/asset-core/binary-persistence');
    const file = await persistAssetBytes({ bytes: result.buffer,
      filename: result.mimeType === 'image/webp' ? 'remove-bg.webp' : 'remove-bg.png', mimeType: result.mimeType, signal });
    signal.throwIfAborted();
    await call.acceptImage({ directUrl: file.url });
    signal.throwIfAborted();
    return { ...result, directUrl: file.url };
  } catch (error) {
    if (!rejected || signal.aborted) call.stop(error);
    if (error instanceof RemoveBgProviderError) throw error;
    if (signal.aborted) {
      const reason = signal.reason;
      if (reason instanceof RemoveBgProviderError) throw reason;
      throw reason instanceof Error ? reason : new RemoveBgProviderError('REMOVE_BG_PROVIDER_ABORTED', 'RemoveBG provider request was cancelled');
    }
    throw new RemoveBgProviderError('REMOVE_BG_PROVIDER_FAILED', 'RemoveBG provider request failed', true, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}
