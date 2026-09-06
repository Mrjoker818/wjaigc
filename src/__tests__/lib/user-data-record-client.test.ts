import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  sendUserDataRecord,
  type UserDataRecordFetcher,
} from '@/lib/user-data-record-client';

afterEach(() => {
  vi.useRealTimers();
});

describe('sendUserDataRecord', () => {
  it('uses a response-aware keepalive request before falling back to beacon', async () => {
    const fetcher = vi.fn<UserDataRecordFetcher>(async () => new Response(null, { status: 200 }));
    const beacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);

    await sendUserDataRecord({
      requestBody: '{"type":"autosave"}',
      keepalive: true,
      fetcher,
      beacon,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('falls back to a navigation-safe beacon when the keepalive request fails', async () => {
    const fetcher = vi.fn<UserDataRecordFetcher>(async () => { throw new TypeError('navigation interrupted'); });
    const beacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);

    await sendUserDataRecord({
      requestBody: '{"type":"autosave"}',
      keepalive: true,
      fetcher,
      beacon,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(beacon).toHaveBeenCalledOnce();
    expect(beacon.mock.calls[0]?.[0]).toBe('/api/user-data/record');
    expect(beacon.mock.calls[0]?.[1]).toBe('{"type":"autosave"}');
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
