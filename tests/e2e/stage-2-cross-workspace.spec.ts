import {
  apiJson,
  canvasImageByUrl,
  deleteCanvasPlacementFromUi,
  expect,
  imageByUrl,
  loginRealUser,
  openCanvasProject,
  readProjects,
  requireStage2ProjectValue,
  restoreProjectSnapshot,
  test,
  validateStage2ProjectIsolation,
} from '../helpers/stage-2-e2e';

async function recordJsonResponse(response: import('@playwright/test').Response, record: (payload: unknown) => void): Promise<Record<string, unknown>> {
  expect(response.ok(), `${response.url()} returned HTTP ${response.status()}`).toBeTruthy();
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  record(payload);
  return payload;
}

function expectTransfer(payload: Record<string, unknown>): { assetId: string; assetVersionId: string; placementId: string; url: string } {
  expect(payload.assetId).toEqual(expect.any(String));
  expect(payload.assetVersionId).toEqual(expect.any(String));
  expect(payload.placementId).toEqual(expect.any(String));
  expect(payload.url).toEqual(expect.any(String));
  return payload as { assetId: string; assetVersionId: string; placementId: string; url: string };
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
    await openCanvasProject(page, projectId);
    await page.getByText('AI聊天', { exact: true }).click();
    const sourceImage = await imageByUrl(page, 'img[src]', sourceUrl);
    const addButton = sourceImage.locator('xpath=..').getByRole('button', { name: '添加到画布', exact: true });
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
    await addButton.click();
    const created = expectTransfer(await recordJsonResponse(await transfer, payload => stage2Evidence.recordPayload(payload)));
    try {
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible();
    } finally {
      try {
        await deleteCanvasPlacementFromUi(page, stage2Evidence, created.placementId, created.url);
      } finally {
        await restoreProjectSnapshot(page, stage2Evidence, originalProject!);
      }
    }
  });

  test('runs a seeded workflow through the node-mode UI and returns its real output to canvas', async ({ page, stage2Evidence }, testInfo) => {
    const projectId = requireStage2ProjectValue(testInfo.project.name, 'E2E_STAGE2_WORKFLOW_PROJECT_IDS');
    await loginRealUser(page, stage2Evidence);
    const snapshot = await readProjects(page, stage2Evidence);
    const originalProject = snapshot.projects.find(project => project.id === projectId);
    expect(originalProject).toBeTruthy();
    await openCanvasProject(page, projectId);
    await page.getByTitle('节点模式').first().click();
    const execute = page.getByRole('button', { name: '执行工作流', exact: true });
    await expect(execute).toBeVisible({ timeout: 20_000 });
    const started = page.waitForResponse(response => response.url().includes('/api/workflow/execute') && response.request().method() === 'POST');
    const outputTransfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST', { timeout: 180_000 });
    await execute.click();
    const startedPayload = await recordJsonResponse(await started, payload => stage2Evidence.recordPayload(payload));
    expect(Object.entries(startedPayload).some(([key, value]) => /(?:task|execution)_?id/i.test(key) && typeof value === 'string')).toBe(true);
    const created = expectTransfer(await recordJsonResponse(await outputTransfer, payload => stage2Evidence.recordPayload(payload)));
    const back = page.getByRole('button', { name: '返回画布', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    try {
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible();
    } finally {
      try {
        await deleteCanvasPlacementFromUi(page, stage2Evidence, created.placementId, created.url);
      } finally {
        await restoreProjectSnapshot(page, stage2Evidence, originalProject!);
      }
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
    await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: '目标画布项目' }).selectOption(targetProjectId);
    const sourceImage = await imageByUrl(page, 'main img[src]', sourceUrl);
    const addButton = sourceImage.locator('xpath=../../..').getByTitle('添加到画布');
    await expect(addButton).toBeVisible({ timeout: 20_000 });
    const transfer = page.waitForResponse(response => response.url().includes('/api/assets/transfer') && response.request().method() === 'POST');
    await addButton.click();
    const created = expectTransfer(await recordJsonResponse(await transfer, payload => stage2Evidence.recordPayload(payload)));
    await openCanvasProject(page, targetProjectId);
    try {
      await expect(await canvasImageByUrl(page, created.url)).toBeVisible({ timeout: 20_000 });
    } finally {
      try {
        await deleteCanvasPlacementFromUi(page, stage2Evidence, created.placementId, created.url);
      } finally {
        await restoreProjectSnapshot(page, stage2Evidence, originalProject!);
      }
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
    expect(reference.url).toEqual(expect.any(String));
    await openCanvasProject(page, projectId);
    const image = await canvasImageByUrl(page, String(reference.url));
    await expect(image).toBeVisible({ timeout: 20_000 });
    await image.click();
    const deleted = page.waitForResponse(response => response.url().includes(`/api/assets/placements/${placementId}`) && response.request().method() === 'DELETE');
    const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
    await page.getByTestId('selected-image-delete').click();
    const deleteResponse = await deleted;
    const deletePayload = await deleteResponse.json().catch(() => ({}));
    stage2Evidence.recordApi('DELETE', deleteResponse.url(), deleteResponse.status(), deletePayload);
    expect(deleteResponse.ok()).toBeTruthy();
    const saveResponse = await saved;
    const savePayload = await saveResponse.json().catch(() => ({}));
    stage2Evidence.recordApi('POST', saveResponse.url(), saveResponse.status(), savePayload);
    expect(saveResponse.ok()).toBeTruthy();
    try {
      await page.goto(`/simple-chat?projectId=${encodeURIComponent(chatProjectId)}`, { waitUntil: 'domcontentloaded' });
      await expect(await imageByUrl(page, 'main img[src]', String(reference.url))).toBeVisible({ timeout: 20_000 });
      await openCanvasProject(page, projectId);
      await page.getByTitle('节点模式').first().click();
      await expect(await imageByUrl(page, 'img[src]', String(reference.url))).toBeVisible({ timeout: 20_000 });
    } finally {
      await apiJson(page, stage2Evidence, 'POST', `/api/assets/${encodeURIComponent(assetId)}/restore`, { projectId, placementId });
    }
  });
});
