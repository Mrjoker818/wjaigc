/** Read-only recovery of an original shot submission. Never call a generation endpoint here. */
import type { DramaTake } from './types';

/** A local refund does not prove an upstream request was never accepted. */
export function uncertainDramaSubmission(error: unknown): boolean {
  return typeof error === 'string' && /未(?:取得|获取到?).{0,10}任务(?:标识|编号|ID)|提交.{0,12}(?:待确认|中断|未知|超时)|SUBMISSION_UNKNOWN|receipt.{0,12}(?:lost|unknown)/iu.test(error);
}

export interface TakeDeliveryState {
  generation: 'unknown' | 'pending' | 'completed' | 'failed';
  result: 'pending' | 'available';
  code?: string;
  creditStatus?: 'pending' | 'charged' | 'refunded' | 'not-applicable';
}

/** A take carrying independent generation and result retrieval state. */
export type ReceiptTake = DramaTake & { deliveryState?: TakeDeliveryState };

export interface RecoverTakeReceiptOptions {
  shotId?: string;
  signal?: AbortSignal;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

function pending(take: DramaTake, code: string): ReceiptTake {
  return { ...take, status: 'submitted', retryable: false, error: '原任务回执尚未确认，请稍后恢复查询，勿重复提交。',
    deliveryState: { generation: 'unknown', result: 'pending', code } };
}

/**
 * Recover only a missing task id, using the ORIGINAL shot/take/model/provider identity. The parent
 * persists the returned take, then calls pollShotTake when it has a task id. No submission or retry.
 */
export async function recoverTakeReceipt(
  take: DramaTake, modelId: string | undefined, providerId: string | undefined,
  options: RecoverTakeReceiptOptions = {},
): Promise<ReceiptTake> {
  if (take.taskId) return take;
  if (!options.shotId || !modelId || !providerId) return pending(take, 'DRAMA_RECEIPT_IDENTITY_REQUIRED');
  // Saved catalog keys are providerId::modelId. This is exact decoding, never model-name matching.
  let receiptModelId = modelId;
  const separator = modelId.indexOf('::');
  if (separator !== -1) {
    if (modelId.slice(0, separator) !== providerId || !modelId.slice(separator + 2)) {
      return pending(take, 'DRAMA_RECEIPT_IDENTITY_REQUIRED');
    }
    receiptModelId = modelId.slice(separator + 2);
  }
  try {
    const response = await (options.fetch ?? fetch)('/api/drama/take-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: options.signal,
      body: JSON.stringify({ shotId: options.shotId, takeId: take.id, modelId: receiptModelId, providerId }),
    });
    const raw: unknown = await response.json();
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (!response.ok || typeof data.taskId !== 'string' || !data.taskId) {
      return pending(take, typeof data.code === 'string' ? data.code : 'DRAMA_RECEIPT_PENDING');
    }
    const deliveryState: TakeDeliveryState = { generation: 'pending', result: 'pending' };
    if (['pending', 'charged', 'refunded', 'not-applicable'].includes(String(data.creditStatus))) {
      deliveryState.creditStatus = data.creditStatus as TakeDeliveryState['creditStatus'];
    }
    const recovered: ReceiptTake = { ...take, taskId: data.taskId, status: 'generating', error: undefined, retryable: false, deliveryState };
    if (data.status === 'completed') {
      deliveryState.generation = 'completed';
      const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {};
      if (typeof result.videoUrl === 'string' && result.videoUrl) {
        deliveryState.result = 'available';
        recovered.status = 'completed';
        recovered.videoUrl = result.videoUrl;
        const thumbnail = result.videoThumbnailUrl ?? result.thumbnailUrl;
        if (typeof thumbnail === 'string' && thumbnail) recovered.thumbnailUrl = thumbnail;
      } else {
        deliveryState.code = 'DRAMA_RESULT_PENDING';
        recovered.error = '生成已完成，视频结果尚待取回，请恢复原任务查询。';
      }
    } else if (data.status === 'failed' || data.status === 'cancelled') {
      deliveryState.generation = 'failed';
      deliveryState.code = 'DRAMA_GENERATION_FAILED';
      recovered.status = 'failed';
      recovered.error = '原镜头任务未完成，请查看任务记录确认状态。';
    } else if (data.status === 'timeout') {
      deliveryState.code = 'DRAMA_POLL_TIMEOUT';
      recovered.error = '原任务查询超时，任务可能仍在运行，请恢复原任务查询。';
    }
    return recovered;
  } catch {
    return pending(take, 'DRAMA_RECEIPT_UNAVAILABLE');
  }
}
