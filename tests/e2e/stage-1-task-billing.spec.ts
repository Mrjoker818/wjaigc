import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Page, type Response } from '@playwright/test';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';
import { writeEvidenceManifest } from '../helpers/evidence-manifest';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const deploymentCommit = process.env.E2E_DEPLOYMENT_COMMIT;
const exactModel = process.env.E2E_STAGE1_GENERATION_MODEL;
const paidGenerationApproved = ['1', 'true'].includes(
  (process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase(),
);
const outputCounts = [1, 2, 3, 4] as const;

interface CreditsPayload {
  success?: boolean;
  credits?: {
    balance?: number;
    totalUsed?: number;
  };
  transactions?: Array<Record<string, unknown>>;
}

interface GeneratePayload {
  success?: boolean;
  batchId?: string;
  taskId?: string;
  taskIds?: string[];
  providerId?: string;
  model?: string;
}

interface PollPayload {
  success?: boolean;
  status?: string;
  progress?: number;
  imageUrl?: string;
  imageUrls?: string[];
  error?: string;
}

function requireRealStage1Environment(): void {
  const required = {
    E2E_TEST_USERNAME: username,
    E2E_TEST_PASSWORD: password,
    E2E_DEPLOYMENT_COMMIT: deploymentCommit,
    E2E_STAGE1_GENERATION_MODEL: exactModel,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Stage 1 real evidence is blocked. Missing: ${missing.join(', ')}`);
  }
  if (!exactModel!.includes('::')) {
    throw new Error('E2E_STAGE1_GENERATION_MODEL must be the exact providerId::modelId value.');
  }
  if (!paidGenerationApproved) {
    throw new Error('Set E2E_ENABLE_PAID_GENERATION=true only for an authorized real-provider run.');
  }
}

async function loginAndOpenCanvas(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  const entry = page.getByRole('button', { name: /无限画布/ }).first();
  if (await entry.isVisible({ timeout: 5_000 }).catch(() => false)) await entry.click();

  const usernameInput = page.getByPlaceholder('请输入用户名');
  if (await usernameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await usernameInput.fill(username!);
    await page.getByPlaceholder('请输入密码').fill(password!);
    const loginResponse = page.waitForResponse((response) => (
      response.url().includes('/api/auth/login')
      && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    expect((await loginResponse).ok(), 'The real account could not log in.').toBeTruthy();
  }

  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '专业创作', exact: true }).click();
}

async function readCredits(page: Page, transactions = false): Promise<CreditsPayload> {
  const response = await page.request.get(`/api/credits${transactions ? '?transactions=true&limit=100' : ''}`);
  expect(response.ok(), `Credits API failed with ${response.status()}.`).toBeTruthy();
  const payload = await response.json() as CreditsPayload;
  expect(payload.success).toBe(true);
  return payload;
}

async function waitForTaskTerminal(page: Page, taskId: string): Promise<PollPayload> {
  const deadline = Date.now() + 5 * 60_000;
  let last: PollPayload = {};
  while (Date.now() < deadline) {
    const response = await page.request.post('/api/poll-task', { data: { taskId } });
    expect(response.ok(), `Polling ${taskId} failed with ${response.status()}.`).toBeTruthy();
    last = await response.json() as PollPayload;
    if (last.status === 'completed') return last;
    if (['failed', 'cancelled', 'timeout'].includes(last.status || '')) {
      throw new Error(`Task ${taskId} reached ${last.status}: ${last.error || 'no provider error supplied'}`);
    }
    await page.waitForTimeout(1_500);
  }
  throw new Error(`Task ${taskId} did not reach a terminal state within five minutes. Last payload: ${JSON.stringify(last)}`);
}

function responseRequestId(response: Response, payload: Record<string, unknown>): string {
  const headers = response.headers();
  return String(headers['x-request-id'] || payload.requestId || '').trim();
}

test.describe('Stage 1 real task and billing gate', () => {
  test('n=1/2/3/4 uses exact routing, reaches terminal state, fills the canvas, and records billing evidence', async ({ page }, testInfo) => {
    test.setTimeout(25 * 60_000);
    testInfo.annotations.push(
      { type: 'featureId', description: 'workspace.canvas.generate' },
      { type: 'verification', description: 'real-provider-real-billing' },
    );
    requireRealStage1Environment();
    const evidence = collectBrowserEvidence(page);
    const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
    const capturedAt = new Date().toISOString();
    const [providerId, modelId] = exactModel!.split('::');
    const taskEvidence: Array<Record<string, unknown>> = [];
    const requestIds: string[] = [];

    try {
      await loginAndOpenCanvas(page);
      const modelSelect = page.locator('select').filter({
        has: page.locator(`option[value="${exactModel}"]`),
      }).first();
      await expect(modelSelect).toBeVisible({ timeout: 30_000 });
      await modelSelect.selectOption(exactModel!);
      await expect(modelSelect).toHaveValue(exactModel!);

      const canvasImages = page.locator('[data-canvas-viewport] img');
      for (const count of outputCounts) {
        const creditBefore = await readCredits(page);
        const transactionsBefore = await readCredits(page, true);
        const imageCountBefore = await canvasImages.count();
        const prompt = `Stage 1 real billing verification ${deploymentCommit} count ${count}: a plain geometric object on white`;
        await page.locator('#gen-prompt-textarea').fill(prompt);
        await page.getByRole('button', { name: `x${count}`, exact: true }).click();

        const responsePromise = page.waitForResponse((response) => (
          response.url().includes('/api/generate')
          && response.request().method() === 'POST'
        ), { timeout: 45_000 });
        await page.getByRole('button', { name: /开始生成/ }).last().click();
        const response = await responsePromise;
        expect(response.ok(), `Generate n=${count} failed with ${response.status()}.`).toBeTruthy();
        const payload = await response.json() as GeneratePayload & Record<string, unknown>;
        expect(payload.success).toBe(true);
        expect(payload.providerId).toBe(providerId);
        expect(payload.model).toBe(modelId);
        expect(payload.taskIds).toHaveLength(count);
        expect(new Set(payload.taskIds).size).toBe(count);
        expect(payload.taskId).toBe(payload.taskIds?.[0]);

        const requestId = responseRequestId(response, payload);
        expect(requestId, 'Every billable request must expose requestId in a header or JSON body.').not.toBe('');
        requestIds.push(requestId);

        const terminalResults: Array<{ taskId: string; payload: PollPayload; completedAt: string }> = [];
        for (const taskId of payload.taskIds || []) {
          const terminal = await waitForTaskTerminal(page, taskId);
          terminalResults.push({ taskId, payload: terminal, completedAt: new Date().toISOString() });
        }
        expect(terminalResults).toHaveLength(count);
        expect(terminalResults.every(({ payload: result }) => (
          Boolean(result.imageUrl) || Boolean(result.imageUrls?.length)
        ))).toBe(true);
        await expect.poll(() => canvasImages.count(), {
          timeout: 90_000,
          intervals: [500, 1_000, 2_000],
        }).toBeGreaterThanOrEqual(imageCountBefore + count);

        const creditAfter = await readCredits(page);
        const transactionsAfter = await readCredits(page, true);
        const beforeBalance = Number(creditBefore.credits?.balance);
        const afterBalance = Number(creditAfter.credits?.balance);
        expect(Number.isFinite(beforeBalance) && Number.isFinite(afterBalance)).toBe(true);
        expect(afterBalance).toBeLessThan(beforeBalance);
        expect(Number(creditAfter.credits?.totalUsed)).toBeGreaterThan(
          Number(creditBefore.credits?.totalUsed),
        );
        expect(JSON.stringify(transactionsAfter.transactions)).not.toBe(
          JSON.stringify(transactionsBefore.transactions),
        );

        taskEvidence.push({
          count,
          prompt,
          requestId,
          batchId: payload.batchId,
          taskIds: payload.taskIds,
          requestedRoute: { providerId, modelId },
          actualRoute: { providerId: payload.providerId, modelId: payload.model },
          terminalResults,
          credit: {
            before: creditBefore.credits,
            after: creditAfter.credits,
            transactionsBefore: transactionsBefore.transactions,
            transactionsAfter: transactionsAfter.transactions,
          },
        });
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-canvas-viewport] img')).toHaveCount(10, { timeout: 60_000 });
      await page.getByTitle('查看用户信息').click();
      await page.getByRole('button', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
    } finally {
      const taskRoot = join(process.cwd(), 'test-results', 'tasks');
      await mkdir(taskRoot, { recursive: true });
      const taskPath = join(taskRoot, `stage-1-task-billing-${testInfo.project.name}.json`);
      await writeFile(taskPath, `${JSON.stringify({
        deploymentCommit,
        deploymentUrl: baseURL,
        browser: testInfo.project.name,
        capturedAt,
        exactModel,
        taskEvidence,
      }, null, 2)}\n`, 'utf8');
      await saveBrowserEvidence(page, testInfo, evidence, 'stage-1-task-billing');
      await testInfo.attach('stage-1-task-billing.json', { path: taskPath, contentType: 'application/json' });
      if (taskEvidence.length === outputCounts.length && !page.isClosed()) {
        const safeTimestamp = capturedAt.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
        const evidenceDirectory = join(
          process.cwd(),
          'test-results',
          'evidence',
          deploymentCommit!,
          'workspace.canvas.generate',
          testInfo.project.name,
          safeTimestamp,
        );
        await mkdir(evidenceDirectory, { recursive: true });
        await Promise.all([
          page.screenshot({ path: join(evidenceDirectory, 'stage-1.png'), fullPage: true }),
          writeFile(join(evidenceDirectory, 'console.json'), `${JSON.stringify(evidence.console, null, 2)}\n`, 'utf8'),
          writeFile(join(evidenceDirectory, 'network.json'), `${JSON.stringify(evidence.network, null, 2)}\n`, 'utf8'),
          writeFile(join(evidenceDirectory, 'task-billing.json'), `${JSON.stringify(taskEvidence, null, 2)}\n`, 'utf8'),
        ]);
        await writeEvidenceManifest({
          commit: deploymentCommit!,
          deploymentUrl: baseURL,
          browser: testInfo.project.name,
          viewport: page.viewportSize() || { width: 1, height: 1 },
          capturedAt,
          featureId: 'workspace.canvas.generate',
          artifactPaths: {
            screenshot: 'stage-1.png',
            console: 'console.json',
            network: 'network.json',
            task: 'task-billing.json',
          },
          requestIds,
          status: 'completed',
        });
      }
    }
  });
});
