import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readPsd, type Psd } from 'ag-psd';

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
  const collapse = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  const projectId = await canvas.getAttribute('data-project-id');
  expect(projectId).toBeTruthy();
  await expect.poll(async () => {
    const status = await page.request.get(`/api/collaboration/document-enable?projectId=${encodeURIComponent(projectId!)}`);
    return status.ok();
  }, { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole('group', { name: '协作文档状态与恢复' })).toHaveCount(0);
}

async function uploadSource(page: Page): Promise<Locator> {
  const canvasImages = page.locator('[data-canvas-viewport] [data-canvas-image-id] img[alt="canvas image"]');
  const before = await canvasImages.count();
  await page.getByTestId('canvas-image-upload-input').setInputFiles({
    name: 'layer-editing-source.png',
    mimeType: 'image/png',
    buffer: fixtureBuffer,
  });
  await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const source = canvasImages.last();
  await expect(source).toBeVisible();
  const placement = source.locator('xpath=ancestor::*[@data-canvas-image-id][1]');
  if (await placement.getAttribute('data-canvas-selected') !== 'true') await placement.click();
  return source;
}

async function openLayerEditor(page: Page): Promise<Locator> {
  let entry = page.getByTestId('canvas-edit-elements');
  if (!await entry.isVisible()) {
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

test('reopens the saved local layer document and downloads an editable PSD after reload', async ({ page }, testInfo) => {
  const deliveryMode = process.env.E2E_LOCAL_PSD_DELIVERY;
  test.skip(deliveryMode !== '1' && deliveryMode !== 'document', 'Run against the dedicated local PSD delivery fixture.');
  const origin = new URL(testInfo.project.use.baseURL ?? '');
  expect(origin.hostname).toBe('127.0.0.1');
  expect(origin.protocol).toBe('http:');
  expect(username?.startsWith('qa_nov13_')).toBe(true);
  expect(Boolean(password?.length)).toBe(true);
  test.setTimeout(180_000);
  await capture(page, testInfo, 'local-layer-document-download', async () => {
    const submissions: string[] = [];
    await page.route('**/api/layered-decompose', async route => {
      if (route.request().method() === 'POST') {
        const engine: unknown = route.request().postDataJSON()?.engine;
        if (engine !== 'local' || new URL(route.request().url()).origin !== origin.origin) {
          submissions.push('blocked');
          await route.abort();
          return;
        }
        submissions.push(engine);
      }
      await route.continue();
    });
    await loginAndCreateProject(page);
    if (deliveryMode === 'document') {
      const canvas = page.locator('[data-canvas-viewport]');
      const projectId = (await canvas.getAttribute('data-project-id'))!;
      const query = new URLSearchParams({ projectId });
      await page.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' });
      const before = await page.request.get('/api/user-data/sync?key=projects');
      expect(before.status()).toBe(200);
      const snapshot = await before.json() as { projectRevision: number; value: Array<{ id: string; name: string }> };
      expect(snapshot.value.filter(project => project.id === projectId)).toHaveLength(1);
      const name = `PSD source ${projectId}`;
      const saved = await page.request.post('/api/user-data/sync', { data: {
        key: 'projects', projectRevision: snapshot.projectRevision,
        value: snapshot.value.map(project => project.id === projectId ? { ...project, name } : project),
      } });
      expect(saved.status()).toBe(200);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: `${name} 项目操作菜单`, exact: true }).click();
      await page.getByRole('menuitem', { name: '管理协作', exact: true }).click();
      const [enabled] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/collaboration/document-enable'
          && response.request().method() === 'POST'),
        page.getByRole('button', { name: '启用协作', exact: true }).click(),
      ]);
      expect(enabled.status()).toBe(200);
      expect(await enabled.json()).toMatchObject({ success: true, projectId });
      await page.goto(`/?${query}`, { waitUntil: 'domcontentloaded' });
      await expect(canvas).toHaveAttribute('data-project-id', projectId);
      await expect(page.getByTestId('canvas-image-upload-input')).toHaveAttribute('accept', /video\/mp4/);
      await expect(page.getByRole('group', { name: '协作文档状态与恢复' }).getByRole('status')).toHaveText('已保存');
    }
    const source = (await uploadSource(page)).locator('xpath=ancestor::*[@data-canvas-image-id][1]');
    const sourceId = await source.getAttribute('data-canvas-image-id');
    expect(sourceId).toBeTruthy();
    const editor = await openLayerEditor(page);
    await editor.locator('[data-layer-engine="local"]').click();
    await editor.getByTestId('layer-start').click();
    const rows = editor.locator('[data-layer-row]');
    await expect(rows.first()).toBeVisible({ timeout: 90_000 });
    await expect(editor.getByTestId('layer-document-status')).toHaveText('已保存');
    const layerCount = await rows.count();
    expect(layerCount).toBeGreaterThanOrEqual(2);

    if (deliveryMode === 'document') {
      const query = new URLSearchParams({ projectId: (await page.locator('[data-canvas-viewport]').getAttribute('data-project-id'))! });
      const projection = await page.request.get(`/api/collaboration/document-project?${query}`);
      expect(projection.status()).toBe(200);
      const project = await projection.json() as { canvasImages: Array<{ id: string; assetVersionId?: string; placementId?: string }> };
      expect(project.canvasImages.find(image => image.id === sourceId)).toMatchObject({
        assetVersionId: expect.any(String), placementId: expect.any(String),
      });
    }

    const layerName = 'QA saved PSD layer';
    await rows.first().dblclick();
    await rows.first().locator('input').fill(layerName);
    const [saveResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/layer-documents'
        && response.request().method() === 'PATCH'),
      rows.first().locator('input').press('Enter'),
    ]);
    expect(saveResponse.ok()).toBe(true);
    await expect(editor.getByTestId('layer-document-status')).toHaveText('已保存');
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(source).toHaveAttribute('data-canvas-image-id', sourceId!);
    if (await source.getAttribute('data-canvas-selected') !== 'true') await source.click();
    const [readResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/layer-documents'
        && response.request().method() === 'GET'),
      openLayerEditor(page),
    ]);
    expect(readResponse.ok()).toBe(true);
    await expect(editor.getByTestId('layer-document-status')).toHaveText('已保存');
    await expect(rows).toHaveCount(layerCount);
    await expect(rows.first()).toContainText(layerName);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      editor.getByTestId('layer-export-psd').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.psd$/iu);
    const bytes = readFileSync(await download.path() ?? '');
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('8BPS');
    const psd = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    function namesOf(layers: Psd['children']): string[] {
      return (layers ?? []).flatMap(layer => [layer.name ?? '', ...namesOf(layer.children)]);
    }
    const layerNames = namesOf(psd.children);
    expect(layerNames.length).toBeGreaterThanOrEqual(2);
    expect(layerNames).toContain(layerName);
    expect(submissions).toEqual(['local']);
  });
});

test.describe('Pear hybrid layer editing', () => {
  test.skip(!username || !password, 'Real E2E credentials are required for layer editing tests.');

  test('opens from the image toolbar and exposes smart, cloud, and local modes', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
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
    test.setTimeout(90_000);
    await capture(page, testInfo, 'layer-node-configuration', async () => {
      await loginAndCreateProject(page);
      await uploadSource(page);
      await page.getByRole('button', { name: '节点模式' }).click();
      const confirm = page.getByRole('button', { name: /继续|确认/ });
      if (await confirm.isVisible().catch(() => false)) await confirm.click();

      const libraryToggle = page.getByRole('button', { name: '切换节点库面板', exact: true });
      await expect(libraryToggle).toBeVisible();
      if (await libraryToggle.getAttribute('aria-pressed') !== 'true') {
        await libraryToggle.click();
      }
      const segmentTemplate = page.getByRole('complementary', { name: '节点库' })
        .locator('[data-node-type="ai-segment"]');
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
