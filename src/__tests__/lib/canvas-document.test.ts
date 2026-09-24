import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  applyCanvasImagePatch,
  assertCanvasDocumentTransition,
  createCanvasDocument,
  readCanvasDocument,
  validateCanvasDocumentProjection,
  type CanvasImagePatch,
} from '@/lib/collaboration/canvas-document';

describe('collaborative canvas document', () => {
  it('transfers a versioned placement to another real Yjs document', () => {
    const first = createCanvasDocument();
    applyCanvasImagePatch(first, {
      placementId: 'placement-1',
      assetVersionId: 'version-1',
      x: 10,
      y: 20,
      width: 80,
      height: 60,
      rotation: 0,
      zIndex: 2,
    }, 'local');

    const second = createCanvasDocument();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    expect(readCanvasDocument(second)).toEqual({
      placements: {
        'placement-1': {
          assetVersionId: 'version-1',
          x: 10,
          y: 20,
          width: 80,
          height: 60,
          rotation: 0,
          zIndex: 2,
        },
      },
    });
  });

  it('keeps existing placement fields when only one transform field changes', () => {
    const doc = createCanvasDocument();
    applyCanvasImagePatch(doc, {
      placementId: 'placement-1',
      assetVersionId: 'version-1',
      x: 10,
      y: 20,
      width: 80,
      height: 60,
      rotation: 0,
      zIndex: 2,
    }, 'local');

    applyCanvasImagePatch(doc, { placementId: 'placement-1', x: 90 }, 'local');

    expect(readCanvasDocument(doc).placements['placement-1']).toEqual({
      assetVersionId: 'version-1',
      x: 90,
      y: 20,
      width: 80,
      height: 60,
      rotation: 0,
      zIndex: 2,
    });
  });

  it('rejects transient media, processing status, and secrets without mutating the document', () => {
    const forbidden = [
      { imageUrl: 'data:image/png;base64,AAAA' },
      { imageUrl: 'blob:https://example.test/temporary' },
      { imageUrl: 'https://other.example/private.png' },
      { status: 'processing' },
      { apiKey: 'secret' },
    ];

    for (const extra of forbidden) {
      const doc = createCanvasDocument();
      const patch = {
        placementId: 'placement-1',
        assetVersionId: 'version-1',
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        rotation: 0,
        zIndex: 2,
        ...extra,
      } as CanvasImagePatch;
      expect(() => applyCanvasImagePatch(doc, patch, 'local')).toThrow();
      expect(readCanvasDocument(doc)).toEqual({ placements: {} });
    }
  });

  it('validates the complete projection and rejects malformed media references or geometry', () => {
    const placement = {
      assetVersionId: 'version-1', x: 10, y: 20,
      width: 80, height: 60, rotation: 0, zIndex: 2,
    };
    expect(validateCanvasDocumentProjection({ placements: { 'placement-1': placement } }))
      .toEqual({ placements: { 'placement-1': placement } });

    const invalid = [
      { assetVersionId: 'https://other.example/file.png' },
      { assetVersionId: 'data:image/png;base64,AAAA' },
      { assetVersionId: 'processing:task-1' },
      { x: Infinity },
      { y: Number.NaN },
      { width: 0 },
      { height: -1 },
      { rotation: 361 },
      { zIndex: 1.5 },
      { status: 'processing' },
      { annotation: 'x'.repeat(1001) },
    ];
    for (const wrong of invalid) {
      expect(() => validateCanvasDocumentProjection({
        placements: { 'placement-1': { ...placement, ...wrong } },
      })).toThrow();
    }
    expect(() => validateCanvasDocumentProjection({ placements: {}, apiKey: 'secret' })).toThrow();
    expect(() => validateCanvasDocumentProjection({
      placements: { 'https://other.example/placement': placement },
    })).toThrow();
    const tooMany = Object.fromEntries(
      Array.from({ length: 2001 }, (_, index) => [`placement-${index}`, placement]),
    );
    expect(() => validateCanvasDocumentProjection({ placements: tooMany })).toThrow();
  });

  it('rejects incomplete or malformed local patches before a Yjs transaction', () => {
    const doc = createCanvasDocument();
    const base = {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 2,
    };
    const invalid = [
      { placementId: 'placement-1', x: 10 },
      { ...base, assetVersionId: 'data:image/png;base64,AAAA' },
      { ...base, x: Infinity },
      { ...base, width: 0 },
    ];
    for (const patch of invalid) {
      expect(() => applyCanvasImagePatch(doc, patch, 'local')).toThrow();
      expect(readCanvasDocument(doc)).toEqual({ placements: {} });
    }
  });

  it('refuses to materialize a malformed update received from another Yjs client', () => {
    const attacker = new Y.Doc();
    attacker.getMap('placements').set('placement-1', {
      assetVersionId: 'version-1', x: 10, y: 20,
      width: 80, height: 60, rotation: 0, zIndex: 2,
      imageUrl: 'https://other.example/private.png',
    });
    const receiver = createCanvasDocument();
    Y.applyUpdate(receiver, Y.encodeStateAsUpdate(attacker));

    expect(() => readCanvasDocument(receiver)).toThrow();
  });

  it('refuses hidden root types even when the visible placement projection is empty', () => {
    const attacker = new Y.Doc();
    attacker.getText('private-media').insert(0, 'data:image/png;base64,AAAA');
    const receiver = createCanvasDocument();
    Y.applyUpdate(receiver, Y.encodeStateAsUpdate(attacker));

    expect(() => readCanvasDocument(receiver)).toThrow();
  });

  it('converges after independent updates arrive in reverse order and twice', () => {
    const first = createCanvasDocument();
    const second = createCanvasDocument();
    applyCanvasImagePatch(first, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'first');
    applyCanvasImagePatch(second, {
      placementId: 'placement-2', assetVersionId: 'version-2',
      x: 90, y: 40, width: 40, height: 30, rotation: 0, zIndex: 2,
    }, 'second');
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    const reversed = createCanvasDocument();
    Y.applyUpdate(reversed, secondUpdate);
    Y.applyUpdate(reversed, firstUpdate);
    Y.applyUpdate(reversed, firstUpdate);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    const expected = {
      placements: {
        'placement-1': {
          assetVersionId: 'version-1', x: 10, y: 20,
          width: 80, height: 60, rotation: 0, zIndex: 1,
        },
        'placement-2': {
          assetVersionId: 'version-2', x: 90, y: 40,
          width: 40, height: 30, rotation: 0, zIndex: 2,
        },
      },
    };
    expect(readCanvasDocument(first)).toEqual(expected);
    expect(readCanvasDocument(second)).toEqual(expected);
    expect(readCanvasDocument(reversed)).toEqual(expected);
  });

  it('keeps a deleted placement as a tombstone and refuses later local resurrection', () => {
    const doc = createCanvasDocument();
    applyCanvasImagePatch(doc, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'local');
    applyCanvasImagePatch(doc, { placementId: 'placement-1', deleted: true }, 'local');
    const before = Y.encodeStateAsUpdate(doc);

    expect(() => applyCanvasImagePatch(doc, { placementId: 'placement-1', x: 99 }, 'stale'))
      .toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readCanvasDocument(doc).placements['placement-1'].deleted).toBe(true);
  });

  it('keeps deletion when an older client sends a concurrent placement edit', () => {
    const owner = createCanvasDocument();
    owner.clientID = 1;
    applyCanvasImagePatch(owner, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'owner');
    const stale = createCanvasDocument();
    stale.clientID = 2;
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(owner));

    applyCanvasImagePatch(owner, { placementId: 'placement-1', deleted: true }, 'owner');
    applyCanvasImagePatch(stale, { placementId: 'placement-1', x: 99 }, 'stale');
    Y.applyUpdate(owner, Y.encodeStateAsUpdate(stale));
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(owner));

    expect(readCanvasDocument(owner).placements['placement-1'].deleted).toBe(true);
    expect(readCanvasDocument(stale).placements['placement-1'].deleted).toBe(true);
  });

  it('returns a detached projection that cannot silently mutate the Yjs document', () => {
    const doc = createCanvasDocument();
    applyCanvasImagePatch(doc, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'local');
    const before = Y.encodeStateAsUpdate(doc);
    const projection = readCanvasDocument(doc);
    projection.placements['placement-1'].x = 999;

    expect(readCanvasDocument(doc).placements['placement-1'].x).toBe(10);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('supports grouping, ungrouping, and clearing an annotation without media URLs', () => {
    const doc = createCanvasDocument();
    applyCanvasImagePatch(doc, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      groupId: 'group-1', annotation: 'Draft',
    }, 'local');
    applyCanvasImagePatch(doc, {
      placementId: 'placement-1', groupId: null, annotation: '',
    }, 'local');

    expect(readCanvasDocument(doc).placements['placement-1']).toMatchObject({
      assetVersionId: 'version-1', groupId: null, annotation: '',
    });
  });

  it('rejects a raw Yjs update that removes a confirmed tombstone and revives media', () => {
    const previous = createCanvasDocument();
    applyCanvasImagePatch(previous, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'owner');
    applyCanvasImagePatch(previous, { placementId: 'placement-1', deleted: true }, 'owner');
    const incoming = createCanvasDocument();
    Y.applyUpdate(incoming, Y.encodeStateAsUpdate(previous));
    incoming.getMap('tombstones').delete('placement-1');
    incoming.getMap('transforms').set('placement-1', {
      x: 99, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });

    expect(readCanvasDocument(incoming).placements['placement-1'].deleted).toBeUndefined();
    expect(() => assertCanvasDocumentTransition(previous, incoming))
      .toThrow('Canvas document tombstone cannot be removed');
  });

  it('merges a placement move with a concurrent annotation edit', () => {
    const first = createCanvasDocument();
    first.clientID = 1;
    applyCanvasImagePatch(first, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'first');
    const second = createCanvasDocument();
    second.clientID = 2;
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    applyCanvasImagePatch(first, { placementId: 'placement-1', x: 90 }, 'first');
    applyCanvasImagePatch(second, { placementId: 'placement-1', annotation: 'Updated' }, 'second');
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    expect(readCanvasDocument(first).placements['placement-1']).toMatchObject({
      x: 90, annotation: 'Updated',
    });
    expect(readCanvasDocument(second)).toEqual(readCanvasDocument(first));
  });

  it('accepts the existing asset-version ID contract without accepting arbitrary colon tokens', () => {
    const placement = {
      assetVersionId: `v${'a'.repeat(255)}`,
      x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    };
    expect(validateCanvasDocumentProjection({ placements: { 'placement-1': placement } }))
      .toEqual({ placements: { 'placement-1': placement } });
    expect(() => validateCanvasDocumentProjection({
      placements: { 'placement-1': { ...placement, assetVersionId: 'foo:bar' } },
    })).toThrow();
  });

  it('rejects a deprecated nested placement container used to overwrite a confirmed move', () => {
    const owner = createCanvasDocument();
    owner.clientID = 1;
    applyCanvasImagePatch(owner, {
      placementId: 'placement-1', assetVersionId: 'version-1',
      x: 0, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    }, 'owner');
    const stale = createCanvasDocument();
    stale.clientID = 2;
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(owner));
    applyCanvasImagePatch(owner, { placementId: 'placement-1', x: 100 }, 'owner');
    const previous = createCanvasDocument();
    Y.applyUpdate(previous, Y.encodeStateAsUpdate(owner));

    const replacement = new Y.Map<unknown>();
    stale.getMap<Y.Map<unknown>>('placements').set('placement-1', replacement);
    replacement.set('assetVersionId', 'version-1');
    replacement.set('transform', {
      x: 0, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
    });
    const candidate = createCanvasDocument();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(previous));
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(stale));

    expect(() => readCanvasDocument(candidate))
      .toThrow('Canvas document contains an unsupported root type');
    expect(() => assertCanvasDocumentTransition(previous, candidate))
      .toThrow('Canvas document contains an unsupported root type');
  });

  it('rejects raw deletion even when a placement ID matches an Object prototype property', () => {
    for (const placementId of ['constructor', 'toString', 'hasOwnProperty']) {
      const previous = createCanvasDocument();
      applyCanvasImagePatch(previous, {
        placementId, assetVersionId: 'version-1',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      }, 'owner');
      const candidate = createCanvasDocument();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(previous));
      candidate.getMap('assetVersions').delete(placementId);
      candidate.getMap('transforms').delete(placementId);

      expect(readCanvasDocument(candidate)).toEqual({ placements: {} });
      expect(() => assertCanvasDocumentTransition(previous, candidate))
        .toThrow('Canvas document placement cannot be revived or removed');
    }
  });
});
