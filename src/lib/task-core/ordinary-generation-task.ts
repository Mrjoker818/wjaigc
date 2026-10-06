import 'server-only';
import { randomUUID } from 'node:crypto';
import { getCloudTaskForUser, claimCloudTaskLease, releaseCloudTaskLease, updateCloudTask, completeCloudTask,
  terminateCloudTaskAndRefund, type CloudTask } from '@/lib/cloud-task-storage';
import { projectPersistedCompletedTask } from '@/lib/cloud-task-persistence';
import { findProviderById } from '@/lib/server-api-config';
import { createTaskAbortScope } from './task-abort';
import { registerTask, markTaskDurable, updateTaskProgress } from '@/lib/task-registry';
import { createOrdinaryProvider, enhanceOrdinaryPrompt, ordinaryTransparencyMetadata, queryOrdinaryGeneration, parseOrdinaryResponsesOutputs, type OrdinaryProviderOptions, type OrdinaryPromptInput, type OrdinarySubmission } from './ordinary-generation-provider';
import type { OrdinaryGenerationPlan, OrdinaryGenerationTarget } from './ordinary-generation-request';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { parseResponseForProfile, parseGeminiChatImageResponse } from '@/lib/api-compatibility';
import { loadSafeImageInput, SafeImageInputError } from '@/lib/safe-image-input';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';
import { identifyImageSubject } from '@/lib/identify-subject';
import { detectInvalidSizeError, repairSize } from '@/lib/size-auto-repair';
import type { CanvasTaskPublicationInput } from '@/lib/collaboration/task-publication';
import { validateCanvasOrdinaryReplay, validateCanvasOrdinarySources, CanvasOrdinaryAdmissionError } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { parseOrdinaryGenerationOutputGroup } from './ordinary-generation-output-group';

export interface OrdinaryGenerationDescriptor {
  version: 1; route: '/api/generate'; requestDigest: string;
  plan: OrdinaryGenerationPlan; publication: CanvasTaskPublicationInput;
}
export interface OrdinaryAttemptCheckpoint {
  slotIndex: number; attemptIndex: number; targetIndex: number; route: string;
  status: 'started' | 'rejected' | 'accepted';
  diagnostic?: { status?: number; code?: string; message: string };
  directUrls?: string[]; remotes?: Array<{ id: string; urls?: string[]; failed?: boolean }>;
}
interface OrdinaryExecutionCheckpoint {
  attempts: OrdinaryAttemptCheckpoint[]; finishedSlots: number[];
  enhancedPrompt?: string; compiledReferenceConstraints?: unknown;
  sourceUnavailableSince?: number;
  persistedOutputs: Record<string, string>;
}
function ordinaryRouteAudit(plan: OrdinaryGenerationPlan, checkpoint: OrdinaryExecutionCheckpoint): Record<string, unknown> {
  const attempts = checkpoint.attempts.map(attempt => {
    const target = plan.targets[attempt.targetIndex];
    const url = new URL(attempt.route); url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return { slotIndex: attempt.slotIndex, attemptIndex: attempt.attemptIndex, providerId: target.providerId,
      providerName: target.providerName, model: target.modelId, route: url.href, status: attempt.status,
      ...(attempt.diagnostic ? { diagnostic: { ...attempt.diagnostic } } : {}) };
  });
  const outputs = checkpoint.attempts.flatMap((attempt, index) => {
    if (attempt.status !== 'accepted') return [];
    const recorded = attempts[index];
    const identity = { slotIndex: recorded.slotIndex, attemptIndex: recorded.attemptIndex, providerId: recorded.providerId,
      providerName: recorded.providerName, model: recorded.model, route: recorded.route };
    return [...(attempt.directUrls || []).map((_url, sourceOutputIndex) => ({ ...identity, kind: 'direct', sourceOutputIndex })),
      ...(attempt.remotes || []).flatMap((remote, remoteIndex) => (remote.urls || []).map((_url, sourceOutputIndex) => ({
        ...identity, kind: 'remote', remoteIndex, sourceOutputIndex,
      })))];
  }).map((output, outputIndex) => ({ ...output, outputIndex }));
  return { attempts, outputs };
}
class ExecutionLost extends Error {}
class SubmissionUncertain extends Error {}
function definiteSourceFailure(error: unknown): boolean {
  if (!(error instanceof SafeImageInputError)) return false;
  if (error.message === 'Image cannot be decoded safely') return error.cause instanceof Error && !('code' in error.cause)
    && /^Input (?:buffer (?:has corrupt header|contains unsupported image format)|image exceeds pixel limit)/.test(error.cause.message);
  return ['Managed image exceeds the size limit', 'Managed file is not a supported image', 'Image format validation failed',
    'Image pixel dimensions exceed the safe pixel limit', 'BMP header is invalid', 'BMP file bounds are invalid',
    'BMP core header is truncated', 'BMP DIB header is unsupported', 'BMP dimensions are invalid'].includes(error.message);
}
const terminal = (status: string): boolean => ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
export function readOrdinaryDescriptor(task: CloudTask): OrdinaryGenerationDescriptor {
  const value = task.result?.ordinaryGeneration as OrdinaryGenerationDescriptor | undefined;
  if (task.type !== 'generate' || !task.id.startsWith('ordinary_') || !value || value.version !== 1
    || value.route !== '/api/generate' || !task.requestDigest || value.requestDigest !== task.requestDigest
    || !value.plan?.targets?.length || !Number.isInteger(value.plan.requestedCount) || value.plan.requestedCount < 1 || value.plan.requestedCount > 10
    || value.publication?.singleAdmission !== 'generate' || value.publication.access.actorUserId !== task.userId
    || value.publication.access.projectId !== task.projectId) throw new CanvasOrdinaryAdmissionError(409, 'ORDINARY_DESCRIPTOR_INVALID');
  return value;
}
export function ordinaryTaskResponse(task: CloudTask): Record<string, unknown> {
  const descriptor = readOrdinaryDescriptor(task);
  const result = task.result || {};
  const safe = Object.fromEntries(['imageUrl', 'imageUrls', 'assetProjection', 'enhancedPrompt', 'originalPrompt',
    'providerName', 'routeAudit', 'alphaVerification', 'warning', 'nextAction'].filter(key => result[key] !== undefined).map(key => [key, result[key]]));
  const outputGroup = parseOrdinaryGenerationOutputGroup(result.outputGroup, task.id);
  if (outputGroup) safe.outputGroup = outputGroup;
  const urls = Array.isArray(safe.imageUrls) ? safe.imageUrls : [];
  const uncertain = result.ordinaryDiagnostic === 'ORDINARY_SUBMISSION_UNCERTAIN';
  return { success: !['failed', 'cancelled', 'timeout'].includes(task.status) && !uncertain,
    mode: 'polling', taskId: task.id, taskIds: [task.id], idempotencyKey: task.idempotencyKey,
    status: task.status, progress: task.progress, model: task.model, providerId: task.providerId,
    count: urls.length || descriptor.plan.requestedCount, directImageUrls: urls,
    ...safe, result: safe, ...(task.error ? { error: task.error } : {}),
    ...(uncertain ? { code: 'ORDINARY_SUBMISSION_UNCERTAIN', requiresReconciliation: true, retryable: false } : {}),
  };
}
function definiteRejection(status: number, message: string): boolean {
  return [404, 405, 415].includes(status)
    || ([400, 422].includes(status) && /invalid[_ ](?:size|quality|parameter|request)|unsupported (?:size|format|parameter)|(?:size|dimension).*(?:not supported|must be|invalid)|required (?:field|parameter)|model[_ ]not[_ ]found/i.test(message))
    || (status === 401 && /invalid api[_ ]?key|unauthorized|authentication/i.test(message))
    || (status === 403 && /forbidden|permission denied|not authorized/i.test(message))
    || (status === 429 && /rate[_ ]limit|too many requests/i.test(message))
    || (status !== 504 && status !== 524 && /\bno available (?:channel|compatible accounts?)\b/i.test(message));
}
export async function executeOrdinaryGenerationTask(input: { taskId: string; actorUserId: string; origin: string; phase: 'submit' | 'poll' }): Promise<void> {
  let task = await getCloudTaskForUser(input.taskId, input.actorUserId);
  if (!task || terminal(task.status)) return;
  const descriptor = readOrdinaryDescriptor(task);
  const owner = `ordinary-${randomUUID()}`;
  if (!await claimCloudTaskLease(task.id, owner, 660_000)) return;
  const scope = createTaskAbortScope(task.id, { timeoutMs: 600_000 });
  const deadlineAt = Date.now() + 600_000;
  let checkpoint: OrdinaryExecutionCheckpoint = { attempts: [], finishedSlots: [], persistedOutputs: {} };
  let checkpointWriteFailed = false;
  const fence = async (): Promise<void> => {
    scope.signal.throwIfAborted();
    const current = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!current || current.status !== 'processing' || current.leaseOwner !== owner || (current.leaseExpiresAt || 0) <= Date.now()) throw new ExecutionLost();
  };
  const persist = async (extra: Record<string, unknown> = {}): Promise<void> => {
    await fence();
    try {
      if (!await updateCloudTask(input.taskId, { leaseOwner: owner, mergeResult: true,
        result: { ordinaryCheckpoint: structuredClone(checkpoint), routeAudit: ordinaryRouteAudit(descriptor.plan, checkpoint),
          providerName: descriptor.plan.targets[0].providerName, ...extra } })) throw new ExecutionLost();
    } catch (error) { checkpointWriteFailed = true; throw error; }
  };
  const validateSource = async (): Promise<string[]> => {
    await fence();
    await validateCanvasOrdinaryReplay(descriptor.publication, { type: 'generate',
      idempotencyKey: task!.idempotencyKey!, requestDigest: descriptor.requestDigest }, input.taskId);
    return validateCanvasOrdinarySources(descriptor.publication, descriptor.plan.body, input.origin);
  };
  try {
    task = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!task || task.leaseOwner !== owner || terminal(task.status)) return;
    checkpoint = structuredClone(task.result?.ordinaryCheckpoint as OrdinaryExecutionCheckpoint
      || { attempts: [], finishedSlots: [], persistedOutputs: {} });
    registerTask(task.id, 'generate', '普通图像生成', input.actorUserId); markTaskDurable(task.id);
    updateTaskProgress(task.id, { status: 'processing', result: ordinaryTaskResponse(task).result as Record<string, unknown> });
    if (checkpoint.attempts.some(attempt => attempt.status === 'started')) throw new SubmissionUncertain();
    const plan = descriptor.plan;
    let references: string[] = [];
    const prepareReferences = async (): Promise<void> => {
      const urls = await validateSource();
      references = [];
      for (const url of urls) {
        // Each shared byte read revalidates the frozen grant and full ordered source snapshot.
        await validateSource();
        const image = await loadSafeImageInput(url, { signal: scope.signal });
        references.push(`data:${image.mimeType};base64,${image.buffer.toString('base64')}`);
      }
      if (checkpoint.sourceUnavailableSince !== undefined) {
        delete checkpoint.sourceUnavailableSince;
        await persist({ ordinaryDiagnostic: null });
      }
    };
    if (checkpoint.enhancedPrompt === undefined) {
      await prepareReferences();
      const enhanced = await enhanceOrdinaryPrompt({ ...plan.body, prompt: String(plan.body.prompt),
        accessibleReferenceImages: references, effectiveProviderId: plan.requestedProviderId,
        provider: { name: plan.targets[0].providerName }, modelConfig: plan.targets[0].modelConfig,
        propagateIdentificationErrors: true,
        identify: (url: string, timeout?: number) => identifyImageSubject(url, timeout, {
          frozenTargets: plan.identificationTargets, signal: scope.signal,
          beforeIO: async (): Promise<void> => { await validateSource(); },
          resolveApiKey: async (id: string): Promise<string | undefined> => (await findProviderById(id))?.apiKey,
          transport: async (resource, options): Promise<Response> => {
            await validateSource();
            return fetch(resource, { ...options, signal: options?.signal ? AbortSignal.any([scope.signal, options.signal]) : scope.signal });
          },
        }),
      } as OrdinaryPromptInput);
      checkpoint.enhancedPrompt = enhanced.enhancedPrompt;
      checkpoint.compiledReferenceConstraints = enhanced.compiledReferenceConstraints;
      await persist({ enhancedPrompt: enhanced.enhancedPrompt, originalPrompt: plan.body.prompt });
    }
    for (let slotIndex = 0; slotIndex < plan.requestedCount; slotIndex++) {
      if (checkpoint.finishedSlots.includes(slotIndex)) continue;
      if (checkpoint.attempts.some(attempt => attempt.slotIndex === slotIndex && attempt.status === 'accepted')) {
        checkpoint.finishedSlots.push(slotIndex); await persist(); continue;
      }
      try { await prepareReferences(); }
      catch (error) {
        if (checkpoint.attempts.some(attempt => attempt.status === 'accepted')
          && (error instanceof CanvasOrdinaryAdmissionError && error.status !== 503 || definiteSourceFailure(error))) {
          checkpoint.finishedSlots.push(...Array.from({ length: plan.requestedCount - slotIndex }, (_, index) => slotIndex + index));
          await persist({ ordinarySourceDiagnostic: 'ORDINARY_REMAINING_SOURCES_UNAVAILABLE' });
          break;
        }
        throw error;
      }
      for (let targetIndex = 0; targetIndex < plan.targets.length; targetIndex++) {
        const target = plan.targets[targetIndex];
        const credentials = await findProviderById(target.providerId);
        if (!credentials?.apiKey) return;
        const key = credentials.apiKey;
        const redact = (value: string): string => value.split(key).join('[redacted]')
          .replace(/(Bearer\s+)[^\s,;"']+/gi, '$1[redacted]')
          .replace(/((?:api[_-]?key|secret|token|password|authorization|credential)\s*[=:]\s*)(?!\[redacted\])[^\s,;"']+/gi, '$1[redacted]').slice(0, 1000);
        const accept = async (output: OrdinarySubmission): Promise<void> => {
          const attempt = checkpoint.attempts.at(-1);
          if (!attempt || attempt.status === 'accepted') return;
          if (!output.directImageUrls.length && !output.taskIds.length) throw new SubmissionUncertain();
          attempt.status = 'accepted'; attempt.directUrls = output.directImageUrls;
          attempt.remotes = output.taskIds.map(id => ({ id }));
          await persist();
        };
        const transport: typeof fetch = async (resource, options): Promise<Response> => {
          await fence();
          if (options?.method !== 'POST') return fetch(resource, { ...options, signal: scope.signal });
          const prior = checkpoint.attempts.at(-1);
          if (prior?.slotIndex === slotIndex && prior.status !== 'rejected') throw new SubmissionUncertain();
          await validateSource();
          const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
          const attempt: OrdinaryAttemptCheckpoint = { slotIndex, attemptIndex: checkpoint.attempts.filter(value => value.slotIndex === slotIndex).length,
            targetIndex, route: url, status: 'started' };
          checkpoint.attempts.push(attempt); await persist();
          let response: Response;
          try { response = await fetch(resource, { ...options, signal: options?.signal ? AbortSignal.any([scope.signal, options.signal]) : scope.signal }); }
          catch (error) {
            attempt.diagnostic = { message: redact(error instanceof Error ? error.message : String(error)) };
            await persist(); throw error;
          }
          if (!response.ok) {
            const raw = await response.clone().text();
            let code: string | undefined; let message = raw;
            try {
              const json = JSON.parse(raw); const error = json.error && typeof json.error === 'object' ? json.error : json;
              if (typeof error.code === 'string' || typeof error.code === 'number') code = redact(String(error.code));
              if (typeof error.message === 'string') message = error.message;
            } catch { /* Non-JSON errors retain their original safe text. */ }
            attempt.diagnostic = { status: response.status, ...(code ? { code } : {}), message: redact(message) };
            if (!definiteRejection(response.status, raw)) { await persist(); throw new SubmissionUncertain(); }
            attempt.status = 'rejected'; await persist();
          } else if (!response.headers.get('content-type')?.includes('text/event-stream')) {
            const json = await response.clone().json() as Record<string, unknown>;
            const parsed = parseResponseForProfile(json, target.profile, { responseUrl: response.url });
            const responsesProtocol = target.responsesApiEnabled && /\/responses\/?$/.test(new URL(url).pathname);
            const chatProtocol = /\/chat\/completions\/?$/.test(new URL(url).pathname);
            const directImageUrls = responsesProtocol
              ? parseOrdinaryResponsesOutputs(json) : chatProtocol ? parseGeminiChatImageResponse(json)
                : parsed.directImageUrls.length ? parsed.directImageUrls : parseGeminiChatImageResponse(json);
            // Completion IDs identify responses, not pollable Images tasks. Images
            // still retain genuine mixed direct + remote results without inference by URLs.
            await accept({ taskIds: responsesProtocol || chatProtocol ? [] : parsed.taskIds, directImageUrls, usedModel: target.modelId, usedProviderId: target.providerId });
          }
          return response;
        };
        const submitOptions: OrdinaryProviderOptions = { requestedSize: String(plan.body.aspectRatio || '1:1'),
          normalizedRequestedPixelSize: typeof plan.body.size === 'string' ? plan.body.size : undefined,
          quality: typeof plan.body.quality === 'string' ? plan.body.quality : undefined,
          resolutionTier: typeof plan.body.resolution === 'string' ? plan.body.resolution : undefined,
          // Billing keys are actor-scoped; provider operation keys must also isolate roots and slots.
          // Definite protocol rejections stay in this slot identity; accepted slots never POST again.
          enhancedPrompt: checkpoint.enhancedPrompt!, agentProviderIdempotencyKey: `${task.id}:slot:${slotIndex}`,
          accessibleReferenceImages: references, referenceMode: plan.body.referenceMode as string | undefined,
          referenceStrengths: plan.body.referenceStrengths as number[] | undefined, strength: plan.body.strength as number | undefined,
          aspectRatio: String(plan.body.aspectRatio || '1:1'), strictAgentRouting: false,
          provider: { name: target.providerName }, profile: target.profile, controlled: true, transport,
          responsesApiEnabled: target.responsesApiEnabled,
          providerFetch: (base, path, options, retry, timeout) => fetchWithV1Retry(base, path,
            { ...options, transport, propagateErrors: true }, retry, timeout),
          downloadAndSaveImage: async (): Promise<null> => null, isPrivateIp: (): boolean => false,
          outputFields: { background: plan.body.background, output_format: plan.body.output_format },
        };
        try {
          const invoke = (options: OrdinaryProviderOptions): Promise<OrdinarySubmission> => createOrdinaryProvider(options)(
            target.modelConfig, key, target.baseUrl, target.providerId, 1, { baseUrl: target.baseUrl, advancedParams: target.advancedParams });
          let output: OrdinarySubmission;
          try { output = await invoke(submitOptions); }
          catch (error) {
            const last = checkpoint.attempts.at(-1);
            const invalidSize = last?.status === 'rejected' && !checkpointWriteFailed
              ? detectInvalidSizeError(last.diagnostic?.message || '') : null;
            const repaired = invalidSize ? repairSize(invalidSize, target.modelId) : null;
            if (!repaired) throw error;
            output = await invoke({ ...submitOptions, normalizedRequestedPixelSize: repaired });
          }
          await accept(output);
          break;
        } catch (error) {
          if (checkpointWriteFailed) throw error;
          const attempt = checkpoint.attempts.at(-1);
          if (attempt?.status === 'started' && !attempt.diagnostic && !(error instanceof ExecutionLost)) {
            const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
            attempt.diagnostic = { message: redact(error instanceof Error ? error.message : String(error)),
              ...(typeof details.status === 'number' ? { status: details.status } : {}),
              ...(typeof details.providerCode === 'string' ? { code: redact(details.providerCode) } : {}) };
            await persist();
          }
          if (attempt?.status === 'accepted') break;
          if (!attempt || attempt.status === 'started' || error instanceof ExecutionLost) throw error;
          if (targetIndex + 1 === plan.targets.length) break;
        }
      }
      checkpoint.finishedSlots.push(slotIndex); await persist();
    }
    if (input.phase === 'poll') {
      for (const attempt of checkpoint.attempts.filter(value => value.status === 'accepted')) {
        const target: OrdinaryGenerationTarget = plan.targets[attempt.targetIndex];
        for (const remote of attempt.remotes || []) {
          if (remote.urls || remote.failed) continue;
          const provider = await findProviderById(target.providerId);
          if (!provider?.apiKey) continue;
          await fence();
          try {
            const queried = await queryOrdinaryGeneration({ baseUrl: target.baseUrl, profile: target.profile, remoteId: remote.id,
              apiKey: provider.apiKey, signal: scope.signal, transport: async (resource, options): Promise<Response> => {
                await fence(); return fetch(resource, options);
              } });
            if (queried.status === 'failed') { remote.failed = true; await persist(); continue; }
            if (queried.status !== 'completed') continue;
            remote.urls = queried.imageUrls; await persist();
          } catch (error) { if (checkpointWriteFailed || error instanceof ExecutionLost || scope.signal.aborted) throw error; }
        }
      }
    }
    const accepted = checkpoint.attempts.filter(value => value.status === 'accepted');
    const ordered = accepted.flatMap(attempt => [
      ...(attempt.directUrls || []).map((url, index) => ({ id: `${attempt.slotIndex}:${attempt.attemptIndex}:direct:${index}`, url })),
      ...(attempt.remotes || []).flatMap((remote, remoteIndex) => (remote.urls || []).map((url, index) => ({ id: `${attempt.slotIndex}:${attempt.attemptIndex}:${remoteIndex}:${index}`, url }))),
    ]);
    for (const output of ordered) {
      if (checkpoint.persistedOutputs[output.id]) continue;
      await fence();
      const image = await loadSafeImageInput(output.url, { signal: scope.signal });
      await fence();
      const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
      const file = await persistAssetBytes({ bytes: image.buffer, mimeType: image.mimeType,
        filename: `${task.id}-${output.id.replaceAll(':', '-')}.${extension}`, signal: scope.signal });
      checkpoint.persistedOutputs[output.id] = file.url; await persist();
    }
    const urls = ordered.map(output => checkpoint.persistedOutputs[output.id]);
    await persist({ imageUrls: urls, imageUrl: urls[0] });
    if (accepted.some(attempt => attempt.remotes?.some(remote => !remote.urls && !remote.failed))) return;
    if (!urls.length) { await fence(); await terminateCloudTaskAndRefund(task.id, 'failed', '所有生成尝试均被明确拒绝', owner); return; }
    let transparency: Record<string, unknown> = {};
    if (plan.body.background === 'transparent') {
      const buffers: Buffer[] = [];
      for (const url of urls) { await fence(); buffers.push((await loadSafeImageInput(url, { signal: scope.signal })).buffer); }
      transparency = await ordinaryTransparencyMetadata(urls, buffers);
    }
    await fence();
    if (!await completeCloudTask(task.id, { imageUrl: urls[0], imageUrls: urls, ordinaryDiagnostic: null, ...transparency }, { leaseOwner: owner, deadlineAt })) return;
    await projectPersistedCompletedTask(task.id, input.actorUserId);
    const current = await getCloudTaskForUser(task.id, input.actorUserId);
    if (current) updateTaskProgress(task.id, { status: 'completed', progress: 100, result: ordinaryTaskResponse(current).result as Record<string, unknown> });
  } catch (error) {
    if (error instanceof ExecutionLost) return;
    const current = await getCloudTaskForUser(input.taskId, input.actorUserId);
    if (!current || current.leaseOwner !== owner || terminal(current.status) || (current.leaseExpiresAt || 0) <= Date.now()) return;
    if (checkpointWriteFailed || checkpoint.attempts.some(attempt => attempt.status === 'started') || error instanceof SubmissionUncertain) {
      await updateCloudTask(input.taskId, { leaseOwner: owner, mergeResult: true, result: { ordinaryDiagnostic: 'ORDINARY_SUBMISSION_UNCERTAIN' } });
    } else if ((error instanceof CanvasOrdinaryAdmissionError && error.status !== 503)
      || (!checkpoint.attempts.some(attempt => attempt.status === 'accepted') && definiteSourceFailure(error))) {
      await terminateCloudTaskAndRefund(input.taskId, 'failed', error instanceof Error ? error.message : '源图片无效', owner);
    } else if (checkpoint.attempts.length === 0 && (error instanceof CanvasOrdinaryAdmissionError && error.status === 503
      || error instanceof SafeImageInputError && !definiteSourceFailure(error))) {
      const now = Date.now();
      const since = checkpoint.sourceUnavailableSince;
      checkpoint.sourceUnavailableSince = typeof since === 'number' && Number.isFinite(since) && since <= now ? since : now;
      if (now - checkpoint.sourceUnavailableSince >= 600_000) {
        await terminateCloudTaskAndRefund(input.taskId, 'timeout', '来源图片持续无法恢复', owner, { requireActive: true });
      } else {
        await updateCloudTask(input.taskId, { leaseOwner: owner, mergeResult: true,
          result: { ordinaryCheckpoint: structuredClone(checkpoint), ordinaryDiagnostic: 'ORDINARY_RECOVERY_PENDING' } });
      }
    } else {
      await updateCloudTask(input.taskId, { leaseOwner: owner, mergeResult: true, result: { ordinaryDiagnostic: 'ORDINARY_RECOVERY_PENDING' } });
    }
  } finally { scope.dispose(); await releaseCloudTaskLease(input.taskId, owner); }
}
