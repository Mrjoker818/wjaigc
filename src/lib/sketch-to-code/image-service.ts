import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PersistedCloudTask } from '@/lib/cloud-task-storage';
import { prepareSketchImage, type SketchImageGenerationDependencies } from './image-generation';
import { recoverSketchImageTask, type SketchImageWorkerDependencies, type SketchImageWorkerOutcome } from './image-worker';
import { createConfiguredSketchImageDependencies } from './configured-image-dependencies';
import { publishSketchImageTask } from './image-publication';
import { readSketchImageTaskIdentity } from './image-task-state';
import { readSketchImageCheckpoint } from './image-execution';
import { sketchFields } from './http';
import { runSketchStage } from './stage';

export interface ConfiguredSketchImageService {
  readonly generation: SketchImageGenerationDependencies;
  workerDependencies(): Readonly<SketchImageWorkerDependencies>;
}
export function createConfiguredSketchImageService(requestId: string): ConfiguredSketchImageService {
  const configured = createConfiguredSketchImageDependencies({ requestId });
  const generation = configured.generation, routing = configured.routing.bind(configured);
  const checkCurrent = configured.checkCurrent.bind(configured), query = configured.query.bind(configured);
  return Object.freeze({ generation, workerDependencies: (): Readonly<SketchImageWorkerDependencies> =>
    Object.freeze({ routing: routing(), checkCurrent, query, publisher: publishSketchImageTask }) });
}
/** Recovery binds the same two currently authorized models only to consume an
 * original accepted receipt. It never restores or calls a paid compute closure. */
export async function recoverConfiguredSketchImageTask(candidate: PersistedCloudTask, requestId: string): Promise<SketchImageWorkerOutcome> {
  try {
    const fields = sketchFields(candidate), identity = readSketchImageTaskIdentity(candidate);
    if (fields.status !== 'processing') return { status: 'skipped', reason: 'SKETCH_IMAGE_TASK_NOT_EXECUTABLE' };
    const checkpoint = readSketchImageCheckpoint(sketchFields(fields.result).sketchImageExecution, identity);
    if (checkpoint?.phase !== 'accepted') return { status: 'deferred', reason: 'SKETCH_IMAGE_RECEIPT_UNCONFIRMED' };
    if (typeof fields.leaseExpiresAt !== 'number' || !Number.isSafeInteger(fields.leaseExpiresAt) || fields.leaseExpiresAt < 0
      || typeof fields.attemptCount !== 'number' || !Number.isSafeInteger(fields.attemptCount) || fields.attemptCount < 1) throw new Error();
    if (fields.leaseExpiresAt > Date.now()) return { status: 'skipped', reason: 'SKETCH_IMAGE_LEASE_ACTIVE' };
    const service = createConfiguredSketchImageService(requestId);
    const prepared = await runSketchStage(signal => prepareSketchImage(identity.input, service.generation,
      { actorUserId: identity.actorUserId, signal }), new AbortController().signal, 30_000);
    if (!isDeepStrictEqual(prepared.input, identity.input) || !isDeepStrictEqual(prepared.access, identity.access)
      || !isDeepStrictEqual(prepared.visionBinding, { providerId: identity.input.visionProviderId, modelId: identity.input.visionModelId })
      || !isDeepStrictEqual(prepared.imageBinding, { providerId: identity.input.imageProviderId, modelId: identity.input.imageModelId })) throw new Error();
    const dependencies = service.workerDependencies();
    if (!isDeepStrictEqual(dependencies.routing, checkpoint.routing)) throw new Error();
    return await recoverSketchImageTask(identity.taskId, identity, dependencies);
  } catch { return { status: 'deferred', reason: 'SKETCH_IMAGE_RECOVERY_UNCONFIRMED' }; }
}
