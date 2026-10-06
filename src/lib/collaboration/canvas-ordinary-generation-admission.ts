import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { createAnnotationRequestHash } from '@/lib/annotation-idempotency';
import { authorizeAgentContext, resolveAgentMediaUrls, AgentContextNotFoundError } from '@/lib/agent-runtime/context-adapters';
import { getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import type { GenerationProjectAccess } from './generation-project-access';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal } from './task-publication-intent';
import { CanvasTaskPublicationError, prepareCanvasTaskPublicationInTransaction,
  readOrdinaryPublicationSourceSnapshot,
  type CanvasTaskPublicationInput, type CanvasSingleTaskIdentity } from './task-publication';

export class CanvasOrdinaryAdmissionError extends Error {
  constructor(readonly status: number, readonly code: string, message = '普通生成请求、来源或授权不符合要求') {
    super(message); this.name = 'CanvasOrdinaryAdmissionError';
  }
}
function classify(error: unknown): CanvasOrdinaryAdmissionError {
  if (error instanceof CanvasOrdinaryAdmissionError) return error;
  if (error instanceof CanvasPublicationIntentError) return new CanvasOrdinaryAdmissionError(400, 'CANVAS_ORDINARY_INVALID');
  if (error instanceof AgentContextNotFoundError) return new CanvasOrdinaryAdmissionError(403, 'CANVAS_ORDINARY_SOURCE_FORBIDDEN');
  if (error instanceof CanvasTaskPublicationError) return new CanvasOrdinaryAdmissionError(error.status, error.code);
  return new CanvasOrdinaryAdmissionError(503, 'CANVAS_ORDINARY_UNAVAILABLE');
}
export function ordinaryReferenceUrls(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CanvasOrdinaryAdmissionError(400, 'CANVAS_ORDINARY_INVALID_REFERENCE');
  return value.flatMap((item: unknown): string[] => {
    const url = typeof item === 'string' ? item
      : item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>).url : undefined;
    if (typeof url !== 'string') throw new CanvasOrdinaryAdmissionError(400, 'CANVAS_ORDINARY_INVALID_REFERENCE');
    return url.trim() ? [url] : [];
  });
}
export function canvasOrdinaryRequestDigest(body: Record<string, unknown>): string {
  return createAnnotationRequestHash({ route: '/api/generate', version: 1, body });
}
export function parseCanvasOrdinaryPublication(access: Extract<GenerationProjectAccess, { kind: 'document' }>, body: Record<string, unknown>): CanvasTaskPublicationInput {
  try {
    const workspaceId = body.assetWorkspaceId === undefined ? access.projectId : body.assetWorkspaceId;
    if ((workspaceId !== access.projectId && workspaceId !== `canvas:${access.projectId}`)
      || body._skipCredits || body.skipCredits || body._skipCloudTaskPersistence) throw new CanvasPublicationIntentError();
    const intent = parseCanvasPublicationIntentProposal({ parentVersionIds: body.assetParentVersionIds ?? [],
      projectionMode: body.assetProjectionMode ?? 'derived',
      placement: { action: 'append', selectedEntityIds: body.assetSelectedEntityIds ?? [] } });
    if (intent.parentVersionIds.length !== ordinaryReferenceUrls(body.referenceImages).length) throw new CanvasPublicationIntentError();
    return { access, workspace: 'canvas', workspaceId: access.projectId, singleAdmission: 'generate', intent };
  } catch (error) { throw classify(error); }
}
export async function readCanvasOrdinaryTask(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity): Promise<CloudTask | null> {
  try {
    const task = await getCloudTaskForUserByIdempotencyKey(publication.access.actorUserId, identity.idempotencyKey);
    if (task && (task.type !== 'generate' || task.projectId !== publication.access.projectId
      || task.idempotencyKey !== identity.idempotencyKey || task.requestDigest !== identity.requestDigest)) {
      throw new CanvasOrdinaryAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return task;
  } catch (error) { throw classify(error); }
}
function mediaIdentity(value: string, origin: string): string {
  if (!value || value.trim() !== value || value.includes('\\') || value.startsWith('//')) throw new CanvasPublicationIntentError();
  const url = new URL(value, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password || url.hash) throw new CanvasPublicationIntentError();
  return url.href;
}
export async function validateCanvasOrdinarySources(publication: CanvasTaskPublicationInput, body: Record<string, unknown>, origin: string): Promise<string[]> {
  try {
    const proposal = parseCanvasPublicationIntentProposal(publication.intent);
    const actual = ordinaryReferenceUrls(body.referenceImages).map(url => mediaIdentity(url, origin));
    if (actual.length !== proposal.parentVersionIds.length) throw new CanvasPublicationIntentError();
    if (!actual.length) { publication.ordinarySourceSnapshot ??= []; return []; }
    const { access } = publication;
    const initialSnapshot = publication.ordinarySourceSnapshot ?? await readOrdinaryPublicationSourceSnapshot(
      getPool(), access.ownerId, access.projectId, proposal.parentVersionIds, false);
    const context = await authorizeAgentContext({ actorUserId: access.actorUserId, request: {
      projectId: access.projectId, workspace: 'canvas', workspaceId: access.projectId,
      mode: 'agent', executionRuntime: 'local', prompt: '', allowedToolIds: [], idempotencyKey: 'ordinary-source-read',
      sourceVersionIds: proposal.parentVersionIds, context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
    } });
    if (context.projectAccess?.grantGeneration !== access.grantGeneration || context.projectAccess.ownerId !== access.ownerId) throw new AgentContextNotFoundError();
    const urls = resolveAgentMediaUrls(context, proposal.parentVersionIds);
    if (urls.length !== actual.length || urls.some((url, index) => mediaIdentity(url, origin) !== actual[index])) {
      throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_ORDINARY_SOURCE_MISMATCH');
    }
    const snapshot = await readOrdinaryPublicationSourceSnapshot(getPool(), access.ownerId, access.projectId, proposal.parentVersionIds, false);
    if (!isDeepStrictEqual(snapshot, initialSnapshot))
      throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_ORDINARY_SOURCE_MISMATCH');
    publication.ordinarySourceSnapshot ??= initialSnapshot;
    return actual.map(value => { const url = new URL(value); return `${url.pathname}${url.search}`; });
  } catch (error) { throw classify(error); }
}
export async function validateCanvasOrdinaryReplay(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity, taskId: string): Promise<void> {
  const client = await getPool().connect().catch(error => { throw classify(error); });
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: publication.access.actorUserId,
      projectId: publication.access.projectId, publication, singleTaskIdentity: identity, replayTaskId: taskId });
  } catch (error) { throw classify(error); }
  finally {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    client.release(discard);
    if (discard) throw new CanvasOrdinaryAdmissionError(503, 'CANVAS_ORDINARY_UNAVAILABLE');
  }
}
