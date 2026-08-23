import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const model = process.env.E2E_TRANSPARENT_MODEL || process.env.E2E_GENERATION_MODEL;
const paidGenerationApproved = ['true', '1'].includes(
  (process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase(),
);

function requireRealTransparentEnvironment(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_TRANSPARENT_MODEL or E2E_GENERATION_MODEL', model],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Real transparent-generation E2E environment is required. Missing: ${missing.join(', ')}`);
  }
  if (!model!.includes('::') || !/gpt-image-2/i.test(model!)) {
    throw new Error('The transparent E2E model must be the exact providerId::gpt-image-2 option value.');
  }
  if (!paidGenerationApproved) {
    throw new Error('Real paid generation is blocked until E2E_ENABLE_PAID_GENERATION=true is explicitly set.');
  }
}

async function loginAndOpenCanvas(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.getByPlaceholder('请输入用户名').fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse(
    response => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /登录/ }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('button', { name: '图像生成器' })).toBeVisible();
}

test.describe('GPT Image 2 native transparent PNG', () => {
  test('sends transparent PNG parameters and verifies real downloaded Alpha pixels', async ({ page }) => {
    test.setTimeout(360_000);
    requireRealTransparentEnvironment();
    const exactModel = model!;
    await loginAndOpenCanvas(page);

    await page.getByRole('button', { name: '图像生成器' }).click();
    const modelSelect = page.locator('select').filter({
      has: page.locator(`option[value="${exactModel}"]`),
    }).first();
    await expect(modelSelect).toBeVisible({ timeout: 20_000 });
    await modelSelect.selectOption(exactModel);

    const backgroundGroup = page.getByRole('group', { name: '生成图片背景' });
    const transparentButton = backgroundGroup.getByRole('button', { name: '透明' });
    await expect(transparentButton).toBeEnabled();
    await transparentButton.click();
    await expect(transparentButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('真正透明的 PNG（含 Alpha 通道）')).toBeVisible();

    let prompt = page.getByPlaceholder('描述你想要生成的图像...');
    if ((await prompt.count()) === 0) {
      prompt = page.getByPlaceholder('描述你想要创建的图像... (输入 / 使用模板)');
    }
    await prompt.first().fill('一个红色几何立方体图标，主体完整，边缘清晰，无背景，透明 PNG');

    const terminalPoll = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for verified transparent result')), 300_000);
      page.on('response', async (response) => {
        if (!response.url().includes('/api/poll-task') || response.request().method() !== 'POST') return;
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        const verification = payload?.alphaVerification as Record<string, unknown> | undefined;
        if (payload?.status === 'completed' && verification) {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });
    const generationResponse = page.waitForResponse(
      response => response.url().includes('/api/generate') && response.request().method() === 'POST',
    );
    await prompt.first().press('Control+Enter');
    const response = await generationResponse;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({
      background: 'transparent',
      output_format: 'png',
    });

    const terminal = await terminalPoll;
    expect(terminal.alphaVerification).toMatchObject({ requested: true, status: 'verified' });
    const imageUrl = terminal.imageUrl as string;
    expect(imageUrl).toBeTruthy();

    const imageResponse = await page.request.get(imageUrl);
    expect(imageResponse.ok()).toBeTruthy();
    const imageBuffer = Buffer.from(await imageResponse.body());
    const metadata = await sharp(imageBuffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    const alpha = await sharp(imageBuffer).extractChannel('alpha').raw().toBuffer();
    expect(alpha.some(value => value < 255)).toBe(true);
  });
});
