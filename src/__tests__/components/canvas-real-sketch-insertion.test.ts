// @vitest-environment node
/**
 * Integration regression discovered by the original root configuration.
 *
 * Execute the actual CanvasWorkspace callbacks together, without mounting its
 * unrelated giant host or replacing insertSketchResult with an observation sink.
 * Only browser/state, image decoding, HTTP transport, persistence and UI effects
 * are supplied by the harness. Asset IDs, dedupe, source parsing, both placement
 * clients, protected fresh polling and scope callbacks remain product code.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImage } from '@/components/infinite-canvas';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import {
  canvasEntityIdForTransferredReference,
  filterUniqueCanvasImageInsertions,
} from '@/lib/asset-core/workspace-transfer';
import { parseWorkspaceSourceTrace, type SketchWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import { createAutoConnection } from '@/lib/canvas-connections';
import { validSketchId, type SketchScope, type SketchTask } from '@/lib/sketch-to-code/client';
import type { SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import { SketchPlacement, type SketchInsert, type SketchTransform } from '@/lib/sketch-to-code/placement-client';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ACTOR = 'actor-canvas-regression';
const PROJECT = 'project-canvas-regression';
const transform: Readonly<SketchTransform> = Object.freeze({
  x: 680, y: -35, width: 640, height: 480, rotation: 12, zIndex: 8,
});

interface Cell<T> { current: T }
interface InsertionScope {
  actorId: string; projectId: string; assertCurrent: () => void;
  isCurrentWritable: () => boolean; fetcher: typeof fetch;
}
interface ActualWorkspace {
  captureSketchScope: () => SketchScope;
  captureCanvasInsertionScope: (signal?: AbortSignal) => InsertionScope;
  insertSketchResult: SketchInsert;
}

function actualWorkspaceCallbacks(bindings: Record<string, unknown>): ActualWorkspace {
  const filename = resolve(ROOT, 'src/components/canvas-workspace.tsx');
  const file = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const workspace = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'CanvasWorkspace');
  if (!workspace?.body) throw new Error('Actual CanvasWorkspace declaration missing');
  const closure = (name: string): string => {
    const declarations = workspace.body!.statements.flatMap(statement => ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.filter(node => ts.isIdentifier(node.name) && node.name.text === name) : []);
    if (declarations.length !== 1) throw new Error(`Expected one actual ${name} closure`);
    const initializer = declarations[0].initializer;
    if (!initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)
      || initializer.expression.text !== 'useCallback' || !initializer.arguments[0]
      || !ts.isArrowFunction(initializer.arguments[0])) throw new Error(`Unexpected actual ${name} callback`);
    return `const ${name} = (${initializer.arguments[0].getText(file)});`;
  };
  const displaySize = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'getCanvasImageDisplaySize');
  if (!displaySize) throw new Error('Actual display-size helper missing');
  const declarations = [displaySize.getText(file), ...[
    'autoLayoutImages', 'captureCanvasInsertionScope', 'captureSketchScope',
    'handleAddImages', 'insertSketchResult',
  ].map(closure)].join('\n');
  const compiled = ts.transpileModule(`${declarations}\nreturn { captureSketchScope, captureCanvasInsertionScope, insertSketchResult };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as ActualWorkspace;
}

function completedImageTask(): SketchImageTask {
  return {
    taskId: 'skimg_canvas-regression', projectId: PROJECT,
    visionProviderId: 'vision-provider', visionModelId: '视觉分析·模型 1',
    imageProviderId: 'image-provider', imageModelId: '参考图生成·模型 1',
    status: 'completed', progress: 100, reserveCredits: 5, actualCredits: 3,
    pricing: { version: 1,
      vision: { providerId: 'vision-provider', modelId: '视觉分析·模型 1', calls: 1, mode: 'flat', reserveCredits: 2 },
      image: { providerId: 'image-provider', modelId: '参考图生成·模型 1', calls: 1, credits: 3 }, totalReserveCredits: 5 },
    previewAssetId: 'sketch-input-asset', previewAssetVersionId: 'sketch-input-version',
    imageAssetId: 'generated-image-asset', imageAssetVersionId: 'generated-image-version',
    previewUrl: '/api/serve-upload/original-sketch.png', imageUrl: '/api/serve-upload/generated-sketch-image.png',
    analysis: { summary: 'summary', composition: 'composition', prompt: 'prompt', negativePrompt: '' },
  };
}

/** Exact agreed wire contract, intentionally no volatile createdAt.
 * The cast below represents a wire value at the existing reference API.
 * The real parser must subsequently accept the valid trace and reject bad ones. */
function imageTrace(task: SketchImageTask = completedImageTask()): Readonly<Record<string, string>> {
  if (!task.previewAssetVersionId || !task.imageAssetVersionId) throw new Error('Incomplete test task');
  return Object.freeze({ source: 'sketch-to-image', taskId: task.taskId, projectId: task.projectId,
    previewAssetVersionId: task.previewAssetVersionId, imageAssetVersionId: task.imageAssetVersionId,
    visionProviderId: task.visionProviderId, visionModelId: task.visionModelId,
    imageProviderId: task.imageProviderId, imageModelId: task.imageModelId });
}
function imageReference(trace: unknown = imageTrace(), patch: Partial<WorkspaceAssetReference> = {}): WorkspaceAssetReference {
  const task = completedImageTask();
  return { kind: 'image', url: task.imageUrl!, assetId: task.imageAssetId!, assetVersionId: task.imageAssetVersionId!,
    entityId: 'generated-canvas-entity', placementId: 'generated-placement',
    ...(trace === undefined ? {} : { sourceTrace: trace }), ...patch } as WorkspaceAssetReference;
}
function htmlTrace(): SketchWorkspaceSourceTrace {
  return { source: 'sketch-to-code', taskId: 'html-task', projectId: PROJECT,
    previewAssetVersionId: 'sketch-input-version', htmlAssetVersionId: 'html-version', createdAt: '2026-10-13T00:00:00.000Z' };
}
function htmlReference(trace: unknown = htmlTrace(), patch: Partial<WorkspaceAssetReference> = {}): WorkspaceAssetReference {
  return imageReference(trace, { url: completedImageTask().previewUrl!, assetId: 'sketch-input-asset',
    assetVersionId: 'sketch-input-version', entityId: 'html-sketch-entity', placementId: 'html-sketch-placement', ...patch });
}

function canvasHarness() {
  const original: CanvasImage = Object.freeze({ id: 'original-sketch-entity', url: completedImageTask().previewUrl!,
    assetId: 'sketch-input-asset', assetVersionId: 'sketch-input-version', placementId: 'original-sketch-placement',
    x: 25, y: 40, width: 320, height: 240, rotation: 0, prompt: 'original keywords', zIndex: 1 });
  const refs = {
    latestImagesRef: { current: [original] } as Cell<CanvasImage[]>,
    currentUserRef: { current: { id: ACTOR } }, currentProjectRef: { current: { id: PROJECT } },
    historyProjectIdRef: { current: PROJECT }, historyTransitionEpochRef: { current: 1 },
    isMountedRef: { current: true }, historyLifecyclePendingRef: { current: false },
    collaborativeCanvasRef: { current: {
      projectId: PROJECT, authority: 'legacy' as SketchScope['authority'],
      recordMediaHistory: (): void => {}, refreshMedia: async (): Promise<void> => {},
      isSessionActive: (): boolean => true, isWritable: (): boolean => true,
    } },
  };
  const environment = { recoveryPending: false, acceptsImages: true };
  const setImages = vi.fn((next: CanvasImage[]): boolean => {
    if (!environment.acceptsImages) return false;
    refs.latestImagesRef.current = next; return true;
  });
  const loadCanvasImageSize = vi.fn(async (url: string): Promise<{ width: number; height: number }> => { void url; return { width: 1024, height: 768 }; });
  const persistCanvasImagesNow = vi.fn((images: CanvasImage[]): void => { void images; });
  const flushProjectsToServer = vi.fn(async (): Promise<void> => {});
  const recordUserData = vi.fn((record: unknown): void => { void record; });
  const stabilizeCanvasImages = vi.fn((images: unknown, isCurrent: () => boolean): void => { void images; void isCurrent; });
  const setCanvasConnections = vi.fn((change: unknown): void => { void change; });
  const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
  const unexpectedFetch = vi.fn<typeof fetch>(async (): Promise<Response> => { throw new Error('Unexpected network/save-image fallback'); });
  const callbacks = actualWorkspaceCallbacks({ ...refs,
    sketchContextKey: 'canvas-scope-key', isDocumentHistoryRecoveryPending: (): boolean => environment.recoveryPending,
    loadCanvasImageSize, setImages, persistCanvasImagesNow, stabilizeCanvasImages, setCanvasConnections,
    UserManagerCore: { getInstance: (): { flushProjectsToServer: typeof flushProjectsToServer } => ({ flushProjectsToServer }) },
    recordUserData, toast, fetch: unexpectedFetch, document: { querySelector: (): null => null },
    canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions, createAutoConnection, parseWorkspaceSourceTrace, validSketchId,
  });
  return { original, refs, environment, callbacks, scope: callbacks.captureSketchScope(), loadCanvasImageSize,
    setImages, persistCanvasImagesNow, flushProjectsToServer, recordUserData, stabilizeCanvasImages,
    setCanvasConnections, toast, unexpectedFetch };
}
type CanvasHarness = ReturnType<typeof canvasHarness>;
type Stage = 'poll' | 'asset' | 'transfer' | 'readback';
interface Call { url: string; init: RequestInit; stage: Stage; body?: Record<string, unknown> }
interface TransportOptions {
  echoTrace?: boolean;
  reply?: (stage: Stage, value: Record<string, unknown>, call: Call) => Record<string, unknown> | Promise<Record<string, unknown>>;
}
const placements: Array<SketchImagePlacement | SketchPlacement> = [];

function imagePlacementFixture(h: CanvasHarness = canvasHarness(), options: TransportOptions = {}) {
  const task = completedImageTask(), trace = imageTrace(task), calls: Call[] = [];
  let entityId: unknown;
  const fetcher: typeof fetch = async (url, init): Promise<Response> => {
    const target = String(url), request = init ?? {};
    const body = request.body ? JSON.parse(String(request.body)) as Record<string, unknown> : undefined;
    const query = `/api/assets?projectId=${PROJECT}&assetVersionId=${task.imageAssetVersionId!}`;
    const stage: Stage = target === '/api/poll-task' ? 'poll' : target === query ? 'asset'
      : target === '/api/assets/transfer' ? 'transfer' : target === `${query}&placementId=generated-placement` ? 'readback'
      : (() => { throw new Error(`Unexpected fixture endpoint: ${target}`); })();
    const call: Call = { url: target, init: request, stage, ...(body ? { body } : {}) }; calls.push(call);
    // Assert the real gate's request contract at the transport seam, never make
    // transport authorize a malformed target reference or fake the local sink.
    expect(new Headers(request.headers).get('x-wujie-expected-actor-id')).toBe(ACTOR);
    expect(request.credentials).toBe('same-origin'); expect(request.cache).toBe('no-store'); expect(request.redirect).toBe('error');
    expect(request.method).toBe(stage === 'poll' || stage === 'transfer' ? 'POST' : 'GET');
    if (stage === 'poll') expect(body).toEqual({ taskId: task.taskId, projectId: PROJECT });
    if (stage === 'transfer') entityId = body?.entityId;
    const placed = stage === 'transfer' || stage === 'readback';
    const raw: Record<string, unknown> = stage === 'poll' ? { success: true, type: 'sketch-to-image', ...task }
      : { assetId: task.imageAssetId!, assetVersionId: task.imageAssetVersionId!, kind: 'image', url: task.imageUrl!,
        ...(placed ? { entityId, placementId: 'generated-placement' } : {}),
        ...(stage === 'transfer' ? { placementStatus: 'active', reused: false } : {}),
        ...(placed && options.echoTrace !== false ? { sourceTrace: trace } : {}) };
    const value = options.reply ? await options.reply(stage, raw, call) : raw;
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  const placement = new SketchImagePlacement(task, h.scope, h.callbacks.insertSketchResult, fetcher, transform);
  placements.push(placement);
  return { h, task, trace, calls, placement };
}

function expectNoLocalInsertion(h: CanvasHarness): void {
  expect(h.refs.latestImagesRef.current).toEqual([h.original]);
  expect(h.refs.latestImagesRef.current[0]).toBe(h.original);
  expect(h.setImages).not.toHaveBeenCalled(); expect(h.persistCanvasImagesNow).not.toHaveBeenCalled();
  expect(h.flushProjectsToServer).not.toHaveBeenCalled(); expect(h.recordUserData).not.toHaveBeenCalled();
  expect(h.toast.success).not.toHaveBeenCalled(); expect(h.unexpectedFetch).not.toHaveBeenCalled();
}
function expectOneGeneratedImage(h: CanvasHarness, entityId: string, trace: unknown): void {
  const images = h.refs.latestImagesRef.current;
  expect(images).toHaveLength(2); expect(images[0]).toBe(h.original);
  expect(images[0]).toMatchObject({ url: completedImageTask().previewUrl, prompt: 'original keywords', x: 25, y: 40 });
  expect(images[1]).toMatchObject({ id: entityId, url: completedImageTask().imageUrl,
    assetId: 'generated-image-asset', assetVersionId: 'generated-image-version', placementId: 'generated-placement',
    originalWidth: 1024, originalHeight: 768, ...transform });
  expect(images[1].id).not.toBe(h.original.id); expect(images[1].assetVersionId).not.toBe(h.original.assetVersionId);
  expect(images[1].sourceTrace).toEqual(trace); expect(parseWorkspaceSourceTrace(images[1].sourceTrace)).toEqual(trace);
  expect(images[1].sourceTrace).not.toHaveProperty('createdAt'); expect(images[1].sourceTrace).not.toHaveProperty('htmlAssetVersionId');
  expect(h.loadCanvasImageSize).toHaveBeenCalledTimes(1); expect(h.loadCanvasImageSize).toHaveBeenCalledWith(completedImageTask().imageUrl);
  expect(h.setImages).toHaveBeenCalledTimes(1); expect(h.persistCanvasImagesNow).toHaveBeenCalledWith(images);
  expect(h.flushProjectsToServer).toHaveBeenCalledTimes(1); expect(h.recordUserData).toHaveBeenCalledTimes(1);
  expect(h.toast.success).toHaveBeenCalledTimes(1); expect(h.stabilizeCanvasImages).not.toHaveBeenCalled();
  expect(h.setCanvasConnections).not.toHaveBeenCalled(); expect(h.unexpectedFetch).not.toHaveBeenCalled();
  const record = h.recordUserData.mock.calls[0][0] as { userId: string; content: string };
  expect(record.userId).toBe(ACTOR); expect(JSON.parse(record.content)).toEqual([images[1]]);
}

afterEach((): void => { placements.forEach(placement => placement.stop()); placements.length = 0; vi.restoreAllMocks(); });

describe('real generated-image placement -> insertSketchResult -> handleAddImages', () => {
  it('adds exactly one protected fresh generated image with independent provenance and leaves the input intact', async (): Promise<void> => {
    const f = imagePlacementFixture();
    await expect(f.placement.add()).resolves.toBeUndefined();
    expect(f.calls.map(call => call.stage)).toEqual(['poll', 'asset', 'transfer', 'readback']);
    expect(f.calls[2].body).toMatchObject({ sourceVersion: f.task.imageAssetVersionId, targetProject: PROJECT,
      targetWorkspace: `canvas:${PROJECT}`, entityType: 'canvas-image', entityId: f.placement.entityId, transform,
      metadata: { sourceTrace: f.trace, sketchImageTaskId: f.task.taskId } });
    expectOneGeneratedImage(f.h, f.placement.entityId, f.trace);
    await Promise.all([f.placement.add(), f.placement.add()]);
    expect(f.calls.filter(call => call.stage === 'transfer')).toHaveLength(1);
    expect(f.h.setImages).toHaveBeenCalledTimes(1);
  });

  it('the actual host accepts an independently valid image trace without pretending it is HTML provenance', async (): Promise<void> => {
    const h = canvasHarness(), reference = imageReference();
    await expect(h.callbacks.insertSketchResult(reference, transform)).resolves.toBeUndefined();
    expectOneGeneratedImage(h, reference.entityId!, imageTrace());
  });

  it('derives deterministic provenance even when valid legacy asset receipts omit the optional trace echo', async (): Promise<void> => {
    const f = imagePlacementFixture(undefined, { echoTrace: false });
    await expect(f.placement.add()).resolves.toBeUndefined();
    expectOneGeneratedImage(f.h, f.placement.entityId, f.trace);
    expect((f.calls[2].body?.metadata as Record<string, unknown>).sourceTrace).toEqual(f.trace);
  });

  it('unknown transfer retries preserve the original nonce, entity, transform and exact semantic trace', async (): Promise<void> => {
    let lost = false;
    const f = imagePlacementFixture(undefined, { reply: (stage, value): Record<string, unknown> => {
      if (stage === 'transfer' && !lost) { lost = true; throw new Error('unknown transfer acknowledgement'); }
      return stage === 'transfer' ? { ...value, reused: true } : value;
    } });
    await expect(f.placement.add()).rejects.toThrow(); expectNoLocalInsertion(f.h);
    await expect(f.placement.add()).resolves.toBeUndefined();
    const transfers = f.calls.filter(call => call.stage === 'transfer');
    expect(transfers).toHaveLength(2); expect(transfers[1].init.body).toBe(transfers[0].init.body);
    expect((transfers[0].body?.metadata as Record<string, unknown>).sourceTrace).toEqual(f.trace);
    expectOneGeneratedImage(f.h, f.placement.entityId, f.trace);
  });

  const badEchoes: Array<{ name: string; trace: unknown }> = [
    { name: 'different task', trace: { ...imageTrace(), taskId: 'other-task' } },
    { name: 'foreign project', trace: { ...imageTrace(), projectId: 'foreign-project' } },
    { name: 'wrong original sketch version', trace: { ...imageTrace(), previewAssetVersionId: 'other-input-version' } },
    { name: 'wrong generated version', trace: { ...imageTrace(), imageAssetVersionId: 'other-output-version' } },
    { name: 'changed image model', trace: { ...imageTrace(), imageModelId: 'different-model' } },
    { name: 'HTML provenance masquerade', trace: htmlTrace() },
    { name: 'malformed trace', trace: { source: 'sketch-to-image' } },
  ];
  for (const stage of ['transfer', 'readback'] as const) {
    it.each(badEchoes)(`rejects present conflicting ${stage} provenance: $name`, async ({ trace }): Promise<void> => {
      const f = imagePlacementFixture(undefined, { reply: (actual, value): Record<string, unknown> =>
        actual === stage ? { ...value, sourceTrace: trace } : value });
      await expect(f.placement.add()).rejects.toThrow(); expectNoLocalInsertion(f.h);
      expect(f.h.loadCanvasImageSize).not.toHaveBeenCalled();
      expect(f.calls.map(call => call.stage)).toEqual(stage === 'transfer'
        ? ['poll', 'asset', 'transfer'] : ['poll', 'asset', 'transfer', 'readback']);
    });
  }

  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)(
    'completed fresh task with %s still blocks transfer and insertion', async (flag): Promise<void> => {
      const f = imagePlacementFixture(undefined, { reply: (stage, value): Record<string, unknown> =>
        stage === 'poll' ? { ...value, [flag]: true } : value });
      await expect(f.placement.add()).rejects.toThrow(); expect(f.calls.map(call => call.stage)).toEqual(['poll']);
      expectNoLocalInsertion(f.h);
    });

  it.each([
    { name: 'actual charge', patch: { actualCredits: 99 } },
    { name: 'vision binding', patch: { visionProviderId: 'other-vision' } },
    { name: 'output identity', patch: { imageAssetVersionId: 'other-output-version' } },
    { name: 'cancelled task with late result', patch: { status: 'cancelled' } },
  ])('fresh protected $name changes cannot become local insertion authority', async ({ patch }): Promise<void> => {
    const f = imagePlacementFixture(undefined, { reply: (stage, value): Record<string, unknown> => stage === 'poll' ? { ...value, ...patch } : value });
    await expect(f.placement.add()).rejects.toThrow(); expect(f.calls.map(call => call.stage)).toEqual(['poll']);
    expectNoLocalInsertion(f.h);
  });

  it('stopping an outstanding transfer prevents late readback and the real sink', async (): Promise<void> => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolveWaiting => { release = resolveWaiting; });
    const started = new Promise<void>(resolveStarted => { entered = resolveStarted; });
    const f = imagePlacementFixture(undefined, { reply: async (stage, value): Promise<Record<string, unknown>> => {
      if (stage === 'transfer') { entered(); await waiting; } return value;
    } });
    const pending = f.placement.add(), rejection = expect(pending).rejects.toThrow();
    try { await started; f.placement.stop(); release(); await rejection; }
    finally { release(); }
    expect(f.calls.map(call => call.stage)).toEqual(['poll', 'asset', 'transfer']); expectNoLocalInsertion(f.h);
  });

  it('once the local sink starts, a failed persistence acknowledgement cannot retry that insertion', async (): Promise<void> => {
    const h = canvasHarness(); h.flushProjectsToServer.mockRejectedValueOnce(new Error('persistence acknowledgement lost'));
    const f = imagePlacementFixture(h);
    await expect(f.placement.add()).rejects.toThrow();
    expect(h.flushProjectsToServer).toHaveBeenCalledTimes(1);
    expect(h.refs.latestImagesRef.current).toEqual([h.original]); expect(h.refs.latestImagesRef.current[0]).toBe(h.original);
    const requestCount = f.calls.length, mutationCount = h.setImages.mock.calls.length;
    await expect(f.placement.add()).rejects.toThrow();
    expect(f.calls).toHaveLength(requestCount); expect(h.setImages).toHaveBeenCalledTimes(mutationCount);
    expect(h.toast.success).not.toHaveBeenCalled(); expect(h.recordUserData).not.toHaveBeenCalled();
  });
});

describe('actual sketchTransform host admission and preserved HTML insertion', () => {
  // Explicit undefined is represented with a missing sourceTrace property rather
  // than falling through the fixture helper's valid default parameter.
  const invalidTraces: Array<{ name: string; trace: unknown; html?: boolean }> = [
    { name: 'missing provenance', trace: null },
    { name: 'malformed image provenance', trace: { source: 'sketch-to-image' } },
    { name: 'image from foreign project', trace: { ...imageTrace(), projectId: 'foreign-project' } },
    { name: 'wrong image version', trace: { ...imageTrace(), imageAssetVersionId: 'other-output-version' } },
    { name: 'empty image task identifier', trace: { ...imageTrace(), taskId: '' } },
    { name: 'unbounded image model label', trace: { ...imageTrace(), imageModelId: 'x'.repeat(257) } },
    { name: 'foreign chat provenance', trace: { source: 'simple-chat', chatProjectId: PROJECT,
      chatTaskId: 'chat-task', messageId: 'message', createdAt: '2026-10-13T00:00:00.000Z' } },
    { name: 'malformed HTML provenance', html: true, trace: { source: 'sketch-to-code' } },
    { name: 'HTML from foreign project', html: true, trace: { ...htmlTrace(), projectId: 'foreign-project' } },
    { name: 'wrong HTML preview version', html: true, trace: { ...htmlTrace(), previewAssetVersionId: 'other-input-version' } },
  ];
  it.each(invalidTraces)('rejects $name before decoding or local state mutation', async ({ trace, html }): Promise<void> => {
    const h = canvasHarness();
    const reference = html ? htmlReference(trace) : imageReference(trace);
    if (trace === null) delete reference.sourceTrace;
    await expect(h.callbacks.insertSketchResult(reference, transform)).rejects.toThrow();
    expect(h.loadCanvasImageSize).not.toHaveBeenCalled(); expectNoLocalInsertion(h);
  });

  it('old HTML placement still inserts its original PNG with its original paired HTML provenance', async (): Promise<void> => {
    const h = canvasHarness(), task: SketchTask = { taskId: 'html-task', projectId: PROJECT,
      providerId: 'html-provider', modelId: 'html-model', status: 'completed', progress: 100, reserveCredits: 4,
      previewAssetId: 'sketch-input-asset', previewAssetVersionId: 'sketch-input-version',
      htmlAssetId: 'html-asset', htmlAssetVersionId: 'html-version' };
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let transfer: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (url, init): Promise<Response> => {
      const target = String(url), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ url: target, ...(body ? { body } : {}) });
      if (target === '/api/assets/transfer') transfer = body;
      const query = `/api/assets?projectId=${PROJECT}&assetVersionId=sketch-input-version`;
      if (target !== query && target !== '/api/assets/transfer' && target !== `${query}&placementId=html-sketch-placement`) {
        throw new Error(`Unexpected HTML endpoint: ${target}`);
      }
      const placed = target === '/api/assets/transfer' || target.includes('placementId=');
      const raw = { kind: 'image', url: h.original.url,
        assetId: task.previewAssetId, assetVersionId: task.previewAssetVersionId,
        ...(placed ? { placementId: 'html-sketch-placement', entityId: transfer?.entityId,
          sourceTrace: (transfer?.metadata as Record<string, unknown> | undefined)?.sourceTrace } : {}),
        ...(target === '/api/assets/transfer' ? { placementStatus: 'active', reused: false } : {}) };
      return new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } });
    };
    const placement = new SketchPlacement(task, h.scope, h.callbacks.insertSketchResult, fetcher, transform); placements.push(placement);
    await expect(placement.add()).resolves.toBeUndefined();
    expect(h.refs.latestImagesRef.current).toHaveLength(2); expect(h.refs.latestImagesRef.current[0]).toBe(h.original);
    expect(h.refs.latestImagesRef.current[1]).toMatchObject({ id: placement.entityId, url: h.original.url,
      assetVersionId: 'sketch-input-version', placementId: 'html-sketch-placement', sourceTrace: placement.trace, ...transform });
    expect(parseWorkspaceSourceTrace(h.refs.latestImagesRef.current[1].sourceTrace)).toEqual(placement.trace);
    expect(placement.trace).toHaveProperty('createdAt'); expect(placement.trace).not.toHaveProperty('imageAssetVersionId');
    expect(calls[1].body).toMatchObject({ sourceVersion: 'sketch-input-version', metadata: { sourceTrace: placement.trace } });
    await placement.add(); expect(calls).toHaveLength(3); expect(h.setImages).toHaveBeenCalledTimes(1);
  });

  it('actual entity and placement dedupe both suppress repeated valid HTML receipts', async (): Promise<void> => {
    const h = canvasHarness(), first = htmlReference();
    await h.callbacks.insertSketchResult(first, transform);
    await h.callbacks.insertSketchResult(first, transform);
    await h.callbacks.insertSketchResult(htmlReference(htmlTrace(), { entityId: 'different-entity-same-placement' }), transform);
    expect(h.refs.latestImagesRef.current).toHaveLength(2); expect(h.refs.latestImagesRef.current[0]).toBe(h.original);
    expect(h.refs.latestImagesRef.current[1].id).toBe(first.entityId);
    expect(h.setImages).toHaveBeenCalledTimes(1); expect(h.flushProjectsToServer).toHaveBeenCalledTimes(1);
    expect(h.toast.info).toHaveBeenCalledTimes(2);
  });

  it.each(['document', 'unknown'] as const)('actual %s authority cannot admit a sketch image', async (authority): Promise<void> => {
    const h = canvasHarness(); h.refs.collaborativeCanvasRef.current.authority = authority;
    await expect(h.callbacks.insertSketchResult(htmlReference(), transform)).rejects.toThrow();
    expect(h.loadCanvasImageSize).not.toHaveBeenCalled(); expectNoLocalInsertion(h);
  });

  it.each(['actor', 'project', 'epoch', 'history', 'recovery'] as const)(
    'actual captured scope rejects %s invalidation while decoding, before insertion', async (change): Promise<void> => {
      const h = canvasHarness();
      h.loadCanvasImageSize.mockImplementationOnce(async (): Promise<{ width: number; height: number }> => {
        if (change === 'actor') h.refs.currentUserRef.current.id = 'other-actor';
        if (change === 'project') h.refs.currentProjectRef.current.id = 'other-project';
        if (change === 'epoch') h.refs.historyTransitionEpochRef.current++;
        if (change === 'history') h.refs.historyLifecyclePendingRef.current = true;
        if (change === 'recovery') h.environment.recoveryPending = true;
        return { width: 1024, height: 768 };
      });
      await expect(h.callbacks.insertSketchResult(htmlReference(), transform)).rejects.toThrow(); expectNoLocalInsertion(h);
    });

  it('real insertion rebases on the latest canvas after decoding instead of replacing an intervening image', async (): Promise<void> => {
    const h = canvasHarness(), intervening: CanvasImage = { id: 'intervening', url: '/api/serve-upload/intervening.png',
      x: 9, y: 10, width: 100, height: 100 };
    h.loadCanvasImageSize.mockImplementationOnce(async (): Promise<{ width: number; height: number }> => {
      h.refs.latestImagesRef.current = [...h.refs.latestImagesRef.current, intervening]; return { width: 1024, height: 768 };
    });
    await h.callbacks.insertSketchResult(htmlReference(), transform);
    expect(h.refs.latestImagesRef.current).toHaveLength(3); expect(h.refs.latestImagesRef.current[0]).toBe(h.original);
    expect(h.refs.latestImagesRef.current[1]).toBe(intervening);
    expect(h.refs.latestImagesRef.current[2]).toMatchObject({ id: 'html-sketch-entity', ...transform });
  });

  it('rejected canvas acceptance cannot persist, record or announce a successful insertion', async (): Promise<void> => {
    const h = canvasHarness(); h.environment.acceptsImages = false;
    await expect(h.callbacks.insertSketchResult(htmlReference(), transform)).rejects.toThrow();
    expect(h.setImages).toHaveBeenCalledTimes(1); expect(h.refs.latestImagesRef.current).toEqual([h.original]);
    expect(h.persistCanvasImagesNow).not.toHaveBeenCalled(); expect(h.flushProjectsToServer).not.toHaveBeenCalled();
    expect(h.recordUserData).not.toHaveBeenCalled(); expect(h.toast.success).not.toHaveBeenCalled();
  });
});
