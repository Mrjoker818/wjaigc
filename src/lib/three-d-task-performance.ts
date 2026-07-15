export const THREE_D_POLL_INTERVAL_MS = 2_000;
export const THREE_D_TASK_TIMEOUT_MS = 10 * 60 * 1_000;
export const THREE_D_POLL_REQUEST_TIMEOUT_MS = 10_000;
export const THREE_D_SUBMISSION_TIMEOUT_MS = 60_000;
export const TRIPO_UPLOAD_TIMEOUT_MS = 30_000;
export const TRIPO_UPLOAD_CONCURRENCY = 2;
export const AUTO_MULTI_VIEW_IMAGE_CONCURRENCY = 2;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

export function isMeshyThreeDProvider(provider?: {
  name?: string;
  baseUrl?: string;
  providerPreset?: string;
}): boolean {
  const preset = provider?.providerPreset?.toLowerCase() || '';
  const name = provider?.name?.toLowerCase() || '';
  const baseUrl = provider?.baseUrl?.toLowerCase() || '';
  return preset === 'meshy' || name.includes('meshy') || baseUrl.includes('meshy');
}
