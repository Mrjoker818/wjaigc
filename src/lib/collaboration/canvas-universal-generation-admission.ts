import 'server-only';
import { createAnnotationRequestHash } from '@/lib/annotation-idempotency';
import { authorizeAgentContext, resolveAgentMediaUrls, AgentContextNotFoundError } from '@/lib/agent-runtime/context-adapters';
import { getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import type { GenerationProjectAccess } from './generation-project-access';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal } from './task-publication-intent';
import { CanvasTaskPublicationError, prepareCanvasTaskPublicationInTransaction,
  type CanvasTaskPublicationInput, type CanvasSingleTaskIdentity } from './task-publication';

export class CanvasUniversalAdmissionError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 503, readonly code: string) {
    super(status === 503 ? '画布生成暂不可用，请使用原请求标识重试' : '画布生成请求、来源或授权不符合要求');
    this.name = 'CanvasUniversalAdmissionError';
  }
}
function classify(error: unknown): CanvasUniversalAdmissionError {
  if (error instanceof CanvasUniversalAdmissionError) return error;
  if (error instanceof CanvasPublicationIntentError) return new CanvasUniversalAdmissionError(400, 'CANVAS_UNIVERSAL_INVALID');
  if (error instanceof AgentContextNotFoundError) return new CanvasUniversalAdmissionError(403, 'CANVAS_UNIVERSAL_SOURCE_FORBIDDEN');
  if (error instanceof CanvasTaskPublicationError) return new CanvasUniversalAdmissionError(error.status, error.code);
  return new CanvasUniversalAdmissionError(503, 'CANVAS_UNIVERSAL_UNAVAILABLE');
}
export function parseCanvasUniversalPublication(access: Extract<GenerationProjectAccess, { kind: 'document' }>, body: Record<string, unknown>): CanvasTaskPublicationInput {
  try {
    const workspaceId = body.assetWorkspaceId === undefined ? access.projectId : body.assetWorkspaceId;
    if ((workspaceId !== access.projectId && workspaceId !== `canvas:${access.projectId}`)
      || body._skipCredits || body.skipCredits || body._skipCloudTaskPersistence) throw new CanvasPublicationIntentError();
    const intent = parseCanvasPublicationIntentProposal({ parentVersionIds: body.assetParentVersionIds === undefined ? [] : body.assetParentVersionIds,
      projectionMode: body.assetProjectionMode === undefined ? 'derived' : body.assetProjectionMode,
      placement: { action: 'append', selectedEntityIds: body.assetSelectedEntityIds === undefined ? [] : body.assetSelectedEntityIds } });
    if (intent.parentVersionIds.length !== (body.referenceImageUrl === undefined ? 0 : 1)) throw new CanvasPublicationIntentError();
    return { access, workspace: 'canvas', workspaceId: access.projectId, singleAdmission: 'universal-generate', intent };
  } catch (error) { throw classify(error); }
}
export function canvasUniversalRequestDigest(body: Record<string, unknown>): string {
  return createAnnotationRequestHash({ route: '/api/universal-generate', body });
}
export function isUniversalTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
}
export async function readCanvasUniversalTask(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity): Promise<CloudTask | null> {
  try {
    const task = await getCloudTaskForUserByIdempotencyKey(publication.access.actorUserId, identity.idempotencyKey);
    if (task && (task.type !== 'universal-generate' || task.projectId !== publication.access.projectId
      || task.idempotencyKey !== identity.idempotencyKey || task.requestDigest !== identity.requestDigest)) {
      throw new CanvasUniversalAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return task;
  } catch (error) { throw classify(error); }
}
function mediaIdentity(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\\') || value.startsWith('//')) throw new CanvasPublicationIntentError();
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new CanvasPublicationIntentError(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password || url.hash) throw new CanvasPublicationIntentError();
  return url.href;
}
export async function validateCanvasUniversalSources(publication: CanvasTaskPublicationInput, body: Record<string, unknown>, origin: string): Promise<string[]> {
  try {
    const proposal = parseCanvasPublicationIntentProposal(publication.intent);
    if (!proposal.parentVersionIds.length) return [];
    const actual = mediaIdentity(body.referenceImageUrl, origin);
    const { access } = publication;
    const context = await authorizeAgentContext({ actorUserId: access.actorUserId, request: {
      projectId: access.projectId, workspace: 'canvas', workspaceId: access.projectId,
      mode: 'agent', executionRuntime: 'local', prompt: '', allowedToolIds: [], idempotencyKey: 'universal-source-read',
      sourceVersionIds: proposal.parentVersionIds, context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
    } });
    if (context.projectAccess?.grantGeneration !== access.grantGeneration || context.projectAccess.ownerId !== access.ownerId) throw new AgentContextNotFoundError();
    const urls = resolveAgentMediaUrls(context, proposal.parentVersionIds);
    if (urls.length !== 1 || mediaIdentity(urls[0], origin) !== actual) throw new CanvasUniversalAdmissionError(403, 'CANVAS_UNIVERSAL_SOURCE_MISMATCH');
    const url = new URL(actual);
    return [`${url.pathname}${url.search}`];
  } catch (error) { throw classify(error); }
}
export async function validateCanvasUniversalReplay(publication: CanvasTaskPublicationInput, identity: CanvasSingleTaskIdentity, taskId: string): Promise<void> {
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
    if (discard) throw new CanvasUniversalAdmissionError(503, 'CANVAS_UNIVERSAL_UNAVAILABLE');
  }
}
