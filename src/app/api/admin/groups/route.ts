import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dbMutateGroup, dbReadGroups } from '@/lib/db-storage';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const groupName = z.string().trim().min(1);
const groupOptions = {
  productTypes: z.array(z.string()).optional(),
  creditQuota: z.number().int().min(0).max(2147483647).optional(),
  isActive: z.boolean().optional(),
};
const groupMutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: groupName, ...groupOptions }),
  z.object({ action: z.literal('update'), id: z.string().min(1), name: groupName.optional(), ...groupOptions }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

function unknownOutcome(): NextResponse {
  return NextResponse.json({ success: false, outcome: 'unknown', error: 'Group operation outcome unknown' }, { status: 503 });
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }
    const groups = await dbReadGroups({ strict: true });
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    console.error('[admin/groups] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load groups' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  const parsed = groupMutation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid group operation' }, { status: 400 });
  }
  const body = parsed.data;
  try {
    const group = await dbMutateGroup(body.action === 'create' ? {
      action: 'create',
      group: {
        id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: body.name,
        product_types: body.productTypes ?? [],
        credit_quota: body.creditQuota ?? 0,
        is_active: body.isActive ?? true,
      },
    } : body, admin);
    if (!group && body.action === 'update') {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
    }
    if (body.action === 'delete') {
      return NextResponse.json({ success: true });
    }
    if (!group) return unknownOutcome();
    return NextResponse.json({ success: true, group });
  } catch {
    console.error('[admin/groups] unable to confirm mutation');
    return unknownOutcome();
  }
}
