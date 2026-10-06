// Explicit post-build identity gate; run with --conditions=react-server --import tsx --test.
// Uses real source and real Turbopack artifacts. Does not start Next or query SQL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
    requireFromRoot('./.next/server/app/api/collaboration/document-enable/route.js');
    const runtime = requireFromRoot('./.next/server/chunks/[turbopack]_runtime.js')(
      'server/app/api/collaboration/document-enable/route.js',
    );
    const chunkDirectory = path.join(root, '.next/server/chunks');
    const candidates = new Set();
    for (const name of readdirSync(chunkDirectory).filter(name => name.endsWith('.js') && !name.includes('[turbopack]_runtime'))) {
      const file = path.join(chunkDirectory, name);
      if (!readFileSync(file, 'utf8').includes('"createCanvasDocument"')) continue;
      const factories = requireFromRoot(file);
      assert(Array.isArray(factories), 'Unexpected Turbopack artifact layout: ' + name);
      runtime.c('server/chunks/' + name);
      for (let index = 1; index < factories.length; index++) {
        if (typeof factories[index] !== 'function' || !factories[index].toString().includes('"createCanvasDocument"')) continue;
        assert.equal(typeof factories[index - 1], 'number', 'Missing module identity: ' + name);
        candidates.add(factories[index - 1]);
      }
    }
    assert(candidates.size > 0, 'No compiled canvas document modules were examined');
    const modules = [];
    for (const id of candidates) modules.push({ id, exports: await runtime.m(id).exports });
    for (const compiledDocument of modules) {
      assert.equal(typeof compiledDocument.exports.createCanvasDocument, 'function', 'Discovered module lacks document API');
      const sourceDoc = source.createCanvasDocument();
      docs.push(sourceDoc);
      assert.equal(sourceDoc.constructor, Y.Doc, 'Source entry must use native Yjs');
      const doc = compiledDocument.exports.createCanvasDocument();
      docs.push(doc);
      assert.equal(doc.constructor, Y.Doc, 'Compiled/source Y.Doc identity mismatch: module ' + compiledDocument.id);
      assert(sourceDoc instanceof doc.constructor && doc instanceof sourceDoc.constructor);
      assert.deepEqual(compiledDocument.exports.readCanvasDocument(sourceDoc), source.readCanvasDocument(sourceDoc));
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
    console.log(JSON.stringify({ compiledDocumentModules: modules.map(module => module.id), singleton: true,
      warningCount: warnings.length, networkAttempts }));
  } finally {
    for (const doc of docs) doc.destroy();
    net.Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
