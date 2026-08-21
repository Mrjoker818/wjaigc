import { NextRequest, NextResponse } from 'next/server';

import {
  getAssetThumbnailBackfillStatus,
  previewAssetThumbnailBackfill,
  runAssetThumbnailBackfill,
} from '@/lib/asset-core/thumbnail-backfill';
import { requireAdminUser } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin required' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, ...(await getAssetThumbnailBackfillStatus()) });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Thumbnail backfill failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin required' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { dryRun?: unknown; limit?: unknown };
  const dryRun = body.dryRun === true;
  const maxLimit = dryRun ? 100 : 10;
  const limit = body.limit === undefined ? (dryRun ? 20 : 10) : body.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > maxLimit) {
    return NextResponse.json(
      { success: false, error: `limit must be an integer between 1 and ${maxLimit}` },
      { status: 400 },
    );
  }
  try {
    const result = dryRun
      ? await previewAssetThumbnailBackfill({ limit: Number(limit) })
      : await runAssetThumbnailBackfill({ limit: Number(limit), leaseMs: 300_000 });
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Thumbnail backfill failed' },
      { status: 500 },
    );
  }
}
