import type * as YTypes from 'yjs';

// Share the CommonJS Yjs instance with the document store and gateway.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y: typeof YTypes = require('yjs');

export class DocumentExchangeDependencyPendingError extends Error {
  constructor() { super('DOCUMENT_EXCHANGE_DEPENDENCY_PENDING'); }
}

/** Isolated policy candidate; raw synchronization never replaces typed media commands. */
export function assertDocumentExchangeMetadataUpdate(previous: YTypes.Doc, bytes: Uint8Array): void {
  const candidate = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(previous));
    let mediaChanged = false;
    const changed = (): void => { mediaChanged = true; };
    const versions = candidate.getMap('assetVersions'), tombstones = candidate.getMap('tombstones');
    versions.observe(changed); tombstones.observe(changed);
    try {
      Y.applyUpdate(candidate, bytes);
      // Pinned Yjs 13.6.33 retains causally incomplete structs/deletion sets
      // without firing map observers. Never persist or ACK such a candidate.
      if (candidate.store.pendingStructs !== null || candidate.store.pendingDs !== null) {
        throw new DocumentExchangeDependencyPendingError();
      }
      if (mediaChanged) throw new Error('DOCUMENT_EXCHANGE_MEDIA_COMMAND_REQUIRED');
    } finally { versions.unobserve(changed); tombstones.unobserve(changed); }
  } finally { candidate.destroy(); }
}
