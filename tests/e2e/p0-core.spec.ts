import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
// The UI displays duplicate model labels across providers. Keep the provider
// identity in the test input so it cannot silently select a different vendor.
const model = process.env.E2E_GENERATION_MODEL;
const paidGenerationApproved = process.env.E2E_ENABLE_PAID_GENERATION === 'true';
async function createUploadFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 96,
      height: 64,
      channels: 4,
      background: { r: 220, g: 38, b: 38, alpha: 1 },
    },
  }).png().toBuffer();
}

function requireRealEnvironment(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_GENERATION_MODEL', model],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Real P0 E2E environment is required. Missing: ${missing.join(', ')}`);
  if (!model!.includes('::')) {
    throw new Error('E2E_GENERATION_MODEL must use the exact providerId::modelId option value, not a duplicate display label.');
  }
  if (!paidGenerationApproved) throw new Error('Real generation is intentionally blocked. Set E2E_ENABLE_PAID_GENERATION=true only after an authorized credit-consuming test run is approved.');
}

test.describe('P0 real user journey', () => {
  test('login, upload, canvas operations, real generation, save/reload, download, and logout', async ({ page }, testInfo) => {
    requireRealEnvironment();
    const evidence = collectBrowserEvidence(page);
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await page.getByRole('button', { name: /无限画布/ }).first().click();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      await page.getByPlaceholder('请输入用户名').fill(username!);
      await page.getByPlaceholder('请输入密码').fill(password!);
      const loginResponse = page.waitForResponse((response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
      await page.getByRole('button', { name: /登录/ }).click();
      const login = await loginResponse;
      expect(login.ok(), `Login request failed with ${login.status()}`).toBeTruthy();
      const loginPayload = await login.json() as { success?: boolean; user?: { id?: string } };
      expect(loginPayload.success && loginPayload.user?.id, 'Login response did not contain an authenticated user').toBeTruthy();
      await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();

      const newProject = page.getByRole('button', { name: '新建项目', exact: true });
      await expect(newProject).toHaveCount(1);
      await newProject.click();
      await expect(page.getByRole('button', { name: '图片上传' })).toBeVisible();
      await expect(page.getByRole('button', { name: '抓手工具' })).toBeVisible();

      const canvasImages = page.locator('[data-canvas-viewport] img');
      const beforeUpload = await canvasImages.count();
      const fileChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '图片上传' }).click();
      await (await fileChooser).setFiles({ name: 'p0-real-upload.png', mimeType: 'image/png', buffer: await createUploadFixture() });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(beforeUpload);

      const canvasImage = canvasImages.last().locator('..');
      await canvasImage.click();
      await canvasImage.hover();
      const hoverDelete = page.getByTestId('selected-image-delete');
      await expect(hoverDelete).toHaveCount(1);
      await hoverDelete.click();
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBeLessThanOrEqual(beforeUpload);

      // Upload once more so the movement and keyboard-delete checks remain
      // independent from the hover-toolbar deletion regression above.
      const secondFileChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '图片上传' }).click();
      await (await secondFileChooser).setFiles({ name: 'p0-real-upload-second.png', mimeType: 'image/png', buffer: await createUploadFixture() });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(beforeUpload);

      const secondCanvasImage = canvasImages.last().locator('..');
      await secondCanvasImage.click();
      const imageBox = await secondCanvasImage.boundingBox();
      expect(imageBox, 'Uploaded canvas image did not have a visible bounding box').not.toBeNull();
      const imageCenterX = imageBox!.x + imageBox!.width / 2;
      const imageCenterY = imageBox!.y + imageBox!.height / 2;
      await page.mouse.move(imageCenterX, imageCenterY);
      await page.mouse.down();
      await page.mouse.move(imageCenterX + 60, imageCenterY + 40, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('Control+Equal');
      await page.keyboard.press('Delete');
      await expect.poll(() => canvasImages.count(), { timeout: 10_000 }).toBeLessThanOrEqual(beforeUpload);

      await page.getByRole('button', { name: /图像生成器/ }).click();
      const prompt = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
      await prompt.fill('P0 real browser regression test: a single red geometric cube on a clean white background');
      const modelLabel = page.getByText('图像模型', { exact: true });
      await modelLabel.locator('..').getByRole('combobox').selectOption({ value: model! });
      const generationResponse = page.waitForResponse((response) => response.url().includes('/api/generate') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '开始生成' }).click();
      const response = await generationResponse;
      expect(response.ok(), `Generation request failed with ${response.status()}`).toBeTruthy();
      const payload = await response.json();
      expect(payload.success ?? Boolean(payload.taskId || payload.data), 'Generation response did not report a business-success payload').toBeTruthy();

      const resultBefore = await canvasImages.count();
      await expect.poll(() => canvasImages.count(), { timeout: 180_000, intervals: [1_000, 2_000, 4_000] }).toBeGreaterThan(resultBefore);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => canvasImages.count(), { timeout: 30_000 }).toBeGreaterThan(0);

      await canvasImages.last().click();
      const moreActions = page.getByTitle('展开更多工具');
      await expect(moreActions).toHaveCount(1);
      await moreActions.click();
      const downloadAction = page.getByRole('button', { name: '下载', exact: true });
      await expect(downloadAction).toHaveCount(1);
      const download = page.waitForEvent('download');
      await downloadAction.click();
      const confirmDownload = page.getByRole('button', { name: '确认下载', exact: true });
      await expect(confirmDownload).toHaveCount(1);
      await confirmDownload.click();
      expect((await download).suggestedFilename()).not.toEqual('');

      await page.getByLabel(/查看用户信息|用户菜单/).click();
      await page.getByRole('button', { name: '退出登录' }).click();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      expect(evidence.console.filter((item) => ['error', 'warning'].includes(item.type))).toEqual([]);
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-real-user-journey');
    }
  });
});
