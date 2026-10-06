import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { ensureCloudTaskTables } from '@/lib/cloud-task-storage';
import type { ImageEditProviderAccepted, ImageEditProviderExecution, ImageEditProviderIdentity } from '@/lib/image-edit-provider-boundary';

export interface ImageEditPhaseSpec {
  phaseId: string;
  inputDigest: string;
  targets: readonly ImageEditProviderIdentity[];
}
export interface ImageEditPhaseOwner {
  taskId: string;
  actorUserId: string;
  projectId: string;
  requestDigest: string;
  leaseOwner: string;
}
export type ImageEditPhaseOpenResult =
  | { status: 'ready'; boundary: ImageEditProviderExecution }
  | { status: 'accepted'; identity: ImageEditProviderIdentity; result: ImageEditProviderAccepted }
  | { status: 'submission-unknown' };
export interface OpenImageEditProviderPhaseInput extends ImageEditPhaseOwner {
  phase: ImageEditPhaseSpec;
  beforeDispatch: () => Promise<void>;
  transactionalSourceCheck?: (client: PoolClient) => Promise<void>;
  transport?: typeof fetch;
  signal?: AbortSignal;
  secretValues?: readonly string[];
}

interface AttemptBase {
  attemptId: string;
  identity: ImageEditProviderIdentity;
  endpoint: string;
  method: 'POST';
  bodyDigest: string;
  leaseOwner: string;
  leaseAttempt: number;
}
export interface PhaseRejection {
  status: number;
  code: string;
  message: string;
}
type Attempt = AttemptBase & (
  | { status: 'started' }
  | { status: 'rejected'; rejection: PhaseRejection }
  | { status: 'accepted'; result: ImageEditProviderAccepted }
);
interface Phase extends ImageEditPhaseSpec { attempts: Attempt[] }
interface Checkpoint { version: 1; requestDigest: string; phases: Phase[] }
export interface PhaseSession extends ImageEditPhaseOwner { phase: ImageEditPhaseSpec; leaseAttempt: number }
type StoredOpenResult = Exclude<ImageEditPhaseOpenResult, { status: 'ready' }> | { status: 'ready'; session: PhaseSession };
const limit = 16 * 1024 * 1024;

function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid image edit phase checkpoint or identity');
}
function record(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  requireValue(Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)));
}
function nonempty(value: unknown, max = Infinity): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'));
}
function sha(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
export function capturePhaseIdentity(value: ImageEditProviderIdentity): ImageEditProviderIdentity {
  const raw = record(value);
  nonempty(raw.providerId, 512); nonempty(raw.modelId, 512);
  requireValue(raw.kind === 'image' || raw.kind === 'vision' || raw.kind === 'upscale');
  return Object.freeze({ providerId: raw.providerId, modelId: raw.modelId, kind: raw.kind });
}
export function samePhaseIdentity(a: ImageEditProviderIdentity, b: ImageEditProviderIdentity): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.kind === b.kind;
}
export function capturePhaseSpec(value: ImageEditPhaseSpec): ImageEditPhaseSpec {
  const raw = record(value);
  requireValue(typeof raw.phaseId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.phaseId));
  sha(raw.inputDigest);
  requireValue(Array.isArray(raw.targets) && raw.targets.length > 0);
  // Array.from visits holes too; Array#map/every would silently serialize a sparse target as null.
  const targets = Array.from(raw.targets, (target: ImageEditProviderIdentity): ImageEditProviderIdentity => capturePhaseIdentity(target));
  requireValue(targets.every(target => target.kind === targets[0].kind));
  requireValue(new Set(targets.map(target => JSON.stringify(target))).size === targets.length);
  return Object.freeze({ phaseId: raw.phaseId, inputDigest: raw.inputDigest, targets: Object.freeze(targets) });
}
export function capturePhaseOwner(value: ImageEditPhaseOwner): ImageEditPhaseOwner {
  const { taskId, actorUserId, projectId, requestDigest, leaseOwner } = value;
  for (const field of [taskId, actorUserId, leaseOwner]) nonempty(field);
  // Unscoped image edits persist the project as an empty string in cloud_tasks.
  requireValue(typeof projectId === 'string' && projectId.length <= 256 && !projectId.includes('\0'));
  sha(requestDigest);
  return Object.freeze({ taskId, actorUserId, projectId, requestDigest, leaseOwner });
}
export function capturePhaseResult(value: ImageEditProviderAccepted, kind: ImageEditProviderIdentity['kind']): ImageEditProviderAccepted {
  const raw = record(value);
  if (kind === 'vision') {
    keys(raw, ['kind', 'text']);
    requireValue(raw.kind === 'vision'); nonempty(raw.text);
    return Object.freeze({ kind: 'vision', text: raw.text });
  }
  keys(raw, ['kind', 'taskId', 'directUrl', 'managedExport', 'width', 'height']);
  requireValue(raw.kind === 'image' && ('taskId' in raw || 'directUrl' in raw));
  const result: { kind: 'image'; taskId?: string; directUrl?: string; managedExport?: true; width?: number; height?: number } = { kind: 'image' };
  for (const field of ['taskId', 'directUrl'] as const) {
    if (field in raw) { nonempty(raw[field]); result[field] = raw[field]; }
  }
  if ('managedExport' in raw) {
    requireValue(raw.managedExport === true && typeof result.directUrl === 'string'
      && result.directUrl.startsWith('/api/serve-upload/exports/'));
    result.managedExport = true;
  }
  for (const field of ['width', 'height'] as const) {
    if (field in raw) {
      requireValue(typeof raw[field] === 'number' && Number.isFinite(raw[field]) && raw[field] > 0);
      result[field] = raw[field];
    }
  }
  return Object.freeze(result);
}
function encoded(checkpoint: Checkpoint): string {
  const json = JSON.stringify(checkpoint);
  requireValue(Buffer.byteLength(json, 'utf8') <= limit);
  return json;
}
function readCheckpoint(result: unknown, requestDigest: string): Checkpoint {
  const root = record(result);
  if (!Object.hasOwn(root, 'imageEditExecution')) return { version: 1, requestDigest, phases: [] };
  const raw = record(root.imageEditExecution);
  keys(raw, ['version', 'requestDigest', 'phases']);
  requireValue(raw.version === 1 && raw.requestDigest === requestDigest && Array.isArray(raw.phases));
  requireValue(Buffer.byteLength(JSON.stringify(raw), 'utf8') <= limit);
  const phaseIds = new Set<string>();
  const attemptIds = new Set<string>();
  let started = 0;
  const phases = raw.phases.map((value: unknown): Phase => {
    const phase = record(value);
    keys(phase, ['phaseId', 'inputDigest', 'targets', 'attempts']);
    const spec = capturePhaseSpec(phase as unknown as ImageEditPhaseSpec);
    for (const target of phase.targets as unknown[]) keys(record(target), ['providerId', 'modelId', 'kind']);
    requireValue(!phaseIds.has(spec.phaseId)); phaseIds.add(spec.phaseId);
    requireValue(Array.isArray(phase.attempts));
    const attempts = phase.attempts.map((value: unknown, index: number): Attempt => {
      const attempt = record(value);
      keys(attempt, ['attemptId', 'identity', 'endpoint', 'method', 'bodyDigest', 'leaseOwner', 'leaseAttempt', 'status',
        ...(attempt.status === 'rejected' ? ['rejection'] : attempt.status === 'accepted' ? ['result'] : [])]);
      nonempty(attempt.attemptId); requireValue(!attemptIds.has(attempt.attemptId)); attemptIds.add(attempt.attemptId);
      nonempty(attempt.leaseOwner);
      requireValue(Number.isSafeInteger(attempt.leaseAttempt) && Number(attempt.leaseAttempt) > 0);
      nonempty(attempt.endpoint);
      const endpoint = new URL(attempt.endpoint);
      requireValue(['https:', 'http:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
      requireValue(attempt.method === 'POST'); sha(attempt.bodyDigest);
      const identity = capturePhaseIdentity(attempt.identity as ImageEditProviderIdentity);
      keys(record(attempt.identity), ['providerId', 'modelId', 'kind']);
      requireValue(spec.targets.some(target => samePhaseIdentity(target, identity)));
      const base: AttemptBase = { attemptId: attempt.attemptId, identity, endpoint: attempt.endpoint, method: 'POST',
        bodyDigest: attempt.bodyDigest, leaseOwner: attempt.leaseOwner, leaseAttempt: Number(attempt.leaseAttempt) };
      if (attempt.status === 'rejected') {
        const rejection = record(attempt.rejection);
        keys(rejection, ['status', 'code', 'message']);
        requireValue(Number.isInteger(rejection.status) && Number(rejection.status) >= 400 && Number(rejection.status) < 500);
        nonempty(rejection.code, 128); nonempty(rejection.message, 512);
        return { ...base, status: 'rejected', rejection: { status: Number(rejection.status), code: rejection.code, message: rejection.message } };
      }
      requireValue(index === (phase.attempts as unknown[]).length - 1);
      if (attempt.status === 'accepted') return { ...base, status: 'accepted', result: capturePhaseResult(attempt.result as ImageEditProviderAccepted, identity.kind) };
      requireValue(attempt.status === 'started'); started++;
      return { ...base, status: 'started' };
    });
    return { ...spec, attempts };
  });
  requireValue(started <= 1);
  return { version: 1, requestDigest, phases };
}
function phaseFor(checkpoint: Checkpoint, spec: ImageEditPhaseSpec): Phase | undefined {
  const phase = checkpoint.phases.find(phase => phase.phaseId === spec.phaseId);
  if (phase) requireValue(phase.inputDigest === spec.inputDigest && phase.targets.length === spec.targets.length
    && phase.targets.every((target, index) => samePhaseIdentity(target, spec.targets[index])));
  return phase;
}
function hasStarted(checkpoint: Checkpoint): boolean {
  return checkpoint.phases.some(phase => phase.attempts.some(attempt => attempt.status === 'started'));
}

/** Read only a durably accepted result; never infer acceptance from a sent POST. */
export function readAcceptedImageEditPhaseResult(result: unknown, requestDigest: string, phaseId: string):
  { identity: ImageEditProviderIdentity; result: ImageEditProviderAccepted } | null {
  sha(requestDigest);
  const checkpoint = readCheckpoint(result, requestDigest);
  if (hasStarted(checkpoint)) return null;
  const phase = checkpoint.phases.find(item => item.phaseId === phaseId);
  const accepted = phase?.attempts.filter(attempt => attempt.status === 'accepted') ?? [];
  if (accepted.length !== 1 || accepted[0].status !== 'accepted') return null;
  return { identity: accepted[0].identity, result: accepted[0].result };
}

// The only transaction helper here is private to this checkpoint. The optional
// source check is deliberately run under the task lock for the started write.
async function transact<T>(owner: ImageEditPhaseOwner, leaseAttempt: number | undefined,
  operation: (checkpoint: Checkpoint, generation: number, client: PoolClient) =>
    { value: T; write: boolean } | Promise<{ value: T; write: boolean }>): Promise<T> {
  await ensureCloudTaskTables();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(`SELECT *, lease_expires_at > EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS live
      FROM cloud_tasks WHERE id=$1 FOR UPDATE`, [owner.taskId]);
    const row = selected.rows[0];
    requireValue(row && row.user_id === owner.actorUserId && row.project_id === owner.projectId
      && row.request_digest === owner.requestDigest && ['image-edit', 'upscale'].includes(row.type)
      && row.status === 'processing' && row.lease_owner === owner.leaseOwner && row.live === true
      && Number.isSafeInteger(row.attempt_count) && row.attempt_count > 0
      && (leaseAttempt === undefined || row.attempt_count === leaseAttempt));
    const checkpoint = readCheckpoint(row.result, owner.requestDigest);
    const outcome = await operation(checkpoint, row.attempt_count, client);
    if (outcome.write) {
      const updated = await client.query(`UPDATE cloud_tasks
        SET result=jsonb_set(result, '{imageEditExecution}', $7::jsonb), revision=revision+1,
            updated_at=(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
        WHERE id=$1 AND user_id=$2 AND project_id=$3 AND request_digest=$4
          AND lease_owner=$5 AND attempt_count=$6 AND status='processing' AND type IN ('image-edit','upscale')
          AND lease_expires_at > EXTRACT(EPOCH FROM clock_timestamp()) * 1000
        RETURNING id`, [owner.taskId, owner.actorUserId, owner.projectId, owner.requestDigest,
        owner.leaseOwner, row.attempt_count, encoded(checkpoint)]);
      requireValue(updated.rowCount === 1);
    }
    await client.query('COMMIT');
    return outcome.value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function openPhaseCheckpoint(owner: ImageEditPhaseOwner, spec: ImageEditPhaseSpec): Promise<StoredOpenResult> {
  return transact<StoredOpenResult>(owner, undefined, (checkpoint, generation) => {
    let phase = phaseFor(checkpoint, spec);
    if (hasStarted(checkpoint)) return { value: { status: 'submission-unknown' }, write: false };
    const accepted = phase?.attempts.find(attempt => attempt.status === 'accepted');
    if (accepted?.status === 'accepted') return { value: { status: 'accepted', identity: accepted.identity, result: accepted.result }, write: false };
    const write = !phase;
    if (!phase) { phase = { ...spec, attempts: [] }; checkpoint.phases.push(phase); }
    return { value: { status: 'ready', session: Object.freeze({ ...owner, phase: spec, leaseAttempt: generation }) }, write };
  });
}

export async function startPhaseAttempt(session: PhaseSession, identity: ImageEditProviderIdentity,
  endpoint: string, bodyDigest: string, transactionalSourceCheck?: (client: PoolClient) => Promise<void>): Promise<string> {
  return transact(session, session.leaseAttempt, async (checkpoint, _generation, client) => {
    const phase = phaseFor(checkpoint, session.phase);
    requireValue(phase && !hasStarted(checkpoint) && !phase.attempts.some(attempt => attempt.status !== 'rejected'));
    requireValue(phase.targets.some(target => samePhaseIdentity(target, identity)));
    if (transactionalSourceCheck) await transactionalSourceCheck(client);
    const attemptId = randomUUID();
    phase.attempts.push({ attemptId, identity, endpoint, method: 'POST', bodyDigest, status: 'started',
      leaseOwner: session.leaseOwner, leaseAttempt: session.leaseAttempt });
    return { value: attemptId, write: true };
  });
}

export async function finishPhaseAttempt(session: PhaseSession, attemptId: string, identity: ImageEditProviderIdentity,
  outcome: { status: 'accepted'; result: ImageEditProviderAccepted } | { status: 'rejected'; rejection: PhaseRejection }): Promise<void> {
  await transact(session, session.leaseAttempt, checkpoint => {
    const phase = phaseFor(checkpoint, session.phase);
    const index = phase?.attempts.findIndex(attempt => attempt.attemptId === attemptId) ?? -1;
    const attempt = phase?.attempts[index];
    requireValue(phase && attempt?.status === 'started' && samePhaseIdentity(attempt.identity, identity)
      && attempt.leaseOwner === session.leaseOwner && attempt.leaseAttempt === session.leaseAttempt);
    phase.attempts[index] = { ...attempt, ...outcome };
    return { value: undefined, write: true };
  });
}
