// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { CanvasImage } from '@/components/infinite-canvas';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions,
  findWorkspaceAssetReferenceByUrl, isWorkspaceResultScopeCurrent } from '@/lib/asset-core/workspace-transfer';
import { routeCanvasWorkspaceChange, type CanvasWorkspaceAuthority } from '@/lib/collaboration/canvas-document-image-bridge';
import { isCanvasTaskProjectionChange } from '@/lib/canvas-kernel/commands';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import { canvasSkillProjectionIdentity, transferCanvasSkillAsset, transferCanvasSkillAssets,
  createCanvasSkillProjectionCoordinator } from '@/lib/skill-runtime/canvas-client';

const workspace = ts.createSourceFile('workspace.tsx', readFileSync(resolve('src/components/canvas-workspace.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const chat = ts.createSourceFile('chat.tsx', readFileSync(resolve('src/components/chat-panel.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
// Evaluate production AST callbacks; only HTTP/decoding/storage and React sinks are external seams.
const compiled = new Map<string, string>();
function actual<T>(name: string, bindings: Record<string, unknown>, source = workspace, optional = false): T {
  const key = (source === chat ? 'chat:' : 'workspace:') + name;
  if (compiled.has(key)) return new Function(...Object.keys(bindings), compiled.get(key) + '; return ' + name + ';')(...Object.values(bindings)) as T;
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      const init = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      text = 'const ' + name + ' = ' + init.getText(source) + ';';
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source);
    if (name === 'unmountWorkspace' && ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'useEffect' && node.arguments[0]) {
      let ownsMount = false;
      const inspect = (child: ts.Node): void => {
        if (ts.isBinaryExpression(child) && child.left.getText(source) === 'isMountedRef.current'
          && child.right.kind === ts.SyntaxKind.FalseKeyword) ownsMount = true;
        ts.forEachChild(child, inspect);
      };
      inspect(node.arguments[0]);
      if (ownsMount) text = 'const unmountWorkspace = (' + node.arguments[0].getText(source) + ')();';
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!text && optional) return undefined as T; // Old callbacks do not call the absent local scope helper.
  if (!text) throw new Error('Production callback missing: ' + name);
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  compiled.set(key, js);
  return new Function(...Object.keys(bindings), js + '; return ' + name + ';')(...Object.values(bindings)) as T;
}
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}
type Meta = { sourceImageId?: string; modelName?: string; apiProvider?: string; runId?: string;
  sourceVersionIds?: readonly string[]; restoreDeletedPlacement?: boolean; signal?: AbortSignal; beforeInsert?: () => void };
type Sink = (inputs: Array<string | { outputNodeId: string; url: string; assetReference?: WorkspaceAssetReference }>,
  sourceId?: string, meta?: Meta) => Promise<void>;
const original: CanvasImage = { id: 'original-a', url: '/original.png', prompt: '', x: 10, y: 20,
  width: 40, height: 30, createdAt: 1, modelName: 'source-model', apiProvider: 'source-provider' };
const reference: WorkspaceAssetReference = { url: '/result.png', assetId: 'asset-a', assetVersionId: 'version-a',
  placementId: 'placement-a', entityId: 'canvas-skill:run-a:version-a', kind: 'image',
  sourceTrace: { source: 'canvas-skill', runId: 'run-a', skillId: 'skill-a', skillVersion: 1,
    sourceVersionIds: ['source-v'], createdAt: '2026-10-06T00:00:00.000Z' } };

type Phase = 'save' | 'json' | 'blob' | 'reader' | 'decode' | 'transfer' | 'transfer-json' | 'flush' | 'stable';
type Mutation = 'project' | 'actor' | 'roundtrip' | 'epoch' | 'generation' | 'refresh' | 'authority'
  | 'pending' | 'recovery' | 'unmount' | 'abort';
function fixture(mode: CanvasWorkspaceAuthority['authority'] = 'legacy', options: { pause?: Phase; realStabilization?: boolean } = {}) {
  const entered = deferred<void>(), released = deferred<void>(), controller = new AbortController();
  const wait = async (phase: Phase): Promise<void> => {
    if (options.pause === phase) { entered.release(); await released.promise; }
  };
  const actor = { current: { id: 'actor-a' } }, project = { current: { id: 'project-a' } };
  const historyProject = { current: 'project-a' }, epoch = { current: 7 }, mounted = { current: true };
  const recovery = { current: false }, pending = { current: false };
  const unmount = actual<() => void>('unmountWorkspace', { isMountedRef: mounted,
    quickCreateCompileControllerRef: { current: null } });
  const images = { current: [original] as CanvasImage[] }, history = new IncrementalHistoryManager<CanvasImage>();
  const documentRef = { current: { projectId: 'project-a', authority: mode, status: 'saved', images: {},
    recordMediaHistory: (): void => {}, refreshMedia: async (): Promise<CanvasImage[]> => [],
    isWritable: (): boolean => true } };
  const raw: CanvasImage[][] = [], saves: CanvasImage[][] = [], records: unknown[] = [], stable: unknown[] = [];
  const successes: string[] = [], infos: string[] = [], errors: string[] = [], connections: unknown[] = [];
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const routes: Array<{ before: string[]; after: string[]; kind: string }> = [];
  const revisions = { current: 4 }, cleared: string[][] = [];
  const deletion = { current: new Map<string, number>() }, deleted = { current: new Set<string>() };
  const toast = { success: (s: string): void => { successes.push(s); }, info: (s: string): void => { infos.push(s); },
    error: (s: string): void => { errors.push(s); } };
  const config: { reject: boolean; flushFailure: boolean; trashed: boolean; beforeAdmission?: () => void } = {
    reject: false, flushFailure: false, trashed: false,
  };
  const manager = {
    getProjectSyncRevision: (): number => revisions.current,
    advanceProjectSyncRevision: (r: number): void => { revisions.current = Math.max(revisions.current, r); },
    clearRecentlyDeletedImageIds: (ids: string[]): void => { cleared.push(ids); },
    recordDeletedImageIds: (): void => {},
    flushProjectsToServer: async (): Promise<void> => { await wait('flush'); if (config.flushFailure) throw new Error('flush failed'); },
  };
  const bindings: Record<string, unknown> = { currentUser: actor.current, currentUserRef: actor,
    currentProject: project.current, currentProjectRef: project, historyProjectIdRef: historyProject,
    historyTransitionEpochRef: epoch, isMountedRef: mounted, historyLifecyclePendingRef: pending,
    isDocumentHistoryRecoveryPending: (): boolean => recovery.current, collaborativeCanvasRef: documentRef,
    latestImagesRef: images, images: images.current, imageDeletionGenerationRef: deletion,
    recentlyDeletedIdsRef: deleted, UserManagerCore: { getInstance: () => manager }, toast,
    canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions, isWorkspaceResultScopeCurrent,
    canvasSkillProjectionIdentity, transferCanvasSkillAsset, transferCanvasSkillAssets,
    autoLayoutImages: actual('autoLayoutImages', {}), getCanvasImageDisplaySize: actual('getCanvasImageDisplaySize', {}),
    loadCanvasImageSize: actual('loadCanvasImageSize', {}),
    stabilizeCanvasImages: (v: unknown): void => { stable.push(v); },
    recordUserData: (v: unknown): void => { records.push(v); },
    createAutoConnection: (source: string, target: string, relation: string) => ({ source, target, relation }),
    setCanvasConnections: (change: (prev: unknown[]) => unknown[]): void => { connections.splice(0, connections.length, ...change(connections)); },
    persistCanvasImagesNow: (value: CanvasImage[]): void => { saves.push(value); },
  };
  type ImageSetter = (value: CanvasImage[] | ((previous: CanvasImage[]) => CanvasImage[]), options?: { history?: 'skip' }) => boolean;
  const set = actual<ImageSetter>('setImages', {
    ...bindings, queuedCanvasHistoryChangeRef: { current: null }, isCanvasTaskProjectionChange,
    routeCanvasWorkspaceChange: (...args: Parameters<typeof routeCanvasWorkspaceChange>) => {
      const routed = routeCanvasWorkspaceChange(...args);
      routes.push({ before: args[2].map(i => i.id), after: args[3].map(i => i.id), kind: routed.kind });
      return routed;
    }, incrementalHistoryRef: { current: history }, prevImagesRef: { current: images.current },
    setImagesRaw: (value: CanvasImage[]): void => { raw.push(value); },
  });
  // A real recovery admission can reject synchronously; restore the external state after it returns.
  bindings.setImages = (next: Parameters<ImageSetter>[0], options?: Parameters<ImageSetter>[1]): boolean => {
    config.beforeAdmission?.();
    if (config.reject) recovery.current = true;
    try { return set(next, options); } finally { if (config.reject) recovery.current = false; }
  };
  if (options.realStabilization) {
    const stabilizationBindings = { ...bindings };
    delete stabilizationBindings.stabilizeCanvasImages;
    bindings.stabilizeCanvasImages = actual('stabilizeCanvasImages', {
      ...stabilizationBindings, toStableImageUrl: async (): Promise<string> => { await wait('stable'); return '/stable.png'; },
    });
  }
  bindings.captureCanvasInsertionScope = actual('captureCanvasInsertionScope', bindings, workspace, true);
  const sink = actual<Sink>('handleAddImages', bindings);
  bindings.handleAddImages = sink;
  const single = actual<(ref: WorkspaceAssetReference, meta?: Meta) => Promise<void>>('handleAddEmbeddedChatImage', bindings);
  const batch = actual<(refs: WorkspaceAssetReference[], meta?: Meta) => Promise<void>>('handleAddEmbeddedChatImages', bindings);
  vi.stubGlobal('Image', function (): HTMLImageElement {
    const image = document.createElement('img');
    Object.defineProperties(image, { naturalWidth: { value: 32 }, naturalHeight: { value: 24 } });
    void wait('decode').then(() => image.dispatchEvent(new Event('load')));
    return image;
  });
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader): void {
    void wait('reader').then(() => {
      Object.defineProperty(this, 'result', { value: 'data:image/png;base64,AA==' });
      this.dispatchEvent(new ProgressEvent('loadend'));
    });
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url, body });
    const isTransfer = url.startsWith('/api/assets/');
    await wait(isTransfer ? 'transfer' : 'save');
    if (url.startsWith('blob:')) {
      const response = new Response('pixels'), getBlob = response.blob.bind(response);
      response.blob = async (): Promise<Blob> => { await wait('blob'); return getBlob(); };
      return response;
    }
    let payload: unknown;
    if (url === '/api/save-image') payload = { success: true, url: '/saved.png' };
    else if (url === '/api/assets/transfer') payload = { ...reference, projectRevision: 4,
      ...(config.trashed ? { placementStatus: 'trashed', placementRevision: '4' } : {}) };
    else if (url === '/api/assets/batch-transfer') {
      const transfers = body?.transfers as Array<{ sourceVersion: string; entityId: string }>;
      payload = { transfers: transfers.map((t, i) => ({ ...reference,
        assetId: i === 0 ? 'asset-a' : 'asset-b', assetVersionId: t.sourceVersion, entityId: t.entityId,
        placementId: i === 0 ? 'placement-a' : 'placement-b', url: i === 0 ? '/result.png' : '/second.png',
        projectRevision: 4 })) };
    } else throw new Error('Unexpected HTTP: ' + url);
    const response = new Response(JSON.stringify(payload)), getJson = response.json.bind(response);
    response.json = async (): Promise<unknown> => { await wait(isTransfer ? 'transfer-json' : 'json'); return getJson(); };
    return response;
  });
  const run = (op: () => Promise<void>): Promise<{ error?: unknown }> => op().then(() => ({}), error => ({ error }));
  const mutate = (kind: Mutation): CanvasImage[] => {
    if (kind === 'project') { project.current = { id: 'project-b' }; historyProject.current = 'project-b'; }
    if (kind === 'actor') actor.current = { id: 'actor-b' };
    if (kind === 'roundtrip') { project.current = { id: 'project-b' }; epoch.current++;
      project.current = { id: 'project-a' }; epoch.current++; }
    if (kind === 'epoch') epoch.current++;
    if (kind === 'generation') documentRef.current = { ...documentRef.current, recordMediaHistory: (): void => {} };
    if (kind === 'refresh') documentRef.current = { ...documentRef.current, refreshMedia: async () => [] };
    if (kind === 'authority') documentRef.current = { ...documentRef.current, authority: 'unknown' };
    if (kind === 'pending') pending.current = true;
    if (kind === 'recovery') recovery.current = true;
    if (kind === 'unmount') unmount();
    if (kind === 'abort') controller.abort();
    if (kind !== 'unmount' && kind !== 'abort' && kind !== 'pending' && kind !== 'recovery') {
      images.current = [{ ...original, id: 'replacement', url: '/replacement.png' }];
    }
    return images.current;
  };
  return { sink, single, batch, run, mutate, controller, entered: entered.promise,
    release: (): void => released.release(), bindings, actor, project, historyProject, epoch, mounted, recovery, pending,
    documentRef, images, history, raw, saves, records, stable, successes, infos, errors, connections, requests, routes,
    config, manager, revisions, deletion, deleted, cleared };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('actual embedded canvas insertion admission', () => {
  // Break: prewriting latestImagesRef destroys the real setImages/route/history before-state.
  it('admits a legacy batch with the untouched before-state and a real undo entry', async () => {
    const f = fixture();
    expect((await f.run(() => f.sink(['/local.png']))).error).toBeUndefined();
    expect(f.routes[0].before).toEqual(['original-a']);
    expect(f.routes[0].after).toHaveLength(2);
    expect(f.history.canUndo()).toBe(true); expect(f.raw).toHaveLength(1);
    expect(f.images.current.map(i => i.url)).toEqual(['/original.png', '/local.png']);
  });
  // Break: ignoring actual setImages false creates ghost refs and success side effects.
  it('propagates a real setImages refusal without prewrite or successor effects', async () => {
    const f = fixture(); f.config.reject = true; const before = f.images.current;
    expect((await f.run(() => f.sink(['/local.png']))).error).toBeDefined();
    expect(f.images.current).toBe(before); expect(f.raw).toEqual([]);
    expect(f.saves).toEqual([]); expect(f.stable).toEqual([]); expect(f.records).toEqual([]);
    expect(f.connections).toEqual([]); expect(f.successes).toEqual([]);
  });
  // Break: contaminated before=after can bypass real document command rejection.
  it('refuses generic document insertion rather than pretending controlled transfer is implemented', async () => {
    const f = fixture('document'); const before = f.images.current;
    expect((await f.run(() => f.sink([{ outputNodeId: 'result', url: reference.url, assetReference: reference }]))).error).toBeDefined();
    expect(f.images.current).toBe(before); expect(f.raw).toEqual([]); expect(f.successes).toEqual([]);
    expect(f.saves).toEqual([]); expect(f.records).toEqual([]);
  });
  // Break: Chat's raw URL fallback neither awaits nor catches the parent sink Promise.
  it('makes the real Chat fallback wait and report one sink error', async () => {
    const f = fixture(); f.config.reject = true;
    const release = deferred<void>(), started = deferred<void>(), pending: Promise<void>[] = [];
    const consume = actual<(url: string, message: unknown) => Promise<void>>('addGeneratedImageToCanvas', {
      providerDisplayName: (): string => 'provider', findWorkspaceAssetReferenceByUrl, onAddGeneratedImage: undefined,
      onAddImages: async (urls: string[]): Promise<void> => {
        const op = (async (): Promise<void> => { started.release(); await release.promise; await f.sink(urls); })();
        pending.push(op); void op.catch(() => undefined); return op;
      }, toast: { error: (s: string): void => { f.errors.push(s); } },
    }, chat);
    let finished = false;
    const operation = consume('/local.png', { generatedImageRefs: [], generateModelName: 'm' }).then(() => { finished = true; });
    await started.promise; await Promise.resolve(); await Promise.resolve();
    const wasEarly = finished; release.release(); await Promise.allSettled(pending); await operation;
    expect(wasEarly).toBe(false); expect(f.errors).toHaveLength(1); expect(f.successes).toEqual([]);
  });
});

describe('actual sink asynchronous scope and commit baseline', () => {
  const mutations: Mutation[] = ['project', 'actor', 'roundtrip', 'epoch', 'generation', 'refresh',
    'authority', 'pending', 'recovery', 'unmount', 'abort'];
  // Break: any await continuation can rebind an old result to a new actor/epoch/authority.
  for (const phase of ['save', 'json', 'decode', 'flush'] as const) {
    it.each(mutations)('rejects ' + phase + ' late %s without new-scope effects', async mutation => {
      const f = fixture('legacy', { pause: phase });
      const items = phase === 'flush' ? [{ outputNodeId: 'result', url: reference.url, assetReference: reference }]
        : ['https://fixture.invalid/source.png'];
      const operation = f.run(() => f.sink(items, undefined, { signal: f.controller.signal }));
      await f.entered; const untouched = f.mutate(mutation), writes = f.raw.length, saves = f.saves.length;
      f.release(); expect((await operation).error).toBeDefined();
      expect(f.images.current).toBe(untouched); expect(f.raw).toHaveLength(writes);
      expect(f.saves).toHaveLength(saves); expect(f.successes).toEqual([]); expect(f.infos).toEqual([]);
      expect(f.records).toEqual([]); expect(f.connections).toEqual([]); expect(f.stable).toEqual([]);
    });
  }
  it.each(['blob', 'reader'] as const)('refuses a late actor during actual ' + '%s' + ' conversion', async phase => {
    const f = fixture('legacy', { pause: phase });
    const operation = f.run(() => f.sink(['blob:fixture'], undefined, { signal: f.controller.signal }));
    await f.entered; const untouched = f.mutate('actor'); f.release();
    expect((await operation).error).toBeDefined(); expect(f.images.current).toBe(untouched);
    expect(f.raw).toEqual([]); expect(f.successes).toEqual([]);
    expect(f.requests.map(r => r.url)).toEqual(['blob:fixture']);
  });
  it.each(['unknown', 'document'] as const)('refuses %s before saving remote media', async mode => {
    const f = fixture(mode); const before = f.images.current;
    expect((await f.run(() => f.sink(['https://fixture.invalid/source.png']))).error).toBeDefined();
    expect(f.requests).toEqual([]); expect(f.images.current).toBe(before); expect(f.successes).toEqual([]);
  });
  it('does not treat an already aborted operation as successful dedup', async () => {
    const f = fixture(); f.controller.abort();
    expect((await f.run(() => f.sink(['/local.png'], undefined, { signal: f.controller.signal }))).error).toBeDefined();
    expect(f.raw).toEqual([]); expect(f.infos).toEqual([]);
  });
  it('rechecks scope after the real beforeInsert boundary', async () => {
    const f = fixture();
    expect((await f.run(() => f.sink(['/local.png'], undefined,
      { beforeInsert: () => { f.mutate('actor'); } }))).error).toBeDefined();
    expect(f.images.current.map(i => i.id)).toEqual(['replacement']);
    expect(f.raw).toEqual([]); expect(f.successes).toEqual([]);
  });
  it('uses the latest source and keeps concurrent media/model/connection state', async () => {
    const f = fixture('legacy', { pause: 'decode' });
    const operation = f.run(() => f.sink(['/local.png'], 'original-a'));
    await f.entered;
    const moved = { ...original, x: 90, y: 80, modelName: 'new-model', apiProvider: 'new-provider' };
    const concurrent = { ...original, id: 'peer', url: '/peer.png', zIndex: 7 };
    f.images.current = [moved, concurrent]; f.release(); expect((await operation).error).toBeUndefined();
    expect(f.images.current.slice(0, 2)).toEqual([moved, concurrent]);
    expect(f.images.current[2]).toMatchObject({ x: 160, y: 80, modelName: 'new-model',
      apiProvider: 'new-provider', generatedFromImageId: 'original-a', zIndex: 8 });
    expect(f.connections).toEqual([{ source: 'original-a', target: f.images.current[2].id, relation: 'variant' }]);
  });
  it('deduplicates a URL that arrived while decoding, not just the old render closure', async () => {
    const f = fixture('legacy', { pause: 'decode' });
    const operation = f.run(() => f.sink(['/local.png']));
    await f.entered; const concurrent = { ...original, id: 'peer', url: '/local.png' };
    f.images.current = [original, concurrent]; f.release(); expect((await operation).error).toBeUndefined();
    expect(f.images.current).toEqual([original, concurrent]); expect(f.raw).toEqual([]);
    expect(f.successes).toEqual([]); expect(f.infos).toHaveLength(1);
  });
  it('rolls back failed flush only while the current writable ref is its own commit', async () => {
    const f = fixture(); f.config.flushFailure = true;
    expect((await f.run(() => f.sink([{ outputNodeId: 'result', url: reference.url, assetReference: reference }]))).error).toBeDefined();
    expect(f.images.current).toEqual([original]); expect(f.saves).toHaveLength(2);
    expect(f.successes).toEqual([]); expect(f.records).toEqual([]);
  });
  it('does not roll back a concurrent edit after the failed flush', async () => {
    const f = fixture('legacy', { pause: 'flush' }); f.config.flushFailure = true;
    const operation = f.run(() => f.sink([{ outputNodeId: 'result', url: reference.url, assetReference: reference }]));
    await f.entered; const concurrent = [...f.images.current, { ...original, id: 'peer', url: '/peer.png' }];
    f.images.current = concurrent; f.release(); expect((await operation).error).toBeDefined();
    expect(f.images.current).toBe(concurrent); expect(f.raw).toHaveLength(1);
    expect(f.successes).toEqual([]); expect(f.records).toEqual([]);
  });
});

describe('actual embedded transfer parent to actual sink', () => {
  const transitions: Mutation[] = ['project', 'actor', 'roundtrip', 'epoch', 'generation', 'refresh',
    'authority', 'unmount', 'abort'];
  for (const kind of ['single', 'batch'] as const) {
    it.each(transitions)('keeps ' + kind + ' transfer in its original %s scope', async mutation => {
      const f = fixture('legacy', { pause: 'transfer' });
      const operation = f.run(() => kind === 'single'
        ? f.single(reference, { runId: 'run-a', sourceVersionIds: ['source-v'], signal: f.controller.signal })
        : f.batch([reference], { runId: 'run-a', sourceVersionIds: ['source-v'], signal: f.controller.signal }));
      await f.entered; const untouched = f.mutate(mutation); f.release();
      expect((await operation).error).toBeDefined(); expect(f.images.current).toBe(untouched);
      expect(f.raw).toEqual([]); expect(f.successes).toEqual([]); expect(f.infos).toEqual([]);
    });
    it.each(['transfer-json', 'decode'] as const)('rejects ' + kind + ' roundtrip during %s', async phase => {
      const f = fixture('legacy', { pause: phase });
      // A stale trashed response must not launch the real helper's subsequent restore request.
      const checkRestore = kind === 'single' && phase === 'transfer-json';
      f.config.trashed = checkRestore;
      const operation = f.run(() => kind === 'single'
        ? f.single(reference, { runId: 'run-a', signal: f.controller.signal, restoreDeletedPlacement: checkRestore })
        : f.batch([reference], { runId: 'run-a', signal: f.controller.signal }));
      await f.entered; const untouched = f.mutate('roundtrip'); f.release();
      expect((await operation).error).toBeDefined(); expect(f.images.current).toBe(untouched);
      expect(f.raw).toEqual([]); expect(f.successes).toEqual([]);
      if (checkRestore) expect(f.requests.map(request => request.url)).toEqual(['/api/assets/transfer']);
    });
    it.each(['unknown', 'document'] as const)('refuses ' + kind + ' %s before owner-only transfer', async mode => {
      const f = fixture(mode);
      expect((await f.run(() => kind === 'single'
        ? f.single(reference, { runId: 'run-a' }) : f.batch([reference], { runId: 'run-a' }))).error).toBeDefined();
      expect(f.requests).toEqual([]); expect(f.raw).toEqual([]); expect(f.successes).toEqual([]);
    });
    it('preserves ' + kind + ' explicit restore deletion guard during decoding', async () => {
      const f = fixture('legacy', { pause: 'decode' });
      const operation = f.run(() => kind === 'single'
        ? f.single(reference, { runId: 'run-a', restoreDeletedPlacement: true })
        : f.batch([reference], { runId: 'run-a', restoreDeletedPlacement: true }));
      await f.entered; f.deletion.current.set('canvas-skill:run-a:version-a', 1); f.release();
      expect((await operation).error).toBeDefined(); expect(f.raw).toEqual([]);
      expect(f.cleared).toEqual([]); expect(f.successes).toEqual([]);
    });
    it('preserves ' + kind + ' explicit restore revision guard', async () => {
      const f = fixture('legacy', { pause: 'decode' });
      const operation = f.run(() => kind === 'single'
        ? f.single(reference, { runId: 'run-a', restoreDeletedPlacement: true })
        : f.batch([reference], { runId: 'run-a', restoreDeletedPlacement: true }));
      await f.entered; f.revisions.current = 5; f.release();
      expect((await operation).error).toBeDefined(); expect(f.raw).toEqual([]);
      expect(f.cleared).toEqual([]); expect(f.successes).toEqual([]);
    });
  }
  it('keeps the single Chat transfer target and exact reference identity', async () => {
    const f = fixture(); expect((await f.run(() => f.single(reference, { modelName: 'm', apiProvider: 'p' }))).error).toBeUndefined();
    expect(f.requests.map(r => r.url)).toEqual(['/api/assets/transfer']);
    expect(f.requests[0].body).toMatchObject({ sourceVersion: 'version-a', targetProject: 'project-a', targetWorkspace: 'canvas:project-a' });
    expect(f.images.current[1]).toMatchObject({ id: 'canvas-skill:run-a:version-a', assetId: 'asset-a',
      assetVersionId: 'version-a', placementId: 'placement-a', modelName: 'm', apiProvider: 'p',
      sourceTrace: reference.sourceTrace });
    expect(f.saves).toHaveLength(1); expect(f.successes).toHaveLength(1);
  });
  it('preserves one atomic batch transfer request, run/source versions, restoration and identity', async () => {
    const f = fixture();
    const second = { ...reference, assetVersionId: 'version-b', assetId: 'asset-b', placementId: 'placement-b', url: '/second.png' };
    expect((await f.run(() => f.batch([reference, second], { runId: 'run-a', sourceVersionIds: ['source-v'],
      restoreDeletedPlacement: true }))).error).toBeUndefined();
    expect(f.requests.map(r => r.url)).toEqual(['/api/assets/batch-transfer']);
    expect(f.requests[0].body).toMatchObject({ restoreDeletedPlacements: true, transfers: [
      { entityId: 'canvas-skill:run-a:version-a', metadata: { runId: 'run-a', sourceVersionIds: ['source-v'] } },
      { entityId: 'canvas-skill:run-a:version-b', metadata: { runId: 'run-a', sourceVersionIds: ['source-v'] } },
    ] });
    expect(f.images.current.map(i => i.id)).toEqual(['original-a', 'canvas-skill:run-a:version-a', 'canvas-skill:run-a:version-b']);
    expect(f.raw).toHaveLength(1); expect(f.saves).toHaveLength(1); expect(f.successes).toHaveLength(1);
  });
  it('lets the real Skill coordinator reject a late abort and retry instead of recording false completion', async () => {
    const f = fixture('legacy', { pause: 'transfer' }), coordinator = createCanvasSkillProjectionCoordinator();
    const cancelled = new AbortController(); coordinator.activate('run-a', 'project-a');
    const operation = f.run(async () => { await coordinator.project({ runId: 'run-a', projectId: 'project-a',
      assetVersionId: 'version-a', project: () => f.single(reference, { runId: 'run-a', signal: cancelled.signal }) }); });
    await f.entered; cancelled.abort(); f.release();
    expect((await operation).error).toBeDefined(); expect(f.raw).toEqual([]);
    expect(await coordinator.project({ runId: 'run-a', projectId: 'project-a', assetVersionId: 'version-a',
      project: signal => f.single(reference, { runId: 'run-a', signal }) })).toBe(true);
    expect(f.images.current[1].assetVersionId).toBe('version-a');
  });
});

// Execute the actual video delivery branch plus its next message effect, not a copied forwarding formula.
function actualVideoDelivery(bindings: Record<string, unknown>): () => Promise<void> {
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && ts.isBlock(node.parent)) {
      // Select the direct delivery statement, not an outer block that merely contains it.
      const body = node.thenStatement;
      const expression = ts.isExpressionStatement(body) ? body.expression : undefined;
      const call = expression && ts.isAwaitExpression(expression) ? expression.expression : expression;
      if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)
        && call.expression.text === 'onAddImages' && call.arguments[0]?.getText(chat) === 'newVideoUrls') {
        const index = node.parent.statements.indexOf(node);
        const next = node.parent.statements[index + 1];
        if (!next || !ts.isExpressionStatement(next) || !ts.isCallExpression(next.expression)
          || next.expression.expression.getText(chat) !== 'setMessages') throw new Error('Video successor missing');
        text = node.getText(chat) + '\n' + next.getText(chat);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(chat); if (!text) throw new Error('Actual video delivery missing');
  const js = ts.transpileModule('const deliver = async () => {' + text + '};',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), js + '; return deliver;')(...Object.values(bindings));
}
it('waits for actual video insertion before reporting finished message state', async () => {
  const f = fixture('legacy', { pause: 'decode' }); const pending: Promise<void>[] = [], messages: unknown[] = [];
  const deliver = actualVideoDelivery({ newVideoUrls: ['/video.mp4'], assistantMessageId: 'assistant-a',
    onAddImages: (urls: string[]): Promise<void> => { const op = f.sink(urls); pending.push(op); void op.catch(() => undefined); return op; },
    setMessages: (change: (prev: unknown[]) => unknown[]): void => { messages.push(change([{ id: 'assistant-a' }])); } });
  let finished = false; const operation = deliver().then(() => { finished = true; });
  await f.entered; await Promise.resolve(); const wasEarly = finished, messagesBefore = messages.length;
  f.release(); await Promise.allSettled(pending); await operation;
  expect(wasEarly).toBe(false); expect(messagesBefore).toBe(0); expect(messages).toHaveLength(1);
});

function actualJsxInsertion(component: string, bindings: Record<string, unknown>, source = workspace): (...args: unknown[]) => unknown {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === component) {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(source) === 'onAddImages'
          && prop.initializer && ts.isJsxExpression(prop.initializer)) expression = prop.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source); if (!expression) throw new Error('Actual insertion prop missing: ' + component);
  const js = ts.transpileModule('const callback = ' + expression.getText(source) + ';',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), js + '; return callback;')(...Object.values(bindings));
}

it('reports actual Markdown insertion rejection once instead of leaving a floating Promise', async () => {
  const f = fixture(); f.config.reject = true;
  const pending: Promise<void>[] = [];
  const onAddImages = (urls: string[]): Promise<void> => {
    const op = f.sink(urls); pending.push(op); void op.catch(() => undefined); return op;
  };
  const message = { generatedImageRefs: [], generateModelName: 'model-a' };
  const bindings = { onAddImages, onAddGeneratedImage: undefined, message, isGold: false,
    providerDisplayName: (): string => 'provider-a', findWorkspaceAssetReferenceByUrl,
    toast: { error: (s: string): void => { f.errors.push(s); } } };
  const addGeneratedImageToCanvas = actual('addGeneratedImageToCanvas', bindings, chat);
  let callback: ((url: string) => unknown) | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'createMarkdownComponents' && node.arguments[1]
      && ts.isConditionalExpression(node.arguments[1])) {
      const js = ts.transpileModule('const callback = ' + node.arguments[1].whenTrue.getText(chat) + ';',
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
      callback = new Function(...Object.keys(bindings), 'addGeneratedImageToCanvas', js + '; return callback;')(
        ...Object.values(bindings), addGeneratedImageToCanvas);
    }
    ts.forEachChild(node, visit);
  };
  visit(chat); expect(callback).toBeTypeOf('function');
  callback!('/local.png'); await Promise.allSettled(pending); await Promise.resolve(); await Promise.resolve();
  expect(f.errors).toHaveLength(1); expect(f.successes).toEqual([]);
});

it('reports actual VideoGenerationPanel void adapter rejection once', async () => {
  const f = fixture(); f.config.reject = true; const pending: Promise<void>[] = [];
  const handleAddImages = (urls: string[]): Promise<void> => {
    const op = f.sink(urls); pending.push(op); void op.catch(() => undefined); return op;
  };
  const bindings = { handleAddImages, toast: { error: (s: string): void => { f.errors.push(s); } } };
  const handleAddImagesFromUi = actual('handleAddImagesFromUi', bindings, workspace, true);
  const callback = actualJsxInsertion('VideoGenerationPanel', { ...bindings, handleAddImagesFromUi });
  callback(['/local.png']); await Promise.allSettled(pending); await Promise.resolve(); await Promise.resolve();
  expect(f.errors).toHaveLength(1); expect(f.successes).toEqual([]);
});

it('does not settle the actual NodeEditor consumer when workspace insertion rejects', async () => {
  const f = fixture(); f.config.reject = true; const pending: Promise<void>[] = [];
  const node = ts.createSourceFile('node.tsx', readFileSync(resolve('src/components/node-editor.tsx'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const onAddImages = actualJsxInsertion('NodeEditor', {
    handleAddImages: (items: Parameters<Sink>[0], source: string | undefined, meta: Meta): Promise<void> => {
      const op = f.sink(items, source, meta); pending.push(op); void op.catch(() => undefined); return op;
    },
  });
  let delivery: ts.IfStatement | undefined, settled: ts.ExpressionStatement | undefined, catcher: ts.CatchClause | undefined;
  const visit = (item: ts.Node): void => {
    if (ts.isCallExpression(item) && ts.isIdentifier(item.expression) && item.expression.text === 'onAddImages'
      && item.arguments[0]?.getText(node) === 'insertion.items') {
      let parent: ts.Node | undefined = item.parent;
      while (parent && !ts.isIfStatement(parent)) parent = parent.parent;
      delivery = parent as ts.IfStatement;
      while (parent && !ts.isTryStatement(parent)) parent = parent.parent;
      if (parent && ts.isTryStatement(parent)) catcher = parent.catchClause;
    }
    if (ts.isExpressionStatement(item) && ts.isBinaryExpression(item.expression)
      && item.expression.left.getText(node) === 'canvasPersistence.settled') settled = item;
    ts.forEachChild(item, visit);
  };
  visit(node); if (!delivery || !settled || !catcher) throw new Error('Node delivery/catch boundary missing');
  const retries: unknown[] = [], canvasPersistence = { settled: false };
  const bindings = { onAddImages, insertion: { items: ['/local.png'] }, meta: {}, canvasPersistence,
    controller: f.controller, pollCount: 1, poll: (): void => {}, timerId: undefined,
    setTimeout: (op: unknown): number => { retries.push(op); return 1; },
    setExecStatus: (): void => {}, console: { error: (): void => {} } };
  const js = ts.transpileModule('const deliver = async () => { try {' + delivery.getText(node)
    + settled.getText(node) + '} ' + catcher.getText(node) + '};',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const deliver = new Function(...Object.keys(bindings), js + '; return deliver;')(...Object.values(bindings));
  await deliver(); await Promise.allSettled(pending);
  expect(canvasPersistence.settled).toBe(false); expect(retries).toHaveLength(1);
  expect(f.successes).toEqual([]);
});

describe('actual stabilization continuation fix1', () => {
  // Break: a guard added without the real helper path must not suppress valid stabilization.
  const settle = async (f: ReturnType<typeof fixture>): Promise<void> => {
    f.release();
    // Drain the production await / Promise.all.then chain after the controlled external resolution.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  it('stabilizes normal admitted media through the real helper and real setImages', async () => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    await f.sink(['/local.png']); await f.entered;
    const insertedId = f.images.current[1].id, writes = f.raw.length;
    await settle(f);
    expect(f.images.current[1]).toMatchObject({ id: insertedId, url: '/stable.png' });
    expect(f.images.current[0]).toEqual(original); expect(f.raw).toHaveLength(writes + 1);
  });
  // Break: the original helper consumes current refs after old-project URL resolution.
  it.each<Mutation>(['actor', 'project', 'roundtrip', 'authority', 'epoch', 'unmount', 'abort'])(
    'refuses late %s with the same image ID after stable URL resolution', async mutation => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    await f.sink(['/local.png'], undefined, { signal: f.controller.signal }); await f.entered;
    const inserted = f.images.current[1]; f.mutate(mutation);
    const nextScope = [original, { ...inserted, url: '/new-scope.png' }]; f.images.current = nextScope;
    const writes = f.raw.length, routes = f.routes.length;
    await settle(f);
    expect(f.images.current).toBe(nextScope); expect(f.images.current[1].url).toBe('/new-scope.png');
    expect(f.raw).toHaveLength(writes); expect(f.routes).toHaveLength(routes);
  });
  // Break: ID-only matching overwrites an intervening URL replacement in the same writable scope.
  it('keeps a same-ID concurrent URL replacement instead of applying the old stable URL', async () => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    await f.sink(['/local.png']); await f.entered;
    const concurrent = f.images.current.map(image => image.url === '/local.png' ? { ...image, url: '/edited.png' } : image);
    f.images.current = concurrent; await settle(f);
    expect(f.images.current[1].url).toBe('/edited.png'); expect(f.images.current[1]).toBe(concurrent[1]);
  });

  it('keeps default no-guard helper behavior for existing callers', async () => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    const stabilize = f.bindings.stabilizeCanvasImages as (items: Array<{ id: string; url: string }>) => void;
    stabilize([{ id: original.id, url: original.url }]); await f.entered; await settle(f);
    expect(f.images.current[0].url).toBe('/stable.png'); expect(f.raw).toHaveLength(1);
  });
  it('honors a real setImages admission refusal during stable URL consumption', async () => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    await f.sink(['/local.png']); await f.entered; const before = f.images.current, writes = f.raw.length;
    f.config.reject = true; await settle(f);
    expect(f.images.current).toBe(before); expect(f.raw).toHaveLength(writes);
    expect(f.images.current[1].url).toBe('/local.png');
  });
  // Break: guarding only then() is insufficient if the functional setter consumes after scope changes.
  it('rechecks the same scope at real functional setter consumption', async () => {
    const f = fixture('legacy', { pause: 'stable', realStabilization: true });
    await f.sink(['/local.png']); await f.entered; const before = f.images.current;
    f.config.beforeAdmission = () => { f.mutate('actor'); f.images.current = before; };
    await settle(f);
    expect(f.images.current).toBe(before); expect(f.images.current[1].url).toBe('/local.png');
  });

});
