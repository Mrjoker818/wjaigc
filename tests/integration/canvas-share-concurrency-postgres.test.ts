import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCanvasShare,
  patchCanvasSharePolicy,
  readPublicCanvasShare,
  readPublicCanvasShareMedia,
  revokeCanvasShare,
  type CanvasShareCreatePersistenceInput,
} from '../../src/lib/canvas-share/service';
import {
  computeCanvasShareSnapshotDigestForRead,
  createCanvasSharePublicItemRef,
} from '../../src/lib/canvas-share/public-projection';
import {
  findCanvasShareForOwner,
  insertCanvasShare,
  revokeCanvasShare as revokeCanvasShareInStorage,
  type StoredCanvasShareSnapshot,
  withActiveCanvasShareSnapshot,
} from '../../src/lib/canvas-share/storage';
import { hashCanvasShareToken } from '../../src/lib/canvas-share/token';
import type { CanvasShareItemRecord, CanvasShareRecord } from '../../src/lib/canvas-share/types';
import type { QueryFn } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const originalDataRoot = process.env.WUJIE_DATA_DIR;
let testDataRoot: string | undefined;

if (!databaseUrl) {
  console.warn('BLOCKED: canvas-share concurrency verification requires POSTGRES_TEST_DATABASE_URL');
}

beforeAll(async () => {
  if (!databaseUrl) return;
  testDataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-concurrency-'));
  process.env.WUJIE_DATA_DIR = testDataRoot;
  await mkdir(path.join(testDataRoot, 'uploads'), { recursive: true });
  await writeFile(path.join(testDataRoot, 'uploads', 'race.png'), Buffer.from([1, 2, 3, 4]));
});

afterAll(async () => {
  if (originalDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = originalDataRoot;
  if (testDataRoot) await rm(testDataRoot, { recursive: true, force: true });
});

async function applyMigrations(query: QueryFn): Promise<void> {
  for (const migrationPath of [
    'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260810_wj_stable_s2_workspace_entity_pairs.sql',
    'migrations/20260913_canvas_video_placements.sql',
    'migrations/20260919_read_only_canvas_shares.sql',
  ]) {
    await query(await readFile(migrationPath, 'utf8'));
  }
}

async function seedGraph(query: QueryFn): Promise<void> {
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name) VALUES
      ('project-race', 'owner-race', 'Race project'),
      ('project-foreign', 'owner-foreign', 'Foreign project')
  `);
  await query(`
    INSERT INTO wujie_assets (
      id, owner_id, project_id, kind, status, current_version_id
    ) VALUES (
      'asset-race', 'owner-race', 'project-race', 'image', 'active', NULL
    )
  `);
  await query(`
    INSERT INTO wujie_asset_versions (
      id, asset_id, owner_id, project_id, file_url, checksum,
      mime_type, byte_size, width, height, availability
    ) VALUES (
      'version-race', 'asset-race', 'owner-race', 'project-race',
      '/api/serve-upload/uploads/race.png', 'sum-race',
      'image/png', 4, 10, 20, 'ready'
    )
  `);
  await query(`
    UPDATE wujie_assets
       SET current_version_id = 'version-race'
     WHERE id = 'asset-race'
  `);
  await query(`
    INSERT INTO wujie_workspace_placements (
      id, owner_id, project_id, asset_id, asset_version_id,
      workspace_kind, workspace_id, entity_type, entity_id, status,
      transform, metadata, created_at, updated_at
    ) VALUES (
      'placement-race', 'owner-race', 'project-race', 'asset-race', 'version-race',
      'canvas', 'project-race', 'canvas-image', 'entity-race', 'active',
      '{"x":1,"y":2,"width":10,"height":20,"rotation":0,"zIndex":0}'::jsonb,
      '{}'::jsonb, '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z'
    )
  `);
}

function shareItem(shareId: string, itemId = `item-${shareId}`): CanvasShareItemRecord {
  return {
    id: itemId,
    shareId,
    placementId: 'placement-race',
    assetId: 'asset-race',
    assetVersionId: 'version-race',
    entityType: 'canvas-image',
    assetKind: 'image',
    transform: { x: 1, y: 2, width: 10, height: 20, rotation: 0, zIndex: 0 },
    displayMetadata: { label: 'Race image' },
    mimeType: 'image/png',
    width: 10,
    height: 20,
    byteSize: 4,
    checksum: 'sum-race',
    availability: 'ready',
    sortOrder: 0,
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

function shareRecord(
  id: string,
  rawToken: string,
  overrides: Partial<CanvasShareRecord> = {},
): CanvasShareRecord {
  const item = shareItem(id);
  const base: CanvasShareRecord = {
    id,
    ownerId: 'owner-race',
    projectId: 'project-race',
    projectRevision: 7,
    tokenHash: hashCanvasShareToken(rawToken),
    title: 'Race share',
    status: 'active',
    expiresAt: '2099-09-19T00:00:00.000Z',
    allowDownload: true,
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    snapshotDigest: '',
    viewCount: 0,
    lastViewedAt: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
  return {
    ...base,
    snapshotDigest: overrides.snapshotDigest
      ?? computeCanvasShareSnapshotDigestForRead(base, [item]),
  };
}

async function persistShare(
  id: string,
  rawToken: string,
  overrides: Partial<CanvasShareRecord> = {},
): Promise<{ record: CanvasShareRecord; item: CanvasShareItemRecord }> {
  const record = shareRecord(id, rawToken, overrides);
  const item = shareItem(id);
  await insertCanvasShare(record, [item]);
  return { record, item };
}

function createPersistence(
  input: CanvasShareCreatePersistenceInput,
): Promise<StoredCanvasShareSnapshot> {
  const item = shareItem(input.id, 'item-create-race');
  const record: CanvasShareRecord = {
    id: input.id,
    ownerId: input.ownerId,
    projectId: input.projectId,
    projectRevision: 7,
    tokenHash: input.tokenHash,
    title: input.title,
    status: 'active',
    expiresAt: input.expiresAt,
    allowDownload: input.allowDownload,
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    snapshotDigest: '',
    viewCount: 0,
    lastViewedAt: null,
    createdAt: input.createdAt,
    revokedAt: null,
  };
  record.snapshotDigest = computeCanvasShareSnapshotDigestForRead(record, [item]);
  return insertCanvasShare(record, [item]);
}

describe('canvas-share PostgreSQL concurrency and isolation', () => {
  postgresIt('keeps duplicate creation atomic and owner scoped without storing a raw token', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-concurrent-create', async ({ query }) => {
      await applyMigrations(query);
      await seedGraph(query);
      const rawToken = 'C'.repeat(43);
      const dependencies = {
        createToken: () => rawToken,
        hashToken: hashCanvasShareToken,
        createId: () => 'share-create-race',
        now: () => new Date('2026-09-19T00:00:00.000Z'),
        createSnapshotAndInsert: createPersistence,
      };

      const results = await Promise.allSettled([
        createCanvasShare({
          actorUserId: 'owner-race', projectId: 'project-race', title: 'Concurrent',
        }, dependencies),
        createCanvasShare({
          actorUserId: 'owner-race', projectId: 'project-race', title: 'Concurrent',
        }, dependencies),
      ]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const counts = await query<{
        shares: string;
        items: string;
        raw_tokens: string;
      }>(`
        SELECT
          (SELECT count(*) FROM wujie_canvas_shares)::text AS shares,
          (SELECT count(*) FROM wujie_canvas_share_items)::text AS items,
          (SELECT count(*) FROM wujie_canvas_shares WHERE token_hash = $1)::text AS raw_tokens
      `, [rawToken]);
      expect(counts.rows).toEqual([{ shares: '1', items: '1', raw_tokens: '0' }]);
      await expect(findCanvasShareForOwner('owner-foreign', 'share-create-race'))
        .resolves.toBeNull();
    });
  }, 30_000);

  postgresIt('linearizes duplicate revoke and concurrent policy CAS without rewriting snapshot identity', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-policy-revoke-races', async ({ query }) => {
      await applyMigrations(query);
      await seedGraph(query);
      const policy = await persistShare('share-policy-race', 'P'.repeat(43));
      const revoked = await persistShare('share-revoke-race', 'R'.repeat(43));
      let reads = 0;
      let releaseReads: (() => void) | undefined;
      const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
      const findAtSameVersion = async (ownerId: string, shareId: string) => {
        const found = await findCanvasShareForOwner(ownerId, shareId);
        reads += 1;
        if (reads === 2) releaseReads?.();
        await bothRead;
        return found;
      };
      const now = () => new Date('2026-09-20T00:00:00.000Z');

      const policyResults = await Promise.allSettled([
        patchCanvasSharePolicy({
          actorUserId: 'owner-race',
          shareId: policy.record.id,
          patch: { allowDownload: false },
        }, { now, find: findAtSameVersion }),
        patchCanvasSharePolicy({
          actorUserId: 'owner-race',
          shareId: policy.record.id,
          patch: { expiresAt: '2099-10-19T00:00:00.000Z' },
        }, { now, find: findAtSameVersion }),
      ]);
      expect(policyResults.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(policyResults.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(policyResults.find(result => result.status === 'rejected')).toMatchObject({
        reason: { code: 'CANVAS_SHARE_POLICY_CONFLICT' },
      });

      const revokeDependencies = {
        now,
        find: findCanvasShareForOwner,
        revoke: revokeCanvasShareInStorage,
      };
      const revokeResults = await Promise.all([
        revokeCanvasShare({
          actorUserId: 'owner-race', shareId: revoked.record.id,
        }, revokeDependencies),
        revokeCanvasShare({
          actorUserId: 'owner-race', shareId: revoked.record.id,
        }, revokeDependencies),
      ]);
      expect(revokeResults).toHaveLength(2);
      expect(revokeResults.every(result => result.status === 'revoked')).toBe(true);

      const rows = await query<{
        id: string;
        project_revision: number;
        snapshot_digest: string;
        viewport: CanvasShareRecord['viewport'];
      }>(`
        SELECT id, project_revision, snapshot_digest, viewport
          FROM wujie_canvas_shares
         WHERE id = ANY($1::text[])
         ORDER BY id
      `, [[policy.record.id, revoked.record.id]]);
      expect(rows.rows).toEqual([
        {
          id: policy.record.id,
          project_revision: policy.record.projectRevision,
          snapshot_digest: policy.record.snapshotDigest,
          viewport: policy.record.viewport,
        },
        {
          id: revoked.record.id,
          project_revision: revoked.record.projectRevision,
          snapshot_digest: revoked.record.snapshotDigest,
          viewport: revoked.record.viewport,
        },
      ]);
    });
  }, 30_000);

  postgresIt('fails closed when expiry checks race and preserves the immutable snapshot', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-expiry-race', async ({ query }) => {
      await applyMigrations(query);
      await seedGraph(query);
      const rawToken = 'E'.repeat(43);
      const expired = await persistShare('share-expiry-race', rawToken, {
        expiresAt: '2026-09-19T00:30:00.000Z',
      });
      const now = () => new Date('2026-09-19T01:00:00.000Z');
      const results = await Promise.allSettled([
        readPublicCanvasShare(rawToken, {}, {
          now,
          hashToken: hashCanvasShareToken,
          withActiveSnapshot: withActiveCanvasShareSnapshot,
        }),
        patchCanvasSharePolicy({
          actorUserId: 'owner-race',
          shareId: expired.record.id,
          patch: { expiresAt: '2099-09-19T00:00:00.000Z' },
        }, { now, find: findCanvasShareForOwner }),
      ]);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
      expect(results.map(result => (
        result.status === 'rejected' ? (result.reason as { code?: string }).code : null
      ))).toEqual(['CANVAS_SHARE_NOT_FOUND', 'CANVAS_SHARE_POLICY_CONFLICT']);
      const persisted = await findCanvasShareForOwner('owner-race', expired.record.id);
      expect(persisted?.record).toMatchObject({
        expiresAt: expired.record.expiresAt,
        projectRevision: expired.record.projectRevision,
        snapshotDigest: expired.record.snapshotDigest,
        viewport: expired.record.viewport,
      });
    });
  }, 30_000);

  postgresIt('serializes a media read with revoke and blocks every later public surface', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-media-revoke-race', async ({ query }) => {
      await applyMigrations(query);
      await seedGraph(query);
      const rawToken = 'M'.repeat(43);
      const stored = await persistShare('share-media-race', rawToken);
      const itemRef = createCanvasSharePublicItemRef(stored.record.tokenHash, stored.item.id);
      const foreignItemRef = createCanvasSharePublicItemRef(
        hashCanvasShareToken('F'.repeat(43)),
        'foreign-item',
      );
      await expect(readPublicCanvasShareMedia({
        token: rawToken,
        itemRef: foreignItemRef,
        download: false,
        rangeHeader: null,
      })).rejects.toMatchObject({ code: 'CANVAS_SHARE_NOT_FOUND' });

      let signalAuthorized: (() => void) | undefined;
      let releaseRead: (() => void) | undefined;
      const authorized = new Promise<void>(resolve => { signalAuthorized = resolve; });
      const holdRead = new Promise<void>(resolve => { releaseRead = resolve; });
      const mediaPromise = readPublicCanvasShareMedia({
        token: rawToken,
        itemRef,
        download: false,
        rangeHeader: null,
        onAuthorized: async () => {
          signalAuthorized?.();
          await holdRead;
        },
      });
      await authorized;
      const revokePromise = revokeCanvasShare({
        actorUserId: 'owner-race',
        shareId: stored.record.id,
      }, {
        now: () => new Date('2026-09-20T00:00:00.000Z'),
        find: findCanvasShareForOwner,
        revoke: revokeCanvasShareInStorage,
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      releaseRead?.();
      const [media, revoked] = await Promise.all([mediaPromise, revokePromise]);
      expect(media.bytes).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(revoked.status).toBe('revoked');

      await expect(readPublicCanvasShare(rawToken)).rejects.toMatchObject({
        code: 'CANVAS_SHARE_NOT_FOUND',
      });
      for (const download of [false, true]) {
        await expect(readPublicCanvasShareMedia({
          token: rawToken,
          itemRef,
          download,
          rangeHeader: null,
        })).rejects.toMatchObject({ code: 'CANVAS_SHARE_NOT_FOUND' });
      }
      const persisted = await findCanvasShareForOwner('owner-race', stored.record.id);
      expect(persisted?.record).toMatchObject({
        status: 'revoked',
        projectRevision: stored.record.projectRevision,
        snapshotDigest: stored.record.snapshotDigest,
        viewport: stored.record.viewport,
      });
    });
  }, 30_000);
});
