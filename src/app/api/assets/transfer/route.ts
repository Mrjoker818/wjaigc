import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  AssetServiceError,
  createAssetService,
} from '@/lib/asset-core/service';
import type { WorkspaceEntityType } from '@/lib/asset-core/types';
import { getSessionUser } from '@/lib/server-auth';

const REQUEST_FIELDS = new Set([
  'sourceVersion',
  'targetProject',
  'targetWorkspace',
  'entityType',
  'entityId',
  'idempotencyKey',
  'transform',
  'metadata',
]);
const ENTITY_TYPES = new Set<WorkspaceEntityType>([
  'canvas-image',
  'workflow-input',
  'workflow-output',
  'chat-attachment',
  'chat-result',
]);

interface TransferRequestBody {
  sourceVersion: string;
  targetProject: string;
  targetWorkspace: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  idempotencyKey: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

async function resolveActorUserId(request: NextRequest): Promise<string | null> {
  const sessionUser = await getSessionUser(request);
  return sessionUser?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key].trim() : '';
}

function parseBody(value: unknown): TransferRequestBody | null {
  if (!isRecord(value) || Object.keys(value).some(key => !REQUEST_FIELDS.has(key))) return null;
  const sourceVersion = requiredString(value, 'sourceVersion');
  const targetProject = requiredString(value, 'targetProject');
  const targetWorkspace = requiredString(value, 'targetWorkspace');
  const entityType = requiredString(value, 'entityType') as WorkspaceEntityType;
  const entityId = requiredString(value, 'entityId');
  const idempotencyKey = requiredString(value, 'idempotencyKey');
  if (
    !sourceVersion
    || !targetProject
    || !targetWorkspace
    || !ENTITY_TYPES.has(entityType)
    || !entityId
    || !idempotencyKey
  ) return null;
  if (value.transform !== undefined && !isRecord(value.transform)) return null;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return null;
  return {
    sourceVersion,
    targetProject,
    targetWorkspace,
    entityType,
    entityId,
    idempotencyKey,
    ...(isRecord(value.transform) ? { transform: value.transform } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  );
}

function requestDigest(input: TransferRequestBody): string {
  const semanticRequest = {
    sourceVersion: input.sourceVersion,
    targetProject: input.targetProject,
    targetWorkspace: input.targetWorkspace,
    entityType: input.entityType,
    entityId: input.entityId,
    transform: input.transform ?? {},
    metadata: input.metadata ?? {},
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(semanticRequest)))
    .digest('hex');
}

function serviceErrorResponse(error: unknown): NextResponse {
  if (error instanceof AssetServiceError) {
    if (error.code === 'ASSET_NOT_FOUND') {
      return NextResponse.json({ error: error.code }, { status: 404 });
    }
    if (error.code === 'ASSET_IDEMPOTENCY_CONFLICT' || error.code === 'ASSET_PLACEMENT_CONFLICT') {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
  }
  return NextResponse.json({ error: 'ASSET_TRANSFER_FAILED' }, { status: 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (!body) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });

  try {
    const result = await createAssetService().sendVersionToWorkspace({
      actorUserId,
      sourceVersionId: body.sourceVersion,
      targetProjectId: body.targetProject,
      targetWorkspaceId: body.targetWorkspace,
      entityType: body.entityType,
      entityId: body.entityId,
      idempotencyKey: body.idempotencyKey,
      requestDigest: requestDigest(body),
      ...(body.transform ? { transform: body.transform } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    const name = body.metadata && typeof body.metadata.name === 'string'
      ? body.metadata.name
      : undefined;
    return NextResponse.json({
      assetId: result.version.assetId,
      assetVersionId: result.version.id,
      placementId: result.placement.id,
      entityId: result.placement.entityId,
      url: result.version.file.url,
      ...(name ? { name } : {}),
      reused: result.reused,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
