import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/api-auth';
import { ACTOR_BOUND_ASSET_MAX_BYTES, prepareActorBoundAssetRequest } from '@/lib/asset-versioned-transfer';
import { POST as legacyRestore } from '@/app/api/assets/[assetId]/restore/route';
interface RouteContext { params: Promise<{ assetId: string }> }
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const prepared = await prepareActorBoundAssetRequest(request, auth.user.id, ACTOR_BOUND_ASSET_MAX_BYTES);
  return 'response' in prepared ? prepared.response : legacyRestore(prepared.request, context);
}
