// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimRemoveBgSubmissionMarker, clearRemoveBgSubmissionMarker,
  findRemoveBgSubmissionMarker } from '@/lib/canvas-removebg-submission-marker';

const source = { projectId: 'project-a', imageId: 'image-a', sourceVersionId: 'version-a' };
const marker = { version: 1 as const, actorId: 'actor-a', ...source,
  idempotencyKey: 'removebg-key-a', createdAt: 1 };

beforeEach(() => {
  const records = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return records.size; },
    key: (index: number) => Array.from(records.keys())[index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
    clear: () => { records.clear(); },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('allows one confirmed remove-background POST across concurrent tabs for the same actor and version', async () => {
  const queues = new Map<string, Promise<unknown>>();
  const locks = { request: (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
    const run = (queues.get(name) || Promise.resolve()).then(callback);
    queues.set(name, run.catch(() => undefined));
    return run;
  } } as LockManager;
  const [first, second] = await Promise.all([
    claimRemoveBgSubmissionMarker(locks, localStorage, marker),
    claimRemoveBgSubmissionMarker(locks, localStorage, { ...marker, idempotencyKey: 'removebg-key-b' }),
  ]);
  expect(first).toEqual({ claimed: true });
  expect(second).toEqual({ claimed: false, existing: marker });
  expect(findRemoveBgSubmissionMarker(localStorage, source, 'actor-a')).toEqual(marker);
  clearRemoveBgSubmissionMarker(localStorage, marker);
  expect(findRemoveBgSubmissionMarker(localStorage, source, 'actor-a')).toBeNull();
});

it('fails closed when a persisted remove-background attempt cannot be parsed', () => {
  localStorage.setItem('wujie:removebg:attempt:broken', '{');
  expect(() => findRemoveBgSubmissionMarker(localStorage, source, 'actor-a'))
    .toThrow('Pending remove-background marker is corrupt');
});

it('holds a prior attempt for the same entity even after its asset version changes', async () => {
  const locks = { request: async (_name: string, callback: () => Promise<unknown>) => callback() } as LockManager;
  expect(await claimRemoveBgSubmissionMarker(locks, localStorage, marker)).toEqual({ claimed: true });
  const revised = { ...marker, sourceVersionId: 'version-b', idempotencyKey: 'removebg-key-b' };
  expect(await claimRemoveBgSubmissionMarker(locks, localStorage, revised))
    .toEqual({ claimed: false, existing: marker });
  expect(findRemoveBgSubmissionMarker(localStorage, revised, 'actor-a')).toEqual(marker);
});
