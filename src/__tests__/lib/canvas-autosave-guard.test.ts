import { describe, expect, it, vi } from 'vitest';

import {
  CANVAS_PENDING_MEDIA_RECOVERY_KEY,
  CANVAS_PREPARED_SNAPSHOT_KEY,
  clearCanvasUnloadRecovery,
  consumeCanvasPendingMediaRecovery,
  consumePreparedCanvasUnloadSnapshot,
  consumeCanvasHydrationGuard,
  consumeCanvasHydrationGuardQueue,
  createCanvasHydrationGuard,
  enqueueCanvasHydrationGuard,
  persistRecoveredCanvasSnapshot,
  persistPreparedCanvasUnloadSnapshot,
  reconcileRecoveredCanvasImages,
  shouldConsumeCanvasHydrationGuard,
} from '@/lib/canvas-autosave-guard';

const image = (overrides: Record<string, unknown> = {}) => ({
  id: 'image-1',
  url: '/api/serve-upload/uploads/image-1.png',
  x: 120,
  y: 80,
  width: 256,
  height: 256,
  originalWidth: 256,
  originalHeight: 256,
  rotation: 0,
  zIndex: 1,
  createdAt: 1,
  ...overrides,
});

describe('canvas autosave hydration guard', () => {
  it('does not resolve recovered hydration until the authoritative server barrier settles', async () => {
    let releaseFlush!: () => void;
    const flush = new Promise<void>((resolve) => { releaseFlush = resolve; });
    const manager = {
      updateProjectInMemory: vi.fn(),
      flushProjectsToServerWithConflictRecovery: vi.fn(() => flush),
    };
    let settled = false;

    const persistence = persistRecoveredCanvasSnapshot(
      manager,
      'project-1',
      [image({ x: 240, width: 384 })],
      { viewState: { scale: 1, panX: 0, panY: 0 } },
    ).then(() => { settled = true; });

    expect(manager.updateProjectInMemory).toHaveBeenCalledWith('project-1', {
      canvasImages: [expect.objectContaining({ x: 240, width: 384 })],
      metadata: { viewState: { scale: 1, panX: 0, panY: 0 } },
    });
    expect(manager.flushProjectsToServerWithConflictRecovery).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseFlush();
    await persistence;
    expect(settled).toBe(true);
  });

  it('consumes exactly the unchanged project hydration snapshot', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image()])).toBe(true);
    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-2', [image()])).toBe(false);
  });

  it('does not suppress a user mutation made during project hydration', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image({ x: 180 })])).toBe(false);
    expect(shouldConsumeCanvasHydrationGuard(guard, 'project-1', [image(), image({ id: 'image-2' })])).toBe(false);
  });

  it('suppresses an immediate-save snapshot once and then releases the guard', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);
    const first = consumeCanvasHydrationGuard(guard, 'project-1', [image()]);
    const second = consumeCanvasHydrationGuard(first.nextGuard, 'project-1', [image()]);

    expect(first).toEqual({ suppress: true, nextGuard: null });
    expect(second).toEqual({ suppress: false, nextGuard: null });
  });

  it('releases a stale same-project guard without suppressing the mutation', () => {
    const guard = createCanvasHydrationGuard('project-1', [image()]);

    expect(consumeCanvasHydrationGuard(guard, 'project-1', [image({ x: 180 })]))
      .toEqual({ suppress: false, nextGuard: null });
  });

  it('retains later immediate-save guards while earlier React effects drain', () => {
    const moved = [image({ x: 180 })];
    const resized = [image({ x: 180, width: 320, height: 320 })];
    let guards = enqueueCanvasHydrationGuard([], 'project-1', moved);
    guards = enqueueCanvasHydrationGuard(guards, 'project-1', resized);

    const movedEffect = consumeCanvasHydrationGuardQueue(guards, 'project-1', moved);
    expect(movedEffect.suppress).toBe(true);
    expect(movedEffect.nextGuards).toHaveLength(1);

    const resizedEffect = consumeCanvasHydrationGuardQueue(
      movedEffect.nextGuards,
      'project-1',
      resized,
    );
    expect(resizedEffect).toEqual({ suppress: true, nextGuards: [] });
  });

  it('consumes superseded immediate-save guards when React batches to the latest state', () => {
    const moved = [image({ x: 180 })];
    const resized = [image({ x: 180, width: 320, height: 320 })];
    const guards = enqueueCanvasHydrationGuard(
      enqueueCanvasHydrationGuard([], 'project-1', moved),
      'project-1',
      resized,
    );

    expect(consumeCanvasHydrationGuardQueue(guards, 'project-1', resized))
      .toEqual({ suppress: true, nextGuards: [] });
  });

  it('consumes through the newest repeated signature when React batches an undo-redo cycle', () => {
    const original = [image()];
    const moved = [image({ x: 180 })];
    let guards = enqueueCanvasHydrationGuard([], 'project-1', original);
    guards = enqueueCanvasHydrationGuard(guards, 'project-2', [image({ id: 'other' })]);
    guards = enqueueCanvasHydrationGuard(guards, 'project-1', moved);
    guards = enqueueCanvasHydrationGuard(guards, 'project-1', original);

    const result = consumeCanvasHydrationGuardQueue(guards, 'project-1', original);

    expect(result.suppress).toBe(true);
    expect(result.nextGuards).toEqual([
      createCanvasHydrationGuard('project-2', [image({ id: 'other' })]),
    ]);
  });

  it('clears stale same-project guards without suppressing a real mutation', () => {
    let guards = enqueueCanvasHydrationGuard([], 'project-1', [image()]);
    guards = enqueueCanvasHydrationGuard(guards, 'project-2', [image({ id: 'other' })]);

    expect(consumeCanvasHydrationGuardQueue(guards, 'project-1', [image({ x: 999 })]))
      .toEqual({
        suppress: false,
        nextGuards: [createCanvasHydrationGuard('project-2', [image({ id: 'other' })])],
      });
  });

  it('bounds queued immediate-save guards to the newest 32 snapshots', () => {
    let guards = [] as ReturnType<typeof enqueueCanvasHydrationGuard>;
    for (let x = 0; x < 40; x += 1) {
      guards = enqueueCanvasHydrationGuard(guards, 'project-1', [image({ x })]);
    }

    expect(guards).toHaveLength(32);
    expect(consumeCanvasHydrationGuardQueue(guards, 'project-1', [image({ x: 7 })]).suppress)
      .toBe(false);
    expect(consumeCanvasHydrationGuardQueue(guards, 'project-1', [image({ x: 8 })]).suppress)
      .toBe(true);
  });

  it('stores only the prepared payload and sends its prebuilt beacon body', () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    const sendBeacon = vi.fn(() => true);

    persistPreparedCanvasUnloadSnapshot({
      projectId: 'project-1',
      revision: 4,
      signature: 'signature-4',
      serialized: '{"prepared":true}',
      recoveryMarker: '{"pending":false}',
      hasPendingMedia: false,
      beaconPayload: '{"key":"projects"}',
      beaconByteLength: 18,
    }, { storage, sendBeacon });

    expect(storage.setItem).toHaveBeenCalledWith(
      CANVAS_PREPARED_SNAPSHOT_KEY,
      '{"prepared":true}',
    );
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
    expect(sendBeacon).toHaveBeenCalledWith('/api/user-data/sync', '{"key":"projects"}');
  });

  it('still sends the prepared beacon when local recovery storage is full', () => {
    const quotaError = new DOMException('storage full', 'QuotaExceededError');
    const storage = {
      setItem: vi.fn(() => { throw quotaError; }),
      removeItem: vi.fn(),
    };
    const sendBeacon = vi.fn(() => true);

    expect(() => persistPreparedCanvasUnloadSnapshot({
      projectId: 'project-1',
      revision: 4,
      signature: 'signature-4',
      serialized: '{"prepared":true}',
      recoveryMarker: '{"pending":false}',
      hasPendingMedia: false,
      beaconPayload: '{"key":"projects"}',
      beaconByteLength: 18,
    }, { storage, sendBeacon })).not.toThrow();

    expect(sendBeacon).toHaveBeenCalledWith('/api/user-data/sync', '{"key":"projects"}');
  });

  it('reports failure when neither local recovery storage nor the beacon accepts a snapshot', () => {
    const quotaError = new DOMException('storage full', 'QuotaExceededError');
    const storage = {
      setItem: vi.fn(() => { throw quotaError; }),
      removeItem: vi.fn(),
    };

    expect(() => persistPreparedCanvasUnloadSnapshot({
      projectId: 'project-1',
      revision: 4,
      signature: 'signature-4',
      serialized: '{"prepared":true}',
      recoveryMarker: '{"pending":false}',
      hasPendingMedia: false,
      beaconPayload: '{"key":"projects"}',
      beaconByteLength: 18,
    }, { storage, sendBeacon: () => false })).toThrow('storage full');
  });

  it('keeps the prepared recovery payload and skips the beacon while media is pending', () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    const sendBeacon = vi.fn(() => true);

    persistPreparedCanvasUnloadSnapshot({
      projectId: 'project-1',
      revision: 5,
      signature: 'signature-5',
      serialized: '{"prepared":true}',
      recoveryMarker: '{"pending":true}',
      hasPendingMedia: true,
    }, { storage, sendBeacon });

    expect(storage.setItem).toHaveBeenCalledWith(
      CANVAS_PENDING_MEDIA_RECOVERY_KEY,
      '{"pending":true}',
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      CANVAS_PREPARED_SNAPSHOT_KEY,
      '{"prepared":true}',
    );
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('clears both unload recovery records at an authentication boundary', () => {
    const storage = { removeItem: vi.fn() };

    expect(clearCanvasUnloadRecovery).toBeTypeOf('function');
    clearCanvasUnloadRecovery?.(storage);

    expect(storage.removeItem.mock.calls).toEqual([
      [CANVAS_PREPARED_SNAPSHOT_KEY],
      [CANVAS_PENDING_MEDIA_RECOVERY_KEY],
    ]);
  });

  it('consumes a pending-media marker only for its owning user and project', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 2,
        ownerId: 'user-a',
        projectId: 'project-1',
        baseProjectRevision: 7,
        hasPendingMedia: true,
      })),
      removeItem: vi.fn(),
    };

    expect(consumeCanvasPendingMediaRecovery('project-1', storage, 'user-a')).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PENDING_MEDIA_RECOVERY_KEY);
  });

  it('keeps recoverable data URLs and replaces invalid blob URLs with server media', () => {
    const saved = [image({ id: 'saved', url: '/api/serve-upload/uploads/saved.png', x: 24, width: 128 })];
    const recovered = [
      image({ id: 'data', url: 'data:image/png;base64,AAAA' }),
      image({ id: 'saved', url: 'blob:https://example.test/replaced', x: 480, width: 384 }),
      image({ id: 'lost', url: 'blob:https://example.test/lost' }),
    ];

    expect(reconcileRecoveredCanvasImages(recovered, saved)).toEqual({
      images: [
        expect.objectContaining({ id: 'data', url: 'data:image/png;base64,AAAA' }),
        expect.objectContaining({
          id: 'saved',
          url: '/api/serve-upload/uploads/saved.png',
          x: 480,
          width: 384,
        }),
      ],
      discardedBlobIds: ['lost'],
    });
  });

  it('rejects an unowned legacy snapshot at a user boundary', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 2,
        preparedAt: 200,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240 })],
          metadata: {},
        },
      })),
      removeItem: vi.fn(),
    };

    expect(consumePreparedCanvasUnloadSnapshot('project-1', 7, storage, 'user-b')).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });

  it('rejects a prepared snapshot based on an older server project revision', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 3,
        ownerId: 'user-a',
        baseProjectRevision: 7,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240 })],
          metadata: {},
        },
      })),
      removeItem: vi.fn(),
    };

    expect(consumePreparedCanvasUnloadSnapshot('project-1', 8, storage, 'user-a')).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });

  it('consumes an owned snapshot only at its exact server project revision', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 3,
        ownerId: 'user-a',
        baseProjectRevision: 7,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240 })],
          metadata: {},
        },
      })),
      removeItem: vi.fn(),
    };
    expect(consumePreparedCanvasUnloadSnapshot('project-1', 7, storage, 'user-a')).toEqual(expect.objectContaining({
      projectId: 'project-1',
      images: [expect.objectContaining({ x: 240 })],
    }));
  });

  it('recovers a version 4 unload snapshot after the known one-revision save race', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 4,
        ownerId: 'user-a',
        baseProjectRevision: 7,
        maxRecoverableProjectRevision: 8,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240, width: 384 })],
          metadata: {},
        },
      })),
      removeItem: vi.fn(),
    };

    expect(consumePreparedCanvasUnloadSnapshot('project-1', 8, storage, 'user-a')).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        images: [expect.objectContaining({ x: 240, width: 384 })],
      }),
    );
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });

  it('rejects a version 4 unload snapshot beyond its explicit revision window', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 4,
        ownerId: 'user-a',
        baseProjectRevision: 7,
        maxRecoverableProjectRevision: 8,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240 })],
          metadata: {},
        },
      })),
      removeItem: vi.fn(),
    };

    expect(consumePreparedCanvasUnloadSnapshot('project-1', 9, storage, 'user-a')).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });

  it('consumes a newer prepared unload snapshot for the matching project', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        version: 3,
        ownerId: 'user-a',
        baseProjectRevision: 7,
        snapshot: {
          ownerId: 'user-a',
          projectId: 'project-1',
          baseProjectRevision: 7,
          revision: 9,
          images: [image({ x: 240 })],
          metadata: { viewState: { scale: 1, panX: 0, panY: 0 } },
        },
      })),
      removeItem: vi.fn(),
    };

    expect(consumePreparedCanvasUnloadSnapshot('project-1', 7, storage, 'user-a')).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        images: [expect.objectContaining({ x: 240 })],
      }),
    );
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });

  it('rejects stale or foreign prepared unload snapshots without cross-project recovery', () => {
    const foreign = JSON.stringify({
      version: 3,
      ownerId: 'user-a',
      baseProjectRevision: 7,
      snapshot: { ownerId: 'user-a', projectId: 'project-2', baseProjectRevision: 7, revision: 1, images: [], metadata: {} },
    });
    const storage = { getItem: vi.fn(() => foreign), removeItem: vi.fn() };
    expect(consumePreparedCanvasUnloadSnapshot('project-1', 7, storage, 'user-a')).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();

    storage.getItem.mockReturnValue(JSON.stringify({
      version: 3,
      ownerId: 'user-a',
      baseProjectRevision: 6,
      snapshot: { ownerId: 'user-a', projectId: 'project-1', baseProjectRevision: 6, revision: 1, images: [], metadata: {} },
    }));
    expect(consumePreparedCanvasUnloadSnapshot('project-1', 7, storage, 'user-a')).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(CANVAS_PREPARED_SNAPSHOT_KEY);
  });
});
