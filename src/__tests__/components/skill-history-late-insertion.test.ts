// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasSkillProjectionIdentity } from '@/lib/skill-runtime/canvas-client';
import { actualTransferCallback, canvasTransferContractFixture, type SingleTransfer } from '@/__tests__/helpers/canvas-chat-transfer-contract-fixture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const f = canvasTransferContractFixture();
  const entityId = canvasSkillProjectionIdentity('run-1', 'version-1');
  const transfer = deferred<Record<string, unknown>>();
  const dimensions = deferred<{ width: number; height: number }>();
  f.revision.current = 7;
  const storage = (f.bindings.UserManagerCore as { getInstance: () => {
    clearRecentlyDeletedImageIds: (ids: string[]) => void;
  } }).getInstance();
  const manager = {
    get revision(): number { return f.revision.current; },
    set revision(value: number) { f.revision.current = value; },
    clearRecentlyDeletedImageIds: vi.spyOn(storage, 'clearRecentlyDeletedImageIds'),
  };
  const setImages = vi.fn(f.bindings.setImages as (...args: unknown[]) => boolean);
  const recentlyDeletedIdsRef = f.deleted;
  recentlyDeletedIdsRef.current.clear(); recentlyDeletedIdsRef.current.add(entityId);
  const imageDeletionGenerationRef = f.deletion;
  imageDeletionGenerationRef.current.set(entityId, 1);
  const loadCanvasImageSize = vi.fn(() => dimensions.promise);
  const bindings: Record<string, unknown> = { ...f.bindings, setImages, loadCanvasImageSize };
  delete bindings.handleAddImages;
  bindings.handleAddImages = actualTransferCallback('handleAddImages', bindings);
  const receive = actualTransferCallback<SingleTransfer>('handleAddEmbeddedChatImage', bindings);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input) !== '/api/assets/transfer' || init?.method !== 'POST') {
      throw new Error('Unexpected history HTTP: ' + String(input));
    }
    expect(JSON.parse(String(init.body))).toMatchObject({ sourceVersion: 'version-1', targetProject: 'project-a',
      entityId: 'canvas-skill:run-1:version-1', idempotencyKey: 'canvas-skill:run-1:version-1' });
    return Response.json(await transfer.promise);
  });
  const restored = { assetId: 'asset-1', assetVersionId: 'version-1', placementId: 'placement-1',
    entityId, url: '/restored.png', projectRevision: 8 };
  return { manager, setImages, receive, transfer, dimensions, restored, loadCanvasImageSize,
    recentlyDeletedIdsRef, imageDeletionGenerationRef, entityId, writes: f.writes };
}

afterEach(() => vi.unstubAllGlobals());
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
    expect(test.writes.at(-1)?.find(image => image.id === test.entityId)).toMatchObject({
      placementId: 'placement-1', assetVersionId: 'version-1', url: '/restored.png',
    });
  });
});
