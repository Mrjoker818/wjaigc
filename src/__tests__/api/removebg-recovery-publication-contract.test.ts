import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const boundary = vi.hoisted(() => ({ task: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({ userId: 'source-editor' }),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  getCloudTaskForUserByIdempotencyKey: boundary.task,
  listCloudTasks: vi.fn(),
}));

import { GET } from '@/app/api/tasks/recover/route';

const url = 'http://localhost/api/tasks/recover?projectId=source-shared&idempotencyKey=removebg-key&sourceVersionId=source-version';

function completedTask(imageUrl: string) {
  return {
    id: 'removebg-task', projectId: 'source-shared', type: 'image-edit',
    providerId: 'local-rembg', status: 'completed', requestDigest: 'a'.repeat(64),
    result: {
      imageEditAdmission: { kind: 'document-cpu-removebg', parentVersionIds: ['source-version'],
        requestDigest: 'a'.repeat(64) },
      imageEditQuote: { confirmed: true, total: 5, components: { removebg: 5 } },
      imageUrl, maskUrl: '/api/serve-upload/exports/mask.png',
      imageEditPublicationCheckpoint: { version: 1, taskId: 'removebg-task',
        requestDigest: 'a'.repeat(64), status: 'persisted', providerId: 'local-rembg',
        modelId: 'birefnet-general-lite', outputs: [
          { outputIndex: 0, role: 'primary', url: '/api/serve-upload/exports/primary.png' },
          { outputIndex: 1, role: 'mask', url: '/api/serve-upload/exports/mask.png' },
        ] },
      assetProjection: { status: 'completed', references: [
        { url: '/api/serve-upload/exports/primary.png', assetVersionId: 'primary-version' },
        { url: '/api/serve-upload/exports/mask.png', assetVersionId: 'mask-version' },
      ] },
    },
  };
}

describe('document remove-background recovery publication', () => {
  beforeEach(() => { boundary.task.mockReset(); });

  it('withholds a completed publication when its result URL differs from the published asset', async () => {
    boundary.task.mockResolvedValue(completedTask('/api/serve-upload/exports/unpublished.png'));
    const response = await GET(new NextRequest(url));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, found: true, taskId: 'removebg-task', status: 'completed' });
    expect(payload).not.toHaveProperty('publication');
  });

  it('returns the matching primary and mask asset references for the original owner request', async () => {
    boundary.task.mockResolvedValue(completedTask('/api/serve-upload/exports/primary.png'));
    const response = await GET(new NextRequest(url));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.publication).toMatchObject({
      imageUrl: '/api/serve-upload/exports/primary.png',
      maskUrl: '/api/serve-upload/exports/mask.png',
    });
  });
});
