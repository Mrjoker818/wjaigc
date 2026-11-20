import type * as YTypes from 'yjs';

// Yjs must evaluate exactly once per process. The Next.js build externalizes
// yjs as a hashed package alias (for example .next/node_modules/yjs-<hash>)
// that symlinks back to node_modules/yjs in the workspace. Deployment
// packaging may materialize that alias as a second physical copy, while the
// collaboration entry through tsx resolves node_modules/yjs directly. Loading
// two copies prints "Yjs was already imported" and breaks Y.Doc instanceof
// checks across the collaboration HTTP and WebSocket boundary, crashing the
// production server. Cache the first loaded instance on globalThis so every
// entry point shares it regardless of how many physical copies the runtime
// package contains.
type YjsModule = typeof YTypes;

const globalRef = globalThis as { __wujieYjsSingleton?: YjsModule };

function loadYjsSingleton(): YjsModule {
  if (!globalRef.__wujieYjsSingleton) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    globalRef.__wujieYjsSingleton = require('yjs') as YjsModule;
  }
  return globalRef.__wujieYjsSingleton;
}

export const Y: YjsModule = loadYjsSingleton();
