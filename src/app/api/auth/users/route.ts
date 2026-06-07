import { NextRequest, NextResponse } from 'next/server';
import { listManagedUsers } from '@/lib/server-auth';
import { requireApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Require authentication to prevent user enumeration
  const auth = await requireApiAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const users = (await listManagedUsers()).filter(user => user.role !== 'admin' && user.status !== 'disabled');
    return NextResponse.json({
      success: true,
      users: users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load users',
    }, { status: 500 });
  }
}
