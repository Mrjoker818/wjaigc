import { describe, expect, it } from 'vitest';
import { claimUpscaleSubmissionMarker, clearUpscaleSubmissionMarker, findUpscaleSubmissionMarker,
  writeUpscaleSubmissionMarker, type UpscaleSubmissionMarker } from '@/lib/canvas-upscale-submission-marker';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number { return values.size; },
    key(index: number): string | null { return Array.from(values.keys())[index] ?? null; },
    getItem(key: string): string | null { return values.get(key) ?? null; },
    setItem(key: string, value: string): void { values.set(key, value); },
    removeItem(key: string): void { values.delete(key); },
    clear(): void { values.clear(); },
  };
}

describe('302 upscale submission markers', () => {
  const source = { projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a' };
  const marker = (actorId: string, idempotencyKey: string): UpscaleSubmissionMarker =>
    ({ version: 1, actorId, ...source, idempotencyKey, createdAt: 1 });

  it('keeps separate actor/key entries and clears only the exact attempt', () => {
    const storage = memoryStorage();
    writeUpscaleSubmissionMarker(storage, marker('actor-a', 'key-a'));
    writeUpscaleSubmissionMarker(storage, marker('actor-b', 'key-b'));
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toEqual(marker('actor-a', 'key-a'));
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-b')).toEqual(marker('actor-b', 'key-b'));
    clearUpscaleSubmissionMarker(storage, 'key-a', source, 'actor-a');
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toBeNull();
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-b')).toEqual(marker('actor-b', 'key-b'));
  });

  it('preserves both canvas sources when a conflict adopts one original task key', () => {
    const storage = memoryStorage();
    const secondSource = { ...source, imageId: 'image-b' };
    const first = marker('actor-a', 'original-key');
    const rejected = { ...marker('actor-a', 'rejected-key'), ...secondSource };
    const adopted = { ...rejected, idempotencyKey: 'original-key' };
    writeUpscaleSubmissionMarker(storage, first);
    writeUpscaleSubmissionMarker(storage, rejected);

    writeUpscaleSubmissionMarker(storage, adopted);
    clearUpscaleSubmissionMarker(storage, rejected.idempotencyKey, secondSource, 'actor-a');

    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toEqual(first);
    expect(findUpscaleSubmissionMarker(storage, secondSource, 'actor-a')).toEqual(adopted);
    expect(storage.length).toBe(2);

    clearUpscaleSubmissionMarker(storage, adopted.idempotencyKey, secondSource, 'actor-a');
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toEqual(first);
    expect(findUpscaleSubmissionMarker(storage, secondSource, 'actor-a')).toBeNull();
  });

  it('keeps punctuation in an original server idempotency key recoverable', () => {
    const storage = memoryStorage();
    const original = marker('actor-a', 'attempt:1');
    writeUpscaleSubmissionMarker(storage, original);
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toEqual(original);
  });

  it('fails closed on a malformed pending marker', () => {
    const storage = memoryStorage();
    storage.setItem('wujie:upscale302:attempt:key-a', '{broken');
    expect(() => findUpscaleSubmissionMarker(storage, source, 'actor-a')).toThrow();
  });

  it('serializes simultaneous first claims for one actor and source', async () => {
    const storage = memoryStorage();
    const queues = new Map<string, Promise<unknown>>();
    const locks = { request: (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
      const run = (queues.get(name) || Promise.resolve()).then(callback);
      queues.set(name, run.catch(() => undefined));
      return run;
    } } as LockManager;
    const results = await Promise.all([
      claimUpscaleSubmissionMarker(locks, storage, marker('actor-a', 'first')),
      claimUpscaleSubmissionMarker(locks, storage, marker('actor-a', 'second')),
    ]);
    expect(results).toEqual([{ claimed: true }, { claimed: false, existing: marker('actor-a', 'first') }]);
    expect(storage.length).toBe(1);
    expect(findUpscaleSubmissionMarker(storage, source, 'actor-a')).toEqual(marker('actor-a', 'first'));
  });

  it('cannot claim a paid attempt when origin locks are unavailable', async () => {
    const storage = memoryStorage();
    await expect(claimUpscaleSubmissionMarker(undefined, storage, marker('actor-a', 'first'))).rejects.toThrow();
    expect(storage.length).toBe(0);
  });
});
