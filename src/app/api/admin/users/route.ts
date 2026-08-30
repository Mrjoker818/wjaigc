import { NextRequest, NextResponse } from 'next/server';
import {
  createManagedUser,
  deleteManagedUser,
  deleteManagedUsers,
  isRootAdminUser,
  listManagedUsers,
  repairDuplicateUserIds,
  requireAdminUser,
  updateManagedUser,
} from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { dbListUserData, dbGetUserData, dbDeleteUserData, dbAddAuditLog } from '@/lib/db-storage';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';
import {
  projectAdminUsers,
  type ActivityProjectionRow,
  type CreditProjectionRow,
  type ProjectProjectionRow,
  type ProjectionCoverage,
} from '@/lib/admin-user-projection';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest): Promise<User | null> {
  return requireAdminUser(request);
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const users = await listManagedUsers();
    const databaseAvailable = isDatabaseConfigured();
    const projectionCoverage: ProjectionCoverage = {
      identity: 'available',
      credits: databaseAvailable ? 'available' : 'unavailable',
      projects: databaseAvailable ? 'available' : 'unavailable',
      activity: databaseAvailable ? 'available' : 'unavailable',
    };

    if (!databaseAvailable || users.length === 0) {
      return NextResponse.json({
        success: true,
        users: projectAdminUsers({ users, creditRows: [], projectRows: [], activityRows: [] }),
        projectionCoverage,
      });
    }

    const userIds = users.map(user => user.id);
    try {
      const [creditsResult, projectsResult, activityResult] = await Promise.all([
        execSql(
          'SELECT user_id, balance FROM wujie_credits WHERE user_id = ANY($1::text[])',
          [userIds],
        ),
        execSql(
          "SELECT user_id, data_value, updated_at FROM wujie_user_data WHERE data_key = 'projects' AND user_id = ANY($1::text[])",
          [userIds],
        ),
        execSql(
          `SELECT user_id, MAX(last_activity) AS last_activity
             FROM (
               SELECT user_id, MAX(created_at) AS last_activity
                 FROM wujie_audit_log
                WHERE user_id = ANY($1::text[])
                GROUP BY user_id
               UNION ALL
               SELECT user_id, MAX(updated_at) AS last_activity
                 FROM wujie_user_data
                WHERE user_id = ANY($1::text[])
                GROUP BY user_id
             ) activity
            GROUP BY user_id`,
          [userIds],
        ),
      ]);
      const enrichedUsers = projectAdminUsers({
        users,
        creditRows: creditsResult.rows as CreditProjectionRow[],
        projectRows: projectsResult.rows as ProjectProjectionRow[],
        activityRows: activityResult.rows as ActivityProjectionRow[],
      });
      return NextResponse.json({ success: true, users: enrichedUsers, projectionCoverage });
    } catch (error) {
      console.error({
        code: 'ADMIN_USER_PROJECTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({
        success: false,
        code: 'ADMIN_USER_PROJECTION_FAILED',
        error: 'Failed to load authoritative user metrics',
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[admin/users] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load users', users: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      action?: 'create' | 'update' | 'delete' | 'batch-delete' | 'resetPassword' | 'repair-duplicate-ids' | 'list-data' | 'get-data' | 'delete-data' | 'listUserData' | 'getUserData' | 'deleteUserData';
      userId?: string;
      userIds?: string[];
      name?: string;
      password?: string;
      newPassword?: string;
      email?: string;
      updates?: Record<string, unknown>;
      dataKey?: string;
      key?: string;
      groupId?: string;
    };

    if (body.action === 'repair-duplicate-ids') {
      if (!isRootAdminUser(admin)) {
        return NextResponse.json({ success: false, error: 'Root admin access required' }, { status: 403 });
      }
      const result = await repairDuplicateUserIds();
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_repair_duplicate_ids', target_type: 'user', target_id: null, detail: `Repaired ${result.repaired} duplicate user ID records`, ip_address: null, created_at: Date.now() });
      return NextResponse.json({ success: true, ...result });
    }

    if (body.action === 'create') {
      const user = await createManagedUser({
        name: String(body.name || ''),
        password: String(body.password || ''),
        email: body.email ? String(body.email) : undefined,
        groupId: body.groupId ? String(body.groupId) : undefined,
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
        ...(body.updates?.productType !== undefined ? { productType: String(body.updates.productType || '') || undefined } : {}),
        ...(body.updates?.chatModels !== undefined ? { chatModels: Array.isArray(body.updates.chatModels) ? body.updates.chatModels as string[] : undefined } : {}),
        ...(body.updates?.imageModels !== undefined ? { imageModels: Array.isArray(body.updates.imageModels) ? body.updates.imageModels as string[] : undefined } : {}),
        ...(body.updates?.dailyTokenLimit !== undefined ? { dailyTokenLimit: Number(body.updates.dailyTokenLimit) || undefined } : {}),
        ...(body.updates?.monthlyTokenLimit !== undefined ? { monthlyTokenLimit: Number(body.updates.monthlyTokenLimit) || undefined } : {}),
        ...(body.updates?.dailyImageLimit !== undefined ? { dailyImageLimit: Number(body.updates.dailyImageLimit) || undefined } : {}),
        ...(body.updates?.groupId !== undefined ? { groupId: String(body.updates.groupId || '') || undefined } : {}),
      });
      const auditUpdates = { ...body.updates };
      if (auditUpdates.password) {
        auditUpdates.password = '[REDACTED]';
      }
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_update', target_type: 'user', target_id: body.userId, detail: `更新用户 ${body.userId}: ${JSON.stringify(auditUpdates)}`, ip_address: null, created_at: Date.now() });
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

    if (body.action === 'batch-delete') {
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
        : [];
      if (userIds.length === 0) {
        return NextResponse.json({ success: false, error: 'Missing userIds' }, { status: 400 });
      }
      if (userIds.length > 500) {
        return NextResponse.json({ success: false, error: 'Too many users in one batch' }, { status: 400 });
      }

      const result = await deleteManagedUsers(userIds);
      await dbAddAuditLog({
        user_id: admin.id,
        user_name: admin.name,
        action: 'user_batch_delete',
        target_type: 'user',
        target_id: null,
        detail: `Deleted ${result.deletedIds.length} users; skipped ${result.skippedIds.length}`,
        ip_address: null,
        created_at: Date.now(),
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (body.action === 'resetPassword') {
      if (!body.userId) {
        return NextResponse.json({ success: false, error: 'Missing userId' }, { status: 400 });
      }
      const newPwd = String(body.newPassword || '');
      if (!newPwd || newPwd.length < 6) {
        return NextResponse.json({ success: false, error: '密码至少需要6个字符' }, { status: 400 });
      }
      const user = await updateManagedUser(body.userId, { password: newPwd });
      await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'user_reset_password', target_type: 'user', target_id: body.userId, detail: `重置用户 ${body.userId} 密码`, ip_address: null, created_at: Date.now() });
      return NextResponse.json({ success: Boolean(user), user });
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
