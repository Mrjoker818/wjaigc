import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/server-auth';
import { selectHumanRepairCandidate } from '@/lib/human-repair-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireApiAuthOrReject(request);
  if (auth instanceof NextResponse) return auth;
  const user = await getSessionUser(request);
  const body = await request.json() as { taskId?: string; candidateId?: string };
  if (!user || !body.taskId || !body.candidateId) return NextResponse.json({ error: '缺少任务或候选结果' }, { status: 400 });
  try {
    const candidate = await selectHumanRepairCandidate(body.taskId, user.id, body.candidateId);
    return NextResponse.json({ success: true, candidate });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '保存人物精修版本失败' }, { status: 400 });
  }
}
