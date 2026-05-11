import { NextRequest, NextResponse } from 'next/server';
import {
  createManagedUser,
  deleteManagedUser,
  isRootAdminUser,
  listManagedUsers,
  requireAdminUser,
  updateManagedUser,
} from '@/lib/server-auth';
import type { User } from '@/lib/user-types';

export const dynamic = 'force-dynamic';

async function requireRootAdmin(request: NextRequest): Promise<User | null> {
  const responseUser = await requireAdminUser(request);
  return isRootAdminUser(responseUser) ? responseUser : null;
}

export async function GET(request: NextRequest) {
  const admin = await requireRootAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  const users = await listManagedUsers();
  return NextResponse.json({ success: true, users });
}

export async function POST(request: NextRequest) {
  const admin = await requireRootAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      action?: 'create' | 'update' | 'delete';
      userId?: string;
      name?: string;
      password?: string;
      email?: string;
      updates?: Record<string, unknown>;
    };

    if (body.action === 'create') {
      const user = await createManagedUser({
        name: String(body.name || ''),
        password: String(body.password || ''),
        email: body.email ? String(body.email) : undefined,
      });
      return NextResponse.json({ success: true, user });
    }

    if (body.action === 'update') {
      if (!body.userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
      }
      const user = await updateManagedUser(body.userId, {
        ...(typeof body.updates?.name === 'string' ? { name: body.updates.name } : {}),
        ...(typeof body.updates?.email === 'string' ? { email: body.updates.email } : {}),
        ...(body.updates?.status === 'active' || body.updates?.status === 'disabled' ? { status: body.updates.status } : {}),
        ...(body.updates?.password ? { password: String(body.updates.password) } : {}),
        ...(body.updates?.apiPermissions && typeof body.updates.apiPermissions === 'object'
          ? { apiPermissions: body.updates.apiPermissions as User['apiPermissions'] }
          : {}),
      });
      return NextResponse.json({ success: Boolean(user), user });
    }

    if (body.action === 'delete') {
      if (!body.userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
      }
      const deleted = await deleteManagedUser(body.userId);
      return NextResponse.json({ success: deleted, deleted });
    }

    const users = await listManagedUsers();
    return NextResponse.json({ success: true, users });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'User admin operation failed',
    }, { status: 500 });
  }
}
