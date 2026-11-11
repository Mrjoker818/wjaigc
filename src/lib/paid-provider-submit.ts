import { fetchWithV1Retry } from '@/lib/api-helpers';
import { assertSafeProviderUrl } from '@/lib/poisoned-api-host';

export function configuredPaidProviderBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, '');
  assertSafeProviderUrl(baseUrl);
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid provider base URL');
  return baseUrl;
}

type PaidProviderReceipt =
  | { kind: 'received'; data: Record<string, unknown>; responseUrl: string }
  | { kind: 'rejected'; status: number }
  | { kind: 'unconfirmed' };

export async function submitPaidProviderJson(input: {
  baseUrl: string; path: string; apiKey: string; body: Record<string, unknown>; signal: AbortSignal;
}): Promise<PaidProviderReceipt> {
  const { baseUrl, path, apiKey, signal } = input;
  const body = JSON.stringify(input.body);
  signal.throwIfAborted();
  try {
    const response = await fetchWithV1Retry(baseUrl, path, {
      method: 'POST', skipV1Retry: true, redirect: 'manual', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    signal.throwIfAborted();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // A timeout, redirect or gateway failure may arrive after dispatch.
      return [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status)
        ? { kind: 'rejected', status: response.status }
        : { kind: 'unconfirmed' };
    }
    const data: unknown = await response.json();
    signal.throwIfAborted();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { kind: 'received', data: data as Record<string, unknown>, responseUrl: response.url };
    }
  } catch {
    // Transport and body-read errors do not establish whether the provider accepted the request.
  }
  return { kind: 'unconfirmed' };
}
