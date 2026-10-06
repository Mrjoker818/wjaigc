import 'server-only';
import { randomUUID } from 'node:crypto';
import { getCloudTaskForUser, claimCloudTaskLease, releaseCloudTaskLease, completeCloudTask, updateCloudTask, terminateCloudTaskAndRefund, type CloudTask } from '@/lib/cloud-task-storage';
import { findProviderById } from '@/lib/server-api-config';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { submitUniversalGeneration, pollUniversalGeneration, buildUniversalImages, getTransparentResultMetadata, UniversalProviderFailure,
  type UniversalProviderRequest, type UniversalProviderTarget, type UniversalCheckpoint } from './universal-generation-provider';
import type { CanvasTaskPublicationInput } from '@/lib/collaboration/task-publication';
import { validateCanvasUniversalReplay, validateCanvasUniversalSources, CanvasUniversalAdmissionError } from '@/lib/collaboration/canvas-universal-generation-admission';
import { createTaskAbortScope } from './task-abort';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { loadSafeImageInput, SafeImageInputError } from '@/lib/safe-image-input';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';

export interface UniversalGenerationDescriptor {
  version: 1; route: '/api/universal-generate'; requestDigest: string; providerId: string;
  request: UniversalProviderRequest; target: UniversalProviderTarget; publication: CanvasTaskPublicationInput;
}
class ExecutionLost extends Error {}
function isDefiniteSourceFailure(error: unknown): boolean {
  // The reader also uses this class for unavailable storage. Only confirmed byte
  // validation failures are terminal; an unreadable/missing mount stays retryable.
  if (!(error instanceof SafeImageInputError)) return false;
  if (error.message === 'Image cannot be decoded safely') {
    // That wrapper can also contain resource/abort failures: recognize only
    // decoder input diagnostics, not arbitrary native or infrastructure errors.
    return error.cause instanceof Error && !('code' in error.cause)
      && /^Input (?:buffer (?:has corrupt header|contains unsupported image format)|image exceeds pixel limit)/.test(error.cause.message);
  }
  return [
    'Managed image exceeds the size limit', 'Managed file is not a supported image',
    'Image format validation failed',
    'Image pixel dimensions exceed the safe pixel limit',
    'BMP header is invalid', 'BMP file bounds are invalid', 'BMP core header is truncated',
    'BMP DIB header is unsupported', 'BMP dimensions are invalid',
  ].includes(error.message);
}
function descriptorFor(task: CloudTask): UniversalGenerationDescriptor {
  const value = task.result?.universalGeneration as UniversalGenerationDescriptor | undefined;
  if (!value || value.version !== 1 || value.route !== '/api/universal-generate' || value.requestDigest !== task.requestDigest
    || value.providerId !== task.providerId || value.request?.model !== task.model || typeof value.request.prompt !== 'string'
    || !Number.isSafeInteger(value.request.n) || value.request.n < 1 || !value.target?.baseUrl || !value.target.profile
    || value.publication?.singleAdmission !== 'universal-generate' || value.publication.access.actorUserId !== task.userId
    || value.publication.access.projectId !== task.projectId) throw new CanvasUniversalAdmissionError(409, 'UNIVERSAL_DESCRIPTOR_INVALID');
  return value;
}
function checkpointFor(task: CloudTask): UniversalCheckpoint | undefined {
  const value = task.result?.universalCheckpoint as UniversalCheckpoint | undefined;
  if (value === undefined) return undefined;
  const strings = (input: unknown): input is string[] => Array.isArray(input) && input.every(item => typeof item === 'string' && !!item);
  if (value.kind === 'direct' && strings(value.urls) && value.urls.length) return value;
  if (value.kind === 'remote' && strings(value.taskIds) && value.taskIds.length && Array.isArray(value.outputs)
    && value.outputs.length <= value.taskIds.length && value.outputs.every(strings)) return value;
  throw new CanvasUniversalAdmissionError(409, 'UNIVERSAL_CHECKPOINT_INVALID');
}
export function universalTaskResponse(task: CloudTask): Record<string, unknown> {
  const result = task.result || {};
  const common = { taskId: task.id, idempotencyKey: task.idempotencyKey, status: task.status };
  if (task.status === 'completed') return { ...common, success: true, images: result.images,
    imageUrl: result.imageUrl, imageUrls: result.imageUrls, assetProjection: result.assetProjection,
    alphaVerification: result.alphaVerification, warning: result.warning, nextAction: result.nextAction };
  if (['failed', 'cancelled', 'timeout'].includes(task.status)) return { ...common, success: false, error: task.error || '生成未完成' };
  if (result.universalDiagnostic === 'UNIVERSAL_SUBMISSION_UNCERTAIN') return { ...common, success: false, mode: 'polling', taskIds: [task.id],
    code: 'UNIVERSAL_SUBMISSION_UNCERTAIN', error: '供应商提交结果尚未确认，请核对原任务或取消，勿重复生成', requiresReconciliation: true, retryable: false };
  return { ...common, success: true, mode: 'polling', taskIds: [task.id], progress: task.progress };
}
export async function executeUniversalGenerationTask(input: { taskId: string; actorUserId: string; origin: string }): Promise<void> {
  let task = await getCloudTaskForUser(input.taskId, input.actorUserId);
  if (!task || task.type !== 'universal-generate' || ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) return;
  const owner = `universal-${randomUUID()}`;
  if (!await claimCloudTaskLease(task.id, owner, 660000)) return;
  const scope = createTaskAbortScope(task.id, { timeoutMs: 600000 });
  const deadlineAt = Date.now() + 600000;
  let started = false; let checkpoint: UniversalCheckpoint | undefined;
  const fence = async (): Promise<void> => {
    scope.signal.throwIfAborted();
    const current = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!current || current.type !== 'universal-generate' || current.status !== 'processing' || current.leaseOwner !== owner || !current.leaseExpiresAt || current.leaseExpiresAt < Date.now()) throw new ExecutionLost();
  };
  const persist = async (result: Record<string, unknown>, progress: number): Promise<void> => {
    await fence();
    if (!await updateCloudTask(input.taskId, { result, mergeResult: true, progress, leaseOwner: owner })) throw new ExecutionLost();
    updateTaskProgress(input.taskId, { status: 'processing', progress });
  };
  try {
    task = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!task || task.type !== 'universal-generate' || task.leaseOwner !== owner || task.status !== 'processing') return;
    started = task.result?.submissionPhase === 'started';
    const descriptor = descriptorFor(task);
    checkpoint = checkpointFor(task);
    registerTask(task.id, 'universal-generate', '生成图片', input.actorUserId);
    if (started && !checkpoint) {
      await persist({ universalDiagnostic: 'UNIVERSAL_SUBMISSION_UNCERTAIN' }, task.progress); return;
    }
    const provider = checkpoint?.kind === 'direct' ? null : await findProviderById(descriptor.providerId);
    if (!provider?.apiKey && checkpoint?.kind !== 'direct') return;
    const onCheckpoint = async (value: UniversalCheckpoint): Promise<void> => {
      await persist({ universalCheckpoint: value }, 50); checkpoint = structuredClone(value);
    };
    if (!checkpoint) {
      await validateCanvasUniversalReplay(descriptor.publication, { type: 'universal-generate', idempotencyKey: task.idempotencyKey!, requestDigest: task.requestDigest! }, task.id);
      const urls = await validateCanvasUniversalSources(descriptor.publication, { referenceImageUrl: descriptor.request.referenceImageUrl }, input.origin);
      const request = { ...descriptor.request };
      if (urls.length) {
        await fence();
        const image = await loadSafeImageInput(urls[0], { signal: scope.signal });
        request.referenceImageUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
      }
      await persist({ submissionPhase: 'started' }, 10); started = true;
      await onCheckpoint(await submitUniversalGeneration({ request, target: descriptor.target, apiKey: provider!.apiKey,
        signal: scope.signal, idempotencyKey: task.idempotencyKey!, beforeIO: fence }));
    }
    if (!checkpoint) return;
    const rawUrls = checkpoint.kind === 'direct' ? checkpoint.urls : await pollUniversalGeneration({ checkpoint,
      target: descriptor.target, apiKey: provider!.apiKey, signal: scope.signal, beforeIO: fence, onCheckpoint });
    const urls: string[] = [];
    const imageInputs: Array<Buffer | string> = [];
    for (const url of rawUrls) {
      await fence();
      let decoded: Awaited<ReturnType<typeof loadSafeImageInput>>;
      try { decoded = await loadSafeImageInput(url, { signal: scope.signal }); }
      catch (error) {
        // Preserve the original invalid inline result and its manual-action contract.
        // It cannot be published as an image asset, but must not be generated or charged again.
        if (descriptor.request.background !== 'transparent' || !url.startsWith('data:')) throw error;
        await fence(); urls.push(url); imageInputs.push(url); continue;
      }
      await fence();
      const extension = decoded.mimeType === 'image/jpeg' ? 'jpg' : decoded.mimeType.split('/')[1];
      const file = await persistAssetBytes({ bytes: decoded.buffer, mimeType: decoded.mimeType, filename: `${task.id}-${urls.length}.${extension}`, signal: scope.signal });
      urls.push(file.url);
      imageInputs.push(decoded.buffer);
    }
    await fence();
    const metadata = await getTransparentResultMetadata(urls, descriptor.request.background, imageInputs);
    const images = buildUniversalImages(urls, descriptor.request, task.id);
    await fence();
    if (!await completeCloudTask(task.id, { images, imageUrl: urls[0], imageUrls: urls, ...metadata }, { leaseOwner: owner, deadlineAt })) return;
    updateTaskProgress(task.id, { status: 'completed', progress: 100 });
    await projectPersistedCompletedTask(task.id, input.actorUserId);
  } catch (error) {
    if (error instanceof ExecutionLost) return;
    // Replaced/cancelled/expired workers cannot settle or publish local progress.
    const current = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!current || current.leaseOwner !== owner || current.status !== 'processing' || (current.leaseExpiresAt || 0) < Date.now()) return;
    const timeout = scope.signal.aborted && (scope.signal.reason?.code === 'TASK_TIMEOUT' || scope.signal.reason?.name === 'TimeoutError');
    const invalidSource = !started && !scope.signal.aborted && isDefiniteSourceFailure(error);
    if (error instanceof UniversalProviderFailure || invalidSource || (!started && error instanceof CanvasUniversalAdmissionError && error.status !== 503) || (checkpoint && timeout)) {
      const status = timeout || error instanceof UniversalProviderFailure && error.status === 408 ? 'timeout' : 'failed';
      const settled = await terminateCloudTaskAndRefund(input.taskId, status, '生成任务未能完成', owner);
      if (settled.transitioned) updateTaskProgress(input.taskId, { status, error: '生成任务未能完成' });
    } else if (started && !checkpoint) {
      // Preserve the charge and task on any ambiguous response or checkpoint write failure.
      // The next worker sees started and also refuses a second submission.
      if (await updateCloudTask(input.taskId, { leaseOwner: owner, mergeResult: true,
        result: { universalDiagnostic: 'UNIVERSAL_SUBMISSION_UNCERTAIN' } })) {
        updateTaskProgress(input.taskId, { status: 'processing', label: '等待确认供应商结果' });
      }
    }
  } finally { scope.dispose(); await releaseCloudTaskLease(input.taskId, owner); }
}
