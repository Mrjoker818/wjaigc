import { expect, test } from '@playwright/test';

const fixture = process.env.E2E_VIDEO_TOOL_FIXTURE;

test('seeks a native video and keeps its compressed copy in a collaborative canvas after reload', async ({ page }, testInfo) => {
  test.skip(!fixture, 'Requires a dedicated local application and a synthetic MP4.');
  const origin = new URL(testInfo.project.use.baseURL ?? '');
  expect(origin.hostname).toBe('127.0.0.1');
  expect(origin.protocol).toBe('http:');
  const username = process.env.E2E_TEST_USERNAME ?? '';
  const password = process.env.E2E_TEST_PASSWORD ?? '';
  expect(username.startsWith('qa_nov13_')).toBe(true);
  expect(Boolean(password)).toBe(true);
  test.setTimeout(150_000);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^无限画布/ }).click();
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  const [login] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login'),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  expect(login.status()).toBe(200);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const canvas = page.locator('[data-canvas-viewport]');
  await expect(canvas).toHaveAttribute('data-project-id', /.+/);
  const projectId = (await canvas.getAttribute('data-project-id'))!;
  const query = new URLSearchParams({ projectId });
  const enablePath = '/api/collaboration/document-enable';
  await expect.poll(async () => (await page.request.get(`${enablePath}?${query}`)).status()).toBe(200);
  await page.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' });
  // Assign this run's fixture a distinct name with the current project revision.
  const snapshotResponse = await page.request.get('/api/user-data/sync?key=projects');
  expect(snapshotResponse.status()).toBe(200);
  const snapshot = await snapshotResponse.json() as { projectRevision: number; value: Array<{ id: string; name: string }> };
  expect(snapshot.value.filter(project => project.id === projectId)).toHaveLength(1);
  const name = `QA video ${projectId}`;
  const savedProject = await page.request.post('/api/user-data/sync', { data: {
    key: 'projects', projectRevision: snapshot.projectRevision,
    value: snapshot.value.map(project => project.id === projectId ? { ...project, name } : project),
  } });
  expect(savedProject.status()).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `${name} 项目操作菜单`, exact: true }).click();
  await page.getByRole('menuitem', { name: '管理协作', exact: true }).click();
  const [enabled] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === enablePath && response.request().method() === 'POST'),
    page.getByRole('button', { name: '启用协作', exact: true }).click(),
  ]);
  expect(enabled.status()).toBe(200);
  expect(await enabled.json()).toMatchObject({ success: true, projectId });
  await page.goto(`/?${query}`, { waitUntil: 'domcontentloaded' });
  await expect(canvas).toHaveAttribute('data-project-id', projectId);
  const upload = page.getByTestId('canvas-image-upload-input');
  await expect(upload).toHaveAttribute('accept', /video\/mp4/);
  const groups = canvas.locator('[data-canvas-image-id]');
  await upload.setInputFiles(fixture!);
  await expect(groups).toHaveCount(1, { timeout: 30_000 });
  const originalId = (await groups.first().getAttribute('data-canvas-image-id'))!;
  const original = canvas.locator(`[data-canvas-image-id=${JSON.stringify(originalId)}]`);
  const collapse = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapse.isVisible()) await collapse.click();

  await original.click({ button: 'right' });
  await page.getByText('播放视频', { exact: true }).click();
  const player = page.getByRole('dialog', { name: '视频预览', exact: true });
  const video = player.locator('video');
  const seek = player.getByRole('slider', { name: '视频进度', exact: true });
  await expect(seek).toBeEnabled();
  const duration = await video.evaluate(element => (element as HTMLVideoElement).duration);
  expect(duration).toBeCloseTo(3, 1);
  const slider = await seek.boundingBox();
  expect(slider).not.toBeNull();
  const y = slider!.y + slider!.height / 2;
  await page.mouse.move(slider!.x + slider!.width * 0.28, y);
  await page.mouse.down();
  await page.mouse.move(slider!.x + slider!.width * 0.72, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(2);
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeLessThan(2.5);
  await player.getByRole('button', { name: '关闭视频预览', exact: true }).click();

  const toolRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/video/tools') {
      toolRequests.push(request.postDataJSON()?.action);
    }
  });
  await original.click();
  const [compressed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/video/tools' && response.request().method() === 'POST'),
    page.getByRole('button', { name: '视频压缩', description: '压缩视频并保留可播放副本', exact: true }).click(),
  ]);
  expect(compressed.status()).toBe(200);
  expect(await compressed.json()).toMatchObject({ success: true, videoUrl: expect.any(String) });
  await expect(groups).toHaveCount(2, { timeout: 30_000 });
  // Read the document again independently before trusting the rendered copy.
  const ids = await groups.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-canvas-image-id')).sort());
  expect(ids).toContain(originalId);
  expect(new Set(ids).size).toBe(2);
  const copyId = ids.find(id => id !== originalId)!;
  const projection = await page.request.get(`/api/collaboration/document-project?${query}`);
  expect(projection.status()).toBe(200);
  const document = await projection.json() as {
    success: boolean; documentTransport: string;
    canvasImages: Array<{ id: string; mediaType?: string; assetVersionId?: string; placementId?: string }>;
  };
  expect(document).toMatchObject({ success: true, documentTransport: 'http' });
  expect(document.canvasImages.map(image => image.id).sort()).toEqual(ids);
  for (const id of [originalId, copyId]) {
    expect(document.canvasImages.find(image => image.id === id)).toMatchObject({
      mediaType: 'video', assetVersionId: expect.any(String), placementId: expect.any(String),
    });
  }
  expect(new Set(document.canvasImages.map(image => image.assetVersionId)).size).toBe(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(groups).toHaveCount(2);
  expect(await groups.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-canvas-image-id')).sort())).toEqual(ids);
  await canvas.locator(`[data-canvas-image-id=${JSON.stringify(copyId)}]`).click({ button: 'right' });
  await page.getByText('播放视频', { exact: true }).click();
  await expect(player.getByRole('slider', { name: '视频进度', exact: true })).toBeEnabled();
  const playCopy = player.getByRole('button', { name: '播放', exact: true });
  if (await playCopy.isVisible()) await playCopy.click();
  await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.3);
  expect(toolRequests).toEqual(['compress']);
});
