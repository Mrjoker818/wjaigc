import { expect, test, type Page } from '@playwright/test';
import { compileSketchHtml } from '../../src/lib/sketch-to-code/html';

// Task6 runs this against its authorized local app. All business endpoints are
// intercepted: this is product wiring with controlled HTTP, NOT paid/shared acceptance.
const html = compileSketchHtml({ type: 'heading', text: '草图页面中文', level: 1 });
const user = { id: 'sketch-fixture-user', name: 'Sketch fixture', role: 'admin', status: 'active', productType: 'canvas,chat', createdAt: 1, updatedAt: 1 };
const model = { providerId: 'sketch-provider', modelId: 'sketch-model', kind: 'chat', sourceType: 'chat', protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, allowedRatios: [], allowedSizes: [], qualityOptions: [], supportsReferenceImages: false, supportsMask: false, maxOutputs: 1, outputKinds: ['text'], capabilitySources: {} };
const task = { success: true, type: 'sketch-to-code', taskId: 'sketch-fixture-task', projectId: 'sketch-fixture-project', providerId: model.providerId, modelId: model.modelId, status: 'completed', progress: 100, reserveCredits: 20, actualCredits: 12, previewAssetId: 'sketch-png', htmlAssetId: 'sketch-html', previewAssetVersionId: 'sketch-png-version', htmlAssetVersionId: 'sketch-html-version', analysis: '中文结构', refunded: false };

async function fixture(page: Page): Promise<{ admissions: string[]; reads: string[] }> {
  let projects: unknown = [{ id: task.projectId, userId: user.id, name: 'Sketch fixture', createdAt: 1, updatedAt: 1, settings: {}, canvasImages: [] }];
  const admissions: string[] = [], reads: string[] = [];
  let inputPng = '', entityId = '', sourceTrace: unknown;
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { success: false, error: 'SKETCH_FIXTURE_UNHANDLED_ENDPOINT' } }));
  await page.route('**/api/session', route => route.fulfill({ json: { success: true, user } }));
  await page.route('**/api/models**', route => route.fulfill({ json: { success: true, providers: [], models: [], taskModelCatalog: [model] } }));
  await page.route('**/api/tasks/recover**', route => route.fulfill({ json: { success: true, tasks: [] } }));
  await page.route('**/api/user-data/sync**', route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); if (body.key === 'projects') projects = body.value;
    }
    return route.fulfill({ json: { success: true, value: projects, projectRevision: 2, deletedCanvasPlacements: [], assetGraphMode: 'legacy', canvasKernelMode: 'main', workflowRendererMode: 'legacy' } });
  });
  await page.route('**/api/sketch-to-code', route => {
    admissions.push(route.request().postData()!); inputPng = route.request().postDataJSON().imageDataUrl;
    return route.fulfill({ status: 202, json: { ...task, status: 'processing', progress: 5 } });
  });
  await page.route('**/api/poll-task', route => route.fulfill({ json: task }));
  await page.route('**/api/sketch-to-code/*/document?*', route => { reads.push(route.request().url()); return route.fulfill({ contentType: 'text/html;charset=utf-8', body: html }); });
  await page.route('**/api/assets/transfer', route => {
    const body = route.request().postDataJSON(); entityId = body.entityId; sourceTrace = body.metadata.sourceTrace;
    return route.fulfill({ json: { assetId: task.previewAssetId, assetVersionId: task.previewAssetVersionId, placementId: 'sketch-placement', placementStatus: 'active', entityId, url: '/sketch-fixture.png', sourceTrace, reused: false } });
  });
  await page.route('**/api/assets?*', route => route.fulfill({ json: { kind: 'image', assetId: task.previewAssetId, assetVersionId: task.previewAssetVersionId, url: '/sketch-fixture.png', ...(route.request().url().includes('placementId=') ? { placementId: 'sketch-placement', entityId, sourceTrace } : {}) } }));
  await page.route('**/sketch-fixture.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(inputPng.split(',')[1], 'base64') }));
  return { admissions, reads };
}

test('original drawer exports fresh code and personal PNG placement survives refresh without readmitting a task', async ({ page }) => {
  const evidence = await fixture(page);
  await page.goto(`/?projectId=${task.projectId}`);
  await expect(page.locator('[data-canvas-interaction-surface]')).toBeVisible();
  const toolbar = page.viewportSize()!.width < 768 ? page.locator('[data-mobile-canvas-toolbar]') : page.locator('[data-toolbar="bottom-toolbar"]');
  await toolbar.getByRole('button', { name: '全部工具' }).click();
  await page.getByRole('button', { name: '草图转代码', exact: true }).filter({ visible: true }).click();
  const panel = page.getByRole('region', { name: '草图转代码' });
  await expect(panel.getByRole('button', { name: '生成代码' })).toBeDisabled();
  const surface = panel.getByLabel('绘图区'); const box = await surface.boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 30); await page.mouse.down(); await page.mouse.move(box!.x + 120, box!.y + 60); await page.mouse.up();
  await panel.getByLabel('视觉模型').selectOption(JSON.stringify([model.providerId, model.modelId]));
  await panel.getByRole('button', { name: '生成代码' }).click();
  await expect(panel.getByRole('button', { name: '打开代码预览' })).toBeVisible();
  await panel.getByRole('button', { name: '打开代码预览' }).click();
  await expect(panel.locator('iframe')).toHaveAttribute('sandbox', '');
  await expect(panel.frameLocator('iframe').getByText('草图页面中文')).toBeVisible();
  const downloadEvent = page.waitForEvent('download'); await panel.getByRole('button', { name: '下载HTML' }).click();
  const stream = await (await downloadEvent).createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks).toString('utf8')).toBe(html);
  await panel.getByRole('button', { name: '添加到画布' }).click();
  await expect(page.locator('[data-canvas-image-id^="sketch-"]')).toHaveCount(1);
  await page.reload(); await expect(page.locator('[data-canvas-image-id^="sketch-"]')).toHaveCount(1);
  await page.locator('[data-canvas-image-id^="sketch-"]').click(); await page.getByRole('button', { name: '打开草图代码' }).click();
  await page.getByRole('button', { name: '打开代码预览' }).click();
  expect(evidence.admissions).toHaveLength(1); expect(evidence.reads).toHaveLength(3);
  expect(JSON.parse(evidence.admissions[0])).toMatchObject({ providerId: model.providerId, modelId: model.modelId });
});
