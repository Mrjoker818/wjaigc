import { describe, expect, it } from 'vitest';

import {
  LOCAL_INFERENCE_MAX_CONCURRENT,
  withLocalInferenceLock,
} from '@/lib/image-tools/concurrency-gate';

describe('local inference concurrency gate', () => {
  it('allows only one inference task to run at a time', async () => {
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 4 }, () =>
      withLocalInferenceLock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active -= 1;
      }),
    );

    await Promise.all(tasks);
    expect(LOCAL_INFERENCE_MAX_CONCURRENT).toBeGreaterThanOrEqual(1);
    expect(maxActive).toBe(LOCAL_INFERENCE_MAX_CONCURRENT);
  });

  it('propagates task errors and releases the slot for the next task', async () => {
    await expect(
      withLocalInferenceLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(withLocalInferenceLock(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects queued tasks that wait longer than the timeout budget', async () => {
    const first = withLocalInferenceLock(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 120));
        return 'first';
      },
      300,
    );
    const second = withLocalInferenceLock(async () => 'late', 20);

    await expect(second).rejects.toThrow(/等待超时/);
    await expect(first).resolves.toBe('first');
  });
});
