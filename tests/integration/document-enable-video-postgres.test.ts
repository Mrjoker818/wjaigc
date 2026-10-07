import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { CanvasImage, User } from '../../src/lib/user-types';
import type { DocumentMediaImportResult } from '../../src/lib/collaboration/canvas-asset-command';
import type { QueryFn } from '../helpers/postgres-test-database';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

// Only scheduling is replaced; NextRequest/NextResponse and route/auth handlers are real.
const videoAfter = vi.hoisted(() => ({ pending: [] as Array<() => void | Promise<void>> }));
vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => void | Promise<void>): void => { videoAfter.pending.push(callback); },
}));
const s3Metadata = vi.hoisted(() => ({ inspect: vi.fn(), read: vi.fn() }));
vi.mock('../../src/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/s3-storage')>(),
  inspectS3ObjectExact: s3Metadata.inspect,
  readS3ObjectRangeExact: s3Metadata.read,
}));
if (process.env.POSTGRES_TEST_DATABASE_URL) requireOfflineBridgeTestDatabaseUrl(process.env);
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL ? it : it.skip;
let mediaRoot = '';
let mp4: Buffer;
let webm: Buffer;
beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-owner-video-'));
  await mkdir(path.join(mediaRoot, 'uploads'));
  mp4 = Buffer.from((await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8')).trim(), 'base64');
  webm = Buffer.from((await readFile('tests/fixtures/yjs-task8b2-tiny-valid.webm.base64', 'utf8')).trim(), 'base64');
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  for (const [name, bytes] of [['valid.mp4', mp4], ['valid.webm', webm], ['image.png', png],
    ['mismatch.mp4', png], ['corrupt.mp4', Buffer.from('not a video')]] as const) {
    await writeFile(path.join(mediaRoot, 'uploads', name), bytes);
  }
  await writeFile(path.join(mediaRoot, 'outside.mp4'), mp4);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); s3Metadata.inspect.mockReset(); s3Metadata.read.mockReset(); });
afterAll(async () => {
  if (mediaRoot && path.dirname(mediaRoot) === path.resolve(tmpdir())
    && path.basename(mediaRoot).startsWith('wujie-owner-video-')) await rm(mediaRoot, { recursive: true, force: true });
});

describe('real managed videos at the collaboration enable boundary', () => {
  postgresIt.each(['mp4', 'webm', 'mixed', 'ready', 'ready-checkpoint', 'ready-source-changed',
    'ready-mime-invalid', 'ready-version-missing', 'ready-s3', 'ready-s3-identity-missing', 'legacy-s3',
    'legacy-s3-identity-missing', 'legacy-s3-too-large', 'legacy-s3-corrupt', 'legacy-s3-changed', 'legacy-s3-late-changed',
    'corrupt', 'missing', 'mismatch', 'traversal'])
    ('verifies %s before granting document authority', async scenario => {
      await withIsolatedPostgres(`owner-enable-video-${scenario}`, async ({ query }) => {
        vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
        vi.stubEnv('WUJIE_DATA_DIR', mediaRoot);
        for (const migration of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
          '20260811_wj_stable_s2_asset_transfer_idempotency.sql', '20260811_wj_stable_s2_cross_project_transfer.sql',
          '20260913_canvas_video_placements.sql', '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql']) {
          await query(await readFile(`migrations/${migration}`, 'utf8'));
        }
        await query(`CREATE TABLE wujie_user_data (user_id text, data_key text, data_value jsonb,
          updated_at bigint, PRIMARY KEY(user_id,data_key))`);
        await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
          VALUES ('owner-a','Owner','test','active',1,1)`);
        const ready = scenario.startsWith('ready');
        const legacyS3 = scenario.startsWith('legacy-s3');
        const s3 = scenario.startsWith('ready-s3') || legacyS3;
        const valid = ['mp4', 'webm', 'mixed', 'ready', 'ready-checkpoint', 'ready-s3', 'legacy-s3'].includes(scenario);
        const filename = s3 ? 'remote-only.mp4' : scenario === 'webm' ? 'valid.webm' : valid || ready ? 'valid.mp4' : `${scenario}.mp4`;
        let inspections = 0;
        if (s3) s3Metadata.inspect.mockImplementation(async (key: string) => {
          inspections++;
          const expectedKey = legacyS3 ? 'images/uploads/remote-only.mp4' : 'images/owner-a/remote-only.mp4';
          if (key !== expectedKey) throw new Error('unexpected object key');
          return { byteSize: scenario === 'legacy-s3-too-large' ? 201 * 1024 * 1024 : mp4.length,
            contentType: 'video/mp4',
            eTag: scenario.endsWith('identity-missing') ? null
              : (scenario === 'legacy-s3-changed' && inspections > 1)
                || (scenario === 'legacy-s3-late-changed' && inspections > 2)
                ? 'replacement-etag' : 'immutable-etag', versionId: null };
        });
        if (legacyS3) s3Metadata.read.mockImplementation(async (
          key: string, range: { start: number; end: number },
          options: { expectedTotalBytes: number; eTag?: string | null; maxBytes: number },
        ) => {
          expect(key).toBe('images/uploads/remote-only.mp4');
          expect(options.expectedTotalBytes).toBe(mp4.length);
          expect(options.eTag).toBe('immutable-etag');
          expect(options.maxBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
          const body = scenario === 'legacy-s3-corrupt' ? Buffer.alloc(mp4.length, 0) : mp4;
          return { bytes: body.subarray(range.start, range.end + 1), totalBytes: mp4.length,
            contentType: 'video/mp4', eTag: 'immutable-etag', versionId: null };
        });
        const url = scenario === 'traversal' ? '/api/serve-upload/uploads/../outside.mp4'
          : `/api/serve-upload/uploads/${filename}`;
        const video = { id: 'video-a', url, videoUrl: url, mediaType: 'video', createdAt: 1,
          ...(ready ? { assetId: 'asset-a', assetVersionId: scenario === 'ready-version-missing' ? 'foreign-version' : 'version-a', placementId: 'placement-a' } : {}),
          x: 0, y: 0, width: 40, height: 30, originalWidth: 9999, originalHeight: 9999, rotation: 0, zIndex: 0 };
        const image = { id: 'image-a', url: '/api/serve-upload/uploads/image.png', createdAt: 1,
          x: 50, y: 0, width: 40, height: 30, originalWidth: 2, originalHeight: 2, rotation: 0, zIndex: 1 };
        await query(`INSERT INTO wujie_user_data VALUES ('owner-a','projects',$1::jsonb,1)`, [JSON.stringify([{
          id: 'project-a', userId: 'owner-a', name: 'Video', createdAt: 1, updatedAt: 1,
          settings: {}, canvasImages: scenario === 'mixed' ? [video, image] : [video],
        }])]);
        const before = (await query('SELECT * FROM wujie_user_data')).rows;
        if (ready) {
          await query(`INSERT INTO wujie_projects (id,owner_id,name,schema_version,metadata)
            VALUES ('project-a','owner-a','Video',$1,'{"presenceProjection":true}'::jsonb)`,
          [scenario === 'ready-checkpoint' ? 3 : 1]);
          await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind,current_version_id)
            VALUES ('asset-a','owner-a','project-a','video',NULL)`);
          await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,
            mime_type,byte_size,width,height,availability) VALUES
            ('version-a','asset-a','owner-a','project-a',$1,$2,$3,16,16,'ready')`,
          [scenario === 'ready-source-changed' ? '/api/serve-upload/uploads/valid.webm' : url,
            scenario === 'ready-mime-invalid' ? 'image/png' : 'video/mp4', mp4.length]);
          await query(`UPDATE wujie_assets SET current_version_id='version-a' WHERE id='asset-a'`);
          if (s3) await query(`UPDATE wujie_asset_versions SET storage_key='images/owner-a/remote-only.mp4'
            WHERE id='version-a'`);
          await query(`INSERT INTO wujie_workspace_placements (id,owner_id,project_id,asset_id,asset_version_id,
            workspace_kind,workspace_id,entity_type,entity_id,transform) VALUES
            ('placement-a','owner-a','project-a','asset-a','version-a','canvas','project-a','canvas-video','video-a',
              '{"x":0,"y":0,"width":40,"height":30,"rotation":0,"zIndex":0}'::jsonb)`);
          if (scenario === 'ready-checkpoint') {
            await query(`INSERT INTO wujie_asset_migration_checkpoints
              (id,owner_id,project_id,legacy_project_id,status,checkpoint) VALUES
              ('checkpoint-a','owner-a','project-a','project-a','completed',
              '{"sourceSchemaVersion":1,"legacyImageMappings":{"video-a":{"assetId":"asset-a","versionId":"version-a","placementId":"placement-a"}}}'::jsonb)`);
          }
        }
        const originalVersions = (await query('SELECT * FROM wujie_asset_versions')).rows;
        const originalGraph = new Map<string, unknown[]>();
        for (const table of ['wujie_projects', 'wujie_assets', 'wujie_asset_versions',
          'wujie_workspace_placements', 'wujie_asset_migration_checkpoints']) {
          originalGraph.set(table, (await query(`SELECT * FROM ${table}`)).rows);
        }
        const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
        if (!valid) {
          await expect(enableCollaborativeProject('owner-a', 'project-a', 0)).rejects.toBeInstanceOf(Error);
          expect((await query('SELECT * FROM wujie_user_data')).rows).toEqual(before);
          for (const [table, rows] of originalGraph) {
            expect((await query(`SELECT * FROM ${table}`)).rows).toEqual(rows);
          }
          for (const table of ['wujie_project_canvas_documents', 'wujie_project_document_settings']) {
            expect((await query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
          }
          return;
        }
        await enableCollaborativeProject('owner-a', 'project-a', 0);
        if (scenario === 'legacy-s3') {
          expect((await query('SELECT storage_key FROM wujie_asset_versions')).rows)
            .toEqual([{ storage_key: 'images/uploads/remote-only.mp4' }]);
        }
        if (ready) {
          expect((await query('SELECT * FROM wujie_asset_versions')).rows).toEqual(originalVersions);
          const enabled = await query<{ projection: { placements: Record<string, { assetVersionId: string }> } }>(
            'SELECT projection FROM wujie_project_canvas_documents');
          expect(enabled.rows[0].projection.placements['placement-a'].assetVersionId).toBe('version-a');
        }
        const version = await query(`SELECT v.mime_type,v.byte_size::text,v.availability FROM wujie_asset_versions v
          JOIN wujie_assets a ON a.id=v.asset_id WHERE a.kind='video'`);
        expect(version.rows).toEqual([{ mime_type: scenario === 'webm' ? 'video/webm' : 'video/mp4',
          byte_size: String((scenario === 'webm' ? webm : mp4).length), availability: 'ready' }]);
        const document = await query<{ projection: { placements: Record<string, unknown> } }>('SELECT projection FROM wujie_project_canvas_documents');
        expect(Object.keys(document.rows[0].projection.placements)).toHaveLength(scenario === 'mixed' ? 2 : 1);
        if (s3) await expect(readFile(path.join(mediaRoot, 'uploads', filename))).rejects.toMatchObject({ code: 'ENOENT' });
        else expect(await readFile(path.join(mediaRoot, 'uploads', filename))).toEqual(scenario === 'webm' ? webm : mp4);
        expect((await query('SELECT credits FROM wujie_users')).rows).toEqual([{ credits: 0 }]);
      });
    });
});

// PROPOSAL ONLY: retain all 20 enable cases above, including their assertions/time limits.
// No DB, billing, authorization, publication, or session function is mocked below.
// Per-model video price is 2 credits/second; each 5-second task costs exactly 10.
// Chain remains OPEN: this file has no actual extraction/UI continuation fixture.
// Existing mocked route tests are a coverage gap, NOT an executed real-PG RED.
const routeProvider = 'real-pg-video-provider';
const routeModel = 'kling-v3';
const providerOrigin = 'https://stage7-video.invalid';
const routeOrigin = 'http://localhost:5012';
type VideoOperation = 'generate' | 'extend';
interface ProviderObservation {
  calls: Array<{ path: string; body: Record<string, unknown> }>;
  unexpected: string[];
  persistenceStatuses: number[];
  beforeResponse?: () => Promise<void>;
}
interface VideoRouteFixture {
  query: QueryFn;
  video: CanvasImage;
  frame: CanvasImage;
  provider: ProviderObservation;
  request(actor: string, endpoint: string, body: Record<string, unknown>, key?: string): Promise<NextRequest>;
}
async function videoBilling(query: QueryFn): Promise<Record<string, unknown[]>> {
  return {
    tasks: (await query('SELECT * FROM cloud_tasks ORDER BY id')).rows,
    publications: (await query('SELECT * FROM wujie_canvas_task_publications ORDER BY task_id')).rows,
    ledger: (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows,
    credits: (await query('SELECT * FROM wujie_credits ORDER BY user_id')).rows,
  };
}
async function drainVideoAfter(): Promise<void> {
  while (videoAfter.pending.length) await videoAfter.pending.shift()!();
}
function videoBody(f: VideoRouteFixture, operation: VideoOperation, source: CanvasImage = f.video): Record<string, unknown> {
  return { prompt: 'real route fixture', model: routeModel, providerId: routeProvider,
    duration: 5, extendDuration: 5, aspectRatio: '16:9', useDirector: false,
    projectId: 'route-shared', assetWorkspace: 'canvas', assetWorkspaceId: 'route-shared',
    assetProjectionMode: 'derived', assetParentVersionIds: [source.assetVersionId],
    assetSelectedEntityIds: [source.id],
    ...(operation === 'extend' ? { videoUrl: source.videoUrl || source.url } : { imageUrl: source.url }),
  };
}
async function submitVideo(f: VideoRouteFixture, operation: VideoOperation,
  body: Record<string, unknown>, key: string, actor = 'route-editor'): Promise<Response> {
  const route = operation === 'generate'
    ? await import('../../src/app/api/video/generate/route')
    : await import('../../src/app/api/video/extend/route');
  return route.POST(await f.request(actor, '/api/video/' + operation, body, key));
}
async function publishVideo(f: VideoRouteFixture, taskId: string, actor = 'route-editor'): Promise<Response> {
  const { POST } = await import('../../src/app/api/video/generate/route');
  return POST(await f.request(actor, '/api/video/generate',
    { action: 'publish-canvas-task', projectId: 'route-shared', taskId }));
}
async function withVideoRouteFixture(run: (fixture: VideoRouteFixture) => Promise<void>): Promise<void> {
  await withIsolatedPostgres('video-route-real-billing', async ({ query }) => {
    // Auth caches must not carry a secret ring from one real isolated schema to another.
    vi.resetModules();
    videoAfter.pending.length = 0;
    vi.stubEnv('WUJIE_AUTH_SECRET', randomBytes(48).toString('base64url'));
    vi.stubEnv('WUJIE_AUTH_PERSISTENCE_MODE', 'DB_ONLY');
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'asset-v3');
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.stubEnv('WUJIE_DATA_DIR', mediaRoot);
    vi.stubEnv('COZE_PROJECT_ENV', 'PROD'); // no public/uploads replica
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', routeOrigin); // application origin, NOT provider base URL
    vi.stubEnv('DEPLOY_RUN_PORT', '5012');
    const { ensureCoreTables } = await import('../../src/lib/db-storage');
    const { ensureCloudTaskTables } = await import('../../src/lib/cloud-task-storage');
    await ensureCoreTables();
    await ensureCloudTaskTables();
    for (const migration of [
      '20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
      '20260811_wj_stable_s2_asset_transfer_idempotency.sql', '20260811_wj_stable_s2_cross_project_transfer.sql',
      '20260909_mpe_cross_asset_parents.sql',
      '20260913_canvas_video_placements.sql', '20260925_yjs_canvas_editors.sql',
      '20260925_yjs_canvas_documents.sql', '20260926_yjs_canvas_authority_fence.sql',
      '20260927_yjs_canvas_asset_commands.sql', '20260925_yjs_canvas_asset_adoptions.sql',
      '20260927_yjs_canvas_media_imports.sql', '20260927_yjs_canvas_version_imports.sql',
      '20261004_yjs_canvas_removal_snapshots.sql', '20261006_yjs_canvas_media_batch_receipts.sql',
      '20260927_yjs_canvas_task_publications.sql', '20260927_yjs_canvas_task_publications_intent.sql',
    ]) await query(await readFile('migrations/' + migration, 'utf8'));
    const permissions: NonNullable<User['apiPermissions']> = {
      image: false, chat: false, threeD: false, imageEdit: false, vectorize: false,
      vlm: false, layer: false, video: true, upscaler: false, removebg: false, audio: false,
    };
    for (const id of ['route-owner', 'route-editor', 'route-outsider']) {
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,api_permissions,created_at,updated_at)
        VALUES ($1,$1,'fixture-only','active','user',$2::jsonb,1,1)`, [id, JSON.stringify(permissions)]);
    }
    await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
      SELECT 'credits_'||id,id,100,100,0,1,1 FROM wujie_users`);
    const capabilities = { version: 1, models: { [routeModel]: {
      protocol: 'rest-generic', executionMode: 'async', allowedRatios: ['16:9'],
      allowedSizes: [], qualityOptions: ['std'], maxOutputs: 1, supportsReferenceImages: true,
      maxReferenceImages: 2, supportsMask: false, allowedDurationsSeconds: [5],
      maxDurationSeconds: 5, supportedOperations: ['text-to-video', 'image-to-video',
        'first-last-frame', 'multi-reference', 'video-extend'], outputKinds: ['mp4'],
    } } };
    await query(`INSERT INTO wujie_api_providers(id,name,base_url,api_key,is_enabled,type,model_type,
      request_style,selected_models,advanced_params,discovered_models,created_at,updated_at)
      VALUES ($1,'PG video fixture',$2,$3,true,'video','video','video-generations',
        ARRAY[$4],$5::jsonb,$6::jsonb,1,1)`, [routeProvider, providerOrigin,
      randomBytes(24).toString('hex'), routeModel,
      JSON.stringify({ compatProfile: 'rest-generic', taskModelCapabilities: JSON.stringify(capabilities) }),
      JSON.stringify([{ id: routeModel, name: routeModel, type: 'video', providerId: routeProvider }])]);
    await query(`INSERT INTO wujie_system_settings(key,value,updated_at) VALUES
      ('credit_pricing_config',$1::jsonb,1),('videoGenerationEnabled','true'::jsonb,1)`,
    [JSON.stringify({ modelCredits: { [routeProvider + '::' + routeModel]: 2 } })]);
    const images = [
      { id: 'route-video', url: '/api/serve-upload/uploads/valid.mp4', videoUrl: '/api/serve-upload/uploads/valid.mp4',
        mediaType: 'video', x: 0, y: 0, width: 40, height: 30, rotation: 0, zIndex: 0,
        originalWidth: 16, originalHeight: 16, createdAt: 1 },
      { id: 'route-frame', url: '/api/serve-upload/uploads/image.png', x: 60, y: 0, width: 2, height: 2,
        rotation: 0, zIndex: 1, originalWidth: 2, originalHeight: 2, createdAt: 1 },
    ];
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('route-owner','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'route-shared', userId: 'route-owner', name: 'Video routes', createdAt: 1, updatedAt: 1,
      settings: {}, canvasImages: images,
    }])]);
    await writeFile(path.join(mediaRoot, 'uploads', 'personal-video.mp4'), mp4);
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('route-editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'route-personal', userId: 'route-editor', name: 'Personal', createdAt: 1, updatedAt: 1,
      settings: {}, canvasImages: [{ ...images[0], id: 'personal-video',
        url: '/api/serve-upload/uploads/personal-video.mp4', videoUrl: '/api/serve-upload/uploads/personal-video.mp4' }],
    }])]);
    const { enableCollaborativeProject, readCollaborativeProject } =
      await import('../../src/lib/collaboration/document-project-bridge');
    await enableCollaborativeProject('route-owner', 'route-shared', 0);
    const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
    await grantDocumentEditor('route-owner', 'route-shared', 'route-editor');
    const read = await readCollaborativeProject('route-editor', 'route-shared');
    const video = read.canvasImages.find(image => image.mediaType === 'video');
    const frame = read.canvasImages.find(image => image.url.endsWith('/image.png'));
    expect(video?.assetVersionId).toEqual(expect.any(String));
    expect(frame?.assetVersionId).toEqual(expect.any(String));
    if (!video || !frame) throw new Error('Real enabled canonical video/frame fixture missing');
    const { createSessionToken, WUJIE_SESSION_COOKIE } = await import('../../src/lib/server-auth');
    const cookies = new Map<string, string>();
    for (const id of ['route-owner', 'route-editor', 'route-outsider']) {
      cookies.set(id, WUJIE_SESSION_COOKIE + '=' + await createSessionToken({
        id, name: id, role: 'user', status: 'active', createdAt: 1, updatedAt: 1,
      }));
    }
    const provider: ProviderObservation = { calls: [], unexpected: [], persistenceStatuses: [] };
    const request = async (actor: string, endpoint: string, body: Record<string, unknown>, key?: string): Promise<NextRequest> =>
      new NextRequest(routeOrigin + endpoint, { method: 'POST',
        headers: { 'content-type': 'application/json', origin: routeOrigin,
          cookie: cookies.get(actor)!, 'x-wujie-expected-actor-id': actor,
          ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.origin === providerOrigin && method === 'POST'
        && ['/v1/video/generations', '/v1/video/extend'].includes(url.pathname)) {
        provider.calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        if (provider.beforeResponse) await provider.beforeResponse();
        return Response.json({ data: [{ url: '/api/serve-upload/uploads/valid.mp4' }] });
      }
      if (url.origin === providerOrigin && method === 'GET'
        && url.pathname === '/api/serve-upload/uploads/valid.mp4') {
        return new Response(new Uint8Array(mp4), { headers: { 'content-type': 'video/mp4' } });
      }
      // A relative provider result is resolved against the application origin by real persistence.
      if (url.origin === routeOrigin && method === 'GET'
        && url.pathname === '/api/serve-upload/uploads/valid.mp4') {
        const { GET } = await import('../../src/app/api/serve-upload/[...path]/route');
        return GET(new NextRequest(url), { params: Promise.resolve({ path: ['uploads', 'valid.mp4'] }) });
      }
      // In-memory dispatch to the REAL internal persistence route, with its original signed headers.
      // This is not a fake persistence response or a bypass of requireApiAuthOrReject.
      if (url.origin === routeOrigin && url.pathname === '/api/save-image' && method === 'POST') {
        const { POST } = await import('../../src/app/api/save-image/route');
        const response = await POST(new NextRequest(url, { ...init, signal: init?.signal ?? undefined }));
        provider.persistenceStatuses.push(response.status);
        return response;
      }
      provider.unexpected.push(url.origin + url.pathname);
      throw new Error('Unconfigured transport boundary');
    });
    const sourceIds = [video.assetVersionId!, frame.assetVersionId!];
    const original = (await query('SELECT * FROM wujie_asset_versions WHERE id=ANY($1::text[]) ORDER BY id', [sourceIds])).rows;
    const originalAssets = (await query('SELECT * FROM wujie_assets ORDER BY id')).rows;
    const originalPlacements = (await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows;
    const fixture = { query, video, frame, provider, request };
    const errors: unknown[] = [];
    try { await run(fixture); } catch (error) { errors.push(error); }
    finally {
      // Never leave queued completion work running after withIsolatedPostgres drops its schema.
      try {
        await drainVideoAfter();
        expect(provider.unexpected).toEqual([]);
        expect((await query('SELECT * FROM wujie_asset_versions WHERE id=ANY($1::text[]) ORDER BY id', [sourceIds])).rows).toEqual(original);
        expect((await query('SELECT * FROM wujie_assets WHERE id=ANY($1::text[]) ORDER BY id',
          [originalAssets.map(row => row.id)])).rows).toEqual(originalAssets);
        expect((await query('SELECT * FROM wujie_workspace_placements WHERE id=ANY($1::text[]) ORDER BY id',
          [originalPlacements.map(row => row.id)])).rows).toEqual(originalPlacements);
        expect(await readFile(path.join(mediaRoot, 'uploads', 'valid.mp4'))).toEqual(mp4);
        expect(s3Metadata.inspect).not.toHaveBeenCalled();
        expect(s3Metadata.read).not.toHaveBeenCalled();
      } catch (error) { errors.push(error); }
      finally { vi.unstubAllGlobals(); }
    }
    if (errors.length) throw new AggregateError(errors, 'Video route case / real isolation cleanup failed');
  });
}
async function assertVideoPublished(f: VideoRouteFixture, taskId: string, parent: CanvasImage): Promise<DocumentMediaImportResult> {
  const response = await publishVideo(f, taskId);
  // Safe failure evidence: no arbitrary error text/body, cookies, keys, tickets or URLs.
  const raw: unknown = await response.clone().json().catch(() => null);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const diagnostic = { status: response.status,
    ...(typeof body.success === 'boolean' ? { success: body.success } : {}),
    ...(typeof body.retryable === 'boolean' ? { retryable: body.retryable } : {}),
    ...(typeof body.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(body.code)
      ? { code: body.code } : {}) };
  expect(response.status, JSON.stringify(diagnostic)).toBe(200);
  const receipt = await response.json() as DocumentMediaImportResult;
  expect(receipt.assetReference).toMatchObject({ kind: 'video',
    assetVersionId: receipt.assetVersionId, placementId: receipt.placementId });
  expect((await f.query('SELECT owner_id,project_id,workspace_kind,workspace_id,entity_type FROM wujie_workspace_placements WHERE id=$1',
    [receipt.placementId])).rows).toEqual([{ owner_id: 'route-owner', project_id: 'route-shared',
      workspace_kind: 'canvas', workspace_id: 'route-shared', entity_type: 'canvas-video' }]);
  const rows = await f.query(`SELECT v.owner_id,v.project_id,v.task_id,v.provider_id,v.model_id,v.availability,
    v.mime_type,v.metadata FROM wujie_asset_versions v WHERE id=$1`, [receipt.assetVersionId]);
  expect(rows.rows).toEqual([{ owner_id: 'route-owner', project_id: 'route-shared', task_id: taskId,
    provider_id: routeProvider, model_id: routeModel, availability: 'ready', mime_type: 'video/mp4',
    metadata: { source: 'document-media-import', sourceVersionIds: [parent.assetVersionId] } }]);
  expect((await f.query('SELECT parent_version_id,parent_order FROM wujie_asset_version_parents WHERE version_id=$1',
    [receipt.assetVersionId])).rows).toEqual([{ parent_version_id: parent.assetVersionId, parent_order: 0 }]);
  const { readCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
  const read = await readCollaborativeProject('route-editor', 'route-shared');
  expect(read.canvasImages.filter(image => image.placementId === receipt.placementId)).toHaveLength(1);
  expect(read.canvasImages.find(image => image.placementId === receipt.placementId))
    .toMatchObject({ assetVersionId: receipt.assetVersionId, mediaType: 'video' });
  return receipt;
}
describe('real video routes, billing and document completion (proposed PG coverage)', () => {
  postgresIt.each(['generate', 'extend'] as const)('%s freezes source, bills actor, completes and replays once', async operation => {
    await withVideoRouteFixture(async f => {
      const parent = operation === 'extend' ? f.video : f.frame;
      const body = { ...videoBody(f, operation, parent), apiKey: 'must-not-persist-body-secret' };
      expect((await f.query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'route-editor', balance: 100 }, { user_id: 'route-outsider', balance: 100 },
          { user_id: 'route-owner', balance: 100 }]);
      const key = randomUUID();
      if (operation === 'extend') {
        const legacySource = await f.query(`SELECT p.entity_type,a.kind,v.mime_type,v.availability,
          p.owner_id,p.project_id,p.asset_id,p.asset_version_id,p.entity_id
          FROM wujie_workspace_placements p
          JOIN wujie_asset_versions v ON v.id=p.asset_version_id AND v.asset_id=p.asset_id
            AND v.owner_id=p.owner_id AND v.project_id=p.project_id
          JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
          WHERE p.id=$1 AND p.owner_id='route-owner' AND p.project_id='route-shared'
            AND p.workspace_kind='canvas' AND p.workspace_id IN ('route-shared','canvas:route-shared')
            AND p.deleted_at IS NULL AND p.status='active' AND a.status='active'`, [parent.placementId]);
        expect(legacySource.rows).toEqual([{ entity_type: 'canvas-image', kind: 'video',
          mime_type: 'video/mp4', availability: 'ready', owner_id: 'route-owner', project_id: 'route-shared',
          asset_id: parent.assetId, asset_version_id: parent.assetVersionId, entity_id: parent.id }]);
      }
      const response = await submitVideo(f, operation, body, key);
      expect(response.status).toBe(200);
      const { taskId } = await response.json() as { taskId: string };
      expect((await f.query('SELECT user_id,type,status,credit_status,credit_cost::text FROM cloud_tasks')).rows)
        .toEqual([{ user_id: 'route-editor', type: operation === 'extend' ? 'video-extend' : 'video',
          status: 'processing', credit_status: 'pending', credit_cost: '10' }]);
      expect((await f.query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'route-editor', balance: 90 }, { user_id: 'route-outsider', balance: 100 },
          { user_id: 'route-owner', balance: 100 }]);
      expect((await f.query('SELECT user_id,type,amount,task_id FROM wujie_credit_transactions WHERE task_id=$1',
        [taskId])).rows).toEqual([{ user_id: 'route-editor', type: 'consume', amount: -10, task_id: taskId }]);
      expect(f.provider.calls).toEqual([]);
      const publication = (await f.query('SELECT actor_id,owner_id,project_id,grant_generation::text,publication_intent FROM wujie_canvas_task_publications')).rows;
      expect(publication).toEqual([expect.objectContaining({ actor_id: 'route-editor', owner_id: 'route-owner',
        project_id: 'route-shared', grant_generation: '1', publication_intent: expect.objectContaining({
          parentVersionIds: [parent.assetVersionId], projectionMode: 'derived',
          selectionSnapshot: [{ entityId: parent.id, placementId: parent.placementId, assetVersionId: parent.assetVersionId }],
        }) })]);
      const payload = (await f.query('SELECT result FROM cloud_tasks')).rows[0].result;
      expect(JSON.stringify(payload)).not.toContain('must-not-persist-body-secret');
      expect(payload.submissionPayload.videoCanvasAdmission.ordinarySourceSnapshot)
        .toEqual([expect.objectContaining({ versionId: parent.assetVersionId, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) })]);
      expect(videoAfter.pending).toHaveLength(1);
      await drainVideoAfter();
      expect((await f.query('SELECT user_id,type,status,credit_status,credit_cost::text FROM cloud_tasks WHERE id=$1',
        [taskId])).rows).toEqual([{ user_id: 'route-editor', type: operation === 'extend' ? 'video-extend' : 'video',
          status: 'completed', credit_status: 'charged', credit_cost: '10' }]);
      expect(f.provider.calls).toHaveLength(1);
      expect(f.provider.calls[0].body.model).toBe(routeModel);
      if (operation === 'extend') {
        expect(f.provider.calls[0].body.video_url).toBe(routeOrigin + parent.videoUrl);
        expect(f.provider.persistenceStatuses).toEqual([200]);
      } else {
        expect(f.provider.calls[0].body.image_url).toBe(routeOrigin + parent.url);
        expect(f.provider.persistenceStatuses).toEqual([]);
      }
      const receipt = await assertVideoPublished(f, taskId, parent);
      const sealed = await videoBilling(f.query);
      const replay = await submitVideo(f, operation, body, key);
      expect(replay.status).toBe(200);
      expect((await replay.json()).taskId).toBe(taskId);
      const replayPublication = await publishVideo(f, taskId);
      expect(replayPublication.status).toBe(200);
      expect(await replayPublication.json()).toMatchObject({ assetVersionId: receipt.assetVersionId,
        placementId: receipt.placementId, documentSequence: receipt.documentSequence });
      expect(videoAfter.pending).toEqual([]);
      expect(f.provider.calls).toHaveLength(1);
      expect(await videoBilling(f.query)).toEqual(sealed);
      expect((await f.query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'route-editor', balance: 90 }, { user_id: 'route-outsider', balance: 100 },
          { user_id: 'route-owner', balance: 100 }]);
      expect((await f.query('SELECT user_id,type,amount,task_id FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'route-editor', type: 'consume', amount: -10, task_id: taskId }]);
    });
  });
  postgresIt.each([
    ['generate', 'forged-url', 403], ['extend', 'forged-url', 403],
    ['extend', 'non-media-kind', 409], ['extend', 'outsider', 403],
    ['generate', 'actor-changed', 403], ['generate', 'missing-idempotency', 400],
  ] as const)('%s rejects %s without charge/task/intent/provider I/O', async (operation, scenario, status) => {
    await withVideoRouteFixture(async f => {
      const body = videoBody(f, operation, operation === 'extend' ? f.video : f.frame);
      if (scenario === 'forged-url') body[operation === 'extend' ? 'videoUrl' : 'imageUrl'] = '/api/serve-upload/uploads/outside.mp4';
      if (scenario === 'non-media-kind') await f.query("UPDATE wujie_assets SET kind='model-3d' WHERE id=$1", [f.video.assetId]);
      const before = await videoBilling(f.query);
      try {
        const request = await f.request(scenario === 'outsider' ? 'route-outsider' : 'route-editor',
          '/api/video/' + operation, body, scenario === 'missing-idempotency' ? undefined : randomUUID());
        if (scenario === 'actor-changed') request.headers.set('x-wujie-expected-actor-id', 'route-owner');
        const route = operation === 'extend' ? await import('../../src/app/api/video/extend/route')
          : await import('../../src/app/api/video/generate/route');
        const response = await route.POST(request);
        const rejection = await response.clone().json() as { code?: string; error?: string };
        expect(response.status, JSON.stringify({ status: response.status, code: rejection.code, error: rejection.error })).toBe(status);
        if (scenario === 'non-media-kind') expect(rejection.code).toBe('CANVAS_TASK_PUBLICATION_CONFLICT');
        if (scenario === 'forged-url') expect(await response.json()).toMatchObject({
          success: false, code: 'CANVAS_VIDEO_SOURCE_MISMATCH', retryable: false,
        });
        expect(await videoBilling(f.query)).toEqual(before);
        expect(f.provider.calls).toEqual([]);
        expect(videoAfter.pending).toEqual([]);
      } finally {
        if (scenario === 'non-media-kind') await f.query("UPDATE wujie_assets SET kind='video' WHERE id=$1", [f.video.assetId]);
      }
    });
  });
  postgresIt.each(['generate', 'extend'] as const)('%s completion after revoke must refund once and never attach', async operation => {
    await withVideoRouteFixture(async f => {
      const beforeGraph = (await f.query('SELECT * FROM wujie_asset_versions ORDER BY id')).rows;
      const beforeFiles = (await readdir(path.join(mediaRoot, 'uploads'))).sort();
      const parent = operation === 'extend' ? f.video : f.frame;
      const response = await submitVideo(f, operation, videoBody(f, operation, parent), randomUUID());
      expect(response.status).toBe(200);
      const { taskId } = await response.json() as { taskId: string };
      let chargedAtProvider: unknown[] = [];
      f.provider.beforeResponse = async (): Promise<void> => {
        chargedAtProvider = (await f.query("SELECT balance FROM wujie_credits WHERE user_id='route-editor'")).rows;
        const { revokeDocumentEditor } = await import('../../src/lib/collaboration/document-access');
        await revokeDocumentEditor('route-owner', 'route-shared', 'route-editor');
      };
      await drainVideoAfter();
      expect(chargedAtProvider).toEqual([{ balance: 90 }]);
      expect((await readdir(path.join(mediaRoot, 'uploads'))).sort()).toEqual(beforeFiles);
      expect((await publishVideo(f, taskId)).status).toBe(403);
      expect((await f.query('SELECT * FROM wujie_asset_versions ORDER BY id')).rows).toEqual(beforeGraph);
      // Deliberately NO terminateCloudTaskAndRefund/manual settlement here:
      // rejection-only must not masquerade as completion revocation + automatic refund.
      expect((await f.query("SELECT balance FROM wujie_credits WHERE user_id='route-editor'")).rows)
        .toEqual([{ balance: 100 }]);
      expect((await f.query('SELECT type,amount FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY amount', [taskId])).rows)
        .toEqual([{ type: 'consume', amount: -10 }, { type: 'refund', amount: 10 }]);
      const settled = await videoBilling(f.query);
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      await grantDocumentEditor('route-owner', 'route-shared', 'route-editor');
      expect((await publishVideo(f, taskId)).status).toBe(403);
      expect(await videoBilling(f.query)).toEqual(settled);
      expect((await f.query('SELECT * FROM wujie_asset_versions ORDER BY id')).rows).toEqual(beforeGraph);
    });
  });
  postgresIt.each(['generate', 'extend'] as const)('%s keeps real legacy personal billing without a document publication', async operation => {
    await withVideoRouteFixture(async f => {
      vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
      const body = { prompt: 'personal video', model: routeModel, providerId: routeProvider, useDirector: false,
        duration: 5, extendDuration: 5, aspectRatio: '16:9',
        projectId: 'route-personal',
        ...(operation === 'extend' ? { videoUrl: '/api/serve-upload/uploads/personal-video.mp4' } : {}) };
      const before = (await f.query('SELECT * FROM wujie_asset_versions ORDER BY id')).rows;
      const response = await submitVideo(f, operation, body, randomUUID());
      expect(response.status).toBe(200);
      const { taskId } = await response.json() as { taskId: string };
      await drainVideoAfter();
      expect((await f.query('SELECT user_id,type,status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
        .toEqual([{ user_id: 'route-editor', type: operation === 'extend' ? 'video-extend' : 'video',
          status: 'completed', credit_status: 'charged' }]);
      expect((await f.query('SELECT * FROM wujie_canvas_task_publications')).rows).toEqual([]);
      expect((await f.query('SELECT user_id,type,amount,task_id FROM wujie_credit_transactions')).rows)
        .toEqual([{ user_id: 'route-editor', type: 'consume', amount: -10, task_id: taskId }]);
      expect((await f.query('SELECT * FROM wujie_asset_versions ORDER BY id')).rows).toEqual(before);
    });
  });

  // Completion must reject a changed source fingerprint, not merely recheck the editor grant.
  postgresIt.each(['generate', 'extend'] as const)('%s refunds once after a post-submit source drift and never publishes', async operation => {
    await withVideoRouteFixture(async f => {
      const parent = operation === 'extend' ? f.video : f.frame;
      const sourceId = parent.assetVersionId!;
      const original = (await f.query('SELECT checksum FROM wujie_asset_versions WHERE id=$1', [sourceId])).rows;
      expect(original).toHaveLength(1);
      const driftedChecksum = 'f'.repeat(64);
      expect(original[0].checksum).not.toBe(driftedChecksum);
      const graphBefore = (await f.query('SELECT id FROM wujie_asset_versions ORDER BY id')).rows;
      const assetsBefore = (await f.query('SELECT * FROM wujie_assets ORDER BY id')).rows;
      const placementsBefore = (await f.query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows;
      const filesBefore = (await readdir(path.join(mediaRoot, 'uploads'))).sort();
      const submit = await submitVideo(f, operation, videoBody(f, operation, parent), randomUUID());
      expect(submit.status).toBe(200);
      const { taskId } = await submit.json() as { taskId: string };
      expect((await f.query("SELECT balance FROM wujie_credits WHERE user_id='route-editor'")).rows)
        .toEqual([{ balance: 90 }]);
      const frozen = (await f.query('SELECT result FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].result;
      expect(frozen.submissionPayload.videoCanvasAdmission.ordinarySourceSnapshot)
        .toEqual([expect.objectContaining({ versionId: sourceId, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) })]);
      let changed = false;
      try {
        expect((await f.query(`UPDATE wujie_asset_versions SET checksum=$2
          WHERE id=$1 AND owner_id='route-owner' AND project_id='route-shared'
          AND checksum IS NOT DISTINCT FROM $3 RETURNING id`,
        [sourceId, driftedChecksum, original[0].checksum])).rows).toEqual([{ id: sourceId }]);
        changed = true;
        await drainVideoAfter();
        expect((await f.query('SELECT status,credit_status,error FROM cloud_tasks WHERE id=$1', [taskId])).rows)
          .toEqual([{ status: 'failed', credit_status: 'refunded', error: 'CANVAS_VIDEO_COMPLETION_FORBIDDEN' }]);
        expect((await publishVideo(f, taskId)).status).toBe(403);
        expect((await f.query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
          .toEqual([{ user_id: 'route-editor', balance: 100 }, { user_id: 'route-outsider', balance: 100 },
            { user_id: 'route-owner', balance: 100 }]);
        expect((await f.query('SELECT type,amount FROM wujie_credit_transactions WHERE task_id=$1 ORDER BY amount',
          [taskId])).rows).toEqual([{ type: 'consume', amount: -10 }, { type: 'refund', amount: 10 }]);
        expect((await f.query('SELECT id FROM wujie_asset_versions ORDER BY id')).rows).toEqual(graphBefore);
        expect((await f.query('SELECT * FROM wujie_assets ORDER BY id')).rows).toEqual(assetsBefore);
        expect((await f.query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows).toEqual(placementsBefore);
        expect((await readdir(path.join(mediaRoot, 'uploads'))).sort()).toEqual(filesBefore);
        const settled = await videoBilling(f.query);
        expect((await publishVideo(f, taskId)).status).toBe(403);
        expect(await videoBilling(f.query)).toEqual(settled);
        expect(await readFile(path.join(mediaRoot, 'uploads', 'valid.mp4'))).toEqual(mp4);
      } finally {
        // Drain before restoring; never let an unobserved completion see a restored source.
        try { await drainVideoAfter(); }
        finally {
          if (changed) expect((await f.query(`UPDATE wujie_asset_versions SET checksum=$2
            WHERE id=$1 AND owner_id='route-owner' AND project_id='route-shared'
            AND checksum=$3 RETURNING id`,
          [sourceId, original[0].checksum, driftedChecksum])).rows).toEqual([{ id: sourceId }]);
        }
      }
    });
  });

  postgresIt('chains two real charged video routes through CPU extraction and a canonical RAW JPEG upload', async () => {
    await withVideoRouteFixture(async f => {
      const first = await submitVideo(f, 'generate', videoBody(f, 'generate', f.frame), randomUUID());
      expect(first.status).toBe(200);
      const { taskId: firstId } = await first.json() as { taskId: string };
      await drainVideoAfter();
      const firstReceipt = await assertVideoPublished(f, firstId, f.frame);
      const { readCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
      const firstRead = await readCollaborativeProject('route-editor', 'route-shared');
      const firstVideo = firstRead.canvasImages.find(image => image.placementId === firstReceipt.placementId);
      expect(firstVideo).toMatchObject({ assetVersionId: firstReceipt.assetVersionId, mediaType: 'video' });
      if (!firstVideo) throw new Error('Published first segment has no canonical readback');

      const { POST: extract } = await import('../../src/app/api/video/extract-frame/route');
      const extracted = await extract(await f.request('route-editor', '/api/video/extract-frame',
        { videoUrl: firstVideo.videoUrl || firstVideo.url, mode: 'last' }));
      expect(extracted.status).toBe(200);
      const extractedBody = await extracted.json() as { success: boolean; imageUrl: string };
      expect(extractedBody.success).toBe(true);
      expect(extractedBody.imageUrl).toMatch(/^\/api\/serve-upload\/uploads\/frame-[0-9a-f-]{36}\.jpg$/u);
      const jpeg = await readFile(path.join(mediaRoot, 'uploads', path.basename(extractedBody.imageUrl)));
      const jpegInfo = await sharp(jpeg).metadata();
      expect(jpegInfo.format).toBe('jpeg');
      expect(jpegInfo.width).toBeGreaterThan(0);
      expect(jpegInfo.height).toBeGreaterThan(0);
      if (!jpegInfo.width || !jpegInfo.height) throw new Error('CPU frame has no actual dimensions');

      const uploadAuth = await f.request('route-editor', '/api/collaboration/document-assets/upload', {});
      const headers = new Headers(uploadAuth.headers);
      headers.set('content-type', 'image/jpeg');
      headers.set('x-wujie-asset-import', Buffer.from(JSON.stringify({
        projectId: 'route-shared', idempotencyKey: randomUUID(), filename: 'chain-frame.jpg',
        command: { action: 'attach', transform: { x: 120, y: 0, width: jpegInfo.width,
          height: jpegInfo.height, rotation: 0, zIndex: 2 } },
      })).toString('base64url'));
      const { POST: upload } = await import('../../src/app/api/collaboration/document-assets/upload/route');
      const uploaded = await upload(new NextRequest(uploadAuth.url, { method: 'POST', headers,
        body: new Uint8Array(jpeg), signal: uploadAuth.signal }));
      expect(uploaded.status).toBe(200);
      const frameReceipt = await uploaded.json() as DocumentMediaImportResult & { success: boolean };
      expect(frameReceipt.success).toBe(true);
      expect(frameReceipt.assetReference).toMatchObject({ kind: 'image',
        assetVersionId: frameReceipt.assetVersionId, placementId: frameReceipt.placementId });
      expect((await f.query('SELECT owner_id,project_id,mime_type,checksum,availability FROM wujie_asset_versions WHERE id=$1',
        [frameReceipt.assetVersionId])).rows).toEqual([{ owner_id: 'route-owner', project_id: 'route-shared',
          mime_type: 'image/jpeg', checksum: createHash('sha256').update(jpeg).digest('hex'), availability: 'ready' }]);
      const frameRead = await readCollaborativeProject('route-editor', 'route-shared');
      const managedFrame = frameRead.canvasImages.find(image => image.placementId === frameReceipt.placementId);
      expect(managedFrame).toMatchObject({ assetVersionId: frameReceipt.assetVersionId, assetId: frameReceipt.assetReference.assetId });
      if (!managedFrame) throw new Error('RAW JPEG has no authoritative document projection');
      const exportMatch = /^\/api\/serve-upload\/exports\/([a-f0-9]{16}-[A-Za-z0-9._-]+\.jpe?g)$/u.exec(managedFrame.url);
      expect(exportMatch).not.toBeNull();
      if (!exportMatch) throw new Error('Canonical frame URL is not an exact flat managed JPEG export');
      const { readServeUploadExportLocal } = await import('../../src/lib/serve-upload-local-storage');
      const persistedJPEG = await readServeUploadExportLocal(mediaRoot, exportMatch[1], 150 * 1024 * 1024);
      expect(persistedJPEG).toEqual(jpeg);

      const secondBody = videoBody(f, 'generate', managedFrame);
      const secondKey = randomUUID();
      const second = await submitVideo(f, 'generate', secondBody, secondKey);
      expect(second.status).toBe(200);
      const { taskId: secondId } = await second.json() as { taskId: string };
      expect(secondId).not.toBe(firstId);
      const frozen = (await f.query('SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1',
        [secondId])).rows[0].publication_intent;
      expect(frozen).toMatchObject({ parentVersionIds: [frameReceipt.assetVersionId],
        selectionSnapshot: [{ entityId: managedFrame.id, placementId: frameReceipt.placementId,
          assetVersionId: frameReceipt.assetVersionId }] });
      await drainVideoAfter();
      const secondReceipt = await assertVideoPublished(f, secondId, managedFrame);
      expect(f.provider.calls).toHaveLength(2);
      expect(f.provider.calls[1].body.image_url).toBe(routeOrigin + managedFrame.url);
      expect((await f.query('SELECT user_id,balance FROM wujie_credits ORDER BY user_id')).rows)
        .toEqual([{ user_id: 'route-editor', balance: 80 }, { user_id: 'route-outsider', balance: 100 },
          { user_id: 'route-owner', balance: 100 }]);
      const ledger = (await f.query('SELECT task_id,user_id,type,amount FROM wujie_credit_transactions ORDER BY task_id')).rows;
      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(expect.arrayContaining([
        { task_id: firstId, user_id: 'route-editor', type: 'consume', amount: -10 },
        { task_id: secondId, user_id: 'route-editor', type: 'consume', amount: -10 },
      ]));
      expect((await f.query('SELECT id,status,credit_status,credit_cost::text FROM cloud_tasks ORDER BY id')).rows)
        .toEqual(expect.arrayContaining([
          { id: firstId, status: 'completed', credit_status: 'charged', credit_cost: '10' },
          { id: secondId, status: 'completed', credit_status: 'charged', credit_cost: '10' },
        ]));
      const sealed = await videoBilling(f.query);
      const replay = await submitVideo(f, 'generate', secondBody, secondKey);
      expect(replay.status).toBe(200);
      expect((await replay.json()).taskId).toBe(secondId);
      const replayPublication = await publishVideo(f, secondId);
      expect(replayPublication.status).toBe(200);
      expect(await replayPublication.json()).toMatchObject({ assetVersionId: secondReceipt.assetVersionId,
        placementId: secondReceipt.placementId, documentSequence: secondReceipt.documentSequence });
      expect(videoAfter.pending).toEqual([]);
      expect(f.provider.calls).toHaveLength(2);
      expect(await videoBilling(f.query)).toEqual(sealed);
      expect(await readFile(path.join(mediaRoot, 'uploads', 'valid.mp4'))).toEqual(mp4);
    });
  }, 30_000);

});
