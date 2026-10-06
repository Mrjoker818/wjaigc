import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasEdit, editBody, editDatabaseSnapshot, lockEditAdmission } from '../helpers/canvas-edit-fixture';
import { canvasBilling } from '../helpers/canvas-generation-fixture';
import { findAuthorizedAnnotationSource, type AuthorizedAnnotationSource } from '@/lib/annotation-authorized-source';
import { prepareAnnotationImageByteProof, annotationImageByteProof, assertAnnotationImageBytes,
  verifyFrozenAnnotationImageByteProof, type PreparedAnnotationImageByteProof } from '@/lib/annotation-image-byte-proof';
import { parseCanvasEditPublication } from '@/lib/collaboration/canvas-edit-admission';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { prepareTaskPublication } from '@/lib/collaboration/task-publication-output';
import { parseCanvasTaskPublicationIntent } from '@/lib/collaboration/task-publication-intent';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { getPool } from '@/lib/db-client';

beforeEach((): void => { vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('External transport forbidden'); }); });
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function sourceAndProof(): Promise<{ source: AuthorizedAnnotationSource; handle: PreparedAnnotationImageByteProof }> {
  const source = await findAuthorizedAnnotationSource('editor', 'shared', 'image-shared');
  if (!source) throw new Error('Missing actual document source');
  const handle = await prepareAnnotationImageByteProof(source);
  if (!handle) throw new Error('Missing NULL-MIME read capability');
  return { source, handle };
}
function admission(source: AuthorizedAnnotationSource, handle?: PreparedAnnotationImageByteProof): CreateBillableTaskInput {
  if (source.access?.kind !== 'document') throw new Error('Expected actual document access');
  return { userId: 'editor', idempotencyKey: 'single', requestDigest: 'a'.repeat(64), creditCost: 7,
    canvasPublication: { ...parseCanvasEditPublication(source.access, editBody()), annotationSource: source,
      ...(handle ? { annotationByteProof: handle } : {}) }, task: {
      id: 'edit_proof_test', type: 'edit', projectId: 'shared', status: 'processing',
      providerId: 'provider', model: 'gpt-image-1', progress: 0, createdAt: 1, updatedAt: 1,
    } };
}

it.each([null, 'image/png'])('only actual SQL NULL MIME mints a proof (%s), without rewriting any row', async mime => {
  await withIsolatedPostgres('annotation_byte_producer', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=$1 WHERE id='version-shared'", [mime]);
    const before = await editDatabaseSnapshot(query);
    const source = await findAuthorizedAnnotationSource('editor', 'shared', 'image-shared');
    const handle = await prepareAnnotationImageByteProof(source!);
    if (mime === null) {
      expect(handle).toBeDefined();
      const bytes = await readFile(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
      const proof = annotationImageByteProof(handle!, source!);
      expect(proof).toMatchObject({ version: 1, actorUserId: 'editor', ownerId: 'owner', projectId: 'shared',
        grantGeneration: '1', imageId: 'image-shared', assetId: 'asset-shared', assetVersionId: 'version-shared',
        placementId: 'placement-shared', mimeType: 'image/png', width: 2, height: 2, byteSize: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        urlDigest: createHash('sha256').update('/api/serve-upload/shared.png').digest('hex') });
      expect(Object.isFrozen(proof)).toBe(true);
      await verifyFrozenAnnotationImageByteProof(proof, 'editor', 'owner', 'shared');
    } else expect(handle).toBeUndefined();
    expect(await editDatabaseSnapshot(query)).toEqual(before);
  });
}, 60_000);

it('JSON clones, changed source identities and another valid PNG cannot impersonate the actual read', async (): Promise<void> => {
  await withIsolatedPostgres('annotation_byte_capability', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const { source, handle } = await sourceAndProof(); const before = await editDatabaseSnapshot(query);
    expect(() => annotationImageByteProof(structuredClone(handle), source)).toThrow();
    expect(() => annotationImageByteProof(JSON.parse(JSON.stringify(handle)) as PreparedAnnotationImageByteProof, source)).toThrow();
    for (const change of [{ actorUserId: 'owner' }, { projectId: 'other' }, { imageId: 'other' },
      { imageUrl: '/api/serve-upload/second.png' }, { versionId: 'other' }, { assetVersionId: 'other' },
      { assetId: 'other' }, { placementId: 'other' }, { access: { ...source.access!, grantGeneration: '2' } }]) {
      expect(() => annotationImageByteProof(handle, { ...source, ...change } as AuthorizedAnnotationSource)).toThrow();
    }
    const bytes = await readFile(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    expect(() => assertAnnotationImageBytes(handle, source, bytes, 'image/png')).not.toThrow();
    const changed = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
    expect(() => assertAnnotationImageBytes(handle, source, changed, 'image/png')).toThrow();
    expect(() => assertAnnotationImageBytes(handle, source, bytes, 'image/jpeg')).toThrow();
    await expect(createBillableTask(admission(source, structuredClone(handle)))).rejects.toThrow();
    await expect(createBillableTask(admission(source))).rejects.toThrow();
    expect(await editDatabaseSnapshot(query)).toEqual(before);
  });
}, 60_000);

it.each(['checksum', 'url', 'grant', 'parent'])('billing lock waits reject changed %s, with no task or charge', async mutation => {
  await withIsolatedPostgres('annotation_byte_lock', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const { source, handle } = await sourceAndProof(); const input = admission(source, handle);
    const lock = await lockEditAdmission('single');
    const pending = createBillableTask(input).then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    let before: Record<string, unknown>;
    try {
      await lock.wait(query);
      if (mutation === 'checksum') await query("UPDATE wujie_asset_versions SET checksum=$1 WHERE id='version-shared'", ['b'.repeat(64)]);
      if (mutation === 'url') await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/second.png' WHERE id='version-shared'");
      if (mutation === 'grant') await revokeDocumentEditor('owner', 'shared', 'editor');
      if (mutation === 'parent') {
        await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
          SELECT 'version-byte-parent',asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height
          FROM wujie_asset_versions WHERE id='version-shared'`);
        await query(`INSERT INTO wujie_asset_version_parents(asset_id,owner_id,project_id,version_id,parent_version_id,parent_order)
          VALUES('asset-shared','owner','shared','version-shared','version-byte-parent',0)`);
      }
      before = await editDatabaseSnapshot(query);
    } finally { await lock.release(); }
    expect((await pending).error).toBeDefined();
    expect(await editDatabaseSnapshot(query)).toEqual(before!);
    const billing = await canvasBilling(query);
    expect(billing.tasks).toHaveLength(0); expect(billing.transactions).toHaveLength(0); expect(billing.publications).toHaveLength(0);
  });
}, 60_000);

it('freezes the exact proof, replays without another charge, and rejects a modified persisted proof', async (): Promise<void> => {
  await withIsolatedPostgres('annotation_byte_replay', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const { source, handle } = await sourceAndProof(); const input = admission(source, handle);
    const first = await createBillableTask(input);
    const billing = await canvasBilling(query);
    const intent = parseCanvasTaskPublicationIntent(billing.publications[0].publication_intent);
    expect(intent.annotationEditSource!.byteProof).toEqual(annotationImageByteProof(handle, source));
    expect(Object.isFrozen(intent.annotationEditSource!.byteProof)).toBe(true);
    const fresh = await sourceAndProof();
    const replay = await createBillableTask(admission(fresh.source, fresh.handle));
    expect(replay.task.id).toBe(first.task.id); expect(replay.reused).toBe(true);
    expect(await canvasBilling(query)).toEqual(billing);
    await query("UPDATE wujie_canvas_task_publications SET publication_intent=jsonb_set(publication_intent,'{annotationEditSource,byteProof,checksum}',$1::jsonb)", [JSON.stringify('b'.repeat(64))]);
    const before = await editDatabaseSnapshot(query);
    await expect(createBillableTask(admission(fresh.source, fresh.handle))).rejects.toThrow();
    expect(await editDatabaseSnapshot(query)).toEqual(before);
    expect(billing.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
  });
}, 60_000);

it('recovery validates persisted proof without an in-memory handle and rejects a late valid-image replacement', async (): Promise<void> => {
  await withIsolatedPostgres('annotation_byte_recovery', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const { source, handle } = await sourceAndProof(); const { task } = await createBillableTask(admission(source, handle));
    await query("UPDATE cloud_tasks SET status='completed',result=result || $1::jsonb WHERE id=$2", [JSON.stringify({ imageUrls: ['/api/serve-upload/second.png'] }), task.id]);
    expect(await prepareTaskPublication('editor', task.id)).not.toBeNull();
    const file = join(process.env.WUJIE_DATA_DIR!, 'shared.png'); const original = await readFile(file);
    const before = await editDatabaseSnapshot(query);
    try {
      const changed = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
      await writeFile(file, changed);
      await expect(prepareTaskPublication('editor', task.id)).rejects.toThrow();
      expect(await editDatabaseSnapshot(query)).toEqual(before);
    } finally { await writeFile(file, original); }
    expect(await prepareTaskPublication('editor', task.id)).not.toBeNull();
    const billing = await canvasBilling(query);
    expect(billing.transactions.filter(row => row.type === 'consume')).toHaveLength(1);
    expect(billing.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each([null, 'image/png'])('publication pre-read has a bounded real row-lock wait (%s) without changing billing', async mime => {
  await withIsolatedPostgres('annotation_byte_prelock', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=$1 WHERE id='version-shared'", [mime]);
    const source = await findAuthorizedAnnotationSource('editor', 'shared', 'image-shared');
    const handle = await prepareAnnotationImageByteProof(source!);
    const { task } = await createBillableTask(admission(source!, handle));
    await query("UPDATE cloud_tasks SET status='completed',result=result || $1::jsonb WHERE id=$2", [JSON.stringify({ imageUrls: ['/api/serve-upload/second.png'] }), task.id]);
    const before = await editDatabaseSnapshot(query);
    const holder = await getPool().connect();
    let pending: Promise<unknown> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [task.id]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      pending = prepareTaskPublication('editor', task.id).then(
        value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
      const observationDeadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < observationDeadline) {
        if ((await query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [holderPid])).rowCount) {
          blocked = true; break;
        }
      }
      expect(blocked).toBe(true);
      // The timer is only a test rescue. The product must return its own SQL
      // timeout while the conflicting holder is still active, not after release.
      const result = await Promise.race([pending, new Promise<{ rescueExpired: true }>(resolve => {
        timer = setTimeout((): void => resolve({ rescueExpired: true }), 5_000);
      })]);
      expect(result).not.toHaveProperty('rescueExpired');
      expect(result).toMatchObject({ error: { code: 'CANVAS_TASK_PUBLICATION_UNAVAILABLE', status: 503 } });
    } finally {
      if (timer) clearTimeout(timer);
      try { await holder.query('ROLLBACK'); } finally {
        holder.release();
        if (pending) await pending;
      }
    }
    expect(await editDatabaseSnapshot(query)).toEqual(before);
    expect(await prepareTaskPublication('editor', task.id)).not.toBeNull();
  });
}, 60_000);
