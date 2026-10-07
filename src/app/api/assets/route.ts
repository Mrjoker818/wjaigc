import { NextRequest, NextResponse } from 'next/server';

import { AssetServiceError } from '@/lib/asset-core/service';
import { getSessionUser } from '@/lib/server-auth';
import { DocumentWorkspaceReferenceError, resolveDocumentWorkspaceReference, resolvePersonalWorkspaceReference } from '@/lib/collaboration/document-workspace-reference';

const REQUEST_FIELDS = new Set(['projectId', 'assetVersionId', 'placementId']);

interface ResolveAssetInput {
  projectId: string;
  assetVersionId: string;
  placementId?: string;
}

async function resolveActorUserId(request: NextRequest): Promise<string | null> {
  const sessionUser = await getSessionUser(request);
  return sessionUser?.id ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInput(value: unknown): ResolveAssetInput | null {
  if (!isRecord(value) || Object.keys(value).some(key => !REQUEST_FIELDS.has(key))) return null;
  if (value.placementId !== undefined && typeof value.placementId !== 'string') return null;
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  const assetVersionId = typeof value.assetVersionId === 'string' ? value.assetVersionId.trim() : '';
  const placementId = typeof value.placementId === 'string' ? value.placementId.trim() : '';
  if (!projectId || !assetVersionId) return null;
  return { projectId, assetVersionId, ...(placementId ? { placementId } : {}) };
}

function notFound(): NextResponse {
  return privateResponse({ error: 'ASSET_NOT_FOUND' }, 404);
}

function privateResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}

async function resolveAssetReference(
  actorUserId: string,
  input: ResolveAssetInput,
): Promise<NextResponse> {
  try {
    const documentReference = await resolveDocumentWorkspaceReference(actorUserId, input);
    const reference = documentReference ?? await resolvePersonalWorkspaceReference(actorUserId, input);
    return privateResponse(reference);
  } catch (error) {
    if (error instanceof DocumentWorkspaceReferenceError) {
      return privateResponse({ error: error.code }, error.status);
    }
    if (error instanceof AssetServiceError && error.code === 'ASSET_NOT_FOUND') return notFound();
    throw error;
  }
}

async function getAsset(request: NextRequest): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return privateResponse({ error: 'Authentication required' }, 401);
  }
  const expectedActor = request.headers.get('x-wujie-expected-actor-id');
  if (expectedActor !== null && expectedActor !== actorUserId) {
    return privateResponse({ error: 'ACTOR_SCOPE_CHANGED' }, 409);
  }
  const input = parseInput({
    projectId: request.nextUrl.searchParams.get('projectId'),
    assetVersionId: request.nextUrl.searchParams.get('assetVersionId'),
    placementId: request.nextUrl.searchParams.get('placementId') || undefined,
  });
  if (!input) return privateResponse({ error: 'ASSET_REQUEST_INVALID' }, 400);
  return resolveAssetReference(actorUserId, input);
}

async function postAsset(request: NextRequest): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return privateResponse({ error: 'Authentication required' }, 401);
  }
  const expectedActor = request.headers.get('x-wujie-expected-actor-id');
  if (expectedActor !== null && expectedActor !== actorUserId) {
    return privateResponse({ error: 'ACTOR_SCOPE_CHANGED' }, 409);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateResponse({ error: 'ASSET_REQUEST_INVALID' }, 400);
  }
  const input = parseInput(body);
  if (!input) return privateResponse({ error: 'ASSET_REQUEST_INVALID' }, 400);
  return resolveAssetReference(actorUserId, input);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try { return await getAsset(request); }
  catch { return privateResponse({ error: 'ASSET_REFERENCE_UNAVAILABLE' }, 503); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try { return await postAsset(request); }
  catch { return privateResponse({ error: 'ASSET_REFERENCE_UNAVAILABLE' }, 503); }
}
