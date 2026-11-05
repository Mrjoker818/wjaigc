import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { ACTOR_BOUND_ASSET_MAX_BYTES, prepareActorBoundAssetRequest } from '@/lib/asset-versioned-transfer';
import { POST as legacyTransfer } from '@/app/api/assets/transfer/route';
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const prepared = await prepareActorBoundAssetRequest(request, session.id, ACTOR_BOUND_ASSET_MAX_BYTES);
  return 'response' in prepared ? prepared.response : legacyTransfer(prepared.request);
}
