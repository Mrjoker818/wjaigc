import { NextResponse } from 'next/server';
import { listManagedUsers } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
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
