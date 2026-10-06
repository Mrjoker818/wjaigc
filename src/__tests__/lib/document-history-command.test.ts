import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { applyCanvasAssetCommand, captureDocumentPlacementRemovalSnapshot, parseDocumentAssetCommandRequest, type DocumentAssetCommandResult } from '@/lib/collaboration/canvas-asset-command';
import { applyCanvasImagePatch, readCanvasDocument, tombstoneCanvasGroup } from '@/lib/collaboration/canvas-document';
import {
  documentHistoryCommandStorageKey, readDocumentHistoryCommandJournal, recoverDocumentHistoryCommands, runDocumentHistoryCommand, runDocumentHistoryRestoration,
  confirmDocumentHistoryRestorationMetadata,
  type DocumentHistoryCommand, type DocumentHistoryCommandBoundary, type DocumentHistoryCommandJournal, type DocumentHistoryRestorationResult,
} from '@/lib/collaboration/document-history-command';

const scope = { actorId: 'actor-a', projectId: 'project-p' };
const remove: DocumentHistoryCommand = { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-a' };
const attach: Extract<DocumentHistoryCommand, { action: 'attach' }> = { action: 'attach', assetVersionId: 'version-a',
  transform: { x: 100, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 } };
const key = 'wujie:document-history:v1:%5B%22actor-a%22%2C%22project-p%22%5D';

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length(): number { return values.size; },
    key: (index: number): string | null => [...values.keys()][index] ?? null,
    getItem: (name: string): string | null => values.get(name) ?? null,
    setItem: (name: string, value: string): void => { values.set(name, value); },
    removeItem: (name: string): void => { values.delete(name); }, clear: (): void => { values.clear(); } };
}
function locks(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  const request = <T>(name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => {
    const next = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
    tails.set(name, next.catch(() => undefined));
    return next;
  };
  return { request, query: async () => ({ held: [], pending: [] }) } as LockManager;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function fixture(): {
  input: DocumentHistoryCommandBoundary; doc: Y.Doc; requests: Array<{ url: string; init: RequestInit }>;
  posts: Array<ReturnType<typeof parseDocumentAssetCommandRequest>>;
  directory: () => Record<string, unknown>; receipts: Map<string, DocumentAssetCommandResult>;
  loseNext: () => void; setCurrent: (value: boolean) => void; setSequence: (value: number) => void;
} {
  const doc = new Y.Doc();
  applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'version-a', ...attach.transform }, 'fixture');
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const posts: Array<ReturnType<typeof parseDocumentAssetCommandRequest>> = [];
  const receipts = new Map<string, DocumentAssetCommandResult>();
  let sequence = 1, restored = 0, current = true, lose = false;
  const directory = (): Record<string, unknown> => {
    const projection = readCanvasDocument(doc);
    return { success: true, projectId: 'project-p', sequence, readOnly: false, projection,
      canvasImages: Object.entries(projection.placements).filter(([, placement]) => !placement.deleted)
        .map(([placementId, placement]) => ({ id: placementId, placementId,
          url: '/api/serve-upload/a.png', ...placement, originalWidth: 80, originalHeight: 60, createdAt: 1 })) };
  };
  const input: DocumentHistoryCommandBoundary = { ...scope, storage: storage(), locks: locks(), isCurrent: () => current,
    refreshMedia: async (request): Promise<void> => {
      expect(request).toEqual({ projectId: 'project-p', documentSequence: sequence });
      // Confirm the real transport persisted accepted before entering the slow media refresh.
      const journal = JSON.parse(input.storage.getItem(key) ?? '{}') as DocumentHistoryCommandJournal;
      expect(journal.items.some(item => item.state === 'accepted' && item.receipt?.documentSequence === sequence)).toBe(true);
    },
    fetcher: async (url, init = {}): Promise<Response> => {
      requests.push({ url: String(url), init });
      expect(new Headers(init.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
      expect(init.credentials).toBe('include'); expect(init.cache).toBe('no-store');
      if (String(url).includes('document-project')) return Response.json(directory());
      expect(String(url)).toBe('/api/collaboration/document-assets'); expect(init.method).toBe('POST');
      const journal = JSON.parse(input.storage.getItem(key) ?? '{}') as DocumentHistoryCommandJournal;
      const body = parseDocumentAssetCommandRequest(JSON.parse(String(init.body)));
      expect(journal.items.find(item => item.idempotencyKey === body.idempotencyKey)?.attempted).toBe(true);
      posts.push(body);
      let receipt = receipts.get(body.idempotencyKey);
      if (!receipt) {
        const placementId = body.command.action === 'attach' ? `restored-${++restored}` : body.command.placementId;
        applyCanvasAssetCommand(doc, body.command, placementId);
        receipt = { placementId, assetVersionId: body.command.action === 'attach' ? body.command.assetVersionId : body.command.expectedAssetVersionId,
          documentSequence: ++sequence };
        receipts.set(body.idempotencyKey, receipt);
      }
      if (lose) { lose = false; throw new Error('response lost after commit'); }
      return Response.json({ success: true, ...receipt });
    } };
  return { input, doc, requests, posts, directory, receipts, loseNext: (): void => { lose = true; },
    setCurrent: (value): void => { current = value; }, setSequence: (value): void => { sequence = value; } };
}
function run(f: ReturnType<typeof fixture>, operationId = 'delete-a-1', command = remove): ReturnType<typeof runDocumentHistoryCommand> {
  return runDocumentHistoryCommand({ ...f.input, operationId, command });
}
afterEach(() => { vi.useRealTimers(); });

function restorationFixture(): ReturnType<typeof fixture> {
  const f = fixture();
  f.input.refreshMedia = async (request): Promise<void> => {
    expect(request.projectId).toBe('project-p');
    expect(Number(f.directory().sequence)).toBeGreaterThanOrEqual(request.documentSequence);
    const journal = readDocumentHistoryCommandJournal(f.input.storage, scope);
    expect(journal?.items.some(item => (item.state === 'accepted' && item.receipt?.documentSequence === request.documentSequence)
      // Fresh-page metadata catch-up occurs after attach was independently
      // confirmed, and must be backed by that original bound receipt.
      || (item.restoration && item.state === 'confirmed' && item.receipt!.documentSequence <= request.documentSequence))).toBe(true);
  };
  applyCanvasImagePatch(f.doc, { placementId: 'p1', x: 125, annotation: 'latest note' }, 'remote');
  f.doc.getMap('groupDefinitions').set('group-a', { id: 'group-a', name: 'Current', note: '', imageIds: ['p1'] });
  for (const id of ['annotation-a', 'annotation-b']) f.doc.getMap('annotationRecords').set(id, {
    id, projectId: 'project-p', sourceImageId: 'p1', sourceVersionId: 'version-old', type: 'region',
    geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } }, status: 'ready', createdAt: 1, updatedAt: 2,
  });
  const fetcher = f.input.fetcher!;
  f.input.fetcher = async (url, init): Promise<Response> => {
    if (init?.method !== 'POST') return fetcher(url, init);
    const body = parseDocumentAssetCommandRequest(JSON.parse(String(init.body)));
    const snapshot = body.command.action === 'remove' && !f.receipts.has(body.idempotencyKey)
      ? captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.doc), 'project-p', body.command) : undefined;
    try { await fetcher(url, init); }
    finally {
      const stored = f.receipts.get(body.idempotencyKey);
      if (stored && snapshot) stored.removeSnapshot = snapshot;
    }
    return Response.json({ success: true, ...f.receipts.get(body.idempotencyKey) });
  };
  return f;
}
const mapping = { 'annotation-a': 'annotation-restored-a', 'annotation-b': 'annotation-restored-b' };
function restore(f: ReturnType<typeof fixture>, annotationIds: Record<string, string> | undefined = mapping): ReturnType<typeof runDocumentHistoryRestoration> {
  return runDocumentHistoryRestoration({ ...f.input, operationId: 'undo-delete-a-1', removalOperationId: 'delete-a-1', annotationIds });
}
async function pendingRestorationFixture(): Promise<ReturnType<typeof fixture>> {
  const f = restorationFixture(); await run(f); const fetcher = f.input.fetcher!; let lost = false;
  f.input.fetcher = async (url, init): Promise<Response> => {
    if (!lost && init?.method === 'POST' && JSON.parse(String(init.body)).command.action === 'attach') { lost = true; f.loseNext(); }
    return fetcher(url, init);
  };
  await expect(restore(f)).rejects.toThrow('response lost after commit');
  return f;
}
async function replayBinding(f: ReturnType<typeof fixture>, entry: 'run' | 'recover'): Promise<void> {
  if (entry === 'run') await run(f, 'undo-delete-a-1', { ...attach, transform: { ...attach.transform, x: 125 } });
  else await recoverDocumentHistoryCommands(f.input);
}

// The server Y.Doc models an already accepted metadata frame. Confirmation must
// read this independent directory, never use the caller's local pending view.
async function metadataConfirmationFixture(grouped = false, deleteGroupBeforeMetadata = false): Promise<ReturnType<typeof fixture>> {
  const f = restorationFixture();
  if (grouped) applyCanvasImagePatch(f.doc, { placementId: 'p1', groupId: 'group-a' }, 'fixture');
  await run(f); await restore(f);
  if (deleteGroupBeforeMetadata) tombstoneCanvasGroup(f.doc, 'group-a', 'remote');
  applyCanvasImagePatch(f.doc, { placementId: 'restored-1', annotation: 'latest note',
    ...(grouped && !deleteGroupBeforeMetadata ? { groupId: 'group-a' } : {}) }, 'accepted-metadata-frame');
  if (!deleteGroupBeforeMetadata) f.doc.getMap('groupDefinitions').set('group-a', {
    id: 'group-a', name: 'Remote name', note: 'remote note', imageIds: ['restored-1'] });
  for (const [oldId, newId] of Object.entries(mapping)) {
    f.doc.getMap('annotationRecords').set(newId, { id: newId, projectId: 'project-p', sourceImageId: 'restored-1',
      sourceVersionId: 'version-old', type: 'region', geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
      status: 'ready', createdAt: 1, updatedAt: 2 });
    expect(f.doc.getMap('annotationTombstones').get(oldId)).toBe(true);
  }
  f.setSequence(4); return f;
}
function confirmMetadata(f: ReturnType<typeof fixture>, documentSequence = 4): ReturnType<typeof confirmDocumentHistoryRestorationMetadata> {
  return confirmDocumentHistoryRestorationMetadata({ ...f.input, operationId: 'undo-delete-a-1',
    removalOperationId: 'delete-a-1', documentSequence });
}

// Fresh-page recovery must finish the original durable intent, not reconstruct
// the previous session's Ctrl+Z stack. HTTP and server Y.Doc remain real below.
function recoveryInput(f: ReturnType<typeof fixture>, callback: (result: DocumentHistoryRestorationResult) => Promise<number>):
DocumentHistoryCommandBoundary & { restoreMetadata: typeof callback } {
  return { ...f.input, restoreMetadata: callback };
}
function applyRecoveredMetadata(f: ReturnType<typeof fixture>, result: DocumentHistoryRestorationResult): Promise<number> {
  const placementId = result.item.receipt!.placementId;
  applyCanvasImagePatch(f.doc, { placementId, annotation: 'latest note' }, 'accepted-frame');
  f.doc.getMap('groupDefinitions').set('group-a', { id: 'group-a', name: 'Remote name', note: '', imageIds: [placementId] });
  for (const [oldId, newId] of Object.entries(result.annotationIds)) {
    f.doc.getMap('annotationRecords').set(newId, { ...result.removalSnapshot.annotationRecords[oldId], id: newId, sourceImageId: placementId });
  }
  f.setSequence(4); return Promise.resolve(4);
}
describe('fresh page durable metadata recovery', () => {
  it.each(['pending', 'accepted', 'confirmed'] as const)('finishes an %s attach using the original map and key', async state => {
    const f = state === 'pending' ? await pendingRestorationFixture() : restorationFixture();
    if (state !== 'pending') { await run(f); await restore(f); }
    if (state === 'accepted') {
      const journal = readDocumentHistoryCommandJournal(f.input.storage, scope)!;
      journal.items[1].state = 'accepted'; f.input.storage.setItem(key, JSON.stringify(journal));
    }
    const original = readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1];
    const results = await recoverDocumentHistoryCommands(recoveryInput(f, result => applyRecoveredMetadata(f, result)));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ operationId: 'undo-delete-a-1', idempotencyKey: original.idempotencyKey, metadataConfirmedSequence: 4 });
    expect(f.receipts.size).toBe(2);
    expect(f.doc.getMap('annotationRecords').get('annotation-restored-a')).toMatchObject({ sourceImageId: 'restored-1', sourceVersionId: 'version-old' });
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).toMatchObject({ metadataConfirmedSequence: 4, restoration: { annotationIds: mapping } });
  });
  it('recognizes a committed metadata frame before checkpoint save without writing another frame', async () => {
    const f = await metadataConfirmationFixture(), bytes = Y.encodeStateAsUpdate(f.doc);
    const result = await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('must not write committed metadata'); }));
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ metadataConfirmedSequence: 4 });
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(bytes); expect(f.receipts.size).toBe(2);
  });
  it('does not replay completed restorations or overwrite later remote edits on the next page', async () => {
    const f = await metadataConfirmationFixture(); await confirmMetadata(f);
    applyCanvasImagePatch(f.doc, { placementId: 'restored-1', annotation: 'later remote edit' }, 'remote');
    const requests = f.requests.length;
    expect(await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('must not overwrite'); }))).toEqual([]);
    expect(f.requests).toHaveLength(requests);
    expect(f.doc.getMap('annotations').get('restored-1')).toBe('later remote edit');
  });
  it.each(['partial-record', 'changed-note', 'target-tombstone', 'missing-group'] as const)('keeps %s conflict as a failed pending recovery without repair', async kind => {
    const f = restorationFixture(); await run(f); await restore(f);
    if (kind === 'partial-record') f.doc.getMap('annotationRecords').set('annotation-restored-a', {
      ...f.doc.getMap('annotationRecords').get('annotation-a') as object, id: 'annotation-restored-a', sourceImageId: 'restored-1' });
    if (kind === 'changed-note') applyCanvasImagePatch(f.doc, { placementId: 'restored-1', annotation: 'someone else' }, 'remote');
    if (kind === 'target-tombstone') {
      f.doc.getMap('annotationRecords').set('annotation-restored-a', {
        ...f.doc.getMap('annotationRecords').get('annotation-a') as object, id: 'annotation-restored-a', sourceImageId: 'restored-1' });
      f.doc.getMap('annotationTombstones').set('annotation-restored-a', true);
    }
    if (kind === 'missing-group') f.doc.getMap('groupDefinitions').delete('group-a');
    const bytes = Y.encodeStateAsUpdate(f.doc);
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('DOCUMENT_HISTORY_METADATA_CONFLICT');
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(bytes);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
  });
  it('never repairs after current server authorization is revoked', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    f.input.fetcher = async () => Response.json({ success: false }, { status: 403 });
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('DOCUMENT_HISTORY_COMMAND_REJECTED:403');
  });
  it('skips a superseded new placement without resurrecting either identity', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    applyCanvasAssetCommand(f.doc, { action: 'remove', placementId: 'restored-1', expectedAssetVersionId: 'version-a' }, 'restored-1');
    const bytes = Y.encodeStateAsUpdate(f.doc);
    const result = await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }));
    expect(result).toHaveLength(1); expect(result[0].state).toBe('superseded'); expect(Y.encodeStateAsUpdate(f.doc)).toEqual(bytes);
  });
  it('keeps an accepted frame retryable when its completion checkpoint cannot be persisted', async () => {
    const f = await metadataConfirmationFixture(), setter = f.input.storage.setItem.bind(f.input.storage);
    f.input.storage.setItem = (name, value): void => {
      if (name === key && value.includes('metadataConfirmedSequence')) throw new Error('checkpoint storage refused');
      setter(name, value);
    };
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('checkpoint storage refused');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
    f.input.storage.setItem = setter;
    const result = await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }));
    expect(result[0]).toMatchObject({ metadataConfirmedSequence: 4 }); expect(f.receipts.size).toBe(2);
  });
  it('rejects changed scope after metadata ACK without checkpointing the old scope', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async result => {
      await applyRecoveredMetadata(f, result); f.setCurrent(false); return 4;
    }))).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
  });
  it('retains the same recovery on callback failure and finishes it on explicit retry', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('frame persistence refused'); }))).rejects.toThrow('frame persistence refused');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
    const result = await recoverDocumentHistoryCommands(recoveryInput(f, restored => applyRecoveredMetadata(f, restored)));
    expect(result[0]).toMatchObject({ metadataConfirmedSequence: 4 }); expect(f.receipts.size).toBe(2);
  });
  it('catches the session up to the authoritative metadata directory before writing current group membership', async () => {
    const f = restorationFixture(); await run(f); await restore(f); f.setSequence(4);
    let refreshed = 0;
    f.input.refreshMedia = async request => { refreshed = request.documentSequence; };
    await recoverDocumentHistoryCommands(recoveryInput(f, async restored => {
      expect(refreshed).toBe(4);
      return applyRecoveredMetadata(f, restored);
    }));
    expect(readCanvasDocument(f.doc).annotationRecords?.['annotation-restored-a']).toMatchObject({ sourceImageId: 'restored-1' });
  });
  it('does not use malformed authoritative metadata as permission to write a frame', async () => {
    const f = restorationFixture(); await run(f); await restore(f); const fetcher = f.input.fetcher!; let gets = 0;
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init);
      return init?.method === 'GET' && ++gets === 3 ? Response.json({ success: true, projectId: 'another-project' }) : response;
    };
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
  });
  it('does not mistake an invalid callback ACK sequence for completion', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async restored => {
      await applyRecoveredMetadata(f, restored); return -1;
    }))).rejects.toThrow('DOCUMENT_HISTORY_METADATA_SEQUENCE_INVALID');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
    expect((await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('must not repeat committed frame'); })))[0]).toMatchObject({ metadataConfirmedSequence: 4 });
  });
  it('bounds metadata recovery waiting and leaves the durable completion unmarked', async () => {
    const f = restorationFixture(); await run(f); await restore(f); vi.useFakeTimers();
    const began = deferred<void>(), frame = deferred<number>();
    const result = recoverDocumentHistoryCommands(recoveryInput(f, () => { began.resolve(); return frame.promise; }));
    const rejected = expect(result).rejects.toThrow('DOCUMENT_HISTORY_METADATA_TIMEOUT');
    await began.promise; await vi.advanceTimersByTimeAsync(10_001); await rejected;
    frame.resolve(4); await Promise.resolve();
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
  });
  it('keeps the first completion sequence when independent confirmation is repeated later', async () => {
    const f = await metadataConfirmationFixture(); await confirmMetadata(f); f.setSequence(9);
    expect((await confirmMetadata(f, 9)).item).toMatchObject({ metadataConfirmedSequence: 4 });
  });
  it('refuses loss of a completed checkpoint relative to the durable backup', async () => {
    const f = await metadataConfirmationFixture(); await confirmMetadata(f); await confirmMetadata(f);
    const journal = readDocumentHistoryCommandJournal(f.input.storage, scope)!;
    delete journal.items[1].metadataConfirmedSequence; f.input.storage.setItem(key, JSON.stringify(journal));
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
  });
  it.each([1, -1, 3.5, Number.MAX_SAFE_INTEGER + 1] as const)('rejects an invalid completion sequence %s before HTTP', async sequence => {
    const f = restorationFixture(); await run(f); await restore(f);
    const journal = readDocumentHistoryCommandJournal(f.input.storage, scope)!;
    journal.items[1].metadataConfirmedSequence = sequence; f.input.storage.setItem(key, JSON.stringify(journal));
    const requests = f.requests.length;
    await expect(recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('unsafe write'); }))).rejects.toThrow('DOCUMENT_HISTORY_JOURNAL_INVALID');
    expect(f.requests).toHaveLength(requests);
  });
});

describe('authoritative restoration metadata confirmation', () => {
  it('independently confirms restored annotations carrying their original order keys', async () => {
    const f = await metadataConfirmationFixture();
    for (const [oldId, newId] of Object.entries(mapping)) {
      const record = f.doc.getMap('annotationRecords').get(newId) as Record<string, unknown>;
      f.doc.getMap('annotationRecords').set(newId, { ...record, orderKey: oldId });
    }
    expect((await confirmMetadata(f)).item).toMatchObject({ metadataConfirmedSequence: 4 });
    const before = Y.encodeStateAsUpdate(f.doc);
    expect(await recoverDocumentHistoryCommands(recoveryInput(f, async () => { throw new Error('must not rewrite complete metadata'); }))).toEqual([]);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  });

  it('rejects a restored order key that differs from the frozen original identity', async () => {
    const f = await metadataConfirmationFixture();
    const record = f.doc.getMap('annotationRecords').get('annotation-restored-a') as Record<string, unknown>;
    f.doc.getMap('annotationRecords').set('annotation-restored-a', { ...record, orderKey: 'different-annotation' });
    await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
  });

  it.each(['preserved', 'missing', 'changed'] as const)('checks a previously frozen order key when restored metadata is %s', async variant => {
    const f = restorationFixture();
    const original = f.doc.getMap('annotationRecords').get('annotation-a') as Record<string, unknown>;
    f.doc.getMap('annotationRecords').set('annotation-a', { ...original, orderKey: 'creation-a' });
    await run(f);
    const restored = await restore(f);
    await applyRecoveredMetadata(f, restored);
    const target = f.doc.getMap('annotationRecords').get('annotation-restored-a') as Record<string, unknown>;
    if (variant === 'missing') {
      const withoutKey = { ...target };
      delete withoutKey.orderKey;
      f.doc.getMap('annotationRecords').set('annotation-restored-a', withoutKey);
    } else if (variant === 'changed') {
      f.doc.getMap('annotationRecords').set('annotation-restored-a', { ...target, orderKey: 'annotation-a' });
    }
    if (variant === 'preserved') expect((await confirmMetadata(f)).item.metadataConfirmedSequence).toBe(4);
    else {
      await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
      expect(readDocumentHistoryCommandJournal(f.input.storage, scope)!.items[1]).not.toHaveProperty('metadataConfirmedSequence');
    }
  });

  it('reauthorizes the durable identities then confirms complete server metadata without replacing remote group properties', async () => {
    const f = await metadataConfirmationFixture(); const before = Y.encodeStateAsUpdate(f.doc), offset = f.requests.length;
    const result = await confirmMetadata(f);
    expect(result.item).toMatchObject({ state: 'confirmed', receipt: { placementId: 'restored-1', assetVersionId: 'version-a' } });
    expect(result.annotationIds).toEqual(mapping);
    expect(f.requests.slice(offset).map(request => request.init.method)).toEqual(['POST', 'GET', 'POST', 'GET', 'GET']);
    expect(f.posts.slice(-2).map(post => post.command.action)).toEqual(['remove', 'attach']);
    expect(f.receipts.size).toBe(2); expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(f.doc.getMap('groupDefinitions').get('group-a')).toMatchObject({ name: 'Remote name', note: 'remote note' });
  });
  it('does not mistake an attach receipt and local ACK sequence for persisted metadata', async () => {
    const f = restorationFixture(); await run(f); await restore(f); f.setSequence(4);
    await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
    expect(f.receipts.size).toBe(2);
  });
  it.each(['missing-annotation', 'changed-content', 'wrong-source', 'new-tombstone', 'old-tombstone-lost', 'group-member-lost', 'optional-note-lost'] as const)
    ('refuses %s server metadata without repairing or completing history', async variant => {
      const f = await metadataConfirmationFixture();
      if (variant === 'missing-annotation') f.doc.getMap('annotationRecords').delete('annotation-restored-a');
      else if (variant === 'new-tombstone') f.doc.getMap('annotationTombstones').set('annotation-restored-a', true);
      else if (variant === 'wrong-source' || variant === 'old-tombstone-lost') {
        const fetcher = f.input.fetcher!; let gets = 0;
        f.input.fetcher = async (url, init): Promise<Response> => {
          const response = await fetcher(url, init);
          if (init?.method !== 'GET' || ++gets !== 3) return response;
          const payload = await response.json() as { projection: { annotationRecords: Record<string, { sourceImageId: string }>;
            annotationTombstones: Record<string, true> } };
          // These deliberately malformed final responses must not invalidate
          // the independent reauthorization reads that precede confirmation.
          if (variant === 'wrong-source') payload.projection.annotationRecords['annotation-restored-a'].sourceImageId = 'p1';
          else delete payload.projection.annotationTombstones['annotation-a'];
          return Response.json(payload);
        };
      }
      else if (variant === 'group-member-lost') f.doc.getMap('groupDefinitions').set('group-a', { id: 'group-a', name: 'Remote', note: '', imageIds: [] });
      else if (variant === 'optional-note-lost') applyCanvasImagePatch(f.doc, { placementId: 'restored-1', annotation: 'remote changed' }, 'remote');
      else {
        const record = f.doc.getMap('annotationRecords').get('annotation-restored-a') as Record<string, unknown>;
        f.doc.getMap('annotationRecords').set('annotation-restored-a', { ...record, status: 'stale', updatedAt: 99 });
      }
      const before = Y.encodeStateAsUpdate(f.doc);
      await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
      expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before); expect(f.receipts.size).toBe(2);
    });
  it('does not resurrect a concurrently deleted group to claim confirmation', async () => {
    const f = await metadataConfirmationFixture(); f.doc.getMap('groupTombstones').set('group-a', true);
    const before = Y.encodeStateAsUpdate(f.doc);
    expect((await confirmMetadata(f)).item.state).toBe('confirmed'); expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  });
  it('confirms restored placement groupId cleared by a real concurrent group deletion without resurrecting the group', async () => {
    const f = await metadataConfirmationFixture(true);
    tombstoneCanvasGroup(f.doc, 'group-a', 'remote'); f.setSequence(5);
    expect(readCanvasDocument(f.doc).placements['restored-1'].groupId).toBeNull();
    const before = Y.encodeStateAsUpdate(f.doc);
    const result = await confirmMetadata(f);
    expect(result.item.receipt?.placementId).toBe('restored-1');
    expect(result.removalSnapshot.placement.groupId).toBe('group-a');
    expect(result.item.state).toBe('confirmed'); expect(f.receipts.size).toBe(2);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(readCanvasDocument(f.doc).groupTombstones?.['group-a']).toBe(true);
  });
  it('does not accept cleared placement groupId while its original group remains live', async () => {
    const f = await metadataConfirmationFixture(true);
    applyCanvasImagePatch(f.doc, { placementId: 'restored-1', groupId: null }, 'remote');
    const before = Y.encodeStateAsUpdate(f.doc);
    await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before); expect(f.receipts.size).toBe(2);
  });
  it('confirms a missing groupId when remote group deletion precedes the metadata restoration frame', async () => {
    const f = await metadataConfirmationFixture(true, true);
    expect(readCanvasDocument(f.doc).placements['restored-1'].groupId).toBeUndefined();
    const before = Y.encodeStateAsUpdate(f.doc);
    const result = await confirmMetadata(f);
    expect(result.removalSnapshot.placement.groupId).toBe('group-a'); expect(result.item.state).toBe('confirmed');
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before); expect(f.receipts.size).toBe(2);
    expect(readCanvasDocument(f.doc).groupTombstones?.['group-a']).toBe(true);
  });
  it('does not accept unrelated reassignment after the original group is deleted', async () => {
    const f = await metadataConfirmationFixture(true);
    tombstoneCanvasGroup(f.doc, 'group-a', 'remote');
    f.doc.getMap('groupDefinitions').set('group-b', { id: 'group-b', name: 'Other', note: '', imageIds: ['restored-1'] });
    applyCanvasImagePatch(f.doc, { placementId: 'restored-1', groupId: 'group-b' }, 'remote');
    const before = Y.encodeStateAsUpdate(f.doc);
    await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_UNCONFIRMED');
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before); expect(f.receipts.size).toBe(2);
  });
  it.each(['old-sequence', 'read-only', 'wrong-project', 'incomplete', 'forbidden'] as const)
    ('requires fresh authorized complete %s final directory after the replay reads', async variant => {
      const f = await metadataConfirmationFixture(); const fetcher = f.input.fetcher!; let gets = 0;
      f.input.fetcher = async (url, init): Promise<Response> => {
        if (init?.method === 'GET' && ++gets === 3) {
          if (variant === 'forbidden') return Response.json({ success: false }, { status: 403 });
          const payload = f.directory();
          if (variant === 'old-sequence') payload.sequence = 3;
          else if (variant === 'read-only') payload.readOnly = true;
          else if (variant === 'wrong-project') payload.projectId = 'project-other';
          else payload.canvasImages = [];
          return Response.json(payload);
        }
        return fetcher(url, init);
      };
      await expect(confirmMetadata(f)).rejects.toThrow(); expect(gets).toBe(3); expect(f.receipts.size).toBe(2);
    });
  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid ACK sequence %s before commands or storage', async sequence => {
    const f = await metadataConfirmationFixture(); const count = f.requests.length, raw = f.input.storage.getItem(key);
    await expect(confirmMetadata(f, sequence)).rejects.toThrow('DOCUMENT_HISTORY_METADATA_SEQUENCE_INVALID');
    expect(f.requests).toHaveLength(count); expect(f.input.storage.getItem(key)).toBe(raw);
  });
  it('rejects a stale scope on the final directory JSON await rather than delivering confirmation', async () => {
    const f = await metadataConfirmationFixture(); const fetcher = f.input.fetcher!; let gets = 0;
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init);
      if (init?.method === 'GET' && ++gets === 3) return { status: 200, json: async (): Promise<unknown> => {
        const payload: unknown = await response.json(); f.setCurrent(false); return payload;
      } } as Response;
      return response;
    };
    await expect(confirmMetadata(f)).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED'); expect(gets).toBe(3);
  });
  it('releases a final non-aborting body deadline and retains the same durable restoration binding', async () => {
    const f = await metadataConfirmationFixture(); const fetcher = f.input.fetcher!; let gets = 0; const started = deferred<void>();
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (init?.method === 'GET' && ++gets === 3) return { status: 200, json: (): Promise<unknown> => {
        started.resolve(); return new Promise(() => {});
      } } as Response;
      return fetcher(url, init);
    };
    vi.useFakeTimers(); const pending = confirmMetadata(f).then(() => 'unexpected success', (error: Error) => error.message);
    await started.promise; expect(gets).toBe(3);
    await vi.advanceTimersByTimeAsync(10_000); expect(await pending).toBe('DOCUMENT_HISTORY_REQUEST_TIMEOUT');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({
      state: 'confirmed', restoration: { annotationIds: mapping }, receipt: { placementId: 'restored-1' },
    });
    expect(f.receipts.size).toBe(2); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('durable restoration identity binding', () => {
  it.each(['run', 'recover'] as const)('reauthorizes removal before ordinary %s retries a pending bound attach', async entry => {
    const f = await pendingRestorationFixture(); const before = f.posts.length;
    await replayBinding(f, entry);
    expect(f.posts.slice(before).map(post => post.command.action)).toEqual(['remove', 'attach']);
    expect(f.posts.filter(post => post.command.action === 'attach')[1]).toEqual(f.posts.filter(post => post.command.action === 'attach')[0]);
    expect(f.receipts.size).toBe(2);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({ state: 'confirmed', restoration: { annotationIds: mapping } });
  });
  it.each(['run', 'recover'] as const)('ordinary %s does not attach after removal reauthorization rejects', async entry => {
    const f = await pendingRestorationFixture(); const fetcher = f.input.fetcher!, actions: string[] = [];
    f.input.fetcher = async (url, init): Promise<Response> => {
      const action = init?.method === 'POST' ? JSON.parse(String(init.body)).command.action : 'directory'; actions.push(action);
      return action === 'remove' ? Response.json({ success: false }, { status: 403 }) : fetcher(url, init);
    };
    await expect(replayBinding(f, entry)).rejects.toThrow('DOCUMENT_HISTORY_COMMAND_REJECTED:403');
    expect(actions).toEqual(['remove']);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({ state: 'pending', restoration: { annotationIds: mapping } });
  });
  it.each(['run', 'recover'] as const)('ordinary %s rejects a changed removal preimage before attaching', async entry => {
    const f = await pendingRestorationFixture(); const fetcher = f.input.fetcher!, actions: string[] = [];
    f.input.fetcher = async (url, init): Promise<Response> => {
      const action = init?.method === 'POST' ? JSON.parse(String(init.body)).command.action : 'directory'; actions.push(action);
      const response = await fetcher(url, init);
      if (action !== 'remove') return response;
      const payload = await response.json(); payload.removeSnapshot.placement.x = 999;
      return Response.json(payload);
    };
    await expect(replayBinding(f, entry)).rejects.toThrow('DOCUMENT_HISTORY_RECEIPT_INVALID');
    expect(actions).toEqual(['remove']);
  });
  it.each(['run', 'recover'] as const)('ordinary %s rejects an unconfirmed removal directory before attaching', async entry => {
    const f = await pendingRestorationFixture(); const fetcher = f.input.fetcher!, actions: string[] = [];
    f.input.fetcher = async (url, init): Promise<Response> => {
      const action = init?.method === 'POST' ? JSON.parse(String(init.body)).command.action : 'directory'; actions.push(action);
      return action === 'directory' ? Response.json({ ...f.directory(), sequence: 1 }) : fetcher(url, init);
    };
    await expect(replayBinding(f, entry)).rejects.toThrow('DOCUMENT_HISTORY_DIRECTORY_UNCONFIRMED');
    expect(actions).toEqual(['remove', 'directory']);
  });
  it('requires an explicit empty map on first restore without annotations but permits omission on retry', async () => {
    const f = restorationFixture(); f.doc.getMap('annotationRecords').clear(); await run(f);
    const before = f.input.storage.getItem(key), count = f.posts.length;
    await expect(runDocumentHistoryRestoration({ ...f.input, operationId: 'undo-delete-a-1', removalOperationId: 'delete-a-1' }))
      .rejects.toThrow('DOCUMENT_HISTORY_RESTORATION_INVALID');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(count);
    expect((await restore(f, {})).annotationIds).toEqual({});
    expect((await runDocumentHistoryRestoration({ ...f.input, operationId: 'undo-delete-a-1', removalOperationId: 'delete-a-1' })).annotationIds).toEqual({});
  });
  it('freezes the complete mapping before attach and derives geometry from the authorized removal', async () => {
    const f = restorationFixture(); await run(f); const fetcher = f.input.fetcher!;
    let savedBeforeAttach = false;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (init?.method === 'POST' && JSON.parse(String(init.body)).command.action === 'attach') {
        expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({
          attempted: true, restoration: { removalOperationId: 'delete-a-1', annotationIds: mapping },
        }); savedBeforeAttach = true;
      }
      return fetcher(url, init);
    };
    const result = await restore(f);
    expect(savedBeforeAttach).toBe(true);
    expect(result).toMatchObject({ item: { state: 'confirmed', receipt: { placementId: 'restored-1' } },
      annotationIds: mapping, removalSnapshot: { placement: { x: 125, annotation: 'latest note' }, groupIds: ['group-a'],
        annotationRecords: { 'annotation-a': { sourceVersionId: 'version-old' } } } });
    expect(f.posts.map(post => post.command.action)).toEqual(['remove', 'remove', 'attach']);
    expect(readCanvasDocument(f.doc).placements).toMatchObject({ p1: { deleted: true }, 'restored-1': {
      assetVersionId: 'version-a', x: 125, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    } });
    result.annotationIds['annotation-a'] = 'mutated';
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({ restoration: { annotationIds: mapping } });
  });
  it('recovers a lost attach receipt after reload without supplying or reallocating the mapping', async () => {
    const f = restorationFixture(); await run(f); const fetcher = f.input.fetcher!; let lost = false;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (!lost && init?.method === 'POST' && JSON.parse(String(init.body)).command.action === 'attach') { lost = true; f.loseNext(); }
      return fetcher(url, init);
    };
    await expect(restore(f)).rejects.toThrow('response lost after commit');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[1]).toMatchObject({ state: 'pending', restoration: { annotationIds: mapping } });
    const result = await runDocumentHistoryRestoration({ ...f.input, operationId: 'undo-delete-a-1', removalOperationId: 'delete-a-1' });
    expect(result.item).toMatchObject({ state: 'confirmed', receipt: { placementId: 'restored-1' } });
    expect(result.annotationIds).toEqual(mapping);
    expect(f.posts.filter(post => post.command.action === 'attach')).toHaveLength(2);
    expect(f.posts.filter(post => post.command.action === 'attach')[1]).toEqual(f.posts.filter(post => post.command.action === 'attach')[0]);
    expect(f.receipts.size).toBe(2);
  });
  it('refuses changed mapping before replaying any command', async () => {
    const f = restorationFixture(); await run(f); await restore(f); const before = f.input.storage.getItem(key), count = f.posts.length;
    await expect(restore(f, { ...mapping, 'annotation-a': 'different-a' })).rejects.toThrow('DOCUMENT_HISTORY_RESTORATION_CHANGED');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(count);
  });
  it.each([
    ['missing', { 'annotation-a': 'new-a' }], ['extra', { ...mapping, extra: 'new-extra' }],
    ['duplicate', { 'annotation-a': 'new-a', 'annotation-b': 'new-a' }],
    ['unsafe', { ...mapping, 'annotation-a': '__proto__' }], ['old-id', { ...mapping, 'annotation-a': 'annotation-b' }],
  ] as const)('rejects %s mapping without an attach or journal replacement', async (_kind, ids) => {
    const f = restorationFixture(); await run(f); const before = f.input.storage.getItem(key);
    await expect(restore(f, { ...ids })).rejects.toThrow('DOCUMENT_HISTORY_RESTORATION_INVALID');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts.every(post => post.command.action === 'remove')).toBe(true);
  });
  it('refuses legacy remove without a preimage instead of synthesizing restoration data', async () => {
    const f = fixture(); await run(f); const before = f.input.storage.getItem(key);
    await expect(restore(f, {})).rejects.toThrow('DOCUMENT_HISTORY_REMOVAL_SNAPSHOT_REQUIRED');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(1);
  });
  it('reauthorizes the removal and does not attach after editor revocation', async () => {
    const f = restorationFixture(); await run(f); const before = f.input.storage.getItem(key);
    f.input.fetcher = async (): Promise<Response> => Response.json({ success: false }, { status: 403 });
    await expect(restore(f)).rejects.toThrow('DOCUMENT_HISTORY_COMMAND_REJECTED:403');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(1);
  });
  it('does not attach when frozen mapping cannot be durably saved', async () => {
    const f = restorationFixture(); await run(f); const storageSet = f.input.storage.setItem;
    f.input.storage.setItem = (name, value): void => {
      if (name === key && value.includes('"restoration"')) throw new Error('disk full');
      storageSet(name, value);
    };
    await expect(restore(f)).rejects.toThrow('disk full');
    expect(f.posts.every(post => post.command.action === 'remove')).toBe(true);
    expect(readCanvasDocument(f.doc).placements['restored-1']).toBeUndefined();
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items).toHaveLength(1);
  });
  it('detects a lost restoration binding against the previous backup before ordinary replay', async () => {
    const f = restorationFixture(); await run(f); await restore(f);
    const raw = JSON.parse(f.input.storage.getItem(key)!); delete raw.items[1].restoration;
    f.input.storage.setItem(key, JSON.stringify(raw)); const count = f.posts.length;
    await expect(run(f, 'undo-delete-a-1', { ...attach, transform: { ...attach.transform, x: 125 } })).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
    expect(f.posts).toHaveLength(count);
  });
  it('does not adopt an ordinary attach with the same operation as a bound restoration', async () => {
    const f = restorationFixture(); await run(f); await run(f, 'undo-delete-a-1', { ...attach, transform: { ...attach.transform, x: 125 } });
    const before = f.input.storage.getItem(key), count = f.posts.length;
    await expect(restore(f)).rejects.toThrow('DOCUMENT_HISTORY_RESTORATION_CHANGED');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(count);
  });
  it('rejects old project callbacks before reading or writing the journal', async () => {
    const f = restorationFixture(); await run(f); f.setCurrent(false); const before = f.input.storage.getItem(key);
    await expect(restore(f)).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(1);
  });
  it('keeps earlier binding valid when a later redo snapshot contains its restored annotation identities', async () => {
    const f = restorationFixture(); await run(f); const first = await restore(f);
    for (const [oldId, newId] of Object.entries(first.annotationIds)) f.doc.getMap('annotationRecords').set(newId, {
      ...first.removalSnapshot.annotationRecords[oldId], id: newId, sourceImageId: 'restored-1',
    });
    await run(f, 'redo-delete-a-1', { action: 'remove', placementId: 'restored-1', expectedAssetVersionId: 'version-a' });
    const second = await runDocumentHistoryRestoration({ ...f.input, operationId: 'undo-delete-a-2', removalOperationId: 'redo-delete-a-1',
      annotationIds: { 'annotation-restored-a': 'annotation-cycle2-a', 'annotation-restored-b': 'annotation-cycle2-b' } });
    expect(second.item.receipt?.placementId).toBe('restored-2');
    expect(readCanvasDocument(f.doc).placements.p1.deleted).toBe(true);
    expect(readCanvasDocument(f.doc).placements['restored-1'].deleted).toBe(true);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items).toHaveLength(4);
  });
  it('refuses a second restoration that reuses an earlier frozen target', async () => {
    const f = restorationFixture(); await run(f); await restore(f); const before = f.input.storage.getItem(key), count = f.posts.length;
    await expect(runDocumentHistoryRestoration({ ...f.input, operationId: 'different-restore', removalOperationId: 'delete-a-1', annotationIds: mapping }))
      .rejects.toThrow('DOCUMENT_HISTORY_RESTORATION_INVALID');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(count);
  });
  it('detaches requested identities while waiting for the lock', async () => {
    const f = restorationFixture(); await run(f); const gate = deferred<void>(), originalLocks = f.input.locks!;
    f.input.locks = { ...originalLocks, request: async (name: string, callback: (lock: Lock | null) => unknown): Promise<unknown> => {
      await gate.promise; return originalLocks.request(name, callback);
    } } as LockManager;
    const ids = { ...mapping }; const pending = restore(f, ids); ids['annotation-a'] = 'mutated-after-call'; gate.resolve();
    expect((await pending).annotationIds).toEqual(mapping);
  });
  it('rejects a project switch during removal authorization without creating a restoration', async () => {
    const f = restorationFixture(); await run(f); const fetcher = f.input.fetcher!;
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init); f.setCurrent(false); return response;
    };
    await expect(restore(f)).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect(f.posts).toHaveLength(2);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items).toHaveLength(1);
  });
});

describe('durable document remove/attach history command transport', () => {
  it('persists the complete authorized deletion preimage and recovers it unchanged after accepted refresh failure', async () => {
    const f = fixture(); const fetcher = f.input.fetcher!;
    const snapshot = { version: 1, projectId: 'project-p', placementId: 'p1',
      placement: { assetVersionId: 'version-a', ...attach.transform, groupId: 'group-live', annotation: 'keep note' },
      groupIds: ['group-live'], annotationRecords: { 'annotation-a': {
        id: 'annotation-a', projectId: 'project-p', sourceImageId: 'p1', sourceVersionId: 'version-a', type: 'region',
        geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } }, status: 'ready', createdAt: 1, updatedAt: 2,
      } } };
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init);
      return init?.method === 'POST' ? Response.json({ ...await response.json(), removeSnapshot: snapshot }) : response;
    };
    const refresh = f.input.refreshMedia;
    f.input.refreshMedia = async (): Promise<void> => { throw new Error('refresh interrupted'); };
    await expect(run(f)).rejects.toThrow('refresh interrupted');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].receipt).toMatchObject({ removeSnapshot: snapshot });
    f.input.refreshMedia = refresh;
    const recovered = await recoverDocumentHistoryCommands(f.input);
    expect(recovered[0]).toMatchObject({ state: 'confirmed', receipt: { removeSnapshot: snapshot } });
    expect(f.posts[1]).toEqual(f.posts[0]);
    snapshot.placement.x = 999;
    expect(recovered[0].receipt).toMatchObject({ removeSnapshot: { placement: { x: 100 } } });
  });
  it.each(['missing', 'changed'] as const)('rejects %s deletion preimage on explicit replay instead of silently dropping it', async drift => {
    const f = fixture(); const fetcher = f.input.fetcher!; let calls = 0;
    const snapshot = { version: 1, projectId: 'project-p', placementId: 'p1',
      placement: { assetVersionId: 'version-a', ...attach.transform }, groupIds: [], annotationRecords: {} };
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init);
      if (init?.method !== 'POST') return response;
      const payload: unknown = await response.json(); calls++;
      return Response.json({ ...payload as Record<string, unknown>, ...(calls === 1 ? { removeSnapshot: snapshot }
        : drift === 'missing' ? {} : { removeSnapshot: { ...snapshot, placement: { ...snapshot.placement, x: 999 } } }) });
    };
    await run(f); const before = f.input.storage.getItem(key);
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_RECEIPT_INVALID');
    expect(f.input.storage.getItem(key)).toBe(before);
  });
  it.each(['project', 'placement', 'version', 'deleted', 'duplicate-group', 'foreign-annotation'] as const)('rejects invalid %s deletion preimage before accepting its receipt', async invalid => {
    const f = fixture(); const fetcher = f.input.fetcher!;
    const snapshot = { version: 1, projectId: invalid === 'project' ? 'other-project' : 'project-p',
      placementId: invalid === 'placement' ? 'other-placement' : 'p1',
      placement: { assetVersionId: invalid === 'version' ? 'other-version' : 'version-a', ...attach.transform,
        ...(invalid === 'deleted' ? { deleted: false } : {}) },
      groupIds: invalid === 'duplicate-group' ? ['group-a', 'group-a'] : [],
      annotationRecords: invalid === 'foreign-annotation' ? { 'annotation-a': { id: 'annotation-a', projectId: 'other-project',
        sourceImageId: 'p1', sourceVersionId: 'version-a', type: 'region', geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
        status: 'ready', createdAt: 1, updatedAt: 2 } } : {} };
    f.input.fetcher = async (url, init): Promise<Response> => {
      const response = await fetcher(url, init);
      return init?.method === 'POST' ? Response.json({ ...await response.json(), removeSnapshot: snapshot }) : response;
    };
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_RECEIPT_INVALID');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0]).toMatchObject({ state: 'pending', attempted: true });
  });
  it('confirms real remove tombstone only after attempted/accepted storage and complete authoritative directory', async () => {
    const f = fixture(); const result = await run(f);
    expect(result.state).toBe('confirmed');
    expect(result.receipt).toEqual({ placementId: 'p1', assetVersionId: 'version-a', documentSequence: 2 });
    expect(readCanvasDocument(f.doc).placements.p1.deleted).toBe(true);
    const digest = createHash('sha256').update(JSON.stringify(['actor-a', 'project-p', 'delete-a-1', remove])).digest('hex');
    expect(result.idempotencyKey).toBe('document-history:' + digest);
    expect(f.posts).toEqual([{ projectId: 'project-p', idempotencyKey: 'document-history:' + digest, command: remove }]);
    expect(f.requests.map(request => request.url)).toEqual(['/api/collaboration/document-assets', '/api/collaboration/document-project?projectId=project-p']);
    expect(documentHistoryCommandStorageKey(scope)).toBe(key);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0]).toEqual(result);
    expect(f.input.storage.getItem(key)).not.toContain('/api/serve-upload');
  });
  it('recovers a lost remove receipt with identical key/payload after reloading its journal', async () => {
    const f = fixture(); f.loseNext();
    await expect(run(f)).rejects.toThrow('response lost after commit');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0]).toMatchObject({ state: 'pending', attempted: true });
    const result = await recoverDocumentHistoryCommands({ ...f.input });
    expect(result[0].state).toBe('confirmed'); expect(f.posts).toHaveLength(2);
    expect(f.posts[1]).toEqual(f.posts[0]); expect(f.receipts.size).toBe(1);
    const before = f.requests.length;
    expect(await recoverDocumentHistoryCommands(f.input)).toEqual([]);
    expect(f.requests).toHaveLength(before);
  });
  it('creates new identities per restore/redo cycle without reviving the old tombstone', async () => {
    const f = fixture(); await run(f);
    const first = await run(f, 'undo-delete-a-1', attach);
    expect(first.receipt?.placementId).toBe('restored-1');
    await run(f, 'redo-delete-a-1', { action: 'remove', placementId: 'restored-1', expectedAssetVersionId: 'version-a' });
    const second = await run(f, 'undo-delete-a-2', attach);
    expect(second.receipt?.placementId).toBe('restored-2');
    expect(readCanvasDocument(f.doc).placements).toMatchObject({ p1: { deleted: true }, 'restored-1': { deleted: true }, 'restored-2': { assetVersionId: 'version-a' } });
    expect(new Set(f.posts.map(post => post.idempotencyKey)).size).toBe(4);
  });
  it('rejects changed commands for an existing operation instead of reallocating a key', async () => {
    const f = fixture(); await run(f); const before = f.input.storage.getItem(key);
    await expect(run(f, 'delete-a-1', attach)).rejects.toThrow('DOCUMENT_HISTORY_COMMAND_CHANGED');
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(1);
  });
  it('requires fresh authorization even when explicitly retrying a terminal item', async () => {
    const f = fixture(); await run(f); const before = f.input.storage.getItem(key);
    f.input.fetcher = async (): Promise<Response> => Response.json({ success: false, code: 'DOCUMENT_FORBIDDEN' }, { status: 403 });
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_COMMAND_REJECTED:403');
    expect(f.input.storage.getItem(key)).toBe(before);
  });
  it('retains accepted proof if media refresh fails and replays the same receipt on retry', async () => {
    const f = fixture(); const refresh = f.input.refreshMedia;
    f.input.refreshMedia = async (): Promise<void> => { throw new Error('refresh unavailable'); };
    await expect(run(f)).rejects.toThrow('refresh unavailable');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('accepted');
    f.input.refreshMedia = refresh; expect((await run(f)).state).toBe('confirmed');
    expect(f.posts[1]).toEqual(f.posts[0]);
  });
  it.each(['placementId', 'assetVersionId', 'documentSequence'] as const)('rejects replay receipt drift in %s', async field => {
    const f = fixture(); f.input.refreshMedia = async (): Promise<void> => { throw new Error('paused'); };
    await expect(run(f)).rejects.toThrow('paused'); const before = f.input.storage.getItem(key);
    f.input.fetcher = async (): Promise<Response> => Response.json({ success: true, placementId: 'p1', assetVersionId: 'version-a', documentSequence: 2,
      [field]: field === 'documentSequence' ? 3 : 'wrong' });
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_RECEIPT_INVALID');
    expect(f.input.storage.getItem(key)).toBe(before);
  });
  it.each(['old-sequence', 'read-only', 'wrong-project', 'incomplete', 'not-deleted'])('does not confirm remove from %s directory', async variant => {
    const f = fixture(); const fetcher = f.input.fetcher!;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (!String(url).includes('document-project')) return fetcher(url, init);
      const payload = f.directory();
      if (variant === 'old-sequence') payload.sequence = 1;
      if (variant === 'read-only') payload.readOnly = true;
      if (variant === 'wrong-project') payload.projectId = 'project-q';
      if (variant === 'incomplete') payload.projection = {};
      if (variant === 'not-deleted') {
        payload.projection = { placements: { p1: { assetVersionId: 'version-a', ...attach.transform } } };
        payload.canvasImages = [{ id: 'p1', placementId: 'p1', assetVersionId: 'version-a', url: '/api/serve-upload/a.png', ...attach.transform, originalWidth: 80, originalHeight: 60, createdAt: 1 }];
      }
      return Response.json(payload);
    };
    await expect(run(f)).rejects.toThrow();
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('accepted');
  });
  it('marks a restored attach superseded when another command removes its new identity', async () => {
    const f = fixture(); const fetcher = f.input.fetcher!;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (String(url).includes('document-project')) {
        applyCanvasAssetCommand(f.doc, { action: 'remove', placementId: 'restored-1', expectedAssetVersionId: 'version-a' }, 'restored-1');
        f.setSequence(3);
      }
      return fetcher(url, init);
    };
    const item = await run(f, 'undo-delete-a-1', attach);
    expect(item.state).toBe('superseded'); expect(readCanvasDocument(f.doc).placements['restored-1'].deleted).toBe(true);
  });
  it.each(['actorId', 'projectId'] as const)('isolates journal recovery by %s', async field => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow();
    const before = f.input.storage.getItem(key);
    expect(await recoverDocumentHistoryCommands({ ...f.input, [field]: 'other' })).toEqual([]);
    expect(f.input.storage.getItem(key)).toBe(before); expect(f.posts).toHaveLength(1);
  });
  it('rejects scope changes while POST JSON is parsing without adopting the old receipt', async () => {
    const f = fixture(); const body = deferred<unknown>(), started = deferred<void>();
    f.input.fetcher = async (): Promise<Response> => {
      return { status: 200, json: () => { started.resolve(); return body.promise; } } as Response;
    };
    const pending = run(f).then(() => null, (error: unknown) => { started.resolve(); return error; });
    await started.promise; f.setCurrent(false);
    body.resolve({ success: true, placementId: 'p1', assetVersionId: 'version-a', documentSequence: 2 });
    expect(await pending).toBeInstanceOf(Error);
    expect((await pending as Error).message).toBe('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0]).toMatchObject({ state: 'pending', attempted: true });
  });
  it('refuses no-lock and rejected preflight writes before posting', async () => {
    const f = fixture();
    await expect(runDocumentHistoryCommand({ ...f.input, locks: undefined, operationId: 'delete-a-1', command: remove })).rejects.toThrow('DOCUMENT_HISTORY_LOCK_UNAVAILABLE');
    f.input.storage.setItem = (): void => { throw new Error('quota'); };
    await expect(run(f)).rejects.toThrow('quota'); expect(f.posts).toHaveLength(0);
  });
  it('keeps corrupt or wrong-scope journals byte-for-byte without HTTP fallback', async () => {
    const f = fixture();
    for (const raw of ['not json', JSON.stringify({ version: 1, actorId: 'actor-b', projectId: 'project-p', items: [] })]) {
      f.input.storage.setItem(key, raw); await expect(run(f)).rejects.toThrow();
      expect(f.input.storage.getItem(key)).toBe(raw);
    }
    expect(f.requests).toHaveLength(0);
  });
  it('rejects tampered fixed keys without rewriting the saved operation', async () => {
    const f = fixture(); await run(f);
    const journal = JSON.parse(f.input.storage.getItem(key)!) as DocumentHistoryCommandJournal;
    journal.items[0].idempotencyKey = 'document-history:' + '0'.repeat(64);
    const raw = JSON.stringify(journal); f.input.storage.setItem(key, raw);
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_JOURNAL_INVALID');
    expect(f.input.storage.getItem(key)).toBe(raw); expect(f.posts).toHaveLength(1);
  });
  it('bounds non-aborting POST body reads and prevents late results from writing', async () => {
    vi.useFakeTimers(); const f = fixture(); const body = deferred<unknown>(), started = deferred<void>();
    f.input.fetcher = async (): Promise<Response> => { started.resolve(); return { status: 200, json: () => body.promise } as Response; };
    const pending = run(f).then(() => null, (error: unknown) => { started.resolve(); return error; });
    await started.promise; await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toBeInstanceOf(Error);
    expect((await pending as Error).message).toBe('DOCUMENT_HISTORY_REQUEST_TIMEOUT');
    const before = f.input.storage.getItem(key);
    body.resolve({ success: true, placementId: 'p1', assetVersionId: 'version-a', documentSequence: 2 });
    await Promise.resolve(); await Promise.resolve();
    expect(f.input.storage.getItem(key)).toBe(before);
    expect((await recoverDocumentHistoryCommands({ ...f.input, actorId: 'actor-b' }))).toEqual([]);
  });
  it('retains a superseded attach outcome when an explicit replay refresh fails', async () => {
    const f = fixture(); const fetcher = f.input.fetcher!;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (String(url).includes('document-project')) {
        applyCanvasAssetCommand(f.doc, { action: 'replace', placementId: 'restored-1', expectedAssetVersionId: 'version-a', assetVersionId: 'version-b' }, 'restored-1');
        f.setSequence(3);
      }
      return fetcher(url, init);
    };
    expect((await run(f, 'undo-delete-a-1', attach)).state).toBe('superseded');
    applyCanvasAssetCommand(f.doc, { action: 'replace', placementId: 'restored-1', expectedAssetVersionId: 'version-b', assetVersionId: 'version-a' }, 'restored-1');
    f.input.fetcher = fetcher;
    f.input.refreshMedia = async (): Promise<void> => { throw new Error('refresh failed'); };
    await expect(run(f, 'undo-delete-a-1', attach)).rejects.toThrow('refresh failed');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('superseded');
    expect(await recoverDocumentHistoryCommands(f.input)).toEqual([]);
  });
  it('bounds an indefinitely pending media refresh so the same scope lock can recover', async () => {
    vi.useFakeTimers(); const f = fixture(); const started = deferred<void>();
    f.input.refreshMedia = (): Promise<void> => { started.resolve(); return new Promise(() => undefined); };
    const pending = run(f).then(() => null, (error: unknown) => { started.resolve(); return error; });
    await started.promise; await vi.advanceTimersByTimeAsync(10_001);
    // A rejection is also a wake-up on the preimplementation RED; a hanging refresh must be cut off.
    const settled = await Promise.race([pending, Promise.resolve('still pending')]);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toBe('DOCUMENT_HISTORY_REFRESH_TIMEOUT');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('accepted');
    f.input.refreshMedia = async (): Promise<void> => undefined;
    expect((await run(f)).state).toBe('confirmed');
  });
  it('persists earlier recovery success when a later operation still loses its receipt', async () => {
    const f = fixture(); f.loseNext(); await expect(run(f, 'delete-a-1')).rejects.toThrow('response lost');
    f.loseNext(); await expect(run(f, 'restore-a-1', attach)).rejects.toThrow('response lost');
    const fetcher = f.input.fetcher!;
    f.input.fetcher = async (url, init): Promise<Response> => {
      if (!String(url).includes('document-project') && String(init?.body).includes('"action":"attach"')) throw new Error('B still unavailable');
      return fetcher(url, init);
    };
    // A receipt's original sequence is stable although the directory may be newer.
    f.input.refreshMedia = async (): Promise<void> => undefined;
    await expect(recoverDocumentHistoryCommands(f.input)).rejects.toThrow('B still unavailable');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items.map(item => item.state)).toEqual(['confirmed', 'pending']);
    f.input.fetcher = fetcher;
    expect((await recoverDocumentHistoryCommands(f.input)).map(item => [item.operationId, item.state])).toEqual([['restore-a-1', 'confirmed']]);
    expect(f.receipts.size).toBe(2);
  });
  it('releases a timed-out non-aborting directory fetch without losing accepted proof', async () => {
    vi.useFakeTimers(); const f = fixture(); const started = deferred<void>(); const fetcher = f.input.fetcher!;
    f.input.fetcher = (url, init): Promise<Response> => {
      if (String(url).includes('document-project')) { started.resolve(); return new Promise(() => undefined); }
      return fetcher(url, init);
    };
    const pending = run(f).then(() => null, (error: unknown) => { started.resolve(); return error; });
    await started.promise; await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending as Error).message).toBe('DOCUMENT_HISTORY_REQUEST_TIMEOUT');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('accepted');
    f.input.fetcher = fetcher; expect((await run(f)).state).toBe('confirmed'); expect(f.receipts.size).toBe(1);
  });
  it('does not POST if attempted intent cannot be read back exactly', async () => {
    const f = fixture(); const get = f.input.storage.getItem.bind(f.input.storage), set = f.input.storage.setItem.bind(f.input.storage);
    let hideNext = false;
    f.input.storage.setItem = (name, raw): void => { set(name, raw); if (name === key) hideNext = true; };
    f.input.storage.getItem = (name): string | null => { if (name === key && hideNext) { hideNext = false; return null; } return get(name); };
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_UNCONFIRMED');
    expect(f.posts).toHaveLength(0); expect(get(key)).toBeNull();
  });
  it('recovers after accepted storage rejection without replacing the committed key', async () => {
    const f = fixture(); const set = f.input.storage.setItem.bind(f.input.storage);
    f.input.storage.setItem = (name, value): void => { if (name === key && value.includes('"state":"accepted"')) throw new Error('accepted quota'); set(name, value); };
    await expect(run(f)).rejects.toThrow('accepted quota');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items[0].state).toBe('pending');
    f.input.storage.setItem = set;
    expect((await run(f)).state).toBe('confirmed'); expect(f.posts[1]).toEqual(f.posts[0]); expect(f.receipts.size).toBe(1);
  });
  it('serializes two callers and freezes queued command data before waiting for the lock', async () => {
    const f = fixture(); const started = deferred<void>(), resume = deferred<void>();
    f.input.refreshMedia = async (): Promise<void> => { started.resolve(); await resume.promise; };
    const first = run(f); await started.promise;
    const queued: DocumentHistoryCommand = structuredClone(attach);
    const second = run(f, 'restore-a-1', queued);
    queued.transform.x = 999; resume.resolve();
    await first; const result = await second;
    expect(result.command).toEqual(attach); expect(f.posts[1].command).toEqual(attach);
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items.map(item => item.state)).toEqual(['confirmed', 'confirmed']);
  });
  it('does not adopt new work after its scope changes while waiting for the lock', async () => {
    const f = fixture(); const started = deferred<void>(), resume = deferred<void>();
    f.input.refreshMedia = async (): Promise<void> => { started.resolve(); await resume.promise; };
    const first = run(f).catch((error: unknown) => error); await started.promise;
    const second = run(f, 'restore-a-1', attach).catch((error: unknown) => error);
    f.setCurrent(false); resume.resolve();
    expect((await first as Error).message).toBe('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect((await second as Error).message).toBe('DOCUMENT_HISTORY_SCOPE_CHANGED');
    expect(readDocumentHistoryCommandJournal(f.input.storage, scope)?.items).toHaveLength(1); expect(f.posts).toHaveLength(1);
  });
  it.each(['run', 'recover'] as const)('rejects %s success if scope changes after the lock callback completes', async operation => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow('response lost');
    const request = <T>(_name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => Promise.resolve(callback({ name: key, mode: 'exclusive' }))
      .then(value => { f.setCurrent(false); return value; });
    f.input.locks = { request, query: async () => ({ held: [], pending: [] }) } as LockManager;
    const pending = operation === 'run' ? run(f) : recoverDocumentHistoryCommands(f.input);
    await expect(pending).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED');
  });
  it('rejects recovery success when scope changes in the final item completion microtask', async () => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow('response lost');
    const set = f.input.storage.setItem.bind(f.input.storage);
    f.input.storage.setItem = (name, raw): void => {
      set(name, raw);
      if (name === key && raw.includes('"state":"confirmed"')) queueMicrotask(() => f.setCurrent(false));
    };
    await expect(recoverDocumentHistoryCommands(f.input)).rejects.toThrow('DOCUMENT_HISTORY_SCOPE_CHANGED');
  });
  it('rolls back an existing pending raw when accepted readback cannot be confirmed', async () => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow('response lost');
    const old = f.input.storage.getItem(key), get = f.input.storage.getItem.bind(f.input.storage), set = f.input.storage.setItem.bind(f.input.storage);
    let hideNext = false;
    f.input.storage.setItem = (name, raw): void => { set(name, raw); if (name === key && raw.includes('"state":"accepted"')) hideNext = true; };
    f.input.storage.getItem = (name): string | null => { if (name === key && hideNext) { hideNext = false; return null; } return get(name); };
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_UNCONFIRMED');
    expect(get(key)).toBe(old);
    f.input.storage.getItem = get; f.input.storage.setItem = set;
    expect((await run(f)).state).toBe('confirmed'); expect(f.receipts.size).toBe(1);
  });
  it('preserves a durable old raw backup if storage also refuses the rollback', async () => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow('response lost');
    const old = f.input.storage.getItem(key), get = f.input.storage.getItem.bind(f.input.storage), set = f.input.storage.setItem.bind(f.input.storage);
    let hideNext = false;
    f.input.storage.setItem = (name, raw): void => {
      if (name === key && raw === old) throw new Error('rollback quota');
      set(name, raw); if (name === key && raw.includes('"state":"accepted"')) hideNext = true;
    };
    f.input.storage.getItem = (name): string | null => { if (name === key && hideNext) { hideNext = false; return null; } return get(name); };
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
    expect(get(key + ':previous')).toBe(old);
    expect(f.receipts.size).toBe(1);
  });
  it.each(['with-fence', 'legacy-without-fence'])('keeps recovery required with %s and never overwrites the only old backup', async variant => {
    const f = fixture(); f.loseNext(); await expect(run(f)).rejects.toThrow('response lost');
    const old = f.input.storage.getItem(key), get = f.input.storage.getItem.bind(f.input.storage), set = f.input.storage.setItem.bind(f.input.storage);
    f.input.storage.setItem = (name, raw): void => {
      if (name === key && raw === old) throw new Error('rollback refused');
      if (name === key && raw.includes('"state":"accepted"')) { set(name, JSON.stringify({ version: 1, ...scope, items: [] })); return; }
      set(name, raw);
    };
    await expect(run(f)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
    expect(get(key + ':previous')).toBe(old);
    f.input.storage.setItem = set;
    if (variant === 'legacy-without-fence') f.input.storage.removeItem(key + ':saving');
    const postCount = f.posts.length;
    await expect(recoverDocumentHistoryCommands(f.input)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
    await expect(run(f, 'new-restore-1', attach)).rejects.toThrow('DOCUMENT_HISTORY_SAVE_RECOVERY_REQUIRED');
    expect(get(key + ':previous')).toBe(old); expect(f.posts).toHaveLength(postCount);
  });
});
