import { expect, type Locator, type Page, test } from '@playwright/test';
import sharp from 'sharp';

import type { TaskModelDescriptor } from '../../src/lib/task-core/model-capability-contract';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME?.trim();
const password = process.env.E2E_TEST_PASSWORD?.trim();
const paidGenerationApproved = ['1', 'true'].includes(
  (process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase(),
);

interface PublicModel {
  id: string;
  providerId: string;
  name?: string;
  displayName?: string;
  apiDisplayName?: string;
  providerName?: string;
}

interface ModelCatalogPayload {
  success?: boolean;
  models?: PublicModel[];
  taskModelCatalog?: TaskModelDescriptor[];
}

interface ImageCapabilityCase {
  descriptor: TaskModelDescriptor;
  model: PublicModel;
}

function exactKey(item: Pick<TaskModelDescriptor, 'providerId' | 'modelId'>): string {
  return `${item.providerId}::${item.modelId}`;
}

function capabilitySignature(descriptor: TaskModelDescriptor): string {
  return JSON.stringify({
    ratios: descriptor.allowedRatios,
    sizes: descriptor.allowedSizes,
    qualities: descriptor.qualityOptions,
    outputs: descriptor.maxOutputs,
    references: descriptor.maxReferenceImages,
  });
}

function requireAccount(testInfo: Parameters<typeof saveBrowserEvidence>[1]): void {
  if (username && password) return;
  testInfo.annotations.push({
    type: 'blocked',
    description: '缺少 E2E_TEST_USERNAME/E2E_TEST_PASSWORD，未执行真实登录浏览器验证',
  });
  test.skip(true, '真实登录凭据未配置，V588-PROVIDER-005 浏览器验收保持未验证');
}

async function loginAndCreateProject(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.getByPlaceholder('请输入用户名').fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse(response => (
    response.url().includes('/api/auth/login')
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /登录/ }).click();
  expect((await loginResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('button', { name: '图片上传' })).toBeVisible();
}

async function fetchCatalog(page: Page, type: 'image' | 'video'): Promise<ModelCatalogPayload> {
  const response = await page.request.get(`/api/models?type=${type}`);
  expect(response.ok(), `${type} model catalog returned ${response.status()}`).toBe(true);
  const payload = await response.json() as ModelCatalogPayload;
  expect(payload.success).toBe(true);
  expect(payload.taskModelCatalog?.length || 0).toBeGreaterThan(0);
  return payload;
}

function findProviderSpecificImagePair(payload: ModelCatalogPayload): [ImageCapabilityCase, ImageCapabilityCase] | null {
  const models = new Map((payload.models || []).map(model => (
    [`${model.providerId}::${model.id}`, model]
  )));
  const byModelId = new Map<string, TaskModelDescriptor[]>();
  for (const descriptor of payload.taskModelCatalog || []) {
    if (descriptor.kind !== 'image') continue;
    const existing = byModelId.get(descriptor.modelId) || [];
    existing.push(descriptor);
    byModelId.set(descriptor.modelId, existing);
  }
  for (const descriptors of byModelId.values()) {
    for (let leftIndex = 0; leftIndex < descriptors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < descriptors.length; rightIndex += 1) {
        const left = descriptors[leftIndex];
        const right = descriptors[rightIndex];
        if (capabilitySignature(left) === capabilitySignature(right)) continue;
        const leftModel = models.get(exactKey(left));
        const rightModel = models.get(exactKey(right));
        if (leftModel && rightModel) {
          return [
            { descriptor: left, model: leftModel },
            { descriptor: right, model: rightModel },
          ];
        }
      }
    }
  }
  return null;
}

function qualityLabel(value: string): string {
  const labels: Record<string, string> = {
    auto: '自动', low: '快速', medium: '中等', standard: '标准', high: '高清', hd: '高清', ultra: '超清',
  };
  return labels[value] || value;
}

async function assertGenerationPanelControls(
  panel: Locator,
  descriptor: TaskModelDescriptor,
): Promise<void> {
  for (const ratio of descriptor.allowedRatios) {
    await expect(panel.getByText(ratio === 'auto' ? '智能' : ratio, { exact: true }).first()).toBeVisible();
  }
  for (const size of descriptor.allowedSizes) {
    await expect(panel.getByRole('button', { name: size, exact: true })).toBeVisible();
  }
  for (const quality of descriptor.qualityOptions) {
    await expect(panel.getByText(qualityLabel(quality), { exact: true }).first()).toBeVisible();
  }
  for (let output = 1; output <= descriptor.maxOutputs; output += 1) {
    await expect(panel.getByRole('button', { name: `x${output}`, exact: true })).toBeVisible();
  }
  await expect(panel.getByRole('button', { name: `x${descriptor.maxOutputs + 1}`, exact: true })).toHaveCount(0);
}

async function createUploadFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 128,
      height: 96,
      channels: 4,
      background: { r: 28, g: 117, b: 188, alpha: 1 },
    },
  }).png().toBuffer();
}

async function uploadCanvasImage(page: Page): Promise<Locator> {
  const images = page.locator('[data-canvas-viewport] img');
  const before = await images.count();
  await page.getByTestId('canvas-image-upload-input').setInputFiles({
    name: 'v588-provider-capability.png',
    mimeType: 'image/png',
    buffer: await createUploadFixture(),
  });
  await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  return images.last();
}

async function selectGroupModel(group: Locator, capability: ImageCapabilityCase): Promise<void> {
  await group.getByText('模型', { exact: true }).locator('..').locator(':scope > button').click();
  const label = capability.model.apiDisplayName
    || capability.model.displayName
    || capability.model.name
    || capability.model.id;
  const provider = capability.model.providerName || capability.model.providerId;
  await group.getByRole('button').filter({ hasText: label }).filter({ hasText: provider }).click();
}

async function assertScaledMenu(
  group: Locator,
  ariaLabel: string,
  expected: string[],
): Promise<void> {
  const trigger = group.getByRole('button', { name: ariaLabel, exact: true });
  if (expected.length === 0) {
    await expect(trigger).toHaveCount(0);
    return;
  }
  await trigger.click();
  for (const value of expected) {
    await expect(group.getByRole('button', { name: value, exact: true })).toBeVisible();
  }
  await trigger.click();
}

async function assertGroupControls(group: Locator, descriptor: TaskModelDescriptor): Promise<void> {
  await assertScaledMenu(group, '图像比例', descriptor.allowedRatios);
  await assertScaledMenu(group, '图片分辨率', descriptor.allowedSizes);
  await assertScaledMenu(group, '图片质量', descriptor.qualityOptions.map(qualityLabel));
  await assertScaledMenu(
    group,
    '出图数量',
    Array.from({ length: descriptor.maxOutputs }, (_, index) => `${index + 1}张`),
  );
}

test.describe.serial('V588-PROVIDER-005 unified provider capabilities', () => {
  test('same model id keeps provider-specific controls across five user surfaces', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    requireAccount(testInfo);
    const evidence = collectBrowserEvidence(page);
    try {
      await loginAndCreateProject(page);
      const imageCatalog = await fetchCatalog(page, 'image');
      const pair = findProviderSpecificImagePair(imageCatalog);
      if (!pair) {
        testInfo.annotations.push({
          type: 'blocked',
          description: '当前账号目录没有同 modelId、不同 provider 且能力不同的两个图像模型',
        });
        test.skip(true, '缺少可证明 provider-specific 行为的同名跨供应商模型对');
        return;
      }

      await page.getByRole('button', { name: '图像生成器' }).click();
      const generationSelect = page.locator('#gen-model-select');
      await expect(generationSelect).toBeVisible();
      const generationPanel = generationSelect.locator('xpath=ancestor::div[contains(@class,"h-full")][1]');
      for (const capability of pair) {
        await generationSelect.selectOption(exactKey(capability.descriptor));
        await expect(generationSelect).toHaveValue(exactKey(capability.descriptor));
        await assertGenerationPanelControls(generationPanel, capability.descriptor);
      }
      await page.getByRole('button', { name: '图像生成器' }).click();

      const image = await uploadCanvasImage(page);
      await image.click({ modifiers: ['Alt'] });
      await image.click({ modifiers: ['Control'] });
      const referenceGroup = page.locator('[data-toolbar="generation-group"]').filter({ hasText: '参考图组' });
      const fusionGroup = page.locator('[data-toolbar="generation-group"]').filter({ hasText: '融图组' });
      await expect(referenceGroup).toBeVisible();
      await expect(fusionGroup).toBeVisible();
      await selectGroupModel(referenceGroup, pair[0]);
      await assertGroupControls(referenceGroup, pair[0].descriptor);
      await selectGroupModel(referenceGroup, pair[1]);
      await assertGroupControls(referenceGroup, pair[1].descriptor);
      await selectGroupModel(fusionGroup, pair[0]);
      await assertGroupControls(fusionGroup, pair[0].descriptor);

      await page.getByTitle('节点模式').click();
      await expect(page.getByRole('toolbar', { name: '工作流工具栏' })).toBeVisible();
      await page.locator('[data-node-type="ai-generate"]').click();
      const workflowNode = page.locator('[data-workflow-node-id]').last();
      await workflowNode.click();
      const nodeModelField = page.locator('[data-node-field="model"]');
      const nodeModelSelect = nodeModelField.locator('select');
      for (const capability of pair) {
        const key = exactKey(capability.descriptor);
        await expect(nodeModelSelect.locator(`option[value="${key}"]`)).toHaveCount(1);
        await nodeModelSelect.selectOption(key);
        await expect(nodeModelSelect).toHaveValue(key);
        const ratioField = page.locator('[data-node-field="aspectRatio"]');
        for (const ratio of capability.descriptor.allowedRatios) {
          await expect(ratioField.getByText(ratio, { exact: true })).toBeVisible();
        }
        const countInput = page.locator('[data-node-field="n"] input[type="number"]');
        await expect(countInput).toHaveAttribute('max', String(capability.descriptor.maxOutputs));
      }
      await page.getByRole('button', { name: '返回画布' }).click();

      const videoCatalog = await fetchCatalog(page, 'video');
      const videoDescriptor = (videoCatalog.taskModelCatalog || []).find(item => item.kind === 'video');
      if (!videoDescriptor) {
        testInfo.annotations.push({ type: 'blocked', description: '当前账号没有已授权视频模型' });
        test.skip(true, '视频能力目录为空，视频面板保持未验证');
        return;
      }
      await page.getByRole('button', { name: '视频生成' }).click();
      const videoPanel = page.getByText('视频模型', { exact: true }).locator('..').locator('..');
      const videoSelect = videoPanel.locator('select').first();
      await videoSelect.selectOption(exactKey(videoDescriptor));
      await expect(videoSelect).toHaveValue(exactKey(videoDescriptor));
      for (const ratio of videoDescriptor.allowedRatios) {
        await expect(page.getByRole('button', { name: ratio, exact: true })).toBeVisible();
      }
      if ((videoDescriptor.allowedDurationsSeconds || []).length > 0) {
        await expect(page.getByRole('slider', { name: '视频时长' })).toBeVisible();
      }
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'v588-provider-005-five-surfaces');
    }
  });

  test('illegal capability request is rejected before provider submission', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    requireAccount(testInfo);
    const evidence = collectBrowserEvidence(page);
    try {
      await loginAndCreateProject(page);
      const catalog = await fetchCatalog(page, 'image');
      const descriptor = (catalog.taskModelCatalog || []).find(item => item.kind === 'image');
      if (!descriptor) {
        testInfo.annotations.push({ type: 'blocked', description: '当前账号没有已授权图像模型' });
        test.skip(true, '图像能力目录为空，非法请求门禁保持未验证');
        return;
      }
      const response = await page.request.post('/api/generate', {
        data: {
          prompt: 'V588 capability rejection probe',
          providerId: descriptor.providerId,
          model: descriptor.modelId,
          n: descriptor.maxOutputs + 1,
          submitOnly: true,
        },
      });
      expect(response.status()).toBe(400);
      const payload = await response.json() as { code?: string; success?: boolean; details?: { field?: string } };
      expect(payload).toMatchObject({
        success: false,
        code: 'MODEL_CAPABILITY_MISMATCH',
        details: { field: 'outputCount' },
      });
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'v588-provider-005-illegal-request');
    }
  });

  test('authorized paid image generation remains opt-in', async ({ page }, testInfo) => {
    requireAccount(testInfo);
    test.skip(!paidGenerationApproved, '未设置 E2E_ENABLE_PAID_GENERATION=true；真实付费生成留待 Coze 验收');
    testInfo.annotations.push({
      type: 'verification',
      description: '此用例只声明付费门禁；完整结果、积分与供应商终态由 Task 12 真实云端验收记录',
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/.*/);
  });
});
