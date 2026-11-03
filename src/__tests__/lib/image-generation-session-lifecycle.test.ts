// @vitest-environment node
// AE direct-session proposal: exactly two cases, not executed by this worker.
// Controller integrates into src/__tests__/lib/image-generation-session-lifecycle.test.ts
// and observes the shared-map/disposed boundary before any production release.
// The no-run/no-fix scope is the controller's worker boundary for guard serialization.

import { afterEach, describe, expect, it } from 'vitest';

import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';
import {
  createImageGenerationSession,
  type ImageGenerationSession,
  type ImageGenerationSessionDependencies,
  type ImageGenerationSlot,
  type ImageGenerationTaskUpdate,
  type RestoredImageGenerationTask,
} from '@/lib/image-generation-session';

const ownedSessions: ImageGenerationSession[] = [];
const ownedSubscriptions: Array<() => void> = [];
const ownedDeferreds: Array<{ finish(): void; settled: Promise<void> }> = [];
const ownedOperations: Promise<void>[] = [];

afterEach(async (): Promise<void> => {
  ownedSubscriptions.splice(0).forEach((unsubscribe: () => void): void => unsubscribe());
  ownedSessions.splice(0).forEach((session: ImageGenerationSession): void => session.dispose());
  const deferreds = ownedDeferreds.splice(0);
  deferreds.forEach((pending): void => pending.finish());
  await Promise.all([
    ...deferreds.map((pending): Promise<void> => pending.settled),
    ...ownedOperations.splice(0),
  ]);
});

describe('ImageGenerationSession bounded restore ownership (AE proposal)', (): void => {
  // Break: a late p1 restore replaces p2 slots or clears/rebinds the live task map.
  it('retains p2 snapshot event mapping and cancellation identity after an older p1 restore resolves', async (): Promise<void> => {
    let resolveP1!: (tasks: RestoredImageGenerationTask[]) => void;
    const p1Reply = new Promise<RestoredImageGenerationTask[]>((resolve): void => {
      resolveP1 = resolve;
    });
    ownedDeferreds.push({
      finish: (): void => resolveP1([]),
      settled: p1Reply.then((): void => undefined, (): void => undefined),
    });
    const eventListeners = new Set<(update: ImageGenerationTaskUpdate) => void>();
    const restoreProjects: string[] = [];
    const cancellations: string[] = [];
    const publications: ImageGenerationSlot[][] = [];
    const ports: ImageGenerationSessionDependencies = {
      submit: async (): Promise<never> => { throw new Error('AE direct restore cases do not admit generation'); },
      restoreTasks: async (projectId: string): Promise<RestoredImageGenerationTask[]> => {
        restoreProjects.push(projectId);
        if (projectId === 'p1') return p1Reply;
        if (projectId === 'p2') return [{
          id: 'p2-current-slot', taskId: 'p2-current-task', projectId: 'p2', status: 'processing', progress: 20,
          result: { imageUrls: ['/__ae_session__/p2.png'], assetProjection: { references: [{
            url: '/__ae_session__/p2.png', assetVersionId: 'p2-current-v', placementId: 'p2-current-pl',
          }] } },
        }];
        throw new Error(`Unexpected AE restore project: ${projectId}`);
      },
      subscribeTaskEvents: (listener: (update: ImageGenerationTaskUpdate) => void): (() => void) => {
        eventListeners.add(listener);
        return (): void => { eventListeners.delete(listener); };
      },
      isTaskEventsConnected: (): boolean => true,
      cancelTask: async (taskId: string): Promise<{ success: boolean }> => {
        cancellations.push(taskId);
        return { success: true };
      },
      extractAssetReferences: extractTaskAssetReferences,
      // Optional pollTask is absent: no scheduler or poll timer is installed.
    };
    const session = createImageGenerationSession(ports);
    ownedSessions.push(session);
    ownedSubscriptions.push(session.subscribe((slots: ImageGenerationSlot[]): void => { publications.push(slots); }));

    const olderRestore = session.restore('p1');
    ownedOperations.push(olderRestore.then((): void => undefined, (): void => undefined));
    expect(restoreProjects).toEqual(['p1']);
    expect(session.snapshot()).toEqual([]);
    const currentRestore = session.restore('p2');
    ownedOperations.push(currentRestore.then((): void => undefined, (): void => undefined));
    await currentRestore;

    // Independent literals: neither the real snapshot nor restore return builds expectations.
    const current20: ImageGenerationSlot[] = [{
      id: 'p2-current-slot', taskId: 'p2-current-task', projectId: 'p2', status: 'processing', progress: 20,
      url: '/__ae_session__/p2.png', assetVersionId: 'p2-current-v', placementId: 'p2-current-pl',
    }];
    const current65: ImageGenerationSlot[] = [{
      id: 'p2-current-slot', taskId: 'p2-current-task', projectId: 'p2', status: 'processing', progress: 65,
      url: '/__ae_session__/p2.png', assetVersionId: 'p2-current-v', placementId: 'p2-current-pl',
    }];
    const currentCancelled: ImageGenerationSlot[] = [{
      id: 'p2-current-slot', taskId: 'p2-current-task', projectId: 'p2', status: 'cancelled', progress: 65,
      url: '/__ae_session__/p2.png', assetVersionId: 'p2-current-v', placementId: 'p2-current-pl',
    }];
    expect(session.snapshot()).toEqual(current20);
    expect(publications.at(-1)).toEqual(current20);
    expect(cancellations).toEqual([]);

    resolveP1([{
      id: 'p1-obsolete-slot', taskId: 'p1-obsolete-task', projectId: 'p1', status: 'processing', progress: 7,
      result: { imageUrls: ['/__ae_session__/p1.png'], assetProjection: { references: [{
        url: '/__ae_session__/p1.png', assetVersionId: 'p1-obsolete-v', placementId: 'p1-obsolete-pl',
      }] } },
    }]);
    await olderRestore;
    // Soft state checkpoints let the independent event and cancel consumers run
    // even if the obsolete restore has already corrupted the current snapshot.
    expect.soft(session.snapshot()).toEqual(current20);
    expect.soft(publications.flat().map((slot: ImageGenerationSlot): string => slot.projectId)).not.toContain('p1');
    expect.soft(cancellations).toEqual([]);

    eventListeners.forEach((listener: (update: ImageGenerationTaskUpdate) => void): void => {
      listener({ taskId: 'p2-current-task', projectId: 'p2', status: 'processing', progress: 65 });
    });
    expect.soft(session.snapshot()).toEqual(current65);
    expect.soft(publications.at(-1)).toEqual(current65);
    expect.soft(cancellations).toEqual([]);

    const cancelled = await session.cancel('p2-current-slot');
    expect.soft(cancelled).toBe(true);
    expect.soft(cancellations).toEqual(['p2-current-task']);
    expect.soft(session.snapshot()).toEqual(currentCancelled);
    expect.soft(publications.at(-1)).toEqual(currentCancelled);

    eventListeners.forEach((listener: (update: ImageGenerationTaskUpdate) => void): void => {
      listener({ taskId: 'p1-obsolete-task', projectId: 'p1', status: 'processing', progress: 88 });
    });
    expect.soft(session.snapshot()).toEqual(currentCancelled);
    expect.soft(publications.flat().map((slot: ImageGenerationSlot): string => slot.projectId)).not.toContain('p1');
    expect.soft(cancellations).toEqual(['p2-current-task']);
    expect(restoreProjects).toEqual(['p1', 'p2']);
  });

  // Break: publish() stops after disposal but a pending restore still mutates slots/maps.
  it('preserves the exact disposed snapshot when an already pending restore and queued event arrive', async (): Promise<void> => {
    let resolvePending!: (tasks: RestoredImageGenerationTask[]) => void;
    const pendingReply = new Promise<RestoredImageGenerationTask[]>((resolve): void => {
      resolvePending = resolve;
    });
    ownedDeferreds.push({
      finish: (): void => resolvePending([]),
      settled: pendingReply.then((): void => undefined, (): void => undefined),
    });
    const eventListeners = new Set<(update: ImageGenerationTaskUpdate) => void>();
    const restoreProjects: string[] = [];
    const cancellations: string[] = [];
    const publications: ImageGenerationSlot[][] = [];
    const ports: ImageGenerationSessionDependencies = {
      submit: async (): Promise<never> => { throw new Error('AE direct restore cases do not admit generation'); },
      restoreTasks: async (projectId: string): Promise<RestoredImageGenerationTask[]> => {
        restoreProjects.push(projectId);
        if (projectId === 'p1') return pendingReply;
        if (projectId === 'p2') return [{
          id: 'disposed-current-slot', taskId: 'disposed-current-task', projectId: 'p2', status: 'processing', progress: 30,
          result: { imageUrls: ['/__ae_session__/disposed-current.png'], assetProjection: { references: [{
            url: '/__ae_session__/disposed-current.png', assetVersionId: 'disposed-current-v', placementId: 'disposed-current-pl',
          }] } },
        }];
        throw new Error(`Unexpected AE restore project: ${projectId}`);
      },
      subscribeTaskEvents: (listener: (update: ImageGenerationTaskUpdate) => void): (() => void) => {
        eventListeners.add(listener);
        return (): void => { eventListeners.delete(listener); };
      },
      isTaskEventsConnected: (): boolean => true,
      cancelTask: async (taskId: string): Promise<{ success: boolean }> => {
        cancellations.push(taskId);
        return { success: true };
      },
      extractAssetReferences: extractTaskAssetReferences,
      // No pollTask, timer, browser, server, submit/retry transport, or DB is used.
    };
    const session = createImageGenerationSession(ports);
    ownedSessions.push(session);
    ownedSubscriptions.push(session.subscribe((slots: ImageGenerationSlot[]): void => { publications.push(slots); }));
    const seedRestore = session.restore('p2');
    ownedOperations.push(seedRestore.then((): void => undefined, (): void => undefined));
    await seedRestore;
    const disposedSnapshot: ImageGenerationSlot[] = [{
      id: 'disposed-current-slot', taskId: 'disposed-current-task', projectId: 'p2', status: 'processing', progress: 30,
      url: '/__ae_session__/disposed-current.png', assetVersionId: 'disposed-current-v', placementId: 'disposed-current-pl',
    }];
    expect(session.snapshot()).toEqual(disposedSnapshot);
    expect(publications).toEqual([disposedSnapshot]);

    const pendingRestore = session.restore('p1');
    ownedOperations.push(pendingRestore.then((): void => undefined, (): void => undefined));
    expect(restoreProjects).toEqual(['p2', 'p1']);
    const queuedEvent = [...eventListeners][0];
    if (!queuedEvent) throw new Error('AE fixture did not capture the real task event consumer');
    // Dispose the actual owning session, not the subscriber and not a fake method.
    session.dispose();
    expect(session.snapshot()).toEqual(disposedSnapshot);
    expect(publications).toEqual([disposedSnapshot]);
    expect(cancellations).toEqual([]);

    resolvePending([{
      id: 'disposed-late-slot', taskId: 'disposed-late-task', projectId: 'p1', status: 'processing', progress: 90,
      result: { imageUrls: ['/__ae_session__/disposed-late.png'], assetProjection: { references: [{
        url: '/__ae_session__/disposed-late.png', assetVersionId: 'disposed-late-v', placementId: 'disposed-late-pl',
      }] } },
    }]);
    await pendingRestore;
    expect.soft(session.snapshot()).toEqual(disposedSnapshot);
    expect.soft(publications).toEqual([disposedSnapshot]);
    expect.soft(cancellations).toEqual([]);

    // This captured real callback models delivery queued before owner disposal.
    queuedEvent({ taskId: 'disposed-current-task', projectId: 'p2', status: 'processing', progress: 75 });
    expect.soft(session.snapshot()).toEqual(disposedSnapshot);
    expect.soft(publications).toEqual([disposedSnapshot]);
    expect.soft(cancellations).toEqual([]);
  });
});
