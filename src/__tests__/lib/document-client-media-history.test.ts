// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument, tombstoneCanvasAnnotation, tombstoneCanvasGroup } from '@/lib/collaboration/canvas-document';
import { applyCanvasAssetCommand, captureDocumentPlacementRemovalSnapshot } from '@/lib/collaboration/canvas-asset-command';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { createCanvasDocumentSession, type PendingDocumentUpdateStore } from '@/lib/collaboration/document-client';
import { projectCanvasDocumentMetadata } from '@/lib/collaboration/canvas-document-image-bridge';

const faults = vi.hoisted(() => ({ failNextLiveHistoryApply: false }));
// vi.mock cannot intercept the native require used by the production entry.
// Patch that exact CJS object, forwarding every non-fault call to real Yjs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeY: typeof Y = require('yjs');
const originalApplyUpdate = nativeY.applyUpdate;
beforeEach((): void => {
  vi.spyOn(nativeY, 'applyUpdate').mockImplementation((doc: Y.Doc, update: Uint8Array, origin?: unknown): void => {
    if (faults.failNextLiveHistoryApply && origin instanceof nativeY.UndoManager && origin.doc === doc) {
      faults.failNextLiveHistoryApply = false;
      throw new Error('live history apply unavailable');
    }
    originalApplyUpdate(doc, update, origin);
  });
});

class Socket {
  readyState = 1;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  frames: Uint8Array[] = [];
  send(data: Uint8Array): void { this.frames.push(data); }
  close(): void { this.readyState = 3; }
  receive(doc: Y.Doc, sequence: number): void {
    const update = Y.encodeStateAsUpdate(doc);
    const bytes = new Uint8Array(9 + update.length);
    bytes[0] = 0x11;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
    bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
  acknowledge(sequence: number): void {
    const bytes = new Uint8Array(9);
    bytes[0] = 0x12;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}
const transform = { x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 0 };
const cleanups: Array<() => void> = [];
function fixture(store?: PendingDocumentUpdateStore, onStateChange?: Parameters<typeof createCanvasDocumentSession>[1]): { server: Y.Doc; socket: Socket; session: ReturnType<typeof createCanvasDocumentSession>; publish: () => void; commit: () => void } {
  const server = createCanvasDocument();
  for (const id of ['p1', 'p2', 'p4']) applyCanvasImagePatch(server, {
    placementId: id, assetVersionId: `version-${id}`, ...transform,
  }, 'seed');
  const socket = new Socket();
  const session = createCanvasDocumentSession(socket as unknown as WebSocket, onStateChange, store);
  let sequence = 0;
  let consumed = 0;
  const publish = (): void => { socket.receive(server, ++sequence); };
  const commit = (): void => {
    for (; consumed < socket.frames.length; consumed++) {
      Y.applyUpdate(server, socket.frames[consumed].subarray(1));
      socket.acknowledge(++sequence);
    }
    publish();
  };
  publish();
  cleanups.push(() => { session.disconnect(); server.destroy(); });
  return { server, socket, session, publish, commit };
}
afterEach((): void => {
  try { while (cleanups.length) cleanups.pop()?.(); }
  finally { faults.failNextLiveHistoryApply = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

function metadataRemovalFixture(store?: PendingDocumentUpdateStore): {
  f: ReturnType<typeof fixture>;
  binding: { previousPlacementId: string; nextPlacementId: string; assetVersionId: string;
    removal: { projectId: string; snapshot: ReturnType<typeof captureDocumentPlacementRemovalSnapshot>; annotationIds: Record<string, string> } };
} {
  const f = fixture(store);
  const group = { id: 'group-a', name: 'Original', note: 'original note', imageIds: ['p1', 'p2'], x: 2, y: 3, collapsed: false };
  f.server.getMap('groupDefinitions').set(group.id, group);
  f.server.getMap('groupDefinitions').set('group-dead', { ...group, id: 'group-dead', imageIds: ['p1'] });
  applyCanvasImagePatch(f.server, { placementId: 'p1', groupId: group.id, annotation: 'placement note' }, 'seed');
  const annotation: CanvasAnnotationV2 = { id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
    sourceVersionId: 'version-p1', type: 'region', geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    label: 'original annotation', status: 'ready', createdAt: 10, updatedAt: 12 };
  f.server.getMap('annotationRecords').set(annotation.id, annotation);
  f.server.getMap('annotationRecords').set('annotation-stale', { ...annotation, id: 'annotation-stale', sourceVersionId: 'version-older', status: 'stale' });
  const command = { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' } as const;
  const snapshot = captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.server), 'project-a', command);
  applyCanvasAssetCommand(f.server, command, 'p1');
  f.server.getMap('groupDefinitions').set(group.id, { ...group, name: 'Remote renamed', note: 'remote note',
    imageIds: ['p2', 'p4'], x: 31, y: 41, collapsed: true });
  tombstoneCanvasGroup(f.server, 'group-dead', 'remote');
  applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3');
  f.publish();
  return { f, binding: { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1',
    removal: { projectId: 'project-a', snapshot, annotationIds: { 'annotation-a': 'restored-a', 'annotation-stale': 'restored-stale' } } } };
}

function annotationIdentityFixture(store?: PendingDocumentUpdateStore, createdLocally = false): ReturnType<typeof fixture> {
  const f = fixture(store);
  const record: CanvasAnnotationV2 = { id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
    sourceVersionId: 'version-older', type: 'region', geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    label: 'original', status: 'stale', createdAt: 10, updatedAt: 12 };
  if (createdLocally) { f.session.applyLocalAnnotations({ [record.id]: record }); f.commit(); }
  else { f.server.getMap('annotationRecords').set(record.id, record); f.publish(); }
  return f;
}
function editAnnotation(f: ReturnType<typeof fixture>, id: string, label: string, updatedAt: number): void {
  const records = f.session.projection.annotationRecords!;
  f.session.applyLocalAnnotations({ ...records, [id]: { ...records[id], label, updatedAt } }); f.commit();
}
function removeForAnnotationHistory(f: ReturnType<typeof fixture>, placementId = 'p1'): ReturnType<typeof captureDocumentPlacementRemovalSnapshot> {
  const command = { action: 'remove', placementId, expectedAssetVersionId: 'version-p1' } as const;
  const snapshot = captureDocumentPlacementRemovalSnapshot(readCanvasDocument(f.server), 'project-a', command);
  applyCanvasAssetCommand(f.server, command, placementId); f.publish(); return snapshot;
}
function restoreForAnnotationHistory(f: ReturnType<typeof fixture>, snapshot: ReturnType<typeof captureDocumentPlacementRemovalSnapshot>,
  nextPlacementId = 'p3', annotationIds: Record<string, string> = { 'annotation-a': 'restored-a' }): void {
  applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, nextPlacementId); f.publish();
  const binding = { previousPlacementId: snapshot.placementId, nextPlacementId, assetVersionId: 'version-p1',
    removal: { projectId: 'project-a', snapshot, annotationIds } };
  f.session.restorePlacementHistoryMetadata(binding); f.commit(); f.session.rebindPlacementHistory(binding);
}

describe('annotation history across restored identities', () => {
  it('preserves same-timestamp ordinals through remapping and a second remove restore cycle', () => {
    const f = annotationIdentityFixture();
    const original = f.session.projection.annotationRecords!['annotation-a'];
    f.server.getMap('annotationRecords').set('annotation-z', { ...original, id: 'annotation-z', label: 'last' });
    f.publish();
    const visibleLabels = (placementId: string): string[] => projectCanvasDocumentMetadata(f.session.projection, [
      { id: 'image', placementId, assetVersionId: 'version-p1', url: '/api/serve-upload/a.png', ...transform },
    ]).annotations.map(record => record.label!);
    expect(visibleLabels('p1')).toEqual(['original', 'last']);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f), 'p3', { 'annotation-a': 'restored-z', 'annotation-z': 'restored-a' });
    expect(f.session.projection.annotationRecords?.['restored-z']).toMatchObject({ orderKey: 'annotation-a', sourceImageId: 'p3' });
    expect(visibleLabels('p3')).toEqual(['original', 'last']);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f, 'p3'), 'p5', { 'restored-z': 'cycle2-a', 'restored-a': 'cycle2-z' });
    expect(f.session.projection.annotationRecords?.['cycle2-a']).toMatchObject({ orderKey: 'annotation-a', sourceImageId: 'p5' });
    expect(f.session.projection.annotationRecords?.['cycle2-z']).toMatchObject({ orderKey: 'annotation-z', sourceImageId: 'p5' });
    expect(visibleLabels('p5')).toEqual(['original', 'last']);
    expect(readCanvasDocument(f.server).annotationTombstones).toMatchObject({
      'annotation-a': true, 'annotation-z': true, 'restored-a': true, 'restored-z': true,
    });
  });

  it('retains the original order key when undo and redo remap a pre-removal annotation edit', async () => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a']).toMatchObject({ label: 'original', orderKey: 'annotation-a' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a']).toMatchObject({ label: 'edited', orderKey: 'annotation-a' });
  });

  it('keeps an already restored legacy record without an order key editable across two later restorations', async () => {
    const f = annotationIdentityFixture();
    const legacySnapshot = removeForAnnotationHistory(f);
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3');
    // This is the exact pre-upgrade persisted shape: old ID tombstoned, fresh
    // ID live, no invented knowledge of the creation ID that old clients lost.
    f.server.getMap('annotationRecords').set('legacy-restored', {
      ...legacySnapshot.annotationRecords['annotation-a'], id: 'legacy-restored', sourceImageId: 'p3',
    });
    f.publish();
    editAnnotation(f, 'legacy-restored', 'edited legacy', 20);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f, 'p3'), 'p5', { 'legacy-restored': 'new-a' });
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f, 'p5'), 'p6', { 'new-a': 'new-b' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['new-b']).toMatchObject({
      label: 'original', sourceImageId: 'p6', orderKey: 'legacy-restored',
    });
    await f.session.redoLocal(); f.commit();
    expect(readCanvasDocument(f.server).annotationRecords?.['new-b']).toMatchObject({
      label: 'edited legacy', sourceImageId: 'p6', orderKey: 'legacy-restored',
    });
    expect(f.session.projection.annotationTombstones).toMatchObject({
      'annotation-a': true, 'legacy-restored': true, 'new-a': true,
    });
  });

  it('undoes and redoes earlier annotation edits on the fresh identity while retaining original version and tombstones', async () => {
    const f = annotationIdentityFixture();
    editAnnotation(f, 'annotation-a', 'first', 20); editAnnotation(f, 'annotation-a', 'second', 30);
    const snapshot = removeForAnnotationHistory(f); restoreForAnnotationHistory(f, snapshot);
    for (let cycle = 0; cycle < 2; cycle++) {
      await f.session.undoLocal(); f.commit();
      expect(f.session.projection.annotationRecords?.['restored-a']).toMatchObject({ label: 'first', updatedAt: 20, sourceImageId: 'p3' });
      await f.session.undoLocal(); f.commit();
      expect(f.session.projection.annotationRecords?.['restored-a']).toMatchObject({ label: 'original', updatedAt: 12, sourceVersionId: 'version-older' });
      await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('first');
      await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('second');
    }
    expect(f.session.projection.annotationRecords?.['annotation-a'].label).toBe('second');
    expect(f.session.projection.annotationTombstones?.['annotation-a']).toBe(true); expect(f.session.images.p1.deleted).toBe(true);
  });
  it('keeps annotation, geometry and confirmed media operations in one undo redo order', async () => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    const snapshot = removeForAnnotationHistory(f);
    f.session.recordMediaHistory({ undo: (): void => restoreForAnnotationHistory(f, snapshot),
      redo: (): void => { removeForAnnotationHistory(f, 'p3'); } });
    await f.session.undoLocal();
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited'); expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal(); f.commit(); expect(f.session.images.p2.x).toBe(10);
    await f.session.undoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('original');
    await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited');
    await f.session.redoLocal(); f.commit(); expect(f.session.images.p2.x).toBe(100);
    await f.session.redoLocal(); expect(f.session.images.p3.deleted).toBe(true);
    expect(f.session.projection.annotationTombstones).toMatchObject({ 'annotation-a': true, 'restored-a': true });
  });
  it('undoes a prior local annotation creation by tombstoning only the restored identity and preserves legal media redo', async () => {
    const f = annotationIdentityFixture(undefined, true); const snapshot = removeForAnnotationHistory(f);
    f.session.recordMediaHistory({ undo: (): void => restoreForAnnotationHistory(f, snapshot),
      redo: (): void => { removeForAnnotationHistory(f, 'p3'); } });
    await f.session.undoLocal(); await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationTombstones).toMatchObject({ 'annotation-a': true, 'restored-a': true });
    expect(f.session.images.p3.deleted).not.toBe(true);
    await f.session.redoLocal(); expect(f.session.images.p3.deleted).toBe(true);
    const frames = f.socket.frames.length; await f.session.redoLocal(); expect(f.socket.frames).toHaveLength(frames);
  });
  it('carries old annotation edits across two successive restoration identities', async () => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    const second = removeForAnnotationHistory(f, 'p3'); restoreForAnnotationHistory(f, second, 'p5', { 'restored-a': 'restored-b' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-b']).toMatchObject({ label: 'original', sourceImageId: 'p5', sourceVersionId: 'version-older' });
    await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-b'].label).toBe('edited');
    expect(f.session.projection.annotationTombstones).toMatchObject({ 'annotation-a': true, 'restored-a': true });
  });
  it.each(['before-rebind', 'after-rebind'] as const)('never reclaims a remote annotation overwrite %s even after a new local edit', async phase => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    const snapshot = removeForAnnotationHistory(f);
    if (phase === 'before-rebind') {
      applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3'); f.publish();
      const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1',
        removal: { projectId: 'project-a', snapshot, annotationIds: { 'annotation-a': 'restored-a' } } };
      f.session.restorePlacementHistoryMetadata(binding); f.commit();
      const record = f.server.getMap<CanvasAnnotationV2>('annotationRecords').get('restored-a')!;
      f.server.getMap('annotationRecords').set('restored-a', { ...record, label: 'remote', updatedAt: 40 }); f.publish();
      f.session.rebindPlacementHistory(binding);
    } else {
      restoreForAnnotationHistory(f, snapshot);
      const record = f.server.getMap<CanvasAnnotationV2>('annotationRecords').get('restored-a')!;
      f.server.getMap('annotationRecords').set('restored-a', { ...record, label: 'remote', updatedAt: 40 }); f.publish();
    }
    editAnnotation(f, 'restored-a', 'new-local', 50);
    await f.session.undoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('remote');
    const frames = f.socket.frames.length; await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('remote'); expect(f.socket.frames).toHaveLength(frames);
    await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('new-local');
  });
  it('keeps an annotation redo created by native undo before deletion attached to the fresh identity', async () => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    await f.session.undoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['annotation-a'].label).toBe('original');
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    await f.session.redoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited');
    await f.session.undoLocal(); f.commit(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('original');
  });
  it.each(['before-deletion', 'after-restoration'] as const)('retires equal-value remote annotation overwrite %s rather than reclaiming its new head', async phase => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    if (phase === 'after-restoration') restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    const id = phase === 'before-deletion' ? 'annotation-a' : 'restored-a';
    const record = f.server.getMap<CanvasAnnotationV2>('annotationRecords').get(id)!;
    f.server.getMap('annotationRecords').set(id, { ...record }); f.publish();
    if (phase === 'before-deletion') restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    const frames = f.socket.frames.length;
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited'); expect(f.socket.frames).toHaveLength(frames);
  });
  it('keeps unmapped annotations in a batch edit while mapping only the deleted media annotation', async () => {
    const f = annotationIdentityFixture();
    const other: CanvasAnnotationV2 = { ...f.session.projection.annotationRecords!['annotation-a'], id: 'annotation-b', sourceImageId: 'p2' };
    f.server.getMap('annotationRecords').set(other.id, other); f.publish();
    const records = f.session.projection.annotationRecords!;
    f.session.applyLocalAnnotations({ 'annotation-a': { ...records['annotation-a'], label: 'edited-a', updatedAt: 20 },
      'annotation-b': { ...records['annotation-b'], label: 'edited-b', updatedAt: 21 } }); f.commit();
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a']).toMatchObject({ label: 'original', sourceImageId: 'p3' });
    expect(f.session.projection.annotationRecords?.['annotation-b']).toMatchObject({ label: 'original', sourceImageId: 'p2' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited-a');
    expect(f.session.projection.annotationRecords?.['annotation-b'].label).toBe('edited-b');
  });
  it('does not move the annotation cursor when durable append fails and retries once after reconnect', async () => {
    let storageFull = false, counter = 0; const frames = new Map<string, Uint8Array>();
    const f = annotationIdentityFixture({ load: () => [], append: (frame): string => {
      if (storageFull) throw new Error('annotation storage full');
      const id = `annotation-pending-${++counter}`; frames.set(id, frame); return id;
    }, remove: (id): void => { frames.delete(id); } });
    editAnnotation(f, 'annotation-a', 'edited', 20); restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    const count = f.socket.frames.length; storageFull = true;
    expect(() => f.session.undoLocal()).toThrow('annotation storage full');
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited');
    expect(f.socket.frames).toHaveLength(count); expect(frames.size).toBe(0);
    storageFull = false; const replacement = new Socket(); f.session.replaceSocket(replacement as unknown as WebSocket);
    replacement.receive(f.server, 50); await f.session.undoLocal();
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('original'); expect(replacement.frames).toHaveLength(1);
    Y.applyUpdate(f.server, replacement.frames[0].subarray(1)); replacement.acknowledge(51);
    await f.session.redoLocal(); expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('edited');
    expect(replacement.frames).toHaveLength(2);
  });
  it('does not revive a remotely tombstoned fresh annotation or skip across the media boundary', async () => {
    const f = annotationIdentityFixture(); editAnnotation(f, 'annotation-a', 'edited', 20);
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    tombstoneCanvasAnnotation(f.server, 'restored-a', 'remote'); f.publish();
    const frames = f.socket.frames.length; await f.session.undoLocal(); f.commit();
    expect(f.socket.frames).toHaveLength(frames);
    expect(f.session.projection.annotationTombstones).toMatchObject({ 'annotation-a': true, 'restored-a': true });
  });
  it.each(['same-batch', 'separate-step'] as const)('preserves unrelated annotation redo when undoing restored creation %s', async variant => {
    const f = fixture();
    const created: CanvasAnnotationV2 = { id: 'annotation-a', projectId: 'project-a', sourceImageId: 'p1',
      sourceVersionId: 'version-p1', type: 'text', geometry: { kind: 'text', point: { x: 0.1, y: 0.2 } },
      label: 'created', status: 'ready', createdAt: 10, updatedAt: 12 };
    const other = { ...created, id: 'annotation-b', sourceImageId: 'p2', label: 'original-b' };
    f.server.getMap('annotationRecords').set(other.id, other); f.publish();
    if (variant === 'same-batch') {
      f.session.applyLocalAnnotations({ 'annotation-a': created, 'annotation-b': { ...other, label: 'edited-b', updatedAt: 20 } }); f.commit();
    } else {
      f.session.applyLocalAnnotations({ 'annotation-a': created, 'annotation-b': other }); f.commit();
      editAnnotation(f, 'annotation-b', 'edited-b', 20);
    }
    restoreForAnnotationHistory(f, removeForAnnotationHistory(f));
    await f.session.undoLocal(); f.commit();
    if (variant === 'separate-step') { await f.session.undoLocal(); f.commit(); }
    expect(f.session.projection.annotationRecords?.['annotation-b'].label).toBe('original-b');
    expect(f.session.projection.annotationTombstones?.['restored-a']).toBe(true);
    const count = f.socket.frames.length; await f.session.redoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['annotation-b']).toMatchObject({ label: 'edited-b', updatedAt: 20, sourceImageId: 'p2' });
    expect(f.socket.frames).toHaveLength(count + 1); expect(f.session.projection.annotationTombstones?.['restored-a']).toBe(true);
  });
});

describe('removal metadata restoration on confirmed new placement', () => {
  it('does not complete shared media undo before the real metadata frame ACK', async () => {
    const { f, binding } = metadataRemovalFixture(); let undoDone = false, redos = 0;
    f.session.recordMediaHistory({ undo: async (): Promise<void> => {
      f.session.restorePlacementHistoryMetadata(binding);
      await f.session.waitForPendingUpdates();
      f.session.rebindPlacementHistory(binding);
      undoDone = true;
    }, redo: (): void => { redos++; } });
    const pending = Promise.resolve(f.session.undoLocal()); const handled = pending.catch(() => undefined);
    await Promise.resolve(); expect(undoDone).toBe(false);
    expect(() => f.session.redoLocal()).toThrow();
    f.commit(); await pending; await handled; expect(undoDone).toBe(true);
    await f.session.redoLocal(); expect(redos).toBe(1);
    expect(readCanvasDocument(f.server).annotationRecords?.['restored-a'].sourceImageId).toBe('p3');
  });
  it('restores live membership and new annotations in one durable frame without replacing remote group attributes', () => {
    const appends: Array<{ frame: Uint8Array; intent?: Record<string, unknown> }> = [];
    const store: PendingDocumentUpdateStore = { load: () => [], remove: () => {},
      append: (frame, intent) => { appends.push({ frame, intent }); return 'pending-metadata'; } };
    const { f, binding } = metadataRemovalFixture(store);
    f.session.restorePlacementHistoryMetadata(binding);
    expect(appends).toHaveLength(1);
    expect(f.socket.frames).toHaveLength(1);
    expect(f.session.projection.groupDefinitions?.['group-a']).toEqual({ id: 'group-a', name: 'Remote renamed',
      note: 'remote note', imageIds: ['p2', 'p4', 'p3'], x: 31, y: 41, collapsed: true });
    expect(f.session.projection.annotationRecords?.['restored-a']).toEqual({ id: 'restored-a', orderKey: 'annotation-a', projectId: 'project-a',
      sourceImageId: 'p3', sourceVersionId: 'version-p1', type: 'region',
      geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      label: 'original annotation', status: 'ready', createdAt: 10, updatedAt: 12 });
    expect(f.session.projection.annotationRecords?.['restored-stale']).toMatchObject({ sourceImageId: 'p3',
      sourceVersionId: 'version-older', status: 'stale' });
    expect(appends[0].intent).toMatchObject({ groupDefinitions: { 'group-a': { imageIds: ['p2', 'p4', 'p3'] } },
      annotationRecords: { 'restored-a': { sourceImageId: 'p3' }, 'restored-stale': { sourceVersionId: 'version-older' } } });
    expect(f.session.images.p3).toMatchObject({ groupId: 'group-a', annotation: 'placement note' });
    expect(f.session.images.p1.deleted).toBe(true);
    expect(f.session.projection.annotationTombstones).toMatchObject({ 'annotation-a': true, 'annotation-stale': true });
    expect(f.session.projection.groupTombstones?.['group-dead']).toBe(true);
    expect(f.session.projection.groupDefinitions?.['group-dead'].imageIds).not.toContain('p3');
    f.commit();
    expect(readCanvasDocument(f.server).annotationRecords?.['restored-a'].sourceImageId).toBe('p3');
  });

  it('does not restore a deleted primary group but keeps the annotation and old tombstones', () => {
    const { f, binding } = metadataRemovalFixture();
    tombstoneCanvasGroup(f.server, 'group-a', 'remote'); f.publish();
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    expect(f.session.images.p3.groupId ?? null).toBeNull();
    expect(f.session.projection.groupTombstones?.['group-a']).toBe(true);
    expect(f.session.projection.annotationRecords?.['restored-a'].sourceImageId).toBe('p3');
  });

  it('same frozen restoration retry neither replaces a remote annotation edit nor re-adds remotely removed membership', () => {
    const { f, binding } = metadataRemovalFixture();
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    const restored = f.server.getMap<CanvasAnnotationV2>('annotationRecords').get('restored-a')!;
    expect(restored).toBeDefined();
    f.server.getMap('annotationRecords').set('restored-a', { ...restored, label: 'remote changed' });
    const group = readCanvasDocument(f.server).groupDefinitions!['group-a'];
    f.server.getMap('groupDefinitions').set(group.id, { ...group, imageIds: ['p2', 'p4'], name: 'second remote name' });
    f.publish();
    const frames = f.socket.frames.length;
    f.session.restorePlacementHistoryMetadata(binding);
    expect(f.socket.frames).toHaveLength(frames);
    expect(f.session.projection.annotationRecords?.['restored-a'].label).toBe('remote changed');
    expect(f.session.projection.groupDefinitions?.['group-a']).toMatchObject({ imageIds: ['p2', 'p4'], name: 'second remote name' });
  });

  it('rejects a different restoration mapping after the first successful write', () => {
    const { f, binding } = metadataRemovalFixture();
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    const changed = { ...binding, removal: { ...binding.removal,
      annotationIds: { ...binding.removal.annotationIds, 'annotation-a': 'another-new-id' } } };
    const before = JSON.stringify(f.session.projection); const frames = f.socket.frames.length;
    expect(() => f.session.restorePlacementHistoryMetadata(changed)).toThrow();
    expect(JSON.stringify(f.session.projection)).toBe(before);
    expect(f.socket.frames).toHaveLength(frames);
  });

  it.each(['live', 'tombstone', 'deleted-key'] as const)('rejects target annotation identity with %s history before any partial group write', state => {
    const { f, binding } = metadataRemovalFixture();
    const original = binding.removal.snapshot.annotationRecords['annotation-a'];
    f.server.getMap('annotationRecords').set('restored-a', { ...original, id: 'restored-a', sourceImageId: 'p2' });
    if (state === 'tombstone') tombstoneCanvasAnnotation(f.server, 'restored-a', 'remote');
    if (state === 'deleted-key') f.server.getMap('annotationRecords').delete('restored-a');
    f.publish();
    const before = JSON.stringify(f.session.projection);
    expect(() => f.session.restorePlacementHistoryMetadata(binding)).toThrow();
    expect(JSON.stringify(f.session.projection)).toBe(before);
    expect(f.socket.frames).toHaveLength(0);
  });

  it.each<{ name: string; ids: Record<string, string> }>([
    { name: 'missing', ids: { 'annotation-a': 'restored-a' } },
    { name: 'extra', ids: { 'annotation-a': 'restored-a', 'annotation-stale': 'restored-stale', extra: 'restored-extra' } },
    { name: 'duplicate', ids: { 'annotation-a': 'restored-a', 'annotation-stale': 'restored-a' } },
    { name: 'unsafe', ids: { 'annotation-a': '../escape', 'annotation-stale': 'restored-stale' } },
    { name: 'prototype target', ids: { 'annotation-a': '__proto__', 'annotation-stale': 'restored-stale' } },
    { name: 'old identity', ids: { 'annotation-a': 'annotation-a', 'annotation-stale': 'restored-stale' } },
  ])('rejects $name annotation mapping with no mutation', ({ ids }) => {
    const { f, binding } = metadataRemovalFixture();
    const before = JSON.stringify(f.session.projection);
    expect(() => f.session.restorePlacementHistoryMetadata({ ...binding, removal: { ...binding.removal, annotationIds: ids } })).toThrow();
    expect(JSON.stringify(f.session.projection)).toBe(before);
    expect(f.socket.frames).toHaveLength(0);
  });

  it.each(['project', 'placement', 'version'] as const)('rejects removal preimage %s drift before writing', kind => {
    const { f, binding } = metadataRemovalFixture();
    const snapshot = JSON.parse(JSON.stringify(binding.removal.snapshot)) as typeof binding.removal.snapshot;
    if (kind === 'project') snapshot.projectId = 'project-foreign';
    if (kind === 'placement') snapshot.placementId = 'p2';
    if (kind === 'version') snapshot.placement.assetVersionId = 'version-different';
    const before = JSON.stringify(f.session.projection);
    expect(() => f.session.restorePlacementHistoryMetadata({ ...binding, removal: { ...binding.removal, snapshot } })).toThrow();
    expect(JSON.stringify(f.session.projection)).toBe(before);
    expect(f.socket.frames).toHaveLength(0);
  });

  it('failed pending append cannot leak new records or restoration ownership into the live document', () => {
    const store: PendingDocumentUpdateStore = { load: () => [], remove: () => {}, append: () => { throw new Error('storage full'); } };
    const { f, binding } = metadataRemovalFixture(store);
    const before = JSON.stringify(f.session.projection);
    expect(() => f.session.restorePlacementHistoryMetadata(binding)).toThrow('storage full');
    expect(JSON.stringify(f.session.projection)).toBe(before);
    expect(f.socket.frames).toHaveLength(0);
    f.publish();
    const retry = { ...binding, removal: { ...binding.removal, annotationIds: { 'annotation-a': 'retry-a', 'annotation-stale': 'retry-stale' } } };
    expect(() => f.session.restorePlacementHistoryMetadata(retry)).toThrow('storage full');
    expect(JSON.stringify(f.session.projection)).toBe(before);
  });

  it('refuses a restoration frame if a remote group edit arrives inside pending persistence, then retries against the new group', () => {
    let onAppend = (): void => {};
    const store: PendingDocumentUpdateStore = { load: () => [], remove: () => {},
      append: () => { onAppend(); return 'pending-race'; } };
    const { f, binding } = metadataRemovalFixture(store);
    onAppend = (): void => {
      const group = readCanvasDocument(f.server).groupDefinitions!['group-a'];
      f.server.getMap('groupDefinitions').set(group.id, { ...group, name: 'arrived during append' });
      f.publish();
    };
    expect(() => f.session.restorePlacementHistoryMetadata(binding)).toThrow();
    expect(f.session.projection.groupDefinitions?.['group-a']).toMatchObject({ name: 'arrived during append', imageIds: ['p2', 'p4'] });
    expect(f.session.projection.annotationRecords?.['restored-a']).toBeUndefined();
    expect(f.socket.frames).toHaveLength(0);
    onAppend = (): void => {};
    f.publish();
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    expect(f.session.projection.groupDefinitions?.['group-a']).toMatchObject({ name: 'arrived during append', imageIds: ['p2', 'p4', 'p3'] });
    expect(f.session.projection.annotationRecords?.['restored-a']?.sourceImageId).toBe('p3');
  });

  it('does not insert metadata restoration into the shared movement/media undo ordering over two cycles', async () => {
    const { f, binding } = metadataRemovalFixture();
    // Start from a live seed again; the first confirmed remove/attach above is
    // fixture setup, not a local undo item. Move the unaffected live p2 first.
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    f.session.recordMediaHistory({
      undo: (): void => { f.session.restorePlacementHistoryMetadata(binding); f.commit(); },
      redo: (): void => {},
    });
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.annotationRecords?.['restored-a'].sourceImageId).toBe('p3');
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(10);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.redoLocal(); f.commit();
    await f.session.undoLocal(); f.commit();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(10);
  });
});

describe('document session local/media history ordering', () => {
  it('binding a native redo preserves only fields the preceding undo actually changed', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local' }); f.commit();
    applyCanvasImagePatch(f.server, { placementId: 'p1', annotation: '' }, 'remote'); f.publish();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p1).toMatchObject({ x: 10, annotation: '' });
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.session.images.p3.annotation ?? '').toBe('');
  });

  it.each(['before-remove', 'before-first-binding'] as const)('does not claim a remote same-value transform overwritten %s', async when => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    if (when === 'before-remove') { applyCanvasImagePatch(f.server, { placementId: 'p1', x: 100 }, 'remote'); f.publish(); }
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    if (when === 'before-first-binding') { applyCanvasImagePatch(f.server, { placementId: 'p3', x: 100 }, 'remote'); f.publish(); }
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    const frames = f.socket.frames.length;
    await f.session.undoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
    await f.session.redoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
    expect(f.session.images.p1.deleted).toBe(true);
  });

  it('does not claim an overwritten replacement first seen in a coalesced canonical frame', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1');
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3');
    for (let i = 0; i < 3; i++) applyCanvasImagePatch(f.server, { placementId: 'p3', x: 100 }, 'remote');
    f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    const frames = f.socket.frames.length;
    await f.session.undoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
  });

  it.each(['groups', 'annotations'] as const)('does not claim the first remote %s write as restoration ownership', async field => {
    const f = fixture();
    const group = { id: 'group-a', name: 'A', note: '', imageIds: [], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group); f.publish();
    const metadata = field === 'groups' ? { groupId: group.id } : { annotation: 'local' };
    f.session.applyLocalChange({ placementId: 'p1', x: 100, ...metadata }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    applyCanvasImagePatch(f.server, { placementId: 'p3', ...metadata }, 'remote'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(10);
    if (field === 'groups') expect(f.session.images.p3.groupId).toBe('group-a');
    else expect(f.session.images.p3.annotation).toBe('local');
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, ...metadata });
    expect(f.session.images.p1.deleted).toBe(true);
  });

  it('keeps a fresh local edit reversible without reclaiming an earlier remotely overwritten intent', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    applyCanvasImagePatch(f.server, { placementId: 'p1', x: 100 }, 'remote'); f.publish();
    f.session.applyLocalChange({ placementId: 'p1', x: 200 }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 200 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(100);
    const frames = f.socket.frames.length;
    await f.session.undoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(200);
  });

  it('continues the removed placement movement on its confirmed replacement, without reviving the old identity', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    let current = 'p1';
    let ordinal = 2;
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: current, expectedAssetVersionId: 'version-p1' }, current); f.publish();
    f.session.recordMediaHistory({
      undo: (): void => {
        const old = current;
        current = `restored-${++ordinal}`;
        applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, current); f.publish();
        f.session.rebindPlacementHistory({ previousPlacementId: old, nextPlacementId: current, assetVersionId: 'version-p1' });
      },
      redo: (): void => { applyCanvasAssetCommand(f.server, { action: 'remove', placementId: current, expectedAssetVersionId: 'version-p1' }, current); f.publish(); },
    });
    for (let cycle = 0; cycle < 2; cycle++) {
      await f.session.undoLocal();
      expect(f.session.images[current]).toMatchObject({ assetVersionId: 'version-p1', x: 100 });
      await f.session.undoLocal(); f.commit();
      expect(f.session.images[current].x).toBe(10);
      expect(f.session.images.p1).toMatchObject({ deleted: true, x: 100, assetVersionId: 'version-p1' });
      await f.session.redoLocal(); f.commit();
      expect(f.session.images[current].x).toBe(100);
      await f.session.redoLocal();
      expect(f.session.images[current].deleted).toBe(true);
    }
    expect(Object.values(f.session.images).filter(image => image.assetVersionId === 'version-p1')).toHaveLength(3);
  });

  it('undoes one multi-selection action on the replacement and the unaffected live placement together', async () => {
    const f = fixture();
    f.session.applyLocalChange([{ placementId: 'p1', x: 100 }, { placementId: 'p2', y: 200 }]); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(10);
    expect(f.session.images.p2.y).toBe(20);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.session.images.p2.y).toBe(200);
  });

  it('keeps remote replacement geometry including a same-value overwrite out of local history', async () => {
    const f = fixture();
    f.session.applyLocalChange([{ placementId: 'p1', x: 100 }, { placementId: 'p2', y: 200 }]); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    applyCanvasImagePatch(f.server, { placementId: 'p3', x: 100 }, 'remote'); f.publish();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.session.images.p2.y).toBe(20);
    applyCanvasImagePatch(f.server, { placementId: 'p3', x: 777 }, 'remote'); f.publish();
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(777);
    expect(f.session.images.p2.y).toBe(200);
  });

  it('rejects an unconfirmed, different-version or ambiguous identity binding without losing the valid history', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    expect(() => f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p2', assetVersionId: 'version-p1' })).toThrow();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p2', transform: { ...transform, x: 100 } }, 'wrong'); f.publish();
    expect(() => f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'wrong', assetVersionId: 'version-p1' })).toThrow();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p5'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    expect(() => f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p5', assetVersionId: 'version-p1' })).toThrow();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(10);
    expect(f.session.images.p5.x).toBe(100);
    f.session.disconnect();
    expect(() => f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' })).toThrow();
  });

  it('preserves original multi-field placement intent and does not resurrect a remotely deleted group', async () => {
    const f = fixture();
    const group = { id: 'group-a', name: 'A', note: '', imageIds: [], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group); f.publish();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, groupId: group.id, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.restorePlacementHistoryMetadata({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' }); f.commit();
    expect(f.session.images.p3).toMatchObject({ groupId: 'group-a', annotation: 'local note' });
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, groupId: null, annotation: '' });
    tombstoneCanvasGroup(f.server, group.id, 'remote'); f.publish();
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, groupId: null, annotation: 'local note' });
    expect(f.session.projection.groupTombstones?.[group.id]).toBe(true);
  });

  it('does not overwrite or claim optional fields already written remotely during explicit restoration', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    applyCanvasImagePatch(f.server, { placementId: 'p3', annotation: 'local note' }, 'remote'); f.publish();
    const frames = f.socket.frames.length;
    f.session.restorePlacementHistoryMetadata({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    expect(f.socket.frames).toHaveLength(frames);
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: 'local note' });
  });

  it('does not reclaim a restored optional field after a remote same-value overwrite and repeated restoration', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    expect(f.session.images.p3.annotation).toBe('local note');
    applyCanvasImagePatch(f.server, { placementId: 'p3', annotation: 'local note' }, 'remote'); f.publish();
    const frames = f.socket.frames.length;
    f.session.restorePlacementHistoryMetadata(binding);
    expect(f.socket.frames).toHaveLength(frames);
    f.session.rebindPlacementHistory(binding);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: 'local note' });
  });

  it('does not register restoration ownership when its durable append fails, and retries without a new history entry', async () => {
    let fail = false;
    const f = fixture({ load: () => [], append: (): string => { if (fail) throw new Error('restore append failed'); return 'pending'; }, remove: (): void => {} });
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    fail = true;
    expect(() => f.session.restorePlacementHistoryMetadata(binding)).toThrow('restore append failed');
    expect(f.session.images.p3.annotation).toBeUndefined();
    fail = false;
    const replacement = new Socket();
    f.session.replaceSocket(replacement as unknown as WebSocket); replacement.receive(f.server, 20);
    f.session.restorePlacementHistoryMetadata(binding);
    expect(f.session.images.p3.annotation).toBe('local note');
    f.session.rebindPlacementHistory(binding);
    await f.session.undoLocal();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: '' });
  });

  it('rejects invalid or disconnected restoration without writing optional fields', () => {
    const f = fixture();
    const frames = f.socket.frames.length;
    expect(() => f.session.restorePlacementHistoryMetadata({ previousPlacementId: 'p1', nextPlacementId: 'p2', assetVersionId: 'version-p1' })).toThrow();
    expect(f.socket.frames).toHaveLength(frames);
    f.session.disconnect();
    expect(() => f.session.restorePlacementHistoryMetadata({ previousPlacementId: 'p1', nextPlacementId: 'p2', assetVersionId: 'version-p1' })).toThrow();
  });

  it.each(['remote-first', 'restored-overwritten'] as const)('does not revive unowned optional intent after a fresh local edit (%s)', async when => {
    const f = fixture();
    const group = { id: 'group-a', name: 'A', note: '', imageIds: [], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group); f.publish();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, groupId: 'group-a', annotation: 'local' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    if (when === 'restored-overwritten') { f.session.restorePlacementHistoryMetadata(binding); f.commit(); }
    applyCanvasImagePatch(f.server, { placementId: 'p3', groupId: 'group-a', annotation: 'local' }, 'remote'); f.publish();
    f.session.restorePlacementHistoryMetadata(binding);
    f.session.rebindPlacementHistory(binding);
    f.session.applyLocalChange({ placementId: 'p3', groupId: null, annotation: 'fresh' }); f.commit();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, groupId: 'group-a', annotation: 'local' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, groupId: 'group-a', annotation: 'local' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, groupId: 'group-a', annotation: 'local' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, groupId: null, annotation: 'fresh' });
    expect(f.session.images.p1.deleted).toBe(true);
  });

  it('rejects binding a successor whose explicit metadata restoration belongs to a different predecessor', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'other'); f.publish();
    for (const id of ['p1', 'other']) {
      applyCanvasAssetCommand(f.server, { action: 'remove', placementId: id, expectedAssetVersionId: 'version-p1' }, id); f.publish();
    }
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    expect(() => f.session.rebindPlacementHistory({ ...binding, previousPlacementId: 'other' })).toThrow();
    f.session.rebindPlacementHistory(binding);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: '' });
  });

  it('restores optional fields inside a media undo without adding a second local history step', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    f.session.recordMediaHistory({
      undo: (): void => {
        applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
        const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
        f.session.restorePlacementHistoryMetadata(binding); f.commit();
        f.session.rebindPlacementHistory(binding);
      },
      redo: (): void => { applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p3', expectedAssetVersionId: 'version-p1' }, 'p3'); f.publish(); },
    });
    await f.session.undoLocal();
    expect(f.session.images.p3).toMatchObject({ x: 100, annotation: 'local note' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: '' });
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, annotation: 'local note' });
    await f.session.redoLocal();
    expect(f.session.images.p3.deleted).toBe(true);
  });

  it('does not restore a group that was deleted while its placement was removed', async () => {
    const f = fixture();
    const group = { id: 'group-a', name: 'A', note: '', imageIds: [], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group); f.publish();
    f.session.applyLocalChange({ placementId: 'p1', x: 100, groupId: group.id, annotation: 'local note' }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    tombstoneCanvasGroup(f.server, group.id, 'remote'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    f.session.restorePlacementHistoryMetadata(binding); f.commit();
    expect(f.session.images.p3.groupId ?? null).toBeNull();
    expect(f.session.images.p3.annotation).toBe('local note');
    f.session.rebindPlacementHistory(binding);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, annotation: '' });
    expect(f.session.projection.groupTombstones?.[group.id]).toBe(true);
  });

  it.each(['groups', 'annotations'] as const)('preserves a remotely cleared %s field instead of restoring its old value', async field => {
    const f = fixture();
    const group = { id: 'group-a', name: 'A', note: '', imageIds: [], x: 0, y: 0, collapsed: false };
    f.server.getMap('groupDefinitions').set(group.id, group); f.publish();
    const metadata = field === 'groups' ? { groupId: 'group-a' } : { annotation: 'local note' };
    f.session.applyLocalChange({ placementId: 'p1', x: 100, ...metadata }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const cleared = field === 'groups' ? { groupId: null } : { annotation: '' };
    applyCanvasImagePatch(f.server, { placementId: 'p3', ...cleared }, 'remote'); f.publish();
    const frames = f.socket.frames.length;
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    f.session.restorePlacementHistoryMetadata(binding);
    expect(f.socket.frames).toHaveLength(frames);
    f.session.rebindPlacementHistory(binding);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 10, ...cleared });
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ x: 100, ...cleared });
  });

  it('retries the same replacement undo after durable append rejection instead of consuming it', async () => {
    let fail = false;
    const f = fixture({ load: () => [], append: (): string => { if (fail) throw new Error('mapped append failed'); return 'pending'; }, remove: (): void => {} });
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    fail = true;
    expect(() => f.session.undoLocal()).toThrow('mapped append failed');
    expect(f.session.images.p3.x).toBe(100);
    fail = false;
    const replacement = new Socket();
    f.session.replaceSocket(replacement as unknown as WebSocket); replacement.receive(f.server, 20);
    await f.session.undoLocal();
    expect(f.session.images.p3.x).toBe(10);
    replacement.acknowledge(21);
    await f.session.redoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.session.images.p1.deleted).toBe(true);
  });

  it('continues later local moves on the new identity and keeps a separate native metadata history', async () => {
    const f = fixture();
    const group = { id: 'group-native', name: 'Native metadata', note: '', imageIds: ['p2'], x: 0, y: 0, collapsed: false };
    f.session.applyLocalGroups({ [group.id]: group }); f.commit();
    for (const x of [100, 200]) { f.session.applyLocalChange({ placementId: 'p1', x }); f.commit(); }
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 200 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    f.session.applyLocalChange({ placementId: 'p3', x: 300 }); f.commit();
    for (const want of [200, 100, 10]) {
      await f.session.undoLocal(); f.commit();
      expect(f.session.images.p3.x).toBe(want);
    }
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.groupTombstones?.[group.id]).toBe(true);
    for (const want of [100, 200, 300]) {
      await f.session.redoLocal(); f.commit();
      expect(f.session.images.p3.x).toBe(want);
      expect(f.session.projection.groupTombstones?.[group.id]).toBe(true);
    }
  });

  it('does not adopt a prior same-value remote overwrite on an unaffected placement when binding another image', async () => {
    const f = fixture();
    f.session.applyLocalChange([{ placementId: 'p1', x: 100 }, { placementId: 'p2', y: 200 }]); f.commit();
    applyCanvasImagePatch(f.server, { placementId: 'p2', y: 200 }, 'remote'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(10);
    expect(f.session.images.p2.y).toBe(200);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.session.images.p2.y).toBe(200);
  });

  it('does not apply an older version intent to a replacement made after a version change', async () => {
    const f = fixture();
    f.session.applyLocalChange([{ placementId: 'p1', x: 100 }, { placementId: 'p2', y: 200 }]); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'replace', placementId: 'p1', expectedAssetVersionId: 'version-p1', assetVersionId: 'version-new' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-new' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-new', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    f.session.rebindPlacementHistory({ previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-new' });
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ assetVersionId: 'version-new', x: 100 });
    expect(f.session.images.p2.y).toBe(20);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p3).toMatchObject({ assetVersionId: 'version-new', x: 100 });
    expect(f.session.images.p2.y).toBe(200);
  });

  it('a repeated binding does not claim a remotely overwritten head or authorize a second predecessor', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p1', x: 100 }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform: { ...transform, x: 100 } }, 'p3'); f.publish();
    const binding = { previousPlacementId: 'p1', nextPlacementId: 'p3', assetVersionId: 'version-p1' };
    f.session.rebindPlacementHistory(binding);
    applyCanvasImagePatch(f.server, { placementId: 'p3', x: 100 }, 'remote'); f.publish();
    f.session.rebindPlacementHistory(binding);
    applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'another');
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'another', expectedAssetVersionId: 'version-p1' }, 'another'); f.publish();
    expect(() => f.session.rebindPlacementHistory({ ...binding, previousPlacementId: 'another' })).toThrow();
    const frames = f.socket.frames.length;
    await f.session.undoLocal();
    expect(f.session.images.p3.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
    await f.session.redoLocal();
    expect(f.socket.frames).toHaveLength(frames);
    expect(f.session.images.p1.deleted).toBe(true);
  });

  it('undoes two acknowledged local transforms all the way back and redoes both steps', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(10);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(200);
  });

  it('retains successive redo associations across another complete undo and redo cycle', async () => {
    const f = fixture();
    for (const x of [100, 200, 300, 400]) {
      f.session.applyLocalChange({ placementId: 'p2', x }); f.commit();
    }
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const want of [300, 200, 100, 10]) {
        await f.session.undoLocal(); f.commit();
        expect(f.session.images.p2.x).toBe(want);
      }
      for (const want of [100, 200, 300, 400]) {
        await f.session.redoLocal(); f.commit();
        expect(f.session.images.p2.x).toBe(want);
      }
    }
  });

  it('a remote-overwritten geometry no-op does not erase the undone media command', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    let present = false;
    f.session.recordMediaHistory({ undo: (): void => { present = true; }, redo: (): void => { present = false; } });
    applyCanvasImagePatch(f.server, { placementId: 'p2', x: 444 }, 'remote'); f.publish();
    await f.session.undoLocal();
    expect(present).toBe(true);
    const frames = f.socket.frames.length;
    await f.session.undoLocal();
    expect(f.session.images.p2.x).toBe(444);
    expect(f.socket.frames).toHaveLength(frames);
    await f.session.redoLocal();
    expect(present).toBe(false);
    expect(f.session.images.p2.x).toBe(444);
  });

  it('consumes only the remote-overwritten item rather than skipping across media to an earlier edit', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p4', x: 100 }); f.commit();
    let restored = false;
    f.session.recordMediaHistory({ undo: (): void => { restored = true; }, redo: (): void => { restored = false; } });
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    applyCanvasImagePatch(f.server, { placementId: 'p2', x: 444 }, 'remote'); f.publish();
    await f.session.undoLocal();
    expect(restored).toBe(false);
    expect(f.session.images.p2.x).toBe(444);
    expect(f.session.images.p4.x).toBe(100);
    await f.session.undoLocal();
    expect(restored).toBe(true);
    expect(f.session.images.p4.x).toBe(100);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p4.x).toBe(10);
  });

  it('a new geometry edit clears both media and geometry redo entries', async () => {
    const f = fixture();
    let restored = false;
    f.session.recordMediaHistory({ undo: (): void => { restored = true; }, redo: (): void => { restored = false; } });
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    await f.session.undoLocal();
    f.session.applyLocalChange({ placementId: 'p4', x: 300 }); f.commit();
    await f.session.redoLocal();
    expect(restored).toBe(true);
    expect(f.session.images.p2.x).toBe(10);
    expect(f.session.images.p4.x).toBe(300);
  });

  it('a new confirmed media entry clears the prior geometry redo', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} });
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(10);
  });

  it('discarding geometry redo for a new media command releases its retained deleted transform', async () => {
    const managers = vi.spyOn(Y.UndoManager.prototype, 'addToScope');
    const f = fixture();
    const native = managers.mock.contexts[0] as Y.UndoManager;
    managers.mockRestore();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    const discarded = [...native.doc.store.clients.values()].flat().find(struct => (
      struct instanceof Y.Item && struct.deleted && struct.parentSub === 'p2' &&
      (struct.content.getContent()[0] as { x?: number } | undefined)?.x === 200
    ));
    expect(discarded).toBeInstanceOf(Y.Item);
    expect((discarded as Y.Item).keep).toBe(true);
    f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} });
    expect((discarded as Y.Item).keep).toBe(false);
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(10);
  });

  it('metadata creation undo retains an independent legal media redo without reviving the group', async () => {
    const f = fixture();
    const group = { id: 'group-a', name: 'Independent group', note: '', imageIds: ['p2'], x: 0, y: 0, collapsed: false };
    f.session.applyLocalGroups({ [group.id]: group }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    f.session.recordMediaHistory({
      undo: (): void => { applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3'); f.publish(); },
      redo: (): void => { applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p3', expectedAssetVersionId: 'version-p1' }, 'p3'); f.publish(); },
    });
    await f.session.undoLocal();
    expect(f.session.images.p3?.deleted).not.toBe(true);
    await f.session.undoLocal(); f.commit();
    expect(f.session.projection.groupTombstones?.['group-a']).toBe(true);
    await f.session.redoLocal();
    expect(f.session.images.p3.deleted).toBe(true);
    expect(f.session.projection.groupTombstones?.['group-a']).toBe(true);
    const frames = f.socket.frames.length;
    await f.session.redoLocal();
    expect(f.socket.frames).toHaveLength(frames);
  });

  it('a failed live apply retains both local undo steps and discards its unapplied pending frame', async () => {
    const values = new Map<string, Uint8Array>();
    let nextId = 0;
    const f = fixture({
      load: () => [...values].map(([id, frame]) => ({ id, frame })),
      append: (frame): string => { const id = `pending-${++nextId}`; values.set(id, frame); return id; },
      remove: (id): void => { values.delete(id); },
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    faults.failNextLiveHistoryApply = true;
    expect(() => f.session.undoLocal()).toThrow('live history apply unavailable');
    expect(faults.failNextLiveHistoryApply).toBe(false);
    expect(f.session.images.p2.x).toBe(200);
    expect(values.size).toBe(0);
    const replacement = new Socket();
    f.session.replaceSocket(replacement as unknown as WebSocket); replacement.receive(f.server, 20);
    await f.session.undoLocal();
    expect(f.session.images.p2.x).toBe(100);
    replacement.acknowledge(21);
    await f.session.undoLocal();
    expect(f.session.images.p2.x).toBe(10);
    replacement.acknowledge(22);
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(100);
    replacement.acknowledge(23);
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(200);
  });

  it('a throwing state observer cannot interrupt an applied history step or lose its redo associations', async () => {
    let throwNext = false;
    const f = fixture(undefined, () => {
      if (throwNext) { throwNext = false; throw new Error('state observer unavailable'); }
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    throwNext = true;
    expect(() => f.session.undoLocal()).not.toThrow(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(10);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(200);
  });

  it('a late acknowledgement of an earlier sent frame cannot unlock or consume rejected unapplied history', async () => {
    const values = new Map<string, { frame: Uint8Array; rejected?: boolean }>();
    let nextId = 0;
    let cleanupUnavailable = false;
    const f = fixture({
      load: () => [...values].map(([id, value]) => ({ id, ...value })),
      append: (frame): string => { const id = `pending-${++nextId}`; values.set(id, { frame }); return id; },
      remove: (id): void => { if (cleanupUnavailable) throw new Error('cleanup unavailable'); values.delete(id); },
      markRejected: (id): void => { const value = values.get(id); if (value) value.rejected = true; },
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 100 });
    cleanupUnavailable = true;
    faults.failNextLiveHistoryApply = true;
    expect(() => f.session.undoLocal()).toThrow('live history apply unavailable');
    expect(faults.failNextLiveHistoryApply).toBe(false);
    expect(f.session.status).toBe('rejected');
    expect(values.size).toBe(2);
    cleanupUnavailable = false;
    Y.applyUpdate(f.server, f.socket.frames[0].subarray(1));
    f.socket.acknowledge(1);
    expect(f.session.status).toBe('rejected');
    expect(values.size).toBe(1);
    expect(() => f.session.applyLocalChange({ placementId: 'p2', x: 300 })).toThrow();
    expect(() => f.session.undoLocal()).toThrow();
    expect(() => f.session.redoLocal()).toThrow();
    expect(() => f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} })).toThrow();
    expect(f.socket.frames).toHaveLength(1);
    expect(f.session.exportRecoveryCopy().pendingFrames).toHaveLength(1);
    expect(f.session.exportRecoveryCopy().pendingFrames[0].rejected).toBe(true);
    // This rejected frame was never sent. A repeated older ACK cannot confirm it.
    f.socket.acknowledge(1);
    expect(values.size).toBe(1);
    expect(f.session.exportRecoveryCopy().pendingFrames).toHaveLength(1);
    f.publish();
    expect(f.session.status).toBe('rejected');
  });

  it('retries the same geometry cursor after durable append failure without corrupting earlier redo links', async () => {
    const values = new Map<string, Uint8Array>();
    let storageFull = false;
    let nextId = 0;
    const f = fixture({
      load: () => [...values].map(([id, frame]) => ({ id, frame })),
      append: (frame): string => {
        if (storageFull) throw new Error('storage full');
        const id = `pending-${++nextId}`; values.set(id, frame); return id;
      },
      remove: (id): void => { values.delete(id); },
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    const frames = f.socket.frames.length;
    storageFull = true;
    expect(() => f.session.undoLocal()).toThrow('storage full');
    expect(f.session.images.p2.x).toBe(100);
    expect(f.socket.frames).toHaveLength(frames);
    expect(values.size).toBe(0);
    storageFull = false;
    const replacement = new Socket();
    f.session.replaceSocket(replacement as unknown as WebSocket);
    replacement.receive(f.server, 20);
    await f.session.undoLocal();
    expect(f.session.images.p2.x).toBe(10);
    expect(replacement.frames).toHaveLength(1);
    replacement.acknowledge(21);
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(100);
    replacement.acknowledge(22);
    await f.session.redoLocal();
    expect(f.session.images.p2.x).toBe(200);
  });

  it('interleaves confirmed media commands with real local Yjs undo and redo without undoing remote edits', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1'); f.publish();
    f.session.recordMediaHistory({
      undo: (): void => { applyCanvasAssetCommand(f.server, { action: 'attach', assetVersionId: 'version-p1', transform }, 'p3'); f.publish(); },
      redo: (): void => { applyCanvasAssetCommand(f.server, { action: 'remove', placementId: 'p3', expectedAssetVersionId: 'version-p1' }, 'p3'); f.publish(); },
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    applyCanvasImagePatch(f.server, { placementId: 'p4', x: 444 }, 'remote'); f.publish();
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal();
    expect(f.session.images.p3?.assetVersionId).toBe('version-p1');
    expect(f.session.images.p1.deleted).toBe(true);
    expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(10);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(100);
    await f.session.redoLocal();
    expect(f.session.images.p3.deleted).toBe(true);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(200);
    expect(f.session.images.p4.x).toBe(444);
  });

  it('keeps a failed media undo at the cursor rather than undoing an earlier geometry entry', async () => {
    const f = fixture();
    f.session.applyLocalChange({ placementId: 'p2', x: 100 }); f.commit();
    let attempts = 0;
    f.session.recordMediaHistory({ undo: async (): Promise<void> => { if (++attempts === 1) throw new Error('permission unavailable'); }, redo: (): void => {} });
    await expect(Promise.resolve().then(() => f.session.undoLocal())).rejects.toThrow('permission unavailable');
    expect(f.session.images.p2.x).toBe(100);
    await f.session.undoLocal();
    expect(attempts).toBe(2);
    await f.session.undoLocal();
    expect(f.session.images.p2.x).toBe(10);
  });

  it('keeps a failed media redo ahead of the later geometry redo until retry succeeds', async () => {
    const f = fixture();
    let attempts = 0;
    let present = false;
    f.session.recordMediaHistory({
      undo: (): void => { present = true; },
      redo: (): void => {
        if (++attempts === 1) throw new Error('media redo unavailable');
        present = false;
      },
    });
    f.session.applyLocalChange({ placementId: 'p2', x: 200 }); f.commit();
    await f.session.undoLocal(); f.commit();
    await f.session.undoLocal();
    expect(() => f.session.redoLocal()).toThrow('media redo unavailable');
    expect(f.session.images.p2.x).toBe(10);
    expect(present).toBe(true);
    await f.session.redoLocal();
    expect(attempts).toBe(2);
    expect(present).toBe(false);
    expect(f.session.images.p2.x).toBe(10);
    await f.session.redoLocal(); f.commit();
    expect(f.session.images.p2.x).toBe(200);
  });

  it('rejects overlapping history and local writes while an async media undo is unresolved', async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    f.session.recordMediaHistory({ undo: () => pending, redo: (): void => {} });
    const result = f.session.undoLocal();
    expect(() => f.session.undoLocal()).toThrow();
    expect(() => f.session.redoLocal()).toThrow();
    expect(() => f.session.applyLocalChange({ placementId: 'p2', x: 100 })).toThrow();
    expect(() => f.session.applyLocalGroups({})).toThrow();
    expect(() => f.session.applyLocalAnnotations({})).toThrow();
    expect(() => f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} })).toThrow();
    expect(f.session.images.p2.x).toBe(10);
    finish(); await result;
    f.session.applyLocalChange({ placementId: 'p2', x: 100 });
    expect(f.session.images.p2.x).toBe(100);
  });

  it('does not resurrect an old session after a media result arrives following disconnect', async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    f.session.recordMediaHistory({ undo: () => pending, redo: (): void => { throw new Error('old redo executed'); } });
    const result = f.session.undoLocal(); f.session.disconnect();
    finish(); await result;
    expect(() => f.session.redoLocal()).toThrow();
    expect(() => f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} })).toThrow();
  });
});
