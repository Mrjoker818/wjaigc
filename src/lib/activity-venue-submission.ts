import { submitPaidProviderJson } from '@/lib/paid-provider-submit';
import { updateTaskProgress } from '@/lib/task-registry';

export async function submitVenueCompletion(input: {
  taskId: string; baseUrl: string; apiKey: string; body: Record<string, unknown>;
}): Promise<string | undefined> {
  const { taskId } = input;
  const receipt = await submitPaidProviderJson({
    ...input, path: '/chat/completions', signal: AbortSignal.timeout(60_000),
  });
  if (receipt.kind === 'received') {
    const choices = receipt.data.choices;
    const choice = Array.isArray(choices) ? choices[0] as { message?: { content?: unknown } } | undefined : undefined;
    const content = choice?.message?.content;
    if (typeof content === 'string') return content;
  }
  if (receipt.kind === 'rejected') {
    updateTaskProgress(taskId, { status: 'failed', error: `供应商拒绝请求（HTTP ${receipt.status}）` });
  } else {
    updateTaskProgress(taskId, {
      status: 'failed',
      error: `供应商受理状态待核实（任务 ${taskId}）。请先核实任务状态和费用，勿重复提交。`,
      result: { venueSubmissionUnconfirmed: true },
    });
  }
  return undefined;
}
