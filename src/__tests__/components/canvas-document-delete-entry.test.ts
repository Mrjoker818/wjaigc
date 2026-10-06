import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasImage } from '@/components/infinite-canvas';
import { DocumentStatus } from '@/components/collaboration/document-status';
import { shouldToggleCanvasCommandPalette } from '@/components/canvas/CanvasCommandPalette';
import { serializeAnnotations } from '@/features/annotations/annotation-persistence';
import type { CanvasAnnotationV2 } from '@/features/annotations/annotation-types';
import { canUseLegacyCanvasPersistence, routeCanvasWorkspaceChange } from '@/lib/collaboration/canvas-document-image-bridge';
import {
  reconcileImageBatchDeletion, reconcileSelectedImageAfterBatchDeletion,
} from '@/lib/asset-core/batch-placement-delete';
import { canvasSnapshotToNodes, createCanvasDocumentSnapshot, executeCanvasCommand, isCanvasTaskProjectionChange } from '@/lib/canvas-kernel/commands';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import { isCanvasHistoryTransitionCurrent, type CanvasHistoryTransitionToken } from '@/lib/canvas-kernel/history';
import { parseDocumentMediaDirectory } from '@/lib/collaboration/document-media-sync';
import { applyCanvasAssetCommand, captureDocumentPlacementRemovalSnapshot, parseDocumentAssetCommandRequest, type CanvasAssetCommand, type DocumentAssetCommandResult } from '@/lib/collaboration/canvas-asset-command';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { createCanvasDocumentSession } from '@/lib/collaboration/document-client';
import { runDocumentHistoryCommand, readDocumentHistoryCommandJournal, runDocumentHistoryRestoration, confirmDocumentHistoryRestorationMetadata, recoverDocumentHistoryCommands, documentHistoryCommandStorageKey } from '@/lib/collaboration/document-history-command';

const cleanups: Array<() => void> = [];
function storage(): Storage {
  const values = new Map<string, string>();
  return { get length(): number { return values.size; }, key: (index: number): string | null => [...values.keys()][index] ?? null,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); }, clear: (): void => { values.clear(); } };
}
function locks(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  return { request: <T>(name: string, callback: (lock: Lock) => T | Promise<T>): Promise<T> => {
    const next = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
    tails.set(name, next.catch(() => undefined)); return next;
  }, query: async () => ({ held: [], pending: [] }) } as LockManager;
}
class Socket {
  readyState = 1;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  frames: Uint8Array[] = [];
  onSend: () => void = (): void => {};
  send(data: Uint8Array): void { this.frames.push(data); this.onSend(); }
  close(): void { this.readyState = 3; }
  receive(doc: Y.Doc, sequence: number): void {
    const update = Y.encodeStateAsUpdate(doc), bytes = new Uint8Array(9 + update.length);
    bytes[0] = 0x11; new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence)); bytes.set(update, 9);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
  acknowledge(sequence: number): void {
    const bytes = new Uint8Array(9); bytes[0] = 0x12; new DataView(bytes.buffer).setBigUint64(1, BigInt(sequence));
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}

// Execute the callback passed to InfiniteCanvas, not a copy of its branch logic.
// React state and HTTP are controlled boundaries; deletion reconciliation and
// the legacy canvas command are the real production implementations.
function productionCallback<T>(name: string, bindings: Record<string, unknown>, absent?: T,
  relativeFile = 'src/components/canvas-workspace.tsx'): T {
  const file = resolve(relativeFile);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      if (ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
      else if (ts.isArrowFunction(node.initializer)) expression = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) {
    if (absent !== undefined) return absent;
    throw new Error(`Actual canvas callback not found: ${name}`);
  }
  const js = ts.transpileModule(`const callback = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return callback;`)(...Object.values(bindings)) as T;
}
function productionRecoveryStartup(bindings: Record<string, unknown>): () => void {
  const file = resolve(process.cwd(), 'src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
        && node.arguments[0]?.getText(source).includes('handleRecoverDocumentHistoryCommands')) expression = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Baseline has no startup consumer. Execute that absence, so RED asserts on
  // unchanged server metadata rather than a missing export or parse error.
  if (!expression) return (): void => {};
  const js = ts.transpileModule(`const startup = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return startup;`)(...Object.values(bindings)) as () => void;
}
function productionRecoveryButton(bindings: Record<string, unknown>): React.ReactElement<{
  disabled: boolean; onClick: () => void;
}> | null {
  const file = resolve(process.cwd(), 'src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && node.expression.getText(source).includes('documentHistoryRecoveryState')
        && node.expression.getText(source).includes('handleRecoverDocumentHistoryCommands')) expression = node.expression;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) return null;
  const js = ts.transpileModule(`const button = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function('React', ...Object.keys(bindings), `${js}; return button || null;`)(React, ...Object.values(bindings)) as ReturnType<typeof productionRecoveryButton>;
}

function productionStatus(bindings: Record<string, unknown>): string {
  const file = resolve(process.cwd(), 'src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'DocumentStatus') expression = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error('Actual document status not found');
  const js = ts.transpileModule(`const view = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  const element = new Function('React', 'DocumentStatus', ...Object.keys(bindings), `${js}; return view;`)(
    React, DocumentStatus, ...Object.values(bindings)) as React.ReactElement;
  return renderToStaticMarkup(element);
}

function productionDeleteProps(bindings: Record<string, unknown>): {
  isHistoryTransitionPending: boolean; onDeleteImages: (ids: string[]) => Promise<string[]>;
  canRetryPendingDelete?: (ids: readonly string[]) => boolean;
} {
  const file = resolve('src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'InfiniteCanvas') {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && ['isHistoryTransitionPending', 'onDeleteImages', 'canRetryPendingDelete'].includes(attribute.name.getText(source))
            && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
          props.push(`${attribute.name.getText(source)}: ${attribute.initializer.expression.getText(source)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const js = ts.transpileModule(`const props = {${props.join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return props;`)(...Object.values(bindings)) as ReturnType<typeof productionDeleteProps>;
}

// Real JSX wiring -> actual canvas key handler -> actual requestDeleteImages ->
// workspace callback -> real journal/session; only DOM focus/overlay is controlled.
async function canvasDeleteKey(f: ReturnType<typeof fixture>, selectedIds: string[], code = 'Delete',
  options: { inputFocused?: boolean; overlay?: boolean } = {}): Promise<void> {
  const props = productionDeleteProps({ historyTransitionPending: f.pending.current,
    handleDeleteCanvasImages: f.remove, canRetryPendingDocumentDelete: f.canRetryDelete });
  const bindings = { ...props, pendingDeleteIdsRef: { current: new Set<string>() },
    imagesRef: f.images, selectedImage: f.selected(), editImageId: null,
    setSelectedIds: (): void => {}, selectImage: (): void => {}, setEditImageId: (): void => {}, setEditMode: (): void => {},
    toast: { error: (message: string): void => { f.errors.push(message); } } };
  const request = productionCallback<(ids: string[]) => Promise<unknown>>('requestDeleteImages', bindings, undefined, 'src/components/infinite-canvas.tsx');
  let requested: Promise<unknown> | undefined;
  const key = productionCallback<(event: KeyboardEvent) => void>('handleKeyDown', {
    ...bindings, selectedIds: new Set(selectedIds), editMode: 'none', shouldToggleCanvasCommandPalette,
    isInputFocused: (): boolean => !!options.inputFocused, isTextEditingTarget: (): boolean => !!options.inputFocused,
    isKeyboardEventFromOverlay: (): boolean => !!options.overlay,
    requestDeleteImages: (ids: string[]): Promise<unknown> => { requested = request(ids); return requested; },
  }, undefined, 'src/components/infinite-canvas.tsx');
  key({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: (): void => {} } as KeyboardEvent);
  await requested;
}

type SetImages = (action: CanvasImage[] | ((previous: CanvasImage[]) => CanvasImage[]),
  options?: { history?: 'record' | 'skip'; source?: 'document' | 'hydration' }) => boolean;

const imageA: CanvasImage = { id: 'image-a', assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
  url: '/api/serve-upload/a.png', x: 200, y: 200, width: 512, height: 512, rotation: 0, zIndex: 1,
  originalWidth: 100, originalHeight: 100, createdAt: 1 };
const imageB: CanvasImage = { id: 'image-b', assetId: 'asset-b', assetVersionId: 'version-b', placementId: 'placement-b',
  url: '/api/serve-upload/b.png', x: 420, y: 200, width: 512, height: 512, rotation: 0, zIndex: 1,
  originalWidth: 100, originalHeight: 100, createdAt: 1 };

function fixture(options: {
  actorId?: string; authority?: 'legacy' | 'document' | 'unknown'; status?: string;
  historyPending?: boolean; httpStatus?: number; metadata?: boolean; video?: boolean; mediaDiscoveryLag?: boolean;
} = {}): {
  remove: (ids: string[]) => Promise<string[]>; undo: () => Promise<void>; redo: () => Promise<void>;
  requests: Array<{ url: string; init: RequestInit }>; images: { current: CanvasImage[] };
  selected: () => CanvasImage | null; errors: string[]; setImages: SetImages;
  refreshes: Array<{ projectId: string; documentSequence: number; commandsBeforeRefresh: number }>;
  server: Y.Doc; session: ReturnType<typeof createCanvasDocumentSession>; store: Storage;
  advanceScope: (scope: 'actor' | 'project' | 'generation') => void;
  loseNext: () => void; rejectNext: (predicate: (command: CanvasAssetCommand) => boolean) => void;
  holdAck: () => void; releaseAck: () => void; pending: { current: boolean };
  pauseNextReply: () => { started: Promise<void>; resume: () => void };
  reopen: () => void; recover: () => Promise<boolean>; startRecovery: () => Promise<void>;
  retryButton: () => ReturnType<typeof productionRecoveryButton>;
  statusView: () => string;
  canRetryDelete: (ids: readonly string[]) => boolean;
  changeAnnotations: (records: CanvasAnnotationV2[]) => boolean;
  interleaveMetadata: (point: 'catchup' | 'write', kind: 'conflict' | 'complete') => void;
  restorationFrames: () => number;
} {
  const images = { current: [{ ...imageA }, { ...imageB, ...(options.video ? {
    mediaType: 'video' as const, url: '', videoUrl: '/api/serve-upload/b.mp4',
  } : {}) }] };
  let selected: CanvasImage | null = images.current[0];
  const originals = new Map(images.current.map(image => [image.assetVersionId, image]));
  const requests: Array<{ url: string; init: RequestInit }> = [], errors: string[] = [];
  const refreshes: Array<{ projectId: string; documentSequence: number; commandsBeforeRefresh: number }> = [];
  const store = storage(), lockManager = locks();
  vi.stubGlobal('localStorage', store); vi.stubGlobal('navigator', { locks: lockManager });
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const server = createCanvasDocument(); let socket = new Socket();
  for (const image of images.current) applyCanvasImagePatch(server, {
    placementId: image.placementId!, assetVersionId: image.assetVersionId!, x: image.x, y: image.y,
    width: image.width, height: image.height, rotation: image.rotation ?? 0, zIndex: image.zIndex ?? 0,
  }, 'seed');
  if (options.metadata) {
    applyCanvasImagePatch(server, { placementId: 'placement-a', groupId: 'group-a', annotation: 'original note' }, 'seed');
    server.getMap('groupDefinitions').set('group-a', { id: 'group-a', name: 'original group', note: '',
      imageIds: ['placement-a', 'placement-b'], x: 0, y: 0, collapsed: false });
    server.getMap('annotationRecords').set('annotation-a', { id: 'annotation-a', projectId: 'project-p',
      sourceImageId: 'placement-a', sourceVersionId: 'version-a', type: 'region',
      geometry: { kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      label: 'original annotation', status: 'ready', createdAt: 10, updatedAt: 12 });
  }
  let sequence = 2, restored = 0, consumed = 0, held = false, lose = false;
  let rejectCommand: ((command: CanvasAssetCommand) => boolean) | undefined;
  let replyGate: { started: () => void; wait: Promise<void> } | undefined;
  const receipts = new Map<string, { body: string; receipt: DocumentAssetCommandResult }>();
  let session = createCanvasDocumentSession(socket as unknown as WebSocket);
  socket.receive(server, sequence);
  const publish = (): void => { socket.receive(server, sequence); };
  const commit = (): void => {
    if (held) return;
    for (; consumed < socket.frames.length; consumed++) {
      Y.applyUpdate(server, socket.frames[consumed].subarray(1)); socket.acknowledge(++sequence);
    }
    publish();
  };
  socket.onSend = (): void => { queueMicrotask(commit); };
  cleanups.push(() => { session.disconnect(); server.destroy(); });
  const directoryPayload = (): Record<string, unknown> => {
    const projection = readCanvasDocument(server);
    return { success: true, projectId: 'project-p', sequence, readOnly: false, projection,
      canvasImages: Object.entries(projection.placements).filter(([, placement]) => !placement.deleted)
        .map(([placementId, placement]) => {
          const original = originals.get(placement.assetVersionId)!;
          return { ...original, ...placement, placementId,
            id: placementId === original.placementId ? original.id : 'image-' + placementId };
        }) };
  };
  parseDocumentMediaDirectory(directoryPayload(), 'project-p');
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input); requests.push({ url, init });
    const status = options.httpStatus ?? 200;
    if (status !== 200) return Response.json({ success: false, code: 'FORBIDDEN' }, { status });
    if (url.startsWith('/api/assets/placements/')) return Response.json({ success: true });
    if (new Headers(init.headers).get('x-wujie-expected-actor-id') !== (options.actorId ?? 'owner-a')) {
      return Response.json({ success: false, code: 'ACTOR_CHANGED' }, { status: 409 });
    }
    if (url.startsWith('/api/collaboration/document-project?') && init.method === 'GET') return Response.json(directoryPayload());
    if (url !== '/api/collaboration/document-assets' || init.method !== 'POST') throw new Error('Unexpected HTTP boundary');
    const body = parseDocumentAssetCommandRequest(JSON.parse(String(init.body)));
    if (body.projectId !== 'project-p') throw new Error('Wrong command project');
    if (rejectCommand?.(body.command)) { rejectCommand = undefined; return Response.json({ success: false }, { status: 403 }); }
    let accepted = receipts.get(body.idempotencyKey);
    if (accepted && accepted.body !== JSON.stringify(body)) throw new Error('Replayed key changed command');
    if (!accepted) {
      const placementId = body.command.action === 'attach' ? 'restored-' + ++restored : body.command.placementId;
      const removeSnapshot = body.command.action === 'remove'
        ? captureDocumentPlacementRemovalSnapshot(readCanvasDocument(server), 'project-p', body.command) : undefined;
      applyCanvasAssetCommand(server, body.command, placementId);
      const receipt: DocumentAssetCommandResult = { placementId,
        assetVersionId: body.command.action === 'attach' ? body.command.assetVersionId : body.command.expectedAssetVersionId,
        documentSequence: ++sequence, ...(removeSnapshot ? { removeSnapshot } : {}) };
      accepted = { body: JSON.stringify(body), receipt }; receipts.set(body.idempotencyKey, accepted); publish();
    }
    if (lose) { lose = false; throw new Error('response lost after commit'); }
    if (replyGate) { const gate = replyGate; replyGate = undefined; gate.started(); await gate.wait; }
    return Response.json({ success: true, ...accepted.receipt });
  };
  vi.stubGlobal('fetch', fetcher);
  const document = { projectId: 'project-p', authority: options.authority ?? 'document',
    get status(): string {
      if (options.status) return options.status;
      // The real Hook marks the new canonical placement unavailable while its
      // media directory is being discovered; this is not a scope change.
      if (options.mediaDiscoveryLag && Object.entries(session.images).some(([placementId, placement]) =>
        !placement.deleted && !images.current.some(image => image.placementId === placementId))) return 'unavailable';
      return session.status;
    }, get images(): typeof session.images { return session.images; },
    recordMediaHistory: session.recordMediaHistory.bind(session), restorePlacementHistoryMetadata: session.restorePlacementHistoryMetadata.bind(session),
    rebindPlacementHistory: session.rebindPlacementHistory.bind(session), waitForPendingUpdates: session.waitForPendingUpdates.bind(session),
    undoLocal: session.undoLocal.bind(session), redoLocal: session.redoLocal.bind(session),
    applyLocalChange: (patch: Parameters<typeof session.applyLocalChange>[0]): void => session.applyLocalChange(patch),
    refreshMedia: async (input: { projectId: string; documentSequence: number }): Promise<CanvasImage[]> => {
      if (input.projectId !== 'project-p' || sequence < input.documentSequence
          || session.appliedServerSequence < input.documentSequence) throw new Error('Uncommitted or wrong-scope document refresh');
      const canonical = parseDocumentMediaDirectory(directoryPayload(), input.projectId);
      refreshes.push({ ...input, commandsBeforeRefresh: requests.filter(request => request.init.method === 'POST').length });
      setImages(canonical.canvasImages, { source: 'document', history: 'skip' }); return images.current;
    },
  };
  const pending = { current: options.historyPending ?? false }, authority = { current: document };
  let catchupInterleave: (() => void) | undefined, writeInterleave: (() => void) | undefined;
  const refreshMedia = document.refreshMedia;
  document.refreshMedia = async input => {
    const journal = readDocumentHistoryCommandJournal(store, { actorId: options.actorId ?? 'owner-a', projectId: 'project-p' });
    if (catchupInterleave && pending.current && journal?.items.some(item => item.restoration
        && item.state === 'confirmed' && item.receipt!.documentSequence <= input.documentSequence)) {
      const action = catchupInterleave; catchupInterleave = undefined; action();
    }
    return refreshMedia(input);
  };
  const sessionRestore = document.restorePlacementHistoryMetadata;
  document.restorePlacementHistoryMetadata = input => {
    if (writeInterleave) { const action = writeInterleave; writeInterleave = undefined; action(); }
    sessionRestore(input);
  };
  const actor = { current: { id: options.actorId ?? 'owner-a' } }, project = { current: 'project-p' };
  const currentProject = { current: { id: 'project-p' } }, epoch = { current: 0 };
  const active: { current: CanvasHistoryTransitionToken | null } = { current: null };
  const recovery = { current: null as null | { actorId: string; projectId: string; epoch: number;
    generation: typeof document.recordMediaHistory; state: 'running' | 'failed' | 'complete' } };
  let recoveryState: typeof recovery.current = null;
  const isRecoveryPending = productionCallback<() => boolean>('isDocumentHistoryRecoveryPending', {
    documentHistoryRecoveryRef: recovery, collaborativeCanvasRef: authority, currentUserRef: actor,
    currentProjectRef: currentProject, historyProjectIdRef: project, historyTransitionEpochRef: epoch,
  }, () => false);
  const isActive = productionCallback<(transition: CanvasHistoryTransitionToken) => boolean>('isActiveCanvasHistoryTransition', {
    activeHistoryTransitionRef: active, historyProjectIdRef: project, historyTransitionEpochRef: epoch, isCanvasHistoryTransitionCurrent,
  });
  const setImages = productionCallback<SetImages>('setImages', {
    isDocumentHistoryRecoveryPending: isRecoveryPending,
    historyLifecyclePendingRef: pending, latestImagesRef: images, prevImagesRef: { current: [] },
    queuedCanvasHistoryChangeRef: { current: null }, historyProjectIdRef: project, collaborativeCanvasRef: authority,
    routeCanvasWorkspaceChange, isCanvasTaskProjectionChange, incrementalHistoryRef: { current: new IncrementalHistoryManager<CanvasImage>(50) },
    setImagesRaw: (): void => {}, UserManagerCore: { getInstance: () => ({ recordDeletedImageIds: (): void => {} }) },
    toast: { error: (message: string): void => { errors.push(message); } },
  });
  const bindings = { historyLifecyclePendingRef: pending, historyProjectIdRef: project,
    historyTransitionEpochRef: epoch, activeHistoryTransitionRef: active,
    setHistoryTransitionPending: (): void => {}, isActiveCanvasHistoryTransition: isActive, flushQueuedCanvasHistoryChange: (): void => {},
    currentProject: { id: 'project-p' }, currentProjectRef: currentProject, currentUserRef: actor,
    collaborativeCanvasRef: authority, latestImagesRef: images, pendingCanvasDeleteIdsRef: { current: new Set<string>() },
    documentDeleteHistoryRef: { current: null }, documentHistoryRecoveryRef: recovery,
    isDocumentHistoryRecoveryPending: isRecoveryPending,
    setDocumentHistoryRecoveryState: (state: typeof recovery.current): void => { recoveryState = state; },
    documentHistoryCommandStorageKey, recoverDocumentHistoryCommands, runDocumentHistoryCommand, readDocumentHistoryCommandJournal,
    runDocumentHistoryRestoration, confirmDocumentHistoryRestorationMetadata,
    canUseLegacyCanvasPersistence, reconcileImageBatchDeletion, reconcileSelectedImageAfterBatchDeletion,
    canvasSnapshotToNodes, createCanvasDocumentSnapshot, executeCanvasCommand, setImages,
    setSelectedImage: (update: (current: CanvasImage | null) => CanvasImage | null): void => { selected = update(selected); },
    persistCanvasImagesNow: (): void => {}, UserManagerCore: { getInstance: () => ({ advanceProjectSyncRevision: (): void => {} }) },
    toast: { error: (message: string): void => { errors.push(message); } } };
  const suspend = productionCallback<(transition: CanvasHistoryTransitionToken, document: unknown,
    actorId: string | undefined, direction: 'undo' | 'redo', operation: () => void | Promise<void>) => void>(
    'suspendDocumentHistoryOperation', bindings, (): void => {});
  Object.assign(bindings, { suspendDocumentHistoryOperation: suspend });
  const canRetryDelete = productionCallback<(ids: readonly string[]) => boolean>('canRetryPendingDocumentDelete', bindings, () => false);
  Object.assign(bindings, { canRetryPendingDocumentDelete: canRetryDelete });
  const recover = productionCallback<() => Promise<boolean>>('handleRecoverDocumentHistoryCommands', bindings, async () => false);
  return { requests, images, selected: () => selected, errors, setImages, refreshes, server, get session() { return session; }, store, pending,
    recover, canRetryDelete,
    restorationFrames: () => socket.frames.length,
    interleaveMetadata: (point, kind): void => {
      const action = (): void => {
        applyCanvasImagePatch(server, { placementId: 'restored-1', annotation: kind === 'conflict' ? 'remote conflict' : 'original note',
          ...(kind === 'complete' ? { groupId: 'group-a' } : {}) }, 'remote');
        if (kind === 'complete') {
          const group = readCanvasDocument(server).groupDefinitions!['group-a'];
          server.getMap('groupDefinitions').set('group-a', { ...group, imageIds: [...group.imageIds, 'restored-1'] });
          const record = readCanvasDocument(server).annotationRecords!['annotation-a'];
          server.getMap('annotationRecords').set('annotation-reopened', { ...record, id: 'annotation-reopened', sourceImageId: 'restored-1' });
        }
        sequence++; publish();
      };
      if (point === 'catchup') catchupInterleave = action; else writeInterleave = action;
    },
    retryButton: () => productionRecoveryButton({ documentHistoryRecoveryState: recoveryState, currentUser: actor.current,
      currentProject: currentProject.current, historyTransitionEpochRef: epoch, collaborativeCanvas: authority.current,
      handleRecoverDocumentHistoryCommands: recover }),
    statusView: () => productionStatus({ documentHistoryRecoveryState: recoveryState, currentUser: actor.current,
      currentProject: currentProject.current, historyTransitionEpochRef: epoch, collaborativeCanvas: authority.current,
      historyTransitionPending: pending.current }),
    changeAnnotations: productionCallback<(records: CanvasAnnotationV2[]) => boolean>('handleAnnotationsChange', {
      ...bindings, serializeAnnotations, annotationRecordsRef: { current: [] }, annotationSignatureRef: { current: '[]' },
      annotationsDirtyRef: { current: false }, setAnnotationRevision: (): void => {},
    }),
    startRecovery: async (): Promise<void> => {
      let started: Promise<boolean> | undefined;
      productionRecoveryStartup({ ...bindings, currentUser: actor.current, currentProject: currentProject.current,
        collaborativeCanvas: authority.current, historyTransitionPending: pending.current,
        handleRecoverDocumentHistoryCommands: (): Promise<boolean> => { started = recover(); return started; } })();
      await started;
    },
    reopen: (): void => {
      session.disconnect(); socket = new Socket(); session = createCanvasDocumentSession(socket as unknown as WebSocket);
      consumed = 0; held = false; socket.onSend = (): void => { queueMicrotask(commit); }; publish();
      Object.assign(document, { recordMediaHistory: session.recordMediaHistory.bind(session),
        restorePlacementHistoryMetadata: (input: Parameters<typeof session.restorePlacementHistoryMetadata>[0]): void => {
          if (writeInterleave) { const action = writeInterleave; writeInterleave = undefined; action(); }
          session.restorePlacementHistoryMetadata(input);
        },
        rebindPlacementHistory: session.rebindPlacementHistory.bind(session), waitForPendingUpdates: session.waitForPendingUpdates.bind(session),
        undoLocal: session.undoLocal.bind(session), redoLocal: session.redoLocal.bind(session) });
      epoch.current++; active.current = null; pending.current = false; recovery.current = null;
      bindings.documentDeleteHistoryRef.current = null;
      setImages(parseDocumentMediaDirectory(directoryPayload(), 'project-p').canvasImages, { source: 'document', history: 'skip' });
    },
    loseNext: (): void => { lose = true; }, rejectNext: (predicate): void => { rejectCommand = predicate; },
    holdAck: (): void => { held = true; }, releaseAck: (): void => { held = false; commit(); },
    pauseNextReply: () => {
      let started: () => void = (): void => {}, resume: () => void = (): void => {};
      const began = new Promise<void>(resolve => { started = resolve; });
      const wait = new Promise<void>(resolve => { resume = resolve; }); replyGate = { started, wait };
      return { started: began, resume };
    },
    advanceScope: (scope): void => {
      if (scope === 'actor') actor.current = { id: 'editor-c' };
      else if (scope === 'project') { project.current = 'project-q'; currentProject.current = { id: 'project-q' }; }
      else authority.current = { ...document, recordMediaHistory: session.recordMediaHistory.bind(session) };
      epoch.current++; active.current = { projectId: project.current, epoch: epoch.current }; pending.current = true;
    },
    undo: productionCallback<() => Promise<void>>('handleUndo', bindings),
    redo: productionCallback<() => Promise<void>>('handleRedo', bindings),
    remove: productionCallback<(ids: string[]) => Promise<string[]>>('handleDeleteCanvasImages', bindings) };
}

afterEach(() => { while (cleanups.length) cleanups.pop()?.(); vi.unstubAllGlobals(); });

describe('actual fresh-page canvas history recovery', () => {
  async function interruptedRestore(): Promise<ReturnType<typeof fixture>> {
    const f = fixture({ metadata: true, mediaDiscoveryLag: true });
    await f.remove(['image-a']);
    // Real durable attach committed before the previous page sent metadata.
    const journal = readDocumentHistoryCommandJournal(f.store, { actorId: 'owner-a', projectId: 'project-p' })!;
    await runDocumentHistoryRestoration({ actorId: 'owner-a', projectId: 'project-p', storage: f.store, locks: navigator.locks,
      isCurrent: () => true, refreshMedia: async (): Promise<void> => {}, operationId: 'interrupted-undo',
      removalOperationId: journal.items[0].operationId, annotationIds: { 'annotation-a': 'annotation-reopened' } });
    f.reopen(); return f;
  }
  it('startup finishes confirmed attach metadata through the new session and ACK without rebuilding undo history', async () => {
    const f = await interruptedRestore(); await f.startRecovery();
    expect(readCanvasDocument(f.server).annotationRecords?.['annotation-reopened']).toMatchObject({ sourceImageId: 'restored-1', label: 'original annotation' });
    expect(f.server.getMap('groupDefinitions').get('group-a')).toMatchObject({ imageIds: ['placement-b', 'restored-1'] });
    expect(f.server.getMap('annotations').get('restored-1')).toBe('original note');
    const requests = f.requests.length, bytes = Y.encodeStateAsUpdate(f.server);
    await f.undo(); await f.startRecovery();
    expect(f.requests).toHaveLength(requests); expect(Y.encodeStateAsUpdate(f.server)).toEqual(bytes);
    expect(f.pending.current).toBe(false); expect(f.errors).toEqual([]);
  });
  it('keeps failed recovery locked and the actual retry finishes the same map and placement', async () => {
    const f = await interruptedRestore(); f.rejectNext(command => command.action === 'attach');
    expect(await f.recover()).toBe(false); expect(f.pending.current).toBe(true);
    const requests = f.requests.length;
    expect(await f.remove(['image-b'])).toEqual([]); await f.undo(); await f.redo();
    expect(f.requests).toHaveLength(requests);
    expect(f.setImages(previous => previous.map(image => ({ ...image, x: image.x + 10 })))).toBe(false);
    expect(f.changeAnnotations([])).toBe(false);
    const button = f.retryButton(); expect(button).not.toBeNull(); expect(button!.props.disabled).toBe(false);
    button!.props.onClick();
    await vi.waitFor(() => { expect(f.pending.current).toBe(false); });
    expect(f.retryButton()).toBeNull();
    expect(readCanvasDocument(f.server).annotationRecords?.['annotation-reopened']).toMatchObject({ sourceImageId: 'restored-1' });
    expect(Object.keys(readCanvasDocument(f.server).placements)).toEqual(['placement-a', 'placement-b', 'restored-1']);
  });
  it('waits for the recovery frame ACK and refuses ordinary edits while server projection still updates', async () => {
    const f = await interruptedRestore(); f.holdAck();
    const operation = f.recover();
    await vi.waitFor(() => { expect(f.session.status).toBe('pending'); });
    expect(f.pending.current).toBe(true);
    expect(f.setImages(previous => previous.map(image => ({ ...image, x: image.x + 20 })))).toBe(false);
    f.releaseAck(); expect(await operation).toBe(true);
    expect(f.images.current.some(image => image.placementId === 'restored-1')).toBe(true);
  });
  it.each(['actor', 'project', 'generation'] as const)('does not complete or unlock a new %s scope after a late recovery response', async scope => {
    const f = await interruptedRestore(), gate = f.pauseNextReply();
    const operation = f.recover(); let started = false; void gate.started.then(() => { started = true; });
    await vi.waitFor(() => { expect(started).toBe(true); }); f.advanceScope(scope); gate.resume();
    expect(await operation).toBe(false); expect(f.pending.current).toBe(true); expect(f.errors).toEqual([]);
    expect(readCanvasDocument(f.server).annotationRecords?.['annotation-reopened']).toBeUndefined();
  });
  it.each(['recovery', 'rejected', 'unavailable'] as const)('does not auto replay a raw session in %s state', async status => {
    const f = fixture({ status, metadata: true });
    const requests = f.requests.length; await f.startRecovery();
    expect(await f.recover()).toBe(false); expect(f.requests).toHaveLength(requests); expect(f.errors).toEqual([]);
  });
  it('does not block a document with no history journal merely because Web Locks are unavailable', async () => {
    const f = fixture(); vi.stubGlobal('navigator', {});
    await f.startRecovery(); expect(f.pending.current).toBe(false); expect(f.errors).toEqual([]);
    expect(f.requests).toHaveLength(0);
  });
  it('does not auto retry failed recovery on status notifications', async () => {
    const f = await interruptedRestore(); f.rejectNext(command => command.action === 'attach'); await f.startRecovery();
    const requests = f.requests.length; await f.startRecovery(); await f.startRecovery();
    expect(f.requests).toHaveLength(requests); expect(f.pending.current).toBe(true);
  });
  it('hides the old recovery retry control when the actor changes', async () => {
    const f = await interruptedRestore(); f.rejectNext(command => command.action === 'attach'); await f.recover();
    expect(f.retryButton()).not.toBeNull(); f.advanceScope('actor'); expect(f.retryButton()).toBeNull();
  });
  it.each(['catchup', 'write'] as const)('rejects a remote metadata conflict delivered at %s without emitting any restoration frame', async point => {
    const f = await interruptedRestore(); f.interleaveMetadata(point, 'conflict');
    expect(await f.recover()).toBe(false); expect(f.pending.current).toBe(true);
    expect(f.restorationFrames()).toBe(0);
    const projection = readCanvasDocument(f.server);
    expect(projection.placements['restored-1'].annotation).toBe('remote conflict');
    expect(projection.annotationRecords?.['annotation-reopened']).toBeUndefined();
    expect(projection.groupDefinitions!['group-a'].imageIds).toEqual(['placement-b']);
    expect(f.errors).toContain('DOCUMENT_HISTORY_METADATA_CONFLICT');
    expect(readDocumentHistoryCommandJournal(f.store, { actorId: 'owner-a', projectId: 'project-p' })!.items.at(-1)).not.toHaveProperty('metadataConfirmedSequence');
  });
  it('checkpoints complete metadata delivered during catch-up without emitting another restoration frame', async () => {
    const f = await interruptedRestore(); f.interleaveMetadata('catchup', 'complete');
    expect(await f.recover()).toBe(true); expect(f.pending.current).toBe(false); expect(f.restorationFrames()).toBe(0);
    expect(readCanvasDocument(f.server).annotationRecords?.['annotation-reopened']).toMatchObject({ sourceImageId: 'restored-1' });
    expect(readDocumentHistoryCommandJournal(f.store, { actorId: 'owner-a', projectId: 'project-p' })!.items.at(-1)).toHaveProperty('metadataConfirmedSequence');
  });
});

describe('actual live media command confirmation feedback', () => {
  it.each(['undo', 'redo'] as const)('keeps a committed response-loss %s fenced until explicit same-operation retry', async direction => {
    const f = fixture({ metadata: true }); await f.startRecovery();
    await f.remove(['image-a']);
    if (direction === 'redo') await f.undo();
    if (direction === 'undo') {
      const gate = f.pauseNextReply(), operation = f.undo(); await gate.started; f.loseNext(); gate.resume(); await operation;
    } else { f.loseNext(); await f.redo(); }
    expect(f.session.status).toBe('saved');
    expect(readDocumentHistoryCommandJournal(f.store, { actorId: 'owner-a', projectId: 'project-p' })!.items.at(-1)?.state).toBe('pending');
    expect(f.pending.current).toBe(true);
    expect(f.statusView()).not.toContain('已保存'); expect(f.statusView()).toContain('未确认');
    expect(f.setImages(previous => previous.map(image => ({ ...image, x: image.x + 10 })))).toBe(false);
    expect(f.changeAnnotations([])).toBe(false);
    const beforeRetry = f.requests.length; await f.startRecovery();
    expect(f.requests).toHaveLength(beforeRetry);
    const button = f.retryButton(); expect(button).not.toBeNull(); expect(button!.props.disabled).toBe(false);
    button!.props.onClick(); await vi.waitFor(() => { expect(f.pending.current).toBe(false); });
    expect(f.retryButton()).toBeNull(); expect(f.statusView()).toContain('已保存');
    const posts = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    const retries = posts.filter(post => post.idempotencyKey === posts[beforeRetry === 0 ? 0 : posts.length - 1].idempotencyKey);
    expect(retries.length).toBeGreaterThanOrEqual(2); expect(retries.every(post => JSON.stringify(post) === JSON.stringify(retries[0]))).toBe(true);
    if (direction === 'undo') { await f.redo(); expect(f.images.current.map(image => image.assetVersionId)).toEqual(['version-b']); }
    await f.undo(); expect(f.images.current.map(image => image.assetVersionId).sort()).toEqual(['version-a', 'version-b']);
  });

  it('does not claim saved while the actual delete callback waits for its command receipt', async () => {
    const f = fixture(), gate = f.pauseNextReply(), operation = f.remove(['image-a']);
    await gate.started; const view = f.statusView(); gate.resume(); await operation;
    expect(view).not.toContain('已保存'); expect(view).toContain('确认');
    expect(f.statusView()).toContain('已保存');
  });

  it.each(['actor', 'project', 'generation'] as const)('does not retry, notify or release a new %s scope after an old live retry response', async scope => {
    const f = fixture(); await f.remove(['image-a']); f.rejectNext(command => command.action === 'attach'); await f.undo();
    const button = f.retryButton(); expect(button).not.toBeNull();
    const gate = f.pauseNextReply(); button!.props.onClick(); await gate.started;
    const errors = [...f.errors]; f.advanceScope(scope); gate.resume();
    await vi.waitFor(() => { expect(f.requests.at(-1)?.init.method).toBe('POST'); });
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    expect(f.pending.current).toBe(true); expect(f.errors).toEqual(errors); expect(f.retryButton()).toBeNull();
    const requests = f.requests.length; button!.props.onClick(); await Promise.resolve();
    expect(f.requests).toHaveLength(requests);
  });
});

describe('actual collaboration canvas asynchronous history entry', () => {
  // The user-facing callback must own the async completion/error boundary. The
  // document command itself is controlled here; no copy of callback logic runs.
  function historyFixture(method: 'undo' | 'redo', operation: () => Promise<void>): {
    run: () => Promise<void>; errors: string[]; pending: { current: boolean };
    advanceScope: (scope: 'actor' | 'project') => void;
    pendingStates: boolean[]; flushes: () => number;
  } {
    const errors: string[] = [];
    const pending = { current: false };
    const project = { current: 'project-p' };
    const actor = { current: { id: 'owner-a' } };
    const epoch = { current: 0 };
    const active: { current: CanvasHistoryTransitionToken | null } = { current: null };
    const pendingStates: boolean[] = [];
    let flushes = 0;
    const document = { projectId: 'project-p', authority: 'document', status: 'saved',
      undoLocal: operation, redoLocal: operation };
    const isActive = productionCallback<(transition: CanvasHistoryTransitionToken) => boolean>('isActiveCanvasHistoryTransition', {
      activeHistoryTransitionRef: active, historyProjectIdRef: project, historyTransitionEpochRef: epoch,
      isCanvasHistoryTransitionCurrent,
    });
    return { errors, pending, pendingStates, flushes: () => flushes,
      advanceScope: (scope): void => {
        if (scope === 'actor') actor.current = { id: 'editor-b' };
        else project.current = 'project-q';
        epoch.current++;
        active.current = { projectId: project.current, epoch: epoch.current };
      }, run: productionCallback<() => Promise<void>>(method === 'undo' ? 'handleUndo' : 'handleRedo', {
      historyProjectIdRef: project,
      collaborativeCanvasRef: { current: document },
      canUseLegacyCanvasPersistence,
      historyLifecyclePendingRef: pending,
      documentHistoryRecoveryRef: { current: null }, documentDeleteHistoryRef: { current: null },
      isDocumentHistoryRecoveryPending: (): boolean => false,
      incrementalHistoryRef: { current: { canUndo: () => false, canRedo: () => false } },
      currentProjectRef: { current: { id: 'project-p' } }, currentUserRef: actor,
      historyTransitionEpochRef: epoch, activeHistoryTransitionRef: active,
      setHistoryTransitionPending: (value: boolean): void => { pendingStates.push(value); },
      isActiveCanvasHistoryTransition: isActive,
      flushQueuedCanvasHistoryChange: (): void => { flushes++; },
      toast: { error: (message: string): void => { errors.push(message); } },
    }) };
  }

  it.each(['undo', 'redo'] as const)('%s waits for the document operation before reporting the callback completed', async method => {
    let finish: () => void = (): void => {};
    const operation = new Promise<void>(resolve => { finish = resolve; });
    const f = historyFixture(method, () => operation);
    let settled = false;
    const result = f.run().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const early = settled;
    const locked = f.pending.current;
    finish();
    await result;
    expect(early).toBe(false);
    expect(locked).toBe(true);
    expect(f.pending.current).toBe(false);
    expect(settled).toBe(true);
    expect(f.errors).toEqual([]);
  });

  it.each(['undo', 'redo'] as const)('%s refuses a second history transition while its first document operation is pending', async method => {
    let finish: () => void = (): void => {};
    const operation = new Promise<void>(resolve => { finish = resolve; });
    let executions = 0;
    const f = historyFixture(method, () => { executions++; return operation; });
    const first = f.run();
    const second = f.run();
    finish();
    await Promise.all([first, second]);
    expect(executions).toBe(1);
    expect(f.pending.current).toBe(false);
  });

  it.each(['undo', 'redo'] as const)('%s reports a late document rejection through the actual error boundary', async method => {
    let reject: (error: Error) => void = (): void => {};
    const operation = new Promise<void>((_resolve, failure) => { reject = failure; });
    // The controlled transport is observed too, so the deliberately unhandled
    // production branch becomes an assertion failure, not a runner rejection.
    void operation.catch((): void => {});
    const f = historyFixture(method, () => operation);
    const result = f.run();
    reject(new Error('confirmed restore failed'));
    await result;
    await Promise.resolve();
    expect(f.errors).toEqual(['confirmed restore failed']);
  });

  it.each([
    ['undo', 'actor'], ['redo', 'actor'], ['undo', 'project'], ['redo', 'project'],
  ] as const)('%s does not unlock or notify the new %s scope after an old operation rejects', async (method, scope) => {
    let reject: (error: Error) => void = (): void => {};
    const operation = new Promise<void>((_resolve, failure) => { reject = failure; });
    const f = historyFixture(method, () => operation);
    const result = f.run();
    // Scope rollover is a controlled boundary; the callback and its transition
    // validator are both the actual production callbacks, not copied branches.
    f.advanceScope(scope);
    reject(new Error('old scope restore failed'));
    await result;
    expect(f.pending.current).toBe(true);
    expect(f.pendingStates).toEqual([true]);
    expect(f.flushes()).toBe(0);
    expect(f.errors).toEqual([]);
  });
});

describe('actual collaboration canvas deletion entry', () => {
  it.each(['Delete', 'Backspace'])('reaches same-batch failed deletion retry through the actual %s key and canvas request guards', async code => {
    const f = fixture(); f.rejectNext(command => command.action === 'remove'); await f.remove(['image-a']);
    const before = f.requests.length;
    await canvasDeleteKey(f, ['image-b'], code); expect(f.requests).toHaveLength(before);
    await canvasDeleteKey(f, ['image-a'], code, { inputFocused: true }); expect(f.requests).toHaveLength(before);
    await canvasDeleteKey(f, ['image-a'], code, { overlay: true }); expect(f.requests).toHaveLength(before);
    await canvasDeleteKey(f, ['image-a'], code);
    expect(f.pending.current).toBe(false); expect(f.images.current.map(image => image.id)).toEqual(['image-b']);
    const posts = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(posts).toHaveLength(2); expect(posts[0]).toEqual(posts[1]);
    await f.undo(); expect(f.images.current).toHaveLength(2);
  });

  it('rejects ordinary writes while the initial delete is awaiting its receipt, then releases the fence on confirmation', async () => {
    const f = fixture(), gate = f.pauseNextReply(), deleting = f.remove(['image-a']);
    await gate.started;
    const accepted = f.setImages(current => current.map(image => ({ ...image, x: 800 })));
    const annotationAccepted = f.changeAnnotations([]), view = f.statusView();
    gate.resume(); await deleting;
    expect(accepted).toBe(false); expect(annotationAccepted).toBe(false); expect(view).not.toContain('已保存');
    expect(readCanvasDocument(f.server).placements['placement-b'].x).toBe(420);
    expect(f.setImages(current => current.map(image => ({ ...image, x: 810 })))).toBe(true);
    await Promise.resolve(); expect(readCanvasDocument(f.server).placements['placement-b'].x).toBe(810);
  });

  it.each(['rejected', 'response-lost'] as const)('keeps an initial %s delete visibly unconfirmed until the original command is explicitly retried', async failure => {
    const f = fixture({ metadata: true }); await f.startRecovery();
    if (failure === 'rejected') f.rejectNext(command => command.action === 'remove'); else f.loseNext();
    expect(await f.remove(['image-a'])).toEqual([]);
    expect(f.pending.current).toBe(true);
    expect(f.statusView()).not.toContain('已保存'); expect(f.statusView()).toContain('未确认');
    const before = readCanvasDocument(f.server), requests = f.requests.length;
    expect(f.setImages(current => current.map(image => ({ ...image, x: 800 })))).toBe(false);
    expect(f.changeAnnotations([])).toBe(false);
    await f.undo(); await f.redo(); await f.remove(['image-b']); await f.startRecovery();
    expect(f.requests).toHaveLength(requests); expect(readCanvasDocument(f.server)).toEqual(before);
    const button = f.retryButton(); expect(button).not.toBeNull(); expect(button!.props.disabled).toBe(false);
    button!.props.onClick(); await vi.waitFor(() => { expect(f.pending.current).toBe(false); });
    expect(f.retryButton()).toBeNull(); expect(f.statusView()).toContain('已保存');
    expect(f.images.current.map(image => image.assetVersionId)).toEqual(['version-b']);
    const removes = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(removes).toHaveLength(2); expect(removes[1]).toEqual(removes[0]);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    const restored = readCanvasDocument(f.server); await f.undo(); expect(readCanvasDocument(f.server)).toEqual(restored);
  });

  it('keeps a repeated initial delete retry failure fenced and reuses the same command on the next retry', async () => {
    const f = fixture(); f.rejectNext(command => command.action === 'remove'); await f.remove(['image-a']);
    f.rejectNext(command => command.action === 'remove');
    expect(await f.recover()).toBe(false); expect(f.pending.current).toBe(true); expect(f.statusView()).toContain('未确认');
    expect(await f.recover()).toBe(true); expect(f.pending.current).toBe(false);
    const posts = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(posts).toHaveLength(3); expect(new Set(posts.map(post => post.idempotencyKey)).size).toBe(1);
    await f.undo(); expect(f.images.current).toHaveLength(2);
  });

  it('continues an initial image/video delete batch after committed response loss without splitting its history or replaying the suffix automatically', async () => {
    const f = fixture({ video: true }); f.loseNext(); await f.remove(['image-a', 'image-b']);
    expect(readCanvasDocument(f.server).placements['placement-a'].deleted).toBe(true);
    expect(readCanvasDocument(f.server).placements['placement-b'].deleted).toBeUndefined();
    expect(f.pending.current).toBe(true); await f.startRecovery();
    expect(f.requests.filter(request => request.init.method === 'POST')).toHaveLength(1);
    expect(await f.recover()).toBe(true); expect(f.images.current).toEqual([]);
    const posts = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(posts).toHaveLength(3); expect(posts[0]).toEqual(posts[1]);
    await f.undo(); expect(f.images.current.map(image => image.assetVersionId).sort()).toEqual(['version-a', 'version-b']);
    expect(f.images.current.find(image => image.assetVersionId === 'version-b')?.videoUrl).toBe('/api/serve-upload/b.mp4');
    await f.redo(); expect(f.images.current).toEqual([]);
  });

  it.each(['actor', 'project', 'generation'] as const)('does not complete, register history or release the new %s scope after an initial delete retry response', async scope => {
    const f = fixture(); f.rejectNext(command => command.action === 'remove'); await f.remove(['image-a']);
    expect(f.retryButton()).not.toBeNull();
    const gate = f.pauseNextReply(), retrying = f.recover(); await gate.started;
    const requestsDuringRetry = f.requests.length;
    expect(await f.recover()).toBe(false); expect(f.requests).toHaveLength(requestsDuringRetry);
    const errors = [...f.errors]; f.advanceScope(scope); gate.resume();
    expect(await retrying).toBe(false); expect(f.pending.current).toBe(true); expect(f.errors).toEqual(errors);
    expect(f.retryButton()).toBeNull(); expect(f.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
    const requests = f.requests.length; await f.session.undoLocal(); expect(f.requests).toHaveLength(requests);
  });

  it.each(['undo', 'redo'] as const)('fences new local edits and the opposite direction until the failed media %s batch is retried', async direction => {
    const f = fixture({ metadata: true }); expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    if (direction === 'redo') {
      await f.undo(); f.rejectNext(command => command.action === 'remove' && command.expectedAssetVersionId === 'version-b'); await f.redo();
    } else {
      f.rejectNext(command => command.action === 'attach' && command.assetVersionId === 'version-a'); await f.undo();
    }
    const current = readCanvasDocument(f.server), survivor = f.images.current[0];
    expect(() => f.session.applyLocalChange({ placementId: survivor.placementId!, x: 800 })).toThrow();
    expect(() => f.session.applyLocalGroups({ 'new-group': { id: 'new-group', name: 'new', note: '', imageIds: [survivor.placementId!], x: 1, y: 2, collapsed: false } })).toThrow();
    expect(() => f.session.applyLocalAnnotations({ ...f.session.projection.annotationRecords })).toThrow();
    expect(() => f.session.recordMediaHistory({ undo: (): void => {}, redo: (): void => {} })).toThrow();
    const requests = f.requests.length;
    await f[direction === 'undo' ? 'redo' : 'undo'](); expect(f.requests).toHaveLength(requests);
    expect(readCanvasDocument(f.server)).toEqual(current);
    await f[direction]();
    if (direction === 'redo') { await f.undo(); }
    expect(() => f.session.applyLocalChange({ placementId: f.images.current[0].placementId!, x: 810 })).not.toThrow();
  });

  it('does not let a new deletion discard the recoverable batch after a partial redo failure', async () => {
    const f = fixture(); expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    await f.undo(); f.rejectNext(command => command.action === 'remove' && command.expectedAssetVersionId === 'version-b');
    await f.redo(); expect(f.images.current).toHaveLength(1);
    const survivor = f.images.current[0], requests = f.requests.length;
    expect(await f.remove([survivor.id])).toEqual([]); expect(f.requests).toHaveLength(requests);
    await f.redo(); expect(f.images.current).toEqual([]);
    await f.undo(); expect(f.images.current.map(image => image.assetVersionId).sort()).toEqual(['version-a', 'version-b']);
    // A completed retry releases the fence for the following new operation.
    expect(await f.remove([f.images.current[0].id])).toHaveLength(1);
  });

  it('does not replace the restored prefix identity while a failed batch undo is awaiting retry', async () => {
    const f = fixture(); expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    f.rejectNext(command => command.action === 'attach' && command.assetVersionId === 'version-a');
    await f.undo(); expect(f.images.current).toHaveLength(1);
    const prefix = f.images.current[0], requests = f.requests.length;
    expect(await f.remove([prefix.id])).toEqual([]); expect(f.requests).toHaveLength(requests);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    expect(f.images.current.find(image => image.assetVersionId === 'version-b')?.placementId).toBe(prefix.placementId);
    await f.redo(); expect(f.images.current).toEqual([]);
  });

  it('continues restoration in the same generation while the Hook discovers newly attached media', async () => {
    const f = fixture({ mediaDiscoveryLag: true }); expect(await f.remove(['image-a'])).toEqual(['image-a']);
    await f.undo(); expect(f.images.current).toHaveLength(2); expect(f.errors).toEqual([]);
    await f.redo(); expect(f.images.current.map(image => image.id)).toEqual(['image-b']);
  });
  it('keeps an image/video batch in one media history entry across two fresh-identity undo redo cycles', async () => {
    const f = fixture({ video: true });
    expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    expect(f.images.current).toEqual([]);
    for (let cycle = 0; cycle < 2; cycle++) {
      await f.undo();
      expect(f.images.current.map(image => image.assetVersionId).sort()).toEqual(['version-a', 'version-b']);
      expect(f.images.current.find(image => image.assetVersionId === 'version-b')).toMatchObject({
        mediaType: 'video', url: '', videoUrl: '/api/serve-upload/b.mp4',
      });
      expect(f.images.current.every(image => !['placement-a', 'placement-b'].includes(image.placementId!))).toBe(true);
      await f.redo(); expect(f.images.current).toEqual([]); expect(f.errors).toEqual([]);
    }
    expect(Object.values(readCanvasDocument(f.server).placements).filter(placement => placement.deleted)).toHaveLength(6);
  });

  it('uses the actual removal preimage and preserves remote group edits during annotation restoration', async () => {
    const f = fixture({ metadata: true });
    f.session.applyLocalChange({ placementId: 'placement-a', x: 260 });
    await Promise.resolve();
    expect(await f.remove(['image-a'])).toEqual(['image-a']);
    const group = readCanvasDocument(f.server).groupDefinitions!['group-a'];
    f.server.getMap('groupDefinitions').set('group-a', { ...group, name: 'remote name' });
    await f.undo();
    const current = readCanvasDocument(f.server), restored = f.images.current.find(image => image.assetVersionId === 'version-a')!;
    expect(restored.x).toBe(260);
    expect(current.groupDefinitions!['group-a']).toMatchObject({ name: 'remote name', imageIds: ['placement-b', restored.placementId] });
    expect(current.annotationTombstones?.['annotation-a']).toBe(true);
    const live = Object.values(current.annotationRecords ?? {}).filter(record => !current.annotationTombstones?.[record.id]);
    expect(live).toHaveLength(1); expect(live[0]).toMatchObject({ sourceImageId: restored.placementId, label: 'original annotation', createdAt: 10 });
    expect(live[0].id).not.toBe('annotation-a');
    await f.undo(); await Promise.resolve();
    expect(readCanvasDocument(f.server).placements[restored.placementId!].x).toBe(200);
    expect(f.errors).toEqual([]);
  });

  it('preserves the confirmed prefix and untouched failed suffix until explicit retry finishes one deletion history entry', async () => {
    const f = fixture(); f.rejectNext(command => command.action === 'remove' && command.placementId === 'placement-b');
    expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a']);
    expect(f.images.current.map(image => image.id)).toEqual(['image-b']); expect(f.errors).toHaveLength(1);
    const requests = f.requests.length; await f.undo(); expect(f.requests).toHaveLength(requests);
    expect(readCanvasDocument(f.server).placements['placement-b'].deleted).toBeUndefined();
    expect(f.pending.current).toBe(true); expect(f.statusView()).toContain('未确认');
    expect(await f.recover()).toBe(true); expect(f.images.current).toEqual([]);
    const removals = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(removals.filter(post => post.command.placementId === 'placement-a')).toHaveLength(1);
    expect(removals.filter(post => post.command.placementId === 'placement-b')).toHaveLength(2);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    const restored = readCanvasDocument(f.server); await f.undo(); expect(readCanvasDocument(f.server)).toEqual(restored);
  });

  it('retries an uncertain remove with the original durable key and does not register duplicate media history', async () => {
    const f = fixture(); f.loseNext();
    expect(await f.remove(['image-a'])).toEqual([]);
    expect(readCanvasDocument(f.server).placements['placement-a'].deleted).toBe(true);
    expect(await f.remove(['image-a'])).toEqual(['image-a']);
    const commands = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    const before = Object.keys(readCanvasDocument(f.server).placements);
    await f.undo(); expect(Object.keys(readCanvasDocument(f.server).placements)).toEqual(before);
  });

  it('resumes a partial batch restoration on the same attach key without duplicating the successful prefix', async () => {
    const f = fixture(); expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    f.rejectNext(command => command.action === 'attach' && command.assetVersionId === 'version-a');
    await f.undo(); expect(f.images.current).toHaveLength(1); expect(f.errors).toHaveLength(1);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    const posts = f.requests.filter(request => request.init.method === 'POST').map(request => JSON.parse(String(request.init.body)));
    const attachPosts = posts.filter(post => post.command.action === 'attach');
    expect(new Set(attachPosts.map(post => post.idempotencyKey)).size).toBe(2);
    await f.redo(); expect(f.images.current).toEqual([]);
  });

  it.each(['actor', 'project', 'generation'] as const)('waits for existing pending edits and rejects deletion after %s scope rollover', async scope => {
    const f = fixture(); f.holdAck(); f.session.applyLocalChange({ placementId: 'placement-a', x: 300 });
    const deleting = f.remove(['image-a']); await Promise.resolve(); await Promise.resolve();
    expect(f.requests).toEqual([]);
    f.advanceScope(scope); f.releaseAck();
    expect(await deleting).toEqual([]); expect(f.requests).toEqual([]); expect(f.errors).toEqual([]);
    expect(f.pending.current).toBe(true); expect(f.selected()?.id).toBe('image-a');
  });

  it('does not continue a stale rendered delete callback in another active project', async () => {
    const f = fixture(); f.advanceScope('project'); f.pending.current = false;
    expect(await f.remove(['image-a'])).toEqual([]); expect(f.requests).toEqual([]); expect(f.errors).toEqual([]);
  });

  it.each(['actor', 'project', 'generation'] as const)('does not register history, report success or unlock the new %s scope after a committed late reply', async scope => {
    const f = fixture(), gate = f.pauseNextReply();
    const deleting = f.remove(['image-a']); await gate.started;
    f.advanceScope(scope); gate.resume();
    expect(await deleting).toEqual([]); expect(f.errors).toEqual([]); expect(f.pending.current).toBe(true);
    expect(f.selected()?.id).toBe('image-a'); expect(f.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
    expect(f.refreshes).toEqual([]);
    const requests = f.requests.length; await f.session.undoLocal(); expect(f.requests).toHaveLength(requests);
  });

  it('retries an attach lost after commit using its frozen identity and annotation mapping', async () => {
    const f = fixture({ metadata: true }); expect(await f.remove(['image-a'])).toEqual(['image-a']);
    // The restoration first reauthorizes the remove. Pause that response so
    // loss is injected into the following attach, not into the prerequisite.
    const gate = f.pauseNextReply(), undoing = f.undo(); await gate.started; f.loseNext(); gate.resume();
    await undoing; expect(f.errors).toHaveLength(1);
    await f.undo(); expect(f.images.current).toHaveLength(2);
    const attaches = f.requests.filter(request => request.init.method === 'POST')
      .map(request => JSON.parse(String(request.init.body))).filter(body => body.command.action === 'attach');
    expect(new Set(attaches.map(body => body.idempotencyKey)).size).toBe(1);
    const projection = readCanvasDocument(f.server);
    expect(Object.keys(projection.placements).filter(id => id.startsWith('restored-'))).toHaveLength(1);
    expect(Object.values(projection.annotationRecords ?? {}).filter(record => !projection.annotationTombstones?.[record.id])).toHaveLength(1);
  });

  it('keeps the history cursor retryable if the second redo remove is rejected', async () => {
    const f = fixture(); expect(await f.remove(['image-a', 'image-b'])).toEqual(['image-a', 'image-b']);
    await f.undo(); f.rejectNext(command => command.action === 'remove' && command.expectedAssetVersionId === 'version-b');
    await f.redo(); expect(f.images.current).toHaveLength(1); expect(f.errors).toHaveLength(1);
    await f.redo(); expect(f.images.current).toEqual([]);
    await f.undo(); expect(f.images.current).toHaveLength(2);
  });

  it('refuses unready document media instead of silently deleting a local-only image', async () => {
    const f = fixture(); delete f.images.current[0].placementId; delete f.images.current[0].assetId;
    expect(await f.remove(['image-a'])).toEqual([]); expect(f.requests).toEqual([]);
    expect(f.images.current).toHaveLength(2); expect(f.errors).toHaveLength(1);
  });

  it('fails closed without Web Locks before any document command or local deletion', async () => {
    const f = fixture(); vi.stubGlobal('navigator', { locks: undefined });
    expect(await f.remove(['image-a'])).toEqual([]); expect(f.requests).toEqual([]);
    expect(f.images.current).toHaveLength(2); expect(f.errors).toEqual(['DOCUMENT_HISTORY_LOCK_UNAVAILABLE']);
  });

  // Regression: the current document-authority guard exits before any command.
  // Removing that guard without the authorized document POST is still a failure.
  it.each(['owner-a', 'editor-b'])('submits the frozen actor %s intent through the document command when HTTP permits it', async actorId => {
    const actual = fixture({ actorId });
    expect(await actual.remove(['image-a', 'image-a'])).toEqual(['image-a']);
    const commands = actual.requests.filter(request => request.init.method === 'POST');
    expect(commands).toHaveLength(1);
    expect(commands[0].url).toBe('/api/collaboration/document-assets');
    expect(actual.requests.every(request => request.url.startsWith('/api/collaboration/'))).toBe(true);
    const { init } = commands[0];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-wujie-expected-actor-id')).toBe(actorId);
    const request = JSON.parse(String(init.body)) as { projectId: string; idempotencyKey: string; command: unknown };
    expect(request.projectId).toBe('project-p');
    expect(request.idempotencyKey).toEqual(expect.any(String));
    expect(request.idempotencyKey.length).toBeGreaterThan(0);
    expect(request.command).toEqual({ action: 'remove', placementId: 'placement-a', expectedAssetVersionId: 'version-a' });
    expect(actual.images.current.map(image => image.id)).toEqual(['image-b']);
    expect(actual.refreshes).toEqual([{ projectId: 'project-p', documentSequence: 3, commandsBeforeRefresh: 1 }]);
    expect(actual.selected()).toBeNull();
    expect(actual.errors).toEqual([]);
  });

  it('real document setter refuses ordinary client deletion instead of mutating the visible snapshot', () => {
    const actual = fixture();
    expect(actual.setImages(previous => previous.filter(image => image.id !== 'image-a'))).toBe(false);
    expect(actual.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
  });

  it('preserves existing legacy deletion and removes only the requested placement', async () => {
    const actual = fixture({ authority: 'legacy' });
    expect(await actual.remove(['image-a', 'image-a'])).toEqual(['image-a']);
    expect(actual.requests.map(request => [request.url, request.init.method]))
      .toEqual([['/api/assets/placements/placement-a?projectId=project-p', 'DELETE']]);
    expect(actual.images.current.map(image => image.id)).toEqual(['image-b']);
    expect(actual.selected()).toBeNull();
  });

  it('does not issue a deletion while an undo/redo transition is pending', async () => {
    const actual = fixture({ historyPending: true });
    expect(await actual.remove(['image-a'])).toEqual([]);
    expect(actual.requests).toEqual([]);
    expect(actual.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
  });

  it.each(['unknown', 'connecting', 'read-only'])('does not fall back to the owner placement API for %s authority/state', async state => {
    const actual = fixture(state === 'unknown' ? { authority: 'unknown' } : { status: state });
    expect(await actual.remove(['image-a'])).toEqual([]);
    expect(actual.requests).toEqual([]);
    expect(actual.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
    expect(actual.selected()?.id).toBe('image-a');
  });

  it('does not falsely remove a legacy image when its placement endpoint rejects access', async () => {
    const actual = fixture({ authority: 'legacy', httpStatus: 403 });
    expect(await actual.remove(['image-a'])).toEqual([]);
    expect(actual.requests).toHaveLength(1);
    expect(actual.images.current.map(image => image.id)).toEqual(['image-a', 'image-b']);
    expect(actual.selected()?.id).toBe('image-a');
    expect(actual.errors).toHaveLength(1);
  });
});
