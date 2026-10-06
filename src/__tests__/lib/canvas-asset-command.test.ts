import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { applyCanvasAssetCommand, DocumentAssetCommandInvalidError, parseDocumentAssetCommandRequest } from '@/lib/collaboration/canvas-asset-command';

const transform = { x: 10, y: 20, width: 80, height: 60, rotation: 5, zIndex: 1 };
function fixture(): Y.Doc {
  const doc = createCanvasDocument();
  applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'v1', ...transform, groupId: 'g1' }, 'test');
  doc.getMap('groupDefinitions').set('g1', { id: 'g1', name: 'Group', note: '', imageIds: ['p1'] });
  for (const id of ['a1', 'a2']) doc.getMap('annotationRecords').set(id, {
    id, projectId: 'project-a', sourceImageId: 'p1', sourceVersionId: 'v1', type: 'region',
    geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } }, status: 'ready', createdAt: 1, updatedAt: 2,
  });
  doc.getMap('annotationTombstones').set('a2', true);
  return doc;
}
describe('typed canvas asset operations', () => {
  it('removes active group membership and tombstones annotations without rewriting records', () => {
    const doc = fixture();
    const before = readCanvasDocument(doc);
    applyCanvasAssetCommand(doc, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'v1' }, 'p1');
    const after = readCanvasDocument(doc);
    expect(after.placements.p1).toEqual({ ...before.placements.p1, deleted: true });
    expect(after.groupDefinitions?.g1).toEqual({ id: 'g1', name: 'Group', note: '', imageIds: [] });
    expect(after.annotationRecords).toEqual(before.annotationRecords);
    expect(after.annotationTombstones).toEqual({ a1: true, a2: true });
  });
  it('replaces only the version and active annotation status; same version changes no Yjs state', () => {
    const doc = fixture();
    const before = readCanvasDocument(doc);
    const bytes = Y.encodeStateAsUpdate(doc);
    applyCanvasAssetCommand(doc, { action: 'replace', placementId: 'p1', expectedAssetVersionId: 'v1', assetVersionId: 'v1' }, 'p1');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
    applyCanvasAssetCommand(doc, { action: 'replace', placementId: 'p1', expectedAssetVersionId: 'v1', assetVersionId: 'v2' }, 'p1');
    const after = readCanvasDocument(doc);
    expect(after.placements.p1).toEqual({ ...before.placements.p1, assetVersionId: 'v2' });
    expect(after.groupDefinitions).toEqual(before.groupDefinitions);
    expect(after.annotationRecords?.a1).toEqual({ ...before.annotationRecords?.a1, status: 'stale' });
    expect(after.annotationRecords?.a2).toEqual(before.annotationRecords?.a2);
  });
  it('rejects missing/deleted placements and stale CAS without changing bytes', () => {
    const doc = fixture();
    const bytes = Y.encodeStateAsUpdate(doc);
    for (const placementId of ['missing', 'p1']) {
      expect(() => applyCanvasAssetCommand(doc, { action: 'remove', placementId, expectedAssetVersionId: 'wrong' }, placementId)).toThrow();
      expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
    }
    applyCanvasAssetCommand(doc, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'v1' }, 'p1');
    expect(() => applyCanvasAssetCommand(doc, { action: 'replace', placementId: 'p1', expectedAssetVersionId: 'v1', assetVersionId: 'v2' }, 'p1')).toThrow();
  });
  it.each([NaN, Infinity, -Infinity, 0, -1, 1_000_001])('rejects invalid width %s', width => {
    expect(() => parseDocumentAssetCommandRequest({ projectId: 'project-a', idempotencyKey: 'key',
      command: { action: 'attach', assetVersionId: 'v1', transform: { ...transform, width } } })).toThrow();
  });
  it.each(['data:foo', 'https:foo', 'processing-1', 'a'.repeat(161), '__proto__'])('rejects unsafe ID %s', assetVersionId => {
    expect(() => parseDocumentAssetCommandRequest({ projectId: 'project-a', idempotencyKey: 'key',
      command: { action: 'attach', assetVersionId, transform } })).toThrow();
  });
  it('rejects unknown fields and control characters instead of trimming them away', () => {
    const body = { projectId: 'project-a', idempotencyKey: 'key', command: { action: 'attach', assetVersionId: 'v1', transform } };
    for (const bad of [{ ...body, actorId: 'owner' }, { ...body, ownerId: 'owner' }, { ...body, projectId: 'p\n' },
      { ...body, idempotencyKey: 'k\u0000' }, { ...body, command: { ...body.command, url: 'https://example.com' } }]) {
      expect(() => parseDocumentAssetCommandRequest(bad)).toThrow();
    }
  });
  it('enforces the existing 2000 placement limit before writing', () => {
    const doc = createCanvasDocument();
    doc.transact(() => { for (let i = 0; i < 2000; i++) {
      doc.getMap('assetVersions').set(`p${i}`, 'v1');
      doc.getMap('transforms').set(`p${i}`, transform);
    } });
    const bytes = Y.encodeStateAsUpdate(doc);
    expect(() => applyCanvasAssetCommand(doc, { action: 'attach', assetVersionId: 'v1', transform }, 'overflow')).toThrow(DocumentAssetCommandInvalidError);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
  });
});
