import { NextRequest, NextResponse } from 'next/server';
import { cancelTask, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { cancelEditTask } from '@/lib/edit-task-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cancel-task
 * 取消正在进行的任务
 *
 * Body: { taskId: string }
 * Response: { success: boolean, message?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId 必须为非空字符串' },
        { status: 400 }
      );
    }

    // 检查任务是否存在于注册中心
    const taskInfo = getTaskInfo(taskId);

    // 即使注册中心没有记录，也尝试取消（可能任务在旧store中）
    // 过滤敏感字段
    const safeTaskInfo = taskInfo ? (() => {
      const { result, ...rest } = taskInfo;
      if (result && typeof result === 'object') {
        const { apiKey: _ak, apiBaseUrl: _abu, ...safeResult } = result as Record<string, unknown>;
        return { ...rest, result: safeResult };
      }
      return rest;
    })() : null;

    if (isTaskCancelled(taskId)) {
      return NextResponse.json({
        success: true,
        message: '任务已取消',
        task: safeTaskInfo,
      });
    }

    cancelTask(taskId);

    // 同时取消 edit-task-store 中的任务
    cancelEditTask(taskId);

    return NextResponse.json({
      success: true,
      message: '任务取消请求已发送',
      task: safeTaskInfo,
    });
  } catch (err) {
    console.error('[cancel-task] Error:', err);
    return NextResponse.json(
      { success: false, error: '取消任务失败' },
      { status: 500 }
    );
  }
}
