import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
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
  'application/xml',
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

export async function downloadPublicImage(
  input: string | URL,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    allowedMimeTypes?: readonly string[];
  } = {},
): Promise<DownloadedPublicImage> {
  options.signal?.throwIfAborted();
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeImageDownloadError('Only public HTTP(S) image URLs are allowed');
  }
  if (url.username || url.password) {
    throw new SafeImageDownloadError('Credentials in image URLs are not allowed');
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  options.signal?.throwIfAborted();
  const allowCozeEgressProxy = Boolean(
    process.env.COZE_PROJECT_ENV?.trim()
    || process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim(),
  );
  if (
    addresses.length === 0
    || addresses.some(({ address }) => !isAllowedRemoteImageAddress(
      url.hostname,
      address,
      { allowCozeEgressProxy },
    ))
  ) {
    throw new SafeImageDownloadError('The image host resolves to a private or reserved address');
  }
  const pinned = addresses[0];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const acceptedMimeTypes = options.allowedMimeTypes
    ? options.allowedMimeTypes.filter(type => SAFE_REMOTE_ASSET_MIME_TYPES.has(type.trim().toLowerCase()))
    : [...IMAGE_MIME_TYPES];
  if (acceptedMimeTypes.length === 0) {
    throw new SafeImageDownloadError('No supported remote asset MIME types were requested');
  }

  return new Promise<DownloadedPublicImage>((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method: 'GET',
      headers: {
        Accept: acceptedMimeTypes.join(','),
        'User-Agent': 'WujieAI-SafeImageDownloader/1.0',
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
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new SafeImageDownloadError('Remote image redirects are not allowed'));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new SafeImageDownloadError(`Remote image returned HTTP ${status}`));
        return;
      }
      const mimeType = (response.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!isAllowedRemoteMimeType(mimeType, acceptedMimeTypes)) {
        response.resume();
        reject(new SafeImageDownloadError('Remote response is not an allowed image type'));
        return;
      }
      const declaredBytes = Number(response.headers['content-length'] || 0);
      if (declaredBytes > maxBytes) {
        response.resume();
        reject(new SafeImageDownloadError('Remote image exceeds the size limit'));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          req.destroy(new SafeImageDownloadError('Remote image exceeds the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (receivedBytes === 0) {
          reject(new SafeImageDownloadError('Remote image is empty'));
          return;
        }
        resolve({ buffer: Buffer.concat(chunks), mimeType });
      });
    });

    const abortRequest = () => {
      req.destroy(options.signal?.reason instanceof Error
        ? options.signal.reason
        : new SafeImageDownloadError('Remote image download was aborted'));
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
      options.signal?.removeEventListener('abort', abortRequest);
      reject(error instanceof SafeImageDownloadError
        ? error
        : new SafeImageDownloadError('Remote image download failed', { cause: error }));
    });
    req.on('close', () => {
      options.signal?.removeEventListener('abort', abortRequest);
    });
    req.end();
  });
}
