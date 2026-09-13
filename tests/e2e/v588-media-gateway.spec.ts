import { expect, test, type APIRequestContext } from '@playwright/test';

const cloudRun = process.env.E2E_MEDIA_GATEWAY_RUN === '1';
const expectedMode = process.env.E2E_MEDIA_GATEWAY_EXPECTED_MODE;
const gatewayKey = process.env.E2E_MEDIA_GATEWAY_KEY;
const secondUserKey = process.env.E2E_MEDIA_GATEWAY_SECOND_USER_KEY;
const revokedKey = process.env.E2E_MEDIA_GATEWAY_REVOKED_KEY;
const imageProviderId = process.env.E2E_MEDIA_GATEWAY_IMAGE_PROVIDER_ID;
const imageModelId = process.env.E2E_MEDIA_GATEWAY_IMAGE_MODEL_ID;
const videoProviderId = process.env.E2E_MEDIA_GATEWAY_VIDEO_PROVIDER_ID;
const videoModelId = process.env.E2E_MEDIA_GATEWAY_VIDEO_MODEL_ID;

interface Submission {
  success: true;
  requestId: string;
  gatewayRequestId: string;
  taskIds: string[];
  status: string;
}

interface TaskProjection {
  success: true;
  requestId: string;
  taskId: string;
  status: string;
  progress: number;
  resultUrls?: string[];
  assetVersionId?: string;
  previewUrl?: string;
  downloadUrl?: string;
  thumbnailUrls?: Partial<Record<'256' | '512', string>>;
}

function headers(key: string, idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

async function waitForTerminal(
  request: APIRequestContext,
  key: string,
  taskId: string,
): Promise<TaskProjection> {
  await expect.poll(async () => {
    const response = await request.get(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: headers(key),
    });
    if (!response.ok()) return `http-${response.status()}`;
    return ((await response.json()) as TaskProjection).status;
  }, { timeout: 10 * 60_000, intervals: [1_000, 2_000, 5_000] }).toMatch(/completed|failed|cancelled|timeout/);

  const response = await request.get(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: headers(key),
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<TaskProjection>;
}

test.describe('V588-MEDIA-001 cloud rollout evidence', () => {
  test.skip(!cloudRun, '仅在 Coze exact SHA 部署并显式设置 E2E_MEDIA_GATEWAY_RUN=1 后执行');

  test('default-disabled rollout returns a stable 503 without accepting work', async ({ request }) => {
    test.skip(expectedMode !== 'disabled', '仅用于默认关闭态部署检查');
    const response = await request.post('/api/gateway/v1/images', {
      headers: { 'content-type': 'application/json' },
      data: { prompt: 'release probe', providerId: 'probe', modelId: 'probe' },
    });

    expect(response.status()).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'GATEWAY_DISABLED',
      retryable: false,
      requestId: expect.any(String),
    });
  });

  test.describe('temporarily enabled rollout', () => {
    test.skip(expectedMode !== 'enabled', '仅用于审批后的临时开启态');

    test.beforeEach(() => {
      expect(gatewayKey, '缺少脱敏保存之外的运行时测试 Key').toBeTruthy();
      expect(secondUserKey, '缺少跨用户隔离测试 Key').toBeTruthy();
      expect(revokedKey, '缺少已吊销测试 Key').toBeTruthy();
      expect(imageProviderId).toBeTruthy();
      expect(imageModelId).toBeTruthy();
      expect(videoProviderId).toBeTruthy();
      expect(videoModelId).toBeTruthy();
    });

    test('rejects missing, invalid, and revoked credentials', async ({ request }) => {
      const payload = { prompt: 'authentication boundary', providerId: imageProviderId!, modelId: imageModelId! };
      const missing = await request.post('/api/gateway/v1/images', { data: payload });
      expect(missing.status()).toBe(401);
      await expect(missing.json()).resolves.toMatchObject({ success: false, code: 'GATEWAY_AUTH_REQUIRED' });

      const invalid = await request.post('/api/gateway/v1/images', {
        headers: headers(`wmg_${'x'.repeat(43)}`, `invalid-${Date.now()}`),
        data: payload,
      });
      expect(invalid.status()).toBe(401);
      await expect(invalid.json()).resolves.toMatchObject({ success: false, code: 'GATEWAY_KEY_INVALID' });

      const revoked = await request.post('/api/gateway/v1/images', {
        headers: headers(revokedKey!, `revoked-${Date.now()}`),
        data: payload,
      });
      expect(revoked.status()).toBe(401);
      await expect(revoked.json()).resolves.toMatchObject({ success: false, code: 'GATEWAY_KEY_INVALID' });
    });

    test('submits n=2 images, reuses the idempotent request, and exposes authoritative assets', async ({ request }) => {
      const idempotencyKey = `e2e-image-${Date.now()}`;
      const payload = {
        prompt: 'Two clean product photographs on a neutral studio background',
        providerId: imageProviderId!,
        modelId: imageModelId!,
        n: 2,
        aspectRatio: '1:1',
      };
      const first = await request.post('/api/gateway/v1/images', {
        headers: headers(gatewayKey!, idempotencyKey),
        data: payload,
      });
      expect(first.status()).toBe(202);
      const submission = await first.json() as Submission;
      expect(submission).toMatchObject({ success: true, requestId: expect.any(String), gatewayRequestId: expect.any(String) });
      expect(submission.taskIds).toHaveLength(2);

      const replay = await request.post('/api/gateway/v1/images', {
        headers: headers(gatewayKey!, idempotencyKey),
        data: payload,
      });
      expect(replay.status()).toBe(202);
      await expect(replay.json()).resolves.toMatchObject({
        success: true,
        gatewayRequestId: submission.gatewayRequestId,
        taskIds: submission.taskIds,
      });

      const completed = await Promise.all(submission.taskIds.map(taskId => waitForTerminal(request, gatewayKey!, taskId)));
      for (const task of completed) {
        expect(task.status).toBe('completed');
        expect(task.resultUrls?.length).toBeGreaterThan(0);
        expect(task.assetVersionId).toEqual(expect.any(String));
        expect(task.previewUrl).toEqual(expect.any(String));
        expect(task.downloadUrl).toEqual(expect.any(String));
        expect(task.thumbnailUrls?.['256']).toEqual(expect.any(String));
        expect(task.thumbnailUrls?.['512']).toEqual(expect.any(String));
      }
    });

    test('submits a video and projects its terminal result', async ({ request }) => {
      const response = await request.post('/api/gateway/v1/videos', {
        headers: headers(gatewayKey!, `e2e-video-${Date.now()}`),
        data: {
          prompt: 'A slow cinematic camera move across a quiet product display',
          providerId: videoProviderId!,
          modelId: videoModelId!,
          duration: 5,
          aspectRatio: '16:9',
        },
      });
      expect(response.status()).toBe(202);
      const submission = await response.json() as Submission;
      expect(submission.taskIds).toHaveLength(1);
      const terminal = await waitForTerminal(request, gatewayKey!, submission.taskIds[0]!);
      expect(terminal.status).toBe('completed');
      expect(terminal.resultUrls?.length).toBeGreaterThan(0);
    });

    test('cancels one owned task and rejects a second user reading it', async ({ request }) => {
      const response = await request.post('/api/gateway/v1/images', {
        headers: headers(gatewayKey!, `e2e-cancel-${Date.now()}`),
        data: {
          prompt: 'A cancellable media gateway release probe',
          providerId: imageProviderId!,
          modelId: imageModelId!,
        },
      });
      expect(response.status()).toBe(202);
      const submission = await response.json() as Submission;
      const taskId = submission.taskIds[0]!;

      const forbidden = await request.get(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}`, {
        headers: headers(secondUserKey!),
      });
      expect(forbidden.status()).toBe(404);
      await expect(forbidden.json()).resolves.toMatchObject({ success: false, code: 'GATEWAY_TASK_NOT_FOUND' });

      const cancelled = await request.post(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
        headers: headers(gatewayKey!),
      });
      expect([200, 409]).toContain(cancelled.status());
      if (cancelled.status() === 200) {
        await expect(cancelled.json()).resolves.toMatchObject({ success: true, taskId, status: 'cancelled' });
      }
    });
  });
});
