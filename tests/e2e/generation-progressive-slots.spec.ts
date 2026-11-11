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
  await expect(page.getByRole('group', { name: '协作文档状态与恢复' })).toBeHidden();
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
          assetProjection: {
            references: [{
              assetId: `e2e-asset-${slotIndex}`,
              assetVersionId: `e2e-version-${slotIndex}`,
              placementId: `e2e-placement-${slotIndex}`,
              url: RESULT_PATHS[slotIndex],
            }],
          },
          modelName: 'E2E controlled model',
          providerName: 'E2E controlled provider',
        }
      : {}),
  };
}

test.describe('durable progressive generation slots', () => {
  test('streams 3,1,4,2 into stable slots and resumes unfinished tasks after reload', async ({ page: originalPage, context }) => {
    let page = originalPage;
    let reopenedPage: Page | null = null;
    test.setTimeout(120_000);

    const slotPngs = await Promise.all([0, 1, 2, 3].map(createSlotPng));
    const pollCounts = new Map<string, number>();
    const completionOrder: number[] = [];
    const completedTasks = new Set<string>();
    const syncedUserData = new Map<string, unknown>();
    let projectRevision = 0;
    let allowInitialCompletion = false;
    let generationRequests = 0;
    let observeOwnerStatus: () => void = () => {};
    let releaseOwnerStatus: () => void = () => {};
    const ownerStatusObserved = new Promise<void>((resolve) => { observeOwnerStatus = resolve; });
    const ownerStatusGate = new Promise<void>((resolve) => { releaseOwnerStatus = resolve; });
    const resumedPollCounts = new Map<string, number>();
    const resumedTerminalCounts = new Map<string, number>();
    let observeGenerateRequest: () => void = () => {};
    let releaseGenerateResponse: () => void = () => {};
    const generateRequestObserved = new Promise<void>((resolve) => {
      observeGenerateRequest = resolve;
    });
    const generateResponseGate = new Promise<void>((resolve) => {
      releaseGenerateResponse = resolve;
    });

    await context.route('**/api/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: CONTROLLED_USER }),
      });
    });
    await context.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: CONTROLLED_USER }),
      });
    });
    await context.route('**/api/user-data/sync*', async (route) => {
      if (route.request().method() === 'GET') {
        const key = new URL(route.request().url()).searchParams.get('key') || '';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            key,
            value: syncedUserData.get(key) ?? (key === 'projects' ? [] : null),
            ...(key === 'projects' ? {
              projectRevision,
              deletedCanvasPlacements: [],
              assetGraphMode: 'legacy',
              canvasKernelMode: 'legacy',
              workflowRendererMode: 'legacy',
            } : {}),
          }),
        });
        return;
      }

      const body = route.request().postDataJSON() as { key?: string; value?: unknown } | null;
      if (body?.key) {
        syncedUserData.set(body.key, body.value);
        if (body.key === 'projects') projectRevision++;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, key: body?.key || '', projectIdMap: {}, projectRevision }),
      });
    });
    await context.route('**/api/collaboration/document-enable?*', async (route) => {
      const projectId = new URL(route.request().url()).searchParams.get('projectId');
      expect(route.request().method()).toBe('GET');
      expect(route.request().headers()['x-wujie-expected-actor-id']).toBe(CONTROLLED_USER.id);
      if (route.request().frame().page() === reopenedPage) {
        observeOwnerStatus();
        await ownerStatusGate;
      }
      await route.fulfill({
        json: { success: true, projectId, featureEnabled: false, enabled: false, currentRevision: projectRevision },
      });
    });
    await context.route('**/api/tasks/recover*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, tasks: [] }),
      });
    });
    await context.route('**/api/activity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await context.route('**/api/user-data/record', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    await context.route('**/api/task-events**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'SSE unavailable in controlled polling test',
      });
    });
    await context.route('**/api/credits/payment-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, configured: false }),
      });
    });
    await context.route('**/api/models?*', async (route) => {
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
              capabilityCatalogVersion: 1,
              taskModelCatalog: [{
                providerId: 'e2e-provider',
                modelId: 'e2e-image-model',
                kind: 'image',
                sourceType: 'image',
                protocol: 'openai',
                executionMode: 'async',
                allowedRatios: ['1:1', '16:9'],
                allowedSizes: ['1024x1024'],
                qualityOptions: ['standard'],
                maxOutputs: 4,
                supportsReferenceImages: false,
                supportsMask: false,
                supportedOperations: ['text-to-image'],
                outputKinds: ['image'],
                capabilitySources: {},
              }],
              quickCreatePolicy: {},
            }
          : {
              success: true,
              providers: [],
              models: [],
              capabilityCatalogVersion: 1,
              taskModelCatalog: [],
              quickCreatePolicy: {},
            }),
      });
    });
    await context.route('**/api/generate', async (route) => {
      generationRequests++;
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
    await context.route('**/api/poll-task', async (route) => {
      const body = route.request().postDataJSON() as PollRequestBody;
      const taskId = body.taskId || '';
      const slotIndex = TASK_IDS.indexOf(taskId);
      expect(slotIndex).toBeGreaterThanOrEqual(0);

      const nextCount = (pollCounts.get(taskId) || 0) + 1;
      pollCounts.set(taskId, nextCount);

      const resumed = route.request().frame().page() === reopenedPage;
      if (resumed) resumedPollCounts.set(taskId, (resumedPollCounts.get(taskId) || 0) + 1);
      const completesBeforeReload = allowInitialCompletion && slotIndex === 2;
      const completesAfterReload = resumed && (
        slotIndex === 0
        || (slotIndex === 3 && completedTasks.has(TASK_IDS[0]))
        || (slotIndex === 1 && completedTasks.has(TASK_IDS[3]))
      );
      const shouldComplete = completesBeforeReload || completesAfterReload;

      if (completesAfterReload) {
        resumedTerminalCounts.set(taskId, (resumedTerminalCounts.get(taskId) || 0) + 1);
      }
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
      await context.route(`**${resultPath}`, async (route: Route) => {
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

    let canvas = page.locator('[data-canvas-viewport]');
    let processingSlots = canvas.getByRole('status');
    await expect(processingSlots).toHaveCount(4);
    releaseGenerateResponse();
    await generateResponse;
    allowInitialCompletion = true;
    await expect.poll(() => completionOrder).toEqual([3]);
    await expect(processingSlots).toHaveCount(3);

    await expect.poll(
      () => {
        const syncedProjects = syncedUserData.get('projects');
        if (!Array.isArray(syncedProjects)) return false;
        return syncedProjects.some((project) => {
          if (!project || typeof project !== 'object') return false;
          const canvasImages = (project as { canvasImages?: Array<Record<string, unknown>> }).canvasImages;
          if (!Array.isArray(canvasImages) || canvasImages.length !== 4) return false;
          const completedSlot = canvasImages.find((image) => image.url === RESULT_PATHS[2]);
          return completedSlot?.isProcessingPlaceholder === false
            && (completedSlot.taskProjection as { status?: string } | undefined)?.status === 'completed'
            && canvasImages.filter((image) => image.isProcessingPlaceholder === true).length === 3;
        });
      },
      { timeout: 15_000, intervals: [500, 1_000] },
    ).toBe(true);
    await page.getByTitle('重置视图').click();
    await expect(canvas.locator(`img[src$="${RESULT_PATHS[2]}"]`)).toHaveCount(1);
    const syncedProjects = syncedUserData.get('projects') as unknown[];
    const projectId = String((syncedProjects[0] as { id?: string } | undefined)?.id || '');
    expect(projectId).not.toBe('');

    const slotThreePollsBeforeReload = pollCounts.get(TASK_IDS[2]) || 0;
    await page.close();
    reopenedPage = await context.newPage();
    page = reopenedPage;
    await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
    canvas = page.locator('[data-canvas-viewport]');
    processingSlots = canvas.getByRole('status');
    await expect(canvas).toBeVisible();
    try {
      await ownerStatusObserved;
      await expect(processingSlots).toHaveCount(3);
      await expect(page.getByText('正在确认协作状态', { exact: true })).toBeVisible();
      expect(resumedPollCounts.size).toBe(0);
    } finally {
      releaseOwnerStatus();
    }
    await expect(page.getByRole('group', { name: '协作文档状态与恢复' })).toBeHidden();
    await page.getByTitle('重置视图').click();
    await expect(canvas.locator(`img[src$="${RESULT_PATHS[2]}"]`)).toHaveCount(1);

    await expect.poll(() => completionOrder, {
      timeout: 20_000,
      intervals: [250, 500],
    }).toEqual([3, 1, 4, 2]);
    await expect(processingSlots).toHaveCount(0);
    await page.getByTitle('重置视图').click();

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
    await page.getByTitle('重置视图').click();
    await expect.poll(async () => canvas.locator('img').evaluateAll(
      (images, expectedPaths) => images.filter((image) => {
        const src = image.getAttribute('src') || '';
        return expectedPaths.some((path) => src.endsWith(path));
      }).length,
      RESULT_PATHS,
    )).toBe(4);
    expect(generationRequests).toBe(1);
    expect([...resumedTerminalCounts.entries()]).toEqual([
      [TASK_IDS[0], 1],
      [TASK_IDS[3], 1],
      [TASK_IDS[1], 1],
    ]);
  });
});
