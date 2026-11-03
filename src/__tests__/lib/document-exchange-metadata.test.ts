import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { assertDocumentExchangeMetadataUpdate } from '@/lib/collaboration/document-exchange-metadata';

function scenario(write: (doc: Y.Doc) => void): { previous: Y.Doc; bytes: Uint8Array; dispose(): void } {
  const previous = new Y.Doc({ gc: false });
  previous.getMap('assetVersions').set('p-one', 'version-one');
  previous.getMap('transforms').set('p-one', { x: 1, y: 2, width: 80, height: 60, rotation: 0, zIndex: 1 });
  const edit = new Y.Doc({ gc: false }); Y.applyUpdate(edit, Y.encodeStateAsUpdate(previous));
  const before = Y.encodeStateVector(edit); write(edit);
  return { previous, bytes: Y.encodeStateAsUpdate(edit, before), dispose: () => { previous.destroy(); edit.destroy(); } };
}
describe('raw exchange versus authoritative media commands (real Yjs)', () => {
  it.each([
    ['attach', (doc: Y.Doc): void => { doc.getMap('assetVersions').set('p-two', 'version-two'); }],
    ['replace version', (doc: Y.Doc): void => { doc.getMap('assetVersions').set('p-one', 'version-two'); }],
    ['remove version', (doc: Y.Doc): void => { doc.getMap('assetVersions').delete('p-one'); }],
    ['tombstone placement', (doc: Y.Doc): void => { doc.getMap('tombstones').set('p-one', true); }],
    ['rewrite then restore', (doc: Y.Doc): void => { doc.getMap('assetVersions').set('p-one', 'version-two'); doc.getMap('assetVersions').set('p-one', 'version-one'); }],
  ] as const)('refuses raw %s instead of acknowledging an asset graph mutation', (_name, write) => {
    const f = scenario(write);
    try { expect(() => assertDocumentExchangeMetadataUpdate(f.previous, f.bytes)).toThrow('DOCUMENT_EXCHANGE_MEDIA_COMMAND_REQUIRED'); }
    finally { f.dispose(); }
  });
  it('allows a transform delta and leaves the caller document untouched', () => {
    const f = scenario(doc => doc.getMap('transforms').set('p-one', { x: 50, y: 2, width: 80, height: 60, rotation: 0, zIndex: 1 }));
    try {
      const before = Y.encodeStateAsUpdate(f.previous);
      expect(() => assertDocumentExchangeMetadataUpdate(f.previous, f.bytes)).not.toThrow();
      expect(Y.encodeStateAsUpdate(f.previous)).toEqual(before);
    } finally { f.dispose(); }
  });
  it('allows an already applied update without treating duplicate structs as a new media command', () => {
    const f = scenario(doc => doc.getMap('annotations').set('p-one', 'note'));
    try {
      const accepted = Y.encodeStateAsUpdate(f.previous);
      expect(() => assertDocumentExchangeMetadataUpdate(f.previous, accepted)).not.toThrow();
      expect(() => assertDocumentExchangeMetadataUpdate(f.previous, f.bytes)).not.toThrow();
    } finally { f.dispose(); }
  });
  it('refuses malformed bytes and still leaves the caller document intact', () => {
    const f = scenario(() => {});
    try {
      const before = Y.encodeStateAsUpdate(f.previous);
      expect(() => assertDocumentExchangeMetadataUpdate(f.previous, new Uint8Array([255]))).toThrow();
      expect(Y.encodeStateAsUpdate(f.previous)).toEqual(before);
    } finally { f.dispose(); }
  });
  it('defers a media suffix whose missing causal prefix prevents map observers from firing', () => {
    const previous = new Y.Doc(), edit = new Y.Doc({ gc: false }), probe = new Y.Doc();
    try {
      edit.getMap('annotations').set('prefix', 'metadata');
      const prefixVector = Y.encodeStateVector(edit);
      edit.getMap('assetVersions').set('p-one', 'version-one');
      const suffix = Y.encodeStateAsUpdate(edit, prefixVector);
      Y.applyUpdate(probe, suffix);
      expect(probe.store.pendingStructs).not.toBeNull();
      expect(probe.getMap('assetVersions').size).toBe(0);
      expect(() => assertDocumentExchangeMetadataUpdate(previous, suffix)).toThrow('DOCUMENT_EXCHANGE_DEPENDENCY_PENDING');
    } finally { previous.destroy(); edit.destroy(); probe.destroy(); }
  });
  it('defers a deletion set referencing a media struct that has not arrived', () => {
    const previous = new Y.Doc(), edit = new Y.Doc({ gc: false }), probe = new Y.Doc();
    try {
      edit.getMap('assetVersions').set('p-one', 'version-one');
      const beforeDelete = Y.encodeStateVector(edit);
      edit.getMap('assetVersions').delete('p-one');
      const suffix = Y.encodeStateAsUpdate(edit, beforeDelete);
      Y.applyUpdate(probe, suffix);
      expect(probe.store.pendingDs).not.toBeNull();
      expect(probe.getMap('assetVersions').size).toBe(0);
      expect(() => assertDocumentExchangeMetadataUpdate(previous, suffix)).toThrow('DOCUMENT_EXCHANGE_DEPENDENCY_PENDING');
    } finally { previous.destroy(); edit.destroy(); probe.destroy(); }
  });
  it('allows the same valid metadata suffix after its prefix is supplied instead of permanently discarding it', () => {
    const previous = new Y.Doc(), edit = new Y.Doc({ gc: false });
    try {
      edit.getMap('annotations').set('prefix', 'metadata');
      const prefix = Y.encodeStateAsUpdate(edit), vector = Y.encodeStateVector(edit);
      edit.getMap('annotations').set('second', 'metadata');
      const suffix = Y.encodeStateAsUpdate(edit, vector);
      expect(() => assertDocumentExchangeMetadataUpdate(previous, suffix)).toThrow('DOCUMENT_EXCHANGE_DEPENDENCY_PENDING');
      Y.applyUpdate(previous, prefix);
      expect(() => assertDocumentExchangeMetadataUpdate(previous, suffix)).not.toThrow();
    } finally { previous.destroy(); edit.destroy(); }
  });
});
