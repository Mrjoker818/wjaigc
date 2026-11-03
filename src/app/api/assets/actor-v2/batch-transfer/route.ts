import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { prepareActorBoundAssetRequest } from '@/lib/asset-versioned-transfer';
import { POST as legacyBatch } from '@/app/api/assets/batch-transfer/route';
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const prepared = await prepareActorBoundAssetRequest(request, session.id, 256 * 1024);
  return 'response' in prepared ? prepared.response : legacyBatch(prepared.request);
}
