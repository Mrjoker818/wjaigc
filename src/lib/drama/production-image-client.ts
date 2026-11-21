/** Resume the original image receipt; this module never retries an uncertain generate request. */
import { persistImage, type WorkbenchFetch } from './workbench-client';
import { productionImageInputSnapshot, type DramaProductionImage, type ProductionImageInput } from './production-state';
import { uncertainDramaSubmission } from './receipt-client';

interface ImageReceiptOptions {
  fetch?: WorkbenchFetch;
  checkpoint: (operation: DramaProductionImage) => Promise<void>;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}
const headers = { 'Content-Type': 'application/json' };
const first = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && Boolean(value));
const json = async (response: Response): Promise<Record<string, unknown>> => response.json().catch(() => ({}));

export async function followProductionImage(initial: DramaProductionImage, options: ImageReceiptOptions): Promise<DramaProductionImage> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let operation = initial;
  const write = async (patch: Partial<DramaProductionImage>) => {
    operation = { ...operation, ...patch, updatedAt: now() };
    await options.checkpoint(operation);
  };
  if (!operation.sourceUrl && !operation.taskId) {
    const response = await fetcher('/api/drama/take-receipt', { method: 'POST', headers, signal: options.signal, body: JSON.stringify({ kind: 'image', operationId: operation.id, modelId: operation.modelId, providerId: operation.providerId }) });
    const receipt = await json(response);
    if (!response.ok || typeof receipt.taskId !== 'string') {
      await write({ state: 'unknown', error: '尚未查到原生成回执，请在任务列表核对；不会自动再次生成或扣费' });
      return operation;
    }
    await write({ taskId: receipt.taskId, state: 'generating', error: undefined });
  }
  const deadline = now() + (options.timeoutMs ?? 5 * 60_000);
  while (!operation.sourceUrl && now() < deadline && !options.signal?.aborted) {
    let response: Response;
    try { response = await fetcher('/api/poll-task', { method: 'POST', headers, signal: options.signal, body: JSON.stringify({ taskId: operation.taskId, model: operation.modelId, providerId: operation.providerId }) }); }
    catch { await sleep(2500); continue; }
    const data = await json(response);
    const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {};
    if (data.status === 'completed') {
      const sourceUrl = first(data.imageUrl, result.imageUrl, data.url, result.url, Array.isArray(result.imageUrls) ? result.imageUrls[0] : undefined);
      if (!sourceUrl) { await write({ state: 'retrieving', error: '原任务已完成，产物地址尚未回读；请核对原回执' }); return operation; }
      await write({ state: 'retrieving', sourceUrl, error: undefined });
    } else if (data.status === 'timeout') {
      await write({ state: 'generating', error: '原任务查询超时，已保留回执，请稍后继续核对' }); return operation;
    } else if (uncertainDramaSubmission(data.error)) {
      await write({ state: 'unknown', error: '原供应商提交结果尚未确认，请核对原任务，勿重复生成' }); return operation;
    } else if (['failed', 'cancelled'].includes(String(data.status))) {
      await write({ state: 'failed', error: first(data.error) ?? '原生成任务未成功，请核对任务和积分流水' });
      return operation;
    } else await sleep(2500);
  }
  if (options.signal?.aborted) return operation;
  if (!operation.sourceUrl) { await write({ state: 'generating', error: '原任务仍未返回结果，已保留回执，稍后继续核对' }); return operation; }
  const url = await persistImage(operation.sourceUrl, fetcher);
  // A provider URL is useful for preview, but it is not proof that storage succeeded.
  await write({ url, state: url.startsWith('/') || url.startsWith('data:') ? 'stored' : 'retrieving', error: url === operation.sourceUrl && /^https?:/u.test(url) ? '原产物已找到，文件保存尚未完成，可继续回读' : undefined });
  return operation;
}

export async function submitProductionImage(
  initial: DramaProductionImage, input: ProductionImageInput, options: ImageReceiptOptions,
): Promise<DramaProductionImage> {
  const fetcher = options.fetch ?? fetch;
  // Freeze before the checkpoint's await: edits during saving must not change the paid request.
  input = { ...input, referenceImages: [...(input.referenceImages ?? [])] };
  initial = { ...initial, target: { ...initial.target }, inputSnapshot: productionImageInputSnapshot(input) };
  // Mandatory durable checkpoint before any paid request.
  await options.checkpoint(initial);
  if (options.signal?.aborted) {
    const stopped = { ...initial, state: 'failed' as const, error: '已停止，尚未提交生成请求', updatedAt: (options.now ?? Date.now)() };
    await options.checkpoint(stopped); return stopped;
  }
  let data: Record<string, unknown>;
  let response: Response;
  try {
    response = await fetcher('/api/generate', { method: 'POST', headers: { ...headers, 'idempotency-key': `drama:image:${initial.id}` }, signal: options.signal,
      body: JSON.stringify({ prompt: input.prompt, aspectRatio: input.aspectRatio, ...(input.referenceImages?.length ? { referenceImages: input.referenceImages } : {}), model: `${initial.providerId}::${initial.modelId}`, providerId: initial.providerId, n: 1, submitOnly: true, sessionId: `drama-image:${initial.id}`, messageId: initial.id }) });
    data = await json(response);
  } catch {
    const unknown = { ...initial, state: 'unknown' as const, error: '提交结果待核对，已保留原请求编号，不会自动重发', updatedAt: (options.now ?? Date.now)() };
    await options.checkpoint(unknown);
    return unknown;
  }
  if (!response.ok || data.success === false) {
    const uncertain = response.status >= 500 || response.status === 408 || response.status === 409 || !first(data.error) || uncertainDramaSubmission(data.error);
    const failed = { ...initial, state: uncertain ? 'unknown' as const : 'failed' as const, error: first(data.error) ?? '生成提交未成功，请核对原任务', updatedAt: (options.now ?? Date.now)() };
    await options.checkpoint(failed); return failed;
  }
  const sourceUrl = first(data.imageUrl, data.url, Array.isArray(data.directImageUrls) ? data.directImageUrls[0] : undefined);
  const taskId = first(data.taskId, Array.isArray(data.taskIds) ? data.taskIds[0] : undefined);
  const receipt: DramaProductionImage = { ...initial, ...(sourceUrl ? { sourceUrl } : {}), ...(taskId ? { taskId } : {}), state: sourceUrl ? 'retrieving' : taskId ? 'generating' : 'unknown', updatedAt: (options.now ?? Date.now)() };
  await options.checkpoint(receipt);
  return followProductionImage(receipt, options);
}
