import { describe, expect, it, vi } from 'vitest';

import {
  CANVAS_PENDING_MEDIA_RECOVERY_KEY,
  CANVAS_PREPARED_SNAPSHOT_KEY,
  consumeCanvasHydrationGuard,
  createCanvasHydrationGuard,
  persistPreparedCanvasUnloadSnapshot,
  shouldConsumeCanvasHydrationGuard,
} from '@/lib/canvas-autosave-guard';

const image = (overrides: Record<string, unknown> = {}) => ({
  id: 'image-1',
  url: '/api/serve-upload/uploads/image-1.png',
  x: 120,
  y: 80,
  width: 256,
  height: 256,
  rotation: 0,
  zIndex: 1,
  ...overrides,
});

describe('canvas autosave hydration guard', () => {
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

  it('writes a recovery marker and skips the beacon while media is pending', () => {
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
    expect(storage.setItem).not.toHaveBeenCalledWith(
      CANVAS_PREPARED_SNAPSHOT_KEY,
      expect.anything(),
    );
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
