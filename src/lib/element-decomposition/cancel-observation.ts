import {
  cancelElementDecomposition,
  ElementDecompositionClientError,
  type ElementDecomposeTaskResponse,
} from '@/lib/element-decomposition/client';

/** Keep the original task's observer alive until the server confirms a terminal outcome. */
export async function cancelElementDecompositionObserved(
  taskId: string,
  observer?: AbortController | null,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse> {
  const task = await cancelElementDecomposition(taskId, signal);
  if (task.taskId !== taskId || !['completed', 'partial', 'failed', 'cancelled', 'timeout'].includes(task.overallStatus)) {
    throw new ElementDecompositionClientError(
      'ELEMENT_CANCELLATION_UNCONFIRMED',
      '取消尚未确认，继续读取原任务状态',
      409,
      true,
    );
  }
  observer?.abort(new DOMException('Element task reached an authoritative terminal state', 'AbortError'));
  return task;
}
