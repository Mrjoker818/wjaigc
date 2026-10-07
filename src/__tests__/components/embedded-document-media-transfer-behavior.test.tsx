// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImage } from '@/lib/user-types';
import { resolveCanvasSkillAssets } from '@/lib/skill-runtime/canvas-client';
const tree = ts.createSourceFile('workspace.tsx', readFileSync(resolve('src/components/canvas-workspace.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual<T>(name: string, bindings: Record<string, unknown>, optional = false): T {
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      const init = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      text = 'const ' + name + ' = ' + init.getText(tree) + ';';
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!text && optional) return undefined as T;
  if (!text) throw new Error('Actual callback missing ' + name);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), js + ';return ' + name)(...Object.values(bindings)) as T;
}
const shared = { assetId: 'shared-asset', assetVersionId: 'shared-version', placementId: 'shared-placement',
  entityId: 'entity', url: '/api/serve-upload/shared.png', kind: 'image' as const };
const canvas: CanvasImage = { id: 'entity', url: '/api/serve-upload/shared.png', assetId: 'shared-asset',
  assetVersionId: 'shared-version', placementId: 'shared-placement', prompt: '', x: 0, y: 0, width: 40, height: 30,
  originalWidth: 40, originalHeight: 30, rotation: 0, zIndex: 1, createdAt: 1 };
type Meta = { runId?: string; signal?: AbortSignal; restoreDeletedPlacement?: boolean };
async function fixture() {
  const actor = { current: { id: 'actor' } }, project = { current: { id: 'project' } }, epoch = { current: 1 };
  const mounted = { current: true }, historyProject = { current: 'project' };
  const pending = { current: false }, recovery = { current: false }, controller = new AbortController();
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [], success: unknown[] = [], infos: unknown[] = [];
  const reads: string[] = [];
  const refreshes: unknown[] = [], legacy: unknown[] = [], changed: string[] = [];
  const state = { phase: '', pause: '', failRefresh: false, catchup: false,
    result: undefined as unknown, skillResult: undefined as unknown,
    images: [canvas], mutate: undefined as (() => void) | undefined };
  const pause = async (phase: string): Promise<void> => { state.phase = phase; if (state.pause === phase) state.mutate?.(); };
  const authority = { projectId: 'project', authority: 'document', status: 'saved',
    recordMediaHistory: (): void => undefined, isWritable: (): boolean => true,
    refreshMedia: async (input: unknown): Promise<CanvasImage[]> => { refreshes.push(input); await pause('refresh');
      if (state.failRefresh) throw new Error('directory failed');
      if (state.catchup) authority.isWritable = () => true;
      return state.images; } };
  const documentRef = { current: authority };
  const latest = { current: [canvas] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
    if (init.method === 'GET' && init.body === undefined && init.credentials === 'include') {
      if (url === '/api/skill-runs/skill-run/assets?projectId=project&assetVersionId=shared-version') {
        reads.push(url);
        return Response.json({ projectId: 'project', runId: 'skill-run', actorUserId: 'actor',
          references: [{ ...shared, placementState: { kind: 'live', placementId: 'shared-placement' } }] });
      }
      if (url === '/api/skill-runs/private-run/assets?projectId=project&assetVersionId=private-a&assetVersionId=private-b') {
        reads.push(url);
        return Response.json(state.skillResult);
      }
      throw new Error('Unexpected read: ' + url);
    }
    if (url !== '/api/collaboration/document-assets/import-batch' || init.method !== 'POST'
      || typeof init.body !== 'string') throw new Error('Unexpected write: ' + url);
    calls.push({ url, body: JSON.parse(String(init.body)) }); await pause('fetch');
    return { ok: true, status: 200, json: async (): Promise<unknown> => { await pause('json'); return state.result ?? {
      success: true, projectId: 'project', documentSequence: 4, items: [{
        sourceVersionId: 'shared-version', mode: 'confirm', childKey: null, placementId: 'shared-placement',
        assetVersionId: 'shared-version', documentSequence: 4, assetReference: shared,
      }] }; } } as Response;
  });
  const bindings: Record<string, unknown> = { currentUserRef: actor, currentProjectRef: project,
    historyProjectIdRef: historyProject, historyTransitionEpochRef: epoch, isMountedRef: mounted,
    collaborativeCanvasRef: documentRef, historyLifecyclePendingRef: pending, latestImagesRef: latest,
    isDocumentHistoryRecoveryPending: (): boolean => recovery.current,
    documentMediaTransferIntentsRef: { current: new Map() },
    handleAddImages: async (): Promise<void> => { legacy.push('sink'); },
    transferCanvasSkillAsset: async (): Promise<never> => { legacy.push('personal'); throw new Error('personal must not execute'); },
    transferCanvasSkillAssets: async (): Promise<never> => { legacy.push('personal-batch'); throw new Error('personal must not execute'); },
    resolveCanvasSkillAssets,
    toast: { success: (x: unknown): void => { success.push(x); }, info: (x: unknown): void => { infos.push(x); } },
    autoLayoutImages: actual('autoLayoutImages', {}), getCanvasImageDisplaySize: actual('getCanvasImageDisplaySize', {}),
    loadCanvasImageSize: async (): Promise<{ width: number; height: number }> => {
      await pause('decode'); return { width: 40, height: 30 };
    },
    UserManagerCore: { getInstance: (): unknown => ({ getProjectSyncRevision: (): number => 0 }) },
    imageDeletionGenerationRef: { current: new Map() }, recentlyDeletedIdsRef: { current: new Set() } };
  if (existsSync(resolve('src/lib/collaboration/document-media-batch-client.ts'))) {
    const moduleName = '/src/lib/collaboration/document-media-batch-client.ts';
    Object.assign(bindings, await import(/* @vite-ignore */ moduleName));
  }
  bindings.captureCanvasInsertionScope = actual('captureCanvasInsertionScope', bindings);
  bindings.captureDocumentMediaTransferScope = actual('captureDocumentMediaTransferScope', bindings, true);
  bindings.handleAddDocumentEmbeddedMedia = actual('handleAddDocumentEmbeddedMedia', bindings, true);
  const single = actual<(ref: typeof shared, meta?: Meta) => Promise<void>>('handleAddEmbeddedChatImage', bindings);
  const batch = actual<(refs: typeof shared[], meta?: Meta) => Promise<void>>('handleAddEmbeddedChatImages', bindings);
  const mutate = (kind: string): void => { changed.push(kind);
    if (kind === 'project') project.current = { id: 'another' };
    else if (kind === 'actor') actor.current = { id: 'another' };
    else if (kind === 'roundtrip') epoch.current += 2;
    else if (kind === 'authority') documentRef.current = { ...authority };
    else if (kind === 'generation') authority.recordMediaHistory = (): void => undefined;
    else if (kind === 'unmount') mounted.current = false;
    else if (kind === 'pending') pending.current = true;
    else if (kind === 'recovery') recovery.current = true;
    else if (kind === 'abort') controller.abort(); };
  return { single, batch, state, calls, reads, refreshes, legacy, success, infos, mutate, controller, authority, latest };
}
afterEach(() => vi.unstubAllGlobals());
describe('1394 actual embedded document callbacks', () => {
  it('private layout freezes its intention only after decode against the latest actual baseline', async () => {
    const f = await fixture(); f.state.pause = 'decode';
    f.state.mutate = () => { f.latest.current = [{ ...canvas, id: 'peer', x: 300, zIndex: 10 }]; };
    f.state.result = { success: true, projectId: 'project', documentSequence: 4, items: [{
      sourceVersionId: 'private-a', mode: 'import', childKey: 'batch-child:fixture:0',
      placementId: shared.placementId, assetVersionId: shared.assetVersionId, documentSequence: 4, assetReference: shared }] };
    await f.single({ ...shared, assetVersionId: 'private-a', placementId: '' });
    const items = f.calls[0].body.items as Array<{ command: { transform: { x: number; zIndex: number } } }>;
    expect(items[0].command.transform).toMatchObject({ x: 350, zIndex: 11 });
    expect(f.legacy).toEqual([]);
  });
  it('scope loss during private decode rejects before issuing any batch or personal request', async () => {
    for (const mutation of ['actor','unmount','roundtrip']) {
      const f = await fixture(); f.state.pause = 'decode'; f.state.mutate = () => f.mutate(mutation);
      await expect(f.single({ ...shared, assetVersionId: 'private-a', placementId: '' })).rejects.toThrow('作用域');
      expect(f.calls).toEqual([]); expect(f.legacy).toEqual([]); expect(f.success).toEqual([]);
    }
  });
  it('single published result confirms its placement without personal copy or duplicate success', async () => {
    const f = await fixture();
    await expect(f.single(shared)).resolves.toBeUndefined();
    expect(f.calls.map(c => c.url)).toEqual(['/api/collaboration/document-assets/import-batch']);
    expect(f.legacy).toEqual([]); expect(f.success).toEqual([]);
    expect(f.refreshes).toEqual([{ projectId: 'project', documentSequence: 4, requireDirectorySequence: true }]);
  });
  it('Skill batch with registered versions uses the same document engine rather than personal transfer', async () => {
    const f = await fixture();
    await expect(f.batch([shared], { runId: 'skill-run' })).resolves.toBeUndefined();
    expect(f.reads).toEqual(['/api/skill-runs/skill-run/assets?projectId=project&assetVersionId=shared-version']);
    expect(f.calls.map(c => c.url)).toEqual(['/api/collaboration/document-assets/import-batch']);
    expect(f.calls[0].body).toMatchObject({ projectId: 'project', skillRunId: 'skill-run',
      items: [{ sourceVersionId: 'shared-version', placementId: 'shared-placement' }] });
    expect(f.refreshes).toEqual([{ projectId: 'project', documentSequence: 4, requireDirectorySequence: true }]);
    expect(f.legacy).toEqual([]);
  });
  it.each(['fetch', 'json', 'refresh'] as const)('rejects late scope after %s without any local or personal writes', async phase => {
    for (const mutation of ['project', 'actor', 'roundtrip', 'authority', 'generation', 'unmount', 'pending', 'recovery', 'abort']) {
      const f = await fixture();
      f.state.pause = phase; f.state.mutate = () => f.mutate(mutation);
      await expect(f.batch([shared], { signal: f.controller.signal })).rejects.toThrow('作用域');
      expect(f.legacy).toEqual([]); expect(f.success).toEqual([]);
    }
  });
  it('retains one request key and transform after directory failure, and final write revocation refuses success', async () => {
    const f = await fixture(); f.state.failRefresh = true;
    await expect(f.single(shared)).rejects.toThrow('directory failed');
    f.state.failRefresh = false;
    await f.single(shared);
    expect(f.calls).toHaveLength(2); expect(f.calls[0].body).toEqual(f.calls[1].body);
    expect(f.legacy).toEqual([]); expect(f.success).toEqual([]);
    const revoked = await fixture(); revoked.state.pause = 'refresh';
    revoked.state.mutate = () => { revoked.authority.isWritable = () => false; };
    await expect(revoked.single(shared)).rejects.toThrow('不可写');
    expect(revoked.success).toEqual([]);
  });
  it('rejects unknown authority, bare URL/version-less and explicit restore without personal fallback', async () => {
    const f = await fixture();
    await expect(f.single({ ...shared, assetVersionId: '' })).rejects.toThrow('版本引用');
    await expect(f.single(shared, { restoreDeletedPlacement: true })).rejects.toThrow();
    expect(f.calls).toEqual([]); expect(f.reads).toEqual([]); expect(f.refreshes).toEqual([]);
    expect(f.legacy).toEqual([]); expect(f.success).toEqual([]); expect(f.infos).toEqual([]);
    expect(f.latest.current).toEqual([canvas]);
    f.authority.authority = 'unknown';
    await expect(f.single(shared)).rejects.toThrow('作用域');
    expect(f.calls).toEqual([]); expect(f.legacy).toEqual([]);
  });
  it('allows authorized directory catch-up after WS invalidated write readiness, but requires final writable state', async () => {
    const f = await fixture(); f.state.pause = 'json'; f.state.catchup = true;
    f.state.mutate = () => { f.authority.isWritable = () => false; };
    await expect(f.single(shared)).resolves.toBeUndefined();
    expect(f.success).toEqual([]);
  });
  it('private two-item callback uses one batch, actual layout and one authoritative directory ACK, never a local sink', async () => {
    const f = await fixture();
    const references = ['a', 'b'].map(id => ({ ...shared, assetVersionId: 'private-' + id, placementId: '' }));
    f.state.skillResult = { projectId: 'project', runId: 'private-run', actorUserId: 'actor', references: [
      { kind: 'image', assetId: 'asset-0', assetVersionId: 'private-a', entityId: 'entity-0',
        url: '/api/serve-upload/shared.png', width: 40, height: 30, placementState: { kind: 'unplaced' } },
      { kind: 'image', assetId: 'asset-1', assetVersionId: 'private-b', entityId: 'entity-1',
        url: '/api/serve-upload/shared.png', width: 40, height: 30, placementState: { kind: 'unplaced' } },
    ] };
    const results = references.map((reference, index) => ({ sourceVersionId: reference.assetVersionId,
      mode: 'attach', childKey: 'batch-child:fixture:' + index, placementId: 'new-' + index,
      assetVersionId: reference.assetVersionId, documentSequence: index + 1,
      assetReference: { ...shared, assetId: 'asset-' + index, assetVersionId: reference.assetVersionId,
        placementId: 'new-' + index, entityId: 'entity-' + index } }));
    f.state.result = { success: true, projectId: 'project', documentSequence: 2, items: results };
    f.state.images = results.map(result => ({ ...canvas, id: result.assetReference.entityId,
      assetId: result.assetReference.assetId, assetVersionId: result.assetVersionId, placementId: result.placementId }));
    await f.batch(references, { runId: 'private-run' });
    expect(f.reads).toEqual(['/api/skill-runs/private-run/assets?projectId=project&assetVersionId=private-a&assetVersionId=private-b']);
    expect(f.calls).toHaveLength(1); expect(f.legacy).toEqual([]); expect(f.success).toHaveLength(1);
    expect(f.calls[0].body).toMatchObject({ projectId: 'project', skillRunId: 'private-run',
      items: [{ sourceVersionId: 'private-a' }, { sourceVersionId: 'private-b' }] });
    expect(f.refreshes).toEqual([{ projectId: 'project', documentSequence: 2, requireDirectorySequence: true }]);
    const items = f.calls[0].body.items as Array<{ command: { transform: { x: number; y: number; zIndex: number } } }>;
    expect(items.map(item => item.command.transform)).toMatchObject([{ x: 50, y: 0, zIndex: 2 }, { x: 100, y: 0, zIndex: 3 }]);
  });
});
