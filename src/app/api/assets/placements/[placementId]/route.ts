import { NextRequest, NextResponse } from 'next/server';

import { AssetServiceError, createAssetService } from '@/lib/asset-core/service';
import { getSessionUser } from '@/lib/server-auth';

interface RouteContext {
  params: Promise<{ placementId: string }>;
}

async function resolveActorUserId(request: NextRequest): Promise<string | null> {
  const sessionUser = await getSessionUser(request);
  return sessionUser?.id ?? null;
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const actorUserId = await resolveActorUserId(request);
  if (!actorUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() ?? '';
  const { placementId } = await context.params;
  if (!projectId || !placementId?.trim()) {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  try {
    const result = await createAssetService().trashPlacement({
      actorUserId,
      projectId,
      placementId: placementId.trim(),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AssetServiceError) {
      const status = error.code === 'ASSET_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: 'ASSET_PLACEMENT_DELETE_FAILED' }, { status: 500 });
  }
}
