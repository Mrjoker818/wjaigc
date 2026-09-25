import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Project } from '../../src/lib/user-types';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/server-auth', () => ({
  getSessionUser: async () => ({ id: 'owner-a', name: 'Owner A' }),
}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
const previousDataRoot = process.env.WUJIE_DATA_DIR;
let mediaRoot = '';
let imageBytes: Buffer;

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-yjs-enable-media-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  imageBytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#d4af37' },
  }).png().toBuffer();
  await mkdir(path.join(mediaRoot, 'uploads'), { recursive: true });
  await writeFile(path.join(mediaRoot, 'uploads', 'ready.png'), imageBytes);
});

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = previousDataRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

const originalProject: Project = {
  id: 'project-a', userId: 'owner-a', name: 'Original',
  createdAt: 1, updatedAt: 1, canvasImages: [], settings: {},
};

afterEach(() => vi.unstubAllEnvs());

describe('collaborative project authority on isolated PostgreSQL', () => {
  postgresIt('returns document coordinates rather than stale graph coordinates in the owner project GET', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-owner-read', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-a', 'owner-a', 'Original')`);
      const image = {
        id: 'image-a', url: '/api/serve-upload/uploads/ready.png',
        x: 10, y: 20, width: 40, height: 30, originalWidth: 40, originalHeight: 30,
        rotation: 0, zIndex: 1, createdAt: 1,
      };
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`,
        [JSON.stringify([{ ...originalProject, canvasImages: [image] }])]);
      await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
        VALUES ('asset-a', 'owner-a', 'project-a', 'image')`);
      await query(`INSERT INTO wujie_asset_versions
        (id, asset_id, owner_id, project_id, file_url, availability)
        VALUES ('version-a', 'asset-a', 'owner-a', 'project-a',
          '/api/serve-upload/uploads/ready.png', 'ready')`);
      await query(`INSERT INTO wujie_workspace_placements
        (id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id, transform)
        VALUES ('placement-a', 'owner-a', 'project-a', 'asset-a', 'version-a',
          'canvas', 'project-a', 'canvas-image', 'image-a',
          '{"x":10,"y":20,"width":40,"height":30,"rotation":0,"zIndex":1}'::jsonb)`);
      const { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } = await import(
        '../../src/lib/collaboration/canvas-document'
      );
      const Y = await import('yjs');
      const doc = createCanvasDocument();
      applyCanvasImagePatch(doc, {
        placementId: 'placement-a', assetVersionId: 'version-a',
        x: 99, y: 20, width: 40, height: 30, rotation: 0, zIndex: 1,
      }, 'test');
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-a', 'owner-a', true, 1)`);
      await query(`INSERT INTO wujie_project_canvas_documents
        (project_id, owner_id, snapshot_bytes, projection)
        VALUES ('project-a', 'owner-a', $1, $2::jsonb)`, [
        Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc)),
      ]);

      const { NextRequest } = await import('next/server');
      const { GET } = await import('../../src/app/api/user-data/sync/route');
      for (const mode of ['legacy', 'shadow', 'asset-v3']) {
        vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', mode);
        const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
        expect(response.status).toBe(200);
        const body = await response.json() as { value: Project[] };
        expect(body.value[0].canvasImages).toMatchObject([{
          id: 'image-a', placementId: 'placement-a', x: 99, y: 20,
        }]);
      }
    });
  });

  postgresIt('rejects a direct SQL rewrite of document-owned canvas state', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-database-fence', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(await readFile('migrations/20260926_yjs_canvas_authority_fence.sql', 'utf8'));
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-a', 'owner-a', 'Original')`);
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject])]);
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-a', 'owner-a', true, 1)`);

      const renamed = {
        ...originalProject, name: 'Renamed', updatedAt: 2,
        settings: { themeStyle: 'monochrome' as const },
        metadata: { customTag: 'keep' },
      };
      await expect(query(`UPDATE wujie_user_data SET data_value = $1::jsonb, updated_at = 2
        WHERE user_id = 'owner-a' AND data_key = 'projects'`, [JSON.stringify([renamed])]))
        .resolves.toMatchObject({ rowCount: 1 });
      await expect(query(
        `UPDATE wujie_user_data SET data_value = $1::jsonb, updated_at = 2
          WHERE user_id = 'owner-a' AND data_key = 'projects'`,
        [JSON.stringify([{ ...renamed, canvasImages: [{ id: 'unexpected-image' }] }])],
      )).rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
      await expect(query(
        `UPDATE wujie_user_data SET data_value = $1::jsonb, updated_at = 2
          WHERE user_id = 'owner-a' AND data_key = 'projects'`,
        [JSON.stringify([{ ...renamed, metadata: { ...renamed.metadata, groups: [{ id: 'forged' }] } }])],
      )).rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
      await expect(query(
        `UPDATE wujie_user_data SET data_value = $1::jsonb, updated_at = 2
          WHERE user_id = 'owner-a' AND data_key = 'projects'`,
        [JSON.stringify([{ ...renamed, userId: 'owner-b' }])],
      )).rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
      const stored = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(stored.rows[0]?.data_value).toEqual([renamed]);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-b', 'Owner B', 'test', 'active', 1, 1)`);
      await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-b', 'owner-b', 'B')");
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-b', 'owner-b', true, 1)`);
      await expect(query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-b', 'projects', $1::jsonb, 1)`, [JSON.stringify([
        { ...originalProject, id: 'project-b', userId: 'owner-b' },
      ])])).rejects.toThrow('DOCUMENT_AUTHORITY_CONFLICT');
    });
  });

  postgresIt('allows project metadata edits but rejects stale canvas snapshots', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-legacy-fence', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(await readFile('migrations/20260926_yjs_canvas_authority_fence.sql', 'utf8'));
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-a', 'owner-a', 'Original')`);
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject])]);
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-a', 'owner-a', true, 0)`);
      const { createCanvasDocument, readCanvasDocument } = await import(
        '../../src/lib/collaboration/canvas-document'
      );
      const Y = await import('yjs');
      const doc = createCanvasDocument();
      await query(`INSERT INTO wujie_project_canvas_documents
        (project_id, owner_id, snapshot_bytes, projection)
        VALUES ('project-a', 'owner-a', $1, $2::jsonb)`, [
        Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc)),
      ]);

      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const renamed = {
        ...originalProject, name: 'Renamed', updatedAt: 2,
        settings: { themeStyle: 'monochrome' as const },
        metadata: { customTag: 'keep' },
      };
      await expect(executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [renamed],
        expectedRevision: 0,
      })).resolves.toMatchObject({ revision: 1 });

      await expect(executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [{ ...renamed, canvasImages: [{ id: 'unexpected-image' }] as Project['canvasImages'] }],
        expectedRevision: 1,
      })).rejects.toMatchObject({ code: 'DOCUMENT_AUTHORITY_CONFLICT' });

      const stored = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(stored.rows[0]?.data_value).toEqual([renamed]);
      const graphProject = await query<{ name: string }>(
        "SELECT name FROM wujie_projects WHERE id = 'project-a' AND owner_id = 'owner-a'",
      );
      expect(graphProject.rows).toEqual([{ name: 'Renamed' }]);
    });
  });

  postgresIt('keeps a separate non-collaborative project writable for the same owner', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-mixed-owner', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-a', 'owner-a', 'Original'), ('project-b', 'owner-a', 'Other')`);
      const otherProject = { ...originalProject, id: 'project-b', name: 'Other' };
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject, otherProject])]);
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-a', 'owner-a', true, 0)`);
      const { createCanvasDocument, applyCanvasImagePatch, readCanvasDocument } = await import(
        '../../src/lib/collaboration/canvas-document'
      );
      const Y = await import('yjs');
      const doc = createCanvasDocument();
      await query(`INSERT INTO wujie_project_canvas_documents
        (project_id, owner_id, snapshot_bytes, projection)
        VALUES ('project-a', 'owner-a', $1, $2::jsonb)`, [
        Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc)),
      ]);

      const { executeLegacyCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      const changedOther = { ...otherProject, name: 'Other updated', updatedAt: 2 };
      const result = await executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [originalProject, changedOther],
        expectedRevision: 0,
      });
      expect(result.revision).toBe(1);
      const stored = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(stored.rows[0]?.data_value).toEqual([originalProject, changedOther]);

      await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
        VALUES ('asset-a', 'owner-a', 'project-a', 'image')`);
      await query(`INSERT INTO wujie_asset_versions
        (id, asset_id, owner_id, project_id, file_url, availability)
        VALUES ('version-a', 'asset-a', 'owner-a', 'project-a',
          '/api/serve-upload/images/graph.png', 'ready')`);
      await query(`INSERT INTO wujie_workspace_placements
        (id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id)
        VALUES ('placement-a', 'owner-a', 'project-a', 'asset-a', 'version-a',
          'canvas', 'project-a', 'canvas-image', 'graph-image')`);
      applyCanvasImagePatch(doc, {
        placementId: 'placement-a', assetVersionId: 'version-a',
        x: 0, y: 0, width: 256, height: 256, rotation: 0, zIndex: 0,
      }, 'test');
      await query(`UPDATE wujie_project_canvas_documents
        SET snapshot_bytes = $1, projection = $2::jsonb WHERE project_id = 'project-a'`, [
        Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc)),
      ]);
      const { readAssetV3Projects } = await import('../../src/lib/asset-core/canvas-project-sync');
      const hydrated = await readAssetV3Projects('owner-a', [originalProject, changedOther]);
      expect(hydrated[0].canvasImages).toHaveLength(1);
      const nextOther = { ...changedOther, name: 'Other again', updatedAt: 3 };
      const saved = await executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [hydrated[0], nextOther],
        expectedRevision: 1,
      });
      expect(saved.revision).toBe(2);
      const afterHydratedSave = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(afterHydratedSave.rows[0]?.data_value).toEqual([originalProject, nextOther]);
      await expect(executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [{ ...hydrated[0], canvasImages: [
          { ...hydrated[0].canvasImages[0], x: 99 },
        ] }, nextOther],
        expectedRevision: 2,
      })).rejects.toMatchObject({ code: 'DOCUMENT_AUTHORITY_CONFLICT' });
      const afterRejectedEdit = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(afterRejectedEdit.rows[0]?.data_value).toEqual([originalProject, nextOther]);

      applyCanvasImagePatch(doc, {
        placementId: 'placement-a', x: 99,
      }, 'test');
      await query(`UPDATE wujie_project_canvas_documents
        SET snapshot_bytes = $1, projection = $2::jsonb WHERE project_id = 'project-a'`, [
        Buffer.from(Y.encodeStateAsUpdate(doc)), JSON.stringify(readCanvasDocument(doc)),
      ]);
      const { readOwnerProjectsWithDocuments } = await import(
        '../../src/lib/collaboration/document-project-bridge'
      );
      const documentView = await readOwnerProjectsWithDocuments('owner-a', [originalProject, nextOther]);
      expect(documentView[0].canvasImages[0].x).toBe(99);
      const finalOther = { ...nextOther, name: 'Other final', updatedAt: 4 };
      await expect(executeLegacyCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [documentView[0], finalOther],
        expectedRevision: 2,
      })).resolves.toMatchObject({ revision: 3 });
      const afterUnrelatedSave = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(afterUnrelatedSave.rows[0]?.data_value).toEqual([originalProject, finalOther]);
    });
  });

  postgresIt('enables an existing project at its revision and seeds a recoverable document atomically', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-enable-empty', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name, metadata)
        VALUES ('project-a', 'owner-a', 'Original', '{"presenceProjection":true}'::jsonb)`);
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject])]);

      const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
      await expect(enableCollaborativeProject('owner-a', 'project-a', 1))
        .rejects.toMatchObject({ code: 'DOCUMENT_PROJECT_REVISION_CONFLICT', currentRevision: 0 });
      const before = await query<{ documents: string; settings: string }>(`SELECT
        (SELECT count(*) FROM wujie_project_canvas_documents)::text AS documents,
        (SELECT count(*) FROM wujie_project_document_settings)::text AS settings`);
      expect(before.rows[0]).toEqual({ documents: '0', settings: '0' });
      await enableCollaborativeProject('owner-a', 'project-a', 0);

      const settings = await query<{ enabled: boolean; authority_revision: string }>(
        `SELECT enabled, authority_revision FROM wujie_project_document_settings
          WHERE project_id = 'project-a' AND owner_id = 'owner-a'`,
      );
      expect(settings.rows).toEqual([{ enabled: true, authority_revision: '1' }]);
      const document = await query<{ projection: unknown; sequence: string }>(
        `SELECT projection, sequence FROM wujie_project_canvas_documents WHERE project_id = 'project-a'`,
      );
      expect(document.rows).toEqual([{ projection: { placements: {} }, sequence: '0' }]);
      const snapshot = await query<{ data_value: Project[] }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(snapshot.rows[0]?.data_value).toEqual([originalProject]);
      const revision = await query<{ data_value: number }>(
        `SELECT data_value FROM wujie_user_data
          WHERE user_id = 'owner-a' AND data_key = '__asset_graph_projects_revision'`,
      );
      expect(revision.rows[0]?.data_value).toBe(1);
    });
  });

  postgresIt('does not reconcile a document-owned asset placement from an unchanged shadow snapshot', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-shadow-fence', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-a', 'owner-a', 'Original')`);
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject])]);
      await query(`INSERT INTO wujie_project_document_settings
        (project_id, owner_id, enabled, authority_revision)
        VALUES ('project-a', 'owner-a', true, 0)`);
      await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
        VALUES ('asset-a', 'owner-a', 'project-a', 'image')`);
      await query(`INSERT INTO wujie_asset_versions
        (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
        VALUES ('version-a', 'asset-a', 'owner-a', 'project-a',
          '/api/serve-upload/images/document-owned.png', 'ready', 'image/png', 4)`);
      await query(`INSERT INTO wujie_workspace_placements
        (id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id)
        VALUES ('placement-a', 'owner-a', 'project-a', 'asset-a', 'version-a',
          'canvas', 'project-a', 'canvas-image', 'document-image')`);

      const { executeCanvasProjectSync } = await import('../../src/lib/asset-core/canvas-project-sync');
      await executeCanvasProjectSync({
        actorUserId: 'owner-a',
        projects: [originalProject],
        expectedRevision: 0,
      });

      const placement = await query<{ status: string }>(
        `SELECT status FROM wujie_workspace_placements WHERE id = 'placement-a'`,
      );
      expect(placement.rows).toEqual([{ status: 'active' }]);
    });
  });

  postgresIt('enables a v1 project whose canvas collection is stored under images', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-enable-v1', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name, metadata)
        VALUES ('project-a', 'owner-a', 'Original', '{"presenceProjection":true}'::jsonb)`);
      const historical = { id: 'project-a', userId: 'owner-a', name: 'Original',
        createdAt: 1, updatedAt: 1, images: [], settings: {} };
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([historical])]);

      const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
      await enableCollaborativeProject('owner-a', 'project-a', 0);

      const setting = await query<{ enabled: boolean }>(
        `SELECT enabled FROM wujie_project_document_settings WHERE project_id = 'project-a'`,
      );
      expect(setting.rows).toEqual([{ enabled: true }]);
      const snapshot = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(snapshot.rows[0]?.data_value).toEqual([historical]);
    });
  });

  postgresIt('enables a nonempty v1 project only after verifying its real managed image', async () => {
      const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
      await withIsolatedPostgres('document-project-enable-real-media', async ({ query }) => {
        for (const migration of [
          '20260809_wj_core_users.sql',
          '20260810_wj_stable_s2_assets.sql',
          '20260925_yjs_canvas_editors.sql',
          '20260925_yjs_canvas_documents.sql',
        ]) {
          await query(await readFile(path.join('migrations', migration), 'utf8'));
        }
        await query(`CREATE TABLE wujie_user_data (
          user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
          updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
        )`);
        await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
          VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
        const historical = {
          id: 'project-a', userId: 'owner-a', name: 'With image',
          createdAt: 1, updatedAt: 1, settings: {},
          metadata: {
            groups: [{
              id: 'group-a', name: 'Hero set', note: 'Keep together',
              imageIds: ['legacy-image-a'], x: 15, y: 25, collapsed: true,
            }],
            annotationsV2: [{
              id: 'annotation-a', projectId: 'project-a',
              sourceImageId: 'legacy-image-a', sourceVersionId: 'source-v1',
              type: 'region', geometry: {
                kind: 'region', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
              },
              label: 'Product', status: 'ready', createdAt: 1, updatedAt: 2,
            }, {
              id: 'legacy-annotation-a', targetImageId: 'legacy-image-a',
              x: 15, y: 25, text: 'Legacy note',
              region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, createdAt: 1,
            }],
          },
          images: [{
            id: 'legacy-image-a', url: '/uploads/ready.png',
            x: 10, y: 20, width: 40, height: 30, rotation: 0, zIndex: 1,
            groupId: 'group-a',
          }],
        };
        await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
          VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([historical])]);

        const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
        await enableCollaborativeProject('owner-a', 'project-a', 0);

        const document = await query<{ projection: {
          placements: Record<string, unknown>;
          groupDefinitions: Record<string, { imageIds: string[]; name: string }>;
          annotationRecords: Record<string, { sourceImageId: string; label: string }>;
        } }>(
          `SELECT projection FROM wujie_project_canvas_documents WHERE project_id = 'project-a'`,
        );
        const projection = document.rows[0]?.projection;
        const placementId = Object.keys(projection?.placements ?? {})[0];
        const placements = Object.values(projection?.placements ?? {});
        expect(placements).toHaveLength(1);
        expect(placements[0]).toMatchObject({ x: 10, y: 20, width: 40, height: 30, groupId: 'group-a' });
        expect(projection?.groupDefinitions['group-a']).toMatchObject({
          name: 'Hero set', imageIds: [placementId],
        });
        expect(projection?.annotationRecords['annotation-a']).toMatchObject({
          sourceImageId: placementId, label: 'Product',
        });
        expect(projection?.annotationRecords['legacy-annotation-a']).toMatchObject({
          sourceImageId: placementId, instruction: 'Legacy note',
          type: 'region', status: 'ready',
        });
        const versions = await query<{ byte_size: string; availability: string }>(
          `SELECT byte_size, availability FROM wujie_asset_versions WHERE project_id = 'project-a'`,
        );
        expect(versions.rows).toEqual([{ byte_size: String(imageBytes.byteLength), availability: 'ready' }]);
        const settings = await query<{ enabled: boolean }>(
          `SELECT enabled FROM wujie_project_document_settings WHERE project_id = 'project-a'`,
        );
        expect(settings.rows).toEqual([{ enabled: true }]);
        const {
          applyCanvasImagePatch, createCanvasDocument, readCanvasDocument,
          tombstoneCanvasAnnotation, tombstoneCanvasGroup,
        } = await import(
          '../../src/lib/collaboration/canvas-document'
        );
        const Y = await import('yjs');
        const storedDocument = await query<{ snapshot_bytes: Buffer }>(
          `SELECT snapshot_bytes FROM wujie_project_canvas_documents WHERE project_id = 'project-a'`,
        );
        const seed = createCanvasDocument();
        Y.applyUpdate(seed, storedDocument.rows[0].snapshot_bytes);
        const changed = createCanvasDocument();
        Y.applyUpdate(changed, Y.encodeStateAsUpdate(seed));
        changed.getMap('groupDefinitions').set('group-a', {
          ...historical.metadata.groups[0], name: 'Updated group', imageIds: [placementId],
        });
        changed.getMap('annotationRecords').set('annotation-a', {
          ...historical.metadata.annotationsV2[0], label: 'Updated annotation',
          sourceImageId: placementId,
        });
        const { commitDocumentUpdate } = await import('../../src/lib/collaboration/document-store');
        vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
        const committed = await commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(changed, Y.encodeStateVector(seed)),
        });
        expect(committed.sequence).toBe(1);
        expect(readCanvasDocument(changed).groupDefinitions?.['group-a'].name).toBe('Updated group');
        const forged = createCanvasDocument();
        Y.applyUpdate(forged, Y.encodeStateAsUpdate(changed));
        forged.getMap('annotationRecords').set('annotation-a', {
          ...historical.metadata.annotationsV2[0],
          projectId: 'project-other', sourceImageId: placementId,
        });
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(forged, Y.encodeStateVector(changed)),
        })).rejects.toThrow('Canvas annotation project does not match document project');
        await query(`INSERT INTO wujie_projects (id, owner_id, name)
          VALUES ('project-other', 'owner-a', 'Other')`);
        await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
          VALUES ('asset-foreign', 'owner-a', 'project-other', 'image')`);
        await query(`INSERT INTO wujie_asset_versions
          (id, asset_id, owner_id, project_id, file_url, availability)
          VALUES ('version-foreign', 'asset-foreign', 'owner-a', 'project-other',
            '/api/serve-upload/uploads/ready.png', 'ready')`);
        const foreignMask = createCanvasDocument();
        Y.applyUpdate(foreignMask, Y.encodeStateAsUpdate(changed));
        foreignMask.getMap('annotationRecords').set('annotation-a', {
          ...historical.metadata.annotationsV2[0], sourceImageId: placementId,
          maskAssetId: 'asset-foreign',
        });
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(foreignMask, Y.encodeStateVector(changed)),
        })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        vi.stubEnv('WUJIE_ASSET_GRAPH_MODE', 'legacy');
        const { NextRequest } = await import('next/server');
        const { GET } = await import('../../src/app/api/user-data/sync/route');
        const response = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
        const body = await response.json() as { value: Project[] };
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.value[0].canvasImages).toMatchObject([{
          id: 'legacy-image-a', x: 10, y: 20, groupId: 'group-a',
        }]);
        expect(body.value[0].metadata?.groups).toEqual([
          { ...historical.metadata.groups[0], name: 'Updated group' },
        ]);
        expect(body.value[0].metadata?.annotationsV2).toMatchObject([
          { ...historical.metadata.annotationsV2[0], label: 'Updated annotation' },
          { id: 'legacy-annotation-a', sourceImageId: 'legacy-image-a',
            instruction: 'Legacy note', type: 'region', status: 'ready' },
        ]);
        await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
          VALUES ('asset-mask-a', 'owner-a', 'project-a', 'image')`);
        await query(`INSERT INTO wujie_asset_versions
          (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
          VALUES ('version-mask-a', 'asset-mask-a', 'owner-a', 'project-a',
            '/api/serve-upload/uploads/ready.png', 'ready', 'image/png', $1)`,
          [imageBytes.byteLength]);
        await query("UPDATE wujie_assets SET current_version_id = 'version-mask-a' WHERE id = 'asset-mask-a'");
        const localMask = createCanvasDocument();
        Y.applyUpdate(localMask, Y.encodeStateAsUpdate(changed));
        localMask.getMap('annotationRecords').set('annotation-a', {
          ...historical.metadata.annotationsV2[0], label: 'Updated annotation',
          sourceImageId: placementId, maskAssetId: 'asset-mask-a',
        });
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(localMask, Y.encodeStateVector(changed)),
        })).resolves.toMatchObject({ sequence: 2 });
        const removed = createCanvasDocument();
        Y.applyUpdate(removed, Y.encodeStateAsUpdate(localMask));
        tombstoneCanvasGroup(removed, 'group-a', 'owner');
        tombstoneCanvasAnnotation(removed, 'annotation-a', 'owner');
        tombstoneCanvasAnnotation(removed, 'legacy-annotation-a', 'owner');
        const removal = await commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(removed, Y.encodeStateVector(localMask)),
        });
        expect(removal.sequence).toBe(3);
        const afterRemoval = await GET(new NextRequest('http://localhost/api/user-data/sync?key=projects'));
        const removedBody = await afterRemoval.json() as { value: Project[] };
        expect(afterRemoval.status, JSON.stringify(removedBody)).toBe(200);
        expect(removedBody.value[0].metadata).toMatchObject({ groups: [], annotationsV2: [] });
        expect(removedBody.value[0].canvasImages[0].groupId).toBeUndefined();
        await query(`UPDATE wujie_assets SET status = 'trashed' WHERE id = 'asset-mask-a'`);
        const movedAfterRemoval = createCanvasDocument();
        Y.applyUpdate(movedAfterRemoval, Y.encodeStateAsUpdate(removed));
        applyCanvasImagePatch(movedAfterRemoval, { placementId, x: 11 }, 'owner');
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(movedAfterRemoval, Y.encodeStateVector(removed)),
        })).resolves.toMatchObject({ sequence: 4 });
        const staleRewrite = createCanvasDocument();
        Y.applyUpdate(staleRewrite, Y.encodeStateAsUpdate(removed));
        staleRewrite.getMap('groupDefinitions').set('group-a', {
          ...historical.metadata.groups[0], name: 'Revived group', imageIds: [placementId],
        });
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(staleRewrite, Y.encodeStateVector(removed)),
        })).rejects.toThrow('Canvas deleted metadata record cannot be rewritten');
        const staleAnnotation = createCanvasDocument();
        Y.applyUpdate(staleAnnotation, Y.encodeStateAsUpdate(removed));
        staleAnnotation.getMap('annotationRecords').set('annotation-a', {
          ...historical.metadata.annotationsV2[0],
          sourceImageId: placementId, label: 'Revived annotation',
        });
        await expect(commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: Y.encodeStateAsUpdate(staleAnnotation, Y.encodeStateVector(removed)),
        })).rejects.toThrow('Canvas deleted metadata record cannot be rewritten');
      });
  });

  postgresIt('rolls back graph and authority when a later document placement is invalid', async () => {
      const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
      await withIsolatedPostgres('document-project-enable-rollback', async ({ query }) => {
        for (const migration of [
          '20260809_wj_core_users.sql',
          '20260810_wj_stable_s2_assets.sql',
          '20260925_yjs_canvas_editors.sql',
          '20260925_yjs_canvas_documents.sql',
        ]) {
          await query(await readFile(path.join('migrations', migration), 'utf8'));
        }
        await query(`CREATE TABLE wujie_user_data (
          user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
          updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
        )`);
        await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
          VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
        const valid = {
          id: 'legacy-image-a', url: '/uploads/ready.png',
          x: 10, y: 20, width: 40, height: 30, rotation: 0, zIndex: 1,
        };
        const historical = {
          id: 'project-a', userId: 'owner-a', name: 'Two images',
          createdAt: 1, updatedAt: 1, settings: {},
          images: [valid, { ...valid, id: 'legacy-image-b', x: null }],
        };
        await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
          VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([historical])]);

        const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
        await expect(enableCollaborativeProject('owner-a', 'project-a', 0))
          .rejects.toThrow('Invalid canvas x');
        const counts = await query<{
          projects: string; assets: string; versions: string; placements: string;
          checkpoints: string; documents: string; settings: string;
        }>(`SELECT
          (SELECT count(*) FROM wujie_projects)::text AS projects,
          (SELECT count(*) FROM wujie_assets)::text AS assets,
          (SELECT count(*) FROM wujie_asset_versions)::text AS versions,
          (SELECT count(*) FROM wujie_workspace_placements)::text AS placements,
          (SELECT count(*) FROM wujie_asset_migration_checkpoints)::text AS checkpoints,
          (SELECT count(*) FROM wujie_project_canvas_documents)::text AS documents,
          (SELECT count(*) FROM wujie_project_document_settings)::text AS settings`);
        expect(counts.rows[0]).toEqual({
          projects: '0', assets: '0', versions: '0', placements: '0',
          checkpoints: '0', documents: '0', settings: '0',
        });
        const stored = await query<{ data_value: unknown }>(
          `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
        );
        expect(stored.rows[0]?.data_value).toEqual([historical]);
      });
  });

  postgresIt('rolls back first enable when a group note would retain a temporary media URL in Yjs', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-secret-seed', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1)`);
      const historical = {
        id: 'project-a', userId: 'owner-a', name: 'Original',
        createdAt: 1, updatedAt: 1, settings: {},
        metadata: { groups: [{
          id: 'group-a', name: 'Hero', note: 'data:image/png;base64,AAAA',
          imageIds: ['legacy-image-a'],
        }] },
        images: [{
          id: 'legacy-image-a', url: '/uploads/ready.png',
          x: 10, y: 20, width: 40, height: 30, rotation: 0, zIndex: 1,
          groupId: 'group-a',
        }],
      };
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([historical])]);

      const { enableCollaborativeProject } = await import('../../src/lib/collaboration/document-project-bridge');
      await expect(enableCollaborativeProject('owner-a', 'project-a', 0))
        .rejects.toThrow('Canvas document update retains forbidden history');
      const state = await query<{ documents: string; settings: string; projects: string }>(`SELECT
        (SELECT count(*) FROM wujie_project_canvas_documents)::text AS documents,
        (SELECT count(*) FROM wujie_project_document_settings)::text AS settings,
        (SELECT count(*) FROM wujie_projects)::text AS projects`);
      expect(state.rows).toEqual([{ documents: '0', settings: '0', projects: '0' }]);
      const stored = await query<{ data_value: unknown }>(
        `SELECT data_value FROM wujie_user_data WHERE user_id = 'owner-a' AND data_key = 'projects'`,
      );
      expect(stored.rows[0]?.data_value).toEqual([historical]);
    });
  });

  postgresIt('reads only an enabled project document for its owner or invited editor', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-project-read', async ({ query }) => {
      for (const migration of [
        '20260809_wj_core_users.sql',
        '20260810_wj_stable_s2_assets.sql',
        '20260925_yjs_canvas_editors.sql',
        '20260925_yjs_canvas_documents.sql',
      ]) {
        await query(await readFile(path.join('migrations', migration), 'utf8'));
      }
      await query(`CREATE TABLE wujie_user_data (
        user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB,
        updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, data_key)
      )`);
      await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
        VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
               ('editor-a', 'Editor A', 'test', 'active', 1, 1),
               ('stranger-a', 'Stranger A', 'test', 'active', 1, 1)`);
      await query(`INSERT INTO wujie_projects (id, owner_id, name, metadata)
        VALUES ('project-a', 'owner-a', 'Original', '{"presenceProjection":true}'::jsonb)`);
      await query(`INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
        VALUES ('owner-a', 'projects', $1::jsonb, 1)`, [JSON.stringify([originalProject])]);
      const { enableCollaborativeProject, readCollaborativeProject } = await import(
        '../../src/lib/collaboration/document-project-bridge'
      );
      await enableCollaborativeProject('owner-a', 'project-a', 0);
      await query(`INSERT INTO wujie_project_document_editors
        (project_id, owner_id, member_user_id, status)
        VALUES ('project-a', 'owner-a', 'editor-a', 'active')`);

      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      await expect(readCollaborativeProject('editor-a', 'project-a')).resolves.toEqual({
        projectId: 'project-a', ownerId: 'owner-a', sequence: 0,
        projection: { placements: {} }, readOnly: false,
      });
      await expect(readCollaborativeProject('stranger-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      await expect(readCollaborativeProject('owner-a', 'project-a'))
        .resolves.toMatchObject({ readOnly: true, projection: { placements: {} } });
      await query(`DELETE FROM wujie_project_canvas_documents WHERE project_id = 'project-a'`);
      await expect(readCollaborativeProject('owner-a', 'project-a'))
        .rejects.toMatchObject({ code: 'DOCUMENT_AUTHORITY_CONFLICT' });
    });
  });
});
