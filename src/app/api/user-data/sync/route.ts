import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetUserData, dbSetUserData } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user-data/sync?key=projects
 * Read user data from database (fallback to empty)
 */
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    const key = request.nextUrl.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }

    const value = await dbGetUserData(sessionUser.id, key);
    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read user data',
    }, { status: 500 });
  }
}

/**
 * POST /api/user-data/sync
 * Write user data to database
 * Body: { key: string, value: any }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }

    const body = await request.json() as { key?: string; value?: unknown };
    const key = body.key;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Missing key parameter' }, { status: 400 });
    }

    await dbSetUserData(sessionUser.id, key, body.value ?? null);
    return NextResponse.json({ success: true, key });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write user data',
    }, { status: 500 });
  }
}
