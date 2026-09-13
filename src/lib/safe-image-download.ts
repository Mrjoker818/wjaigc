import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const SAFE_REMOTE_ASSET_MIME_TYPES = new Set([
  ...IMAGE_MIME_TYPES,
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'application/json',
  'application/octet-stream',
  'application/x-zip-compressed',
  'application/zip',
  'application/x-photoshop',
  'application/xml',
  'image/vnd.adobe.photoshop',
  'image/svg+xml',
  'text/xml',
]);

export class SafeImageDownloadError extends Error {
  readonly code = 'UNSAFE_REMOTE_IMAGE';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SafeImageDownloadError';
  }
}

export interface DownloadedPublicImage {
  buffer: Buffer;
  mimeType: string;
}

export interface DownloadPublicImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  allowedMimeTypes?: readonly string[];
  rangeChunkBytes?: number;
  authorizationHeader?: string;
  authorizationHost?: string;
  maxBytesByMimeType?: Readonly<Record<string, number>>;
}

export function isAllowedRemoteMimeType(
  mimeType: string,
  allowedMimeTypes?: readonly string[],
): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!SAFE_REMOTE_ASSET_MIME_TYPES.has(normalized)) return false;
  if (!allowedMimeTypes) return IMAGE_MIME_TYPES.has(normalized);
  return allowedMimeTypes.some(value => value.trim().toLowerCase() === normalized);
}

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4
    || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(normalized);
  if (family === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return false;
    const blockedRanges: Array<[string, number]> = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    return !blockedRanges.some(([base, prefix]) => inIpv4Range(value, base, prefix));
  }
  if (family !== 6) return false;

  if (normalized.startsWith('::ffff:')) return false;
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  return !(
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
  ) && firstHextet >= 0x2000 && firstHextet <= 0x3fff;
}

export function isAllowedRemoteImageAddress(
  hostname: string,
  address: string,
  options: { allowCozeEgressProxy?: boolean } = {},
): boolean {
  if (isPublicIpAddress(address)) return true;
  if (!options.allowCozeEgressProxy || isIP(hostname) !== 0) return false;

  const value = ipv4Number(address);
  return value !== null && inIpv4Range(value, '198.18.0.0', 15);
}

interface RemoteLookupAddress {
  address: string;
  family: number;
}

export function selectAllowedRemoteAddress<T extends RemoteLookupAddress>(
  hostname: string,
  addresses: readonly T[],
  options: { allowCozeEgressProxy?: boolean } = {},
): T | undefined {
  return addresses.find(({ address }) => isAllowedRemoteImageAddress(
    hostname,
    address,
    options,
  ));
}

export async function downloadPublicImage(
  input: string | URL,
  options: DownloadPublicImageOptions = {},
): Promise<DownloadedPublicImage> {
  options.signal?.throwIfAborted();
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeImageDownloadError('Only public HTTP(S) image URLs are allowed');
  }
  if (url.username || url.password) {
    throw new SafeImageDownloadError('Credentials in image URLs are not allowed');
  }
  const authorizationHeader = options.authorizationHeader?.trim();
  const authorizationHost = options.authorizationHost?.trim().toLowerCase();
  if (authorizationHeader || authorizationHost) {
    if (!authorizationHeader || !authorizationHost || url.hostname.toLowerCase() !== authorizationHost) {
      throw new SafeImageDownloadError('Remote authorization host does not match the request URL');
    }
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  options.signal?.throwIfAborted();
  const allowCozeEgressProxy = Boolean(
    process.env.COZE_PROJECT_ENV?.trim()
    || process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim(),
  );
  const pinned = selectAllowedRemoteAddress(
    url.hostname,
    addresses,
    { allowCozeEgressProxy },
  );
  if (!pinned) {
    throw new SafeImageDownloadError('The image host resolves to a private or reserved address');
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const acceptedMimeTypes = options.allowedMimeTypes
    ? options.allowedMimeTypes.filter(type => SAFE_REMOTE_ASSET_MIME_TYPES.has(type.trim().toLowerCase()))
    : [...IMAGE_MIME_TYPES];
  if (acceptedMimeTypes.length === 0) {
    throw new SafeImageDownloadError('No supported remote asset MIME types were requested');
  }

  const requestOnce = (
    headers: Record<string, string> = {},
    rangeResponseLimit = maxBytes,
    expectedStatus?: number,
  ): Promise<DownloadedPublicImage & {
    statusCode: number;
    headers: IncomingHttpHeaders;
  }> => new Promise((resolve, reject) => {
    let settled = false;
    let abortRequest = () => {};
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abortRequest);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (downloaded: DownloadedPublicImage & {
      statusCode: number;
      headers: IncomingHttpHeaders;
    }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(downloaded);
    };
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method: 'GET',
      headers: {
        Accept: acceptedMimeTypes.join(','),
        'User-Agent': 'WujieAI-SafeImageDownloader/1.0',
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        ...headers,
      },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, [pinned]);
          return;
        }
        callback(null, pinned.address, pinned.family);
      },
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (response) => {
      const status = response.statusCode || 0;
      if (expectedStatus !== undefined && status !== expectedStatus) {
        response.destroy();
        rejectOnce(new SafeImageDownloadError(
          `Remote range request returned HTTP ${status} instead of ${expectedStatus}`,
        ));
        return;
      }
      if (status >= 300 && status < 400) {
        response.resume();
        rejectOnce(new SafeImageDownloadError('Remote image redirects are not allowed'));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        rejectOnce(new SafeImageDownloadError(`Remote image returned HTTP ${status}`));
        return;
      }
      const mimeType = (response.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!isAllowedRemoteMimeType(mimeType, acceptedMimeTypes)) {
        response.resume();
        rejectOnce(new SafeImageDownloadError('Remote response is not an allowed image type'));
        return;
      }
      const declaredBytes = Number(response.headers['content-length'] || 0);
      const mimeLimit = options.maxBytesByMimeType?.[mimeType];
      const responseLimit = Math.min(
        status === 206 ? rangeResponseLimit : maxBytes,
        Number.isSafeInteger(mimeLimit) && Number(mimeLimit) > 0 ? Number(mimeLimit) : maxBytes,
      );
      if (declaredBytes > responseLimit) {
        response.resume();
        rejectOnce(new SafeImageDownloadError('Remote image exceeds the size limit'));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      const rejectInterrupted = (cause?: Error) => {
        rejectOnce(new SafeImageDownloadError(
          'Remote image download was interrupted',
          cause ? { cause } : undefined,
        ));
      };
      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > responseLimit) {
          const error = new SafeImageDownloadError('Remote image exceeds the size limit');
          rejectOnce(error);
          req.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('aborted', () => rejectInterrupted());
      response.on('error', (error) => rejectInterrupted(error));
      response.on('close', () => {
        if (!response.complete && !response.readableEnded) rejectInterrupted();
      });
      response.on('end', () => {
        if (declaredBytes > 0 && receivedBytes !== declaredBytes) {
          rejectInterrupted();
          return;
        }
        if (receivedBytes === 0) {
          rejectOnce(new SafeImageDownloadError('Remote image is empty'));
          return;
        }
        resolveOnce({
          buffer: Buffer.concat(chunks),
          mimeType,
          statusCode: status,
          headers: response.headers,
        });
      });
    });

    abortRequest = () => {
      const error = options.signal?.reason instanceof Error
        ? options.signal.reason
        : new SafeImageDownloadError('Remote image download was aborted');
      rejectOnce(error);
      req.destroy(error);
    };
    options.signal?.addEventListener('abort', abortRequest, { once: true });
    if (options.signal?.aborted) {
      abortRequest();
      return;
    }

    req.setTimeout(timeoutMs, () => {
      req.destroy(new SafeImageDownloadError('Remote image download timed out'));
    });
    req.on('error', (error) => {
      rejectOnce(error instanceof SafeImageDownloadError
        ? error
        : new SafeImageDownloadError('Remote image download failed', { cause: error }));
    });
    req.on('close', cleanup);
    req.end();
  });

  if (options.rangeChunkBytes === undefined) {
    const downloaded = await requestOnce();
    return { buffer: downloaded.buffer, mimeType: downloaded.mimeType };
  }

  const rangeChunkBytes = options.rangeChunkBytes;
  if (!Number.isSafeInteger(rangeChunkBytes) || rangeChunkBytes <= 0) {
    throw new SafeImageDownloadError('Range chunk size must be a positive integer');
  }

  let offset = 0;
  let totalBytes: number | undefined;
  let output: Buffer | undefined;
  let mimeType: string | undefined;
  let validator: string | undefined;
  while (totalBytes === undefined || offset < totalBytes) {
    options.signal?.throwIfAborted();
    const requestedEnd = Math.min(offset + rangeChunkBytes - 1, maxBytes - 1);
    const headers: Record<string, string> = {
      Range: `bytes=${offset}-${requestedEnd}`,
    };
    if (validator) headers['If-Range'] = validator;
    const downloaded = await requestOnce(headers, rangeChunkBytes, 206);

    const contentRange = String(downloaded.headers['content-range'] || '');
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (!match) {
      throw new SafeImageDownloadError('Remote range response has an invalid Content-Range');
    }
    const responseStart = Number(match[1]);
    const responseEnd = Number(match[2]);
    const responseTotal = Number(match[3]);
    const responseBytes = responseEnd - responseStart + 1;
    const expectedResponseEnd = Math.min(requestedEnd, responseTotal - 1);
    if (
      responseStart !== offset
      || responseEnd < responseStart
      || responseEnd !== expectedResponseEnd
      || responseEnd >= responseTotal
      || responseBytes !== downloaded.buffer.length
    ) {
      throw new SafeImageDownloadError('Remote range response does not match the requested bytes');
    }
    if (!Number.isSafeInteger(responseTotal) || responseTotal <= 0 || responseTotal > maxBytes) {
      throw new SafeImageDownloadError('Remote image exceeds the size limit');
    }

    const responseEtag = Array.isArray(downloaded.headers.etag)
      ? downloaded.headers.etag[0]
      : downloaded.headers.etag;
    const responseLastModified = Array.isArray(downloaded.headers['last-modified'])
      ? downloaded.headers['last-modified'][0]
      : downloaded.headers['last-modified'];
    const responseValidator = responseEtag && !responseEtag.startsWith('W/')
      ? responseEtag
      : responseLastModified;

    if (totalBytes === undefined) {
      totalBytes = responseTotal;
      output = Buffer.allocUnsafe(totalBytes);
      mimeType = downloaded.mimeType;
      validator = responseValidator;
      if (responseEnd + 1 < totalBytes && !validator) {
        throw new SafeImageDownloadError('Remote range response has no stable validator');
      }
    } else if (
      responseTotal !== totalBytes
      || downloaded.mimeType !== mimeType
      || responseValidator !== validator
    ) {
      throw new SafeImageDownloadError('Remote asset changed during range download');
    }

    downloaded.buffer.copy(output as Buffer, responseStart);
    offset = responseEnd + 1;
  }

  return { buffer: output as Buffer, mimeType: mimeType as string };
}
