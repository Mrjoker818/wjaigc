import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const httpsRequestMock = vi.hoisted(() => vi.fn());
const lookupMock = vi.hoisted(() => vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]));

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));
vi.mock('node:https', () => ({ request: httpsRequestMock }));

import {
  downloadPublicImage,
  isAllowedRemoteImageAddress,
  isAllowedRemoteMimeType,
  isPublicIpAddress,
  selectAllowedRemoteAddress,
} from '@/lib/safe-image-download';

interface MockHttpsResponse {
  statusCode: number;
  headers?: IncomingMessage['headers'];
  body?: Buffer;
  abortAfterBody?: boolean;
  beforeEnd?: () => void;
}

function mockHttpsResponses(
  responder: (options: RequestOptions) => MockHttpsResponse,
): void {
  httpsRequestMock.mockImplementation((
    _url: URL,
    requestOptions: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    const request = new EventEmitter() as EventEmitter & {
      destroy: (error?: Error) => void;
      end: () => void;
      setTimeout: (milliseconds: number, listener: () => void) => ClientRequest;
    };
    request.destroy = (error?: Error) => {
      if (error) queueMicrotask(() => request.emit('error', error));
    };
    request.setTimeout = () => request as unknown as ClientRequest;
    request.end = () => {
      const mocked = responder(requestOptions);
      const response = new PassThrough() as PassThrough & IncomingMessage;
      response.statusCode = mocked.statusCode;
      response.headers = mocked.headers || {};
      callback(response);
      if (mocked.body) response.write(mocked.body);
      if (mocked.abortAfterBody) {
        response.emit('aborted');
        response.emit('close');
        return;
      }
      mocked.beforeEnd?.();
      response.end();
    };
    return request as unknown as ClientRequest;
  });
}

describe('safe remote image download transport', () => {
  it('ends an outstanding DNS lookup when the overall deadline aborts', async () => {
    lookupMock.mockImplementationOnce(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = downloadPublicImage('https://cdn.example.com/hanging-dns.png', { signal: controller.signal });
    controller.abort(new Error('dns deadline'));
    const outcome = await Promise.race([
      pending.then(() => 'resolved', error => error instanceof Error ? error.message : 'unknown'),
      new Promise<string>(resolve => setTimeout(() => resolve('pending'), 50)),
    ]);
    expect(outcome).toBe('dns deadline');
  });

  it('permits a missing Content-Type only under explicit octet-stream opt-in', async () => {
    const bytes = Buffer.from('opaque bytes');
    mockHttpsResponses(() => ({ statusCode: 200, body: bytes }));
    await expect(downloadPublicImage('https://cdn.example.com/image')).rejects.toThrow();
    await expect(downloadPublicImage('https://cdn.example.com/image', {
      allowedMimeTypes: ['application/octet-stream'],
      allowMissingContentTypeAsOctetStream: true,
    })).resolves.toEqual({ buffer: bytes, mimeType: 'application/octet-stream' });
  });

  it('rejects an undeclared response as soon as streamed bytes exceed the supplied budget', async () => {
    mockHttpsResponses(() => ({ statusCode: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('12345') }));
    await expect(downloadPublicImage('https://cdn.example.com/image.png', { maxBytes: 4 }))
      .rejects.toThrow('size limit');
  });

  it.each(['video/x-msvideo', 'video/x-matroska'])(
    'keeps a previously supported %s source-map recovery behind explicit MIME opt-in', async (mimeType): Promise<void> => {
      const bytes = mimeType === 'video/x-msvideo' ? Buffer.from('RIFF0000AVI ') : Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      mockHttpsResponses(() => ({ statusCode: 200, headers: { 'content-type': mimeType }, body: bytes }));
      await expect(downloadPublicImage('https://cdn.example.com/media', { allowedMimeTypes: [mimeType] }))
        .resolves.toEqual({ buffer: bytes, mimeType });
    },
  );
  it('downloads BMP bytes only with explicit opt-in and still enforces actual stream size', async (): Promise<void> => {
    const bmp = Buffer.alloc(58);
    bmp.write('BM'); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
    mockHttpsResponses(() => ({ statusCode: 200, headers: { 'content-type': 'image/bmp' }, body: bmp }));
    expect(isAllowedRemoteMimeType('image/bmp')).toBe(false);
    await expect(downloadPublicImage('https://cdn.example.com/a.bmp')).rejects.toThrow();
    expect((await downloadPublicImage('https://cdn.example.com/a.bmp', { allowedMimeTypes: ['image/bmp'] })).buffer).toEqual(bmp);
    await expect(downloadPublicImage('https://cdn.example.com/a.bmp', { allowedMimeTypes: ['image/bmp'], maxBytes: 20 })).rejects.toThrow();
  });
  it('sends credentials only to the exact explicitly authorized hostname', async () => {
    const observedAuthorization: Array<string | undefined> = [];
    mockHttpsResponses((requestOptions) => {
      const headers = requestOptions.headers as Record<string, string>;
      observedAuthorization.push(headers.Authorization);
      return {
        statusCode: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '12' },
        body: Buffer.from('0000ftypisom'),
      };
    });

    await expect(downloadPublicImage('https://video.example.com/content', {
      allowedMimeTypes: ['video/mp4'],
      authorizationHeader: 'Bearer secret',
      authorizationHost: 'video.example.com',
    })).resolves.toMatchObject({ mimeType: 'video/mp4' });
    expect(observedAuthorization).toEqual(['Bearer secret']);

    await expect(downloadPublicImage('https://cdn.example.com/content', {
      allowedMimeTypes: ['video/mp4'],
      authorizationHeader: 'Bearer secret',
      authorizationHost: 'video.example.com',
    })).rejects.toThrow(/authorization host/i);
  });

  it('downloads a slow remote artifact through bounded sequential range requests', async () => {
    const payload = Buffer.from('0123456789ab');
    const observedRanges: string[] = [];
    const observedIfRanges: Array<string | undefined> = [];
    mockHttpsResponses((requestOptions) => {
      const headers = requestOptions.headers as Record<string, string> | undefined;
      const range = headers?.Range || headers?.range;
      if (!range) return { statusCode: 504 };
      observedRanges.push(range);
      observedIfRanges.push(headers?.['If-Range']);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(match?.[1] ?? -1);
      const requestedEnd = Number(match?.[2] ?? -1);
      const end = Math.min(requestedEnd, payload.length - 1);
      const body = payload.subarray(start, end + 1);
      return {
        statusCode: match ? 206 : 416,
        headers: match ? {
          'content-length': String(body.length),
          'content-range': `bytes ${start}-${end}/${payload.length}`,
          'content-type': 'application/zip',
          etag: '"pear-artifact-v1"',
        } : {},
        body: match ? body : undefined,
      };
    });

    await expect(downloadPublicImage(
      'https://cdn.pearapi.ai/result.zip',
      {
        maxBytes: 32,
        rangeChunkBytes: 4,
        allowedMimeTypes: ['application/zip'],
      },
    )).resolves.toEqual({
      buffer: payload,
      mimeType: 'application/zip',
    });
    expect(observedRanges).toEqual([
      'bytes=0-3',
      'bytes=4-7',
      'bytes=8-11',
    ]);
    expect(observedIfRanges).toEqual([
      undefined,
      '"pear-artifact-v1"',
      '"pear-artifact-v1"',
    ]);
  });

  it('rejects a range whose end exceeds the declared artifact size', async () => {
    mockHttpsResponses(() => ({
      statusCode: 206,
      headers: {
          'content-length': '4',
          'content-range': 'bytes 0-3/3',
          'content-type': 'application/zip',
          etag: '"invalid-total"',
      },
      body: Buffer.from('abcd'),
    }));

    await expect(downloadPublicImage(
      'https://cdn.pearapi.ai/result.zip',
      {
        maxBytes: 32,
        rangeChunkBytes: 4,
        allowedMimeTypes: ['application/zip'],
      },
    )).rejects.toThrow(/range response/i);
  });

  it('rejects a server that ignores an explicitly requested byte range', async () => {
    mockHttpsResponses(() => ({
      statusCode: 200,
      headers: {
        'content-length': '12',
        'content-type': 'application/zip',
      },
      body: Buffer.from('0123456789ab'),
    }));

    await expect(downloadPublicImage(
      'https://cdn.pearapi.ai/result.zip',
      {
        maxBytes: 32,
        rangeChunkBytes: 4,
        allowedMimeTypes: ['application/zip'],
      },
    )).rejects.toThrow(/range/i);
  });

  it('rejects a shortened non-final range instead of issuing unbounded requests', async () => {
    const payload = Buffer.from('0123456789ab');
    let requests = 0;
    mockHttpsResponses((requestOptions) => {
      requests += 1;
      const headers = requestOptions.headers as Record<string, string>;
      const match = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
      const start = Number(match?.[1] ?? 0);
      return {
        statusCode: 206,
        headers: {
          'content-length': '1',
          'content-range': `bytes ${start}-${start}/${payload.length}`,
          'content-type': 'application/zip',
          etag: '"short-range"',
        },
        body: payload.subarray(start, start + 1),
      };
    });

    await expect(downloadPublicImage(
      'https://cdn.pearapi.ai/result.zip',
      {
        maxBytes: 32,
        rangeChunkBytes: 4,
        allowedMimeTypes: ['application/zip'],
      },
    )).rejects.toThrow(/range response/i);
    expect(requests).toBe(1);
  });

  it('rejects when the response body aborts before the declared range completes', async () => {
    mockHttpsResponses(() => ({
      statusCode: 206,
      headers: {
        'content-length': '4',
        'content-range': 'bytes 0-3/4',
        'content-type': 'application/zip',
        etag: '"aborted-range"',
      },
      body: Buffer.from('01'),
      abortAfterBody: true,
    }));

    const outcome = await Promise.race([
      downloadPublicImage(
        'https://cdn.pearapi.ai/result.zip',
        {
          maxBytes: 32,
          rangeChunkBytes: 4,
          allowedMimeTypes: ['application/zip'],
        },
      ).then(() => 'resolved', () => 'rejected'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);
    expect(outcome).toBe('rejected');
  });

  it('keeps an abort racing with response end from being reported as success', async () => {
    const controller = new AbortController();
    mockHttpsResponses(() => ({
      statusCode: 200,
      headers: {
        'content-length': '4',
        'content-type': 'image/png',
      },
      body: Buffer.from('data'),
      beforeEnd: () => controller.abort(new Error('cancelled by user')),
    }));

    await expect(downloadPublicImage(
      'https://cdn.example.com/image.png',
      { signal: controller.signal },
    )).rejects.toThrow('cancelled by user');
  });
});

describe('safe remote image download address policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '100.64.1.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('rejects private or reserved address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it('allows the Coze transparent egress proxy only for a domain name', () => {
    expect(isAllowedRemoteImageAddress(
      'images.unsplash.com',
      '198.18.0.241',
      { allowCozeEgressProxy: true },
    )).toBe(true);
    expect(isAllowedRemoteImageAddress(
      '198.18.0.241',
      '198.18.0.241',
      { allowCozeEgressProxy: true },
    )).toBe(false);
  });

  it('keeps the Coze proxy range blocked outside the Coze runtime', () => {
    expect(isAllowedRemoteImageAddress(
      'images.unsplash.com',
      '198.18.0.241',
      { allowCozeEgressProxy: false },
    )).toBe(false);
  });

  it('pins an allowed Coze proxy address when DNS also returns an unusable private IPv6 address', () => {
    expect(selectAllowedRemoteAddress(
      'cdn.pearapi.ai',
      [
        { address: '198.18.1.22', family: 4 },
        { address: 'fdfe:dcba:9876::f8', family: 6 },
      ],
      { allowCozeEgressProxy: true },
    )).toEqual({ address: '198.18.1.22', family: 4 });
  });

  it('keeps SVG blocked by default and allows it only through an explicit safe allowlist', () => {
    expect(isAllowedRemoteMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedRemoteMimeType('image/svg+xml', ['image/svg+xml'])).toBe(true);
    expect(isAllowedRemoteMimeType('text/html', ['text/html'])).toBe(false);
  });

  it('keeps PSD blocked by default and allows it only through an explicit safe allowlist', () => {
    expect(isAllowedRemoteMimeType('image/vnd.adobe.photoshop')).toBe(false);
    expect(isAllowedRemoteMimeType(
      'image/vnd.adobe.photoshop',
      ['image/vnd.adobe.photoshop'],
    )).toBe(true);
    expect(isAllowedRemoteMimeType(
      'application/octet-stream',
      ['application/octet-stream'],
    )).toBe(true);
  });

  it.each([
    'application/zip',
    'application/x-zip-compressed',
  ])('allows Pear ZIP artifacts only through an explicit safe allowlist: %s', (mimeType) => {
    expect(isAllowedRemoteMimeType(mimeType)).toBe(false);
    expect(isAllowedRemoteMimeType(mimeType, [mimeType])).toBe(true);
  });

  it.each([
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
  ])('allows video artifacts only through an explicit safe allowlist: %s', (mimeType) => {
    expect(isAllowedRemoteMimeType(mimeType)).toBe(false);
    expect(isAllowedRemoteMimeType(mimeType, [mimeType])).toBe(true);
  });
});
