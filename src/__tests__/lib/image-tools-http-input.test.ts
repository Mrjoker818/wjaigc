import { createServer, type Server, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const limit = vi.hoisted(() => ({ megabytes: 1 }));
vi.mock('@/lib/image-tools/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/image-tools/config')>(),
  get IMAGE_MAX_SIZE_MB() { return limit.megabytes; },
}));

import { readImageToBuffer } from '@/lib/image-tools/image-input';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
type Outcome = { error: string } | { value: Awaited<ReturnType<typeof readImageToBuffer>> };

async function bounded<T>(pending: Promise<T>): Promise<T | 'OBSERVATION_STUCK'> {
  const controller = new AbortController();
  try {
    return await Promise.race([
      pending,
      delay(2000, 'OBSERVATION_STUCK' as const, { signal: controller.signal }),
    ]);
  } finally {
    controller.abort();
  }
}

describe('HTTP image input resource bounds', () => {
  let server: Server | undefined;
  const pending: Promise<unknown>[] = [];

  async function serve(handler: (response: ServerResponse) => void): Promise<string> {
    server = createServer((_request, response) => handler(response));
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture port');
    return `http://127.0.0.1:${address.port}/image`;
  }

  function read(url: string): Promise<Outcome> {
    const task = readImageToBuffer(url);
    const observed = task.then(value => ({ value }), (error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    pending.push(observed);
    return observed;
  }

  afterEach(async () => {
    vi.useRealTimers();
    limit.megabytes = 1;
    if (server) {
      const closed = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      expect(await bounded(closed)).not.toBe('OBSERVATION_STUCK');
      server = undefined;
    }
    expect(await bounded(Promise.all(pending.splice(0)))).not.toBe('OBSERVATION_STUCK');
  });

  // 本地推理并发闸（withLocalInferenceLock）已随本地模型移除；
  // 原 stall+permit 释放测试随之删除。

  it.each(['declared', 'chunked'] as const)('rejects oversized %s input before the server finishes and closes its connection', async mode => {
    let peerClosed!: () => void;
    const closed = new Promise<void>(resolve => { peerClosed = resolve; });
    const url = await serve(response => {
      response.once('close', peerClosed);
      response.writeHead(200, {
        'Content-Type': 'image/png',
        ...(mode === 'declared' ? { 'Content-Length': 2 * 1024 * 1024 } : {}),
      });
      response.write(mode === 'declared' ? PNG : Buffer.alloc(1024 * 1024 + 1));
      // Deliberately never end: a post-arrayBuffer size check cannot pass this test.
    });
    expect(await bounded(read(url))).toEqual({ error: expect.stringMatching(/超过限制/) });
    expect(await bounded(closed)).not.toBe('OBSERVATION_STUCK');
  });

  it('preserves real HTTP PNG bytes and decoded dimensions', async () => {
    const url = await serve(response => response.end(PNG));
    expect(await bounded(read(url))).toEqual({ value: { buffer: PNG, width: 1, height: 1, format: 'png' } });
  });

  it('rejects an invalid byte-limit configuration before making a real HTTP request', async () => {
    let requests = 0;
    const url = await serve(response => { requests += 1; response.end(PNG); });
    limit.megabytes = Number.NaN;
    expect(await bounded(read(url))).toEqual({ error: expect.stringMatching(/限制配置无效/) });
    expect(requests).toBe(0);
  });

  it('preserves a failed HTTP status without draining an unfinished error body', async () => {
    let peerClosed!: () => void;
    const closed = new Promise<void>(resolve => { peerClosed = resolve; });
    const url = await serve(response => {
      response.once('close', peerClosed);
      response.writeHead(503);
      response.write('unavailable');
    });
    expect(await bounded(read(url))).toEqual({ error: '无法下载图片: 503' });
    expect(await bounded(closed)).not.toBe('OBSERVATION_STUCK');
  });
});
