import { NextRequest, NextResponse } from 'next/server';
import { dbReadGroups, dbWriteGroup, dbDeleteGroup } from '@/lib/db-storage';
import { requireAdminUser } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { dbAddAuditLog } from '@/lib/db-storage';

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
    const groups = await dbReadGroups();
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    console.error('[admin/groups] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load groups' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      action: 'create' | 'update' | 'delete';
      id?: string;
      name?: string;
      productTypes?: string[];
      creditQuota?: number;
      isActive?: boolean;
    };

    if (body.action === 'create') {
      if (!body.name) {
        return NextResponse.json({ success: false, error: 'Missing group name' }, { status: 400 });
      }
      const now = Date.now();
      const id = `group_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const group = {
        id,
        name: String(body.name).trim(),
        product_types: body.productTypes || [],
        credit_quota: body.creditQuota ?? 0,
        is_active: body.isActive !== false,
        created_at: now,
        updated_at: now,
      };
      await dbWriteGroup(group);
      await dbAddAuditLog({
        user_id: admin.id, user_name: admin.name,
        action: 'group_create', target_type: 'group', target_id: id,
        detail: `创建分组 ${body.name}`,
        ip_address: null, created_at: now,
      });
      return NextResponse.json({ success: true, group });
    }

    if (body.action === 'update') {
      if (!body.id) {
        return NextResponse.json({ success: false, error: 'Missing group id' }, { status: 400 });
      }
      const now = Date.now();
      const groups = await dbReadGroups();
      const existing = groups.find(g => g.id === body.id);
      if (!existing) {
        return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
      }
      const updated = {
        id: body.id,
        name: body.name !== undefined ? String(body.name).trim() : existing.name,
        product_types: body.productTypes !== undefined ? body.productTypes : existing.product_types,
        credit_quota: body.creditQuota !== undefined ? body.creditQuota : existing.credit_quota,
        is_active: body.isActive !== undefined ? body.isActive : existing.is_active,
        created_at: existing.created_at,
        updated_at: now,
      };
      await dbWriteGroup(updated);
      await dbAddAuditLog({
        user_id: admin.id, user_name: admin.name,
        action: 'group_update', target_type: 'group', target_id: body.id,
        detail: `更新分组 ${updated.name}`,
        ip_address: null, created_at: now,
      });
      return NextResponse.json({ success: true, group: updated });
    }

    if (body.action === 'delete') {
      if (!body.id) {
        return NextResponse.json({ success: false, error: 'Missing group id' }, { status: 400 });
      }
      await dbDeleteGroup(body.id);
      await dbAddAuditLog({
        user_id: admin.id, user_name: admin.name,
        action: 'group_delete', target_type: 'group', target_id: body.id,
        detail: `删除分组 ${body.id}`,
        ip_address: null, created_at: Date.now(),
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Group admin operation failed',
    }, { status: 500 });
  }
}
