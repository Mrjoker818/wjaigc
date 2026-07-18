import { expect, test } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const projectId = process.env.E2E_TEST_PROJECT_ID;
const model = process.env.E2E_GENERATION_MODEL;
const paidGenerationApproved = process.env.E2E_ENABLE_PAID_GENERATION === 'true';
const uploadedImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function requireRealEnvironment(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_TEST_PROJECT_ID', projectId],
    ['E2E_GENERATION_MODEL', model],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Real P0 E2E environment is required. Missing: ${missing.join(', ')}`);
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
      await expect(page.getByText('我的项目')).toBeVisible();

      await page.goto(`/?projectId=${encodeURIComponent(projectId!)}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: '图片上传' })).toBeVisible();
      await expect(page.getByRole('button', { name: '抓手工具' })).toBeVisible();

      const beforeUpload = await page.locator('main img, [data-canvas] img').count();
      const fileChooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '图片上传' }).click();
      await (await fileChooser).setFiles({ name: 'p0-real-upload.png', mimeType: 'image/png', buffer: uploadedImage });
      await expect.poll(() => page.locator('main img, [data-canvas] img').count(), { timeout: 30_000 }).toBeGreaterThan(beforeUpload);

      const canvasImage = page.locator('main img, [data-canvas] img').last();
      await canvasImage.click();
      await page.mouse.move(600, 420);
      await page.mouse.down();
      await page.mouse.move(660, 460, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('Control+Equal');
      await page.keyboard.press('Delete');
      await expect.poll(() => page.locator('main img, [data-canvas] img').count(), { timeout: 10_000 }).toBeLessThanOrEqual(beforeUpload);

      await page.getByRole('button', { name: /图像生成器/ }).click();
      const prompt = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
      await prompt.fill('P0 real browser regression test: a single red geometric cube on a clean white background');
      const modelLabel = page.getByText('图像模型', { exact: true });
      await modelLabel.locator('..').getByRole('combobox').selectOption({ label: model! });
      const generationResponse = page.waitForResponse((response) => response.url().includes('/api/generate') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '开始生成' }).click();
      const response = await generationResponse;
      expect(response.ok(), `Generation request failed with ${response.status()}`).toBeTruthy();
      const payload = await response.json();
      expect(payload.success ?? Boolean(payload.taskId || payload.data), 'Generation response did not report a business-success payload').toBeTruthy();

      const resultBefore = await page.locator('main img, [data-canvas] img').count();
      await expect.poll(() => page.locator('main img, [data-canvas] img').count(), { timeout: 180_000, intervals: [1_000, 2_000, 4_000] }).toBeGreaterThan(resultBefore);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => page.locator('main img, [data-canvas] img').count(), { timeout: 30_000 }).toBeGreaterThan(0);

      await page.locator('main img, [data-canvas] img').last().click();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: /下载/ }).click();
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
