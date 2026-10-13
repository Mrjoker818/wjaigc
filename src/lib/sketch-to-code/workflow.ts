import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildNodeExecutionRequest, parseWorkflowSketchDocumentReference, type WorkflowNode, type ExecutionResult } from '@/lib/workflow-engine';
import { getInternalApiUrl } from '@/lib/api-helpers';
import { getCloudTaskForUserByIdempotencyKey } from '@/lib/cloud-task-storage';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { resolveDocumentWorkspaceReference, resolvePersonalWorkspaceReference } from '@/lib/collaboration/document-workspace-reference';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { createConfiguredSketchDependencies } from './configured-dependencies';
import { prepareSketchCode, SketchInputError, type SketchCodeInput, type SketchCodePreparation } from './generation';
import { sketchTaskIdentity } from './task-http';

export interface WorkflowSketchIntent {
  version: 1; actorUserId: string; projectId: string; parentExecutionId: string;
  executionId: string; nodeId: string; instanceId: string; attempt: number;
  input: Readonly<SketchCodeInput>; access: SketchCodePreparation['access']; requestDigest: string;
  childTaskId?: string; admissionUnknown?: boolean;
}
export interface WorkflowSketchHost {
  actorUserId: string; projectId: string; parentExecutionId: string; executionId: string;
  nodeId: string; instanceId: string; attempt: number; headers: HeadersInit;
  intents: Record<string, WorkflowSketchIntent>;
  progress?(result: ExecutionResult): void;
  checkpoint(): Promise<void>; assertCurrent(): Promise<void>;
}
function digest(input: Readonly<SketchCodeInput>): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: input.projectId,
    imageDataUrl: input.imageDataUrl, instruction: input.instruction, providerId: input.providerId, modelId: input.modelId })).digest('hex');
}
function assertIntent(intent: WorkflowSketchIntent, host: WorkflowSketchHost): void {
  if (intent.version !== 1 || intent.actorUserId !== host.actorUserId || intent.projectId !== host.projectId
    || intent.parentExecutionId !== host.parentExecutionId || intent.executionId !== host.executionId
    || intent.nodeId !== host.nodeId || intent.instanceId !== host.instanceId || !Number.isSafeInteger(intent.attempt) || intent.attempt < 0
    || intent.input.projectId !== host.projectId || intent.requestDigest !== digest(intent.input)) throw new Error('WORKFLOW_SKETCH_INTENT_MISMATCH');
}
async function assertAccess(host: WorkflowSketchHost, intent?: Pick<WorkflowSketchIntent, 'access'>): Promise<SketchCodePreparation['access']> {
  await host.assertCurrent();
  const access = await authorizeGenerationProject({ actorUserId: host.actorUserId, projectId: host.projectId });
  await host.assertCurrent();
  if (access.kind === 'unscoped' || access.actorUserId !== host.actorUserId || access.projectId !== host.projectId
    || intent && !isDeepStrictEqual(access, intent.access)) throw new Error('WORKFLOW_SKETCH_SCOPE_CHANGED');
  return access;
}
async function managedPng(node: WorkflowNode, inputs: Record<string, unknown>, host: WorkflowSketchHost, access: SketchCodePreparation['access']): Promise<string> {
  const raw = inputs.imageDataUrl ?? inputs.imageUrl ?? inputs.image ?? node.config.imageUrl;
  const versionId = String(inputs.assetVersionId ?? node.config.assetVersionId ?? '');
  const placementId = String(inputs.assetVersionId !== undefined ? inputs.placementId ?? '' : node.config.placementId ?? '');
  if (!versionId) {
    if (typeof raw === 'string' && raw.startsWith('data:image/png;base64,')) return raw;
    throw new SketchInputError('SKETCH_IMAGE_INVALID');
  }
  await assertAccess(host, { access });
  const query = { projectId: host.projectId, assetVersionId: versionId, ...(placementId ? { placementId } : {}) };
  const reference = access.kind === 'document'
    ? await resolveDocumentWorkspaceReference(host.actorUserId, query)
    : await resolvePersonalWorkspaceReference(host.actorUserId, query);
  await assertAccess(host, { access });
  if (!reference || reference.kind !== 'image' || reference.assetVersionId !== versionId) throw new SketchInputError('SKETCH_IMAGE_INVALID');
  const storage = createPostgresAssetStorage();
  const version = await storage.read(async transaction => {
    const v = await transaction.findVersion(access.ownerId, host.projectId, versionId);
    if (!v || v.assetId !== reference.assetId) throw new SketchInputError('SKETCH_IMAGE_INVALID');
    const asset = await transaction.findAsset(access.ownerId, host.projectId, v.assetId);
    if (!asset || asset.status !== 'active' || asset.kind !== 'image' || v.file.mimeType !== 'image/png') throw new SketchInputError('SKETCH_IMAGE_INVALID');
    return v;
  });
  await assertAccess(host, { access });
  const media = await readManagedAssetVersionBytes(version, 'image', { maxBytes: 4 * 1024 * 1024, signal: AbortSignal.timeout(30_000) });
  await assertAccess(host, { access });
  if (media.mimeType !== 'image/png') throw new SketchInputError('SKETCH_IMAGE_INVALID');
  return `data:image/png;base64,${media.bytes.toString('base64')}`;
}
async function originalChild(intent: WorkflowSketchIntent, host: WorkflowSketchHost): Promise<string | null> {
  assertIntent(intent, host);
  const candidate = await getCloudTaskForUserByIdempotencyKey(host.actorUserId, intent.input.idempotencyKey);
  await host.assertCurrent();
  if (!candidate) { if (intent.childTaskId) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH'); return null; }
  try {
    const identity = sketchTaskIdentity(candidate, host.actorUserId);
    if (identity.task.requestDigest !== intent.requestDigest || identity.task.idempotencyKey !== intent.input.idempotencyKey
      || identity.task.projectId !== intent.projectId || identity.task.providerId !== intent.input.providerId || identity.task.model !== intent.input.modelId
      || !isDeepStrictEqual(identity.recovery.access, intent.access) || intent.childTaskId && intent.childTaskId !== identity.task.id) throw new Error();
    return identity.task.id;
  } catch { throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH'); }
}
function safeError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'WORKFLOW_SKETCH_SERVICE_UNAVAILABLE';
  const body = value as Record<string, unknown>;
  const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : body;
  return [error.code, error.message, error.phase, error.requestId ?? body.requestId]
    .filter((v): v is string => typeof v === 'string' && v.length <= 8192).join(' · ') || 'WORKFLOW_SKETCH_SERVICE_UNAVAILABLE';
}
async function request(endpoint: string, body: Record<string, unknown>, host: WorkflowSketchHost): Promise<{ response: Response; data: Record<string, unknown> }> {
  await host.assertCurrent();
  const response = await fetch(getInternalApiUrl(endpoint), { method: 'POST', headers: { ...Object.fromEntries(new Headers(host.headers)), 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  await host.assertCurrent();
  const value: unknown = await response.json(); await host.assertCurrent();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WORKFLOW_SKETCH_SERVICE_UNAVAILABLE');
  return { response, data: value as Record<string, unknown> };
}
/** No second admission, ledger or worker: original HTTP ports own those operations. */
export async function executeWorkflowSketch(node: WorkflowNode, inputs: Record<string, unknown>, host: WorkflowSketchHost): Promise<ExecutionResult> {
  const started = Date.now();
  let intent = host.intents[host.instanceId];
  const result = (status: ExecutionResult['status'], output?: Record<string, unknown>, error?: string): ExecutionResult =>
    ({ nodeId: host.nodeId, status, ...(output ? { output } : {}), ...(error ? { error } : {}), durationMs: Date.now() - started });
  const uncertain = (error: string): ExecutionResult => result('running', { taskId: intent?.childTaskId, status: 'unconfirmed', needsReconcile: true }, error);
  try {
    const access = await assertAccess(host, intent);
    if (intent) assertIntent(intent, host);
    else {
      const imageDataUrl = await managedPng(node, inputs, host, access); await host.assertCurrent();
      const nonce = `workflow-sketch:${createHash('sha256').update(JSON.stringify([host.actorUserId, host.parentExecutionId, host.executionId, host.instanceId, host.attempt])).digest('hex')}`;
      const built = buildNodeExecutionRequest(node, { ...inputs, imageDataUrl }, { projectId: host.projectId, idempotencyKey: nonce });
      if (!built || built.endpoint !== '/api/sketch-to-code') throw new Error('WORKFLOW_SKETCH_INPUT_INVALID');
      const prepared = await prepareSketchCode(built.body, createConfiguredSketchDependencies(), { actorUserId: host.actorUserId, signal: AbortSignal.timeout(30_000) });
      await host.assertCurrent();
      if (!isDeepStrictEqual(access, prepared.access)) throw new Error('WORKFLOW_SKETCH_SCOPE_CHANGED');
      intent = { version: 1, actorUserId: host.actorUserId, projectId: host.projectId, parentExecutionId: host.parentExecutionId,
        executionId: host.executionId, nodeId: host.nodeId, instanceId: host.instanceId, attempt: host.attempt,
        input: Object.freeze({ ...prepared.input }), access: Object.freeze({ ...prepared.access }), requestDigest: digest(prepared.input) };
      host.intents[host.instanceId] = intent;
      await host.checkpoint(); await assertAccess(host, intent);
    }
    // Current exact catalog and CPU preparation are revalidated on recovery too, never inferred from a name.
    if (intent.childTaskId || intent.admissionUnknown) {
      await prepareSketchCode(intent.input, createConfiguredSketchDependencies(), { actorUserId: host.actorUserId, signal: AbortSignal.timeout(30_000) });
      await assertAccess(host, intent);
    }
    let childId = await originalChild(intent, host); await assertAccess(host, intent);
    if (!childId) {
      let admitted: Awaited<ReturnType<typeof request>>;
      try { admitted = await request('/api/sketch-to-code', { ...intent.input }, host); }
      catch { intent.admissionUnknown = true; await host.checkpoint(); return uncertain('WORKFLOW_SKETCH_ADMISSION_UNKNOWN'); }
      await assertAccess(host, intent);
      if (!admitted.response.ok || admitted.data.success !== true) {
        if (admitted.response.status >= 500) { intent.admissionUnknown = true; await host.checkpoint(); return uncertain(safeError(admitted.data)); }
        return result('failed', undefined, safeError(admitted.data));
      }
      childId = await originalChild(intent, host); await assertAccess(host, intent);
      if (!childId || admitted.data.taskId !== childId) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH');
    }
    intent.childTaskId = childId; delete intent.admissionUnknown;
    await host.checkpoint(); await assertAccess(host, intent);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await assertAccess(host, intent);
      if (await originalChild(intent, host) !== childId) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH');
      const { response, data } = await request('/api/poll-task', { taskId: childId, projectId: intent.projectId, providerId: intent.input.providerId, model: intent.input.modelId }, host);
      await assertAccess(host, intent);
      if (!response.ok || data.success !== true) return uncertain(safeError(data));
      if (data.type !== 'sketch-to-code' || data.taskId !== childId || data.projectId !== intent.projectId
        || data.providerId !== intent.input.providerId || data.modelId !== intent.input.modelId
        || typeof data.progress !== 'number' || !Number.isFinite(data.progress) || data.progress < 0 || data.progress > 100) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH');
      const output: Record<string, unknown> = { taskId: childId, projectId: intent.projectId, providerId: intent.input.providerId,
        modelId: intent.input.modelId, status: data.status, progress: data.progress,
        ...(data.phase === 'analysis' || data.phase === 'reconstruction' ? { phase: data.phase } : {}),
        ...(data.needsReconcile === true ? { needsReconcile: true } : {}) };
      if (data.status === 'completed') {
        const reference = parseWorkflowSketchDocumentReference({ ...data, kind: 'document-reference' });
        if (!reference) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH');
        // Original frozen PNG, not a rendered page screenshot; HTML is never copied from poll.
        return result('success', { ...output, documentReference: reference, imageUrl: intent.input.imageDataUrl,
          assetId: reference.previewAssetId, assetVersionId: reference.previewAssetVersionId, sourceRole: 'input-sketch' });
      }
      if (['failed', 'cancelled', 'timeout'].includes(String(data.status))) return result('failed', { ...output, refunded: data.refunded === true }, safeError(data));
      if (!['pending', 'processing', 'submitting'].includes(String(data.status))) throw new Error('WORKFLOW_SKETCH_CHILD_IDENTITY_MISMATCH');
      // Persist progress through the same host; no task map is introduced.
      host.progress?.(result('running', output));
      await host.checkpoint(); await assertAccess(host, intent);
      await new Promise<void>(resolve => setTimeout(resolve, 500)); await assertAccess(host, intent);
    }
    return uncertain('WORKFLOW_SKETCH_OBSERVATION_TIMEOUT');
  } catch (error) {
    const message = error instanceof SketchInputError ? error.code
      : error instanceof Error && /^WORKFLOW_|^SKETCH_/.test(error.message) ? error.message : 'WORKFLOW_SKETCH_SERVICE_UNAVAILABLE';
    return intent && !message.includes('IDENTITY_MISMATCH') && !message.includes('INTENT_MISMATCH') ? uncertain(message) : result('failed', undefined, message);
  }
}
export async function cancelWorkflowSketch(intent: WorkflowSketchIntent, host: WorkflowSketchHost): Promise<'confirmed' | 'winner' | 'unknown'> {
  try {
    // Explicit original actor cancellation deliberately does not require a current write grant.
    const childId = await originalChild(intent, host);
    if (!childId) return 'unknown';
    const { response, data } = await request('/api/cancel-task', { taskId: childId, projectId: intent.projectId }, host);
    if (response.status === 409) return 'winner';
    if (response.status === 200 && data.success === true && data.taskId === childId && data.projectId === intent.projectId && data.status === 'cancelled') return 'confirmed';
    return 'unknown';
  } catch { return 'unknown'; }
}
