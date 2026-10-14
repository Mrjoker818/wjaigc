import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type { CloudTaskLease } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import { assertSketchProjectFence } from './admission';
import { assertSketchImageTaskRow, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { parseStoredSketchImageReceipt, type SketchImageAnalysisResponse, type SketchImageDraft, type SketchImageReceipt } from './image-generation';
import { parseSketchImageAnalysis, type SketchImageAnalysis } from './image-contract';
import { parseSketchTokenUsage, type SketchStageResponse } from './usage';
import { quoteSketchImageSettlement } from './image-pricing';
import { lockSketchImageLedger } from './image-ledger';
import { sketchFields } from './http';
import { runSketchStage } from './stage';
export interface SketchImageRouting { readonly vision: string; readonly image: string }
export interface SketchImageCheckpointInput {
  readonly identity: Readonly<SketchImageTaskIdentity>; readonly lease: Readonly<CloudTaskLease>; readonly routing: Readonly<SketchImageRouting>;
  readonly phase: 'analysis' | 'analysis-complete' | 'generation' | 'accepted'; readonly signal: AbortSignal;
  readonly response?: SketchImageAnalysisResponse; readonly draft?: Readonly<SketchImageDraft>;
}
export interface SketchImageCheckpointDependencies {
  connect?: () => Promise<PoolClient>;
  assertProjectFence?: (client: PoolClient, access: SketchImageTaskIdentity['access']) => Promise<void>;
  checkCurrent?: (identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal) => Promise<Readonly<SketchImageRouting>>;
}
export interface SketchImageCheckpoint {
  readonly version: 1; readonly phase: SketchImageCheckpointInput['phase']; readonly routing: Readonly<SketchImageRouting>;
  readonly analysis?: SketchImageAnalysis; readonly usage?: SketchStageResponse['usage']; readonly receipt?: Readonly<SketchImageReceipt>;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function routing(value: unknown): Readonly<SketchImageRouting> {
  const raw = sketchFields(value, ['vision', 'image']);
  if (Object.keys(raw).length !== 2 || typeof raw.vision !== 'string' || typeof raw.image !== 'string'
    || !/^[a-f0-9]{64}$/.test(raw.vision) || !/^[a-f0-9]{64}$/.test(raw.image)) throw new Error('SKETCH_IMAGE_ROUTING_INVALID');
  return Object.freeze({ vision: raw.vision, image: raw.image });
}
function analysisResponse(value: unknown): SketchImageAnalysisResponse {
  const raw = sketchFields(value, ['analysis', 'usage']);
  return Object.freeze({ analysis: parseSketchImageAnalysis(raw.analysis), ...(Object.hasOwn(raw, 'usage') ? { usage: parseSketchTokenUsage(raw.usage) } : {}) });
}
/** Private database checkpoint validation. No model call, current access, or publication permission. */
export function readSketchImageCheckpoint(value: unknown, identity: Readonly<SketchImageTaskIdentity>): Readonly<SketchImageCheckpoint> | undefined {
  if (value === undefined) return undefined;
  const raw = sketchFields(value, ['version', 'phase', 'routing', 'analysis', 'usage', 'receipt']);
  if (raw.version !== 1 || typeof raw.phase !== 'string' || !['analysis', 'analysis-complete', 'generation', 'accepted'].includes(raw.phase)) throw new Error();
  const phase = raw.phase as SketchImageCheckpointInput['phase'], route = routing(raw.routing);
  if (phase === 'analysis') {
    if (Object.keys(raw).length !== 3) throw new Error();
    return Object.freeze({ version: 1, phase, routing: route });
  }
  const response = analysisResponse({ analysis: raw.analysis, ...(Object.hasOwn(raw, 'usage') ? { usage: raw.usage } : {}) });
  // Restoration keeps the same original pricing/real-usage invariant as admission
  // to a paid generation phase; this is validation, not a credit adjustment.
  quoteSketchImageSettlement(identity.pricing, response.usage);
  if (Object.keys(raw).length !== 4 + (Object.hasOwn(raw, 'usage') ? 1 : 0) + (phase === 'accepted' ? 1 : 0)) throw new Error();
  if (phase !== 'accepted' && Object.hasOwn(raw, 'receipt')) throw new Error();
  const receipt = phase === 'accepted' ? parseStoredSketchImageReceipt(raw.receipt,
    { providerId: identity.input.imageProviderId, modelId: identity.input.imageModelId }) : undefined;
  return Object.freeze({ version: 1, phase, routing: route, ...response, ...(receipt ? { receipt } : {}) });
}
function nextCheckpoint(input: SketchImageCheckpointInput, previous: Readonly<SketchImageCheckpoint> | undefined): Readonly<SketchImageCheckpoint> {
  const route = routing(input.routing), common = { version: 1 as const, phase: input.phase, routing: route };
  if (previous && !isDeepStrictEqual(previous.routing, route)) throw new Error();
  if (input.phase === 'analysis') {
    if (previous || input.response !== undefined || input.draft !== undefined || input.lease.attemptCount !== 1) throw new Error();
    return Object.freeze(common);
  }
  if (input.phase === 'analysis-complete') {
    if (previous?.phase !== 'analysis' || input.draft !== undefined) throw new Error();
    const response = analysisResponse(input.response);
    // Missing real token usage must stop BEFORE the paid image POST, never fake zero.
    quoteSketchImageSettlement(input.identity.pricing, response.usage);
    return Object.freeze({ ...common, ...response });
  }
  if (input.phase === 'generation') {
    if (previous?.phase !== 'analysis-complete' || input.response !== undefined || input.draft !== undefined) throw new Error();
    return Object.freeze({ ...previous, ...common });
  }
  if (input.phase === 'accepted') {
    if (previous?.phase !== 'generation' || input.response !== undefined) throw new Error();
    const raw = sketchFields(input.draft, ['analysis', 'usage', 'receipt']);
    const response = analysisResponse({ analysis: raw.analysis, ...(Object.hasOwn(raw, 'usage') ? { usage: raw.usage } : {}) });
    if (!isDeepStrictEqual(response.analysis, previous.analysis) || !isDeepStrictEqual(response.usage, previous.usage)) throw new Error();
    const receipt = parseStoredSketchImageReceipt(raw.receipt, { providerId: input.identity.input.imageProviderId, modelId: input.identity.input.imageModelId });
    return Object.freeze({ ...common, ...response, receipt });
  }
  throw new Error();
}
/** Serialized original transaction. Never release/race a busy database query.
 * ACK loss is unconfirmed: it permits neither another POST nor an automatic refund.
 * This function is a trusted worker seam, never a public input or new task authority. */
export async function persistSketchImageCheckpoint(inputValue: SketchImageCheckpointInput,
  dependencies: SketchImageCheckpointDependencies = {}): Promise<void> {
  inputValue.signal.throwIfAborted();
  const input = Object.freeze({ ...freeze(structuredClone({ identity: inputValue.identity, lease: inputValue.lease, routing: inputValue.routing,
    phase: inputValue.phase, ...(inputValue.response !== undefined ? { response: inputValue.response } : {}),
    ...(inputValue.draft !== undefined ? { draft: inputValue.draft } : {}) })), signal: inputValue.signal });
  const checkCurrent = dependencies.checkCurrent, fence = dependencies.assertProjectFence || assertSketchProjectFence;
  const connect = dependencies.connect || (() => getPool().connect());
  const deadline = Math.min(input.lease.expiresAt, Date.now() + 10_000);
  let raw: PoolClient | undefined, began = false, committing = false, discard = false;
  const guard = (): void => { if (input.signal.aborted || Date.now() >= deadline) throw new Error('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED'); };
  try {
    guard(); routing(input.routing);
    if ((input.phase === 'analysis' || input.phase === 'generation') && typeof checkCurrent !== 'function') throw new Error();
    raw = await connect(); guard();
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        guard(); const result: unknown = await Reflect.apply(target.query, target, args); guard(); return result;
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    began = true; await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const row = (await client.query<SketchImageTaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [input.identity.taskId])).rows[0];
    // Preliminary identity check only; final authority is the DB clock AFTER every lock.
    assertSketchImageTaskRow(row, input.identity, input.lease, 0, deadline);
    await fence(client, input.identity.access);
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    // The exact original row/input/quote was verified above. Adapt only the
    // canonical SQL NUMERIC reserve; original ledger INTEGER rules stay strict.
    await lockSketchImageLedger(client, { ...row, credit_cost: input.identity.pricing.totalReserveCredits });
    const dbGuard = async (): Promise<SketchImageTaskRow> => {
      const current = (await client.query<SketchImageTaskRow & { now_ms: string }>(
        'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [input.identity.taskId])).rows[0];
      assertSketchImageTaskRow(current, input.identity, input.lease, current?.now_ms, deadline); guard(); return current;
    };
    const current = await dbGuard();
    const previous = readSketchImageCheckpoint(current.result.sketchImageExecution, input.identity);
    const next = nextCheckpoint(input, previous);
    if (input.phase === 'analysis' || input.phase === 'generation') {
      const currentRouting = routing(await runSketchStage(signal => checkCurrent!(input.identity, signal), input.signal,
        Math.max(1, Math.min(5000, deadline - Date.now())))); guard();
      if (!isDeepStrictEqual(currentRouting, input.routing)) throw new Error();
    }
    await dbGuard();
    const labels = { analysis: ['草图生图：分析中', 10], 'analysis-complete': ['草图生图：分析完成', 35], generation: ['草图生图：生成中', 55], accepted: ['草图生图：等待结果', 70] } as const;
    const [label, progress] = labels[input.phase];
    const updated = await client.query<{ result: Record<string, unknown> }>(`UPDATE cloud_tasks SET
      result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('sketchImageExecution',$2::jsonb), label=$3,progress=$4,
      revision=revision+1,updated_at=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
      WHERE id=$1 AND type='sketch-to-image' AND status='processing' AND lease_owner=$5 AND attempt_count=$6
      AND lease_expires_at=$7 AND lease_expires_at>(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint RETURNING result`,
    [input.identity.taskId, JSON.stringify(next), label, progress, input.lease.owner, input.lease.attemptCount, input.lease.expiresAt]);
    if (updated.rows.length !== 1 || !isDeepStrictEqual(readSketchImageCheckpoint(updated.rows[0].result.sketchImageExecution, input.identity), next)) throw new Error();
    await dbGuard(); guard(); committing = true; await client.query('COMMIT');
  } catch {
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    throw new Error('SKETCH_IMAGE_CHECKPOINT_UNCONFIRMED');
  } finally { raw?.release(discard); }
}
