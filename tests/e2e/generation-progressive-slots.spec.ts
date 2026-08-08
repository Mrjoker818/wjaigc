import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';

const BATCH_ID = 'e2e-progressive-batch';
const TASK_IDS = ['e2e-slot-task-1', 'e2e-slot-task-2', 'e2e-slot-task-3', 'e2e-slot-task-4'];
const RESULT_PATHS = TASK_IDS.map((_, index) => `/api/serve-upload/e2e-progressive-slot-${index + 1}.png`);
const CONTROLLED_USER = {
  id: 'e2e-progressive-user',
  name: 'Task 5 Browser',
  role: 'user',
  status: 'active',
  productType: 'canvas',
  imageModels: ['e2e-provider::e2e-image-model'],
  chatModels: [],
  createdAt: 1,
  updatedAt: 1,
};

interface PollRequestBody {
  taskId?: string;
}

async function createSlotPng(slotIndex: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: {
        r: 40 + slotIndex * 40,
        g: 200 - slotIndex * 30,
        b: 80 + slotIndex * 20,
        alpha: 1,
      },
    },
  }).png().toBuffer();
}

async function openWorkspaceAndCreateProject(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    const marker = 'task-5-controlled-storage-ready';
    if (!sessionStorage.getItem(marker)) {
      localStorage.clear();
      sessionStorage.setItem(marker, '1');
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible();
}

function canonicalSlotPayload(slotIndex: number, status: 'processing' | 'completed') {
  return {
    success: true,
    batchId: BATCH_ID,
    slotId: `${BATCH_ID}:${slotIndex}`,
    slotIndex,
    taskId: TASK_IDS[slotIndex],
    status,
    progress: status === 'completed' ? 100 : 35,
    ...(status === 'completed'
      ? {
          imageUrl: RESULT_PATHS[slotIndex],
          imageUrls: [RESULT_PATHS[slotIndex]],
          modelName: 'E2E controlled model',
          providerName: 'E2E controlled provider',
        }
      : {}),
  };
}

test.describe('durable progressive generation slots', () => {
  test('streams 3,1,4,2 into stable slots and resumes unfinished tasks after reload', async ({ page }) => {
    test.setTimeout(120_000);

    const slotPngs = await Promise.all([0, 1, 2, 3].map(createSlotPng));
    const pollCounts = new Map<string, number>();
    const completionOrder: number[] = [];
    const completedTasks = new Set<string>();
    const syncedUserData = new Map<string, unknown>();
    let allowInitialCompletion = false;
    let allowPostReloadCompletion = false;
    let observeGenerateRequest: () => void = () => {};
    let releaseGenerateResponse: () => void = () => {};
    const generateRequestObserved = new Promise<void>((resolve) => {
      observeGenerateRequest = resolve;
    });
    const generateResponseGate = new Promise<void>((resolve) => {
      releaseGenerateResponse = resolve;
    });

    await page.route('**/api/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: CONTROLLED_USER }),
      });
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: CONTROLLED_USER }),
      });
    });
    await page.route('**/api/user-data/sync*', async (route) => {
      if (route.request().method() === 'GET') {
        const key = new URL(route.request().url()).searchParams.get('key') || '';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            key,
            value: syncedUserData.get(key) ?? null,
          }),
        });
        return;
      }

      const body = route.request().postDataJSON() as { key?: string; value?: unknown } | null;
      if (body?.key) {
        syncedUserData.set(body.key, body.value);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, key: body?.key || '', projectIdMap: {} }),
      });
    });
    await page.route('**/api/tasks/recover*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, tasks: [] }),
      });
    });
    await page.route('**/api/activity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await page.route('**/api/user-data/record', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await page.route('**/api/task-events**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'SSE unavailable in controlled polling test',
      });
    });
    await page.route('**/api/credits/payment-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, configured: false }),
      });
    });
    await page.route('**/api/models?*', async (route) => {
      const type = new URL(route.request().url()).searchParams.get('type');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(type === 'image'
          ? {
              success: true,
              providers: [{ id: 'e2e-provider', name: 'E2E controlled provider' }],
              models: [{
                id: 'e2e-image-model',
                name: 'E2E controlled model',
                providerId: 'e2e-provider',
                type: 'image',
                isDefault: true,
              }],
              taskModelCatalog: [],
              quickCreatePolicy: {},
            }
          : {
              success: true,
              providers: [],
              models: [],
              taskModelCatalog: [],
              quickCreatePolicy: {},
            }),
      });
    });
    await page.route('**/api/generate', async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as { outputCount?: number; n?: number };
      expect(body.outputCount ?? body.n).toBe(4);

      observeGenerateRequest();
      await generateResponseGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mode: 'polling',
          batchId: BATCH_ID,
          taskId: TASK_IDS[0],
          taskIds: TASK_IDS,
          slots: TASK_IDS.map((taskId, slotIndex) => ({
            batchId: BATCH_ID,
            slotId: `${BATCH_ID}:${slotIndex}`,
            slotIndex,
            taskId,
            status: 'processing',
          })),
          estimatedTime: 1,
          modelName: 'E2E controlled model',
          providerName: 'E2E controlled provider',
        }),
      });
    });
    await page.route('**/api/poll-task', async (route) => {
      const body = route.request().postDataJSON() as PollRequestBody;
      const taskId = body.taskId || '';
      const slotIndex = TASK_IDS.indexOf(taskId);
      expect(slotIndex).toBeGreaterThanOrEqual(0);

      const nextCount = (pollCounts.get(taskId) || 0) + 1;
      pollCounts.set(taskId, nextCount);

      const completesBeforeReload = allowInitialCompletion && slotIndex === 2;
      const completesAfterReload = allowPostReloadCompletion && (
        slotIndex === 0
        || (slotIndex === 3 && completedTasks.has(TASK_IDS[0]))
        || (slotIndex === 1 && completedTasks.has(TASK_IDS[3]))
      );
      const shouldComplete = completesBeforeReload || completesAfterReload;

      if (shouldComplete && !completedTasks.has(taskId)) {
        completedTasks.add(taskId);
        completionOrder.push(slotIndex + 1);
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(canonicalSlotPayload(
          slotIndex,
          shouldComplete ? 'completed' : 'processing',
        )),
      });
    });
    for (const [slotIndex, resultPath] of RESULT_PATHS.entries()) {
      await page.route(`**${resultPath}`, async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: slotPngs[slotIndex],
        });
      });
    }

    await openWorkspaceAndCreateProject(page);
    await page.getByRole('button', { name: '专业创作', exact: true }).click();

    const modelSelect = page.locator('select').filter({
      has: page.locator('option[value="e2e-provider::e2e-image-model"]'),
    }).first();
    await expect(modelSelect).toBeVisible();
    await modelSelect.selectOption('e2e-provider::e2e-image-model');

    await page.locator('#gen-prompt-textarea').fill('controlled progressive slot verification');
    await page.getByRole('button', { name: 'x4', exact: true }).click();
    const generateResponse = page.waitForResponse((response) => (
      response.url().includes('/api/generate')
      && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: /开始生成/ }).last().click();
    await generateRequestObserved;

    const canvas = page.locator('[data-canvas-viewport]');
    const processingSlots = canvas.getByRole('status');
    await expect(processingSlots).toHaveCount(4);
    releaseGenerateResponse();
    await generateResponse;
    allowInitialCompletion = true;
    await expect.poll(() => completionOrder).toEqual([3]);
    await expect(canvas.locator(`img[src$="${RESULT_PATHS[2]}"]`)).toHaveCount(1);
    await expect(processingSlots).toHaveCount(3);

    await expect.poll(
      () => {
        const syncedProjects = syncedUserData.get('projects');
        if (!Array.isArray(syncedProjects)) return false;
        return syncedProjects.some((project) => {
        if (!project || typeof project !== 'object') return false;
        const canvasImages = (project as { canvasImages?: unknown[] }).canvasImages;
        return Array.isArray(canvasImages) && canvasImages.length === 4;
        });
      },
      { timeout: 15_000, intervals: [500, 1_000] },
    ).toBe(true);
    const syncedProjects = syncedUserData.get('projects') as unknown[];
    const projectId = String((syncedProjects[0] as { id?: string } | undefined)?.id || '');
    expect(projectId).not.toBe('');

    const slotThreePollsBeforeReload = pollCounts.get(TASK_IDS[2]) || 0;
    allowPostReloadCompletion = true;
    await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(`img[src$="${RESULT_PATHS[2]}"]`)).toHaveCount(1);

    await expect.poll(() => completionOrder, {
      timeout: 20_000,
      intervals: [250, 500],
    }).toEqual([3, 1, 4, 2]);
    await expect(processingSlots).toHaveCount(0);

    const resultSources = await canvas.locator('img').evaluateAll(
      (images, expectedPaths) => images
        .map((image) => image.getAttribute('src') || '')
        .filter((src) => expectedPaths.some((path) => src.endsWith(path))),
      RESULT_PATHS,
    );
    expect(resultSources).toHaveLength(4);
    expect(new Set(resultSources).size).toBe(4);
    expect(resultSources.map((src) => RESULT_PATHS.findIndex((path) => src.endsWith(path)) + 1))
      .toEqual([1, 2, 3, 4]);
    expect(pollCounts.get(TASK_IDS[2]) || 0).toBe(slotThreePollsBeforeReload);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(canvas).toBeVisible();
    await expect(processingSlots).toHaveCount(0);
    await expect.poll(async () => canvas.locator('img').evaluateAll(
      (images, expectedPaths) => images.filter((image) => {
        const src = image.getAttribute('src') || '';
        return expectedPaths.some((path) => src.endsWith(path));
      }).length,
      RESULT_PATHS,
    )).toBe(4);
  });
});
