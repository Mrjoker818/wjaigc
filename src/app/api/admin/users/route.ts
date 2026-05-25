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
import { dbListUserData, dbGetUserData, dbDeleteUserData } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

async function requireRootAdmin(request: NextRequest): Promise<User | null> {
  const responseUser = await requireAdminUser(request);
  return isRootAdminUser(responseUser) ? responseUser : null;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireRootAdmin(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const users = await listManagedUsers();
    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error('[admin/users] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load users', users: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireRootAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      action?: 'create' | 'update' | 'delete' | 'list-data' | 'get-data' | 'delete-data' | 'listUserData' | 'getUserData' | 'deleteUserData';
      userId?: string;
      name?: string;
      password?: string;
      email?: string;
      updates?: Record<string, unknown>;
      dataKey?: string;
      key?: string;
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

    if (body.action === 'list-data' || body.action === 'listUserData') {
      if (!body.userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
      }
      const dataKeys = await dbListUserData(body.userId);
      // 兼容两种响应格式：dataKeys 和 keys
      return NextResponse.json({ success: true, dataKeys, keys: dataKeys });
    }

    if (body.action === 'get-data' || body.action === 'getUserData') {
      const effectiveKey = body.dataKey || body.key;
      if (!body.userId || !effectiveKey) {
        return NextResponse.json({ success: false, error: 'Missing userId or dataKey' }, { status: 400 });
      }
      const value = await dbGetUserData(body.userId, String(effectiveKey));
      return NextResponse.json({ success: true, dataKey: effectiveKey, value });
    }

    if (body.action === 'delete-data' || body.action === 'deleteUserData') {
      const effectiveKey = body.dataKey || body.key;
      if (!body.userId || !effectiveKey) {
        return NextResponse.json({ success: false, error: 'Missing userId or dataKey' }, { status: 400 });
      }
      const deleted = await dbDeleteUserData(body.userId, String(effectiveKey));
      return NextResponse.json({ success: deleted });
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
