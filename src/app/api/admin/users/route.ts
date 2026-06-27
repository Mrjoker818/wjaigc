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
import { dbListUserData, dbGetUserData, dbDeleteUserData, dbAddAuditLog } from '@/lib/db-storage';

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
    // Enrich users with credits and project count from user_data
    const enrichedUsers = await Promise.all((users || []).map(async (u: User) => {
      let credits = 0;
      let projectCount = 0;
      try {
        const ud = await dbGetUserData(u.id, 'credits') as Record<string, unknown> | null;
        if (ud && typeof ud === 'object' && 'data_value' in ud) {
          const dv = (ud as Record<string, unknown>).data_value;
          const parsed = typeof dv === 'string' ? JSON.parse(dv) : dv;
          credits = Number((parsed as Record<string, unknown>)?.balance ?? (parsed as Record<string, unknown>)?.credits ?? 0) || 0;
        }
      } catch {}
      try {
        const pd = await dbGetUserData(u.id, 'projects') as Record<string, unknown> | null;
        if (pd && typeof pd === 'object' && 'data_value' in pd) {
          const dv = (pd as Record<string, unknown>).data_value;
          const parsed = typeof dv === 'string' ? JSON.parse(dv) : dv;
          projectCount = Array.isArray(parsed) ? parsed.length : (typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>).length : 0);
        }
      } catch {}
      return {
        ...u,
        credits,
        project_count: projectCount,
      };
    }));
    return NextResponse.json({ success: true, users: enrichedUsers });
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
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_create', target_type: 'user', target_id: user?.id, detail: `创建用户 ${body.name}`, ip_address: null, created_at: Date.now() });
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
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_update', target_type: 'user', target_id: body.userId, detail: `更新用户 ${body.userId}: ${JSON.stringify(body.updates)}`, ip_address: null, created_at: Date.now() });
      return NextResponse.json({ success: Boolean(user), user });
    }

    if (body.action === 'delete') {
      if (!body.userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
      }
      const deleted = await deleteManagedUser(body.userId);
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_delete', target_type: 'user', target_id: body.userId, detail: `删除用户 ${body.userId}`, ip_address: null, created_at: Date.now() });
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
