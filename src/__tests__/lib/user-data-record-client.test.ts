import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendUserDataRecord } from '@/lib/user-data-record-client';

afterEach(() => {
  vi.useRealTimers();
});

describe('sendUserDataRecord', () => {
  it('uses a navigation-safe beacon for small keepalive audit records', async () => {
    const fetcher = vi.fn();
    const beacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);

    await sendUserDataRecord({
      requestBody: '{"type":"autosave"}',
      keepalive: true,
      fetcher,
      beacon,
    });

    expect(beacon).toHaveBeenCalledOnce();
    expect(beacon.mock.calls[0]?.[0]).toBe('/api/user-data/record');
    expect(beacon.mock.calls[0]?.[1]).toBeInstanceOf(Blob);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to the bounded fetch when the beacon queue rejects the record', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    await sendUserDataRecord({
      requestBody: '{"type":"autosave"}',
      keepalive: true,
      fetcher,
      beacon: () => false,
    });

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts a hung activity request at the bounded timeout', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
      });
    });
    let rejection: unknown;
    const send = sendUserDataRecord as unknown as (options: {
      requestBody: string;
      keepalive: boolean;
      timeoutMs: number;
      fetcher: typeof fetcher;
    }) => Promise<void>;

    void send({
      requestBody: '{"type":"autosave"}',
      keepalive: true,
      timeoutMs: 50,
      fetcher,
    }).catch(error => { rejection = error; });
    await vi.advanceTimersByTimeAsync(51);

    expect(requestSignal?.aborted).toBe(true);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('timed out');
  });
});
