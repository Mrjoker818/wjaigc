import {
  apiJson,
  assertSingleNewProjectPlacement,
  canvasImageCard,
  canvasImageByUrl,
  cleanupNewProjectPlacements,
  ensurePlacementRestored,
  expect,
  imageByUrl,
  loginRealUser,
  openCanvasProject,
  readProjects,
  requireStage2ProjectValue,
  stage2PlacementBaseline,
  test,
  validateStage2ProjectIsolation,
} from '../helpers/stage-2-e2e';

async function recordJsonResponse(response: import('@playwright/test').Response, record: (payload: unknown) => void): Promise<Record<string, unknown>> {
  expect(response.ok(), `${response.url()} returned HTTP ${response.status()}`).toBeTruthy();
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  record(payload);
  return payload;
}

function expectTransfer(payload: Record<string, unknown>): { assetId: string; assetVersionId: string; placementId: string; entityId: string; url: string } {
  expect(typeof payload.assetId === 'string' && payload.assetId.length > 0).toBe(true);
  expect(typeof payload.assetVersionId === 'string' && payload.assetVersionId.length > 0).toBe(true);
  expect(typeof payload.placementId === 'string' && payload.placementId.length > 0).toBe(true);
  expect(typeof payload.entityId === 'string' && payload.entityId.length > 0).toBe(true);
  expect(typeof payload.url === 'string' && payload.url.length > 0).toBe(true);
  return payload as { assetId: string; assetVersionId: string; placementId: string; entityId: string; url: string };
}

function observeProjectGraphSaves(
  page: import('@playwright/test').Page,
  projectId: string,
): {
  waitFor(expected: { entityId: string; assetVersionId: string; placementId: string }, timeout?: number): Promise<void>;
  dispose(): void;
} {
  const matches = new Set<string>();
  const keyOf = (value: { entityId: string; assetVersionId: string; placementId: string }) => (
    `${value.entityId}:${value.assetVersionId}:${value.placementId}`
  );
  const handler = (response: import('@playwright/test').Response) => {
    void (async () => {
      if (!response.url().includes('/api/user-data/sync') || response.request().method() !== 'POST' || !response.ok()) return;
      const request = response.request().postDataJSON() as Record<string, unknown> | null;
      if (request?.key !== 'projects') return;
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      const updates = payload?.assetGraphUpdates as Record<string, unknown> | undefined;
      const projectUpdates = updates?.[projectId] as Record<string, unknown> | undefined;
      for (const [entityId, rawUpdate] of Object.entries(projectUpdates || {})) {
        const update = rawUpdate as Record<string, unknown>;
        if (typeof update.versionId === 'string' && typeof update.placementId === 'string') {
          matches.add(keyOf({ entityId, assetVersionId: update.versionId, placementId: update.placementId }));
        }
      }
    })();
  };
  page.on('response', handler);
  return {
    async waitFor(expected, timeout = 30_000) {
      await expect.poll(() => matches.has(keyOf(expected)), { timeout }).toBe(true);
    },
    dispose() { page.off('response', handler); },
  };
}

test.use({ trace: 'off', video: 'on' });
validateStage2ProjectIsolation(process.env);

test.describe('Stage 2 cross-workspace flows', () => {
  test('bridges a real embedded-chat result back onto the canvas through the UI', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_EMBEDDED_CHAT_PROJECT_IDS');
    const sourceUrl = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_EMBEDDED_CHAT_SOURCE_URLS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const originalProject = snapshot.projects.find(project => project.id === projectId);
    expect(originalProject).toBeTruthy();
    const placementBaseline = await stage2PlacementBaseline(page, stage2Evidence, projectId);
    await openCanvasProject(page, projectId);
    const expandPanel = page.getByRole('button', { name: '展开面板', exact: true });
    if (await expandPanel.isVisible().catch(() => false)) await expandPanel.click();
    await page.getByText('AI聊天', { exact: true }).click();
    const sourceImage = await imageByUrl(page, 'img[src]', sourceUrl);
    const addButton = sourceImage.locator('xpath=ancestor::div[.//button[@aria-label="添加到画布"]][1]').getByRole('button', { name: '添加到画布', exact: true });
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const placementIds = new Set<string>();
    const saves = observeProjectGraphSaves(page, projectId);
    try {
      const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
      await addButton.click();
      const payload = await recordJsonResponse(await transfer, value => stage2Evidence.recordPayload(value));
      if (typeof payload.placementId === 'string') placementIds.add(payload.placementId);
      const created = expectTransfer(payload);
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible();
      await saves.waitFor(created);
      await assertSingleNewProjectPlacement(placementBaseline, projectId, created);
    } finally {
      saves.dispose();
      await cleanupNewProjectPlacements(page, stage2Evidence, originalProject!, placementIds, placementBaseline);
    }
  });

  test('runs a seeded workflow through the node-mode UI and returns its real output to canvas', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_WORKFLOW_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const originalProject = snapshot.projects.find(project => project.id === projectId);
    expect(originalProject).toBeTruthy();
    const placementBaseline = await stage2PlacementBaseline(page, stage2Evidence, projectId);
    await openCanvasProject(page, projectId);
    await page.getByTitle('节点模式').first().click();
    const execute = page.getByRole('button', { name: '执行工作流', exact: true });
    await expect(execute).toBeVisible({ timeout: 20_000 });
    const placementIds = new Set<string>();
    const saves = observeProjectGraphSaves(page, projectId);
    try {
      const started = page.waitForResponse(response => response.url().includes('/api/workflow/execute') && response.request().method() === 'POST');
      const outputTransfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST', { timeout: 180_000 });
      await execute.click();
      const startedPayload = await recordJsonResponse(await started, payload => stage2Evidence.recordPayload(payload));
      expect(Object.entries(startedPayload).some(([key, value]) => /(?:task|execution)_?id/i.test(key) && typeof value === 'string' && value.length > 0)).toBe(true);
      const payload = await recordJsonResponse(await outputTransfer, value => stage2Evidence.recordPayload(value));
      if (typeof payload.placementId === 'string') placementIds.add(payload.placementId);
      const created = expectTransfer(payload);
      const back = page.getByRole('button', { name: '返回画布', exact: true });
      await expect(back).toBeVisible();
      await back.click();
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible();
      await saves.waitFor(created, 180_000);
      await assertSingleNewProjectPlacement(placementBaseline, projectId, created);
    } finally {
      saves.dispose();
      await cleanupNewProjectPlacements(page, stage2Evidence, originalProject!, placementIds, placementBaseline);
    }
  });

  test('sends a real standalone-chat result into the designated canvas through the UI', async ({ page, stage2Evidence }, testInfo) => {
    const chatProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_STANDALONE_CHAT_PROJECT_IDS');
    const targetProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_STANDALONE_TARGET_PROJECT_IDS');
    const sourceUrl = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_STANDALONE_SOURCE_URLS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const originalProject = snapshot.projects.find(project => project.id === targetProjectId);
    expect(originalProject).toBeTruthy();
    const placementBaseline = await stage2PlacementBaseline(page, stage2Evidence, targetProjectId);
    await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: '目标画布项目' }).selectOption(targetProjectId);
    const sourceImage = await imageByUrl(page, 'img[src]', sourceUrl);
    const addButton = sourceImage.locator('xpath=ancestor::div[.//button[@title="添加到画布"]][1]').getByTitle('添加到画布');
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const placementIds = new Set<string>();
    const saves = observeProjectGraphSaves(page, targetProjectId);
    try {
      const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
      await addButton.click();
      const payload = await recordJsonResponse(await transfer, value => stage2Evidence.recordPayload(value));
      if (typeof payload.placementId === 'string') placementIds.add(payload.placementId);
      const created = expectTransfer(payload);
      await openCanvasProject(page, targetProjectId);
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible({ timeout: 20_000 });
      await saves.waitFor(created);
      await assertSingleNewProjectPlacement(placementBaseline, targetProjectId, created);
    } finally {
      saves.dispose();
      await cleanupNewProjectPlacements(page, stage2Evidence, originalProject!, placementIds, placementBaseline);
    }
  });

  test('keeps seeded chat and workflow views usable after deleting only the canvas placement', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_REFERENCE_PROJECT_IDS');
    const chatProjectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_CHAT_PROJECT_IDS');
    const assetId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_ASSET_IDS');
    const versionId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_VERSION_IDS');
    const placementId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_SHARED_PLACEMENT_IDS');
    await loginRealUser(page, stage2Evidence);
    const reference = await apiJson(page, stage2Evidence, 'GET', `/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
    expect(typeof reference.url === 'string' && reference.url.length > 0).toBe(true);
    await openCanvasProject(page, projectId);
    const image = await canvasImageByUrl(page, String(reference.url));
    await expect(image).toBeVisible({ timeout: 20_000 });
    await canvasImageCard(image).click();
    try {
      const deleted = page.waitForResponse(response => response.url().includes(`/api/assets/placements/${placementId}`) && response.request().method() === 'DELETE');
      const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
      await page.getByTestId('selected-image-delete').click();
      const deleteResponse = await deleted;
      const deletePayload = await deleteResponse.json().catch(() => ({})) as Record<string, unknown>;
      stage2Evidence.recordApi('DELETE', deleteResponse.url(), deleteResponse.status(), deletePayload);
      expect(deleteResponse.ok()).toBeTruthy();
      expect(deletePayload.placementTrashed).toBe(true);
      expect(deletePayload.assetTrashed).toBe(false);
      const saveResponse = await saved;
      const savePayload = await saveResponse.json().catch(() => ({}));
      stage2Evidence.recordApi('POST', saveResponse.url(), saveResponse.status(), savePayload);
      expect(saveResponse.ok()).toBeTruthy();
      const missing = await page.request.get(`/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
      const missingPayload = await missing.json().catch(() => ({})) as Record<string, unknown>;
      stage2Evidence.recordApi('GET', missing.url(), missing.status(), missingPayload);
      expect(missing.status()).toBe(404);
      expect(missingPayload.error).toBe('ASSET_NOT_FOUND');
      await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
      await expect(await imageByUrl(page, 'img[src]', String(reference.url))).toBeVisible({ timeout: 20_000 });
      await openCanvasProject(page, projectId);
      await page.getByTitle('节点模式').first().click();
      await expect(await imageByUrl(page, 'img[src]', String(reference.url))).toBeVisible({ timeout: 20_000 });
    } finally {
      await ensurePlacementRestored(page, stage2Evidence, {
        projectId,
        assetId,
        versionId,
        placementId,
        url: String(reference.url),
      });
    }
    await openCanvasProject(page, projectId);
    await expect(await canvasImageByUrl(page, String(reference.url))).toBeVisible({ timeout: 20_000 });
  });
});
