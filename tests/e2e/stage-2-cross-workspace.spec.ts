import {
  expect,
  loginRealUser,
  openCanvasProject,
  requireStage2ProjectValue,
  test,
} from '../helpers/stage-2-e2e';

async function recordJsonResponse(response: import('@playwright/test').Response, record: (payload: unknown) => void): Promise<void> {
  expect(response.ok(), `${response.url()} returned HTTP ${response.status()}`).toBeTruthy();
  const payload = await response.json().catch(() => ({}));
  record(payload);
}

test.use({ trace: 'off', video: 'on' });

test.describe('Stage 2 cross-workspace flows', () => {
  test('bridges a real embedded-chat result back onto the canvas through the UI', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_EMBEDDED_CHAT_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const images = page.locator('[data-canvas-viewport] img[src]');
    const before = await images.count();
    await page.getByText('AI聊天', { exact: true }).click();
    const addButton = page.getByRole('button', { name: '添加到画布', exact: true }).last();
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
    await addButton.click();
    await recordJsonResponse(await transfer, payload => stage2Evidence.recordPayload(payload));
    await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  });

  test('runs a seeded workflow through the node-mode UI and returns its real output to canvas', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_WORKFLOW_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const before = await page.locator('[data-canvas-viewport] img[src]').count();
    await page.getByTitle('节点模式').first().click();
    const execute = page.getByRole('button', { name: '执行工作流', exact: true });
    await expect(execute).toBeVisible({ timeout: 20_000 });
    const started = page.waitForResponse(response => response.url().includes('/api/workflow/execute') && response.request().method() === 'POST');
    const outputTransfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST', { timeout: 180_000 });
    await execute.click();
    await recordJsonResponse(await started, payload => stage2Evidence.recordPayload(payload));
    await recordJsonResponse(await outputTransfer, payload => stage2Evidence.recordPayload(payload));
    const back = page.getByRole('button', { name: '返回画布', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(
      () => page.locator('[data-canvas-viewport] img[src]').count(),
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    ).toBeGreaterThan(before);
  });

  test('sends a real standalone-chat result into the designated canvas through the UI', async ({ page, stage2Evidence }, testInfo) => {
    const chatProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_STANDALONE_CHAT_PROJECT_IDS');
    const targetProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_STANDALONE_TARGET_PROJECT_IDS');
    await loginRealUser(page);
    await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: '目标画布项目' }).selectOption(targetProjectId);
    const addButton = page.getByTitle('添加到画布').last();
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
    await addButton.click();
    await recordJsonResponse(await transfer, payload => stage2Evidence.recordPayload(payload));
    await openCanvasProject(page, targetProjectId);
    await expect(page.locator('[data-canvas-viewport] img[src]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('keeps seeded chat and workflow views usable after deleting only the canvas placement', async ({ page }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_REFERENCE_PROJECT_IDS');
    const chatProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_CHAT_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const image = page.locator('[data-canvas-viewport] img[src]').first();
    await expect(image).toBeVisible({ timeout: 20_000 });
    await image.click();
    await page.getByTestId('selected-image-delete').click();
    await expect(image).toHaveCount(0);

    await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main img[src]').first()).toBeVisible({ timeout: 20_000 });

    await openCanvasProject(page, projectId);
    await page.getByTitle('节点模式').first().click();
    await expect(page.getByRole('button', { name: '执行工作流', exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
