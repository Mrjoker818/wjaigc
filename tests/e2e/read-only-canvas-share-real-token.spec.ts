import { createHash } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import type { CanvasSharePublicDocument } from '../../src/lib/canvas-share/types';

// A token-bearing trace, screenshot, or video would disclose the disposable link.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const enabled = process.env.E2E_SHARE_REAL_TOKEN_LOCAL_GATE === '1';

function requiredLocalGate(): {
  baseURL: string;
  databaseURL: string;
  dataRoot: string;
  projectId: string;
  placementId: string;
  assetId: string;
  username: string;
  password: string;
} {
  const baseURL = process.env.E2E_BASE_URL ?? '';
  const databaseURL = process.env.E2E_SHARE_REAL_TOKEN_DATABASE_URL ?? '';
  const dataRoot = process.env.WUJIE_DATA_DIR ?? '';
  const projectId = JSON.parse(process.env.E2E_STAGE2_LIFECYCLE_PROJECT_IDS ?? '{}').chromium as string;
  const placementId = JSON.parse(process.env.E2E_STAGE2_LIFECYCLE_PLACEMENT_IDS ?? '{}').chromium as string;
  const assetId = JSON.parse(process.env.E2E_STAGE2_LIFECYCLE_ASSET_IDS ?? '{}').chromium as string;
  const username = process.env.E2E_TEST_USERNAME ?? '';
  const password = process.env.E2E_TEST_PASSWORD ?? '';
  const parsedBase = new URL(baseURL);
  const parsedDatabase = new URL(databaseURL);
  if (
    parsedBase.hostname !== '127.0.0.1'
    || parsedDatabase.hostname !== '127.0.0.1'
    || !parsedDatabase.pathname.startsWith('/wujie_share_gate_')
    || !path.resolve(dataRoot).includes(`${path.sep}_tmp_e2e${path.sep}share-gate-`)
    || !projectId || !placementId || !assetId || !username || !password
  ) {
    throw new Error('Real-token gate requires explicit localhost and disposable fixture settings');
  }
  return { baseURL, databaseURL, dataRoot, projectId, placementId, assetId, username, password };
}

test('real owner token keeps anonymous sharing read-only across policy, snapshot, media, expiry, and narrow viewports', async ({ browser, request }) => {
  test.skip(!enabled, 'Run only against an explicit isolated local PostgreSQL gate');
  test.setTimeout(120_000);
  const gate = requiredLocalGate();
  const ownerHeaders = { origin: gate.baseURL };
  const database = new Client({ connectionString: gate.databaseURL });
  const anonymousContext = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const anonymous = anonymousContext.request;
  const page = await anonymousContext.newPage();
  const forbiddenMethods: string[] = [];
  page.on('request', incoming => {
    if (new URL(incoming.url()).origin === gate.baseURL
      && !['GET', 'HEAD', 'OPTIONS'].includes(incoming.method())) {
      forbiddenMethods.push(incoming.method());
    }
  });

  let shareId = '';
  let expiringShareId = '';
  let mediaFile = '';
  let movedMediaFile = '';
  await database.connect();
  try {
    const login = await request.post('/api/auth/login', {
      data: { name: gate.username, password: gate.password, productType: 'canvas' },
    });
    const loginResult = await login.json() as { code?: string };
    expect(login.status(), loginResult.code ?? 'login returned no error code').toBe(200);

    const preflight = await request.post('/api/canvas-shares/preflight', {
      headers: ownerHeaders,
      data: { projectId: gate.projectId },
    });
    const preflightResult = await preflight.json() as { code?: string; readiness?: { ready: boolean } };
    expect(preflight.status(), preflightResult.code ?? 'preflight returned no error code').toBe(200);
    expect(preflightResult.readiness?.ready).toBe(true);

    const created = await request.post('/api/canvas-shares', {
      headers: ownerHeaders,
      data: { projectId: gate.projectId, title: 'Local real-token gate' },
    });
    expect(created.status()).toBe(201);
    const creation = await created.json() as { shareId: string; shareUrl: string };
    shareId = creation.shareId;
    const shareURL = new URL(creation.shareUrl);
    expect(shareURL.origin).toBe(gate.baseURL);
    const token = shareURL.pathname.split('/').at(-1) ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    const storedToken = await database.query<{ token_hash: string; status: string; allow_download: boolean }>(
      'SELECT token_hash, status, allow_download FROM wujie_canvas_shares WHERE id=$1',
      [shareId],
    );
    expect(storedToken.rows).toHaveLength(1);
    expect(storedToken.rows[0]).toMatchObject({
      token_hash: createHash('sha256').update(token).digest('hex'),
      status: 'active',
      allow_download: false,
    });
    expect(storedToken.rows[0].token_hash).not.toBe(token);
    const publicBase = `/api/public/canvas-shares/${token}/`;

    const publicResponse = await anonymous.get(publicBase);
    expect(publicResponse.status()).toBe(200);
    const original = await publicResponse.json() as CanvasSharePublicDocument;
    expect(original).toMatchObject({ title: 'Local real-token gate', allowDownload: false });
    expect(original.items).toHaveLength(1);
    expect(original.items[0].transform.x).toBe(0);
    expect(original.items[0].downloadPath).toBeUndefined();
    const mediaURL = `${publicBase}${original.items[0].mediaPath}`;
    expect((await anonymous.get(mediaURL)).status()).toBe(200);
    expect((await anonymous.get(`${mediaURL}/download`)).status()).toBe(403);
    const anonymousMutationBaseline = await database.query<{
      share_count: number;
      transform: Record<string, unknown>;
    }>(
      `SELECT (SELECT count(*)::int FROM wujie_canvas_shares WHERE project_id=$1) AS share_count,
              (SELECT transform FROM wujie_workspace_placements WHERE id=$2) AS transform`,
      [gate.projectId, gate.placementId],
    );
    expect((await anonymous.post('/api/canvas-shares/preflight', {
      headers: ownerHeaders,
      data: { projectId: gate.projectId },
    })).status()).toBe(401);
    expect((await anonymous.post('/api/canvas-shares', {
      headers: ownerHeaders,
      data: { projectId: gate.projectId, title: 'Unauthorized copy' },
    })).status()).toBe(401);
    expect((await anonymous.post('/api/user-data/sync', {
      data: { key: 'projects', value: [], projectRevision: 0 },
    })).status()).toBe(401);
    expect((await anonymous.patch(`/api/canvas-shares/${shareId}`, {
      headers: ownerHeaders,
      data: { allowDownload: true },
    })).status()).toBe(401);
    expect((await anonymous.post(`/api/canvas-shares/${shareId}/revoke`, {
      headers: ownerHeaders,
      data: {},
    })).status()).toBe(401);
    expect((await anonymous.delete(`/api/assets/placements/${gate.placementId}?projectId=${gate.projectId}`)).status()).toBe(401);
    const afterAnonymousMutations = await database.query<{
      status: string;
      allow_download: boolean;
      share_count: number;
      transform: Record<string, unknown>;
    }>(
      `SELECT share_record.status, share_record.allow_download,
              (SELECT count(*)::int FROM wujie_canvas_shares WHERE project_id=$2) AS share_count,
              (SELECT transform FROM wujie_workspace_placements WHERE id=$3) AS transform
       FROM wujie_canvas_shares share_record WHERE share_record.id=$1`,
      [shareId, gate.projectId, gate.placementId],
    );
    expect(afterAnonymousMutations.rows[0]).toMatchObject({
      status: 'active',
      allow_download: false,
      share_count: anonymousMutationBaseline.rows[0].share_count,
      transform: anonymousMutationBaseline.rows[0].transform,
    });

    await page.goto(creation.shareUrl);
    await expect(page.getByRole('heading', { name: 'Local real-token gate' })).toBeVisible();
    await expect(page.locator('[data-shared-media]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate((rawToken: string) =>
      [localStorage, sessionStorage].some(storage =>
        Object.keys(storage).some(key => key.includes(rawToken) || (storage.getItem(key) ?? '').includes(rawToken)),
      ), token)).toBe(false);
    await page.locator('[data-shared-media]').click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await expect(page.getByRole('link', { name: '下载预览内容' })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭预览' }).click();

    const ownerProjects = await request.get('/api/user-data/sync?key=projects');
    expect(ownerProjects.status()).toBe(200);
    const projectSnapshot = await ownerProjects.json() as {
      value: Array<{ id: string; canvasImages: Array<{ x: number }> }>;
      projectRevision: number;
    };
    const editedProject = projectSnapshot.value.find(project => project.id === gate.projectId);
    expect(editedProject?.canvasImages).toHaveLength(1);
    editedProject!.canvasImages[0].x = 999;
    const ownerEdit = await request.post('/api/user-data/sync', {
      data: { key: 'projects', value: projectSnapshot.value, projectRevision: projectSnapshot.projectRevision },
    });
    expect(ownerEdit.status(), await ownerEdit.text()).toBe(200);
    const currentPlacement = await database.query<{ transform: { x: number } }>(
      'SELECT transform FROM wujie_workspace_placements WHERE id=$1',
      [gate.placementId],
    );
    expect(currentPlacement.rows).toHaveLength(1);
    expect(currentPlacement.rows[0].transform.x).toBe(999);
    const unchanged = await anonymous.get(publicBase);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.json() as CanvasSharePublicDocument).items[0].transform.x).toBe(0);

    const enabledDownload = await request.patch(`/api/canvas-shares/${shareId}`, {
      headers: ownerHeaders,
      data: { allowDownload: true },
    });
    expect(enabledDownload.status()).toBe(200);
    const allowed = await anonymous.get(publicBase);
    expect(allowed.status()).toBe(200);
    expect((await allowed.json() as CanvasSharePublicDocument).items[0].downloadPath).toBeTruthy();
    const download = await anonymous.get(`${mediaURL}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain('image/png');
    expect(download.headers()['content-disposition']).toContain('attachment');
    expect((await download.body()).length).toBeGreaterThan(0);

    await page.setViewportSize({ width: 393, height: 852 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Local real-token gate' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-shared-media]').click();
    const downloadLink = page.getByRole('link', { name: '下载预览内容' });
    await expect(downloadLink).toBeVisible();
    const browserDownload = page.waitForEvent('download');
    await downloadLink.click();
    const downloaded = await browserDownload;
    expect(downloaded.suggestedFilename()).toMatch(/\.png$/u);
    await downloaded.cancel();
    await page.getByRole('button', { name: '关闭预览' }).click();

    const fileResult = await database.query<{ file_url: string }>(
      `SELECT version.file_url FROM wujie_assets asset
       JOIN wujie_asset_versions version ON version.id=asset.current_version_id
       WHERE asset.id=$1`,
      [gate.assetId],
    );
    expect(fileResult.rows).toHaveLength(1);
    mediaFile = path.join(gate.dataRoot, 'uploads', path.basename(fileResult.rows[0].file_url));
    movedMediaFile = `${mediaFile}.unavailable`;
    await rename(mediaFile, movedMediaFile);
    expect((await anonymous.get(mediaURL)).status()).toBe(410);
    await page.reload();
    await expect(page.getByText('此内容暂不可用')).toBeVisible();
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText('此内容暂不可用')).toBeVisible();
    await rename(movedMediaFile, mediaFile);
    movedMediaFile = '';

    const expiring = await request.post('/api/canvas-shares', {
      headers: ownerHeaders,
      data: {
        projectId: gate.projectId,
        title: 'Expiring local share',
        expiresAt: new Date(Date.now() + 20_000).toISOString(),
      },
    });
    expect(expiring.status()).toBe(201);
    const expiry = await expiring.json() as { shareId: string; shareUrl: string };
    expiringShareId = expiry.shareId;
    const expiryToken = new URL(expiry.shareUrl).pathname.split('/').at(-1) ?? '';
    expect((await anonymous.get(`/api/public/canvas-shares/${expiryToken}`)).status()).toBe(200);
    await expect.poll(async () => (await anonymous.get(`/api/public/canvas-shares/${expiryToken}`)).status(), {
      timeout: 30_000,
      intervals: [1_000],
    }).toBe(404);

    const revoked = await request.post(`/api/canvas-shares/${shareId}/revoke`, {
      headers: ownerHeaders,
      data: {},
    });
    expect(revoked.status()).toBe(200);
    expect((await anonymous.get(publicBase)).status()).toBe(404);
    expect((await anonymous.get(mediaURL)).status()).toBe(404);
    expect((await anonymous.get(`${mediaURL}/download`)).status()).toBe(404);
    expect(forbiddenMethods).toEqual([]);
  } finally {
    if (movedMediaFile) await rename(movedMediaFile, mediaFile);
    for (const id of [shareId, expiringShareId]) {
      if (id) await request.post(`/api/canvas-shares/${id}/revoke`, { headers: ownerHeaders, data: {} });
    }
    await database.end();
    await anonymousContext.close();
  }
});
