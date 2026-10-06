import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
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
afterEach(() => { vi.unstubAllEnvs(); s3Metadata.inspect.mockReset(); s3Metadata.read.mockReset(); });
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
