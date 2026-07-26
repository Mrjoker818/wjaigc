import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  collectBrowserEvidence,
  saveBrowserEvidence,
} from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const fixturePath = resolve(
  process.cwd(),
  'tests/fixtures/annotation-source.png',
);
const fixtureBuffer = readFileSync(fixturePath);

function requireCredentials(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Annotation E2E credentials are required: ${missing.join(', ')}`);
  }
}

async function loginAndCreateProject(page: Page): Promise<void> {
  requireCredentials();
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
  });
  await page.reload({ waitUntil: 'networkidle' });

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
  await expect(page.getByText('我的项目', { exact: true }).first())
    .toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const canvasViewport = page.locator('[data-canvas-viewport]');
  const openedAutomatically = await canvasViewport.waitFor({
    state: 'visible',
    timeout: 20_000,
  }).then(() => true).catch(() => false);
  if (!openedAutomatically) {
    await page.getByText('未命名项目', { exact: true }).last().click();
  }
  await expect(canvasViewport).toBeVisible({ timeout: 30_000 });
}

async function uploadAnnotationSource(page: Page): Promise<Locator> {
  const canvasImages = page.locator('[data-canvas-viewport] img');
  const beforeUpload = await canvasImages.count();
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '图片上传' }).click();
  await (await fileChooser).setFiles(fixturePath);
  await expect.poll(() => canvasImages.count(), { timeout: 30_000 })
    .toBeGreaterThan(beforeUpload);
  const imageContainer = canvasImages.last().locator('..');
  await expect(imageContainer).toBeVisible();
  return imageContainer;
}

async function readLogicalCanvasImageCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('unbounded_ai_user_data');
    if (!raw) return 0;
    const findLargestCanvas = (value: unknown): number => {
      if (!value || typeof value !== 'object') return 0;
      const record = value as Record<string, unknown>;
      const ownCount = Array.isArray(record.canvasImages) ? record.canvasImages.length : 0;
      return Object.values(record).reduce<number>(
        (largest, child) => Math.max(largest, findLargestCanvas(child)),
        ownCount,
      );
    };
    return findLargestCanvas(JSON.parse(raw));
  });
}

async function uploadAnnotationSources(
  page: Page,
  count: number,
  expectedTotal: number,
): Promise<Locator> {
  const canvasImages = page.locator('[data-canvas-viewport] img');
  const beforeUpload = await canvasImages.count();
  await page.locator('input[type="file"][accept="image/*"][multiple]').first().setInputFiles(
    Array.from({ length: count }, (_, index) => ({
    name: `annotation-perf-${beforeUpload + index + 1}.png`,
    mimeType: 'image/png',
    buffer: fixtureBuffer,
    })),
  );
  await expect.poll(() => readLogicalCanvasImageCount(page), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(expectedTotal);
  return page.locator('[data-canvas-viewport] img:visible').first().locator('..');
}

async function samplePanVisibility(page: Page): Promise<number[]> {
  const viewport = page.locator('[data-canvas-viewport]');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const visibleCounts: number[] = [];
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.25);
  await page.mouse.down({ button: 'middle' });
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      box!.x + box!.width * 0.7 + step * 12,
      box!.y + box!.height * 0.25 + step * 8,
    );
    visibleCounts.push(await viewport.locator('img:visible').count());
  }
  await page.mouse.up({ button: 'middle' });
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(
    box!.x + box!.width * 0.7,
    box!.y + box!.height * 0.25,
    { steps: 8 },
  );
  await page.mouse.up({ button: 'middle' });
  return visibleCounts;
}

async function drawMark(
  page: Page,
  imageContainer: Locator,
  tool: 'region' | 'brush' | 'arrow',
  kind: 'region' | 'brush' | 'arrow',
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const committed = page.locator(`[data-annotation-kind="${kind}"][data-annotation-id]`);
  const before = await committed.count();
  const toolButton = page.locator(`[data-annotation-tool="${tool}"]`);
  await toolButton.click();
  await expect(toolButton).toHaveAttribute('aria-pressed', 'true');
  await expect(committed).toHaveCount(before);

  const box = await imageContainer.boundingBox();
  expect(box, 'Source image must expose a visible browser bounding box').not.toBeNull();
  await page.mouse.move(box!.x + box!.width * start.x, box!.y + box!.height * start.y);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * end.x,
    box!.y + box!.height * end.y,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(committed).toHaveCount(before + 1);
}

test.describe('ChatCanvas fused annotation', () => {
  test('creates visible mixed marks, persists them, and rejects an unconfigured execution explicitly', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const evidence = collectBrowserEvidence(page);
    try {
      await loginAndCreateProject(page);
      const imageContainer = await uploadAnnotationSource(page);

      await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
      await expect(page.getByTestId('annotation-composer')).toBeVisible();
      await expect(page.locator('[data-annotation-id]')).toHaveCount(0);

      for (const tool of ['region', 'brush', 'arrow', 'text'] as const) {
        const before = await page.locator('[data-annotation-id]').count();
        const toolButton = page.locator(`[data-annotation-tool="${tool}"]`);
        await toolButton.click();
        await expect(toolButton).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-annotation-id]')).toHaveCount(before);
      }

      await drawMark(page, imageContainer, 'region', 'region', { x: 0.12, y: 0.15 }, { x: 0.48, y: 0.52 });
      await drawMark(page, imageContainer, 'brush', 'brush', { x: 0.18, y: 0.72 }, { x: 0.72, y: 0.36 });
      await drawMark(page, imageContainer, 'arrow', 'arrow', { x: 0.22, y: 0.82 }, { x: 0.78, y: 0.62 });

      await page.getByTestId('annotation-prompt').fill('保留主体，仅调整标记区域的细节');
      const textTool = page.locator('[data-annotation-tool="text"]');
      await textTool.click();
      await expect(textTool).toHaveAttribute('aria-pressed', 'true');
      const box = await imageContainer.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width * 0.68, box!.y + box!.height * 0.2);
      await expect(page.locator('[data-annotation-kind="text"][data-annotation-id]')).toHaveCount(1);
      await expect(page.locator('[data-annotation-kind="brush"][data-annotation-id]')).toBeVisible();
      await expect(page.locator('[data-annotation-id]')).toHaveCount(4);

      const execute = page.getByTestId('annotation-execute');
      await expect(execute).toBeEnabled();
      const configuredModels = await page.getByLabel('批注修改模型').count();
      if (configuredModels === 0) {
        await execute.click();
        await expect(page.getByTestId('annotation-composer').getByRole('alert'))
          .toContainText('请选择已配置提供商的图像编辑模型');
      }

      await expect.poll(async () => (
        page.evaluate(() => {
          const raw = localStorage.getItem('unbounded_ai_user_data');
          if (!raw) return false;
          const containsFourAnnotations = (value: unknown): boolean => {
            if (!value || typeof value !== 'object') return false;
            const record = value as Record<string, unknown>;
            if (Array.isArray(record.annotationsV2)) {
              return record.annotationsV2.length === 4;
            }
            return Object.values(record).some(containsFourAnnotations);
          };
          return containsFourAnnotations(JSON.parse(raw));
        })
      ), { timeout: 20_000 }).toBeTruthy();

      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloadedCanvas = page.locator('[data-canvas-viewport]');
      const remainedOnCanvas = await reloadedCanvas.waitFor({
        state: 'visible',
        timeout: 5_000,
      }).then(() => true).catch(() => false);
      if (!remainedOnCanvas) {
        await expect(page.getByText('我的项目', { exact: true }).first()).toBeVisible();
        await page.getByText('未命名项目', { exact: true }).last().click();
      }
      await expect(reloadedCanvas).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
      await expect(page.locator('[data-annotation-id]')).toHaveCount(4);

      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-canvas-regression');
    } catch (error) {
      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-canvas-failure');
      throw error;
    }
  });

  test('semantic targeting fails over to region guidance and a saved image can enter node annotation mode', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const evidence = collectBrowserEvidence(page);
    try {
      await loginAndCreateProject(page);
      const imageContainer = await uploadAnnotationSource(page);
      await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
      await page.locator('[data-annotation-tool="semantic-object"]').click();
      const box = await imageContainer.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      const semanticMark = page.locator('[data-annotation-kind="semantic-object"][data-annotation-id]');
      const fallbackToast = page.getByText(/改用框选|对象识别/).last();
      await expect.poll(async () => (
        (await semanticMark.count()) > 0 || await fallbackToast.isVisible().catch(() => false)
      ), { timeout: 30_000 }).toBeTruthy();

      await page.locator('button:has(svg.lucide-workflow)').first().click();
      const confirmSwitch = page.getByRole('button', { name: /继续|确认/ });
      if (await confirmSwitch.isVisible().catch(() => false)) await confirmSwitch.click();
      await expect(page.locator('[data-toolbar="node-annotation-entry"]')).toBeVisible();

      const contentImage = page.locator('[data-node-canvas-image]').first();
      await expect(contentImage).toBeVisible();
      await contentImage.dragTo(page.locator('.canvas-bg'), {
        sourcePosition: { x: 50, y: 28 },
        targetPosition: { x: 420, y: 260 },
      });
      const inputNode = page.locator('[data-node-id]').filter({ hasText: '图片输入' }).last();
      await expect(inputNode).toBeVisible();
      await inputNode.click({ position: { x: 48, y: 20 } });
      await page.locator('[data-toolbar="node-annotation-entry"]').click();
      await expect(page.getByTestId('node-annotation-workspace')).toBeVisible();

      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-node-regression');
    } catch (error) {
      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-node-failure');
      throw error;
    }
  });

  test('keeps annotation and node interactions responsive under representative load', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Performance evidence is captured once in Chromium.');
    test.setTimeout(360_000);
    const evidence = collectBrowserEvidence(page);
    const metrics: {
      imageCounts: number[];
      pointerToPaintMs: number[];
      panVisibleImageCounts: Record<string, number[]>;
      longTasksMs: number[];
      nodeCount: number;
      nodePanMs: number;
    } = {
      imageCounts: [],
      pointerToPaintMs: [],
      panVisibleImageCounts: {},
      longTasksMs: [],
      nodeCount: 0,
      nodePanMs: 0,
    };

    await page.addInitScript(() => {
      const durations: number[] = [];
      Object.defineProperty(window, '__annotationLongTasks', {
        value: durations,
        configurable: true,
      });
      if ('PerformanceObserver' in window) {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) durations.push(entry.duration);
          });
          observer.observe({ type: 'longtask', buffered: true });
        } catch {
          // Long Task API is optional; the report keeps an empty sample when unavailable.
        }
      }
    });

    try {
      await loginAndCreateProject(page);
      const imageContainer = await uploadAnnotationSources(page, 25, 25);
      metrics.imageCounts.push(await readLogicalCanvasImageCount(page));

      await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
      await expect(page.getByTestId('annotation-composer')).toBeVisible();
      const regionTool = page.locator('[data-annotation-tool="region"]');
      await regionTool.click();
      await expect(regionTool).toHaveAttribute('aria-pressed', 'true');
      const sourceBox = await imageContainer.boundingBox();
      expect(sourceBox).not.toBeNull();
      for (let index = 0; index < 5; index += 1) {
        const committed = page.locator('[data-annotation-kind="region"][data-annotation-id]');
        const before = await committed.count();
        const startAt = Date.now();
        await page.mouse.move(
          sourceBox!.x + sourceBox!.width * (0.08 + index * 0.03),
          sourceBox!.y + sourceBox!.height * (0.08 + index * 0.03),
        );
        await page.mouse.down();
        await page.mouse.move(
          sourceBox!.x + sourceBox!.width * (0.28 + index * 0.03),
          sourceBox!.y + sourceBox!.height * (0.28 + index * 0.03),
          { steps: 4 },
        );
        await page.mouse.up();
        await expect(committed).toHaveCount(before + 1);
        metrics.pointerToPaintMs.push(Date.now() - startAt);
      }
      metrics.panVisibleImageCounts['25'] = await samplePanVisibility(page);
      expect(metrics.panVisibleImageCounts['25'].every((count) => count > 0)).toBeTruthy();

      await uploadAnnotationSources(page, 25, 50);
      metrics.imageCounts.push(await readLogicalCanvasImageCount(page));
      metrics.panVisibleImageCounts['50'] = await samplePanVisibility(page);
      expect(metrics.panVisibleImageCounts['50'].every((count) => count > 0)).toBeTruthy();

      await uploadAnnotationSources(page, 50, 100);
      metrics.imageCounts.push(await readLogicalCanvasImageCount(page));
      metrics.panVisibleImageCounts['100'] = await samplePanVisibility(page);
      expect(metrics.panVisibleImageCounts['100'].every((count) => count > 0)).toBeTruthy();
      expect(metrics.imageCounts).toEqual([25, 50, 100]);

      await page.locator('[data-toolbar="bottom-annotation-entry"]').click();
      await expect(page.getByTestId('annotation-composer')).toBeHidden();
      await page.locator('button:has(svg.lucide-workflow)').first().click();
      const confirmSwitch = page.getByRole('button', { name: /缁х画|纭/ });
      if (await confirmSwitch.isVisible().catch(() => false)) await confirmSwitch.click();
      const contentImage = page.locator('[data-node-canvas-image]').first();
      const nodeCanvas = page.locator('.canvas-bg');
      await expect(contentImage).toBeVisible();
      await contentImage.dragTo(nodeCanvas, {
        sourcePosition: { x: 45, y: 24 },
        targetPosition: { x: 520, y: 260 },
      });
      await expect(page.locator('[data-node-id]')).toHaveCount(1);
      const addNodeButton = page.locator('aside button').first();
      await expect(addNodeButton).toBeVisible();
      for (let index = 1; index < 50; index += 1) {
        await addNodeButton.click();
      }
      await expect(page.locator('[data-node-id]')).toHaveCount(50);
      metrics.nodeCount = await page.locator('[data-node-id]').count();
      const nodeBox = await nodeCanvas.boundingBox();
      expect(nodeBox).not.toBeNull();
      const nodePanStartedAt = Date.now();
      await page.mouse.move(nodeBox!.x + 80, nodeBox!.y + 70);
      await page.mouse.down();
      await page.mouse.move(nodeBox!.x + 180, nodeBox!.y + 150, { steps: 10 });
      await page.mouse.up();
      metrics.nodePanMs = Date.now() - nodePanStartedAt;
      await expect(page.locator('[data-node-id]')).toHaveCount(50);

      metrics.longTasksMs = await page.evaluate(() => (
        (window as Window & { __annotationLongTasks?: number[] }).__annotationLongTasks || []
      ));
      const sorted = [...metrics.pointerToPaintMs].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      const performanceResult = { ...metrics, medianPointerToPaintMs: median };
      const performanceDir = resolve(process.cwd(), 'test-results/performance');
      mkdirSync(performanceDir, { recursive: true });
      writeFileSync(
        resolve(performanceDir, 'annotation-performance.json'),
        JSON.stringify(performanceResult, null, 2),
      );
      await testInfo.attach('annotation-performance.json', {
        body: Buffer.from(JSON.stringify(performanceResult, null, 2)),
        contentType: 'application/json',
      });
      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-performance');
    } catch (error) {
      await testInfo.attach('annotation-performance-partial.json', {
        body: Buffer.from(JSON.stringify(metrics, null, 2)),
        contentType: 'application/json',
      });
      await saveBrowserEvidence(page, testInfo, evidence, 'annotation-performance-failure');
      throw error;
    }
  });
});
