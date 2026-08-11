import { describe, expect, it } from 'vitest';
import {
  createPendingWorkflowInputReference,
  createWorkflowInputTransferGuard,
  runGuardedWorkflowInputTransfer,
  shouldInvalidateWorkflowInputTransfer,
} from '@/lib/asset-core/workspace-transfer';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

describe('workflow input asset transfer race', () => {
  it('invalidates pending work for every URL replacement or clear operation', () => {
    expect(shouldInvalidateWorkflowInputTransfer('/old.png', { imageUrl: '/new.png' })).toBe(true);
    expect(shouldInvalidateWorkflowInputTransfer('/old.png', { imageUrl: '' })).toBe(true);
    expect(shouldInvalidateWorkflowInputTransfer('/old.png', { imageUrl: undefined })).toBe(true);
    expect(shouldInvalidateWorkflowInputTransfer('/old.png', { imageUrl: '/old.png' })).toBe(false);
    expect(shouldInvalidateWorkflowInputTransfer('/old.png', { label: 'unchanged image' })).toBe(false);
  });

  it('keeps the pending node URL-only and ignores a response after a manual replacement', async () => {
    const image = {
      id: 'canvas-image-a',
      url: '/canvas-a.png',
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'canvas-placement-a',
    };
    let nodeConfig: object = createPendingWorkflowInputReference(image);
    expect(nodeConfig).toEqual(expect.objectContaining({
      imageUrl: '/canvas-a.png',
      assetTransferPending: true,
    }));
    expect(nodeConfig).not.toHaveProperty('assetVersionId');
    expect(nodeConfig).not.toHaveProperty('placementId');

    const guard = createWorkflowInputTransferGuard();
    const token = guard.begin('input-node');
    const response = deferred<WorkspaceAssetReference>();
    const transfer = runGuardedWorkflowInputTransfer({
      guard,
      token,
      transfer: () => response.promise,
      onSuccess: reference => {
        nodeConfig = {
          imageUrl: reference.url,
          assetVersionId: reference.assetVersionId,
          placementId: reference.placementId,
        };
      },
    });

    nodeConfig = { imageUrl: '/manual-replacement.png' };
    guard.invalidate('input-node');
    response.resolve({
      url: '/old-canonical.png',
      assetVersionId: 'version-a',
      placementId: 'workflow-placement-a',
    });

    await expect(transfer).resolves.toBe('stale');
    expect(nodeConfig).toEqual({ imageUrl: '/manual-replacement.png' });
  });

  it('allows a newer selection to apply while a late older response stays stale', async () => {
    const guard = createWorkflowInputTransferGuard();
    let applied: WorkspaceAssetReference | undefined;
    const oldResponse = deferred<WorkspaceAssetReference>();
    const oldToken = guard.begin('input-node');
    const oldTransfer = runGuardedWorkflowInputTransfer({
      guard,
      token: oldToken,
      transfer: () => oldResponse.promise,
      onSuccess: reference => { applied = reference; },
    });

    const newToken = guard.begin('input-node');
    await expect(runGuardedWorkflowInputTransfer({
      guard,
      token: newToken,
      transfer: async () => ({
        url: '/new-canonical.png',
        assetVersionId: 'version-b',
        placementId: 'workflow-placement-b',
      }),
      onSuccess: reference => { applied = reference; },
    })).resolves.toBe('applied');

    oldResponse.resolve({
      url: '/old-canonical.png',
      assetVersionId: 'version-a',
      placementId: 'workflow-placement-a',
    });
    await expect(oldTransfer).resolves.toBe('stale');
    expect(applied).toEqual(expect.objectContaining({
      assetVersionId: 'version-b',
      placementId: 'workflow-placement-b',
    }));
  });
});
