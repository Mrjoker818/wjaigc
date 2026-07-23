import { NextRequest, NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { assertBrandIpGenerationAllowed } from '@/lib/brand-ip';
import {
  createBrandIpGenerationTask,
  executeBrandIpGeneration,
} from '@/lib/brand-ip-generation';
import { getBrandIpProject } from '@/lib/brand-ip-storage';
import type { User } from '@/lib/user-types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await getRequestUser(request);
  if (!authResult) {
    return NextResponse.json({ error: '未登录或会话已过期' }, { status: 401 });
  }

  const { user } = authResult;

  if (user.status === 'disabled') {
    return NextResponse.json({ error: '账号已被禁用' }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      projectId?: unknown;
      prompt?: unknown;
      model?: unknown;
      providerId?: unknown;
      aspectRatio?: unknown;
    };

    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!projectId || !prompt) {
      return NextResponse.json({ error: 'projectId 和 prompt 为必填项' }, { status: 400 });
    }

    const model = typeof body.model === 'string' ? body.model.trim() : undefined;
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : undefined;
    const aspectRatio = typeof body.aspectRatio === 'string' ? body.aspectRatio.trim() : undefined;

    const project = await getBrandIpProject(projectId, user.id);
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
      userId: user.id,
      userRole: user.role ?? 'user',
      project,
      direction,
      prompt,
      model,
      providerId,
      aspectRatio,
    });

    // Fire-and-forget the async generation pipeline.
    // The HTTP response returns 202 immediately with the task ID;
    // the client polls /api/brand-ip/tasks/{taskId} for progress.
    void executeBrandIpGeneration({
      taskId: task.taskId,
      userId: user.id,
      userRole: user.role ?? 'user',
      user: user as User,
      projectId,
      directionId: direction.id,
      prompt,
      model,
      providerId,
      aspectRatio,
    }).catch(() => {
      // Errors are handled inside executeBrandIpGeneration via task-registry.
    });

    return NextResponse.json({ success: true, ...task }, { status: 202 });
  } catch {
    return NextResponse.json({ error: '品牌 IP 图像任务创建失败' }, { status: 400 });
  }
}
