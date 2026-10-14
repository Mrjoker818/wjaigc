import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildNodeExecutionRequest, parseWorkflowSketchImageReference, type WorkflowNode, type ExecutionResult } from '@/lib/workflow-engine';
import { getInternalApiUrl } from '@/lib/api-helpers';
import { getCloudTaskForUserByIdempotencyKey, type PersistedCloudTask } from '@/lib/cloud-task-storage';
import { parseStoredSketchImageInput, parseSketchImageAnalysis, type SketchImageInput } from './image-contract';
import { prepareSketchImage, type SketchImagePreparation } from './image-generation';
import { createConfiguredSketchImageDependencies } from './configured-image-dependencies';
import { sketchImageRequestDigest } from './image-admission';
import { readSketchImageTaskIdentity, type SketchImageTaskIdentity } from './image-task-state';
import { parseSketchImagePricing } from './image-pricing';
import { runSketchStage } from './stage';
import { assertWorkflowSketchAccess, readWorkflowSketchPng, type WorkflowSketchHost } from './workflow';

export interface WorkflowSketchImageIntent {
  version: 2; actorUserId: string; projectId: string; parentExecutionId: string;
  executionId: string; nodeId: string; instanceId: string; attempt: number;
  input: Readonly<SketchImageInput>; access: SketchImagePreparation['access']; requestDigest: string;
  childTaskId?: string; admissionUnknown?: boolean;
}
type Host = WorkflowSketchHost<WorkflowSketchImageIntent>;
type Identity = Readonly<SketchImageTaskIdentity>;
interface OriginalChild { readonly identity: Identity; readonly status: string }
const HTTP_TIMEOUT = 30_000, MAX_RESPONSE_BYTES = 1024 * 1024, OBSERVATION_MS = 180_000;
class HostFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new HostFailure(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('WORKFLOW_SKETCH_IMAGE_RESPONSE_INVALID');
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !property || !('value' in property) || !property.enumerable) fail('WORKFLOW_SKETCH_IMAGE_RESPONSE_INVALID');
    copy[key] = property.value as unknown;
  }
  return copy;
}
function hasPendingFlags(data: Record<string, unknown>): boolean {
  let pending = false;
  for (const field of ['needsReconcile', 'recoveryPending', 'dispatchStopped', 'refundPending', 'dispatchPending'] as const) {
    if (!Object.hasOwn(data, field)) continue;
    if (typeof data[field] !== 'boolean') fail('WORKFLOW_SKETCH_IMAGE_RESPONSE_INVALID');
    if (data[field] === true) pending = true;
  }
  return pending;
}
function assertIntent(intent: WorkflowSketchImageIntent, host: Host): void {
  try {
    const input = parseStoredSketchImageInput(intent.input);
    if (intent.version !== 2 || intent.actorUserId !== host.actorUserId || intent.projectId !== host.projectId
      || intent.parentExecutionId !== host.parentExecutionId || intent.executionId !== host.executionId
      || intent.nodeId !== host.nodeId || intent.instanceId !== host.instanceId || intent.attempt !== host.attempt
      || !Number.isSafeInteger(intent.attempt) || intent.attempt < 0 || input.projectId !== host.projectId
      || !isDeepStrictEqual(input, intent.input) || intent.requestDigest !== sketchImageRequestDigest(input)) throw new Error();
  } catch { fail('WORKFLOW_SKETCH_IMAGE_INTENT_MISMATCH'); }
}
async function guard(host: Host, intent?: WorkflowSketchImageIntent, permission = true, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (permission) await assertWorkflowSketchAccess(host, intent);
  else await host.assertCurrent();
  signal?.throwIfAborted();
}
async function checked<T>(host: Host, intent: WorkflowSketchImageIntent | undefined, operation: () => Promise<T>,
  signal?: AbortSignal, permission = true): Promise<T> {
  await guard(host, intent, permission, signal);
  const result = await operation(); signal?.throwIfAborted();
  await guard(host, intent, permission, signal); return result;
}
async function prepare(value: unknown, host: Host, intent?: WorkflowSketchImageIntent): Promise<SketchImagePreparation> {
  return runSketchStage(async signal => {
    const generation = createConfiguredSketchImageDependencies().generation;
    const prepared = await checked(host, intent, () => prepareSketchImage(value, {
      ...generation,
      authorizeProject: (actor, project) => checked(host, intent, () => generation.authorizeProject(actor, project), signal),
      resolveTaskModel: (provider, model, actor) => checked(host, intent, () => generation.resolveTaskModel(provider, model, actor), signal),
    }, { actorUserId: host.actorUserId, signal }), signal);
    if (intent && (!isDeepStrictEqual(prepared.input, intent.input) || !isDeepStrictEqual(prepared.access, intent.access))) {
      fail('WORKFLOW_SKETCH_IMAGE_INTENT_MISMATCH');
    }
    // Preparation validates the catalog and original PNG; its compute closure is deliberately unused.
    return prepared;
  }, new AbortController().signal, HTTP_TIMEOUT);
}
async function originalChild(intent: WorkflowSketchImageIntent, host: Host, permission = true): Promise<OriginalChild | null> {
  assertIntent(intent, host);
  const candidate = await checked(host, intent,
    () => getCloudTaskForUserByIdempotencyKey(host.actorUserId, intent.input.idempotencyKey), undefined, permission);
  if (!candidate) {
    if (intent.childTaskId) fail('WORKFLOW_SKETCH_IMAGE_CHILD_IDENTITY_MISMATCH');
    return null;
  }
  try {
    // The original owner/key reader maps a persisted row to CloudTask; the strict reader validates its private fields at runtime.
    const identity = readSketchImageTaskIdentity(candidate as PersistedCloudTask, host.actorUserId);
    if (identity.requestDigest !== intent.requestDigest || identity.projectId !== intent.projectId
      || !isDeepStrictEqual(identity.input, intent.input) || !isDeepStrictEqual(identity.access, intent.access)
      || intent.childTaskId && identity.taskId !== intent.childTaskId) throw new Error();
    if (hasPendingFlags(object(candidate))) throw new Error();
    return { identity, status: candidate.status };
  } catch { fail('WORKFLOW_SKETCH_IMAGE_CHILD_IDENTITY_MISMATCH'); }
}
async function request(endpoint: '/api/sketch-to-image' | '/api/poll-task' | '/api/cancel-task', body: Record<string, unknown>,
  host: Host, intent: WorkflowSketchImageIntent, permission = true): Promise<{ response: Response; data: Record<string, unknown> }> {
  return runSketchStage(async signal => {
    const response = await checked(host, intent, () => fetch(getInternalApiUrl(endpoint), {
      method: 'POST', headers: { ...Object.fromEntries(new Headers(host.headers)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal, cache: 'no-store', redirect: 'error',
    }), signal, permission);
    if (!(response instanceof Response) || response.redirected || !response.body) fail('WORKFLOW_SKETCH_IMAGE_RESPONSE_INVALID');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    const abort = (): void => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      for (;;) {
        const chunk = await checked(host, intent, () => reader.read(), signal, permission);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) fail('WORKFLOW_SKETCH_IMAGE_RESPONSE_LIMIT');
        chunks.push(chunk.value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      signal.throwIfAborted();
      const data = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown);
      await guard(host, intent, permission, signal); return { response, data };
    } finally {
      signal.removeEventListener('abort', abort); abort();
    }
  }, new AbortController().signal, HTTP_TIMEOUT);
}
function managedUrl(value: unknown): string {
  try {
    if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/api/serve-upload/') || /[?#\\\p{Cc}]/u.test(value)) throw new Error();
    const decoded = decodeURIComponent(value.slice('/api/serve-upload/'.length));
    if (!/^[A-Za-z0-9._/-]+$/u.test(decoded) || decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error();
    return value;
  } catch { fail('WORKFLOW_SKETCH_IMAGE_OUTPUT_INVALID'); }
}
function summary(data: Record<string, unknown>, identity: Identity): Record<string, unknown> {
  const input = identity.input;
  try {
    if (data.success !== true || data.taskId !== identity.taskId || data.type !== 'sketch-to-image' || data.projectId !== identity.projectId
      || data.visionProviderId !== input.visionProviderId || data.visionModelId !== input.visionModelId
      || data.imageProviderId !== input.imageProviderId || data.imageModelId !== input.imageModelId
      || typeof data.progress !== 'number' || !Number.isFinite(data.progress) || data.progress < 0 || data.progress > 100
      || !['pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout'].includes(String(data.status))
      || data.reserveCredits !== identity.pricing.totalReserveCredits || !isDeepStrictEqual(parseSketchImagePricing(data.pricing), identity.pricing)) throw new Error();
    // The original public endpoint omits private checkpoint phase. If present, it must not contradict the original state.
    if (Object.hasOwn(data, 'phase') && (typeof data.phase !== 'string'
      || !['analysis', 'analysis-complete', 'generation', 'accepted'].includes(data.phase)
      || data.status === 'completed' && data.phase !== 'accepted')) throw new Error();
    if (hasPendingFlags(data)) throw new Error();
    return { taskId: identity.taskId, projectId: identity.projectId, type: 'sketch-to-image', status: data.status, progress: data.progress,
      visionProviderId: input.visionProviderId, visionModelId: input.visionModelId, imageProviderId: input.imageProviderId, imageModelId: input.imageModelId,
      pricing: parseSketchImagePricing(identity.pricing), reserveCredits: identity.pricing.totalReserveCredits,
      ...(Object.hasOwn(data, 'phase') ? { phase: data.phase } : {}),
      ...(data.needsReconcile === true ? { needsReconcile: true } : {}), ...(data.recoveryPending === true ? { recoveryPending: true } : {}) };
  } catch { fail('WORKFLOW_SKETCH_IMAGE_POLL_IDENTITY_MISMATCH'); }
}
function completed(data: Record<string, unknown>, identity: Identity, safe: Record<string, unknown>): Record<string, unknown> {
  const ref = parseWorkflowSketchImageReference({ kind: 'sketch-image-reference', taskId: identity.taskId, projectId: identity.projectId,
    visionProviderId: identity.input.visionProviderId, visionModelId: identity.input.visionModelId,
    imageProviderId: identity.input.imageProviderId, imageModelId: identity.input.imageModelId,
    previewAssetId: data.previewAssetId, previewAssetVersionId: data.previewAssetVersionId,
    imageAssetId: data.imageAssetId, imageAssetVersionId: data.imageAssetVersionId });
  if (!ref || typeof data.actualCredits !== 'number' || !Number.isSafeInteger(data.actualCredits) || data.actualCredits < 0) {
    fail('WORKFLOW_SKETCH_IMAGE_OUTPUT_INVALID');
  }
  managedUrl(data.previewUrl);
  const imageUrl = managedUrl(data.imageUrl);
  if (imageUrl === data.previewUrl) fail('WORKFLOW_SKETCH_IMAGE_OUTPUT_INVALID');
  let analysis: ReturnType<typeof parseSketchImageAnalysis>;
  try { analysis = parseSketchImageAnalysis(data.analysis); } catch { fail('WORKFLOW_SKETCH_IMAGE_OUTPUT_INVALID'); }
  return { ...safe, imageUrl, assetId: ref.imageAssetId, imageAssetId: ref.imageAssetId,
    assetVersionId: ref.imageAssetVersionId, imageAssetVersionId: ref.imageAssetVersionId,
    sourceRole: 'generated-sketch-image', sketchImageReference: ref, analysis, actualCredits: data.actualCredits };
}
/** A child adapter only: original HTTP owns admission, settlement, workers and publication. */
export async function executeWorkflowSketchImage(node: WorkflowNode, inputs: Record<string, unknown>, host: Host): Promise<ExecutionResult> {
  const started = Date.now(); let intent = host.intents[host.instanceId], fresh = false;
  const result = (status: ExecutionResult['status'], output?: Record<string, unknown>, error?: string): ExecutionResult =>
    ({ nodeId: host.nodeId, status, ...(output ? { output } : {}), ...(error ? { error } : {}), durationMs: Date.now() - started });
  const uncertain = (code: string): ExecutionResult => result('running', { ...(intent?.childTaskId ? { taskId: intent.childTaskId } : {}),
    status: 'unconfirmed', needsReconcile: true }, code);
  try {
    const access = await assertWorkflowSketchAccess(host, intent);
    if (intent) {
      assertIntent(intent, host); await prepare(intent.input, host, intent);
    } else {
      if (node.type !== 'ai-sketch-to-image' || node.id !== host.nodeId) fail('WORKFLOW_SKETCH_IMAGE_INPUT_INVALID');
      const imageDataUrl = await checked(host, undefined, () => readWorkflowSketchPng(node, inputs, host, access));
      const nonce = `workflow-sketch-image:${createHash('sha256').update(JSON.stringify([
        host.actorUserId, host.parentExecutionId, host.executionId, host.instanceId, host.attempt,
      ])).digest('hex')}`;
      const built = buildNodeExecutionRequest(node, { ...inputs, imageDataUrl }, { projectId: host.projectId, idempotencyKey: nonce });
      if (!built || built.endpoint !== '/api/sketch-to-image' || built.method !== 'POST') fail('WORKFLOW_SKETCH_IMAGE_INPUT_INVALID');
      const prepared = await prepare(built.body, host);
      if (!isDeepStrictEqual(access, prepared.access)) fail('WORKFLOW_SKETCH_IMAGE_SCOPE_CHANGED');
      intent = { version: 2, actorUserId: host.actorUserId, projectId: host.projectId, parentExecutionId: host.parentExecutionId,
        executionId: host.executionId, nodeId: host.nodeId, instanceId: host.instanceId, attempt: host.attempt,
        input: prepared.input, access: prepared.access, requestDigest: sketchImageRequestDigest(prepared.input) };
      assertIntent(intent, host); host.intents[host.instanceId] = intent;
      await checked(host, intent, () => host.checkpoint()); fresh = true;
    }
    let child = await originalChild(intent, host);
    if (!child) {
      intent.admissionUnknown = true;
      // Save the dispatch fence before POST. A crash/receipt loss never turns a saved intent into a fresh POST opportunity.
      await checked(host, intent, () => host.checkpoint());
      if (!fresh) return uncertain('WORKFLOW_SKETCH_IMAGE_ADMISSION_UNKNOWN');
      let admission: Awaited<ReturnType<typeof request>>;
      try { admission = await request('/api/sketch-to-image', { ...intent.input }, host, intent); }
      catch { return uncertain('WORKFLOW_SKETCH_IMAGE_ADMISSION_UNKNOWN'); }
      if (!admission.response.ok || admission.data.success !== true || typeof admission.data.taskId !== 'string') {
        return uncertain('WORKFLOW_SKETCH_IMAGE_ADMISSION_UNKNOWN');
      }
      child = await originalChild(intent, host);
      if (!child || child.identity.taskId !== admission.data.taskId) return uncertain('WORKFLOW_SKETCH_IMAGE_ADMISSION_UNKNOWN');
    }
    intent.childTaskId = child.identity.taskId; delete intent.admissionUnknown;
    await checked(host, intent, () => host.checkpoint());
    const original = child.identity, until = Date.now() + OBSERVATION_MS;
    for (;;) {
      const polled = await request('/api/poll-task', { taskId: original.taskId, projectId: original.projectId,
        imageProviderId: original.input.imageProviderId, model: original.input.imageModelId }, host, intent);
      if (!polled.response.ok) return uncertain('WORKFLOW_SKETCH_IMAGE_POLL_UNCONFIRMED');
      const safe = summary(polled.data, original);
      const current = await originalChild(intent, host);
      if (!current || !isDeepStrictEqual(current.identity, original)) fail('WORKFLOW_SKETCH_IMAGE_CHILD_IDENTITY_MISMATCH');
      if (polled.data.status === 'completed') {
        const output = completed(polled.data, original, safe); await guard(host, intent);
        return result('success', output);
      }
      if (['failed', 'cancelled', 'timeout'].includes(String(polled.data.status))) {
        return result('failed', safe, 'WORKFLOW_SKETCH_IMAGE_CHILD_TERMINAL');
      }
      await guard(host, intent); host.progress?.(result('running', safe));
      await checked(host, intent, () => host.checkpoint());
      if (polled.data.needsReconcile === true || Date.now() >= until) return uncertain('WORKFLOW_SKETCH_IMAGE_RECONCILE_PENDING');
      await checked(host, intent, () => new Promise<void>(resolve => setTimeout(resolve, 500)));
    }
  } catch (error) {
    // Never surface upstream messages, JSON errors, credentials, private input or a provider's code.
    const code = error instanceof HostFailure ? error.code : 'WORKFLOW_SKETCH_IMAGE_UNAVAILABLE';
    return intent?.admissionUnknown || intent?.childTaskId ? uncertain(code) : result('failed', undefined, code);
  }
}
/** Explicit owner cancellation is not a new write grant; no cancellation is inferred on host close/switch. */
export async function cancelWorkflowSketchImage(intent: WorkflowSketchImageIntent, host: Host): Promise<'confirmed' | 'winner' | 'unknown'> {
  try {
    const child = await originalChild(intent, host, false); if (!child) return 'unknown';
    const { response, data } = await request('/api/cancel-task', { taskId: child.identity.taskId, projectId: child.identity.projectId }, host, intent, false);
    if (hasPendingFlags(data)) return 'unknown';
    if (response.ok && data.success === true && data.taskId === child.identity.taskId && data.projectId === child.identity.projectId
      && data.type === 'sketch-to-image' && data.status === 'cancelled') return 'confirmed';
    if (response.status === 409) {
      const current = await originalChild(intent, host, false);
      if (current?.status === 'completed' && isDeepStrictEqual(current.identity, child.identity)) return 'winner';
    }
  } catch { /* Unknown cancellation never authorizes parent abort or another child/refund. */ }
  return 'unknown';
}
