import { NextRequest, NextResponse } from 'next/server';

import { MediaHealthError, recoverAssetMedia } from '@/lib/asset-core/media-health';
import { getRequestUser } from '@/lib/api-auth';

function parseRecoveryInput(value: unknown): { projectId: string; assetVersionId: string; assetId: string; placementId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  const assetVersionId = typeof input.assetVersionId === 'string' ? input.assetVersionId.trim() : '';
  const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
  const placementId = typeof input.placementId === 'string' ? input.placementId.trim() : '';
  return projectId && assetVersionId && assetId && placementId ? { projectId, assetVersionId, assetId, placementId } : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const input = parseRecoveryInput(body);
  if (!input) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  try {
    return NextResponse.json(await recoverAssetMedia({ actorUserId: auth.user.id, ...input }));
  } catch (error) {
    if (error instanceof MediaHealthError) {
      return NextResponse.json({ error: error.code }, { status: error.code === 'ASSET_NOT_FOUND' ? 404 : 409 });
    }
    return NextResponse.json({ error: 'ASSET_RECOVERY_FAILED' }, { status: 500 });
  }
}
