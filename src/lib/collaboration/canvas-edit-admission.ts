import 'server-only';
import { authorizeAgentContext, resolveAgentMediaUrls, AgentContextNotFoundError } from '@/lib/agent-runtime/context-adapters';
import type { GenerationProjectAccess } from './generation-project-access';
import { CanvasTaskPublicationError, prepareCanvasTaskPublicationInTransaction, type CanvasTaskPublicationInput, type CanvasSingleTaskIdentity } from './task-publication';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal } from './task-publication-intent';
import { getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';

export class CanvasEditAdmissionError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 503, readonly code: string) {
    super(status === 503 ? '画布修图准入暂不可用，请使用原请求重试' : '画布修图请求、来源或授权不符合要求');
    this.name = 'CanvasEditAdmissionError';
  }
}

export function classifyCanvasEditError(error: unknown): CanvasEditAdmissionError {
  if (error instanceof CanvasEditAdmissionError) return error;
  if (error instanceof CanvasPublicationIntentError) return new CanvasEditAdmissionError(400, 'CANVAS_EDIT_INVALID_INTENT');
  if (error instanceof AgentContextNotFoundError) return new CanvasEditAdmissionError(403, 'CANVAS_EDIT_SOURCE_FORBIDDEN');
  if (error instanceof CanvasTaskPublicationError) return new CanvasEditAdmissionError(error.status, error.code);
  return new CanvasEditAdmissionError(503, 'CANVAS_EDIT_UNAVAILABLE');
}

/** Pure proposal, independent of live sources so terminal reads can run first. */
export function parseCanvasEditPublication(access: Extract<GenerationProjectAccess, { kind: 'document' }>, body: Record<string, unknown>): CanvasTaskPublicationInput {
  try {
    const workspaceId = body.assetWorkspaceId === undefined ? access.projectId : body.assetWorkspaceId;
    if ((workspaceId !== access.projectId && workspaceId !== `canvas:${access.projectId}`)
      || body._skipCredits || body._skipCloudTaskPersistence) throw new CanvasPublicationIntentError();
    const intent = parseCanvasPublicationIntentProposal({ parentVersionIds: body.assetParentVersionIds,
      projectionMode: body.assetProjectionMode === undefined ? 'derived' : body.assetProjectionMode,
      placement: { action: 'append', selectedEntityIds: body.assetSelectedEntityIds === undefined ? [] : body.assetSelectedEntityIds } });
    if (!intent.parentVersionIds.length) throw new CanvasPublicationIntentError();
    return { access, workspace: 'canvas', workspaceId: access.projectId, singleAdmission: 'edit', intent };
  } catch (error) { throw classifyCanvasEditError(error); }
}

function mediaIdentity(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\\') || value.startsWith('//')) {
    throw new CanvasPublicationIntentError();
  }
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new CanvasPublicationIntentError(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(origin).origin
    || url.username || url.password || url.hash) throw new CanvasPublicationIntentError();
  return url.href;
}

/** Binds ordered primary/reference URLs without downloading or hashing media bytes. */
export async function validateCanvasEditSources(publication: CanvasTaskPublicationInput, body: Record<string, unknown>, origin: string): Promise<string[]> {
  try {
    const { access } = publication;
    const proposal = parseCanvasPublicationIntentProposal(publication.intent);
    const context = await authorizeAgentContext({ actorUserId: access.actorUserId, request: {
      projectId: access.projectId, workspace: 'canvas', workspaceId: access.projectId,
      mode: 'agent', executionRuntime: 'local', prompt: '', allowedToolIds: [], idempotencyKey: 'edit-source-read',
      sourceVersionIds: proposal.parentVersionIds, context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
    } });
    if (context.projectAccess?.grantGeneration !== access.grantGeneration || context.projectAccess.ownerId !== access.ownerId
      || context.projectAccess.actorUserId !== access.actorUserId) throw new AgentContextNotFoundError();
    const urls = resolveAgentMediaUrls(context, proposal.parentVersionIds);
    const refs = body.referenceImages === undefined ? [] : body.referenceImages;
    if (!Array.isArray(refs)) throw new CanvasPublicationIntentError();
    const actual = [body.image, ...refs.map(value => typeof value === 'object' && value !== null ? value.url : value)]
      .map(value => mediaIdentity(value, origin));
    const expected = urls.map(value => mediaIdentity(value, origin));
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      throw new CanvasEditAdmissionError(403, 'CANVAS_EDIT_SOURCE_MISMATCH');
    }
    // Same-origin URLs identify managed paths. Feed those canonical paths to the existing safe reader,
    // without sending a local absolute URL through the public-HTTP downloader or changing body identity.
    return expected.map(value => { const url = new URL(value); return `${url.pathname}${url.search}`; });
  } catch (error) { throw classifyCanvasEditError(error); }
}

export function isCanvasEditTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
}

/** Read the actual top-level identity; never manufacture it from payload or today's authorization. */
export async function readCanvasEditTask(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity): Promise<CloudTask | null> {
  try {
    const task = await getCloudTaskForUserByIdempotencyKey(publication.access.actorUserId, identity.idempotencyKey);
    if (task && (task.type !== 'edit' || task.projectId !== publication.access.projectId
      || task.idempotencyKey !== identity.idempotencyKey || task.requestDigest !== identity.requestDigest)) {
      throw new CanvasEditAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return task;
  } catch (error) { throw classifyCanvasEditError(error); }
}

/** Original grant/intent/source preflight. Core repeats under its idempotency + task locks. */
export async function validateCanvasEditReplay(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity, taskId: string): Promise<void> {
  const client = await getPool().connect().catch(error => { throw classifyCanvasEditError(error); });
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: publication.access.actorUserId,
      projectId: publication.access.projectId, publication, singleTaskIdentity: identity, replayTaskId: taskId });
  } catch (error) { throw classifyCanvasEditError(error); }
  finally {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    client.release(discard);
    if (discard) throw new CanvasEditAdmissionError(503, 'CANVAS_EDIT_UNAVAILABLE');
  }
}
