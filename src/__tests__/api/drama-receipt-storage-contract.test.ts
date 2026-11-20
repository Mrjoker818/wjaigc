import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => ({ userId: 'drama_receipt_owner', user: { id: 'drama_receipt_owner', role: 'admin', productType: 'canvas,video' } }) }));
import { recordImageTaskSubmitted, recordVideoTaskSubmitted } from '@/lib/cloud-task-persistence';
import { POST } from '@/app/api/drama/take-receipt/route';
import { closePool } from '@/lib/db-client';
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/drama/take-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
afterAll(async () => { await closePool(); });

describe('original receipt storage contract in the dedicated database', () => {
  it('finds actual legacy image and video submission records by exact durable source identity', async () => {
    await recordImageTaskSubmitted({ taskId: 'drama_image_storage_contract', userId: 'drama_receipt_owner', providerId: 'p', model: 'm', sessionId: 'drama-image:image_contract', messageId: 'image_contract', creditCost: 0 });
    const image = await post({ kind: 'image', operationId: 'image_contract', providerId: 'p', modelId: 'm' });
    expect(image.status).toBe(200); expect(await image.json()).toMatchObject({ taskId: 'drama_image_storage_contract' });
    await recordImageTaskSubmitted({ taskId: 'drama_image_batch_contract', type: 'generate-async', userId: 'drama_receipt_owner', providerId: 'p', model: 'p::m', sessionId: 'drama-image:image_batch_contract', messageId: 'image_batch_contract', idempotencyKey: 'drama:image:image_batch_contract:0', creditCost: 0 });
    const batch = await post({ kind: 'image', operationId: 'image_batch_contract', providerId: 'p', modelId: 'm' });
    expect(batch.status).toBe(200); expect(await batch.json()).toMatchObject({ taskId: 'drama_image_batch_contract' });
    await recordVideoTaskSubmitted({ taskId: 'drama_video_storage_contract', userId: 'drama_receipt_owner', providerId: 'p', model: 'v', sessionId: 'drama-take:shot_contract:take_contract', messageId: 'take_contract', creditCost: 0, deferCreditCharge: true });
    const video = await post({ shotId: 'shot_contract', takeId: 'take_contract', providerId: 'p', modelId: 'v' });
    expect(video.status).toBe(200); expect(await video.json()).toMatchObject({ taskId: 'drama_video_storage_contract' });
    expect((await post({ shotId: 'other', takeId: 'take_contract', providerId: 'p', modelId: 'v' })).status).toBe(202);
  });
});
