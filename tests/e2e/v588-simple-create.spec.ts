import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

test.use({ trace: 'on', video: 'on', screenshot: 'only-on-failure' });

function attachRuntimeEvidence(page: Page, testInfo: TestInfo): () => Promise<void> {
  const consoleEntries: string[] = [];
  const networkEntries: string[] = [];
  page.on('console', message => consoleEntries.push(`${message.type()} ${message.text()}`));
  page.on('pageerror', error => consoleEntries.push(`pageerror ${error.message}`));
  page.on('response', response => networkEntries.push(`${response.status()} ${response.request().method()} ${response.url()}`));
  return async () => {
    const name = `${testInfo.project.name}-${testInfo.title.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    const consolePath = resolve(process.cwd(), 'test-results', 'console', `v588-simple-create-${name}.log`);
    const networkPath = resolve(process.cwd(), 'test-results', 'network', `v588-simple-create-${name}.log`);
    mkdirSync(resolve(process.cwd(), 'test-results', 'console'), { recursive: true });
    mkdirSync(resolve(process.cwd(), 'test-results', 'network'), { recursive: true });
    writeFileSync(consolePath, consoleEntries.join('\n') || 'NO_CONSOLE_MESSAGES', 'utf8');
    writeFileSync(networkPath, networkEntries.join('\n') || 'NO_NETWORK_RESPONSES', 'utf8');
    await testInfo.attach('console.log', { path: consolePath, contentType: 'text/plain' });
    await testInfo.attach('network.log', { path: networkPath, contentType: 'text/plain' });
  };
}

async function installSimpleCreateFixture(page: Page): Promise<void> {
  await page.route('**/api/session', route => route.fulfill({
    json: { success: true, user: { id: 'simple-user', name: 'Simple Create', role: 'user', createdAt: 1, updatedAt: 1 } },
  }));
  await page.route('**/api/models?type=image', route => route.fulfill({
    json: {
      success: true,
      providers: [{ id: 'pear', name: 'Pear API' }],
      models: [{ id: 'image-test', name: 'Image Test', providerId: 'pear' }],
      taskModelCatalog: [{
        providerId: 'pear',
        modelId: 'image-test',
        kind: 'image',
        allowedRatios: ['1:1', '16:9'],
        allowedSizes: ['1024x1024', '1536x864'],
        qualityOptions: ['standard', 'high'],
        maxOutputs: 4,
        supportsReferenceImages: true,
        maxReferenceImages: 2,
      }],
    },
  }));
  await page.route('**/api/tasks/recover**', route => route.fulfill({ json: { success: true, tasks: [] } }));
  await page.route('**/api/task-events**', route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'event: connected\ndata: {"type":"connected"}\n\n',
  }));
  await page.route('**/api/upload', route => route.fulfill({ json: { success: true, url: '/fixture-reference.png' } }));
  await page.route('**/fixture-reference.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('fixture') }));
  await page.route('**/api/generate', async route => {
    const payload = route.request().postDataJSON() as { n?: number };
    const count = payload.n || 1;
    await route.fulfill({
      json: {
        success: true,
        batchId: 'simple-batch',
        slots: Array.from({ length: count }, (_, index) => ({
          taskId: `simple-task-${index + 1}`,
          slotId: `simple-slot-${index + 1}`,
          slotIndex: index,
          status: 'processing',
        })),
      },
    });
  });
  await page.route('**/api/poll-task', async route => {
    const payload = route.request().postDataJSON() as { taskId: string };
    const index = payload.taskId.endsWith('2') ? 2 : 1;
    await route.fulfill({
      json: {
        success: true,
        status: 'completed',
        progress: 100,
        assetProjection: { references: [{
          assetId: `asset-${index}`,
          assetVersionId: `version-${index}`,
          placementId: `placement-${index}`,
          url: `/generated-${index}.png`,
        }] },
      },
    });
  });
  await page.route('**/generated-*.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('fixture') }));
}

test.describe('V588 authoritative quick create browser matrix', () => {
  test('uses model capabilities and projects each completed slot independently', async ({ page }, testInfo) => {
    const saveEvidence = attachRuntimeEvidence(page, testInfo);
    try {
      await installSimpleCreateFixture(page);
      await page.goto('/simple-create?projectId=simple-project', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '快速生图' })).toBeVisible();
      await expect(page.getByLabel('模型')).toHaveValue('pear::image-test');
      await page.getByLabel('画面比例').selectOption('16:9');
      await page.getByLabel('图片尺寸').selectOption('1536x864');
      await expect(page.getByLabel('图片尺寸')).toHaveValue('1536x864');
      await page.getByLabel('图片质量').selectOption('high');
      await page.getByLabel('生成数量').selectOption('2');
      await page.getByLabel('提示词').fill('移动端双图测试');

      const submit = page.waitForRequest(request => request.url().endsWith('/api/generate') && request.method() === 'POST');
      await page.getByRole('button', { name: '开始生成' }).click();
      expect((await submit).postDataJSON()).toMatchObject({
        projectId: 'simple-project',
        providerId: 'pear',
        model: 'image-test',
        n: 2,
        outputCount: 2,
        aspectRatio: '16:9',
        size: '1536x864',
        quality: 'high',
      });

      await expect(page.getByRole('img', { name: '生成结果' })).toHaveCount(2, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /下载 generation-slot/ })).toHaveCount(2);
      await expect(page.getByRole('button', { name: /在画布中打开 generation-slot/ })).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await saveEvidence();
    }
  });
});
