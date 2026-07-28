import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const providerId = process.env.E2E_LAYER_PROVIDER_ID;
const modelId = process.env.E2E_LAYER_MODEL_ID;
const enablePaidLayering = process.env.E2E_ENABLE_PAID_LAYERING === '1'
  && process.env.LAYER_E2E_SKIP_PROVIDER_CALL !== '1';
const fixturePath = resolve(process.cwd(), 'tests/fixtures/annotation-source.png');
const fixtureBuffer = readFileSync(fixturePath);

async function loginAndCreateProject(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
    localStorage.removeItem('wujie-layer-engine');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
  await page.getByRole('button', { name: /^无限画布/ }).click();
  await page.getByPlaceholder('请输入用户名').fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/login')
    && response.request().method() === 'POST'
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

async function uploadSource(page: Page): Promise<Locator> {
  const canvasImages = page.locator('[data-canvas-viewport] img');
  const before = await canvasImages.count();
  await page.getByTestId('canvas-image-upload-input').setInputFiles({
    name: 'layer-editing-source.png',
    mimeType: 'image/png',
    buffer: fixtureBuffer,
  });
  await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const source = canvasImages.last();
  await expect(source).toBeVisible();
  await source.click();
  return source;
}

async function openLayerEditor(page: Page): Promise<Locator> {
  let entry = page.getByTestId('canvas-edit-elements');
  if (await entry.count() === 0) {
    await page.getByRole('button', { name: /展开更多工具/ }).click();
    entry = page.getByTestId('canvas-edit-elements');
  }
  await expect(entry).toBeVisible();
  await entry.click();
  const editor = page.getByTestId('layer-editor');
  await expect(editor).toBeVisible();
  return editor;
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

test.describe('Pear hybrid layer editing', () => {
  test.skip(!username || !password, 'Real E2E credentials are required for layer editing tests.');

  test('opens from the image toolbar and exposes smart, cloud, and local modes', async ({ page }, testInfo) => {
    await capture(page, testInfo, 'layer-editor-modes', async () => {
      await loginAndCreateProject(page);
      await uploadSource(page);
      const editor = await openLayerEditor(page);

      for (const engine of ['smart', 'cloud', 'local'] as const) {
        const button = editor.locator(`[data-layer-engine="${engine}"]`);
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(editor.getByTestId('layer-start')).toBeEnabled();
    });
  });

  test('completes a non-billable local decomposition and edits the returned layer stack', async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    await capture(page, testInfo, 'layer-editor-local-completed', async () => {
      await loginAndCreateProject(page);
      await uploadSource(page);
      const editor = await openLayerEditor(page);
      await editor.locator('[data-layer-engine="local"]').click();

      const submissions: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/layered-decompose') && request.method() === 'POST') {
          submissions.push(request.postData() || '');
        }
      });
      await editor.getByTestId('layer-start').click();
      await expect(editor.getByTestId('layer-progress')).toBeVisible();
      await expect(editor.getByTestId('layer-count')).toBeVisible({ timeout: 300_000 });
      await expect.poll(() => editor.locator('[data-layer-row]').count()).toBeGreaterThanOrEqual(2);
      expect(submissions).toHaveLength(1);
      expect(JSON.parse(submissions[0])).toMatchObject({ engine: 'local' });

      const firstLayer = editor.locator('[data-layer-row]').first();
      await firstLayer.hover();
      await firstLayer.locator('[data-layer-action="visibility"]').click();
      await firstLayer.hover();
      await firstLayer.locator('[data-layer-action="lock"]').click();
      await firstLayer.dblclick();
      const renameInput = firstLayer.locator('input');
      await renameInput.fill('浏览器验证图层');
      await renameInput.press('Enter');
      await expect(firstLayer).toContainText('浏览器验证图层');
    });
  });

  test('configures the ai-segment node without executing a provider call', async ({ page }, testInfo) => {
    await capture(page, testInfo, 'layer-node-configuration', async () => {
      await loginAndCreateProject(page);
      await uploadSource(page);
      await page.getByRole('button', { name: '节点模式' }).click();
      const confirm = page.getByRole('button', { name: /继续|确认/ });
      if (await confirm.isVisible().catch(() => false)) await confirm.click();

      const segmentTemplate = page.locator('[data-node-type="ai-segment"]');
      await expect(segmentTemplate).toBeVisible();
      await segmentTemplate.click();
      const node = page.locator('[data-node-id]').filter({ hasText: '元素分层' }).last();
      await expect(node).toBeVisible();
      await node.click();

      const engine = page.locator('[data-node-field="engine"] select');
      await expect(engine).toBeVisible();
      await engine.selectOption('local');
      await expect(engine).toHaveValue('local');
      await expect(page.locator('[data-node-field="model"] select')).toBeVisible();
    });
  });

  test('completes a real authorized Pear cloud task from one guarded UI submission', async ({ page }, testInfo) => {
    test.skip(
      !enablePaidLayering || !providerId || !modelId,
      'Set E2E_ENABLE_PAID_LAYERING=1, E2E_LAYER_PROVIDER_ID, and E2E_LAYER_MODEL_ID for a paid Pear call.',
    );
    test.setTimeout(600_000);

    await capture(page, testInfo, 'layer-editor-pear-completed', async () => {
      await loginAndCreateProject(page);
      const configured = await page.request.get('/api/workflow/models?type=layer');
      expect(configured.ok()).toBeTruthy();
      const modelList = await configured.json() as {
        models?: Array<{ id?: string; providerId?: string }>;
      };
      const firstPear = modelList.models?.find((model) => model.id?.toLowerCase() === 'image-layered');
      expect(firstPear).toMatchObject({ providerId, id: modelId });

      await uploadSource(page);
      const editor = await openLayerEditor(page);
      await editor.locator('[data-layer-engine="cloud"]').click();
      const submissions: Array<{ body: string | null }> = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/layered-decompose') && request.method() === 'POST') {
          submissions.push({ body: request.postData() });
        }
      });
      await editor.getByTestId('layer-start').dblclick();
      await expect(editor.getByTestId('layer-progress')).toBeVisible();
      await expect(editor.getByText('Pear 正在生成 PSD')).toBeVisible({ timeout: 120_000 });
      await expect(editor.getByTestId('layer-count')).toBeVisible({ timeout: 480_000 });
      await expect.poll(() => editor.locator('[data-layer-row]').count()).toBeGreaterThanOrEqual(2);
      expect(submissions).toHaveLength(1);
      expect(JSON.parse(submissions[0].body || '{}')).toMatchObject({
        engine: 'cloud',
        providerId,
        modelId,
      });
    });
  });
});
