import { describe, expect, it } from 'vitest';
import { uncertainDramaSubmission } from '@/lib/drama/receipt-client';
import { pollShotTake } from '@/lib/drama/workbench-client';
import { followProductionImage } from '@/lib/drama/production-image-client';

describe('uncertain upstream results never open a new paid attempt', () => {
  it.each(['提交超时，请稍后重试', '提交视频生成任务失败：未获取到任务ID', '视频任务在服务重启前未取得供应商任务标识，已自动退款，请重新提交'])('retains the original receipt for %s', async error => {
    expect(uncertainDramaSubmission(error)).toBe(true);
    const fetcher = async () => new Response(JSON.stringify({ status: 'failed', retryable: true, error }));
    const take = await pollShotTake({ id: 't', taskId: 'known', status: 'generating', createdAt: 1 }, 'm', 'p', { fetch: fetcher });
    expect(take).toMatchObject({ status: 'generating', taskId: 'known', retryable: false });
    const image = await followProductionImage({ id: 'i', target: { kind: 'cast', entityId: 'c', view: 'front' }, taskId: 'known-image', modelId: 'm', providerId: 'p', state: 'generating', createdAt: 1, updatedAt: 1 }, { fetch: fetcher, checkpoint: async () => {} });
    expect(image).toMatchObject({ state: 'unknown', taskId: 'known-image' });
  });
});
