import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { AssetServiceError, createAssetService, type TransferVersionInput } from '@/lib/asset-core/service';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import type { WorkspaceEntityType } from '@/lib/asset-core/types';
import { getSessionUser } from '@/lib/server-auth';

const MAX_BATCH_TRANSFERS = 100;
const MAX_REQUEST_BYTES = 256 * 1024;
const TRANSFER_FIELDS = new Set([
  'sourceVersion', 'targetProject', 'targetWorkspace', 'entityType', 'entityId',
  'idempotencyKey', 'transform', 'metadata',
]);
const ENTITY_TYPES = new Set<WorkspaceEntityType>([
  'canvas-image', 'workflow-input', 'workflow-output', 'chat-attachment', 'chat-result',
]);

type ParsedTransfer = Omit<TransferVersionInput, 'actorUserId' | 'requestDigest'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  return value.length <= 256 ? value : '';
}

function isBoundedJson(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.length <= 2_048;
  if (Array.isArray(value)) return value.length <= 64 && value.every(item => isBoundedJson(item, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 64) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 128 && isBoundedJson(item, depth + 1));
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = { ...value };
  const sourceTrace = parseWorkspaceSourceTrace(metadata.sourceTrace);
  if (sourceTrace) metadata.sourceTrace = sourceTrace;
  else delete metadata.sourceTrace;
  return metadata;
}

function parseTransfer(value: unknown): ParsedTransfer | null {
  if (!isRecord(value) || Object.keys(value).some(key => !TRANSFER_FIELDS.has(key))) return null;
  const sourceVersionId = requiredString(value, 'sourceVersion');
  const targetProjectId = requiredString(value, 'targetProject');
  const targetWorkspaceId = requiredString(value, 'targetWorkspace');
  const entityType = requiredString(value, 'entityType') as WorkspaceEntityType;
  const entityId = requiredString(value, 'entityId');
  const idempotencyKey = requiredString(value, 'idempotencyKey');
  if (!sourceVersionId || !targetProjectId || !targetWorkspaceId || !ENTITY_TYPES.has(entityType)
    || !entityId || !idempotencyKey) return null;
  if (entityType === 'canvas-image' && targetWorkspaceId !== `canvas:${targetProjectId}`) return null;
  if (value.transform !== undefined && (!isRecord(value.transform) || !isBoundedJson(value.transform))) return null;
  if (value.metadata !== undefined && (!isRecord(value.metadata) || !isBoundedJson(value.metadata))) return null;
  const metadata = sanitizeMetadata(value.metadata);
  return {
    sourceVersionId, targetProjectId, targetWorkspaceId, entityType, entityId, idempotencyKey,
    ...(isRecord(value.transform) ? { transform: value.transform } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function requestDigest(input: ParsedTransfer): string {
  return createHash('sha256').update(JSON.stringify(canonicalize({
    sourceVersion: input.sourceVersionId,
    targetProject: input.targetProjectId,
    targetWorkspace: input.targetWorkspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    transform: input.transform ?? {},
    metadata: input.metadata ?? {},
  }))).digest('hex');
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof AssetServiceError) {
    if (error.code === 'ASSET_NOT_FOUND') return NextResponse.json({ error: error.code }, { status: 404 });
    if (error.code === 'ASSET_IDEMPOTENCY_CONFLICT' || error.code === 'ASSET_PLACEMENT_CONFLICT') {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    if (error.code === 'ASSET_RESTORE_NOT_ALLOWED' || error.code === 'ASSET_MEDIA_UNRECOVERABLE') {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
  }
  return NextResponse.json({ error: 'ASSET_BATCH_TRANSFER_FAILED' }, { status: 500 });
}

async function readBoundedText(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel('Request body is too large');
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return '';
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 413 });
  }
  const rawText = await readBoundedText(request);
  if (rawText === null) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 413 });
  }
  const rawBody: unknown = (() => { try { return JSON.parse(rawText); } catch { return null; } })();
  if (!isRecord(rawBody) || Object.keys(rawBody).some(key => !['transfers', 'restoreDeletedPlacements'].includes(key))
    || !Array.isArray(rawBody.transfers)
    || rawBody.transfers.length < 1 || rawBody.transfers.length > MAX_BATCH_TRANSFERS
    || (rawBody.restoreDeletedPlacements !== undefined && typeof rawBody.restoreDeletedPlacements !== 'boolean')) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const parsed = rawBody.transfers.map(parseTransfer);
  if (parsed.some(item => item === null)) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const transfers = parsed as ParsedTransfer[];
  if (new Set(transfers.map(item => item.idempotencyKey)).size !== transfers.length) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }

  try {
    const results = await createAssetService().sendVersionsToWorkspace(transfers.map(transfer => ({
      actorUserId: sessionUser.id,
      ...transfer,
      requestDigest: requestDigest(transfer),
    })), { restoreDeletedPlacements: rawBody.restoreDeletedPlacements === true });
    return NextResponse.json({
      transfers: results.map(result => ({
        assetId: result.version.assetId,
        assetVersionId: result.version.id,
        placementId: result.placement.id,
        placementStatus: result.placement.status,
        ...(result.placement.lifecycleRevision ? { placementRevision: result.placement.lifecycleRevision } : {}),
        entityId: result.placement.entityId,
        url: result.version.file.url,
        reused: result.reused,
        ...(result.projectRevision === undefined ? {} : { projectRevision: result.projectRevision }),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
