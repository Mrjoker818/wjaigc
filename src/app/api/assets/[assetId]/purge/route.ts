import { NextRequest, NextResponse } from 'next/server';

import { MediaHealthError, purgeEligibleAsset } from '@/lib/asset-core/media-health';
import { getRequestUser } from '@/lib/api-auth';

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

function parsePurgeInput(value: unknown): { candidateId: string; confirmationDigest: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const candidateId = typeof input.candidateId === 'string' ? input.candidateId.trim() : '';
  const confirmationDigest = typeof input.confirmationDigest === 'string' ? input.confirmationDigest.trim() : '';
  return candidateId && confirmationDigest ? { candidateId, confirmationDigest } : null;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (auth.user.role !== 'admin') return NextResponse.json({ error: 'Administrator session required' }, { status: 403 });
  const { assetId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  }
  const input = parsePurgeInput(body);
  if (!assetId?.trim() || !input) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  try {
    const result = await purgeEligibleAsset({ assetId: assetId.trim(), ...input });
    return NextResponse.json(result, { status: result.eligible ? 202 : 409 });
  } catch (error) {
    if (error instanceof MediaHealthError) {
      return NextResponse.json({ error: error.code }, { status: error.code === 'ASSET_NOT_FOUND' ? 404 : 409 });
    }
    return NextResponse.json({ error: 'ASSET_PURGE_FAILED' }, { status: 500 });
  }
}
