import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const enableRealRemoveBackground = process.env.E2E_ENABLE_REAL_REMOVE_BACKGROUND === '1';
const enablePaidImageEditing = process.env.E2E_ENABLE_PAID_IMAGE_EDITING === '1';
const fixturePath = resolve(process.cwd(), 'tests/fixtures/annotation-source.png');
const fixtureBuffer = readFileSync(fixturePath);

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
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
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
  await page.getByRole('button', { name: /^无限画布/ }).click();
  await page.getByPlaceholder('请输入用户名').fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /^登录$/ }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const canvas = page.locator('[data-canvas-viewport]');
  const opened = await canvas.waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await page.getByText('未命名项目', { exact: true }).last().click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
}

function canvasImages(page: Page): Locator {
  return page.locator('[data-canvas-viewport] > div.group > img');
}

async function uploadAndSelectSource(page: Page): Promise<{ source: Locator; sourceUrl: string }> {
  const images = canvasImages(page);
  const before = await images.count();
  await page.getByTestId('canvas-image-upload-input').setInputFiles({
    name: 'image-toolbar-editing-source.png',
    mimeType: 'image/png',
    buffer: fixtureBuffer,
  });
  await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const source = images.last();
  await expect(source).toBeVisible();
  const sourceUrl = await source.getAttribute('src');
  expect(sourceUrl, 'Uploaded source image must expose a URL').toBeTruthy();
  await source.click();
  await expect(page.locator('[data-toolbar="image-action-toolbar"]')).toBeVisible();
  return { source, sourceUrl: sourceUrl! };
}

async function openToolbarAction(page: Page, label: string): Promise<void> {
  const toolbar = page.locator('[data-toolbar="image-action-toolbar"]');
  let action = toolbar.getByRole('button', { name: label, exact: true });
  if (await action.count() === 0 || !await action.isVisible().catch(() => false)) {
    await toolbar.getByRole('button', { name: /展开更多工具/ }).click();
    action = toolbar.getByRole('button', { name: label, exact: true });
  }
  await expect(action).toBeVisible();
  await action.click();
}

async function captureJsonPost(page: Page, path: string, action: () => Promise<void>): Promise<CapturedRequest> {
  const requestPromise = page.waitForRequest((request) => (
    request.url().includes(path) && request.method() === 'POST'
  ));
  await action();
  const request = await requestPromise;
  return {
    url: request.url(),
    body: request.postDataJSON() as Record<string, unknown>,
  };
}

async function waitForNewCompletedImage(
  page: Page,
  beforeCount: number,
  sourceUrl: string,
  timeout = 300_000,
): Promise<string> {
  const images = canvasImages(page);
  await expect.poll(() => images.count(), {
    timeout,
    intervals: [500, 1_000, 2_000, 4_000],
  }).toBeGreaterThan(beforeCount);
  await expect(page.locator('[data-canvas-viewport] [role="status"]')).toHaveCount(0, { timeout });
  const urls = await images.evaluateAll((elements) => elements.map((element) => element.getAttribute('src') || ''));
  const resultUrl = urls.find((url) => url && url !== sourceUrl);
  expect(resultUrl, 'Completed edit must add a distinct result image to the canvas').toBeTruthy();
  return resultUrl!;
}

async function drawStroke(page: Page, dialogTitle: string): Promise<void> {
  const dialog = page.getByText(dialogTitle, { exact: true }).locator('..').locator('..').locator('..');
  const editImage = dialog.getByRole('img', { name: 'edit' });
  await expect(editImage).toBeVisible();
  const drawingLayer = editImage.locator('xpath=following-sibling::svg/following-sibling::div');
  await expect(drawingLayer).toBeVisible();
  const box = await drawingLayer.boundingBox();
  expect(box, `${dialogTitle} drawing surface must have a visible bounding box`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.55, { steps: 12 });
  await page.mouse.up();
}

async function fetchImageBuffer(page: Page, imageUrl: string): Promise<Buffer> {
  const absoluteUrl = new URL(imageUrl, page.url()).toString();
  const response = await page.request.get(absoluteUrl);
  expect(response.ok(), `Result image fetch failed with ${response.status()}`).toBeTruthy();
  return response.body();
}

async function decodeRgba(buffer: Buffer): Promise<RgbaImage> {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    channels: decoded.info.channels,
  };
}

function decodePngDataUrl(value: unknown): Buffer {
  const match = String(value).match(/^data:image\/png;base64,([\s\S]+)$/);
  expect(match, 'Painted mask must be a PNG data URL').not.toBeNull();
  return Buffer.from(match![1], 'base64');
}

async function expectMaskedResultContract(
  sourceBuffer: Buffer,
  resultBuffer: Buffer,
  maskValue: unknown,
): Promise<void> {
  const [source, result] = await Promise.all([decodeRgba(sourceBuffer), decodeRgba(resultBuffer)]);
  const mask = await sharp(decodePngDataUrl(maskValue))
    .resize(source.width, source.height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({ width: result.width, height: result.height }).toEqual({ width: source.width, height: source.height });

  let exteriorPixels = 0;
  let changedExteriorPixels = 0;
  let paintedPixels = 0;
  let changedPaintedPixels = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const offset = pixel * source.channels;
    const changed = [0, 1, 2, 3].some((channel) => source.data[offset + channel] !== result.data[offset + channel]);
    if (mask.data[pixel] <= 5) {
      exteriorPixels += 1;
      if (changed) changedExteriorPixels += 1;
    }
    if (mask.data[pixel] >= 250) {
      paintedPixels += 1;
      if (changed) changedPaintedPixels += 1;
    }
  }
  expect(exteriorPixels, 'The stroke must leave a measurable exterior region').toBeGreaterThan(0);
  expect(changedExteriorPixels, 'Pixels outside the painted mask must remain byte-identical').toBe(0);
  expect(paintedPixels, 'The submitted mask must contain a painted region').toBeGreaterThan(0);
  expect(changedPaintedPixels, 'The completed edit must change at least one painted pixel').toBeGreaterThan(0);
}

test.describe('Image toolbar real editing flows', () => {
  test.skip(
    !username || !password,
    'UNVERIFIED: E2E_TEST_USERNAME and E2E_TEST_PASSWORD are required for real image-toolbar browser tests.',
  );

  test('remove background returns a genuinely transparent PNG', async ({ page }, testInfo) => {
    test.skip(
      !enableRealRemoveBackground,
      'UNVERIFIED: set E2E_ENABLE_REAL_REMOVE_BACKGROUND=1 only when a real remove-background engine is configured.',
    );
    test.setTimeout(420_000);

    await capture(page, testInfo, 'image-toolbar-remove-background-transparent-png', async () => {
      await loginAndCreateProject(page);
      const { sourceUrl } = await uploadAndSelectSource(page);
      const beforeCount = await canvasImages(page).count();
      await openToolbarAction(page, '移除背景');
      await expect(page.getByText('选择去背景模型', { exact: true })).toBeVisible();
      const submitted = await captureJsonPost(page, '/api/image-edit', () => (
        page.getByRole('button', { name: '开始去背景', exact: true }).click()
      ));
      expect(submitted.body).toMatchObject({ action: 'remove_background', imageUrl: sourceUrl });
      const resultUrl = await waitForNewCompletedImage(page, beforeCount, sourceUrl);
      const resultBuffer = await fetchImageBuffer(page, resultUrl);
      const metadata = await sharp(resultBuffer).metadata();
      expect(metadata.format, 'Remove-background output must be PNG').toBe('png');
      expect(metadata.hasAlpha, 'Remove-background output must contain an alpha channel').toBe(true);
      const { data, info } = await sharp(resultBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let transparentPixels = 0;
      for (let index = info.channels - 1; index < data.length; index += info.channels) {
        if (data[index] < 255) transparentPixels += 1;
      }
      expect(transparentPixels, 'Checkerboard RGB pixels do not count; at least one decoded alpha value must be below 255').toBeGreaterThan(0);
    });
  });

  test('erase draws a real stroke and completes one explicit erase request', async ({ page }, testInfo) => {
    test.skip(
      !enablePaidImageEditing,
      'UNVERIFIED: set E2E_ENABLE_PAID_IMAGE_EDITING=1 to authorize the real provider-backed erase operation.',
    );
    test.setTimeout(420_000);

    await capture(page, testInfo, 'image-toolbar-erase-completed', async () => {
      await loginAndCreateProject(page);
      const { sourceUrl } = await uploadAndSelectSource(page);
      const sourceBuffer = await fetchImageBuffer(page, sourceUrl);
      const beforeCount = await canvasImages(page).count();
      await page.getByTestId('canvas-erase').click();
      await expect(page.getByText('擦除', { exact: true }).last()).toBeVisible();
      await drawStroke(page, '擦除');

      const submit = page.getByRole('button', { name: '开始擦除', exact: true });
      await expect(submit).toBeEnabled();
      const submitted = await captureJsonPost(page, '/api/image-edit', () => submit.click());
      expect(submitted.body).toMatchObject({
        action: 'inpaint',
        editMode: 'erase',
        imageUrl: sourceUrl,
      });
      expect(String(submitted.body.maskImage)).toMatch(/^data:image\/png;base64,/);
      const resultUrl = await waitForNewCompletedImage(page, beforeCount, sourceUrl);
      await expectMaskedResultContract(sourceBuffer, await fetchImageBuffer(page, resultUrl), submitted.body.maskImage);
    });
  });

  test('mask edit submits the painted mask and prompt and completes', async ({ page }, testInfo) => {
    test.skip(
      !enablePaidImageEditing,
      'UNVERIFIED: set E2E_ENABLE_PAID_IMAGE_EDITING=1 to authorize the real provider-backed mask edit.',
    );
    test.setTimeout(420_000);

    await capture(page, testInfo, 'image-toolbar-mask-edit-completed', async () => {
      await loginAndCreateProject(page);
      const { sourceUrl } = await uploadAndSelectSource(page);
      const sourceBuffer = await fetchImageBuffer(page, sourceUrl);
      const beforeCount = await canvasImages(page).count();
      await page.getByTestId('canvas-mask-edit').click();
      await expect(page.getByText('蒙版修图', { exact: true })).toBeVisible();
      await drawStroke(page, '蒙版修图');
      const prompt = 'Replace only the painted region with a clean cobalt-blue geometric detail';
      await page.getByPlaceholder('描述修改内容...').fill(prompt);

      const submit = page.getByRole('button', { name: '开始修复', exact: true });
      await expect(submit).toBeEnabled();
      const submitted = await captureJsonPost(page, '/api/image-edit', () => submit.click());
      expect(submitted.body).toMatchObject({
        action: 'inpaint',
        editMode: 'mask',
        imageUrl: sourceUrl,
        prompt,
      });
      expect(String(submitted.body.maskImage)).toMatch(/^data:image\/png;base64,/);
      const resultUrl = await waitForNewCompletedImage(page, beforeCount, sourceUrl);
      await expectMaskedResultContract(sourceBuffer, await fetchImageBuffer(page, resultUrl), submitted.body.maskImage);
    });
  });

  test('color adjustment previews a non-neutral value and adds a distinct result', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await capture(page, testInfo, 'image-toolbar-color-adjust-completed', async () => {
      await loginAndCreateProject(page);
      const { sourceUrl } = await uploadAndSelectSource(page);
      const sourceBuffer = await fetchImageBuffer(page, sourceUrl);
      const beforeCount = await canvasImages(page).count();
      await page.getByTestId('canvas-color-adjust').click();
      const panel = page.getByText('参数调色', { exact: true }).locator('..').locator('..').locator('..');
      await expect(panel).toBeVisible();
      const preview = panel.getByRole('img', { name: '预览' });
      const initialFilter = await preview.getAttribute('style');
      const brightness = panel.locator('input[type="range"]').first();
      await brightness.fill('35');
      await expect(panel.getByText('+35', { exact: true })).toBeVisible();
      await expect.poll(() => preview.getAttribute('style')).not.toBe(initialFilter);

      const responsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/image/color-adjust') && response.request().method() === 'POST'
      ));
      const submittedPromise = captureJsonPost(page, '/api/image/color-adjust', () => (
        panel.getByRole('button', { name: '应用调色', exact: true }).click()
      ));
      const [response, submitted] = await Promise.all([responsePromise, submittedPromise]);
      expect(response.ok(), `Color-adjust request failed with ${response.status()}`).toBeTruthy();
      expect(submitted.body).toMatchObject({
        imageUrl: sourceUrl,
        params: { brightness: 35 },
      });
      const resultUrl = await waitForNewCompletedImage(page, beforeCount, sourceUrl, 120_000);
      expect(resultUrl).not.toBe(sourceUrl);
      const [sourcePixels, resultPixels] = await Promise.all([
        decodeRgba(sourceBuffer),
        decodeRgba(await fetchImageBuffer(page, resultUrl)),
      ]);
      expect({ width: resultPixels.width, height: resultPixels.height }).toEqual({ width: sourcePixels.width, height: sourcePixels.height });
      let rgbChanges = 0;
      for (let offset = 0; offset < sourcePixels.data.length; offset += 4) {
        expect(resultPixels.data[offset + 3], 'Color adjustment must preserve alpha byte-for-byte').toBe(sourcePixels.data[offset + 3]);
        if (
          resultPixels.data[offset] !== sourcePixels.data[offset]
          || resultPixels.data[offset + 1] !== sourcePixels.data[offset + 1]
          || resultPixels.data[offset + 2] !== sourcePixels.data[offset + 2]
        ) rgbChanges += 1;
      }
      expect(rgbChanges, 'A non-neutral color adjustment must change decoded RGB pixels').toBeGreaterThan(0);
    });
  });
});
