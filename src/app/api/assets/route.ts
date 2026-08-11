import { NextRequest, NextResponse } from 'next/server';

import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import type { AssetVersion, WorkspacePlacement } from '@/lib/asset-core/types';
import { getSessionUser } from '@/lib/server-auth';

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
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  const assetVersionId = typeof value.assetVersionId === 'string' ? value.assetVersionId.trim() : '';
  const placementId = typeof value.placementId === 'string' ? value.placementId.trim() : '';
  if (!projectId || !assetVersionId) return null;
  return { projectId, assetVersionId, ...(placementId ? { placementId } : {}) };
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'ASSET_NOT_FOUND' }, { status: 404 });
}

function referenceResponse(version: AssetVersion, placement?: WorkspacePlacement): NextResponse {
  const name = placement?.metadata && typeof placement.metadata.name === 'string'
    ? placement.metadata.name
    : undefined;
  return NextResponse.json({
    assetId: version.assetId,
    assetVersionId: version.id,
    ...(placement ? { placementId: placement.id } : {}),
    url: version.file.url,
    ...(name ? { name } : {}),
  });
}

async function resolveAssetReference(
  actorUserId: string,
  input: ResolveAssetInput,
): Promise<NextResponse> {
  const storage = createPostgresAssetStorage();
  return storage.transaction(async transaction => {
    if (!await transaction.findProject(actorUserId, input.projectId)) return notFound();
    const version = await transaction.findVersion(
      actorUserId,
      input.projectId,
      input.assetVersionId,
    );
    if (!version) return notFound();

    let placement: WorkspacePlacement | undefined;
    if (input.placementId) {
      const found = await transaction.findPlacement(
        actorUserId,
        input.projectId,
        input.placementId,
      );
      if (!found || found.assetVersionId !== version.id || found.status !== 'active') return notFound();
      placement = found;
    }
    return referenceResponse(version, placement);
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const input = parseInput({
    projectId: request.nextUrl.searchParams.get('projectId'),
    assetVersionId: request.nextUrl.searchParams.get('assetVersionId'),
    placementId: request.nextUrl.searchParams.get('placementId') || undefined,
  });
  if (!input) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  return resolveAssetReference(actorUserId, input);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const input = parseInput(body);
  if (!input) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  return resolveAssetReference(actorUserId, input);
}
