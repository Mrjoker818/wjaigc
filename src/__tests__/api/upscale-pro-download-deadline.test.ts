import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { setTimeout as nativeTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Authentication and provider discovery are outside this download contract.
// No real provider, model interpreter, database, or user file is accessed.
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<{ userId: string }> => ({ userId: 'download-fixture' }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({}),
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: async (): Promise<unknown[]> => [] }));
vi.mock('@/lib/quality-enhance', () => ({ enhanceViaAI: async (): Promise<never> => { throw new Error('Unexpected AI call'); } }));
vi.mock('@/lib/image-tools/config', () => ({ UPSCALE_OUTPUT_DIR: '', UPSCALE_OUTPUT_URL_PREFIX: '' }));

import { POST } from '@/app/api/image/upscale-pro/route';

async function bounded<T>(pending: Promise<T>, milliseconds = 5500): Promise<T | 'OBSERVATION_STUCK'> {
  const watchdog = new AbortController();
  try {
    return await Promise.race([pending, delay(milliseconds, 'OBSERVATION_STUCK' as const, { signal: watchdog.signal })]);
  } finally { watchdog.abort(); }
}

describe('upscale-pro ONNX input download lifetime', () => {
  let server: Server | undefined;
  const pending: Promise<unknown>[] = [];

  afterEach(async (): Promise<void> => {
    try {
      if (server) {
        const owned = server;
        const closed = new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve()));
        owned.closeAllConnections();
        expect(await bounded(closed)).not.toBe('OBSERVATION_STUCK');
        server = undefined;
      }
      // A failed assertion must still drain the real fetch and retry promises.
      expect(await bounded(Promise.allSettled(pending.splice(0)))).not.toBe('OBSERVATION_STUCK');
    } finally {
      vi.restoreAllMocks();
      syncBuiltinESMExports();
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['relative', 'headers'], ['relative', 'body'],
    ['remote', 'headers'], ['remote', 'body'],
  ] as const)('bounds %s image download when %s stalls and closes the real peer', async (mode, phase): Promise<void> => {
    const exists = fs.existsSync;
    const readdir = fs.readdirSync;
    vi.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === path.resolve('scripts/upscale_onnx.py') || exists(file));
    vi.spyOn(fs, 'readdirSync').mockImplementation(((...args: Parameters<typeof readdir>): ReturnType<typeof readdir> | string[] => (
      String(args[0]) === path.resolve('onnx-models') ? ['realesrgan-x4plus-fp16.onnx'] : readdir(...args)
    )) as typeof readdir);
    // The route dynamically imports named fs exports. The default-object spy
    // must reach that namespace even when the diagnostic guard preloaded fs.
    syncBuiltinESMExports();
    // Shorten only the production download budget; networking and body reads stay real.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: Parameters<typeof nativeTimeout>[0], milliseconds?: number, ...args: unknown[]): ReturnType<typeof nativeTimeout> | number => (
      nativeTimeout(callback, milliseconds === 30_000 ? 300 : milliseconds, ...args)
    )) as typeof globalThis.setTimeout);

    let requests = 0;
    let closedPeers = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.once('close', () => { closedPeers += 1; });
      if (phase === 'body') {
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.write(Buffer.from([137, 80, 78, 71]));
      }
      // Deliberately do not end: returning headers is not a completed download.
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    vi.stubEnv('DEPLOY_RUN_PORT', String(address.port));
    // Keep the route's SSRF validator intact. Only this test-owned public-shaped
    // URL is transported to the loopback peer; response bodies remain native.
    const actualFetch = globalThis.fetch;
    const fixtureUrl = 'https://upscale-download-fixture.example/image.png';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === fixtureUrl) return actualFetch(`http://127.0.0.1:${address.port}/image.png`, init);
      if (url === `http://localhost:${address.port}/api/serve-upload/image.png`) return actualFetch(input, init);
      throw new Error('Unexpected request outside owned HTTP fixture');
    });
    const imageUrl = mode === 'relative' ? '/api/serve-upload/image.png' : fixtureUrl;
    const task = POST(new NextRequest(`http://127.0.0.1:${address.port}/api/image/upscale-pro`, {
      method: 'POST', body: JSON.stringify({ imageUrl, fallbackToAi: false, skipAiEnhance: true }),
      headers: { 'Content-Type': 'application/json' },
    }));
    pending.push(task);
    const outcome = await bounded(task);
    expect(outcome).not.toBe('OBSERVATION_STUCK');
    if (outcome === 'OBSERVATION_STUCK') return;
    expect(outcome.status).toBe(502);
    expect(await outcome.json()).toMatchObject({ success: false });
    expect(requests).toBe(mode === 'relative' ? 1 : 3);
    // Observe peer close without issuing fixture cleanup first.
    const peerDeadline = Date.now() + 500;
    while (closedPeers < requests && Date.now() < peerDeadline) await delay(5);
    expect(closedPeers).toBe(requests);
  }, 15_000);
});
