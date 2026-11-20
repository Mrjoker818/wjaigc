import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTask } from '@/lib/cloud-task-storage';

const mocks = vi.hoisted(() => ({
  userId: 'owner_a', authenticated: true, productType: 'canvas,video',
  lookup: vi.fn<(owner: string, key: string) => Promise<CloudTask | null>>(),
  list: vi.fn<() => Promise<CloudTask[]>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => mocks.authenticated
  ? { userId: mocks.userId, user: { id: mocks.userId, role: 'user', productType: mocks.productType } }
  : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/cloud-task-storage', () => ({ getCloudTaskForUserByIdempotencyKey: mocks.lookup, listCloudTasks: mocks.list }));

const videoRequest = { shotId: 'shot_1', takeId: 'take_1', modelId: 'vendor/video-v1', providerId: 'provider_1' };
const imageRequest = { kind: 'image', operationId: 'image_op_1', modelId: 'vendor/image-v1', providerId: 'provider_1' };
const task = (patch: Partial<CloudTask> = {}): CloudTask => ({
  id: 'paid_task', userId: 'owner_a', type: 'video', status: 'completed', providerId: 'provider_1', model: 'vendor/video-v1',
  progress: 100, creditStatus: 'charged', creditCost: 12, createdAt: 1, updatedAt: 2, idempotencyKey: 'drama:shot_1:take_1',
  result: { videoUrl: '/video.mp4', videoThumbnailUrl: '/video.jpg', submissionPayload: { apiKey: 'private-key' }, privateKey: 'secret' },
  ...patch,
});
async function post(body: unknown) {
  const { POST } = await import('@/app/api/drama/take-receipt/route');
  return POST(new NextRequest('http://localhost/api/drama/take-receipt', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
}
beforeEach(() => {
  mocks.userId = 'owner_a'; mocks.authenticated = true; mocks.productType = 'canvas,video'; mocks.lookup.mockReset();
  mocks.lookup.mockResolvedValue(task());
  mocks.list.mockReset(); mocks.list.mockResolvedValue([]);
});

describe('POST /api/drama/take-receipt', () => {
  it('does not turn an upstream submission with a missing receipt into a safe resubmission after a local refund', async () => {
    mocks.lookup.mockResolvedValue(task({ status: 'failed', creditStatus: 'refunded', error: '视频任务在服务重启前未取得供应商任务标识，已自动退款，请重新提交' }));
    const response = await post(videoRequest);
    expect(await response.json()).toMatchObject({ status: 'pending', creditStatus: 'refunded', taskId: 'paid_task' });
  });
  it('returns only the mapped receipt and uses the server constructed owner-scoped key', async () => {
    const response = await post({ ...videoRequest, idempotencyKey: 'someone-elses-key', userId: 'owner_b' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskId: 'paid_task', status: 'completed', creditStatus: 'charged', result: { videoUrl: '/video.mp4', videoThumbnailUrl: '/video.jpg' } });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('owner_a', 'drama:shot_1:take_1');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('cannot recover another owner receipt even with identical shot and take ids', async () => {
    mocks.lookup.mockImplementation(async owner => owner === 'owner_a' ? task() : null);
    mocks.userId = 'owner_b';
    const response = await post(videoRequest);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'pending', code: 'DRAMA_RECEIPT_PENDING' });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('owner_b', 'drama:shot_1:take_1');
  });

  it.each([{ userId: 'owner_b' }, { type: 'image' }, { providerId: 'provider_other' }, { model: 'vendor/video-v1-alias' }])('does not disclose mismatched receipts: %j', async patch => {
    mocks.lookup.mockResolvedValue(task(patch));
    const response = await post(videoRequest);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data).toMatchObject({ status: 'pending', code: 'DRAMA_RECEIPT_MISMATCH' });
    expect(data).not.toHaveProperty('taskId');
    expect(data).not.toHaveProperty('result');
    expect(data).not.toHaveProperty('creditStatus');
  });

  it('returns an explicit pending receipt without fabricating a refund or task id', async () => {
    mocks.lookup.mockResolvedValue(null);
    const response = await post(videoRequest);
    const data = await response.json();
    expect(response.status).toBe(202);
    expect(data).toMatchObject({ status: 'pending', code: 'DRAMA_RECEIPT_PENDING' });
    expect(data).not.toHaveProperty('creditStatus');
    expect(data).not.toHaveProperty('taskId');
  });

  it('keeps storage errors generic and pending', async () => {
    mocks.lookup.mockRejectedValue(new Error('postgres://private-credentials'));
    const response = await post(videoRequest);
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data).toMatchObject({ status: 'pending', code: 'DRAMA_RECEIPT_UNAVAILABLE' });
    expect(JSON.stringify(data)).not.toContain('private-credentials');
    expect(data).not.toHaveProperty('creditStatus');
  });

  it.each([
    null, [], {}, { ...videoRequest, shotId: 'shot_1:take_other' }, { ...videoRequest, takeId: '../take_1' },
    { ...videoRequest, shotId: ' shot_1' }, { ...videoRequest, takeId: 'take_1\n' },
    { ...videoRequest, providerId: 'provider_1 ' }, { ...videoRequest, modelId: ' vendor/video-v1' },
    { ...videoRequest, kind: 'audio' }, { ...imageRequest, operationId: 'op:0' },
    { ...imageRequest, operationId: 'x'.repeat(129) }, { ...imageRequest, operationId: '' },
  ])('rejects unsafe or malformed identity without any lookup: %j', async body => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('requires authentication and video platform access before reading receipts', async () => {
    mocks.authenticated = false;
    expect((await post(videoRequest)).status).toBe(401);
    mocks.authenticated = true; mocks.productType = 'canvas';
    expect((await post(imageRequest)).status).toBe(403);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('recovers image operation receipts using the normal image key and an image-only whitelist', async () => {
    mocks.lookup.mockResolvedValue(task({ type: 'image', model: 'vendor/image-v1', idempotencyKey: 'drama:image:image_op_1', result: {
      imageUrl: '/image.png', imageUrls: ['/image.png', 'https://cdn.example/second.png'],
      videoUrl: '/private-video.mp4', submissionPayload: { apiKey: 'private' },
    } }));
    const response = await post(imageRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskId: 'paid_task', status: 'completed', creditStatus: 'charged', result: { imageUrl: '/image.png', imageUrls: ['/image.png', 'https://cdn.example/second.png'] } });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('owner_a', 'drama:image:image_op_1');
  });

  it.each([{ type: 'video' }, { providerId: 'provider_other' }, { model: 'vendor/image-v2' }])('rejects image receipt mismatches: %j', async patch => {
    mocks.lookup.mockResolvedValue(task({ type: 'image', model: 'vendor/image-v1', ...patch }));
    expect((await post(imageRequest)).status).toBe(409);
  });

  it('exposes no nested payload or upstream errors for an unfinished receipt', async () => {
    mocks.lookup.mockResolvedValue(task({ status: 'processing', error: 'upstream private-key', result: { videoUrl: '/uncommitted.mp4', submissionPayload: { apiKey: 'private' } } }));
    const data = await (await post(videoRequest)).json();
    expect(data).toEqual({ taskId: 'paid_task', status: 'processing', creditStatus: 'charged' });
  });
});
