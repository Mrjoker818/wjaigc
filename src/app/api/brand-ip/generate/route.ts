import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import { assertBrandIpGenerationAllowed } from '@/lib/brand-ip';
import { createBrandIpGenerationTask } from '@/lib/brand-ip-generation';
import { getBrandIpProject } from '@/lib/brand-ip-storage';

export const runtime = 'nodejs';

function isAuthRejection(value: Awaited<ReturnType<typeof requireApiAuthOrReject>>): value is NextResponse {
  return value instanceof NextResponse;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  try {
    const body = await request.json() as { projectId?: unknown; prompt?: unknown };
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!projectId || !prompt) {
      return NextResponse.json({ error: 'projectId 和 prompt 为必填项' }, { status: 400 });
    }

    const project = await getBrandIpProject(projectId, auth.userId);
    if (!project) return NextResponse.json({ error: '品牌 IP 项目不存在' }, { status: 404 });

    let direction;
    try {
      direction = assertBrandIpGenerationAllowed(project);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '角色方向尚未确认' },
        { status: 409 },
      );
    }

    const task = await createBrandIpGenerationTask({
      userId: auth.userId,
      project,
      direction,
      prompt,
    });
    return NextResponse.json({ success: true, ...task }, { status: 202 });
  } catch {
    return NextResponse.json({ error: '品牌 IP 图像任务创建失败' }, { status: 400 });
  }
}
