import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { CanvasDocumentMediaSync } from '@/lib/collaboration/document-media-sync';
import {
  canvasBridgeStorageKey, consumeCanvasBridgeJournal, enqueueCanvasBridgeReferences, migrateLegacyCanvasBridge, readCanvasBridgeJournal,
  type ConsumeCanvasBridgeInput,
} from '@/lib/simple-chat-canvas-bridge';

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number { return values.size; },
    key: (index: number): string | null => [...values.keys()][index] ?? null,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); },
    clear: (): void => { values.clear(); },
  };
}
function makeLocks(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  const request = <T>(name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => {
    const next = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
    tails.set(name, next.catch(() => undefined));
    return next;
  };
  return { request, query: async () => ({ held: [], pending: [] }) } as LockManager;
}
const scope = { actorId: 'actor-a', projectId: 'project-p' };
const a: WorkspaceAssetReference = { assetVersionId: 'version-a', placementId: 'source-a', url: '/private-a.png' };
const b: WorkspaceAssetReference = { assetVersionId: 'version-b', placementId: 'source-b', url: '/private-b.png' };
const c: WorkspaceAssetReference = { assetVersionId: 'version-c', placementId: 'source-c', url: '/private-c.png' };
function fixture(): {
  storage: Storage; locks: LockManager; actorId: string; projectId: string; isCurrent: () => boolean;
} {
  return { ...scope, storage: makeStorage(), locks: makeLocks(), isCurrent: () => true };
}

function successfulResponse(version = 'version-a'): Response {
  return Response.json({ success: true, placementId: `destination-${version}`, assetVersionId: version, documentSequence: 4 });
}
function serverDirectory(images: Array<{ placementId: string; assetVersionId: string }>, sequence = 4): Record<string, unknown> {
  return { success: true, projectId: 'project-p', sequence, readOnly: false,
    projection: { placements: Object.fromEntries(images.map(image => [image.placementId, {
      assetVersionId: image.assetVersionId, x: 200, y: 200, width: 512, height: 512, rotation: 0, zIndex: 1,
    }])) },
    canvasImages: images.map(image => ({ ...image, id: `image-${image.placementId}`,
      url: `/api/serve-upload/${image.assetVersionId}.png`, x: 200, y: 200, width: 512, height: 512,
      originalWidth: 512, originalHeight: 512, rotation: 0, zIndex: 1, createdAt: 1 })) };
}
function consumer(input: ReturnType<typeof fixture>, overrides: Partial<ConsumeCanvasBridgeInput> = {}): ConsumeCanvasBridgeInput {
  return { ...input, authority: 'document',
    fetcher: async (request, init): Promise<Response> => {
      if (String(request).includes('document-project')) return Response.json(serverDirectory([
        { placementId: 'destination-version-a', assetVersionId: 'version-a' },
        { placementId: 'destination-version-b', assetVersionId: 'version-b' },
      ]));
      const body = JSON.parse(String(init?.body)) as { command: { assetVersionId: string } };
      return successfulResponse(body.command.assetVersionId);
    },
    refreshMedia: async () => [
      { placementId: 'destination-version-a', assetVersionId: 'version-a' },
      { placementId: 'destination-version-b', assetVersionId: 'version-b' },
    ],
    resolveReference: async () => { throw new Error('DOCUMENT_MUST_NOT_USE_OWNER_RESOLVER'); },
    mergeLegacy: async () => { throw new Error('DOCUMENT_MUST_NOT_USE_LEGACY_MERGE'); },
    ...overrides };
}

describe('account/project canvas bridge journal', () => {
  it('uses an unambiguous account and project storage key', () => {
    expect(canvasBridgeStorageKey(scope)).toBe('wujie:canvas-bridge:v2:%5B%22actor-a%22%2C%22project-p%22%5D');
    expect(canvasBridgeStorageKey({ actorId: 'a:b', projectId: 'c' }))
      .not.toBe(canvasBridgeStorageKey({ actorId: 'a', projectId: 'b:c' }));
  });
  it('freezes the second attach command and stores identities without media URLs', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    expect(journal.items.map(item => item.slot)).toEqual([0, 1]);
    expect(journal.items[1].command).toEqual({ action: 'attach', assetVersionId: 'version-b',
      transform: { x: 420, y: 200, width: 512, height: 512, rotation: 0, zIndex: 1 } });
    expect(journal.items[1].idempotencyKey).toBe('chat-bridge:8a830c60e7369370bc14ba982e2044dc331a3ea05cb1954a77e625076f94e3fd');
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).not.toContain('/private-');
  });
  it('appends new identities while retaining a repeated item command and accepted receipt', async () => {
    const input = fixture();
    const first = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    first.items[0].state = 'accepted';
    first.items[0].receipt = { placementId: 'destination-a', assetVersionId: 'version-a', documentSequence: 4 };
    input.storage.setItem(canvasBridgeStorageKey(scope), JSON.stringify(first));
    const next = await enqueueCanvasBridgeReferences({ ...input, references: [c, a] });
    expect(next.items.map(item => [item.assetVersionId, item.slot])).toEqual([
      ['version-a', 0], ['version-b', 1], ['version-c', 2],
    ]);
    expect(next.items[0]).toEqual(first.items[0]);
    expect(next.items[1]).toEqual(first.items[1]);
  });
  it('does not read another account or project journal', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    expect(readCanvasBridgeJournal(input.storage, { ...scope, actorId: 'actor-b' })).toBeNull();
    expect(readCanvasBridgeJournal(input.storage, { ...scope, projectId: 'project-q' })).toBeNull();
  });
  it('leaves saved work intact when storage refuses an append', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    input.storage.setItem = (): void => { throw new Error('quota exceeded'); };
    await expect(enqueueCanvasBridgeReferences({ ...input, references: [b] })).rejects.toThrow('quota exceeded');
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('does not overwrite corrupt journal data', async () => {
    const input = fixture();
    input.storage.setItem(canvasBridgeStorageKey(scope), '{bad');
    await expect(enqueueCanvasBridgeReferences({ ...input, references: [a] })).rejects.toThrow();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe('{bad');
  });
  it('refuses a journal whose embedded actor differs from its storage scope', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    input.storage.setItem(canvasBridgeStorageKey(scope), JSON.stringify({ ...journal, actorId: 'actor-b' }));
    expect(() => readCanvasBridgeJournal(input.storage, scope)).toThrow();
  });
  it('fails closed without a lock manager', async () => {
    const input = fixture();
    await expect(enqueueCanvasBridgeReferences({ ...input, locks: undefined, references: [a] })).rejects.toThrow();
    expect(input.storage.length).toBe(0);
  });
  it('does not persist work after a scope change while waiting for the lock', async () => {
    const input = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let current = true;
    const held = input.locks.request(canvasBridgeStorageKey(scope), async () => { await gate; });
    const pending = enqueueCanvasBridgeReferences({ ...input, isCurrent: () => current, references: [a] });
    current = false;
    release();
    await held;
    await expect(pending).rejects.toThrow();
    expect(input.storage.length).toBe(0);
  });
  it('serializes concurrent appenders without losing either item or reusing a slot', async () => {
    const input = fixture();
    await Promise.all([
      enqueueCanvasBridgeReferences({ ...input, references: [a] }),
      enqueueCanvasBridgeReferences({ ...input, references: [b] }),
    ]);
    const journal = readCanvasBridgeJournal(input.storage, scope)!;
    expect(journal.items.map(item => [item.assetVersionId, item.slot])).toEqual([['version-a', 0], ['version-b', 1]]);
  });
  it('rejects URL-only or invalid managed identities without changing saved work', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    for (const reference of [{ url: '/only.png' }, { ...b, assetVersionId: 'https://foreign.example' }]) {
      await expect(enqueueCanvasBridgeReferences({ ...input, references: [reference] })).rejects.toThrow();
    }
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('does not acknowledge a storage write that cannot be read back', async () => {
    const input = fixture();
    input.storage.setItem = (): void => {};
    await expect(enqueueCanvasBridgeReferences({ ...input, references: [a] })).rejects.toThrow();
  });
  it('rejects a frozen transform inconsistent with its original slot', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    journal.items[1].command.transform.x = 200;
    input.storage.setItem(canvasBridgeStorageKey(scope), JSON.stringify(journal));
    expect(() => readCanvasBridgeJournal(input.storage, scope)).toThrow();
  });
  it('rejects an accepted receipt for a different version', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    journal.items[0].state = 'accepted';
    journal.items[0].receipt = { placementId: 'destination-a', assetVersionId: 'version-b', documentSequence: 4 };
    input.storage.setItem(canvasBridgeStorageKey(scope), JSON.stringify(journal));
    expect(() => readCanvasBridgeJournal(input.storage, scope)).toThrow();
  });
  it('rejects a format-valid but incorrect saved key before duplicate reuse or append', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    journal.items[0].idempotencyKey = 'chat-bridge:' + '0'.repeat(64);
    const damaged = JSON.stringify(journal);
    input.storage.setItem(canvasBridgeStorageKey(scope), damaged);
    await expect(enqueueCanvasBridgeReferences({ ...input, references: [a, b] }))
      .rejects.toThrow('CANVAS_BRIDGE_JOURNAL_INVALID');
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(damaged);
  });
});

describe('per-item canvas bridge consumption', () => {
  it.each([
    { reason: 'stale', payload: serverDirectory([{ placementId: 'destination-version-a', assetVersionId: 'version-a' }], 3) },
    { reason: 'read-only', payload: { ...serverDirectory([]), readOnly: true } },
    { reason: 'foreign project', payload: { ...serverDirectory([]), projectId: 'project-q' } },
    { reason: 'incomplete', payload: { ...serverDirectory([{ placementId: 'destination-version-a', assetVersionId: 'version-a' }]), canvasImages: [] } },
  ])('does not finish from a $reason server directory', async ({ payload }) => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, { fetcher: async request =>
      String(request).includes('document-project') ? Response.json(payload) : successfulResponse(),
    }))).rejects.toThrow();
    expect(readCanvasBridgeJournal(input.storage, scope)!.items[0].state).toBe('accepted');
  });
  it.each(['fetch', 'body'])('releases the scope lock when document %s never settles', async stage => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const never = new Promise<never>(() => {});
    let aborted: AbortSignal | null | undefined;
    vi.useFakeTimers();
    try {
      const outcome = consumeCanvasBridgeJournal(consumer(input, { fetcher: async (_request, init) => {
        aborted = init?.signal;
        if (stage === 'fetch') { enter(); return never; }
        const response = successfulResponse();
        response.json = (): Promise<never> => { enter(); return never; };
        return response;
      } })).then(() => 'unexpected success', (error: Error) => error.message);
      await entered;
      let finished = false;
      void outcome.then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(finished).toBe(true);
      expect(await outcome).toBe('DOCUMENT_BRIDGE_REQUEST_TIMEOUT');
      expect(aborted?.aborted).toBe(true);
      await enqueueCanvasBridgeReferences({ ...input, references: [b] });
      expect(readCanvasBridgeJournal(input.storage, scope)!.items.map(item => [item.assetVersionId, item.state]))
        .toEqual([['version-a', 'pending'], ['version-b', 'pending']]);
    } finally { vi.useRealTimers(); }
  });
  it('does not classify a local pending deletion as a server supersession', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const directory = serverDirectory([{ placementId: 'destination-version-a', assetVersionId: 'version-a' }]);
    const sync = new CanvasDocumentMediaSync('project-p', () => {});
    // The actual sync accepts server sequence 4 while the active Y.Doc contains a pending local delete.
    sync.acceptDirectory(directory);
    sync.setDocument({ placements: {} }, 4);
    vi.stubGlobal('fetch', async () => Response.json(directory));
    let activeImages: unknown;
    try {
      const result = await consumeCanvasBridgeJournal(consumer(input, {
        fetcher: async request => String(request).includes('document-project')
          ? Response.json(directory) : successfulResponse(),
        refreshMedia: async request => { const images = await sync.refresh(request); activeImages = images; return images; },
      }));
      expect(activeImages).toEqual([]);
      expect(result).toEqual({ status: 'consumed', confirmed: 1, superseded: 0 });
      expect(readCanvasBridgeJournal(input.storage, scope)!.items[0].state).toBe('confirmed');
    } finally { sync.stop(); vi.unstubAllGlobals(); }
  });
  it.each(['fetch', 'body'])('keeps accepted and releases the lock when server-directory %s never settles', async stage => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const never = new Promise<never>(() => {});
    vi.useFakeTimers();
    try {
      const outcome = consumeCanvasBridgeJournal(consumer(input, { fetcher: async request => {
        if (!String(request).includes('document-project')) return successfulResponse();
        if (stage === 'fetch') { enter(); return never; }
        const response = Response.json(serverDirectory([]));
        response.json = (): Promise<never> => { enter(); return never; };
        return response;
      } })).then(() => 'unexpected success', (error: Error) => error.message);
      await entered;
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await outcome).toBe('DOCUMENT_BRIDGE_REQUEST_TIMEOUT');
      await enqueueCanvasBridgeReferences({ ...input, references: [b] });
      expect(readCanvasBridgeJournal(input.storage, scope)!.items.map(item => [item.assetVersionId, item.state]))
        .toEqual([['version-a', 'accepted'], ['version-b', 'pending']]);
    } finally { vi.useRealTimers(); }
  });
  it.each(['placement', 'sequence'])('rejects a replay with a changed receipt %s before readback or B dispatch', async changed => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      refreshMedia: async () => { throw new Error('offline'); },
    }))).rejects.toThrow('offline');
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    let attempts = 0;
    const refreshMedia = vi.fn(async () => []);
    await expect(consumeCanvasBridgeJournal(consumer(input, { refreshMedia, fetcher: async () => {
      attempts += 1;
      return Response.json({ success: true, placementId: changed === 'placement' ? 'other-placement' : 'destination-version-a',
        assetVersionId: 'version-a', documentSequence: changed === 'sequence' ? 5 : 4 });
    } }))).rejects.toThrow('DOCUMENT_BRIDGE_RECEIPT_CHANGED');
    expect(attempts).toBe(1);
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it.each([401, 403, 409])('retains accepted after server readback denies access with %i', async status => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, { fetcher: async request =>
      String(request).includes('document-project')
        ? Response.json({ success: false, code: 'ACTOR_SCOPE_CHANGED' }, { status }) : successfulResponse(),
    }))).rejects.toThrow('DOCUMENT_BRIDGE_READBACK_UNCONFIRMED');
    expect(readCanvasBridgeJournal(input.storage, scope)!.items[0].state).toBe('accepted');
  });
  it('retains document intent after a lost response and refuses legacy consumption', async () => {
    const input = fixture();
    const frozen = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      fetcher: async () => { throw new Error('response lost after commit'); },
    }))).rejects.toThrow('response lost after commit');
    const resolveReference = vi.fn(async () => a);
    const mergeLegacy = vi.fn(async () => true);
    await expect(consumeCanvasBridgeJournal(consumer(input, { authority: 'legacy', resolveReference, mergeLegacy })))
      .rejects.toThrow('CANVAS_BRIDGE_AUTHORITY_CHANGED');
    expect(resolveReference).not.toHaveBeenCalled();
    expect(mergeLegacy).not.toHaveBeenCalled();
    const saved = readCanvasBridgeJournal(input.storage, scope)!.items[0];
    expect(saved).toMatchObject({ state: 'pending', documentAttempted: true });
    expect(saved.command).toEqual(frozen.items[0].command);
    expect(saved.idempotencyKey).toBe(frozen.items[0].idempotencyKey);
  });
  it('persists document intent before dispatch and keeps it when accepted storage fails', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const setItem = input.storage.setItem.bind(input.storage);
    input.storage.setItem = (key: string, raw: string): void => {
      if (raw.includes('"state":"accepted"')) throw new Error('accepted quota exceeded');
      setItem(key, raw);
    };
    let dispatched = 0;
    await expect(consumeCanvasBridgeJournal(consumer(input, { fetcher: async () => {
      dispatched += 1;
      expect(readCanvasBridgeJournal(input.storage, scope)!.items[0]).toMatchObject({ documentAttempted: true });
      return successfulResponse();
    } }))).rejects.toThrow('accepted quota exceeded');
    expect(dispatched).toBe(1);
    expect(readCanvasBridgeJournal(input.storage, scope)!.items[0]).toMatchObject({ state: 'pending', documentAttempted: true });
    const mergeLegacy = vi.fn(async () => true);
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      authority: 'legacy', resolveReference: async () => a, mergeLegacy,
    }))).rejects.toThrow('CANVAS_BRIDGE_AUTHORITY_CHANGED');
    expect(mergeLegacy).not.toHaveBeenCalled();
  });
  it('does not dispatch when the preflight document intent cannot be saved', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    input.storage.setItem = (): void => { throw new Error('quota exceeded'); };
    const fetcher = vi.fn(async () => successfulResponse());
    await expect(consumeCanvasBridgeJournal(consumer(input, { fetcher }))).rejects.toThrow('quota exceeded');
    expect(fetcher).not.toHaveBeenCalled();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('sends frozen commands with the frozen actor and confirms only authoritative readback', async () => {
    const input = fixture();
    const frozen = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    const requests: RequestInit[] = [];
    const reads: RequestInit[] = [];
    const defaultConsumer = consumer(input);
    const result = await consumeCanvasBridgeJournal(consumer(input, {
      fetcher: async (request, init): Promise<Response> => {
        if (init?.method === 'POST') {
          expect(request).toBe('/api/collaboration/document-assets');
          requests.push(init);
        } else {
          expect(request).toBe('/api/collaboration/document-project?projectId=project-p');
          reads.push(init!);
        }
        return defaultConsumer.fetcher!(request, init);
      },
    }));
    expect(result).toEqual({ status: 'consumed', confirmed: 2, superseded: 0 });
    expect(requests.map(init => new Headers(init.headers).get('x-wujie-expected-actor-id'))).toEqual(['actor-a', 'actor-a']);
    expect(requests.map(init => JSON.parse(String(init.body)))).toEqual(frozen.items.map(item => ({
      projectId: 'project-p', idempotencyKey: item.idempotencyKey, command: item.command,
    })));
    expect(requests.map(init => [init.method, init.credentials, init.cache])).toEqual([
      ['POST', 'include', 'no-store'], ['POST', 'include', 'no-store'],
    ]);
    expect(reads.map(init => [init.method, init.credentials, init.cache,
      new Headers(init.headers).get('x-wujie-expected-actor-id')]))
      .toEqual([['GET', 'include', 'no-store', 'actor-a'], ['GET', 'include', 'no-store', 'actor-a']]);
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => item.state)).toEqual(['confirmed', 'confirmed']);
  });
  it('does not resolve, send or consume a different actor journal', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    const fetcher = vi.fn(async () => successfulResponse());
    const result = await consumeCanvasBridgeJournal(consumer(input, { actorId: 'actor-b', fetcher }));
    expect(result).toEqual({ status: 'waiting', confirmed: 0, superseded: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('stops after an account switch during fetch without persisting a receipt', async () => {
    const input = fixture();
    const frozen = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    let current = true;
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      isCurrent: () => current,
      fetcher: async () => { current = false; return successfulResponse(); },
    }))).rejects.toThrow('CANVAS_BRIDGE_SCOPE_CHANGED');
    expect(readCanvasBridgeJournal(input.storage, scope)!.items[0])
      .toEqual({ ...frozen.items[0], documentAttempted: true });
  });
  it('rechecks account scope after response JSON parsing', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    let current = true;
    const response = successfulResponse();
    const originalJson = response.json.bind(response);
    response.json = async (): Promise<unknown> => { const value: unknown = await originalJson(); current = false; return value; };
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      isCurrent: () => current, fetcher: async () => response,
    }))).rejects.toThrow('CANVAS_BRIDGE_SCOPE_CHANGED');
    expect(readCanvasBridgeJournal(input.storage, scope)?.items[0].state).toBe('pending');
  });
  it('persists accepted before readback and retains it when readback fails', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      refreshMedia: async request => {
        expect(request).toEqual({ projectId: 'project-p', documentSequence: 4 });
        expect(readCanvasBridgeJournal(input.storage, scope)?.items[0].state).toBe('accepted');
        throw new Error('network unavailable');
      },
    }))).rejects.toThrow('network unavailable');
    expect(readCanvasBridgeJournal(input.storage, scope)?.items[0].receipt).toEqual({
      placementId: 'destination-version-a', assetVersionId: 'version-a', documentSequence: 4,
    });
  });
  it('does not let accepted local state bypass revoked server authorization', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      refreshMedia: async () => { throw new Error('offline'); },
    }))).rejects.toThrow('offline');
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    const refreshMedia = vi.fn(async () => []);
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      fetcher: async () => Response.json({ success: false, code: 'DOCUMENT_FORBIDDEN' }, { status: 403 }), refreshMedia,
    }))).rejects.toThrow('DOCUMENT_FORBIDDEN');
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('retries a lost second response with the same key and x420 while skipping completed A', async () => {
    const input = fixture();
    const frozen = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    const bRequests: unknown[] = [];
    let aAttempts = 0;
    let bAttempts = 0;
    const fetcher: typeof fetch = async (request, init) => {
      if (String(request).includes('document-project')) return consumer(input).fetcher!(request, init);
      const body = JSON.parse(String(init?.body)) as { command: { assetVersionId: string } };
      if (body.command.assetVersionId === 'version-a') aAttempts += 1;
      else { bRequests.push(body); bAttempts += 1; if (bAttempts === 1) throw new Error('response lost after commit'); }
      return successfulResponse(body.command.assetVersionId);
    };
    await expect(consumeCanvasBridgeJournal(consumer(input, { fetcher }))).rejects.toThrow('response lost after commit');
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => item.state)).toEqual(['confirmed', 'pending']);
    await consumeCanvasBridgeJournal(consumer(input, { fetcher,
      refreshMedia: async () => [{ placementId: 'destination-version-b', assetVersionId: 'version-b' }],
    }));
    expect(aAttempts).toBe(1);
    expect(bRequests).toEqual([0, 1].map(() => ({ projectId: 'project-p',
      idempotencyKey: frozen.items[1].idempotencyKey, command: { action: 'attach', assetVersionId: 'version-b',
        transform: { x: 420, y: 200, width: 512, height: 512, rotation: 0, zIndex: 1 } } })));
  });
  it.each(['deleted', 'replaced'])('supersedes accepted A that was %s without blocking pending B', async change => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      refreshMedia: async () => { throw new Error('offline after A accepted'); },
    }))).rejects.toThrow('offline after A accepted');
    const projected = change === 'deleted' ? [] : [{ placementId: 'destination-version-a', assetVersionId: 'version-new' }];
    const result = await consumeCanvasBridgeJournal(consumer(input, {
      fetcher: async (request, init) => String(request).includes('document-project')
        ? Response.json(serverDirectory([...projected, { placementId: 'destination-version-b', assetVersionId: 'version-b' }]))
        : consumer(input).fetcher!(request, init),
      refreshMedia: async () => [...projected, { placementId: 'destination-version-b', assetVersionId: 'version-b' }],
    }));
    expect(result).toEqual({ status: 'consumed', confirmed: 1, superseded: 1 });
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => item.state)).toEqual(['superseded', 'confirmed']);
  });
  it('retains terminal commands so duplicate enqueue cannot move B or attach it again', async () => {
    const input = fixture();
    const original = await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    await consumeCanvasBridgeJournal(consumer(input));
    await enqueueCanvasBridgeReferences({ ...input, references: [b] });
    const fetcher = vi.fn(async () => successfulResponse());
    expect(await consumeCanvasBridgeJournal(consumer(input, { fetcher })))
      .toEqual({ status: 'consumed', confirmed: 2, superseded: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    const retained = readCanvasBridgeJournal(input.storage, scope)!;
    expect(retained.items[1].command).toEqual(original.items[1].command);
    expect(retained.items[1].idempotencyKey).toBe(original.items[1].idempotencyKey);
    expect(retained.items[1].slot).toBe(1);
  });
  it('does not overwrite C appended by a sender while readback is pending', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    let signal!: () => void;
    let release!: () => void;
    const reached = new Promise<void>(resolve => { signal = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let refreshes = 0;
    const defaultConsumer = consumer(input);
    const consuming = consumeCanvasBridgeJournal(consumer(input, {
      refreshMedia: async request => {
        if (++refreshes === 1) { signal(); await gate; }
        return defaultConsumer.refreshMedia(request);
      },
    }));
    // Race against the no-op baseline too: do not hang if refresh is never reached.
    const entered = await Promise.race([reached.then(() => true), consuming.then(() => false)]);
    expect(entered).toBe(true);
    const appending = enqueueCanvasBridgeReferences({ ...input, references: [c] });
    release();
    await consuming;
    await appending;
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => [item.assetVersionId, item.slot, item.state]))
      .toEqual([['version-a', 0, 'confirmed'], ['version-b', 1, 'confirmed'], ['version-c', 2, 'pending']]);
  });
  it('does not refresh or complete when accepted cannot be saved', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    input.storage.setItem = (): void => { throw new Error('quota exceeded'); };
    const refreshMedia = vi.fn(async () => []);
    await expect(consumeCanvasBridgeJournal(consumer(input, { refreshMedia }))).rejects.toThrow('quota exceeded');
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(readCanvasBridgeJournal(input.storage, scope)?.items[0].state).toBe('pending');
  });
  it.each([
    { success: true, placementId: 'destination-a', assetVersionId: 'version-b', documentSequence: 4 },
    { success: true, placementId: '', assetVersionId: 'version-a', documentSequence: 4 },
    { success: true, placementId: 'destination-a', assetVersionId: 'version-a', documentSequence: -1 },
  ])('refuses an invalid receipt without changing pending state %#', async payload => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      fetcher: async () => Response.json(payload),
    }))).rejects.toThrow();
    expect(readCanvasBridgeJournal(input.storage, scope)?.items[0].state).toBe('pending');
  });
  it('preserves both legacy references and original slots when merge refuses', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    const mergeLegacy = vi.fn(async () => false);
    const result = await consumeCanvasBridgeJournal(consumer(input, {
      authority: 'legacy', resolveReference: async reference => reference.assetVersionId === 'version-a' ? a : b,
      mergeLegacy,
    }));
    expect(result).toEqual({ status: 'waiting', confirmed: 0, superseded: 0 });
    expect(mergeLegacy).toHaveBeenCalledExactlyOnceWith([{ ...a, bridgeSlot: 0 }, { ...b, bridgeSlot: 1 }]);
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('does not filter a legacy 404 into empty success or clear its journal', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    const saved = input.storage.getItem(canvasBridgeStorageKey(scope));
    const mergeLegacy = vi.fn(async () => true);
    await expect(consumeCanvasBridgeJournal(consumer(input, {
      authority: 'legacy', resolveReference: async () => { throw Object.assign(new Error('ASSET_NOT_FOUND'), { status: 404 }); }, mergeLegacy,
    }))).rejects.toThrow('ASSET_NOT_FOUND');
    expect(mergeLegacy).not.toHaveBeenCalled();
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(saved);
  });
  it('confirms a successful legacy merge without submitting document commands', async () => {
    const input = fixture();
    await enqueueCanvasBridgeReferences({ ...input, references: [a, b] });
    const fetcher = vi.fn(async () => successfulResponse());
    const result = await consumeCanvasBridgeJournal(consumer(input, {
      authority: 'legacy', fetcher, resolveReference: async reference => reference.assetVersionId === 'version-a' ? a : b,
      mergeLegacy: async () => true,
    }));
    expect(result).toEqual({ status: 'consumed', confirmed: 2, superseded: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => item.state)).toEqual(['confirmed', 'confirmed']);
  });
});

describe('owner-verified migration of an unscoped legacy record', () => {
  const oldKey = 'wujie_canvas_bridge';
  const oldRaw = JSON.stringify({ projectId: 'project-p', images: [a, a, b] });
  function migration(input: ReturnType<typeof fixture>): Parameters<typeof migrateLegacyCanvasBridge>[0] {
    return { ...input, resolveReference: async reference => reference.assetVersionId === 'version-a' ? a : b };
  }
  it('returns absent only when the legacy key is absent', async () => {
    expect(await migrateLegacyCanvasBridge(migration(fixture()))).toBe('absent');
  });
  it('verifies all pointers before binding the account and removes only the verified old raw', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    const scopes: unknown[] = [];
    const result = await migrateLegacyCanvasBridge({ ...migration(input), resolveReference: async reference => {
      scopes.push(reference);
      return reference.assetVersionId === 'version-a' ? a : b;
    } });
    expect(result).toBe('migrated');
    expect(scopes).toEqual([
      { projectId: 'project-p', assetVersionId: 'version-a', placementId: 'source-a' },
      { projectId: 'project-p', assetVersionId: 'version-a', placementId: 'source-a' },
      { projectId: 'project-p', assetVersionId: 'version-b', placementId: 'source-b' },
    ]);
    expect(input.storage.getItem(oldKey)).toBeNull();
    expect(readCanvasBridgeJournal(input.storage, scope)?.items.map(item => [item.assetVersionId, item.slot]))
      .toEqual([['version-a', 0], ['version-b', 1]]);
  });
  it('does not bind a different project record to the current account', async () => {
    const input = fixture();
    const raw = JSON.stringify({ projectId: 'project-q', images: [a] });
    input.storage.setItem(oldKey, raw);
    const resolveReference = vi.fn(async () => a);
    expect(await migrateLegacyCanvasBridge({ ...migration(input), resolveReference })).toBe('waiting');
    expect(resolveReference).not.toHaveBeenCalled();
    expect(input.storage.getItem(oldKey)).toBe(raw);
    expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
  });
  it('preserves a 404 legacy record instead of filtering it into successful empty cleanup', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    await expect(migrateLegacyCanvasBridge({ ...migration(input), resolveReference: async () => {
      throw Object.assign(new Error('ASSET_NOT_FOUND'), { status: 404 });
    } })).rejects.toThrow('ASSET_NOT_FOUND');
    expect(input.storage.getItem(oldKey)).toBe(oldRaw);
    expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
  });
  it('stops migration on an account change during canonical resolution', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    let current = true;
    await expect(migrateLegacyCanvasBridge({ ...migration(input), isCurrent: () => current,
      resolveReference: async () => { current = false; return a; },
    })).rejects.toThrow('CANVAS_BRIDGE_SCOPE_CHANGED');
    expect(input.storage.getItem(oldKey)).toBe(oldRaw);
    expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
  });
  it.each(['{bad', JSON.stringify({ images: ['/url-only.png'] }), JSON.stringify({ images: [] })])(
    'does not erase corrupt, unmanaged or empty old raw %#', async raw => {
      const input = fixture();
      input.storage.setItem(oldKey, raw);
      await expect(migrateLegacyCanvasBridge(migration(input))).rejects.toThrow();
      expect(input.storage.getItem(oldKey)).toBe(raw);
      expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
    },
  );
  it('does not replace a newer legacy raw written during resolution', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    const newer = JSON.stringify({ projectId: 'project-q', images: [c] });
    expect(await migrateLegacyCanvasBridge({ ...migration(input), resolveReference: async reference => {
      input.storage.setItem(oldKey, newer);
      return reference.assetVersionId === 'version-a' ? a : b;
    } })).toBe('waiting');
    expect(input.storage.getItem(oldKey)).toBe(newer);
    expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
  });
  it('keeps a newer legacy raw when it changes during the scoped enqueue', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    const newer = JSON.stringify({ projectId: 'project-q', images: [c] });
    const setItem = input.storage.setItem.bind(input.storage);
    input.storage.setItem = (key: string, value: string): void => {
      setItem(key, value);
      if (key === canvasBridgeStorageKey(scope)) setItem(oldKey, newer);
    };
    expect(await migrateLegacyCanvasBridge(migration(input))).toBe('waiting');
    expect(input.storage.getItem(oldKey)).toBe(newer);
    expect(readCanvasBridgeJournal(input.storage, scope)?.items).toHaveLength(2);
  });
  it('does not clear the legacy record when scoped storage refuses the migration', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    input.storage.setItem = (): void => { throw new Error('quota exceeded'); };
    await expect(migrateLegacyCanvasBridge(migration(input))).rejects.toThrow('quota exceeded');
    expect(input.storage.getItem(oldKey)).toBe(oldRaw);
  });
  it('rejects a canonical reference that differs from the frozen legacy identity', async () => {
    const input = fixture();
    input.storage.setItem(oldKey, oldRaw);
    await expect(migrateLegacyCanvasBridge({ ...migration(input), resolveReference: async () => b }))
      .rejects.toThrow('CANVAS_BRIDGE_REFERENCE_INVALID');
    expect(input.storage.getItem(oldKey)).toBe(oldRaw);
    expect(readCanvasBridgeJournal(input.storage, scope)).toBeNull();
  });
  it('retains old raw when a duplicate scoped journal contains an incorrect saved key', async () => {
    const input = fixture();
    const journal = await enqueueCanvasBridgeReferences({ ...input, references: [a] });
    journal.items[0].idempotencyKey = 'chat-bridge:' + '0'.repeat(64);
    const damaged = JSON.stringify(journal);
    input.storage.setItem(canvasBridgeStorageKey(scope), damaged);
    input.storage.setItem(oldKey, oldRaw);
    await expect(migrateLegacyCanvasBridge(migration(input))).rejects.toThrow('CANVAS_BRIDGE_JOURNAL_INVALID');
    expect(input.storage.getItem(oldKey)).toBe(oldRaw);
    expect(input.storage.getItem(canvasBridgeStorageKey(scope))).toBe(damaged);
  });
});
