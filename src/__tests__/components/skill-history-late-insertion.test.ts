import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { canvasSkillProjectionIdentity } from '@/lib/skill-runtime/canvas-client';

function callback(name: string, bindings: Record<string, unknown>): (...args: unknown[]) => Promise<void> {
  const file = resolve(process.cwd(), 'src/components/canvas-workspace.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name
      && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`Missing production callback ${name}`);
  const js = ts.transpileModule(`const callback = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn callback;`)(...Object.values(bindings)) as (...args: unknown[]) => Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const entityId = canvasSkillProjectionIdentity('run-1', 'version-1');
  const transfer = deferred<Record<string, unknown>>();
  const dimensions = deferred<{ width: number; height: number }>();
  const manager = {
    revision: 7,
    getProjectSyncRevision: () => manager.revision,
    advanceProjectSyncRevision: vi.fn((value: number) => { manager.revision = Math.max(value, manager.revision); }),
    clearRecentlyDeletedImageIds: vi.fn(),
    flushProjectsToServer: vi.fn(async () => undefined),
  };
  const setImages = vi.fn();
  const recentlyDeletedIdsRef = { current: new Set([entityId]) };
  const imageDeletionGenerationRef = { current: new Map([[entityId, 1]]) };
  const common = {
    UserManagerCore: { getInstance: () => manager },
    currentProjectRef: { current: { id: 'project-1' } },
    isWorkspaceResultScopeCurrent: (a: string, b: string) => a === b,
  };
  const loadCanvasImageSize = vi.fn(() => dimensions.promise);
  const add = callback('handleAddImages', {
    ...common, latestImagesRef: { current: [] }, images: [], currentUser: { id: 'user-1' },
    loadCanvasImageSize, getCanvasImageDisplaySize: (width: number, height: number) => ({ width, height }),
    canvasEntityIdForTransferredReference: (ref: { entityId: string }) => ref.entityId,
    autoLayoutImages: (_previous: unknown[], added: unknown[]) => added,
    filterUniqueCanvasImageInsertions: (_previous: unknown[], added: unknown[]) => added,
    setImages, stabilizeCanvasImages: vi.fn(), persistCanvasImagesNow: vi.fn(),
    recordUserData: vi.fn(), toast: { info: vi.fn(), success: vi.fn() },
  });
  const receive = callback('handleAddEmbeddedChatImage', {
    ...common, currentProject: { id: 'project-1' }, handleAddImages: add,
    transferCanvasSkillAsset: () => transfer.promise, canvasSkillProjectionIdentity,
    recentlyDeletedIdsRef, imageDeletionGenerationRef,
  });
  const restored = { assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
    entityId, url: '/restored.png', projectRevision: 8 };
  return { manager, setImages, receive, transfer, dimensions, restored, loadCanvasImageSize,
    recentlyDeletedIdsRef, imageDeletionGenerationRef, entityId };
}

describe('Skill history delayed insertion', () => {
  it('does not insert a restore response older than a synchronized deletion', async () => {
    const test = setup();
    const pending = test.receive(test.restored, { runId: 'run-1', restoreDeletedPlacement: true });
    test.manager.revision = 9;
    test.transfer.resolve(test.restored);
    test.dimensions.resolve({ width: 100, height: 100 });
    await expect(pending).rejects.toThrow('画布已更新');
    expect(test.setImages).not.toHaveBeenCalled();
    expect(test.recentlyDeletedIdsRef.current.has(test.entityId)).toBe(true);
    expect(test.manager.clearRecentlyDeletedImageIds).not.toHaveBeenCalled();
  });

  it('checks again after image dimensions load when a newer delete has arrived', async () => {
    const test = setup();
    const pending = test.receive(test.restored, { runId: 'run-1', restoreDeletedPlacement: true });
    test.transfer.resolve(test.restored);
    await vi.waitFor(() => expect(test.loadCanvasImageSize).toHaveBeenCalledOnce());
    test.manager.revision = 9;
    test.dimensions.resolve({ width: 100, height: 100 });
    await expect(pending).rejects.toThrow('画布已更新');
    expect(test.setImages).not.toHaveBeenCalled();
    expect(test.manager.clearRecentlyDeletedImageIds).not.toHaveBeenCalled();
  });

  it('rejects a newer local deletion before the server revision advances', async () => {
    const test = setup();
    const pending = test.receive(test.restored, { runId: 'run-1', restoreDeletedPlacement: true });
    test.imageDeletionGenerationRef.current.set(test.entityId, 2);
    test.transfer.resolve(test.restored);
    test.dimensions.resolve({ width: 100, height: 100 });
    await expect(pending).rejects.toThrow('画布已更新');
    expect(test.setImages).not.toHaveBeenCalled();
  });

  it('still restores the same placement when no newer deletion intervenes', async () => {
    const test = setup();
    const pending = test.receive(test.restored, { runId: 'run-1', restoreDeletedPlacement: true });
    test.transfer.resolve(test.restored);
    test.dimensions.resolve({ width: 100, height: 100 });
    await pending;
    expect(test.setImages).toHaveBeenCalledOnce();
    expect(test.manager.revision).toBe(8);
    expect(test.recentlyDeletedIdsRef.current.has(test.entityId)).toBe(false);
  });
});
