// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useLayoutEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsdomCrypto as webcrypto } from '../helpers/jsdom-native-web-boundary';
import ts from 'typescript';
import type { CanvasImage } from '@/components/infinite-canvas';
import { commitDocumentCanvasFile, DocumentCanvasUploadError } from '@/lib/collaboration/document-canvas-upload';
import { canUseLegacyCanvasPersistence, routeCanvasWorkspaceChange,
  type CanvasWorkspaceAuthority } from '@/lib/collaboration/canvas-document-image-bridge';
import { serializeCanvasWorkspacePlacements } from '@/lib/asset-core/canvas-adapter';
import { buildAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import { isCanvasTaskProjectionChange } from '@/lib/canvas-kernel/commands';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';

// Execute the actual production callbacks, not a copy or a source-text assertion.
// HTTP, image decoding, React sinks and remote projection/storage are the external seams.
const sourcePath = resolve('src/components/canvas-workspace.tsx');
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const clientPath = resolve('src/lib/collaboration/document-client.ts');
const clientSource = ts.createSourceFile(clientPath, readFileSync(clientPath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function workspaceFunction<T>(name: string, bindings: Record<string, unknown> = {},
  callbackSource: ts.SourceFile = source): T {
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(callbackSource);
    if (name === 'unmountWorkspace' && ts.isCallExpression(node)
      && node.expression.getText(callbackSource) === 'useEffect'
      && node.arguments[0]?.getText(callbackSource).includes('isMountedRef.current = false')) {
      text = `const ${name} = (${node.arguments[0].getText(callbackSource)})();`;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(callbackSource) === name
      && node.initializer && ts.isCallExpression(node.initializer)) {
      text = `const ${name} = ${node.initializer.arguments[0].getText(callbackSource)};`;
    }
    ts.forEachChild(node, visit);
  };
  visit(callbackSource);
  if (!text) throw new Error(`Workspace function missing: ${name}`);
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings)) as T;
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
type Phase = 'save' | 'decode' | 'refresh' | 'flush';
type Mutation = 'project' | 'actor' | 'roundtrip' | 'generation' | 'refresh' | 'authority';
type Outcome = { image?: CanvasImage; error?: unknown };
const original: CanvasImage = { id: 'original-a', url: '/original.png', prompt: '',
  x: 10, y: 20, width: 40, height: 30, createdAt: 1 };
const canonical: CanvasImage = { id: 'canonical-entity', placementId: 'placement-a',
  assetId: 'asset-a', assetVersionId: 'version-a', url: '/canonical.png', prompt: '',
  x: 584, y: 388, width: 32, height: 24, originalWidth: 32, originalHeight: 24, createdAt: 2 };
function fixture(mode: 'document' | 'legacy' | 'unknown', options: {
  pause?: Phase; forbidden?: boolean; incomplete?: boolean; rejectImages?: boolean; flushFailure?: boolean;
  mediaCatchup?: 'restored' | 'still-incomplete';
} = {}) {
  const actor = { current: { id: 'actor-a' } };
  const project = { current: { id: 'project-a', metadata: { marker: 'a' } } };
  const epoch = { current: 7 }, historyProject = { current: 'project-a' };
  const mounted = { current: true };
  const unmount = workspaceFunction<() => void>('unmountWorkspace', {
    isMountedRef: mounted, quickCreateCompileControllerRef: { current: null },
  });
  const images = { current: [original] as CanvasImage[] };
  const recovery = { current: false }, pending = { current: false }, writable = { current: true };
  const rawImages: CanvasImage[][] = [], successes: string[] = [], errors: string[] = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const updates: Array<{ projectId: string; value: { canvasImages: CanvasImage[] } }> = [];
  const selected: CanvasImage[] = [], stabilized: unknown[] = [], refreshes: unknown[] = [];
  const entered = deferred<Phase>(), released = deferred<void>();
  const wait = async (phase: Phase): Promise<void> => {
    if (options.pause === phase) { entered.resolve(phase); await released.promise; }
  };
  const documentRef: { current: CanvasWorkspaceAuthority & {
    recordMediaHistory: () => void; isWritable: () => boolean;
    refreshMedia: (input: { projectId: string; documentSequence: number }) => Promise<CanvasImage[]>;
  } } = { current: { projectId: 'project-a', authority: mode, status: 'saved', images: {},
    recordMediaHistory: (): void => {},
    isWritable: workspaceFunction<() => boolean>('isWritable', {
      sessionRef: { current: { status: 'saved' } }, generationRef: { current: 1 }, generation: 1,
      mediaCompleteRef: writable, mediaSyncRef: { current: { lastError: null } },
    }, clientSource),
    refreshMedia: async (input): Promise<CanvasImage[]> => {
      refreshes.push(input); await wait('refresh');
      if (options.mediaCatchup === 'restored') writable.current = true;
      return options.incomplete ? [{ ...canonical, assetVersionId: 'wrong-version' }] : [canonical];
    } } };
  // Use the real decoder callback; only emulate the browser's load event.
  vi.stubGlobal('Image', function (): HTMLImageElement {
    const image = document.createElement('img');
    Object.defineProperties(image, { naturalWidth: { value: 32 }, naturalHeight: { value: 24 } });
    void wait('decode').then(() => image.dispatchEvent(new Event('load')));
    return image;
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init }); await wait('save');
    if (url === '/api/save-image') {
      return new Response(JSON.stringify({ success: true, url: '/legacy.png' }), { status: 200 });
    }
    if (url !== '/api/collaboration/document-assets/upload') throw new Error('Unexpected HTTP endpoint');
    // A real admitted upload can publish its WS placement before the directory arrives.
    if (options.mediaCatchup) writable.current = false;
    return new Response(JSON.stringify({ success: true, placementId: 'placement-a', assetVersionId: 'version-a',
      documentSequence: 9, assetReference: { assetId: 'asset-a', assetVersionId: 'version-a',
        placementId: 'placement-a', entityId: 'canonical-entity', kind: 'image', url: '/canonical.png' } }),
    { status: options.forbidden ? 403 : 200 });
  });
  const manager = {
    updateProject: (projectId: string, value: { canvasImages: CanvasImage[] }): void => {
      updates.push({ projectId, value });
    },
    flushProjectsToServer: async (): Promise<void> => {
      await wait('flush');
      if (options.flushFailure) throw new Error('remote flush failed');
    },
    recordDeletedImageIds: (): void => {},
  };
  const toast = { success: (message: string): void => { successes.push(message); },
    error: (message: string): void => { errors.push(message); } };
  const actualSetImages = workspaceFunction<(next: CanvasImage[]) => boolean>('setImages', {
    isDocumentHistoryRecoveryPending: (): boolean => recovery.current,
    latestImagesRef: images, queuedCanvasHistoryChangeRef: { current: null },
    historyProjectIdRef: historyProject, historyLifecyclePendingRef: pending,
    isCanvasTaskProjectionChange, routeCanvasWorkspaceChange, collaborativeCanvasRef: documentRef,
    toast, UserManagerCore: { getInstance: () => manager },
    incrementalHistoryRef: { current: new IncrementalHistoryManager<CanvasImage>() },
    prevImagesRef: { current: images.current },
    setImagesRaw: (next: CanvasImage[]): void => { rawImages.push(next); },
  });
  const upload = workspaceFunction<(file: File) => Promise<CanvasImage>>('handleUploadEffectReverseSource', {
    currentProject: project.current, currentProjectRef: project, currentUserRef: actor,
    isMountedRef: mounted,
    historyProjectIdRef: historyProject, historyTransitionEpochRef: epoch, collaborativeCanvasRef: documentRef,
    historyLifecyclePendingRef: pending, isDocumentHistoryRecoveryPending: (): boolean => recovery.current,
    latestImagesRef: images, groupsRef: { current: [] }, viewStateRef: { current: {} },
    annotationRecordsRef: { current: {} }, commitDocumentCanvasFile, DocumentCanvasUploadError,
    canUseLegacyCanvasPersistence, serializeCanvasWorkspacePlacements, buildAnnotationSourceVersionId,
    autoLayoutImages: workspaceFunction('autoLayoutImages'),
    getCanvasImageDisplaySize: workspaceFunction('getCanvasImageDisplaySize'),
    loadCanvasImageSize: workspaceFunction('loadCanvasImageSize'),
    setImages: (next: CanvasImage[]): boolean => {
      if (options.rejectImages) recovery.current = true;
      return actualSetImages(next);
    },
    UserManagerCore: { getInstance: () => manager }, toast,
    stabilizeCanvasImages: (value: unknown): void => { stabilized.push(value); },
    setSelectedImage: (image: CanvasImage): void => { selected.push(image); },
  });
  const run = (): Promise<Outcome> => upload(new File(['png'], 'source.png', { type: 'image/png' }))
    .then(image => ({ image }), error => ({ error }));
  const mutate = (kind: Mutation): CanvasImage[] => {
    if (kind === 'project') { project.current = { id: 'project-b', metadata: { marker: 'b' } };
      historyProject.current = 'project-b'; }
    if (kind === 'actor') actor.current = { id: 'actor-b' };
    if (kind === 'roundtrip') {
      project.current = { id: 'project-b', metadata: { marker: 'b' } }; epoch.current += 1;
      project.current = { id: 'project-a', metadata: { marker: 'a-returned' } }; epoch.current += 1;
    }
    if (kind === 'generation') documentRef.current = { ...documentRef.current, recordMediaHistory: (): void => {} };
    if (kind === 'refresh') documentRef.current = { ...documentRef.current, refreshMedia: async () => [] };
    if (kind === 'authority') documentRef.current = { ...documentRef.current,
      authority: mode === 'legacy' ? 'document' : 'legacy' };
    const untouched = [{ ...original, id: 'new-scope-image', url: '/new-scope.png' }];
    images.current = untouched;
    return untouched;
  };
  return { run, upload, images, rawImages, successes, errors, requests, updates, selected, stabilized,
    refreshes, documentRef, recovery, pending, writable, mutate, unmount,
    entered: entered.promise, release: (): void => released.resolve(undefined) };
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:source-preview', revokeObjectURL: (): void => {} });
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('actual reverse-source upload callback', () => {
  // Break caught: legacy save-image or unconfirmed local identity used in document mode.
  it('returns the authoritative CanvasImage after a controlled attach without local prewrite', async () => {
    const f = fixture('document');
    const outcome = await f.run();
    expect(outcome.error).toBeUndefined();
    expect(outcome.image).toBe(canonical);
    expect(f.images.current).toEqual([original]);
    expect(f.rawImages).toEqual([]); expect(f.updates).toEqual([]);
    expect(f.requests.map(request => request.url)).toEqual(['/api/collaboration/document-assets/upload']);
    const headers = new Headers(f.requests[0].init.headers);
    expect(headers.get('x-wujie-expected-actor-id')).toBe('actor-a');
    const metadata = JSON.parse(atob(headers.get('x-wujie-asset-import')!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(metadata.projectId).toBe('project-a');
    expect(metadata.command).toEqual({ action: 'attach',
      transform: { x: 60, y: 0, width: 32, height: 24, rotation: 0, zIndex: 1 } });
    expect(f.refreshes).toEqual([{ projectId: 'project-a', documentSequence: 9 }]);
    expect(f.successes).toHaveLength(1); expect(sessionStorage.length).toBe(0);
  });
  it.each(['forbidden', 'incomplete'] as const)('rejects document %s without fallback or false success', async (failure) => {
    const f = fixture('document', { [failure]: true });
    expect((await f.run()).error).toBeDefined();
    expect(f.images.current).toEqual([original]); expect(f.rawImages).toEqual([]);
    expect(f.updates).toEqual([]); expect(f.successes).toEqual([]); expect(f.selected).toEqual([]);
    expect(f.requests.every(request => request.url === '/api/collaboration/document-assets/upload')).toBe(true);
  });
  it('keeps successful legacy upload, layout, persisted snapshot and returned source identity', async () => {
    const f = fixture('legacy');
    const outcome = await f.run();
    expect(outcome.error).toBeUndefined();
    expect(outcome.image).toMatchObject({ url: '/legacy.png', name: 'source.png',
      x: 60, y: 0, width: 32, height: 24, originalWidth: 32, originalHeight: 24 });
    expect(f.images.current).toEqual([original, outcome.image]);
    expect(f.updates).toHaveLength(1); expect(f.updates[0].projectId).toBe('project-a');
    expect(f.updates[0].value.canvasImages.map(image => image.id)).toEqual(['original-a', outcome.image!.id]);
    expect(f.requests.map(request => request.url)).toEqual(['/api/save-image']);
    expect(f.successes).toHaveLength(1); expect(f.selected).toEqual([outcome.image]);
  });
  it('does not prewrite, persist or succeed when the real setImages admission rejects', async () => {
    const f = fixture('legacy', { rejectImages: true });
    expect((await f.run()).error).toBeDefined();
    expect(f.images.current).toEqual([original]); expect(f.rawImages).toEqual([]);
    expect(f.updates).toEqual([]); expect(f.successes).toEqual([]); expect(f.selected).toEqual([]);
  });
  it('refuses unresolved authority before any HTTP or local insertion', async () => {
    const f = fixture('unknown');
    expect((await f.run()).error).toBeDefined(); expect(f.requests).toEqual([]);
    expect(f.images.current).toEqual([original]); expect(f.successes).toEqual([]);
  });
  it('restores the same legacy scope on flush failure without success', async () => {
    const f = fixture('legacy', { flushFailure: true });
    expect((await f.run()).error).toBeDefined();
    expect(f.images.current).toEqual([original]); expect(f.updates).toHaveLength(2);
    expect(f.updates[1].value.canvasImages.map(image => image.id)).toEqual(['original-a']);
    expect(f.successes).toEqual([]);
  });
  // Break caught: missing actor/project/epoch/authority-generation fences at any await.
  for (const mode of ['legacy', 'document'] as const) {
    const phases: Phase[] = mode === 'legacy' ? ['save', 'decode', 'flush'] : ['decode', 'save', 'refresh'];
    for (const phase of phases) {
      it.each(['project', 'actor', 'roundtrip', 'generation', 'refresh', 'authority'] as const)(
        `rejects ${mode} %s change during ${phase} without touching the replacement scope`, async (mutation) => {
          const f = fixture(mode, { pause: phase });
          const operation = f.run();
          const reached = await Promise.race([f.entered.then(() => true), operation.then(() => false)]);
          // The old callback has no document refresh. Its false success is still a behavioral RED,
          // not a test timeout waiting for a nonexistent mock call.
          if (!reached) {
            expect((await operation).error).toBeDefined();
            expect(f.successes).toEqual([]);
            return;
          }
          const untouched = f.mutate(mutation), writesBefore = f.updates.length;
          f.release();
          expect((await operation).error).toBeDefined();
          expect(f.images.current).toBe(untouched);
          expect(f.updates).toHaveLength(writesBefore);
          expect(f.successes).toEqual([]); expect(f.selected).toEqual([]); expect(f.stabilized).toEqual([]);
        });
    }
  }
  it('does not roll back into a new project when the in-flight legacy flush rejects', async () => {
    const f = fixture('legacy', { pause: 'flush', flushFailure: true });
    const operation = f.run(); await f.entered;
    const untouched = f.mutate('project'), writesBefore = f.updates.length;
    f.release(); expect((await operation).error).toBeDefined();
    expect(f.images.current).toBe(untouched); expect(f.updates).toHaveLength(writesBefore);
    expect(f.successes).toEqual([]);
  });
  // Break caught: passive unmount leaves actor/project refs unchanged, allowing late work.
  for (const [mode, phase] of [
    ['legacy', 'save'], ['legacy', 'decode'], ['legacy', 'flush'],
    ['document', 'decode'], ['document', 'save'], ['document', 'refresh'],
  ] as const) {
    it(`rejects ${mode} unmount during ${phase} without late writes or success`, async () => {
      const f = fixture(mode, { pause: phase });
      const operation = f.run(); await f.entered;
      const imagesAtUnmount = f.images.current, writesBefore = f.updates.length;
      f.unmount(); f.release();
      expect((await operation).error).toBeDefined();
      expect(f.images.current).toBe(imagesAtUnmount);
      expect(f.updates).toHaveLength(writesBefore);
      expect(f.successes).toEqual([]); expect(f.selected).toEqual([]); expect(f.stabilized).toEqual([]);
    });
  }
  it('does not roll back or succeed after unmount during a failing legacy flush', async () => {
    const f = fixture('legacy', { pause: 'flush', flushFailure: true });
    const operation = f.run(); await f.entered;
    const imagesAtUnmount = f.images.current, writesBefore = f.updates.length;
    f.unmount(); f.release(); expect((await operation).error).toBeDefined();
    expect(f.images.current).toBe(imagesAtUnmount); expect(f.updates).toHaveLength(writesBefore);
    expect(f.successes).toEqual([]);
  });
});

describe('review I1 actual document catch-up', () => {
  it('refreshes an incomplete WS projection before the final writable check', async () => {
    const f = fixture('document', { mediaCatchup: 'restored' });
    const outcome = await f.run();
    expect(outcome.error).toBeUndefined(); expect(outcome.image).toBe(canonical);
    expect(f.refreshes).toEqual([{ projectId: 'project-a', documentSequence: 9 }]);
    expect(f.successes).toHaveLength(1); expect(f.rawImages).toEqual([]);
    expect(f.updates).toEqual([]); expect(sessionStorage.length).toBe(0);
  });
  it('performs the authorized read but refuses success if it remains not writable', async () => {
    const f = fixture('document', { mediaCatchup: 'still-incomplete' });
    expect((await f.run()).error).toBeDefined();
    expect(f.refreshes).toEqual([{ projectId: 'project-a', documentSequence: 9 }]);
    expect(f.successes).toEqual([]); expect(f.selected).toEqual([]); expect(f.updates).toEqual([]);
    expect(sessionStorage.length).toBe(1);
  });
  it('does not submit while the pre-commit document is already not writable', async () => {
    const f = fixture('document'); f.writable.current = false;
    expect((await f.run()).error).toBeDefined();
    expect(f.requests).toEqual([]); expect(f.refreshes).toEqual([]); expect(f.successes).toEqual([]);
  });
});

// Run only the local render-scope statements and wrapper from the actual InfiniteCanvas.
// React owns their refs/layout effects; no guard or cleanup is replaced by a test implementation.
const canvasPath = resolve('src/components/infinite-canvas.tsx');
const canvasSource = ts.createSourceFile(canvasPath, readFileSync(canvasPath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function renderReverseScope(bindings: Record<string, unknown>): unknown {
  const component = canvasSource.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'InfiniteCanvas');
  const statements = component?.body?.statements ?? [];
  const start = statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(canvasSource) === 'reverseSourceUploadScopeRef'));
  const end = statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(canvasSource) === 'handleUploadEffectReverseSource'));
  // Baseline has no local lifecycle support. Still execute its real wrapper so RED is
  // a false-success/wrong-selection assertion, never a missing-symbol failure.
  if (start < 0) return undefined;
  const text = statements.slice(start, end).map(node => node.getText(canvasSource)).join('\n');
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return reverseSourceUploadScopeRef;`)(...Object.values(bindings));
}
interface ConsumerSource { projectId: string; imageId: string; imageUrl: string; label: string }
interface ConsumerProps {
  projectId: string; identity: { actorId: string; projectId: string; generation: unknown };
  authority: 'legacy' | 'document';
  upload: (file: File) => Promise<CanvasImage>;
}
function consumerFixture() {
  const parent = fixture('document');
  const parentReturned = deferred<CanvasImage>();
  let props: ConsumerProps = { projectId: 'project-a', authority: 'document',
    identity: { actorId: 'actor-a', projectId: 'project-a', generation: parent.documentRef.current.refreshMedia },
    upload: (file: File): Promise<CanvasImage> => parent.upload(file).then(image => {
      parentReturned.resolve(image); return image;
    }) };
  let latestUpload!: (file: File) => Promise<ConsumerSource>;
  const sources: ConsumerSource[] = [], selections: Set<string>[] = [], parentSelections: CanvasImage[] = [];
  const selectSource = (value: ConsumerSource): void => { sources.push(value); };
  const selectIds = (value: Set<string>): void => { selections.push(value); };
  const selectImage = (value: CanvasImage): void => { parentSelections.push(value); };
  function Harness({ input }: { input: ConsumerProps }): React.JSX.Element | null {
    const mounted = useRef(true);
    const bindings = { projectId: input.projectId, brandProject: undefined,
      effectiveUploadAuthority: input.authority,
      annotationExecutionContext: { identity: input.identity }, onUploadEffectReverseSource: input.upload,
      useRef, useLayoutEffect, isMountedRef: mounted };
    const scope = renderReverseScope(bindings);
    latestUpload = workspaceFunction<(file: File) => Promise<ConsumerSource>>('handleUploadEffectReverseSource', {
      ...bindings, reverseSourceUploadScopeRef: scope, buildAnnotationSourceVersionId,
      setEffectReverseSource: selectSource, setSelectedIds: selectIds, onSelectImage: selectImage,
    }, canvasSource);
    return null;
  }
  let key = 0;
  const view = render(<Harness key={key} input={props} />);
  const originalUpload = latestUpload;
  const update = (input: ConsumerProps): void => {
    props = input; view.rerender(<Harness key={key} input={props} />);
  };
  const mutate = (kind: 'project' | 'roundtrip' | 'actor' | 'callback' | 'authority' | 'same-id-remount' | 'unmount'): void => {
    // Called after actual parent success, before the extra wrapper await resumes.
    act(() => {
      if (kind === 'project') update({ ...props, projectId: 'project-b' });
      if (kind === 'roundtrip') {
        update({ ...props, projectId: 'project-b' });
      }
      if (kind === 'actor') update({ ...props, identity: { ...props.identity, actorId: 'actor-b' } });
      if (kind === 'callback') update({ ...props, upload: props.upload.bind(null) });
      if (kind === 'authority') update({ ...props, authority: 'legacy' });
      if (kind === 'same-id-remount') { key += 1; update(props); }
      if (kind === 'unmount') view.unmount();
    });
    // Two separate committed renders, not a batched-away A -> B -> A transition.
    if (kind === 'roundtrip') act(() => update({ ...props, projectId: 'project-a' }));
  };
  return { sources, selections, parentSelections, parent, parentReturned: parentReturned.promise, mutate,
    run: (): Promise<{ source?: ConsumerSource; error?: unknown }> =>
      originalUpload(new File(['png'], 'source.png', { type: 'image/png' }))
        .then(source => ({ source }), error => ({ error })),
  };
}
describe('review I2 actual reverse-source wrapper continuation', () => {
  it('keeps the authoritative parent image as the normal consumer source', async () => {
    const f = consumerFixture(); const outcome = await f.run();
    expect(outcome.error).toBeUndefined();
    expect(outcome.source).toMatchObject({ projectId: 'project-a', imageId: 'canonical-entity',
      imageUrl: '/canonical.png', label: 'source.png' });
    expect(f.sources).toEqual([outcome.source]); expect(f.selections).toEqual([new Set(['canonical-entity'])]);
    expect(f.parentSelections).toEqual([canonical]);
  });
  it.each(['project', 'roundtrip', 'actor', 'callback', 'authority', 'same-id-remount', 'unmount'] as const)(
    'rejects %s between real parent return and wrapper consumption', async (mutation) => {
      const f = consumerFixture();
      const operation = f.run();
      expect(await f.parentReturned).toBe(canonical);
      f.mutate(mutation);
      expect((await operation).error).toBeDefined();
      expect(f.sources).toEqual([]); expect(f.selections).toEqual([]); expect(f.parentSelections).toEqual([]);
      // The parent succeeded in its original scope; the wrapper must not invent a second success.
      expect(f.parent.successes).toHaveLength(1);
    });
});
