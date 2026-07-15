import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { getHumanRepairTask } from '@/lib/human-repair-service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const user = await getSessionUser(request);
  const { id } = await context.params;
  const task = user ? getHumanRepairTask(id, user.id) : undefined;
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  return NextResponse.json({ success: true, task });
}
