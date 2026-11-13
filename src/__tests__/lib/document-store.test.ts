import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';

import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument, validateCanvasDocumentProjection } from '@/lib/collaboration/canvas-document';
import { applyCanvasAssetCommand } from '@/lib/collaboration/canvas-asset-command';
import { assertCanonicalDocumentPayload, commitDocumentAssetCommandInTransaction, commitDocumentUpdateInTransaction, encodeCanonicalDocumentSnapshot } from '@/lib/collaboration/document-store';
import type { PreparedDocumentAssets } from '@/lib/collaboration/document-asset-validation';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/collaboration/document-access', () => ({
  assertDocumentEditor: async () => ({ ownerId: 'owner-a' }), assertDocumentProjectEnabled: async () => {},
}));
vi.mock('@/lib/collaboration/document-assets', () => ({
  assertProjectAssetVersion: async () => {}, assertProjectCanvasPlacement: async () => {},
}));
vi.mock('@/lib/collaboration/document-asset-validation', () => ({ assertPreparedDocumentAssets: async () => {} }));

describe('canonical Yjs document payload', () => {
  it.each([undefined, null, '当前图层'])('seals the visible name on remove when the document name is %s', async currentName => {
    const doc = createCanvasDocument();
    try {
      const transform = { x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 };
      applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'version-a', ...transform,
        ...(currentName !== undefined ? { name: currentName } : {}),
      }, 'seed');
      const persisted = encodeCanonicalDocumentSnapshot(doc);
      const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT owner_id, sequence')) return { rowCount: 1, rows: [{ owner_id: 'owner-a',
          sequence: '2', snapshot_sequence: '2', snapshot_bytes: persisted.bytes,
          projection: JSON.parse(JSON.stringify(persisted.projection)),
        }] };
        if (sql.includes('SELECT COALESCE(placement.metadata')) {
          expect(values).toEqual(['p1', 'owner-a', 'project-a']);
          expect(currentName).not.toBe('当前图层');
          return { rowCount: 1, rows: [{ name: '旧图层' }] };
        }
        return { rowCount: 1, rows: [] };
      });
      const removed = await commitDocumentAssetCommandInTransaction({ query } as unknown as PoolClient, {
        projectId: 'project-a', actorId: 'editor-a', placementId: 'p1', prepared: {} as PreparedDocumentAssets,
        command: { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-a' },
      });
      const expectedName = currentName ?? '旧图层';
      expect(removed.removeSnapshot?.placement.name).toBe(expectedName);
      Y.applyUpdate(doc, removed.update);
      expect(readCanvasDocument(doc).placements.p1).toMatchObject({ name: expectedName, deleted: true });
      applyCanvasAssetCommand(doc, { action: 'attach', assetVersionId: 'version-a', transform,
        name: removed.removeSnapshot?.placement.name }, 'replacement');
      expect(readCanvasDocument(doc).placements.replacement.name).toBe(expectedName);
    } finally { doc.destroy(); }
  });

  it.each([undefined, '删除前名称'])('discards a concurrent rename on a removed layer with name %s and commits the live rename', async name => {
    const server = createCanvasDocument(), writer = createCanvasDocument(), reader = createCanvasDocument();
    try {
      for (const id of ['p1', 'p2']) applyCanvasImagePatch(server, { placementId: id, assetVersionId: `version-${id}`,
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        ...(id === 'p1' && name !== undefined ? { name } : {}),
      }, 'seed');
      const beforeDelete = Y.encodeStateAsUpdate(server), vector = Y.encodeStateVector(server);
      Y.applyUpdate(writer, beforeDelete);
      applyCanvasImagePatch(writer, { placementId: 'p1', name: '迟到的改名' }, 'local');
      applyCanvasImagePatch(writer, { placementId: 'p2', name: '有效的改名' }, 'local');
      applyCanvasAssetCommand(server, { action: 'remove', placementId: 'p1', expectedAssetVersionId: 'version-p1' }, 'p1');
      const persisted = encodeCanonicalDocumentSnapshot(server);
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT owner_id, sequence')) return { rowCount: 1, rows: [{ owner_id: 'owner-a',
          sequence: '2', snapshot_sequence: '2', snapshot_bytes: persisted.bytes,
          projection: JSON.parse(JSON.stringify(persisted.projection)),
        }] };
        return { rowCount: 1, rows: [] };
      });
      const commit = await commitDocumentUpdateInTransaction({ query } as unknown as PoolClient, {
        projectId: 'project-a', actorId: 'editor-a', bytes: Y.encodeStateAsUpdate(writer, vector),
      });
      expect(commit.sequence).toBe(3);
      for (const replica of [reader, writer]) {
        Y.applyUpdate(replica, persisted.bytes);
        Y.applyUpdate(replica, commit.update);
        const { placements } = readCanvasDocument(replica);
        expect(placements.p1.deleted).toBe(true);
        expect(placements.p1.name).toBe(name);
        expect(placements.p2.name).toBe('有效的改名');
      }
    } finally { for (const doc of [server, writer, reader]) doc.destroy(); }
  });

  it('merges separate layer renames from an old snapshot and reads both from the persisted snapshot', () => {
    const server = createCanvasDocument();
    const first = createCanvasDocument();
    const second = createCanvasDocument();
    const reopened = createCanvasDocument();
    try {
      const geometry = { x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1 };
      applyCanvasImagePatch(server, { placementId: 'p1', assetVersionId: 'version-one', ...geometry }, 'seed');
      applyCanvasImagePatch(server, { placementId: 'p2', assetVersionId: 'version-two', ...geometry }, 'seed');
      const baseline = Y.encodeStateAsUpdate(server);
      const vector = Y.encodeStateVector(server);
      Y.applyUpdate(first, baseline);
      Y.applyUpdate(second, baseline);
      expect(readCanvasDocument(first).placements.p1).not.toHaveProperty('name');

      applyCanvasImagePatch(first, { placementId: 'p1', name: '拥有者：产品图' }, 'owner');
      applyCanvasImagePatch(second, { placementId: 'p2', name: '编辑者：演示视频' }, 'editor');
      applyCanvasImagePatch(second, { placementId: 'p1', x: 41 }, 'editor');
      Y.applyUpdate(server, Y.encodeStateAsUpdate(second, vector));
      Y.applyUpdate(server, Y.encodeStateAsUpdate(first, vector));
      const persisted = encodeCanonicalDocumentSnapshot(server);
      for (const replica of [first, second, reopened]) {
        Y.applyUpdate(replica, persisted.bytes);
        const names = readCanvasDocument(replica).placements;
        expect(names.p1).toMatchObject({ name: '拥有者：产品图', x: 41 });
        expect(names.p2).toMatchObject({ name: '编辑者：演示视频', x: 10 });
      }
    } finally {
      for (const doc of [server, first, second, reopened]) doc.destroy();
    }
  });

  it('rejects malformed layer names without changing the placement', () => {
    const doc = createCanvasDocument();
    try {
      applyCanvasImagePatch(doc, { placementId: 'p1', assetVersionId: 'version-one',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      }, 'seed');
      const initial = readCanvasDocument(doc).placements.p1;
      for (const name of ['', '   ', '图层\n名称', '图'.repeat(201), 'https://example.test', 'API-key']) {
        expect(() => applyCanvasImagePatch(doc, { placementId: 'p1', name }, 'local')).toThrow('Invalid canvas layer name');
        expect(() => validateCanvasDocumentProjection({ placements: { p1: { ...initial, name } } }))
          .toThrow('Invalid canvas layer name');
      }
      expect(readCanvasDocument(doc).placements.p1).toEqual(initial);
    } finally { doc.destroy(); }
  });

  it('keeps deleted metadata records and their monotonic tombstones in a canonical update', () => {
    const doc = new Y.Doc();
    doc.getMap('assetVersions').set('placement-one', 'version-one');
    doc.getMap('transforms').set('placement-one', {
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    doc.getMap('groupDefinitions').set('group-one', {
      id: 'group-one', name: 'Hero', note: '', imageIds: ['placement-one'],
    });
    doc.getMap('annotationRecords').set('annotation-one', {
      id: 'annotation-one', projectId: 'project-one', sourceImageId: 'placement-one',
      sourceVersionId: 'source-one', type: 'region',
      geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      status: 'ready', createdAt: 1, updatedAt: 2,
    });
    doc.getMap('groupTombstones').set('group-one', true);
    doc.getMap('annotationTombstones').set('annotation-one', true);
    const projection = readCanvasDocument(doc);

    expect(() => assertCanonicalDocumentPayload(Y.encodeStateAsUpdate(doc), projection)).not.toThrow();
  });

  it('accepts current group and annotation records without admitting overwritten history', () => {
    const doc = new Y.Doc({ gc: false });
    doc.getMap('assetVersions').set('placement-one', 'version-one');
    doc.getMap('transforms').set('placement-one', {
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    doc.getMap('groupDefinitions').set('group-one', {
      id: 'group-one', name: 'Hero', note: 'Keep together',
      imageIds: ['placement-one'], x: 5, y: 6, collapsed: false,
    });
    doc.getMap('annotationRecords').set('annotation-one', {
      id: 'annotation-one', projectId: 'project-one', sourceImageId: 'placement-one',
      sourceVersionId: 'source-one', type: 'brush',
      geometry: { kind: 'brush', points: [{ x: 0.2, y: 0.3 }], width: 0.02 },
      status: 'ready', createdAt: 1, updatedAt: 2,
    });
    const projection = readCanvasDocument(doc);
    expect(() => assertCanonicalDocumentPayload(Y.encodeStateAsUpdate(doc), projection)).not.toThrow();

    doc.getMap('groupDefinitions').set('group-one', {
      id: 'group-one', name: 'Hero', note: 'different current record',
      imageIds: ['placement-one'], x: 5, y: 6, collapsed: false,
    });
    const changed = readCanvasDocument(doc);
    expect(() => assertCanonicalDocumentPayload(Y.encodeStateAsUpdate(doc), changed)).toThrow();
  });

  it('rejects overwritten unlabelled credentials retained in Yjs history', () => {
    const doc = new Y.Doc({ gc: false });
    const annotations = doc.getMap('annotations');
    annotations.set('placement-one', 'unlabelled-credential-123');
    annotations.set('placement-one', 'safe');
    const projection = {
      placements: {
        'placement-one': {
          assetVersionId: 'version-one',
          x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
          annotation: 'safe',
        },
      },
    };
    doc.getMap('assetVersions').set('placement-one', 'version-one');
    doc.getMap('transforms').set('placement-one', {
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    expect(readCanvasDocument(doc)).toEqual(projection);
    expect(() => assertCanonicalDocumentPayload(Y.encodeStateAsUpdate(doc), projection)).toThrow();
  });

  it('accepts only live permitted values after Yjs has garbage-collected an overwrite', () => {
    const doc = new Y.Doc();
    doc.getMap('assetVersions').set('placement-one', 'version-one');
    doc.getMap('transforms').set('placement-one', {
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    doc.getMap('annotations').set('placement-one', 'old note');
    doc.getMap('annotations').set('placement-one', 'safe');
    const projection = readCanvasDocument(doc);
    expect(() => assertCanonicalDocumentPayload(Y.encodeStateAsUpdate(doc), projection)).not.toThrow();
  });

  it('rejects a deleted orphan key name retained in canonical Yjs history', () => {
    const doc = new Y.Doc();
    doc.getMap('assetVersions').set('placement-one', 'version-one');
    doc.getMap('transforms').set('placement-one', {
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    doc.getMap('annotations').set('sk-live-private', 'temporary');
    doc.getMap('annotations').delete('sk-live-private');
    const projection = readCanvasDocument(doc);
    const bytes = Y.encodeStateAsUpdate(doc);
    expect(Buffer.from(bytes).toString('utf8')).toContain('sk-live-private');
    expect(() => assertCanonicalDocumentPayload(bytes, projection)).toThrow();
  });

  it('checks a full 2000-placement document within the collaborative write budget', () => {
    const doc = new Y.Doc();
    const assetVersions = doc.getMap('assetVersions');
    const transforms = doc.getMap('transforms');
    for (let index = 0; index < 2000; index += 1) {
      const placementId = `placement-${index}`;
      assetVersions.set(placementId, `version-${index}`);
      transforms.set(placementId, {
        x: index, y: 20, width: 80, height: 60, rotation: 0, zIndex: index,
      });
    }
    const projection = readCanvasDocument(doc);
    const bytes = Y.encodeStateAsUpdate(doc);
    const started = performance.now();
    assertCanonicalDocumentPayload(bytes, projection);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
