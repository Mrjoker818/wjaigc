import { readFile } from 'node:fs/promises';

import {
  apiJson,
  canvasProjectPlacements,
  canvasImageByUrl,
  cleanupNewProjectPlacements,
  ensurePlacementRestored,
  expect,
  loginRealUser,
  openCanvasProject,
  readProjects,
  removeControlledProject,
  requireStage2Env,
  requireStage2ProjectValue,
  stage2PlacementBaseline,
  test,
  validateStage2ProjectIsolation,
} from '../helpers/stage-2-e2e';

test.use({ trace: 'off', video: 'on' });
validateStage2ProjectIsolation(process.env);

test.describe('Stage 2 asset lifecycle', () => {
  test('opens a seeded legacy v1 project without issuing a write', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LEGACY_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/user-data/sync') && request.method() !== 'GET') writes.push(request.method());
    });
    await openCanvasProject(page, projectId);
    await expect(page.locator('[data-canvas-viewport] img').first()).toBeVisible({ timeout: 20_000 });
    const unexpectedWrite = page.waitForRequest(
      request => request.url().includes('/api/user-data/sync') && request.method() !== 'GET',
      { timeout: 1_500 },
    ).then(() => true, () => false);
    expect(await unexpectedWrite).toBe(false);
    expect(writes).toEqual([]);
  });

  test('performs the first writable save as copy-on-write', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_COPY_ON_WRITE_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const project = snapshot.projects.find(item => item.id === projectId);
    expect(project, 'Controlled legacy project was not returned by the server').toBeTruthy();
    const legacyImages = project?.canvasImages as Array<Record<string, unknown>> | undefined;
    expect(legacyImages?.length).toBeGreaterThan(0);
    expect(legacyImages?.every(item => !item.assetVersionId && !item.placementId), 'COW fixture was already consumed').toBe(true);
    const placementBaseline = await stage2PlacementBaseline(page, stage2Evidence, projectId, { requireMissingProject: true });
    await openCanvasProject(page, projectId);
    const image = page.locator('[data-canvas-viewport] img').first().locator('..');
    await expect(image).toBeVisible({ timeout: 20_000 });
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    try {
      const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 30, { steps: 6 });
      await page.mouse.up();
      const saveResponse = await saved;
      expect(saveResponse.ok()).toBeTruthy();
      const result = await saveResponse.json() as Record<string, unknown>;
      stage2Evidence.recordPayload(result);
      const updates = result.assetGraphUpdates as Record<string, Record<string, unknown>> | undefined;
      expect(result.success).toBe(true);
      expect(updates?.[projectId], 'First save did not return asset graph mappings').toBeTruthy();
      const after = await readProjects(page, stage2Evidence);
      expect(after.projects.some(item => item.id === projectId)).toBe(true);
    } finally {
      await removeControlledProject(page, stage2Evidence, projectId, placementBaseline);
    }
  });

  test('uploads a real image into the canvas project', async ({ page, stage2Evidence }, testInfo) => {
    const env = requireStage2Env('E2E_STAGE2_UPLOAD_FIXTURE');
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_UPLOAD_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const originalProject = snapshot.projects.find(project => project.id === projectId);
    expect(originalProject).toBeTruthy();
    const placementBaseline = await stage2PlacementBaseline(page, stage2Evidence, projectId);
    await openCanvasProject(page, projectId);
    const images = page.locator('[data-canvas-viewport] img');
    const before = await images.count();
    const beforeIds = new Set((originalProject?.canvasImages as Array<Record<string, unknown>> | undefined)?.map(image => String(image.id)) ?? []);
    const bytes = await readFile(env.E2E_STAGE2_UPLOAD_FIXTURE);
    try {
      const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
      await page.getByTestId('canvas-image-upload-input').setInputFiles({ name: 'stage-2-upload.png', mimeType: 'image/png', buffer: bytes });
      await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
      const response = await saved;
      const payload = await response.json() as Record<string, unknown>;
      stage2Evidence.recordApi('POST', response.url(), response.status(), payload);
      const updates = (payload.assetGraphUpdates as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[projectId];
      const createdEntry = updates && Object.entries(updates).find(([imageId, item]) => !beforeIds.has(imageId) && typeof item.placementId === 'string');
      const created = createdEntry?.[1];
      expect(typeof created?.placementId === 'string' && created.placementId.length > 0).toBe(true);
      expect(typeof created?.url === 'string' && created.url.length > 0).toBe(true);
      await expect(await canvasImageByUrl(page, String(created?.url))).toBeVisible();
    } finally {
      await cleanupNewProjectPlacements(page, stage2Evidence, originalProject!, [], placementBaseline);
    }
  });

  test('trashes and restores a placement without losing asset identity', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_PROJECT_IDS');
    const assetId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_ASSET_IDS');
    const versionId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_VERSION_IDS');
    const placementId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS');
    await loginRealUser(page, stage2Evidence);
    const before = await apiJson(page, stage2Evidence, 'GET', `/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
    expect(typeof before.url === 'string' && before.url.length > 0).toBe(true);
    await openCanvasProject(page, projectId);
    const image = await canvasImageByUrl(page, String(before.url));
    await image.click();
    try {
      const deleted = page.waitForResponse(response => response.url().includes(`/api/assets/placements/${placementId}`) && response.request().method() === 'DELETE');
      const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
      await page.getByTestId('selected-image-delete').click();
      const deleteResponse = await deleted;
      const deletePayload = await deleteResponse.json().catch(() => ({})) as Record<string, unknown>;
      stage2Evidence.recordApi('DELETE', deleteResponse.url(), deleteResponse.status(), deletePayload);
      expect(deleteResponse.ok()).toBeTruthy();
      expect(deletePayload.placementTrashed).toBe(true);
      const saveResponse = await saved;
      const savePayload = await saveResponse.json().catch(() => ({}));
      stage2Evidence.recordApi('POST', saveResponse.url(), saveResponse.status(), savePayload);
      expect(saveResponse.ok()).toBeTruthy();
      const missing = await page.request.get(`/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
      const missingPayload = await missing.json().catch(() => ({})) as Record<string, unknown>;
      stage2Evidence.recordApi('GET', missing.url(), missing.status(), missingPayload);
      expect(missing.status()).toBe(404);
      expect(missingPayload.error).toBe('ASSET_NOT_FOUND');
    } finally {
      await ensurePlacementRestored(page, stage2Evidence, {
        projectId,
        assetId,
        versionId,
        placementId,
        url: String(before.url),
      });
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(await canvasImageByUrl(page, String(before.url))).toBeVisible({ timeout: 20_000 });
  });

  test('surfaces missing media and retries recovery without mocking', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_MISSING_PROJECT_IDS');
    const filename = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_MISSING_FILENAMES');
    await loginRealUser(page, stage2Evidence);
    await openCanvasProject(page, projectId);
    const exactFilename = new RegExp(`^${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const missingMedia = page.locator('[data-canvas-missing-media]').filter({
      has: page.locator('span').filter({ hasText: exactFilename }),
    });
    await expect(missingMedia).toHaveCount(1);
    const recovery = missingMedia.getByRole('button', { name: '恢复', exact: true });
    const retry = missingMedia.getByRole('button', { name: '重试', exact: true });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/assets/media/recover') && response.request().method() === 'POST');
    await (await recovery.isVisible().catch(() => false) ? recovery : retry).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    stage2Evidence.recordPayload(result);
    expect(['ready', 'recovering', 'unrecoverable', 'missing']).toContain(result.availability);
  });

  test('recovers the workspace after a full page refresh', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_REFRESH_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    await openCanvasProject(page, projectId);
    const projectBefore = (await readProjects(page, stage2Evidence)).projects.find(project => project.id === projectId);
    const identityBefore = canvasProjectPlacements(projectBefore);
    const images = page.locator('[data-canvas-viewport] img[src]');
    const before = await images.evaluateAll(nodes => nodes.map(node => ({
      src: (node as HTMLImageElement).getAttribute('src'),
      style: node.parentElement?.getAttribute('style'),
    })));
    expect(before.length).toBeGreaterThan(0);
    expect(identityBefore.length).toBe(before.length);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => images.evaluateAll(nodes => nodes.map(node => ({
      src: (node as HTMLImageElement).getAttribute('src'),
      style: node.parentElement?.getAttribute('style'),
    }))), { timeout: 20_000 }).toEqual(before);
    const projectAfter = (await readProjects(page, stage2Evidence)).projects.find(project => project.id === projectId);
    expect(canvasProjectPlacements(projectAfter)).toEqual(identityBefore);
  });
});
