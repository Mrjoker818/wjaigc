import { NextRequest, NextResponse } from 'next/server';
import { cancelTask, isTaskCancelled, getTaskInfo } from '@/lib/task-registry';
import { cancelEditTask } from '@/lib/edit-task-store';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';
import { refundCredits } from '@/lib/credits';
import { recordCloudTaskCancelled } from '@/lib/cloud-task-persistence';
import {
  getCloudTaskForUser,
  refundCloudTaskCredits,
  terminateCloudTaskAndRefund,
} from '@/lib/cloud-task-storage';

export const dynamic = 'force-dynamic';

function requiresAtomicTerminalSettlement(task: Awaited<ReturnType<typeof getCloudTaskForUser>>): boolean {
  if (task?.type === 'video' || task?.type === 'video-extend') return true;

  const submissionPayload = task?.result?.submissionPayload;
  if (!submissionPayload || typeof submissionPayload !== 'object') return false;

  const payload = submissionPayload as Record<string, unknown>;
  return task?.type === 'generate-async'
    && typeof payload.batchId === 'string'
    && typeof payload.slotId === 'string'
    && typeof payload.slotIndex === 'number';
}

/**
 * POST /api/cancel-task
 * 取消正在进行的任务
 *
 * Body: { taskId: string }
 * Response: { success: boolean, message?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // 认证检查：只有登录用户才能取消任务
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

    // 检查任务是否存在于注册中心
    const taskInfo = getTaskInfo(taskId);
    const persistedTask = await getCloudTaskForUser(taskId, user.id);
    const atomicTerminalTask = requiresAtomicTerminalSettlement(persistedTask);
    const atomicCancellationReason = persistedTask?.type === 'video' || persistedTask?.type === 'video-extend'
      ? `视频任务已取消 (taskId: ${taskId})`
      : `图像生成槽位已取消 (taskId: ${taskId})`;

    // After a restart the in-memory registry may be empty. Use the persisted
    // task owner before allowing a normal user to cancel a historical task.
    if (!taskInfo && user.role !== 'admin') {
      if (!persistedTask) {
        return NextResponse.json(
          { success: false, error: '任务不存在或无权取消' },
          { status: 404 },
        );
      }
    }

    // 权限检查：只有任务创建者或管理员可以取消
    if (taskInfo?.userId && taskInfo.userId !== 'anonymous' && taskInfo.userId !== user.id) {
      // 非管理员不能取消其他用户的任务
      if (user.role !== 'admin') {
        return NextResponse.json(
          { success: false, error: '无权取消此任务' },
          { status: 403 }
        );
      }
    }

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
      if (persistedTask?.type === 'annotation-edit') {
        await terminateCloudTaskAndRefund(taskId, 'cancelled', 'Annotation edit cancelled');
      } else if (atomicTerminalTask) {
        await terminateCloudTaskAndRefund(taskId, 'cancelled', atomicCancellationReason);
      }
      return NextResponse.json({
        success: true,
        message: '任务已取消',
        task: safeTaskInfo,
      });
    }

    cancelTask(taskId);

    // 同时取消 edit-task-store 中的任务
    cancelEditTask(taskId);

    // ★ 退款：取消任务时退还已扣除的积分
    let refunded = false;
    let terminalSettled = false;
    const creditCost = taskInfo?.creditCost ?? persistedTask?.creditCost ?? 0;
    const creditOwnerId = taskInfo?.userId ?? persistedTask?.userId;
    if (atomicTerminalTask) {
      try {
        const settlement = await terminateCloudTaskAndRefund(
          taskId,
          'cancelled',
          atomicCancellationReason,
        );
        refunded = settlement.refunded || persistedTask?.creditStatus === 'refunded';
        terminalSettled = true;
      } catch (refundErr) {
        console.error('[cancel-task] Atomic provider task cancellation settlement failed:', refundErr);
      }
    } else if (persistedTask?.type === 'annotation-edit') {
      try {
        const settlement = await terminateCloudTaskAndRefund(
          taskId,
          'cancelled',
          `Annotation edit cancelled (taskId: ${taskId})`,
        );
        refunded = settlement.refunded || persistedTask.creditStatus === 'refunded';
        terminalSettled = true;
      } catch (refundErr) {
        console.error('[cancel-task] Annotation cancellation settlement failed:', refundErr);
      }
    } else if (persistedTask && creditCost > 0) {
      try {
        const refund = await refundCloudTaskCredits(
          taskId,
          `任务取消退款 (taskId: ${taskId}, type: ${taskInfo?.type || persistedTask.type || 'unknown'})`,
        );
        refunded = refund.refunded || persistedTask.creditStatus === 'refunded';
        if (refund.refunded) console.log(`[cancel-task] Refunded ${refund.creditCost} credits for cancelled task ${taskId}`);
      } catch (refundErr) {
        console.error('[cancel-task] Refund failed:', refundErr);
      }
    } else if (creditCost > 0 && creditOwnerId && creditOwnerId !== 'anonymous') {
      try {
        await refundCredits(
          creditOwnerId,
          creditCost,
          `任务取消退款 (taskId: ${taskId}, type: ${taskInfo?.type || 'unknown'})`,
          taskId,
        );
        refunded = true;
      } catch (refundErr) {
        console.error('[cancel-task] Refund failed:', refundErr);
      }
    }
    if (!terminalSettled) {
      void recordCloudTaskCancelled(taskId, refunded)
        .catch((error) => console.warn('[cancel-task] Cloud task cancellation persistence failed:', error));
    }

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
