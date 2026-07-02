import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';

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
    const saveRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/user-data/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        dataKey: `workflow_${workflow.id}`,
        dataValue: JSON.stringify(workflow),
      }),
    });

    if (!saveRes.ok) {
      const errData = await saveRes.json().catch(() => ({}));
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
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    // 从用户数据 API 加载所有工作流
    const loadRes = await fetch(`http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}/api/user-data/sync?userId=${encodeURIComponent(userId)}&prefix=workflow_`);

    if (!loadRes.ok) {
      return NextResponse.json({ workflows: [] });
    }

    const data = await loadRes.json();
    const workflows: unknown[] = [];

    // 解析存储的工作流
    if (data.data && typeof data.data === 'object') {
      for (const [, value] of Object.entries(data.data as Record<string, string>)) {
        try {
          if (typeof value === 'string' && value.startsWith('{')) {
            workflows.push(JSON.parse(value));
          }
        } catch { /* skip invalid */ }
      }
    }

    return NextResponse.json({ workflows });

  } catch (error) {
    console.error('[Workflow Load] 加载失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '加载失败', workflows: [] },
      { status: 500 }
    );
  }
}
