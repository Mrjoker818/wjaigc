import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import { readPsd, type Psd } from 'ag-psd';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

type OutputMode = 'board' | 'layers' | 'both';
type Branch = 'board' | 'layers';
type OverallStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timeout';

interface BranchState {
  taskId: string;
  status: string;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
}

interface ElementTask {
  taskId: string;
  overallStatus: OverallStatus;
  source: {
    sourceImageId: string;
    canonicalUrl: string;
    managedUrl: string;
    sha256: string;
  };
  branches: Partial<Record<Branch, BranchState>>;
}

interface Submission {
  request: Request;
  body: Record<string, unknown>;
  task: ElementTask;
}

interface LayerResult extends Record<string, unknown> {
  psdUrl?: string;
  layers?: Array<Record<string, unknown>>;
  reconstruction?: {
    native: { rgbMae: number; alphaMae: number; mismatchedPixelRatio: number; ssim: number };
    corrected: { rgbMae: number; alphaMae: number; mismatchedPixelRatio: number; ssim: number };
    correctionApplied: boolean;
  };
}

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const providerId = process.env.E2E_LAYER_PROVIDER_ID;
const modelId = process.env.E2E_LAYER_MODEL_ID;
const realBoardEnabled = process.env.E2E_ENABLE_REAL_ELEMENT_BOARD === '1';
const realPearEnabled = process.env.E2E_ENABLE_PAID_LAYERING === '1'
  && process.env.LAYER_E2E_SKIP_PROVIDER_CALL !== '1'
  && Boolean(providerId)
  && Boolean(modelId);
const controlledFailureEnabled = process.env.E2E_ELEMENT_DECOMPOSE_FAILURE_MODE === '1';
const fixturePath = resolve(process.cwd(), 'tests/fixtures/annotation-source.png');
const fixtureBuffer = readFileSync(fixturePath);

function requireCredentials(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Dual element decomposition E2E credentials are required: ${missing.join(', ')}`);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  const evidence = collectBrowserEvidence(page);
  try {
    await action();
    await saveBrowserEvidence(page, testInfo, evidence, label);
  } catch (error) {
    await saveBrowserEvidence(page, testInfo, evidence, `${label}-failure`);
    throw error;
  }
}

async function loginAndCreateProject(page: Page): Promise<void> {
  requireCredentials();
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.locator('input[type="text"]').first().fill(username!);
  await page.locator('input[type="password"]').first().fill(password!);
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /^登录$/ }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page.getByText('我的项目', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const canvas = page.locator('[data-canvas-viewport]');
  const opened = await canvas.waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await page.getByText('未命名项目', { exact: true }).last().click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
}

async function uploadSource(page: Page, name: string): Promise<Locator> {
  const images = page.locator('[data-canvas-viewport] img');
  const before = await images.count();
  await page.getByTestId('canvas-image-upload-input').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: fixtureBuffer,
  });
  await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const image = images.last();
  await expect(image).toBeVisible();
  return image;
}

async function openElementPanel(page: Page, image: Locator): Promise<Locator> {
  await image.click();
  const toolbar = page.locator('[data-toolbar="image-action-toolbar"]');
  await expect(toolbar).toBeVisible();
  let entry = toolbar.getByRole('button', { name: '元素拆解', exact: true });
  if (await entry.count() === 0) {
    const more = toolbar.getByRole('button', { name: /展开更多工具/ });
    await more.click();
    entry = page.getByRole('button', { name: '元素拆解', exact: true });
  }
  await expect(entry).toBeVisible();
  await entry.click();
  const panel = page.locator('[data-popup="display-decompose"]');
  await expect(panel).toBeVisible();
  return panel;
}

async function chooseMode(panel: Locator, mode: OutputMode): Promise<void> {
  const labels: Record<OutputMode, string> = {
    board: '拆解板',
    layers: '可编辑图层',
    both: '双输出',
  };
  await panel.getByRole('button', { name: labels[mode], exact: true }).click();
}

async function submitFromPanel(page: Page, panel: Locator): Promise<Submission> {
  const requestPromise = page.waitForRequest((request) => (
    request.url().includes('/api/element-decompose')
    && request.method() === 'POST'
    && request.postDataJSON()?.action !== 'retry'
  ));
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/element-decompose')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.action !== 'retry'
  ));
  await panel.locator('[data-action="submit-element-decompose"]').click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.ok(), `Element decomposition submission failed with ${response.status()}`).toBeTruthy();
  const task = await response.json() as ElementTask;
  expect(task.taskId).toBeTruthy();
  expect(task.source?.sha256).toMatch(/^[a-f0-9]{64}$/i);
  return { request, body: request.postDataJSON() as Record<string, unknown>, task };
}

async function getTask(page: Page, taskId: string): Promise<ElementTask> {
  const response = await page.request.get(`/api/element-decompose?taskId=${encodeURIComponent(taskId)}`);
  expect(response.ok(), `Element task poll failed with ${response.status()}`).toBeTruthy();
  return response.json() as Promise<ElementTask>;
}

async function waitForTerminal(page: Page, taskId: string, timeout = 480_000): Promise<ElementTask> {
  let latest: ElementTask | undefined;
  await expect.poll(async () => {
    latest = await getTask(page, taskId);
    return latest.overallStatus;
  }, {
    timeout,
    intervals: [500, 1_000, 2_000, 5_000],
  }).toMatch(/^(completed|partial|failed|cancelled|timeout)$/);
  return latest!;
}

function layerResult(task: ElementTask): LayerResult {
  const result = task.branches.layers?.result as LayerResult | undefined;
  expect(result, 'The completed layers branch must expose a result contract').toBeDefined();
  return result!;
}

function countPsdLayers(psd: Psd): number {
  const visit = (children: Psd['children']): number => (children || []).reduce((total, child) => (
    total + 1 + visit(child.children)
  ), 0);
  return visit(psd.children);
}

async function inspectApplicationPsd(page: Page, result: LayerResult): Promise<void> {
  expect(result.psdUrl, 'Pear application result must expose the extracted primary PSD URL').toEqual(expect.any(String));
  const response = await page.request.get(new URL(result.psdUrl!, page.url()).toString());
  expect(response.ok(), `Application PSD download failed with ${response.status()}`).toBeTruthy();
  const buffer = await response.body();
  expect(buffer.subarray(0, 4).toString('ascii'), 'Primary extracted artifact must start with the PSD 8BPS signature').toBe('8BPS');
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  expect(countPsdLayers(psd), 'Primary PSD must contain at least two editable layer records').toBeGreaterThanOrEqual(2);
}

function expectReconstructionEvidence(result: LayerResult): void {
  expect(Array.isArray(result.layers), 'Layer output must expose editable layer assets').toBeTruthy();
  expect(result.layers!.length).toBeGreaterThanOrEqual(2);
  expect(result.reconstruction, 'Layer output must expose native and corrected reconstruction metrics').toBeDefined();
  expect(result.reconstruction!.native.ssim).toBeGreaterThanOrEqual(0);
  expect(result.reconstruction!.native.ssim).toBeLessThanOrEqual(1);
  expect(result.reconstruction!.corrected.rgbMae).toBeLessThanOrEqual(result.reconstruction!.native.rgbMae);
  expect(result.reconstruction!.corrected.alphaMae).toBeLessThanOrEqual(result.reconstruction!.native.alphaMae);
  expect(result.reconstruction!.corrected.mismatchedPixelRatio).toBeLessThanOrEqual(
    result.reconstruction!.native.mismatchedPixelRatio,
  );
}

async function verifyLayerEditorInteractions(page: Page): Promise<void> {
  const editor = page.getByTestId('layer-editor');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  const rows = editor.locator('[data-layer-row]');
  await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const first = rows.first();
  await first.click();
  await expect(first).toHaveAttribute('data-layer-selected', 'true');
  const visibility = first.locator('[data-layer-action="visibility"]');
  const beforeVisibility = await visibility.getAttribute('data-layer-visible');
  await visibility.click();
  await expect(visibility).toHaveAttribute('data-layer-visible', beforeVisibility === 'true' ? 'false' : 'true');
  await visibility.click();
  await expect(visibility).toHaveAttribute('data-layer-visible', beforeVisibility || 'true');

  const canvas = editor.getByTestId('layer-canvas');
  const beforePosition = await editor.getByTestId('layer-position').textContent();
  const box = await canvas.boundingBox();
  expect(box, 'Layer canvas must have a visible interaction surface').not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2 + 12, { steps: 8 });
  await page.mouse.up();
  const afterPosition = await editor.getByTestId('layer-position').textContent();
  expect(afterPosition, 'Dragging an unlocked visible layer must update its position').not.toBe(beforePosition);

  const downloadPromise = page.waitForEvent('download');
  await editor.getByTestId('layer-export-psd').click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath, 'PSD export must produce a downloadable file').toBeTruthy();
  expect(readFileSync(exportedPath!).subarray(0, 4).toString('ascii')).toBe('8BPS');
}

test.describe('Dual-output element decomposition', () => {
  test.skip(!username || !password, 'Real E2E credentials are required; no authentication mock is used.');

  test('exposes board, layers, and both output modes from a selected real canvas image', async ({ page }, testInfo) => {
    await capture(page, testInfo, 'element-output-modes', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-modes-source.png');
      const panel = await openElementPanel(page, source);
      await expect(panel.getByRole('button', { name: '拆解板', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: '可编辑图层', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: '双输出', exact: true })).toBeVisible();
      for (const mode of ['board', 'layers', 'both'] as const) await chooseMode(panel, mode);
    });
  });

  test('board mode creates only the board branch and places its real result on canvas', async ({ page }, testInfo) => {
    test.skip(!realBoardEnabled, 'Unverified: set E2E_ENABLE_REAL_ELEMENT_BOARD=1 only when the real board provider is configured.');
    test.setTimeout(540_000);
    await capture(page, testInfo, 'element-board-real', async () => {
      await loginAndCreateProject(page);
      const images = page.locator('[data-canvas-viewport] img');
      const source = await uploadSource(page, 'element-board-source.png');
      const beforeResult = await images.count();
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'board');
      const submission = await submitFromPanel(page, panel);
      expect(submission.body).toMatchObject({ outputMode: 'board' });
      expect(submission.task.branches.board?.taskId).toBeTruthy();
      expect(submission.task.branches.layers).toBeUndefined();
      const finalTask = await waitForTerminal(page, submission.task.taskId);
      expect(finalTask.overallStatus).toBe('completed');
      expect(finalTask.branches.board?.result?.imageUrl).toEqual(expect.any(String));
      await expect.poll(() => images.count(), { timeout: 60_000 }).toBeGreaterThan(beforeResult);
    });
  });

  test('layers mode completes a real Pear task and opens an editable layer stack', async ({ page }, testInfo) => {
    test.skip(!realPearEnabled, 'Unverified: real Pear credentials/model and E2E_ENABLE_PAID_LAYERING=1 are required.');
    test.setTimeout(660_000);
    await capture(page, testInfo, 'element-layers-pear-real', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-layers-source.png');
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'layers');
      const submission = await submitFromPanel(page, panel);
      expect(submission.body).toMatchObject({
        outputMode: 'layers',
        layers: { providerId, modelId },
      });
      expect(submission.task.branches.board).toBeUndefined();
      expect(submission.task.branches.layers?.taskId).toBeTruthy();
      const finalTask = await waitForTerminal(page, submission.task.taskId, 600_000);
      expect(finalTask.overallStatus).toBe('completed');
      const result = layerResult(finalTask);
      expectReconstructionEvidence(result);
      await inspectApplicationPsd(page, result);
      await verifyLayerEditorInteractions(page);
    });
  });

  test('both mode freezes one source and produces separate real board and layer results', async ({ page }, testInfo) => {
    test.skip(!realBoardEnabled || !realPearEnabled, 'Unverified: both the real board path and paid Pear path must be explicitly enabled.');
    test.setTimeout(720_000);
    await capture(page, testInfo, 'element-both-real', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-both-source.png');
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'both');
      const submission = await submitFromPanel(page, panel);
      expect(submission.body).toMatchObject({ outputMode: 'both' });
      expect(submission.task.branches.board?.taskId).toBeTruthy();
      expect(submission.task.branches.layers?.taskId).toBeTruthy();
      expect(submission.task.branches.board?.taskId).not.toBe(submission.task.branches.layers?.taskId);
      const finalTask = await waitForTerminal(page, submission.task.taskId, 660_000);
      expect(finalTask.overallStatus).toBe('completed');
      expect(finalTask.source.sha256).toBe(submission.task.source.sha256);
      expect(finalTask.branches.board?.result?.imageUrl).toEqual(expect.any(String));
      const result = layerResult(finalTask);
      expectReconstructionEvidence(result);
      await inspectApplicationPsd(page, result);
      await expect(page.getByTestId('layer-editor')).toBeVisible({ timeout: 60_000 });
    });
  });

  test('changing canvas selection while processing does not change the frozen source', async ({ page }, testInfo) => {
    test.skip(!realBoardEnabled, 'Unverified: a real non-mocked board task is required to inspect an in-flight frozen source.');
    test.setTimeout(540_000);
    await capture(page, testInfo, 'element-frozen-source-selection-change', async () => {
      await loginAndCreateProject(page);
      const first = await uploadSource(page, 'element-frozen-first.png');
      const firstUrl = await first.getAttribute('src');
      const second = await uploadSource(page, 'element-frozen-second.png');
      const panel = await openElementPanel(page, first);
      await chooseMode(panel, 'board');
      const submission = await submitFromPanel(page, panel);
      await second.click({ force: true });
      expect(submission.body.imageUrl).toBe(firstUrl);
      const observed = await getTask(page, submission.task.taskId);
      expect(observed.source.sourceImageId).toBe(submission.task.source.sourceImageId);
      expect(observed.source.sha256).toBe(submission.task.source.sha256);
      const finalTask = await waitForTerminal(page, submission.task.taskId);
      expect(finalTask.source.sourceImageId).toBe(submission.task.source.sourceImageId);
      expect(finalTask.source.sha256).toBe(submission.task.source.sha256);
    });
  });

  test('a real single-branch failure preserves its sibling and retries only the failed branch', async ({ page }, testInfo) => {
    test.skip(
      !controlledFailureEnabled || !realBoardEnabled || !realPearEnabled,
      'Unverified: requires an explicitly configured real one-branch failure; responses are never mocked.',
    );
    test.setTimeout(900_000);
    await capture(page, testInfo, 'element-partial-retry-real', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-partial-source.png');
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'both');
      const submission = await submitFromPanel(page, panel);
      const partial = await waitForTerminal(page, submission.task.taskId, 660_000);
      expect(partial.overallStatus).toBe('partial');
      const failedBranch = (['board', 'layers'] as const).find((branch) => (
        ['failed', 'cancelled', 'timeout'].includes(partial.branches[branch]?.status || '')
      ));
      const completedBranch = (['board', 'layers'] as const).find((branch) => partial.branches[branch]?.status === 'completed');
      expect(failedBranch).toBeTruthy();
      expect(completedBranch).toBeTruthy();
      const completedTaskId = partial.branches[completedBranch!]!.taskId;
      const failedTaskId = partial.branches[failedBranch!]!.taskId;

      const retryResponse = page.waitForResponse((response) => {
        if (!response.url().includes('/api/element-decompose') || response.request().method() !== 'POST') return false;
        const body = response.request().postDataJSON() as { action?: string; branch?: string } | null;
        return body?.action === 'retry' && body.branch === failedBranch;
      });
      await panel.locator(`[data-element-branch="${failedBranch}"]`).getByRole('button', { name: /仅重试此分支/ }).click();
      const retry = await retryResponse;
      expect(retry.ok()).toBeTruthy();
      const retried = await retry.json() as ElementTask;
      expect(retried.branches[completedBranch!]!.taskId).toBe(completedTaskId);
      expect(retried.branches[failedBranch!]!.taskId).not.toBe(failedTaskId);
      const finalTask = await waitForTerminal(page, submission.task.taskId, 660_000);
      expect(finalTask.branches[completedBranch!]!.taskId).toBe(completedTaskId);
      expect(finalTask.overallStatus).toBe('completed');
    });
  });

  test('cancelling a real in-flight dual task reaches a stable non-completed terminal state', async ({ page }, testInfo) => {
    test.skip(!realBoardEnabled || !realPearEnabled, 'Unverified: cancellation requires a real long-running dual task.');
    test.setTimeout(300_000);
    await capture(page, testInfo, 'element-cancel-real', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-cancel-source.png');
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'both');
      const submission = await submitFromPanel(page, panel);
      const cancelResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/element-decompose?taskId=${submission.task.taskId}`)
        && response.request().method() === 'DELETE'
      ));
      await panel.getByRole('button', { name: '取消任务', exact: true }).click();
      const cancelledResponse = await cancelResponse;
      expect(cancelledResponse.ok()).toBeTruthy();
      const cancelled = await cancelledResponse.json() as ElementTask;
      expect(cancelled.overallStatus).toMatch(/^(cancelled|partial|failed)$/);

      const observations: OverallStatus[] = [];
      for (let index = 0; index < 3; index += 1) {
        observations.push((await getTask(page, submission.task.taskId)).overallStatus);
      }
      expect(observations).not.toContain('completed');
      expect(new Set(observations).size).toBe(1);
    });
  });

  test('a completed real dual task remains recoverable after project refresh', async ({ page }, testInfo) => {
    test.skip(!realBoardEnabled || !realPearEnabled, 'Unverified: refresh recovery requires a completed real dual-output task.');
    test.setTimeout(780_000);
    await capture(page, testInfo, 'element-refresh-recovery-real', async () => {
      await loginAndCreateProject(page);
      const source = await uploadSource(page, 'element-refresh-source.png');
      const panel = await openElementPanel(page, source);
      await chooseMode(panel, 'both');
      const submission = await submitFromPanel(page, panel);
      const finalTask = await waitForTerminal(page, submission.task.taskId, 660_000);
      expect(finalTask.overallStatus).toBe('completed');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-element-status="completed"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-element-branch="board"]')).toContainText('completed');
      await expect(page.locator('[data-element-branch="layers"]')).toContainText('completed');
      const persisted = await getTask(page, submission.task.taskId);
      expect(persisted.source.sha256).toBe(finalTask.source.sha256);
      expect(persisted.branches.board?.taskId).toBe(finalTask.branches.board?.taskId);
      expect(persisted.branches.layers?.taskId).toBe(finalTask.branches.layers?.taskId);
    });
  });
});
