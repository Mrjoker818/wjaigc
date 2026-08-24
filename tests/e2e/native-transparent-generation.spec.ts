import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const model = process.env.E2E_TRANSPARENT_MODEL || process.env.E2E_GENERATION_MODEL;
const paidGenerationApproved = ['true', '1'].includes(
  (process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase(),
);

interface CreditsSnapshot {
  balance: number;
  totalUsed: number;
}

interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  description?: string;
}

interface GenerationSubmitPayload {
  batchId?: string;
  taskIds?: string[];
  slots?: Array<{ taskId?: string }>;
}

interface PollPayload extends Record<string, unknown> {
  taskId?: string;
  status?: string;
  imageUrl?: string;
  alphaVerification?: Record<string, unknown>;
}

function requireRealTransparentEnvironment(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_TRANSPARENT_MODEL or E2E_GENERATION_MODEL', model],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Real transparent-generation E2E environment is required. Missing: ${missing.join(', ')}`);
  }
  if (!model!.includes('::') || !/gpt-image-2/i.test(model!)) {
    throw new Error('The transparent E2E model must be the exact providerId::gpt-image-2 option value.');
  }
  if (!paidGenerationApproved) {
    throw new Error('Real paid generation is blocked until E2E_ENABLE_PAID_GENERATION=true is explicitly set.');
  }
}

async function loginAndOpenCanvas(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.getByPlaceholder('请输入用户名').fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse(
    response => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /登录/ }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('button', { name: '图像生成', exact: true })).toBeVisible();
}

async function openProfessionalGenerationPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: '图像生成', exact: true }).click();
  await page.getByRole('button', { name: '专业创作', exact: true }).click();
  await expect(page.getByRole('group', { name: '生成图片背景' })).toBeVisible();
}

async function readCredits(page: Page): Promise<CreditsSnapshot> {
  const response = await page.request.get('/api/credits');
  expect(response.ok(), `credits snapshot returned ${response.status()}`).toBeTruthy();
  const payload = await response.json() as {
    success?: boolean;
    credits?: { balance?: number; totalUsed?: number };
  };
  expect(payload.success).toBe(true);
  return {
    balance: Number(payload.credits?.balance || 0),
    totalUsed: Number(payload.credits?.totalUsed || 0),
  };
}

async function readCreditTransactions(page: Page): Promise<CreditTransaction[]> {
  const response = await page.request.get('/api/credits?transactions=true&limit=100');
  expect(response.ok(), `credit transactions returned ${response.status()}`).toBeTruthy();
  const payload = await response.json() as { success?: boolean; transactions?: CreditTransaction[] };
  expect(payload.success).toBe(true);
  return payload.transactions || [];
}

async function assertTransparentPng(page: Page, terminal: PollPayload): Promise<void> {
  const alphaVerification = terminal.alphaVerification;
  expect(alphaVerification).toMatchObject({ requested: true, status: 'verified' });
  expect(terminal.imageUrl).toBeTruthy();

  const imageResponse = await page.request.get(terminal.imageUrl!);
  expect(imageResponse.ok()).toBeTruthy();
  const imageBuffer = Buffer.from(await imageResponse.body());
  const metadata = await sharp(imageBuffer).metadata();
  expect(metadata.format).toBe('png');
  expect(metadata.hasAlpha).toBe(true);
  const alpha = await sharp(imageBuffer).extractChannel('alpha').raw().toBuffer();
  expect(alpha.some(value => value < 255)).toBe(true);
}

test.describe('GPT Image 2 native transparent PNG', () => {
  test('sends transparent PNG parameters and verifies real downloaded Alpha pixels', async ({ page }) => {
    test.setTimeout(360_000);
    requireRealTransparentEnvironment();
    const exactModel = model!;
    await loginAndOpenCanvas(page);

    await openProfessionalGenerationPanel(page);
    const modelSelect = page.locator('select').filter({
      has: page.locator(`option[value="${exactModel}"]`),
    }).first();
    await expect(modelSelect).toBeVisible({ timeout: 20_000 });
    await modelSelect.selectOption(exactModel);

    const backgroundGroup = page.getByRole('group', { name: '生成图片背景' });
    const transparentButton = backgroundGroup.getByRole('button', { name: '透明' });
    await expect(transparentButton).toBeEnabled();
    await transparentButton.click();
    await expect(transparentButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('真正透明的 PNG（含 Alpha 通道）')).toBeVisible();

    let prompt = page.getByPlaceholder('描述你想要生成的图像...');
    if ((await prompt.count()) === 0) {
      prompt = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
    }
    await prompt.first().fill('一个红色几何立方体图标，主体完整，边缘清晰，无背景，透明 PNG');

    const terminalPoll = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for verified transparent result')), 300_000);
      page.on('response', async (response) => {
        if (!response.url().includes('/api/poll-task') || response.request().method() !== 'POST') return;
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        const verification = payload?.alphaVerification as Record<string, unknown> | undefined;
        if (payload?.status === 'completed' && verification) {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });
    const generationResponse = page.waitForResponse(
      response => response.url().includes('/api/generate') && response.request().method() === 'POST',
    );
    await prompt.first().press('Control+Enter');
    const response = await generationResponse;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({
      background: 'transparent',
      output_format: 'png',
    });

    const terminal = await terminalPoll;
    expect(terminal.alphaVerification).toMatchObject({ requested: true, status: 'verified' });
    const imageUrl = terminal.imageUrl as string;
    expect(imageUrl).toBeTruthy();

    const imageResponse = await page.request.get(imageUrl);
    expect(imageResponse.ok()).toBeTruthy();
    const imageBuffer = Buffer.from(await imageResponse.body());
    const metadata = await sharp(imageBuffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    const alpha = await sharp(imageBuffer).extractChannel('alpha').raw().toBuffer();
    expect(alpha.some(value => value < 255)).toBe(true);
  });

  test('returns two real transparent PNGs progressively and charges each slot once', async ({ page }, testInfo) => {
    test.setTimeout(720_000);
    requireRealTransparentEnvironment();
    const evidence = collectBrowserEvidence(page);
    const exactModel = model!;
    let releaseSecondSlotPolling: () => void = () => {};
    let releaseTaskIdsReady: () => void = () => {};
    const secondSlotPollingGate = new Promise<void>((resolve) => {
      releaseSecondSlotPolling = resolve;
    });
    const taskIdsReady = new Promise<void>((resolve) => {
      releaseTaskIdsReady = resolve;
    });
    let taskIds: string[] = [];
    const terminals = new Map<string, PollPayload>();

    try {
      await loginAndOpenCanvas(page);
      const creditsBefore = await readCredits(page);
      const transactionsBefore = await readCreditTransactions(page);
      const transactionIdsBefore = new Set(transactionsBefore.map(transaction => transaction.id));

      await page.route('**/api/task-events**', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Polling fallback required for deterministic progressive-output verification',
        });
      });
      await page.route('**/api/poll-task', async (route) => {
        const body = route.request().postDataJSON() as { taskId?: string } | null;
        await taskIdsReady;
        if (body?.taskId === taskIds[1]) {
          await secondSlotPollingGate;
        }
        await route.continue();
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/api/poll-task') || response.request().method() !== 'POST') return;
        const payload = await response.json().catch(() => null) as PollPayload | null;
        if (!payload?.taskId || payload.status !== 'completed' || !taskIds.includes(payload.taskId)) return;
        terminals.set(payload.taskId, payload);
      });

      await openProfessionalGenerationPanel(page);
      const modelSelect = page.locator('select').filter({
        has: page.locator(`option[value="${exactModel}"]`),
      }).first();
      await expect(modelSelect).toBeVisible({ timeout: 20_000 });
      await modelSelect.selectOption(exactModel);

      const backgroundGroup = page.getByRole('group', { name: '生成图片背景' });
      const transparentButton = backgroundGroup.getByRole('button', { name: '透明' });
      await expect(transparentButton).toBeEnabled();
      await transparentButton.click();
      await page.getByRole('button', { name: 'x2', exact: true }).click();

      let prompt = page.getByPlaceholder('描述你想要生成的图像...');
      if ((await prompt.count()) === 0) {
        prompt = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
      }
      await prompt.first().fill('两个独立的蓝色玻璃按钮图标，主体完整，边缘清晰，无背景，透明 PNG');

      const canvas = page.locator('[data-canvas-viewport]');
      const canvasImages = canvas.locator('img');
      const imagesBefore = await canvasImages.count();
      const generationResponse = page.waitForResponse(response => (
        response.url().includes('/api/generate')
        && response.request().method() === 'POST'
      ));
      await prompt.first().press('Control+Enter');
      const response = await generationResponse;
      expect(response.ok()).toBeTruthy();
      expect(response.request().postDataJSON()).toMatchObject({
        background: 'transparent',
        output_format: 'png',
        outputCount: 2,
      });

      const submitPayload = await response.json() as GenerationSubmitPayload;
      taskIds = (submitPayload.taskIds || submitPayload.slots?.map(slot => slot.taskId || '') || [])
        .filter((taskId): taskId is string => Boolean(taskId));
      expect(taskIds).toHaveLength(2);
      expect(new Set(taskIds).size).toBe(2);
      releaseTaskIdsReady();

      const processingSlots = canvas.getByRole('status');
      await expect(processingSlots).toHaveCount(2, { timeout: 20_000 });
      await expect.poll(() => terminals.has(taskIds[0]), { timeout: 360_000 }).toBe(true);
      await expect(processingSlots).toHaveCount(1, { timeout: 20_000 });
      await expect.poll(() => canvasImages.count(), { timeout: 20_000 }).toBeGreaterThan(imagesBefore);
      expect(terminals.has(taskIds[1])).toBe(false);

      releaseSecondSlotPolling();
      await expect.poll(() => terminals.size, { timeout: 360_000 }).toBe(2);
      await expect(processingSlots).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => canvasImages.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(imagesBefore + 2);

      for (const taskId of taskIds) {
        await assertTransparentPng(page, terminals.get(taskId)!);
      }

      const creditsAfter = await readCredits(page);
      const transactionsAfter = await readCreditTransactions(page);
      const newConsumeTransactions = transactionsAfter.filter(transaction => (
        !transactionIdsBefore.has(transaction.id)
        && transaction.type === 'consume'
        && (transaction.description || '').includes('图像生成')
      ));
      expect(newConsumeTransactions).toHaveLength(2);
      const expectedCreditCost = newConsumeTransactions.reduce(
        (total, transaction) => total + Math.abs(Number(transaction.amount)),
        0,
      );
      expect(expectedCreditCost).toBeGreaterThan(0);
      expect(creditsBefore.balance - creditsAfter.balance).toBe(expectedCreditCost);
      expect(creditsAfter.totalUsed - creditsBefore.totalUsed).toBe(expectedCreditCost);

      await testInfo.attach('native-transparent-generation-x2.json', {
        body: Buffer.from(JSON.stringify({
          exactModel,
          batchId: submitPayload.batchId,
          taskIds,
          imageUrls: taskIds.map(taskId => terminals.get(taskId)?.imageUrl),
          alphaVerification: taskIds.map(taskId => terminals.get(taskId)?.alphaVerification),
          creditsBefore,
          creditsAfter,
          newConsumeTransactions,
          expectedCreditCost,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      releaseTaskIdsReady();
      releaseSecondSlotPolling();
      await saveBrowserEvidence(page, testInfo, evidence, 'native-transparent-generation-x2');
    }
  });
});
