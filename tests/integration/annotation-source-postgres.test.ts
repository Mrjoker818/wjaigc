import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import * as legacySource from '@/lib/annotation-project-source';

const boundary = vi.hoisted(() => ({ actor: 'editor', vision: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => ({
  authenticated: true, userId: boundary.actor, userRole: 'user', source: 'session',
}) }));
vi.mock('@/lib/identify-subject', () => ({ identifyImageTargetAtPoint: boundary.vision }));
import { POST } from '../../src/app/api/annotations/resolve-target/route';

const VERSION = '11111111-1111-4111-8111-111111111111';
const VERSION_2 = '22222222-2222-4222-8222-222222222222';
const SOURCE = '/api/serve-upload/images/source.png';
const target = { label: 'cup', confidence: 0.9, region: { x: 0.2, y: 0.2, w: 0.3, h: 0.4 } };
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function seed(query: QueryFn): Promise<void> {
  for (const migration of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql',
    '20260926_yjs_canvas_authority_fence.sql']) {
    await query(await readFile(`migrations/${migration}`, 'utf8'));
  }
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1), ('editor','Editor','test','active',1,1),
      ('stranger','Stranger','test','active',1,1)`);
  await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('shared','owner','Shared'),('private','owner','Private')");
  await query("INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',false)");
  await query("INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')");
  await query("INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('asset-a','owner','shared','image')");
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ($1,'asset-a','owner','shared',$3,'image/png'), ($2,'asset-a','owner','shared',
      '/api/serve-upload/images/source2.png','image/png')`, [VERSION, VERSION_2, SOURCE]);
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('placement-a','owner','shared','asset-a',$1,'canvas','shared','canvas-image','entity-a')`, [VERSION]);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id,projection)
    VALUES ('shared','owner',$1::jsonb)`, [JSON.stringify({ placements: {
    'placement-a': { assetVersionId: VERSION, x: 0, y: 0, width: 512, height: 512, rotation: 0, zIndex: 1 },
  } })]);
  // Authoritative document source is absent from owner legacy images. A phantom legacy image must NOT revive it.
  await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at) VALUES
    ('owner','projects',$1::jsonb,1),('editor','projects','[]',1)`, [JSON.stringify([
    { id: 'shared', userId: 'owner', canvasImages: [{ id: 'phantom', url: SOURCE, annotationVersionId: 'old-phantom' }] },
    { id: 'private', userId: 'owner', canvasImages: [{ id: 'private-image', url: SOURCE, annotationVersionId: 'private-v1' }] },
  ])]);
  await query("UPDATE wujie_project_document_settings SET enabled=true WHERE project_id='shared'");
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  boundary.actor = 'editor';
  boundary.vision.mockReset().mockResolvedValue(target);
}

function request(extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/annotations/resolve-target', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      projectId: 'shared', sourceImageId: 'entity-a', sourceVersionId: `entity-a:asset:${VERSION}`,
      sourceImageUrl: '/api/serve-upload/images/client-forgery.png', point: { x: 0.3, y: 0.4 }, ...extra,
    }),
  });
}

async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of ['wujie_projects','wujie_user_data','wujie_assets','wujie_asset_versions',
    'wujie_workspace_placements','wujie_project_document_editors','wujie_project_document_settings',
    'wujie_project_canvas_documents','wujie_project_canvas_updates']) {
    result[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}

describe('annotation source admission against real PostgreSQL', () => {
  it.each([
    { actor: 'owner', commitIndex: 1, phase: 'initial-source' },
    { actor: 'editor', commitIndex: 1, phase: 'initial-source' },
    { actor: 'owner', commitIndex: 2, phase: 'post-vision-revalidation' },
    { actor: 'editor', commitIndex: 2, phase: 'post-vision-revalidation' },
  ])('returns safe 503 and recovers without writes after real PG ACK loss for $actor at $phase',
    async ({ actor, commitIndex }): Promise<void> => {
      await withIsolatedPostgres('annotation-source-network', async ({ query, databaseUrl }) => {
        await seed(query);
        boundary.actor = actor;
        const before = await snapshot(query);
        expect((await POST(request())).status).toBe(200);
        expect(await snapshot(query)).toEqual(before);
        boundary.vision.mockClear();
        const legacy = vi.spyOn(legacySource, 'findOwnedAnnotationSource'); // Trace only; no substitute source.
        const proxy = await loseCanvasCommitReply(databaseUrl, commitIndex);
        try {
          const response = await POST(request());
          expect(response.status).toBe(503);
          const body: unknown = await response.json();
          expect(body).toMatchObject({ success: false, code: 'ANNOTATION_SOURCE_UNAVAILABLE', retryable: true });
          expect(JSON.stringify(body)).not.toMatch(/SELECT|postgresql:|Connection terminated|source\.png|stack|detail/i);
          expect(proxy.dropped()).toBe(true);
          expect(proxy.connectionErrors.map(error => error.message)).toEqual(['Connection terminated unexpectedly']);
          expect(boundary.vision).toHaveBeenCalledTimes(commitIndex - 1);
          expect(legacy).not.toHaveBeenCalled();
          expect(await snapshot(query)).toEqual(before);
        } finally { await proxy.close(); }
        expect(process.env.DATABASE_URL).toBe(databaseUrl);
        expect(process.env.PGDATABASE_URL).toBe(databaseUrl);
        boundary.vision.mockClear();
        const recovered = await POST(request());
        expect(recovered.status).toBe(200);
        expect(await recovered.json()).toMatchObject({ success: true, target: { label: 'cup' } });
        expect(boundary.vision).toHaveBeenCalledTimes(1);
        expect(legacy).not.toHaveBeenCalled();
        expect(await snapshot(query)).toEqual(before);
      });
    });

  it('admits owner and editor from the canonical source without private-list copying or SQL writes', async () => {
    await withIsolatedPostgres('annotation-source-shared', async ({ query }) => {
      await seed(query);
      const before = await snapshot(query);
      for (const actor of ['owner','editor']) {
        boundary.actor = actor;
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, target: { label: 'cup' } });
        expect(boundary.vision).toHaveBeenLastCalledWith(SOURCE, { x: 0.3, y: 0.4 }, 30_000,
          { userId: actor, userRole: 'user' });
      }
      expect(await snapshot(query)).toEqual(before);
    });
  });

  it('refuses unauthorized, phantom, unavailable, deleted and mismatched canonical sources before vision', async () => {
    await withIsolatedPostgres('annotation-source-reject', async ({ query }) => {
      await seed(query);
      for (const [actor, extra] of [
        ['stranger', {}], ['editor', { projectId: 'private', sourceImageId: 'private-image', sourceVersionId: 'private-v1' }],
        ['owner', { sourceImageId: 'phantom', sourceVersionId: 'old-phantom' }],
      ] as const) {
        boundary.actor = actor;
        boundary.vision.mockClear();
        const before = await snapshot(query);
        expect((await POST(request(extra))).status).toBe(404);
        expect(boundary.vision).not.toHaveBeenCalled();
        expect(await snapshot(query)).toEqual(before);
      }
      boundary.actor = 'editor';
      for (const [sql, restore] of [
        ["UPDATE wujie_asset_versions SET availability='missing' WHERE id=$1", "UPDATE wujie_asset_versions SET availability='ready' WHERE id=$1"],
        ["UPDATE wujie_assets SET kind='video'", "UPDATE wujie_assets SET kind='image'"],
        ["UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now()", "UPDATE wujie_workspace_placements SET status='active',deleted_at=NULL"],
        ["UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-a,deleted}','true')",
          "UPDATE wujie_project_canvas_documents SET projection=projection #- '{placements,placement-a,deleted}'"],
      ]) {
        const params = sql.includes('$1') ? [VERSION] : undefined;
        await query(sql, params);
        boundary.vision.mockClear();
        const before = await snapshot(query);
        expect((await POST(request())).status).toBe(404);
        expect(boundary.vision).not.toHaveBeenCalled();
        expect(await snapshot(query)).toEqual(before);
        await query(restore, params);
      }
      const stale = await POST(request({ sourceVersionId: 'old-client-version' }));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: 'ANNOTATION_SOURCE_STALE' });
    });
  });

  it.each(['revocation','regrant','replace'] as const)('rejects a late vision result after %s', async (change) => {
    await withIsolatedPostgres(`annotation-source-${change}`, async ({ query }) => {
      await seed(query);
      boundary.vision.mockImplementationOnce(async () => {
        if (change === 'replace') {
          await query('UPDATE wujie_workspace_placements SET asset_version_id=$1', [VERSION_2]);
          await query("UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,'{placements,placement-a,assetVersionId}',$1::jsonb)", [JSON.stringify(VERSION_2)]);
        } else {
          await query(`UPDATE wujie_project_document_editors SET status=$1,grant_generation=2`,
            [change === 'regrant' ? 'active' : 'revoked']);
        }
        return target;
      });
      const response = await POST(request());
      expect(response.status).toBe(change === 'revocation' ? 404 : 409);
      expect(await response.json()).toMatchObject({ success: false });
      expect(boundary.vision).toHaveBeenCalledTimes(1);
    });
  });

  it('retains private sources but does not fall back to a stale private copy when a project row is trashed', async () => {
    await withIsolatedPostgres('annotation-source-private', async ({ query }) => {
      await seed(query);
      boundary.actor = 'owner';
      const input = { projectId: 'private', sourceImageId: 'private-image', sourceVersionId: 'private-v1' };
      expect((await POST(request(input))).status).toBe(200);
      await query("UPDATE wujie_projects SET status='trashed' WHERE id='private'");
      boundary.vision.mockClear();
      expect((await POST(request(input))).status).toBe(404);
      expect(boundary.vision).not.toHaveBeenCalled();
    });
  });

  it('retains a registered legacy image with no MIME metadata without admitting an explicitly non-image MIME', async () => {
    await withIsolatedPostgres('annotation-source-legacy-mime', async ({ query }) => {
      await seed(query);
      await query('UPDATE wujie_asset_versions SET mime_type=NULL WHERE id=$1', [VERSION]);
      const before = await snapshot(query);
      expect((await POST(request())).status).toBe(200);
      expect(await snapshot(query)).toEqual(before);
      await query("UPDATE wujie_asset_versions SET mime_type='video/mp4' WHERE id=$1", [VERSION]);
      boundary.vision.mockClear();
      expect((await POST(request())).status).toBe(404);
      expect(boundary.vision).not.toHaveBeenCalled();
    });
  });
});
