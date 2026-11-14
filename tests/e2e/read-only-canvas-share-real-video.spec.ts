import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, realpath } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import type { CanvasSharePublicDocument } from '../../src/lib/canvas-share/types';
import { matchesShareBuildAsset, readShareBuildAssets } from '../helpers/read-only-canvas-share-build-assets';
import type { Task7RequestRecord } from '../helpers/read-only-canvas-share-contract';

// This test creates a real disposable bearer link; never record it in a trace or video.
test.use({ trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' });

function requiredGate(baseURL: string | undefined) {
  const origin = new URL(baseURL ?? '');
  const database = new URL(process.env.E2E_SHARE_VIDEO_DATABASE_URL ?? '');
  const dataRoot = resolve(process.env.WUJIE_DATA_DIR ?? '.');
  const username = process.env.WUJIE_ADMIN_USERNAME ?? '';
  const password = process.env.WUJIE_ADMIN_PASSWORD ?? '';
  const buildDirectory = process.env.WUJIE_SHARE_NETWORK_BUILD_DIR ?? '';
  const runId = process.env.E2E_STAGE4_RUN_ID ?? '';
  const runNonce = process.env.E2E_SHARE_VIDEO_RUN_NONCE ?? '';
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port
    || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1'
    || !database.port || database.port === '5432' || database.search || database.hash
    || !/^[a-z0-9_]{4,40}$/u.test(runId) || database.pathname !== '/wujie_stage4_' + runId
    || !dataRoot.includes(sep + '_tmp_e2e' + sep + 'share-gate-')
    || !username || !password || !buildDirectory || !/^[a-f0-9]{32}$/u.test(runNonce)) {
    throw new Error('Real video sharing requires a dedicated local test app, media root, and database');
  }
  return { origin: origin.origin, database, dataRoot, username, password, buildDirectory, runNonce };
}

test('plays and downloads a real anonymous MP4 share using the restricted network contract', async ({ browser, browserName, baseURL }, testInfo) => {
  const isWebKit = browserName === 'webkit';
  test.skip(!['webkit', 'chromium'].includes(browserName) || process.env.E2E_SHARE_VIDEO_LOCAL_GATE !== '1',
    'Explicit isolated production build with a native MP4 browser only');
  test.setTimeout(90_000);
  if (testInfo.config.reporter.some(([name]) => !['list', 'line', 'json'].includes(name))) {
    throw new Error('Use the list, line or JSON reporter for the disposable bearer-link check');
  }
  const gate = requiredGate(baseURL);
  const buildAssets = await readShareBuildAssets(gate.buildDirectory);
  const owner = await browser.newContext({ baseURL: gate.origin });
  const visitor = await browser.newContext({
    baseURL: gate.origin, viewport: isWebKit ? { width: 393, height: 852 } : { width: 1280, height: 720 },
    hasTouch: isWebKit, isMobile: isWebKit, acceptDownloads: true,
  });
  const client = new Client({ connectionString: gate.database.toString() });
  const projectId = 'qa-share-video-' + randomUUID();
  const fixture = resolve('tests/fixtures/owned-one-second.mp4');
  const bytes = await readFile(fixture);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const filename = projectId + '.mp4';
  const fileUrl = '/api/serve-upload/uploads/' + filename;
  const title = '真实视频分享验收';
  const headers = { Origin: gate.origin };
  let shareId = '';
  let revoked = false;
  let token = '';
  try {
    await client.connect();
    const identity = (await client.query(
      'SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS address,'
      + ' inet_server_port() AS port, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS elevated',
    )).rows[0];
    expect(identity.db === gate.database.pathname.slice(1)).toBe(true);
    expect(identity.role === decodeURIComponent(gate.database.username)).toBe(true);
    expect(identity).toMatchObject({ address: '127.0.0.1', port: Number(gate.database.port), elevated: false });
    const uploads = join(gate.dataRoot, 'uploads');
    for (const dir of [gate.dataRoot, uploads]) {
      const fsStat = await lstat(dir);
      expect(fsStat.isDirectory() && !fsStat.isSymbolicLink()).toBe(true);
      expect(resolve(await realpath(dir)) === dir).toBe(true);
    }
    const buildId = (await readFile(join(gate.buildDirectory, 'BUILD_ID'), 'utf8')).trim();
    expect(/^[a-z0-9_-]{8,80}$/iu.test(buildId)).toBe(true);
    const { rows: marker } = await client.query('SELECT nonce FROM wujie_qa_share_video_identity');
    expect(marker.length === 1 && marker[0].nonce === gate.runNonce).toBe(true);
    const probeFile = 'qa-share-gate-' + gate.runNonce + '.png';
    const rootProbe = await visitor.request.get('/api/serve-upload/uploads/' + probeFile, { maxRedirects: 0 });
    expect(rootProbe.status()).toBe(200);
    expect((await rootProbe.body()).equals(await readFile(join(uploads, probeFile)))).toBe(true);
    const manifestPath = 'static/' + buildId + '/_buildManifest.js';
    const liveBuild = await visitor.request.get('/_next/' + manifestPath, { maxRedirects: 0 });
    expect(liveBuild.status()).toBe(200);
    expect((await liveBuild.body()).equals(await readFile(join(gate.buildDirectory, manifestPath)))).toBe(true);
    const login = await owner.request.post('/api/auth/login', {
      data: { name: gate.username, password: gate.password, productType: 'canvas' },
    });
    expect(login.status()).toBe(200);
    const { user } = await login.json() as { user: { id: string } };
    expect((await client.query('SELECT id FROM wujie_users WHERE id=$1 AND status=$2', [user.id, 'active'])).rowCount).toBe(1);

    // Fixture only. The real share endpoints read the real PostgreSQL snapshot and real MP4 bytes.
    await copyFile(fixture, join(uploads, filename), constants.COPYFILE_EXCL);
    const assetId = randomUUID();
    const versionId = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1,$2,$3)', [projectId, user.id, title]);
      await client.query("INSERT INTO wujie_assets(id, owner_id, project_id, kind) VALUES ($1,$2,$3,'video')", [assetId, user.id, projectId]);
      await client.query(
        'INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url, mime_type, byte_size, width, height, checksum)'
        + " VALUES ($1,$2,$3,$4,$5,'video/mp4',$6,160,90,$7)",
        [versionId, assetId, user.id, projectId, fileUrl, bytes.length, checksum],
      );
      await client.query('UPDATE wujie_assets SET current_version_id=$1 WHERE id=$2', [versionId, assetId]);
      await client.query(
        'INSERT INTO wujie_workspace_placements(id, owner_id, project_id, asset_id, asset_version_id,'
        + "workspace_kind, workspace_id, entity_type, entity_id, transform, metadata)"
        + " VALUES ($1,$2,$3,$4,$5,'canvas',$3,'canvas-video',$6,$7::jsonb,$8::jsonb)",
        [randomUUID(), user.id, projectId, assetId, versionId, randomUUID(),
          JSON.stringify({ x: 10, y: 10, width: 320, height: 180, rotation: 0, zIndex: 1 }),
          JSON.stringify({ label: '合成验收视频' })],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const created = await owner.request.post('/api/canvas-shares', {
      headers,
      data: { projectId, title, allowDownload: false, expiresAt: new Date(Date.now() + 180_000).toISOString() },
    });
    expect(created.status()).toBe(201);
    const issued = await created.json() as { shareUrl: string; shareId: string };
    shareId = issued.shareId;
    const link = new URL(issued.shareUrl);
    expect(link.origin).toBe(gate.origin);
    token = basename(link.pathname);
    expect(/^[A-Za-z0-9_-]{43,128}$/u.test(token)).toBe(true);
    const metadataPath = '/api/public/canvas-shares/' + token;
    const metadata = await visitor.request.get(metadataPath);
    expect(metadata.status()).toBe(200);
    const document = await metadata.json() as CanvasSharePublicDocument;
    expect(document).toMatchObject({ title, allowDownload: false });
    expect(document.items).toHaveLength(1);
    const item = document.items[0];
    expect(item).toMatchObject({ assetKind: 'video', width: 160, height: 90 });
    expect(item.downloadPath).toBeUndefined();
    expect(/^media\/csr_[A-Za-z0-9_-]{43}$/u.test(item.mediaPath)).toBe(true);
    const mediaPath = metadataPath + '/' + item.mediaPath;
    const downloadPath = mediaPath + '/download';
    const scope = createHash('sha256').update('canvas-share-public-rate:v1\0')
      .update(createHash('sha256').update(token).digest('hex'))
      .update('\0').update(item.itemRef).update('\0unknown').digest('hex');
    const requestCount = async (bucket: 'media' | 'download'): Promise<number> => {
      const { rows } = await client.query(
        'SELECT COALESCE(sum(attempt_count),0)::int AS count FROM wujie_canvas_share_rate_windows'
        + ' WHERE scope_digest=$1 AND route_bucket=$2',
        [scope, bucket],
      );
      return rows[0].count as number;
    };
    const head = await visitor.request.head(mediaPath, { headers: { Range: 'bytes=0-1' } });
    expect(head.status()).toBe(206);
    expect(head.headers()['accept-ranges']).toBe('bytes');
    expect(head.headers()['content-range']).toBe('bytes 0-1/' + bytes.length);
    const partial = await visitor.request.get(mediaPath, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()['content-range']).toBe('bytes 2-5/' + bytes.length);
    expect((await partial.body()).equals(bytes.subarray(2, 6))).toBe(true);
    expect((await visitor.request.get(downloadPath)).status()).toBe(403);
    const probeCount = await requestCount('media');
    expect(probeCount).toBe(2);

    const page = await visitor.newPage();
    const nativeResponses: Array<{ status: number; contentRange: string | null }> = [];
    const successfulStatic = new Set<string>();
    const forbidden: Array<{ type: string; method: string; reason: string; path?: string; scheme?: string }> = [];
    const observed = { document: 0, metadata: 0, media: 0, download: 0, static: 0, localControlImages: 0 };
    let downloadEnabled = false;
    visitor.on('request', request => {
      const url = new URL(request.url());
      const frame = (() => { try { return request.frame(); } catch { return null; } })();
      const record: Task7RequestRecord = {
        method: request.method(), origin: url.origin === gate.origin ? ':same-origin' : ':different-origin',
        pathname: url.pathname, search: url.search, resourceType: request.resourceType(),
        navigation: request.isNavigationRequest(), range: request.headers().range ?? null,
        pageRole: frame?.page() === page ? 'primary' : 'secondary',
        frameRole: frame === page.mainFrame() ? 'main' : 'child',
      };
      const primary = record.method === 'GET' && record.origin === ':same-origin'
        && record.pageRole === 'primary' && record.frameRole === 'main';
      // WebKit's built-in controls render local blob images. These do not use HTTP.
      if (isWebKit && url.protocol === 'blob:' && primary && !record.search && !url.hash && !record.navigation
        && record.range === null && record.resourceType === 'image'
        && /^\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(url.pathname.slice(gate.origin.length))) {
        observed.localControlImages++;
      } else if (matchesShareBuildAsset(buildAssets, record)) observed.static++;
      else if (primary && !record.search && record.pathname === link.pathname && record.navigation
        && record.resourceType === 'document' && record.range === null) observed.document++;
      else if (primary && !record.search && record.pathname === metadataPath && !record.navigation
        && record.resourceType === 'fetch' && record.range === null) observed.metadata++;
      else if (primary && !record.search && record.pathname === mediaPath && !record.navigation
        && record.resourceType === 'media' && (record.range === null || /^bytes=\d+-\d*$/u.test(record.range))) observed.media++;
      else if (primary && downloadEnabled && !record.search && record.pathname === downloadPath
        && record.resourceType === 'document' && record.navigation && record.range === null) observed.download++;
      else forbidden.push({
        type: record.resourceType, method: record.method,
        scheme: url.protocol,
        path: url.origin === gate.origin && /^[a-z0-9_./-]{1,80}$/iu.test(url.pathname)
          && !url.pathname.includes(token) && !url.pathname.includes(item.itemRef) ? url.pathname : '[redacted]',
        reason: !primary ? 'non-primary context, origin or method'
          : record.pathname === '/favicon.ico' ? 'unexpected favicon request type or version' : 'unexpected route or resource',
      });
    });
    page.on('websocket', () => forbidden.push({ type: 'websocket', method: 'GET', reason: 'unexpected connection' }));
    page.on('response', response => {
      const url = new URL(response.url());
      const type = response.request().resourceType();
      if (url.origin === gate.origin && response.ok() && buildAssets.some(asset =>
        url.pathname === asset.pathname && url.search === asset.search && type === asset.resourceType)) {
        successfulStatic.add(type);
      }
      if (url.pathname === mediaPath) {
        nativeResponses.push({ status: response.status(), contentRange: response.headers()['content-range'] ?? null });
      }
    });

    // Do not intercept or mock any requests: WebKit's native media process must issue the Range itself.
    await page.goto(link.toString(), { waitUntil: 'domcontentloaded' }).catch(() => {
      throw new Error('The browser could not navigate to the isolated real share');
    });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const thumbnail = page.locator('[data-shared-media]');
    const expectedMedia = gate.origin + mediaPath;
    await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.locator('video').evaluate((video: HTMLVideoElement) => (
      video.videoWidth > 0 && Math.abs(video.videoWidth / video.videoHeight - 16 / 9) < 0.02
        && Math.abs(video.duration - 1) < 0.05 && video.readyState > 0
    )), { timeout: 15_000 }).toBe(true);
    expect(await thumbnail.locator('video').evaluate((element: HTMLVideoElement) => element.currentSrc) === expectedMedia).toBe(true);
    await thumbnail.click();
    const preview = page.getByRole('dialog', { name: '媒体预览' });
    const video = preview.locator('video');
    await expect(preview).toBeVisible();
    await expect(video).toHaveAttribute('controls', '');
    await expect(preview.getByRole('link', { name: '下载预览内容' })).toHaveCount(0);
    await video.evaluate((element: HTMLVideoElement) => {
      // Do not block the browser driver on the native play promise. Verify playback below.
      void element.play().catch(() => undefined);
    });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 5_000 })
      .toBeGreaterThan(0.1);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentSrc) === expectedMedia).toBe(true);
    // The Windows WebKit media process may bypass Playwright's HTTP events.
    // Read the token+item's real server counter to prove the browser hit this exact route.
    const nativeMediaCount = await requestCount('media') - probeCount;
    expect(nativeMediaCount).toBeGreaterThan(0);

    const downloadsBefore = await requestCount('download');
    const policy = await owner.request.patch('/api/canvas-shares/' + shareId, { headers, data: { allowDownload: true } });
    expect(policy.status()).toBe(200);
    downloadEnabled = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();
    const downloadLink = preview.getByRole('link', { name: '下载预览内容' });
    await expect(downloadLink).toBeVisible();
    expect(await downloadLink.getAttribute('href') === downloadPath).toBe(true);
    expect(await requestCount('download')).toBe(downloadsBefore);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 12_000 }), downloadLink.click()]);
    expect(download.url() === gate.origin + downloadPath).toBe(true);
    expect(download.suggestedFilename()).toMatch(/\.mp4$/u);
    const downloaded = await download.path();
    expect(downloaded !== null).toBe(true);
    expect(createHash('sha256').update(await readFile(downloaded!)).digest('hex')).toBe(checksum);
    expect(await requestCount('download')).toBe(downloadsBefore + 1);

    const revocation = await owner.request.post('/api/canvas-shares/' + shareId + '/revoke', { headers, data: {} });
    expect(revocation.status()).toBe(200);
    revoked = true;
    for (const path of [metadataPath, mediaPath, downloadPath]) {
      expect((await visitor.request.get(path)).status()).toBe(404);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();
    await page.close();
    expect(forbidden).toEqual([]);
    expect(observed).toMatchObject({ document: 3, metadata: 3 });
    expect([...successfulStatic]).toEqual(expect.arrayContaining(['script', 'stylesheet']));
    await testInfo.attach('real-share-video-redacted-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({ nativeResponses, observed, nativeMediaCount, rangeProbeStatus: partial.status(),
        sourcePixels: [160, 90], played: true, exactMediaSource: true, downloadMatchesSource: true,
        verifiedBuild: buildId, successfulStatic: [...successfulStatic].sort(),
        accessAfterRevoke: 404, forbiddenRequests: forbidden.length, viewport: page.viewportSize(), browserName }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(token ? message.replaceAll(token, '[share-token]') : message);
  } finally {
    try {
      if (shareId && !revoked) {
        const ok = await owner.request.post('/api/canvas-shares/' + shareId + '/revoke', { headers, data: {} })
          .then(response => response.ok(), () => false);
        if (!ok) throw new Error('Could not revoke the isolated share; its configured expiry is three minutes');
      }
    } finally {
      await Promise.allSettled([visitor.close(), owner.close(), client.end()]);
    }
  }
});
