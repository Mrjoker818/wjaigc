import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { performance } from 'node:perf_hooks';

import { readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { assertCanonicalDocumentPayload } from '@/lib/collaboration/document-store';

vi.mock('server-only', () => ({}));

describe('canonical Yjs document payload', () => {
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
