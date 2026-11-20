import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { Y } from '@/lib/collaboration/yjs-singleton';

// Guards the production failure where two physical yjs copies loaded in one
// process (the hashed Next.js external copy plus the node_modules copy used
// by the tsx presence entry), printing "Yjs was already imported" and
// breaking Y.Doc instanceof checks across the collaboration HTTP/WebSocket
// boundary until the server exited with code 1.
describe('yjs-singleton', () => {
  it('reuses the first loaded yjs module for every consumer', () => {
    const require = createRequire(`${process.cwd()}/`);
    const direct = require('yjs') as typeof Y;

    expect(Y).toBe(direct);

    const doc = new Y.Doc();
    expect(doc).toBeInstanceOf(direct.Doc);
    expect(Y.encodeStateAsUpdate(doc)).toBeInstanceOf(Uint8Array);
  });

  it('keeps the cached instance across repeated module imports', async () => {
    const again = await import('@/lib/collaboration/yjs-singleton');
    expect(again.Y).toBe(Y);
  });
});
