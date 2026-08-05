import { NextRequest, NextResponse } from 'next/server';
import { getQueuePosition, getTaskInfo } from '@/lib/task-registry';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/queue-position?taskId=xxx
 * POST /api/queue-position  Body: { taskId: string }
 * 查询排队中任务的位置
 *
 * Response: { success: boolean, queuePosition: number, status?: string }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登录，请先登录' },
        { status: 401 }
      );
    }

    const taskId = request.nextUrl.searchParams.get('taskId') || '';
    if (!taskId) {
      return NextResponse.json(
        { success: false, error: 'taskId 参数必填' },
        { status: 400 }
      );
    }

    const queuePosition = getQueuePosition(taskId);
    const taskInfo = getTaskInfo(taskId);

    return NextResponse.json({
      success: true,
      queuePosition,
      status: taskInfo?.status || null,
    });
  } catch (error) {
    console.error('[queue-position] query failed:', error);
    return NextResponse.json(
      { success: false, error: '查询排队位置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登录，请先登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { taskId } = body;

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId 必须为非空字符串' },
        { status: 400 }
      );
    }

    const queuePosition = getQueuePosition(taskId);
    const taskInfo = getTaskInfo(taskId);

    return NextResponse.json({
      success: true,
      queuePosition,
      status: taskInfo?.status || null,
    });
  } catch (error) {
    console.error('[queue-position] query failed:', error);
    return NextResponse.json(
      { success: false, error: '查询排队位置失败' },
      { status: 500 }
    );
  }
}
