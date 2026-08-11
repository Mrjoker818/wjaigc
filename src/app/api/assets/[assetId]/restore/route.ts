import { NextRequest, NextResponse } from 'next/server';

import { AssetServiceError, createAssetService } from '@/lib/asset-core/service';
import { getRequestUser } from '@/lib/api-auth';

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

function parseRestoreInput(value: unknown): { projectId: string; placementId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  const placementId = typeof input.placementId === 'string' ? input.placementId.trim() : '';
  return projectId && placementId ? { projectId, placementId } : null;
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
    });
    return NextResponse.json(restored);
  } catch (error) {
    if (error instanceof AssetServiceError) {
      const status = error.code === 'ASSET_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: 'ASSET_RESTORE_FAILED' }, { status: 500 });
  }
}
