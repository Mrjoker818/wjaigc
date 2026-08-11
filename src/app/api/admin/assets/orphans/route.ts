import { NextRequest, NextResponse } from 'next/server';

import { scanMediaHealth } from '@/lib/asset-core/media-health';
import { getRequestUser } from '@/lib/api-auth';

function parseDryRun(value: string | null): boolean | null {
  if (value === null || value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (auth.user.role !== 'admin') return NextResponse.json({ error: 'Administrator session required' }, { status: 403 });
  const dryRun = parseDryRun(request.nextUrl.searchParams.get('dryRun'));
  if (dryRun === null) return NextResponse.json({ error: 'ASSET_REQUEST_INVALID' }, { status: 400 });
  try {
    return NextResponse.json(await scanMediaHealth({ dryRun }));
  } catch {
    return NextResponse.json({ error: 'ASSET_ORPHAN_SCAN_FAILED' }, { status: 500 });
  }
}
