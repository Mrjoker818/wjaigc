import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

import {
  createMediaGatewayEvidence,
  createRecordedApiRequest,
  type RecordedApiRequest,
} from '../helpers/media-gateway-e2e-evidence';
import {
  attemptControlledLateCompletionWriteback,
  waitForProviderSubmissionState,
} from '../helpers/media-gateway-late-writeback';

test.use({ trace: 'on', video: 'on', screenshot: 'on' });

const cloudRun = process.env.E2E_MEDIA_GATEWAY_RUN === '1';
const expectedMode = process.env.E2E_MEDIA_GATEWAY_EXPECTED_MODE;
const env = {
  gatewayKey: process.env.E2E_MEDIA_GATEWAY_KEY,
  secondUserKey: process.env.E2E_MEDIA_GATEWAY_SECOND_USER_KEY,
  revokedKey: process.env.E2E_MEDIA_GATEWAY_REVOKED_KEY,
  rateLimitedKey: process.env.E2E_MEDIA_GATEWAY_RATE_LIMITED_KEY,
  dailyQuotaKey: process.env.E2E_MEDIA_GATEWAY_DAILY_QUOTA_KEY,
  imageProviderId: process.env.E2E_MEDIA_GATEWAY_IMAGE_PROVIDER_ID,
  imageModelId: process.env.E2E_MEDIA_GATEWAY_IMAGE_MODEL_ID,
  videoProviderId: process.env.E2E_MEDIA_GATEWAY_VIDEO_PROVIDER_ID,
  videoModelId: process.env.E2E_MEDIA_GATEWAY_VIDEO_MODEL_ID,
  username: process.env.E2E_MEDIA_GATEWAY_USERNAME,
  password: process.env.E2E_MEDIA_GATEWAY_PASSWORD,
};
const expectedUserId = process.env.E2E_MEDIA_GATEWAY_EXPECTED_USER_ID;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timeout']);

interface Submission extends Record<string, unknown> {
  success: true;
  requestId: string;
  gatewayRequestId: string;
  taskIds: string[];
}

interface TaskProjection extends Record<string, unknown> {
  success: true;
  requestId: string;
  taskId: string;
  status: string;
  progress: number;
  result?: Record<string, unknown>;
  assetVersionId?: string;
  previewUrl?: string;
  downloadUrl?: string;
  thumbnailUrls?: Partial<Record<'256' | '512', string>>;
}

interface CreditTransaction { id: string; type: string; amount: number; description?: string }

function headers(key: string, idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

async function readTask(request: RecordedApiRequest, key: string, taskId: string): Promise<TaskProjection> {
  const response = await request.get(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}`, { headers: headers(key) });
  expect(response.ok(), `task ${taskId} returned HTTP ${response.status()}`).toBe(true);
  return response.json() as Promise<TaskProjection>;
}

async function waitForTerminal(request: RecordedApiRequest, key: string, taskId: string): Promise<TaskProjection> {
  let latest: TaskProjection | undefined;
  await expect.poll(async () => {
    latest = await readTask(request, key, taskId);
    return latest.status;
  }, { timeout: 10 * 60_000, intervals: [1_000, 2_000, 5_000] }).toMatch(/completed|failed|cancelled|timeout/);
  return latest!;
}

async function showArtifactBeforeBatchTerminal(page: Page, url: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((source) => {
    const image = document.createElement('img');
    image.id = 'gateway-progressive-first-result';
    image.alt = '首个网关结果';
    image.src = source;
    image.style.cssText = 'position:fixed;inset:16px;width:256px;height:256px;object-fit:contain;z-index:2147483647';
    document.body.append(image);
  }, url);
  const image = page.locator('#gateway-progressive-first-result');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function waitForProgressiveImageCompletion(
  page: Page,
  request: RecordedApiRequest,
  key: string,
  taskIds: string[],
): Promise<{ completed: TaskProjection[]; firstVisibleBeforeBatchTerminal: true }> {
  const deadline = Date.now() + 10 * 60_000;
  let firstVisibleBeforeBatchTerminal = false;
  while (Date.now() < deadline) {
    const states: TaskProjection[] = [];
    for (const taskId of taskIds) states.push(await readTask(request, key, taskId));
    const completed = states.filter(task => task.status === 'completed');
    const nonTerminal = states.filter(task => !TERMINAL.has(task.status));
    const failed = states.filter(task => TERMINAL.has(task.status) && task.status !== 'completed');
    expect(failed, `batch entered non-success terminal state: ${JSON.stringify(failed)}`).toHaveLength(0);
    if (!firstVisibleBeforeBatchTerminal && completed.length > 0 && nonTerminal.length > 0) {
      expect(completed[0]!.previewUrl).toEqual(expect.any(String));
      await showArtifactBeforeBatchTerminal(page, completed[0]!.previewUrl!);
      firstVisibleBeforeBatchTerminal = true;
    }
    if (completed.length === taskIds.length) {
      expect(firstVisibleBeforeBatchTerminal, '未观察到首个槽位在批次终态前独立完成并可见').toBe(true);
      return { completed: states, firstVisibleBeforeBatchTerminal: true };
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error('Timed out waiting for progressive n=2 image completion');
}

async function assertMediaArtifact(
  request: RecordedApiRequest,
  url: string,
  kind: 'image' | 'video',
  expectedMaxDimension?: 256 | 512,
): Promise<void> {
  expect(url).toEqual(expect.any(String));
  const response = await request.get(url);
  expect(response.ok(), `${url} returned HTTP ${response.status()}`).toBe(true);
  const mime = response.headers()['content-type']?.split(';')[0] || '';
  expect(mime).toMatch(kind === 'image' ? /^image\// : /^video\//);
  const body = Buffer.from(await response.body());
  expect(body.byteLength).toBeGreaterThan(0);
  if (kind === 'image') {
    const metadata = await sharp(body).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
    if (expectedMaxDimension) expect(Math.max(metadata.width!, metadata.height!)).toBe(expectedMaxDimension);
  }
}

async function readTransactions(request: RecordedApiRequest): Promise<CreditTransaction[]> {
  const response = await request.get('/api/credits?transactions=true&limit=100');
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { success?: boolean; transactions?: CreditTransaction[] };
  expect(payload.success).toBe(true);
  return payload.transactions || [];
}

async function loginAndOpenCanvas(page: Page, request: RecordedApiRequest): Promise<void> {
  expect(env.username).toBeTruthy();
  expect(env.password).toBeTruthy();
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvasEntry = page.getByRole('button', { name: /无限画布/ }).first();
  if (await canvasEntry.isVisible().catch(() => false)) await canvasEntry.click();
  const usernameInput = page.getByPlaceholder('请输入用户名');
  if (await usernameInput.isVisible().catch(() => false)) {
    await usernameInput.fill(env.username!);
    await page.getByPlaceholder('请输入密码').fill(env.password!);
    const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^登录$/ }).click();
    expect((await loginResponse).ok()).toBe(true);
  }
  const me = await request.get('/api/auth/me');
  expect(me.ok()).toBe(true);
  const identity = await me.json() as { user?: { id?: string } };
  if (expectedUserId) expect(identity.user?.id).toBe(expectedUserId);
  const newProject = page.getByRole('button', { name: '新建项目', exact: true });
  if (await newProject.isVisible().catch(() => false)) await newProject.click();
  await expect(page.getByRole('button', { name: '图像生成器', exact: true })).toBeVisible();
}

async function assertLegacyUiCompatibility(page: Page, request: RecordedApiRequest): Promise<void> {
  await loginAndOpenCanvas(page, request);
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await page.getByRole('button', { name: '图像生成器', exact: true }).click();
  await expect(page.getByText('图像生成器', { exact: true }).last()).toBeVisible();
  const video = page.getByRole('button', { name: '视频生成', exact: true });
  if (!(await video.isVisible().catch(() => false))) await page.getByRole('button', { name: '全部工具', exact: true }).click();
  await expect(page.getByRole('button', { name: '视频生成', exact: true }).last()).toBeVisible();
}

async function assertAuthoritativeCancellation(
  request: RecordedApiRequest,
  taskId: string,
  transactionIdsBefore: Set<string>,
  providerStateBeforeCancel: Awaited<ReturnType<typeof waitForProviderSubmissionState>>,
) {
  const response = await request.post(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { headers: headers(env.gatewayKey!) });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, taskId, status: 'cancelled' });
  await expect.poll(async () => (await readTask(request, env.gatewayKey!, taskId)).status, {
    timeout: 30_000, intervals: [500, 1_000, 2_000],
  }).toBe('cancelled');
  const lateBoundary = await attemptControlledLateCompletionWriteback(taskId, providerStateBeforeCancel);
  expect(lateBoundary.completionWritebackAttempt.accepted).toBe(false);
  expect(lateBoundary.authoritativeDatabaseStatus).toMatchObject({
    beforeWriteback: 'cancelled',
    afterWriteback: 'cancelled',
  });
  let ledger: CreditTransaction[] = [];
  await expect.poll(async () => {
    ledger = (await readTransactions(request)).filter(entry => !transactionIdsBefore.has(entry.id));
    return { consume: ledger.filter(entry => entry.type === 'consume').length, refund: ledger.filter(entry => entry.type === 'refund').length };
  }, { timeout: 30_000, intervals: [500, 1_000, 2_000] }).toEqual({ consume: 1, refund: 1 });
  const consume = ledger.find(entry => entry.type === 'consume')!;
  const refund = ledger.find(entry => entry.type === 'refund')!;
  expect(Number(consume.amount) + Number(refund.amount)).toBe(0);
  return { ...lateBoundary, refundCount: 1 as const, ledger };
}

async function withEvidence(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  work: (
    evidence: ReturnType<typeof createMediaGatewayEvidence>,
    request: RecordedApiRequest,
  ) => Promise<void>,
): Promise<void> {
  const evidence = createMediaGatewayEvidence(page, testInfo);
  const recordedRequest = createRecordedApiRequest(request, evidence);
  try { await work(evidence, recordedRequest); } finally { await evidence.finalize(); }
}

test.describe('V588-MEDIA-001 cloud rollout evidence', () => {
  test.skip(!cloudRun, '仅在 exact SHA 部署并显式设置 E2E_MEDIA_GATEWAY_RUN=1 后执行');

  test('default-disabled rollout preserves the original login and canvas entry', async ({ page, request }, testInfo) => {
    await withEvidence(page, request, testInfo, async (evidence, api) => {
      test.skip(expectedMode !== 'disabled', '仅用于默认关闭态部署检查');
      const response = await api.post('/api/gateway/v1/images', {
        headers: { 'content-type': 'application/json' },
        data: { prompt: 'release probe', providerId: 'probe', modelId: 'probe' },
      });
      expect(response.status()).toBe(503);
      const payload = await response.json();
      expect(payload).toMatchObject({ success: false, code: 'GATEWAY_DISABLED', retryable: false, requestId: expect.any(String) });
      evidence.record(payload);
      await assertLegacyUiCompatibility(page, api);
    });
  });

  test.describe('temporarily enabled rollout', () => {
    test.skip(expectedMode !== 'enabled', '仅用于审批后的临时开启态');
    test.beforeEach(() => {
      for (const [name, value] of Object.entries(env)) expect(value, `缺少 ${name} 运行时配置`).toBeTruthy();
    });

    test('preserves original login, canvas, image, and video entry compatibility', async ({ page, request }, testInfo) => {
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        await assertLegacyUiCompatibility(page, api);
        const health = await api.get('/api/auth/me');
        expect(health.ok()).toBe(true);
        evidence.record(await health.json());
      });
    });

    test('rejects missing, invalid, and revoked credentials', async ({ page, request }, testInfo) => {
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        const payload = { prompt: 'authentication boundary', providerId: env.imageProviderId!, modelId: env.imageModelId! };
        const missing = await api.post('/api/gateway/v1/images', { data: payload });
        expect(missing.status()).toBe(401);
        expect(await missing.json()).toMatchObject({ success: false, code: 'GATEWAY_AUTH_REQUIRED' });
        const invalid = await api.post('/api/gateway/v1/images', { headers: headers(`wmg_${'x'.repeat(43)}`, `invalid-${Date.now()}`), data: payload });
        expect(invalid.status()).toBe(401);
        expect(await invalid.json()).toMatchObject({ success: false, code: 'GATEWAY_KEY_INVALID' });
        const revoked = await api.post('/api/gateway/v1/images', { headers: headers(env.revokedKey!, `revoked-${Date.now()}`), data: payload });
        expect(revoked.status()).toBe(401);
        const revokedPayload = await revoked.json();
        expect(revokedPayload).toMatchObject({ success: false, code: 'GATEWAY_KEY_INVALID' });
        evidence.record(revokedPayload);
      });
    });

    test('enforces rate limit and UTC daily quota', async ({ page, request }, testInfo) => {
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        const payload = { prompt: 'admission boundary', providerId: env.imageProviderId!, modelId: env.imageModelId! };
        const rate = await api.post('/api/gateway/v1/images', { headers: headers(env.rateLimitedKey!, `rate-${Date.now()}`), data: payload });
        expect(rate.status()).toBe(429);
        expect(await rate.json()).toMatchObject({ success: false, code: 'GATEWAY_RATE_LIMITED' });
        const quota = await api.post('/api/gateway/v1/images', { headers: headers(env.dailyQuotaKey!, `quota-${Date.now()}`), data: payload });
        expect(quota.status()).toBe(429);
        const quotaPayload = await quota.json();
        expect(quotaPayload).toMatchObject({ success: false, code: 'GATEWAY_DAILY_QUOTA_EXCEEDED' });
        evidence.record(quotaPayload);
      });
    });

    test('returns n=2 progressively, rejects same-key different digest, and verifies owned artifacts', async ({ page, request }, testInfo) => {
      test.setTimeout(12 * 60_000);
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        const idempotencyKey = `e2e-image-${Date.now()}`;
        const payload = { prompt: 'Two clean product photographs on a neutral studio background', providerId: env.imageProviderId!, modelId: env.imageModelId!, n: 2, aspectRatio: '1:1' };
        const first = await api.post('/api/gateway/v1/images', { headers: headers(env.gatewayKey!, idempotencyKey), data: payload });
        expect(first.status()).toBe(202);
        const submission = await first.json() as Submission;
        expect(submission.taskIds).toHaveLength(2);
        evidence.record(submission);
        const replay = await api.post('/api/gateway/v1/images', { headers: headers(env.gatewayKey!, idempotencyKey), data: payload });
        expect(replay.status()).toBe(202);
        expect(await replay.json()).toMatchObject({ gatewayRequestId: submission.gatewayRequestId, taskIds: submission.taskIds });
        const conflict = await api.post('/api/gateway/v1/images', { headers: headers(env.gatewayKey!, idempotencyKey), data: { ...payload, prompt: `${payload.prompt} altered` } });
        expect(conflict.status()).toBe(409);
        expect(await conflict.json()).toMatchObject({ success: false, code: 'GATEWAY_IDEMPOTENCY_CONFLICT' });
        const progressive = await waitForProgressiveImageCompletion(page, api, env.gatewayKey!, submission.taskIds);
        evidence.record({ firstVisibleBeforeBatchTerminal: progressive.firstVisibleBeforeBatchTerminal });
        for (const task of progressive.completed) {
          expect(task.status).toBe('completed');
          expect(task.assetVersionId).toEqual(expect.any(String));
          const forbidden = await api.get(`/api/gateway/v1/tasks/${encodeURIComponent(task.taskId)}`, { headers: headers(env.secondUserKey!) });
          expect(forbidden.status()).toBe(404);
          const assetVersionOwnerVerified = forbidden.status() === 404;
          const thumbnail256 = task.thumbnailUrls?.['256'];
          const thumbnail512 = task.thumbnailUrls?.['512'];
          expect(thumbnail256).toEqual(expect.any(String));
          expect(thumbnail512).toEqual(expect.any(String));
          await assertMediaArtifact(api, task.previewUrl!, 'image');
          await assertMediaArtifact(api, task.downloadUrl!, 'image');
          await assertMediaArtifact(api, thumbnail256!, 'image', 256);
          await assertMediaArtifact(api, thumbnail512!, 'image', 512);
          evidence.record({ ...task, assetVersionOwnerVerified });
        }
      });
    });

    test('submits a video and downloads its projected terminal result', async ({ page, request }, testInfo) => {
      test.setTimeout(12 * 60_000);
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        const response = await api.post('/api/gateway/v1/videos', {
          headers: headers(env.gatewayKey!, `e2e-video-${Date.now()}`),
          data: { prompt: 'A slow cinematic camera move across a quiet product display', providerId: env.videoProviderId!, modelId: env.videoModelId!, duration: 5, aspectRatio: '16:9' },
        });
        expect(response.status()).toBe(202);
        const submission = await response.json() as Submission;
        evidence.record(submission);
        const terminal = await waitForTerminal(api, env.gatewayKey!, submission.taskIds[0]!);
        expect(terminal.status).toBe('completed');
        await assertMediaArtifact(api, terminal.downloadUrl || String(terminal.result?.videoUrl || ''), 'video');
        evidence.record(terminal);
      });
    });

    test('cancels authoritatively, rejects late completion, and refunds exactly once', async ({ page, request }, testInfo) => {
      test.setTimeout(3 * 60_000);
      await withEvidence(page, request, testInfo, async (evidence, api) => {
        await loginAndOpenCanvas(page, api);
        const before = await readTransactions(api);
        const response = await api.post('/api/gateway/v1/images', {
          headers: headers(env.gatewayKey!, `e2e-cancel-${Date.now()}`),
          data: { prompt: 'A cancellable media gateway release probe', providerId: env.imageProviderId!, modelId: env.imageModelId! },
        });
        expect(response.status()).toBe(202);
        const submission = await response.json() as Submission;
        const taskId = submission.taskIds[0]!;
        const providerStateBeforeCancel = await waitForProviderSubmissionState(taskId);
        const forbidden = await api.get(`/api/gateway/v1/tasks/${encodeURIComponent(taskId)}`, { headers: headers(env.secondUserKey!) });
        expect(forbidden.status()).toBe(404);
        const cancellation = await assertAuthoritativeCancellation(
          api,
          taskId,
          new Set(before.map(entry => entry.id)),
          providerStateBeforeCancel,
        );
        evidence.record(submission);
        evidence.record({ taskId, ...cancellation, ledger: undefined });
        evidence.recordLedger(cancellation.ledger);
      });
    });
  });
});
