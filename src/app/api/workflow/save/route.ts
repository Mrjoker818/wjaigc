import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';
import { dbGetUserData, dbListUserData, dbSetUserData } from '@/lib/db-storage';

/**
 * POST /api/workflow/save
 * 保存工作流到用户数据
 * 
 * 请求体:
 * {
 *   userId: string,
 *   workflow: Workflow对象
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 认证检查：只有登录用户才能保存工作流
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, workflow } = body;

    if (!userId || !workflow || !workflow.id) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 权限校验：只能保存自己的工作流
    if (user.id !== userId) {
      return NextResponse.json({ error: '无权操作其他用户的工作流' }, { status: 403 });
    }

    // 更新时间戳
    workflow.updatedAt = Date.now();

    // 保存到用户数据 API
    const saved = await dbSetUserData(user.id, `workflow_${workflow.id}`, workflow);

    if (!saved) {
      const errData = { storage: 'write-failed' };
      console.error('[Workflow Save] 保存失败:', errData);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true, workflowId: workflow.id });

  } catch (error) {
    console.error('[Workflow Save] 请求处理失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '保存失败' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/workflow/save
 * 加载用户的工作流列表
 * 
 * Query params:
 *   userId: string
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    if (requestedUserId && requestedUserId !== user.id) {
      return NextResponse.json({ error: '无权读取其他用户的工作流' }, { status: 403 });
    }
    const userId = user.id;

    // 从用户数据 API 加载所有工作流
    const dataKeys = await dbListUserData(userId);
    const workflowKeys = dataKeys.filter(({ dataKey }) => dataKey.startsWith('workflow_'));

    const workflows = (await Promise.all(workflowKeys.map(async ({ dataKey }) => {
      const value = await dbGetUserData(userId, dataKey);
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return null; }
      }
      return value;
    }))).filter((workflow): workflow is Record<string, unknown> => Boolean(workflow && typeof workflow === 'object'));

    // 解析存储的工作流

    return NextResponse.json({ workflows });

  } catch (error) {
    console.error('[Workflow Load] 加载失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '加载失败', workflows: [] },
      { status: 500 }
    );
  }
}
