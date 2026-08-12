import { readFile } from 'node:fs/promises';

import {
  expect,
  loginRealUser,
  openCanvasProject,
  postJson,
  readProjects,
  requireStage2Env,
  requireStage2ProjectValue,
  test,
} from '../helpers/stage-2-e2e';

test.use({ trace: 'off', video: 'on' });

test.describe('Stage 2 asset lifecycle', () => {
  test('opens a seeded legacy v1 project without issuing a write', async ({ page }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LEGACY_PROJECT_IDS');
    await loginRealUser(page);
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/user-data/sync') && request.method() !== 'GET') writes.push(request.method());
    });
    await openCanvasProject(page, projectId);
    await expect(page.locator('[data-canvas-viewport] img').first()).toBeVisible({ timeout: 20_000 });
    expect(writes).toEqual([]);
  });

  test('performs the first writable save as copy-on-write', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_COPY_ON_WRITE_PROJECT_IDS');
    await loginRealUser(page);
    const snapshot = await readProjects(page);
    const project = snapshot.projects.find(item => item.id === projectId);
    expect(project, 'Controlled legacy project was not returned by the server').toBeTruthy();
    const result = await postJson(page, '/api/user-data/sync', {
      key: 'projects',
      value: snapshot.projects,
      projectRevision: snapshot.revision,
    });
    stage2Evidence.recordPayload(result);
    const updates = result.assetGraphUpdates as Record<string, Record<string, unknown>> | undefined;
    expect(result.success).toBe(true);
    expect(updates?.[projectId], 'First save did not return asset graph mappings').toBeTruthy();
    const after = await readProjects(page);
    expect(after.projects.some(item => item.id === projectId)).toBe(true);
  });

  test('uploads a real image into the canvas project', async ({ page }, testInfo) => {
    const env = requireStage2Env('E2E_STAGE2_UPLOAD_FIXTURE');
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_UPLOAD_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const images = page.locator('[data-canvas-viewport] img');
    const before = await images.count();
    const bytes = await readFile(env.E2E_STAGE2_UPLOAD_FIXTURE);
    await page.getByTestId('canvas-image-upload-input').setInputFiles({ name: 'stage-2-upload.png', mimeType: 'image/png', buffer: bytes });
    await expect.poll(() => images.count(), { timeout: 30_000 }).toBeGreaterThan(before);
    await expect(images.last()).toHaveAttribute('src', /api\/serve-upload|https?:\/\//);
  });

  test('trashes and restores a placement without losing asset identity', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_PROJECT_IDS');
    const assetId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_ASSET_IDS');
    const versionId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_VERSION_IDS');
    const placementId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS');
    await loginRealUser(page);
    const before = await page.request.get(`/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
    expect(before.ok()).toBeTruthy();
    const deleted = await page.request.delete(`/api/assets/placements/${encodeURIComponent(placementId)}?projectId=${encodeURIComponent(projectId)}`);
    expect(deleted.ok()).toBeTruthy();
    const restored = await postJson(page, `/api/assets/${encodeURIComponent(assetId)}/restore`, {
      projectId,
      placementId,
    });
    stage2Evidence.recordPayload(restored);
    expect((restored.placement as Record<string, unknown>)?.id).toBe(placementId);
    const after = await page.request.get(`/api/assets?projectId=${encodeURIComponent(projectId)}&assetVersionId=${encodeURIComponent(versionId)}&placementId=${encodeURIComponent(placementId)}`);
    expect(after.ok()).toBeTruthy();
  });

  test('surfaces missing media and retries recovery without mocking', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_MISSING_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const recovery = page.getByRole('button', { name: '恢复', exact: true }).first();
    const retry = page.getByRole('button', { name: '重试', exact: true }).first();
    await expect(recovery.or(retry)).toBeVisible({ timeout: 20_000 });
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/assets/media/recover') && response.request().method() === 'POST');
    await (await recovery.isVisible().catch(() => false) ? recovery : retry).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    stage2Evidence.recordPayload(result);
    expect(['ready', 'recovering', 'unrecoverable', 'missing']).toContain(result.availability);
  });

  test('recovers the workspace after a full page refresh', async ({ page }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_REFRESH_PROJECT_IDS');
    await loginRealUser(page);
    await openCanvasProject(page, projectId);
    const images = page.locator('[data-canvas-viewport] img');
    const before = await images.count();
    expect(before).toBeGreaterThan(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => images.count(), { timeout: 20_000 }).toBe(before);
  });
});
