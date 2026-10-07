import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { vi } from 'vitest';
import type { CanvasImage } from '@/components/infinite-canvas';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';
import { canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions } from '@/lib/asset-core/workspace-transfer';
import { routeCanvasWorkspaceChange } from '@/lib/collaboration/canvas-document-image-bridge';
import { isCanvasTaskProjectionChange } from '@/lib/canvas-kernel/commands';
import { IncrementalHistoryManager } from '@/lib/canvas-incremental-history';
import { canvasSkillProjectionIdentity, transferCanvasSkillAsset, transferCanvasSkillAssets } from '@/lib/skill-runtime/canvas-client';

const sources = {
  workspace: ts.createSourceFile('workspace.tsx', readFileSync(resolve('src/components/canvas-workspace.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  chat: ts.createSourceFile('chat.tsx', readFileSync(resolve('src/components/chat-panel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
};
// Same AST callback technique as embedded-canvas-insertion-behavior; no copied business implementation.
export function actualTransferCallback<T>(name: string, bindings: Record<string, unknown>, kind: keyof typeof sources = 'workspace'): T {
  const source = sources[kind];
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      const init = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback'
        ? node.initializer.arguments[0] : node.initializer;
      text = `const ${name} = ${init.getText(source)};`;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!text) throw new Error('Production callback missing: ' + name);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), js + '; return ' + name + ';')(...Object.values(bindings)) as T;
}

export function contractDeferred<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}
function actualCanvasChatReceiver<T>(name: string, bindings: Record<string, unknown>): T {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sources.workspace) === 'ChatPanel') {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(sources.workspace) === name
          && prop.initializer && ts.isJsxExpression(prop.initializer)) expression = prop.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sources.workspace);
  if (!expression) throw new Error('Embedded Chat receiver missing: ' + name);
  const js = ts.transpileModule('const receiver = ' + expression.getText(sources.workspace) + ';', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), js + '; return receiver;')(...Object.values(bindings)) as T;
}
export type TransferMeta = { runId?: string; sourceVersionIds?: readonly string[]; restoreDeletedPlacement?: boolean;
  modelName?: string; apiProvider?: string; sourceImageId?: string; signal?: AbortSignal };
export type SingleTransfer = (reference: WorkspaceAssetReference, meta?: TransferMeta) => Promise<void>;
export type BatchTransfer = (references: WorkspaceAssetReference[], meta?: TransferMeta) => Promise<void>;
export const contractReference: WorkspaceAssetReference = { url: '/result.png', kind: 'image', assetId: 'asset-a',
  assetVersionId: 'version-a', placementId: 'placement-a', entityId: 'canvas-skill:run-a:version-a' };
export const contractSecondReference: WorkspaceAssetReference = { url: '/second.png', kind: 'image', assetId: 'asset-b',
  assetVersionId: 'version-b', placementId: 'placement-b', entityId: 'canvas-skill:run-a:version-b' };

interface CanvasTransferContractFixture {
  single: SingleTransfer; batch: BatchTransfer; bindings: Record<string, unknown>;
  actor: { current: { id: string } }; project: { current: { id: string } };
  historyProject: { current: string }; epoch: { current: number }; mounted: { current: boolean };
  images: { current: CanvasImage[] }; deleted: { current: Set<string> }; deletion: { current: Map<string, number> };
  revision: { current: number }; writes: CanvasImage[][]; saves: CanvasImage[][]; records: unknown[];
  cleared: string[][]; successes: string[]; errors: string[];
  requests: Array<{ url: string; body: Record<string, unknown> | undefined }>;
  entered: Promise<void>; release: () => void;
}
export function canvasTransferContractFixture(options: { pause?: 'decode' | 'flush'; trashed?: boolean } = {}): CanvasTransferContractFixture {
  const entered = contractDeferred<void>(), released = contractDeferred<void>();
  const wait = async (phase: 'decode' | 'flush'): Promise<void> => {
    if (options.pause === phase) { entered.release(); await released.promise; }
  };
  const actor = { current: { id: 'actor-a' } }, project = { current: { id: 'project-a' } };
  const historyProject = { current: 'project-a' }, epoch = { current: 7 }, mounted = { current: true };
  const authority = { current: { projectId: 'project-a', authority: 'legacy', recordMediaHistory: (): void => {}, refreshMedia: async (): Promise<CanvasImage[]> => [] } };
  const original: CanvasImage = { id: 'original', url: '/original.png', prompt: '', x: 10, y: 20, width: 32, height: 24, createdAt: 1 };
  const images = { current: [original] }, deleted = { current: new Set(['canvas-skill:run-a:version-a']) };
  const deletion = { current: new Map<string, number>() }, revision = { current: 4 };
  const writes: CanvasImage[][] = [], saves: CanvasImage[][] = [], records: unknown[] = [], cleared: string[][] = [];
  const successes: string[] = [], errors: string[] = [];
  const requests: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
  const manager = {
    getProjectSyncRevision: (): number => revision.current,
    advanceProjectSyncRevision: (value: number): void => { revision.current = value; },
    clearRecentlyDeletedImageIds: (ids: string[]): void => { cleared.push(ids); },
    recordDeletedImageIds: (): void => {},
    flushProjectsToServer: async (): Promise<void> => { await wait('flush'); },
  };
  const bindings: Record<string, unknown> = {
    currentUserRef: actor, currentProjectRef: project, historyProjectIdRef: historyProject,
    historyTransitionEpochRef: epoch, isMountedRef: mounted, collaborativeCanvasRef: authority,
    historyLifecyclePendingRef: { current: false }, isDocumentHistoryRecoveryPending: (): boolean => false,
    latestImagesRef: images, imageDeletionGenerationRef: deletion, recentlyDeletedIdsRef: deleted,
    UserManagerCore: { getInstance: () => manager },
    toast: { success: (value: string): void => { successes.push(value); }, info: (): void => {}, error: (value: string): void => { errors.push(value); } },
    canvasEntityIdForTransferredReference, filterUniqueCanvasImageInsertions, canvasSkillProjectionIdentity,
    transferCanvasSkillAsset, transferCanvasSkillAssets,
    autoLayoutImages: actualTransferCallback('autoLayoutImages', {}),
    getCanvasImageDisplaySize: actualTransferCallback('getCanvasImageDisplaySize', {}),
    loadCanvasImageSize: async (): Promise<{ width: number; height: number }> => { await wait('decode'); return { width: 32, height: 24 }; },
    // External React, storage and decoding seams capture output, never implement scope/admission/recovery.
    stabilizeCanvasImages: (): void => {}, recordUserData: (value: unknown): void => { records.push(value); },
    persistCanvasImagesNow: (value: CanvasImage[]): void => { saves.push(value); },
    createAutoConnection: (): void => {}, setCanvasConnections: (): void => {},
    handleAddDocumentEmbeddedMedia: (): never => { throw new Error('Unexpected document path in legacy contract'); },
  };
  bindings.setImages = actualTransferCallback('setImages', {
    ...bindings, queuedCanvasHistoryChangeRef: { current: null }, isCanvasTaskProjectionChange, routeCanvasWorkspaceChange,
    incrementalHistoryRef: { current: new IncrementalHistoryManager<CanvasImage>() }, prevImagesRef: { current: images.current },
    setImagesRaw: (value: CanvasImage[]): void => { writes.push(value); },
  });
  bindings.captureCanvasInsertionScope = actualTransferCallback('captureCanvasInsertionScope', bindings);
  bindings.handleAddImages = actualTransferCallback('handleAddImages', bindings);
  const single = actualCanvasChatReceiver<SingleTransfer>('onAddGeneratedImage', {
    handleAddEmbeddedChatImage: actualTransferCallback<SingleTransfer>('handleAddEmbeddedChatImage', bindings),
  });
  const batch = actualCanvasChatReceiver<BatchTransfer>('onAddGeneratedImages', {
    handleAddEmbeddedChatImages: actualTransferCallback<BatchTransfer>('handleAddEmbeddedChatImages', bindings),
  });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined });
    if (url === '/api/assets/transfer') return Response.json({ ...contractReference, projectRevision: 6,
      ...(options.trashed ? { placementStatus: 'trashed', placementRevision: '5' } : {}) });
    if (url === '/api/assets/asset-a/restore') return Response.json({ projectRevision: 6, placement: {
      id: 'placement-a', assetId: 'asset-a', assetVersionId: 'version-a', status: 'active',
    } });
    if (url === '/api/assets/batch-transfer') return Response.json({ transfers: [
      { ...contractReference, projectRevision: 6 }, { ...contractSecondReference, projectRevision: 6 },
    ] });
    throw new Error('Unexpected HTTP in transfer contract: ' + url);
  });
  return { single, batch, bindings, actor, project, historyProject, epoch, mounted, images, deleted, deletion, revision,
    writes, saves, records, cleared, successes, errors, requests, entered: entered.promise, release: (): void => released.release() };
}
