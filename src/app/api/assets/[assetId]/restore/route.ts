import { NextRequest, NextResponse } from 'next/server';

import { AssetServiceError, createAssetService } from '@/lib/asset-core/service';
import { getRequestUser } from '@/lib/api-auth';

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

function parseRestoreInput(value: unknown): { projectId: string; placementId: string; expectedPlacementRevision?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  const placementId = typeof input.placementId === 'string' ? input.placementId.trim() : '';
  if (input.expectedPlacementRevision !== undefined
    && (typeof input.expectedPlacementRevision !== 'string' || !/^\d{1,10}$/.test(input.expectedPlacementRevision))) return null;
  return projectId && placementId ? { projectId, placementId,
    ...(typeof input.expectedPlacementRevision === 'string' ? { expectedPlacementRevision: input.expectedPlacementRevision } : {}) } : null;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { assetId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const input = parseRestoreInput(body);
  if (!input || !assetId?.trim()) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  try {
    const restored = await createAssetService().restorePlacement({
      actorUserId: auth.user.id,
      projectId: input.projectId,
      placementId: input.placementId,
      assetId: assetId.trim(),
      ...(input.expectedPlacementRevision === undefined ? {} : { expectedPlacementRevision: input.expectedPlacementRevision }),
    });
    return NextResponse.json(restored);
  } catch (error) {
    if (error instanceof AssetServiceError) {
      let status = 409;
      if (error.code === 'ASSET_NOT_FOUND') status = 404;
      if (error.code === 'ASSET_MEDIA_UNRECOVERABLE') status = 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: 'ASSET_RESTORE_FAILED' }, { status: 500 });
  }
}
