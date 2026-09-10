import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test as base, type APIResponse, type Locator, type Page, type TestInfo } from '@playwright/test';
import JSZip from 'jszip';
import { Pool } from 'pg';
import sharp from 'sharp';

import {
  ensureStage4Session,
  openStage4CanvasProject,
  seedStage4Baseline,
  stage4FixtureForProject,
} from './stage-4-e2e';

const SKILL_ID = 'preset-multi-platform-export';
const RESULT_SCHEMA_ID = 'multi-platform-export-result-v1';
const PRESET_REFS = ['instagram-post-v1', 'youtube-thumbnail-v1'] as const;

interface ExportFailure {
  sourceAssetVersionId: string;
  presetId?: string;
  code: string;
  retryable: boolean;
}

interface ExportResult {
  schemaVersion: 1;
  runId: string;
  outcome: 'completed' | 'partial_success';
  imageAssetVersionIds: string[];
  manifestAssetVersionId?: string;
  zipAssetVersionId?: string;
  failures: ExportFailure[];
  lineage?: { rootRunId?: string; retryOfRunId?: string; attempt?: number };
}

export interface ExportRunEvidence {
  runId: string;
  status: string;
  creditCost: number;
  assetVersionIds: string[];
  outputs: unknown[];
  result: ExportResult;
  raw: Record<string, unknown>;
}

interface SourceFixture {
  id: string;
  assetId: string;
  placementId: string;
  entityId: string;
  name: string;
  url: string;
  width: number;
  height: number;
  checksum?: string;
}

interface SourceFixtures {
  landscape: SourceFixture;
  portrait: SourceFixture;
  square: SourceFixture;
  transparent: SourceFixture;
  chinese: SourceFixture;
  duplicate: SourceFixture;
  corrupt: SourceFixture;
}

interface EvidenceEntry {
  at: string;
  type: string;
  method?: string;
  status?: number;
  text?: string;
  url?: string;
}

export interface MultiPlatformExportFixture {
  authUserId: string;
  projectId: string;
  sourceIds: string[];
  sources: SourceFixtures;
  evidenceDirectory: string;
  startApiRun(page: Page, input: {
    sourceAssetVersionIds: string[];
    targetPresetIds: string[];
  }): Promise<{ runId: string }>;
  retryFailedItems(page: Page, runId: string): Promise<{ runId: string }>;
  repairCorruptSource(): Promise<void>;
  prepareCancellationLoad(): Promise<string[]>;
  cancelRun(page: Page, runId: string): Promise<void>;
  failNextZipDownload(page: Page, versionId: string | undefined): Promise<void>;
  activeCanvasPlacementCount(): Promise<number>;
  dispose(): Promise<void>;
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim() || process.env.PGDATABASE_URL?.trim();
  if (!value) {
    throw new Error('BLOCKED: DATABASE_URL or PGDATABASE_URL is required for Task10 local E2E');
  }
  return value;
}

function safe(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password|signature|credential)=)[^&]+/giu, '$1[REDACTED]');
}

function commitIdentity(): string {
  return safe(process.env.MPE_EVIDENCE_COMMIT || process.env.GITHUB_SHA || 'working-tree');
}

function evidenceDirectory(testInfo: TestInfo): string {
  return join(
    process.cwd(),
    'test-results',
    'multi-platform-export',
    commitIdentity(),
    safe(testInfo.project.name),
    safe(testInfo.title),
    `retry-${testInfo.retry}`,
  );
}

async function json(response: Pick<APIResponse, 'json'> | Pick<Response, 'json'>): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function png(input: {
  width: number;
  height: number;
  rgba: { r: number; g: number; b: number; alpha: number };
}): Promise<Buffer> {
  return sharp({
    create: { width: input.width, height: input.height, channels: 4, background: input.rgba },
  }).png().toBuffer();
}

async function persistImage(page: Page, bytes: Buffer): Promise<string> {
  const response = await page.request.post('/api/save-image', {
    data: { imageUrl: `data:image/png;base64,${bytes.toString('base64')}` },
  });
  const payload = await json(response);
  expect(response.ok(), `save-image returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
  expect(payload.url).toEqual(expect.stringMatching(/^\/api\/serve-upload\/uploads\//u));
  return String(payload.url);
}

async function seedPresets(pool: Pool): Promise<void> {
  const now = Date.now();
  for (const preset of [
    {
      id: 'instagram-post', platform: 'instagram', usage: 'post', label: 'Instagram 帖子',
      width: 1080, height: 1080, recommendedFormat: 'jpeg', supportsTransparency: false,
    },
    {
      id: 'youtube-thumbnail', platform: 'youtube', usage: 'thumbnail', label: 'YouTube 封面',
      width: 1280, height: 720, recommendedFormat: 'jpeg', supportsTransparency: false,
    },
  ]) {
    await pool.query(
      `INSERT INTO wujie_platform_export_presets(
         preset_id, version, platform, usage, label, width, height, recommended_format,
         supports_transparency, enabled, created_at, updated_at
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
       ON CONFLICT (preset_id, version) DO UPDATE SET enabled = true, updated_at = EXCLUDED.updated_at`,
      [preset.id, preset.platform, preset.usage, preset.label, preset.width, preset.height,
        preset.recommendedFormat, preset.supportsTransparency, now],
    );
  }
}

async function seedCancellationPresets(pool: Pool, profile: string): Promise<string[]> {
  const now = Date.now();
  const references: string[] = [];
  for (let index = 0; index < 14; index += 1) {
    const id = `mpe-cancel-${profile}-${index + 1}`;
    await pool.query(
      `INSERT INTO wujie_platform_export_presets(
         preset_id, version, platform, usage, label, width, height, recommended_format,
         supports_transparency, enabled, created_at, updated_at
       ) VALUES ($1, 1, 'test-cancel', $2, $3, 1024, 1024, 'png', true, true, $4, $4)`,
      [id, `variant-${index + 1}`, `取消压力预设 ${index + 1}`, now],
    );
    references.push(`${id}-v1`);
  }
  return references;
}

async function seedProjectSnapshots(
  pool: Pool,
  ownerId: string,
  canvasProject: Record<string, unknown>,
  chatProject: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  for (const [key, value] of [
    ['projects', [{ ...canvasProject, userId: ownerId }]],
    ['chat_simple_projects', [{ ...chatProject, userId: ownerId }]],
    ['__asset_graph_projects_revision', 1],
  ] as const) {
    await pool.query(
      `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (user_id, data_key) DO UPDATE SET
         data_value = EXCLUDED.data_value,
         updated_at = EXCLUDED.updated_at`,
      [ownerId, key, JSON.stringify(value), now],
    );
  }
}

async function seedSource(input: {
  page: Page;
  pool: Pool;
  ownerId: string;
  projectId: string;
  profile: string;
  key: string;
  name: string;
  bytes: Buffer;
  width: number;
  height: number;
  url?: string;
  canvas?: boolean;
}): Promise<SourceFixture> {
  const id = `mpe-version-${input.profile}-${input.key}`;
  const assetId = `mpe-asset-${input.profile}-${input.key}`;
  const placementId = `mpe-placement-${input.profile}-${input.key}`;
  const url = input.url ?? await persistImage(input.page, input.bytes);
  const checksum = input.key === 'corrupt'
    ? undefined
    : `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
  await input.pool.query(
    `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, metadata)
     VALUES ($1, $2, $3, 'image', 'active', $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = 'active', metadata = EXCLUDED.metadata`,
    [assetId, input.ownerId, input.projectId, JSON.stringify({ name: input.name })],
  );
  await input.pool.query(
    `INSERT INTO wujie_asset_versions(
       id, asset_id, owner_id, project_id, file_url, checksum, mime_type, byte_size,
       width, height, availability, idempotency_key, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, 'image/png', $7, $8, $9, 'ready', $10, $11::jsonb)
     ON CONFLICT (id) DO UPDATE SET file_url = EXCLUDED.file_url, checksum = EXCLUDED.checksum,
       byte_size = EXCLUDED.byte_size, width = EXCLUDED.width, height = EXCLUDED.height,
       availability = 'ready', metadata = EXCLUDED.metadata`,
    [
      id, assetId, input.ownerId, input.projectId, url, checksum ?? null, input.bytes.length,
      input.width, input.height, `mpe:${input.profile}:${input.key}`,
      JSON.stringify({ name: input.name, source: 'task10-controlled-local' }),
    ],
  );
  await input.pool.query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, id]);
  if (input.canvas !== false) {
    await input.pool.query(
      `INSERT INTO wujie_workspace_placements(
         id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id, status
       ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7, 'active')
       ON CONFLICT (id) DO UPDATE SET asset_version_id = EXCLUDED.asset_version_id, status = 'active'`,
      [placementId, input.ownerId, input.projectId, assetId, id, `canvas:${input.projectId}`, `mpe-image-${input.profile}-${input.key}`],
    );
  }
  return {
    id,
    assetId,
    placementId,
    entityId: `mpe-image-${input.profile}-${input.key}`,
    name: input.name,
    url,
    width: input.width,
    height: input.height,
    checksum,
  };
}

async function setupFixture(page: Page, testInfo: TestInfo, directory: string): Promise<MultiPlatformExportFixture> {
  const profile = safe(`${testInfo.project.name}-${randomUUID().slice(0, 8)}`);
  const baseFixture = await stage4FixtureForProject(testInfo.project.name);
  const fixture = {
    ...baseFixture,
    username: baseFixture.username.replace(/^stage4_/u, `stage4_${profile}_`),
  };
  const auth = await ensureStage4Session(page, fixture);
  const projectId = `mpe-project-${profile}`;
  const pool = new Pool({ connectionString: databaseUrl() });
  const dataRoot = resolve(process.env.WUJIE_DATA_DIR || './data');
  const corruptFilename = `mpe-corrupt-${profile}.png`;
  const corruptPath = join(dataRoot, 'uploads', corruptFilename);
  await mkdir(join(dataRoot, 'uploads'), { recursive: true });
  fixture.canvasProject = {
    ...fixture.canvasProject,
    id: projectId,
    userId: auth.userId,
    name: `Task10 中文项目 ${profile}`,
    canvasImages: [],
  };

  const valid = {
    landscape: await png({ width: 96, height: 48, rgba: { r: 220, g: 50, b: 47, alpha: 1 } }),
    portrait: await png({ width: 48, height: 96, rgba: { r: 38, g: 139, b: 210, alpha: 1 } }),
    square: await png({ width: 64, height: 64, rgba: { r: 133, g: 153, b: 0, alpha: 1 } }),
    transparent: await png({ width: 72, height: 72, rgba: { r: 181, g: 137, b: 0, alpha: 0.45 } }),
    chinese: await png({ width: 80, height: 60, rgba: { r: 108, g: 113, b: 196, alpha: 1 } }),
    duplicate: await png({ width: 80, height: 60, rgba: { r: 42, g: 161, b: 152, alpha: 1 } }),
  };

  try {
    await seedStage4Baseline(page, fixture, auth);
    await pool.query(
      `INSERT INTO wujie_projects(id, owner_id, name, status)
       VALUES ($1, $2, $3, 'active') ON CONFLICT (id) DO NOTHING`,
      [projectId, auth.userId, `Task10 中文项目 ${profile}`],
    );
    await seedPresets(pool);
    const sourceInputs = [
      ['landscape', '横图', valid.landscape, 96, 48],
      ['portrait', '竖图', valid.portrait, 48, 96],
      ['square', '方图', valid.square, 64, 64],
      ['transparent', '透明 PNG', valid.transparent, 72, 72],
      ['chinese', '中文素材', valid.chinese, 80, 60],
      ['duplicate', '中文素材', valid.duplicate, 80, 60],
    ] as const;
    const seeded: SourceFixture[] = [];
    for (const [key, name, bytes, width, height] of sourceInputs) {
      seeded.push(await seedSource({
        page, pool, ownerId: auth.userId, projectId, profile, key, name, bytes, width, height,
      }));
    }
    await writeFile(corruptPath, Buffer.from('controlled corrupt png source', 'utf8'));
    const corrupt = await seedSource({
      page, pool, ownerId: auth.userId, projectId, profile, key: 'corrupt', name: '损坏来源',
      bytes: Buffer.from('controlled corrupt png source', 'utf8'), width: 1, height: 1,
      url: `/api/serve-upload/uploads/${corruptFilename}`, canvas: false,
    });
    const [landscape, portrait, square, transparent, chinese, duplicate] = seeded;
    const sources: SourceFixtures = { landscape, portrait, square, transparent, chinese, duplicate, corrupt };
    fixture.canvasProject = {
      ...fixture.canvasProject,
      id: projectId,
      userId: auth.userId,
      name: `Task10 中文项目 ${profile}`,
      canvasImages: seeded.map((source, index) => ({
        id: `mpe-image-${profile}-${sourceInputs[index][0]}`,
        url: source.url,
        x: 80 + (index % 3) * 220,
        y: 80 + Math.floor(index / 3) * 180,
        width: 160,
        height: 120,
        originalWidth: source.width,
        originalHeight: source.height,
        rotation: 0,
        zIndex: index + 1,
        createdAt: Date.now() + index,
        prompt: `${source.name}-${index + 1}`,
        assetId: source.assetId,
        assetVersionId: source.id,
        placementId: source.placementId,
      })),
    };
    await seedProjectSnapshots(
      pool,
      auth.userId,
      fixture.canvasProject as Record<string, unknown>,
      fixture.chatProject as Record<string, unknown>,
    );

    const startApiRun = async (targetPage: Page, request: {
      sourceAssetVersionIds: string[];
      targetPresetIds: string[];
      background?: string;
    }): Promise<{ runId: string }> => {
      if (request.sourceAssetVersionIds.includes(corrupt.id)) {
        await pool.query(
          `INSERT INTO wujie_workspace_placements(
             id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
             workspace_id, entity_type, entity_id, status
           ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7, 'active')
           ON CONFLICT (id) DO UPDATE SET asset_version_id = EXCLUDED.asset_version_id, status = 'active'`,
          [
            corrupt.placementId,
            auth.userId,
            projectId,
            corrupt.assetId,
            corrupt.id,
            `canvas:${projectId}`,
            `mpe-corrupt-${profile}`,
          ],
        );
      }
      const response = await targetPage.request.post('/api/skill-runs', {
        data: {
          skillId: SKILL_ID,
          skillVersion: 1,
          surface: 'canvas',
          projectId,
          workspaceId: `canvas:${projectId}`,
          inputValues: {
            sourceAssetVersionIds: request.sourceAssetVersionIds,
            targetPresetIds: request.targetPresetIds,
            fit: 'contain',
            background: request.background ?? '#ffffffff',
            namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
          },
          sourceVersionIds: request.sourceAssetVersionIds,
          modelBindings: {},
          idempotencyKey: `mpe-e2e:${profile}:${randomUUID()}`,
        },
      });
      const payload = await json(response);
      expect(response.ok(), `skill run create returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
      expect(typeof payload.runId).toBe('string');
      return { runId: String(payload.runId) };
    };

    return {
      authUserId: auth.userId,
      projectId,
      sourceIds: seeded.map(source => source.id),
      sources,
      evidenceDirectory: directory,
      startApiRun,
      async retryFailedItems(targetPage, runId) {
        const response = await targetPage.request.post(`/api/skill-runs/${encodeURIComponent(runId)}/retry`, {
          data: { stepId: 'export' },
        });
        const payload = await json(response);
        expect(response.ok(), `retry returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
        expect(typeof payload.runId).toBe('string');
        return { runId: String(payload.runId) };
      },
      async repairCorruptSource() {
        const repairedUrl = await persistImage(page, valid.square);
        await pool.query(
          `UPDATE wujie_asset_versions SET file_url = $2, checksum = $3, byte_size = $4, width = 64, height = 64
           WHERE id = $1`,
          [
            corrupt.id,
            repairedUrl,
            `sha256:${createHash('sha256').update(valid.square).digest('hex')}`,
            valid.square.length,
          ],
        );
      },
      async prepareCancellationLoad() {
        return seedCancellationPresets(pool, profile);
      },
      async cancelRun(targetPage, runId) {
        const response = await targetPage.request.patch(`/api/skill-runs/${encodeURIComponent(runId)}`, {
          data: { action: 'cancel' },
        });
        expect(response.ok(), `cancel returned HTTP ${response.status()}`).toBe(true);
      },
      async failNextZipDownload(targetPage, versionId) {
        if (!versionId) throw new Error('ZIP AssetVersion is missing');
        let remaining = 1;
        await targetPage.route('**/api/assets?**', async route => {
          const url = new URL(route.request().url());
          if (remaining > 0 && url.searchParams.get('assetVersionId') === versionId) {
            remaining -= 1;
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'CONTROLLED_DOWNLOAD_FAILURE' }) });
            return;
          }
          await route.continue();
        });
      },
      async activeCanvasPlacementCount() {
        const result = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM wujie_workspace_placements
           WHERE owner_id = $1 AND project_id = $2 AND workspace_kind = 'canvas' AND status = 'active'`,
          [auth.userId, projectId],
        );
        return Number(result.rows[0]?.count ?? 0);
      },
      async dispose() {
        await pool.end();
        await rm(corruptPath, { force: true });
      },
    };
  } catch (error) {
    await pool.end();
    await rm(corruptPath, { force: true });
    throw error;
  }
}

export const test = base.extend<{ multiPlatformExport: MultiPlatformExportFixture }>({
  multiPlatformExport: [async ({ page }, useFixture, testInfo) => {
    const directory = evidenceDirectory(testInfo);
    const consoleEntries: EvidenceEntry[] = [];
    const networkEntries: EvidenceEntry[] = [];
    await mkdir(directory, { recursive: true });
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleEntries.push({ at: new Date().toISOString(), type: message.type(), text: redact(message.text()) });
      }
    });
    page.on('pageerror', error => {
      consoleEntries.push({ at: new Date().toISOString(), type: 'pageerror', text: redact(error.message) });
    });
    page.on('requestfailed', request => {
      networkEntries.push({
        at: new Date().toISOString(), type: 'requestfailed', method: request.method(),
        text: redact(request.failure()?.errorText || 'request failed'), url: redact(request.url()),
      });
    });
    page.on('response', response => {
      if (response.status() >= 400 || response.url().includes('/api/skill-runs')) {
        networkEntries.push({
          at: new Date().toISOString(), type: 'response', method: response.request().method(),
          status: response.status(), url: redact(response.url()),
        });
      }
    });
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    let fixture: MultiPlatformExportFixture | undefined;
    let fixtureError: unknown;
    try {
      fixture = await setupFixture(page, testInfo, directory);
      await useFixture(fixture);
    } catch (error) {
      fixtureError = error;
      throw error;
    } finally {
      await writeFile(join(directory, 'console.json'), JSON.stringify(consoleEntries, null, 2));
      await writeFile(join(directory, 'network.json'), JSON.stringify(networkEntries, null, 2));
      await page.screenshot({ path: join(directory, 'final.png'), fullPage: true }).catch(() => undefined);
      await page.context().tracing.stop({ path: join(directory, 'trace.zip') }).catch(() => undefined);
      const video = page.video();
      if (video) {
        await page.context().close().catch(() => undefined);
        const videoPath = await video.path().catch(() => undefined);
        if (videoPath) await copyFile(videoPath, join(directory, 'video.webm')).catch(() => undefined);
      }
      const files = await Promise.all(
        ['console.json', 'network.json', 'final.png', 'trace.zip', 'video.webm'].map(async name => {
          const path = join(directory, name);
          const body = await readFile(path).catch(() => undefined);
          return body ? { name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') } : { name, missing: true };
        }),
      );
      await writeFile(join(directory, 'evidence-manifest.json'), JSON.stringify({
        evidenceKind: 'controlled-local-playwright',
        cloudVerified: false,
        commit: commitIdentity(),
        browser: testInfo.project.name,
        test: testInfo.title,
        status: fixtureError ? 'failed' : testInfo.status,
        files,
      }, null, 2));
      if (fixture) await fixture.dispose().catch(() => undefined);
    }
  }, { auto: true }],
});

test.use({ trace: 'off', video: 'on' });

export { expect };

export async function openCanvasExportDrawer(page: Page, fixture: MultiPlatformExportFixture): Promise<Locator> {
  await openStage4CanvasProject(page, fixture.projectId);
  await page.locator(`[data-canvas-image-id="${fixture.sources.landscape.entityId}"]`).click();
  const expand = page.getByRole('button', { name: '展开面板', exact: true });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
  await page.getByTitle('添加图片引用').click();
  const labels = ['横图-1', '竖图-2', '方图-3', '透明 PNG-4', '中文素材-5', '中文素材-6'];
  for (const [index, label] of labels.entries()) {
    await page.getByRole('menuitem', { name: label }).click();
    await expect(page.getByText(`${index + 1}张图片引用`, { exact: true })).toBeVisible({ timeout: 20_000 });
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Skills技能库' }).click();
  await page.getByPlaceholder('搜索 Skills...').fill('多平台批量导出');
  await page.getByText('多平台批量导出', { exact: true }).last().click();
  const drawer = page.getByTestId('multi-platform-export-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

export async function startCanvasExportFromDrawer(
  page: Page,
  drawer: Locator,
  input: {
    targetLabels: string[];
    fit: 'cover' | 'contain';
    namingTemplate: string;
    background?: 'transparent' | string;
  },
): Promise<{ runId: string }> {
  for (const label of input.targetLabels) await drawer.getByLabel(label).check();
  await drawer.getByRole('button', { name: input.fit === 'contain' ? '完整留白' : '裁切填充' }).click();
  const transparentBackground = drawer.getByLabel('透明背景');
  if (input.background === 'transparent') {
    await transparentBackground.check();
  } else {
    await transparentBackground.uncheck();
  }
  await drawer.getByLabel('命名模板').fill(input.namingTemplate);
  const estimate = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/skill-runs/estimate'
  ));
  await drawer.getByRole('button', { name: '校验计划' }).click();
  const estimateResponse = await estimate;
  const estimatePayload = await json(estimateResponse);
  expect(
    estimateResponse.ok(),
    `导出计划校验失败：HTTP ${estimateResponse.status()} ${JSON.stringify(estimatePayload)}`,
  ).toBe(true);
  await expect(drawer.getByText('服务端校验成功')).toBeVisible();
  const submission = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/skill-runs'
  ));
  await drawer.getByRole('button', { name: '开始导出' }).click();
  const response = await submission;
  const payload = await response.json() as Record<string, unknown>;
  expect(response.ok(), `导出提交失败：HTTP ${response.status()} ${JSON.stringify(payload)}`).toBe(true);
  return { runId: String(payload.runId) };
}

function parseResult(outputs: unknown): ExportResult | undefined {
  if (!Array.isArray(outputs)) return undefined;
  for (const output of [...outputs].reverse()) {
    if (!output || typeof output !== 'object') continue;
    const record = output as Record<string, unknown>;
    if (record.kind !== 'json' || record.schemaId !== RESULT_SCHEMA_ID || typeof record.content !== 'string') continue;
    try {
      return JSON.parse(record.content) as ExportResult;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function readExportRun(
  page: Page,
  runId: string,
  terminalStatus: 'completed' | 'failed' | 'cancelled',
): Promise<ExportRunEvidence> {
  let raw: Record<string, unknown> = {};
  await expect.poll(async () => {
    const response = await page.request.get(`/api/skill-runs/${encodeURIComponent(runId)}?observeOnly=true`);
    if (!response.ok()) return `HTTP-${response.status()}`;
    const payload = await json(response);
    raw = (payload.run && typeof payload.run === 'object' ? payload.run : {}) as Record<string, unknown>;
    return String(raw.status || 'missing');
  }, { timeout: 150_000, intervals: [100, 250, 500, 1_000, 2_000] }).toBe(terminalStatus);
  const outputs = Array.isArray(raw.outputs) ? raw.outputs : [];
  const result = parseResult(outputs) ?? {
    schemaVersion: 1,
    runId,
    outcome: 'partial_success',
    imageAssetVersionIds: [],
    failures: [],
  };
  return {
    runId,
    status: String(raw.status),
    creditCost: Number(raw.creditCost ?? 0),
    assetVersionIds: Array.isArray(raw.assetVersionIds) ? raw.assetVersionIds.filter((value): value is string => typeof value === 'string') : [],
    outputs,
    result,
    raw,
  };
}

async function assetReference(page: Page, projectId: string, versionId: string): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ projectId, assetVersionId: versionId });
  const response = await page.request.get(`/api/assets?${query.toString()}`);
  const payload = await json(response);
  expect(response.ok(), `asset ${versionId} returned HTTP ${response.status()}`).toBe(true);
  return payload;
}

export async function verifyDownloadedExportBundle(
  page: Page,
  fixture: MultiPlatformExportFixture,
  run: ExportRunEvidence,
): Promise<void> {
  const manifestId = run.result.manifestAssetVersionId;
  const zipId = run.result.zipAssetVersionId;
  expect(manifestId).toBeTruthy();
  expect(zipId).toBeTruthy();
  const manifestReference = await assetReference(page, fixture.projectId, manifestId!);
  const zipReference = await assetReference(page, fixture.projectId, zipId!);
  const manifestResponse = await page.request.get(String(manifestReference.url));
  const zipResponse = await page.request.get(String(zipReference.url));
  expect(manifestResponse.ok()).toBe(true);
  expect(zipResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as {
    runId: string;
    files: Array<{
      filename: string;
      derivedAssetVersionId: string;
      sourceAssetVersionId: string;
      width: number;
      height: number;
      mimeType: string;
      sha256: string;
    }>;
  };
  expect(manifest.runId).toBe(run.runId);
  expect(manifest.files).toHaveLength(run.result.imageAssetVersionIds.length);
  const archive = await JSZip.loadAsync(Buffer.from(await zipResponse.body()));
  const zipNames = Object.keys(archive.files).sort();
  expect(zipNames).toEqual([...manifest.files.map(file => file.filename), 'manifest.json'].sort());
  expect(new Set(manifest.files.map(file => file.filename)).size).toBe(manifest.files.length);
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    for (const file of manifest.files) {
      const entry = archive.file(file.filename);
      expect(entry, `ZIP entry ${file.filename}`).not.toBeNull();
      const bytes = await entry!.async('nodebuffer');
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(file.sha256);
      const metadata = await sharp(bytes).metadata();
      expect(metadata.width).toBe(file.width);
      expect(metadata.height).toBe(file.height);
      expect(`image/${metadata.format}`).toBe(file.mimeType);
      const parents = await pool.query(
        'SELECT parent_version_id FROM wujie_asset_version_parents WHERE version_id = $1',
        [file.derivedAssetVersionId],
      );
      expect(parents.rows.map(row => row.parent_version_id)).toEqual([file.sourceAssetVersionId]);
    }
    const ledger = await pool.query(
      `SELECT COUNT(*)::int AS count FROM wujie_credit_transactions WHERE task_id = $1`,
      [run.runId],
    );
    expect(Number(ledger.rows[0]?.count || 0)).toBe(0);
  } finally {
    await pool.end();
  }
  await writeFile(join(fixture.evidenceDirectory, 'bundle-summary.json'), JSON.stringify({
    runId: run.runId,
    manifestAssetVersionId: manifestId,
    zipAssetVersionId: zipId,
    files: manifest.files,
    evidenceKind: 'real-local-postgres-sharp',
    cloudVerified: false,
  }, null, 2));
}

export async function restoreCanvasExportRun(
  page: Page,
  fixture: MultiPlatformExportFixture,
  runId: string,
): Promise<void> {
  let drawer = page.getByTestId('multi-platform-export-drawer');
  if (!await drawer.isVisible().catch(() => false)) drawer = await openCanvasExportDrawer(page, fixture);
  const history = drawer.getByRole('button', { name: `查看任务 ${runId}` });
  await expect(history).toBeVisible({ timeout: 20_000 });
  await history.click();
  await expect(drawer.getByRole('button', { name: '下载 ZIP' })).toBeVisible({ timeout: 90_000 });
}

export async function assertNoMobileOverflow(
  page: Page,
  drawer: Locator,
  evidenceDirectoryPath: string,
): Promise<void> {
  const measurements = await drawer.evaluate(element => {
    const controls = [...element.querySelectorAll('button, input')];
    const viewportWidth = document.documentElement.clientWidth;
    return {
      viewportWidth,
      documentOverflow: document.documentElement.scrollWidth - viewportWidth,
      drawerOverflow: element.scrollWidth - element.clientWidth,
      clippedControls: controls.filter(control => {
        const rect = control.getBoundingClientRect();
        return rect.left < 0 || rect.right > viewportWidth || rect.width < 1 || rect.height < 1;
      }).length,
    };
  });
  expect(measurements.viewportWidth).toBe(375);
  expect(measurements.documentOverflow).toBeLessThanOrEqual(1);
  expect(measurements.drawerOverflow).toBeLessThanOrEqual(1);
  expect(measurements.clippedControls).toBe(0);
  await page.screenshot({ path: join(evidenceDirectoryPath, 'mobile.png') }).catch(() => undefined);
}

export async function verifyCrossWorkspaceProjection(
  page: Page,
  fixture: MultiPlatformExportFixture,
  canvasRun: ExportRunEvidence,
): Promise<void> {
  const project = async (workspace: 'workflow' | 'chat'): Promise<void> => {
    const response = await page.request.post('/api/assets/batch-transfer', {
      data: {
        transfers: canvasRun.result.imageAssetVersionIds.map(versionId => ({
          sourceVersion: versionId,
          targetProject: fixture.projectId,
          targetWorkspace: workspace === 'workflow'
            ? `workflow:shared:${canvasRun.runId}`
            : `standalone-chat:shared:${canvasRun.runId}`,
          entityType: workspace === 'workflow' ? 'workflow-output' : 'chat-result',
          entityId: `mpe-shared:${workspace}:${canvasRun.runId}:${versionId}`,
          idempotencyKey: `mpe-shared:${workspace}:${canvasRun.runId}:${versionId}`,
          metadata: { source: 'multi-platform-export', runId: canvasRun.runId },
        })),
      },
    });
    const payload = await json(response);
    expect(response.ok(), `${workspace} projection returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
    expect(payload.transfers).toEqual(expect.arrayContaining(
      canvasRun.result.imageAssetVersionIds.map(assetVersionId => expect.objectContaining({ assetVersionId })),
    ));
  };
  await project('workflow');
  await project('chat');

  const entityIds = (workspace: 'workflow' | 'chat') => canvasRun.result.imageAssetVersionIds
    .map(versionId => `mpe-shared:${workspace}:${canvasRun.runId}:${versionId}`);
  const pool = new Pool({ connectionString: databaseUrl() });
  let rows: Array<{ workspace_kind: string; asset_version_id: string; run_id: string }> = [];
  try {
    const result = await pool.query(
      `SELECT workspace_kind, asset_version_id, metadata->>'runId' AS run_id
       FROM wujie_workspace_placements
       WHERE owner_id=$1 AND project_id=$2 AND entity_id=ANY($3::text[])
       ORDER BY workspace_kind, asset_version_id`,
      [fixture.authUserId, fixture.projectId, [...entityIds('workflow'), ...entityIds('chat')]],
    );
    rows = result.rows;
  } finally {
    await pool.end();
  }
  expect(rows).toHaveLength(canvasRun.result.imageAssetVersionIds.length * 2);
  expect(new Set(rows.map(row => row.run_id))).toEqual(new Set([canvasRun.runId]));
  expect(new Set(rows.filter(row => row.workspace_kind === 'workflow').map(row => row.asset_version_id)))
    .toEqual(new Set(canvasRun.result.imageAssetVersionIds));
  expect(new Set(rows.filter(row => row.workspace_kind === 'chat').map(row => row.asset_version_id)))
    .toEqual(new Set(canvasRun.result.imageAssetVersionIds));
  await writeFile(join(fixture.evidenceDirectory, 'cross-workspace.json'), JSON.stringify({
    sharedRunId: canvasRun.runId,
    sharedAssetVersionIds: canvasRun.result.imageAssetVersionIds,
    workflow: rows.filter(row => row.workspace_kind === 'workflow'),
    simpleChat: rows.filter(row => row.workspace_kind === 'chat'),
    sharedContract: RESULT_SCHEMA_ID,
    cloudVerified: false,
  }, null, 2));
}

export async function verifyFailureEvidence(
  page: Page,
  fixture: MultiPlatformExportFixture,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.screenshot({ path: join(fixture.evidenceDirectory, 'failure.png'), fullPage: true }).catch(() => undefined);
  await testInfo.attach('multi-platform-export-evidence', {
    body: Buffer.from(JSON.stringify({
      directory: fixture.evidenceDirectory,
      evidenceKind: 'controlled-local-playwright',
      cloudVerified: false,
    }, null, 2)),
    contentType: 'application/json',
  });
}
