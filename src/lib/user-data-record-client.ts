export type UserDataRecordFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type UserDataRecordBeacon = (url: string, data?: BodyInit | null) => boolean;

export interface SendUserDataRecordOptions {
  requestBody: string;
  keepalive: boolean;
  timeoutMs?: number;
  fetcher?: UserDataRecordFetcher;
  beacon?: UserDataRecordBeacon;
}

export async function sendUserDataRecord({
  requestBody,
  keepalive,
  timeoutMs = 8_000,
  fetcher = fetch,
  beacon,
}: SendUserDataRecordOptions): Promise<void> {
  const navigationBeacon = beacon ?? (
    typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined
  );
  if (keepalive && navigationBeacon) {
    try {
      const accepted = navigationBeacon(
        '/api/user-data/record',
        new Blob([requestBody], { type: 'application/json' }),
      );
      if (accepted) return;
    } catch {
      // Fall through to the response-aware request when the beacon API rejects the body.
    }
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error(`activity record request timed out after ${timeoutMs}ms`);
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetcher('/api/user-data/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        keepalive,
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) throw new Error(`activity record failed with HTTP ${response.status}`);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
