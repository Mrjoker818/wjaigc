// Explicit post-build identity gate; run with --conditions=react-server --import tsx --test.
// Uses real source and real Turbopack artifacts. Does not start Next or query SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

test('服务端源码与所有已构建画布文档模块共享Yjs类型并可交换文档更新', async () => {
  const root = path.resolve(process.env.WUJIE_YJS_BUILD_ROOT || process.cwd());
  assert(!process.env.DATABASE_URL && !process.env.PGDATABASE_URL, 'Run this gate without database credentials');
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  const originalConnect = net.Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const warnings = [];
  const docs = [];
  let networkAttempts = 0;
  net.Socket.prototype.connect = function () {
    networkAttempts++;
    throw new Error('YJS_IDENTITY_GATE_NETWORK_FORBIDDEN');
  };
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error('YJS_IDENTITY_GATE_NETWORK_FORBIDDEN');
  };
  console.error = (...args) => {
    if (String(args[0]).includes('Yjs was already imported')) warnings.push(String(args[0]));
    originalError(...args);
  };
  try {
    const source = requireFromRoot('./src/lib/collaboration/canvas-document.ts');
    const Y = requireFromRoot('yjs');
    // Loading the route wrapper alone leaves its userland lazy. Await those
    // modules just as Next does while collecting page data for the build.
    const collaborationRoutes = ['document-enable', 'document-exchange', 'document-exchange-receipt', 'document-exchange-session'];
    const routes = collaborationRoutes.map(name => 'server/app/api/collaboration/' + name + '/route.js');
    for (const route of routes) {
      const { routeModule } = requireFromRoot('./.next/' + route);
      await routeModule.ensureUserland();
      assert.equal(typeof routeModule.userland.POST, 'function', 'Missing collaboration POST handler: ' + route);
    }
    assert.deepEqual(warnings, [], 'Duplicate Yjs import warning loading collaboration routes');
    const runtime = requireFromRoot('./.next/server/chunks/[turbopack]_runtime.js')(routes[0]);
    const candidates = new Set();
    for (const route of routes) {
      const routeSource = readFileSync(path.join(root, '.next', route), 'utf8');
      for (const [, chunk] of routeSource.matchAll(/\.c\("(server\/chunks\/src_lib_collaboration_canvas-document_ts_[^"]+\.js)"\)/g)) {
        candidates.add(chunk);
      }
    }
    assert(candidates.size > 0, 'No compiled canvas document chunks were found in the collaboration routes');
    for (const chunk of candidates) {
      const [id, factory, ...rest] = requireFromRoot('./.next/' + chunk);
      assert.equal(typeof id, 'number', 'Missing canvas document module id');
      assert.equal(typeof factory, 'function', 'Missing canvas document module factory');
      assert.equal(rest.length, 0, 'Expected a dedicated canvas document module chunk');
      const compiledDocument = await runtime.m(id).exports;
      // Production Turbopack mangles the export names. The dedicated chunk
      // has exactly one zero-argument function, which constructs a document.
      const constructors = Object.values(compiledDocument).filter(value => typeof value === 'function' && value.length === 0);
      assert.equal(constructors.length, 1, 'Expected one canvas document factory in ' + chunk);
      const sourceDoc = source.createCanvasDocument();
      docs.push(sourceDoc);
      assert.equal(sourceDoc.constructor, Y.Doc, 'Source entry must use native Yjs');
      const doc = constructors[0]();
      docs.push(doc);
      assert.equal(doc.constructor, Y.Doc, 'Compiled/source Y.Doc identity mismatch: ' + chunk);
      assert(sourceDoc instanceof doc.constructor && doc instanceof sourceDoc.constructor);
      const nested = new Y.Map();
      nested.set('value', 'shared-document-value');
      doc.getMap('identity-gate').set('nested', nested);
      Y.applyUpdate(sourceDoc, Y.encodeStateAsUpdate(doc));
      assert.equal(sourceDoc.getMap('identity-gate').get('nested').get('value'), 'shared-document-value');
      sourceDoc.getMap('identity-gate').set('source-only', 'reverse-update-value');
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(sourceDoc));
      assert.equal(doc.getMap('identity-gate').get('source-only'), 'reverse-update-value');
      assert.deepEqual(doc.getMap('identity-gate').toJSON(), sourceDoc.getMap('identity-gate').toJSON());
    }
    assert.deepEqual(warnings, [], 'Duplicate Yjs import warning');
    assert.equal(networkAttempts, 0);
    console.log(JSON.stringify({ compiledDocumentChunks: [...candidates], singleton: true,
      warningCount: warnings.length, networkAttempts }));
  } finally {
    for (const doc of docs) doc.destroy();
    net.Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
