import { NextRequest, NextResponse } from 'next/server';
import { ensureUserDataDirs } from '@/lib/server-user-storage';
import { requireAdminUser } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin session required' }, { status: 401 });
    }

    const { userId } = await request.json() as { userId?: string };
    if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const userDir = await ensureUserDataDirs(userId);

    return NextResponse.json({ success: true, folder: userDir });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user folder',
    }, { status: 500 });
  }
}
