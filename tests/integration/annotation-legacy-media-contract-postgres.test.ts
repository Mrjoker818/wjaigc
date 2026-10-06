import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasEdit, editDatabaseSnapshot } from '../helpers/canvas-edit-fixture';
import { canvasBilling } from '../helpers/canvas-generation-fixture';

// Only HTTP transport, authenticated session delivery, configuration credentials,
// and the platform after scheduler are fixtures. Source, compiler, admission,
// persistence, credits, worker, and canonical publication remain production code.
const boundary = vi.hoisted(() => ({
  source: 'session', callbacks: [] as Array<() => Promise<void>>,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { boundary.callbacks.push(callback); },
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<unknown> => ({ userId: 'editor', userRole: 'user', source: boundary.source,
    user: { id: 'editor', name: 'Editor', role: 'user', status: 'active', imageModels: ['provider::gpt-image-1'] } }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({ 'x-test-auth': 'editor' }),
  getRequestUser: async (): Promise<unknown> => ({ userId: 'editor', userRole: 'user', source: boundary.source,
    user: { id: 'editor', role: 'user', status: 'active' } }),
  getTrustedRequestAgentExecutionFence: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<unknown> => ({ id: 'editor' }) }));
vi.mock('@/lib/server-api-config', () => {
  const provider = { id: 'provider', name: 'Fixture', modelType: 'image', type: 'image', isEnabled: true,
    createdAt: 1, updatedAt: 1, baseUrl: 'https://provider.invalid', apiKey: 'test-only',
    selectedModels: ['gpt-image-1'], discoveredModels: [], compatProfile: 'openai' };
  return { findProviderById: async (): Promise<unknown> => provider,
    findProviderForModel: async (): Promise<unknown> => provider,
    findAllProvidersForType: async (): Promise<unknown[]> => [provider],
    getApiProviders: async (): Promise<unknown[]> => [], normalizeApiBaseUrl: (value: string): string => value };
});

import { POST as executeAnnotations } from '@/app/api/annotations/execute/route';
import { POST as edit } from '@/app/api/edit/route';
import { findAuthorizedAnnotationSource } from '@/lib/annotation-authorized-source';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import { getManagedAssetMediaDescriptor, readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { loadSafeImageInput, safeSharp } from '@/lib/safe-image-input';

beforeEach((): void => {
  boundary.source = 'session'; boundary.callbacks = [];
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Unconfigured external transport denied'); });
});
afterEach((): void => { boundary.callbacks = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function request(key: string): NextRequest {
  const version = 'image-shared:asset:version-shared';
  const annotation = { id: 'text-a', projectId: 'shared', sourceImageId: 'image-shared', sourceVersionId: version,
    type: 'text', geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } }, instruction: 'change cup to blue',
    status: 'ready', createdAt: 1, updatedAt: 1 };
  return new NextRequest('http://localhost/api/annotations/execute', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sourceImageUrl: '/api/serve-upload/client-forgery.png', bundle: {
        id: 'bundle-a', projectId: 'shared', sourceImageId: 'image-shared', sourceVersionId: version,
        annotationIds: ['text-a'], annotations: [annotation], prompt: 'change cup to blue',
        modelId: 'gpt-image-1', providerId: 'provider', idempotencyKey: key, createdAt: 1,
      },
    }) });
}

// This RED names the missing compatibility contract: identical verified PNG
// bytes with historical NULL MIME must survive real compilation and admission.
// It is not satisfied by relaxing MIME SQL alone; strict managed reads, source
// identity, charging, and canonical completion must all remain coherent.
it.each([
  { name: 'registered-png', mime: 'image/png' },
  { name: 'legacy-null-mime', mime: null },
])('verified $name supports the full compiled edit without rewriting the original version', async ({ name, mime }): Promise<void> => {
  await withIsolatedPostgres('annotation_legacy_media', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_users SET image_models=ARRAY['provider::gpt-image-1'] WHERE id='editor'");
    await query("UPDATE wujie_asset_versions SET mime_type=$1 WHERE id='version-shared'", [mime]);
    const originalVersion = (await query("SELECT to_jsonb(v) AS row FROM wujie_asset_versions v WHERE id='version-shared'")).rows[0].row;
    const before = await editDatabaseSnapshot(query);
    const source = await findAuthorizedAnnotationSource('editor', 'shared', 'image-shared');
    expect(source).toMatchObject({ imageUrl: '/api/serve-upload/shared.png', assetVersionId: 'version-shared',
      access: { actorUserId: 'editor', ownerId: 'owner', grantGeneration: '1' } });
    const bytes = await loadSafeImageInput(source!.imageUrl);
    expect(bytes.mimeType).toBe('image/png');
    expect(createHash('sha256').update(bytes.buffer).digest('hex')).toBe(originalVersion.checksum);
    const pixels = await safeSharp(bytes.buffer).raw().toBuffer({ resolveWithObject: true });
    expect([pixels.info.width, pixels.info.height]).toEqual([2, 2]);
    const version = await createPostgresAssetStorage().read(transaction => transaction.findVersion('owner', 'shared', 'version-shared'));
    expect(version).not.toBeNull();
    let descriptorFailure: string | undefined;
    try {
      expect(await getManagedAssetMediaDescriptor(version!, 'image')).toMatchObject({ mimeType: 'image/png', source: { kind: 'local' } });
    } catch (error) {
      // Observe today's additional gate, not a requirement to keep rejecting a
      // future byte-verified compatibility path. Typed PNG must already work.
      if (mime !== null) throw error;
      expect(error).toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
      descriptorFailure = 'CANVAS_SHARE_MEDIA_NOT_READY';
    }
    expect(await editDatabaseSnapshot(query)).toEqual(before);
    let internalCalls = 0; let providerCalls = 0; let internalStatus = 0; let overlay = '';
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      if (target.origin === `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT || '5000'}`
        && target.pathname === '/api/edit' && target.search === '' && target.hash === '') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ image: '/api/serve-upload/shared.png', projectId: 'shared',
          referenceImages: [], assetParentVersionIds: ['version-shared'],
          _annotationSource: { actorUserId: 'editor', assetVersionId: 'version-shared', placementId: 'placement-shared' } });
        overlay = String(body._annotationReferenceImage);
        const decoded = await loadSafeImageInput(overlay);
        expect(decoded.mimeType).toBe('image/png');
        await safeSharp(decoded.buffer).raw().toBuffer();
        internalCalls++; boundary.source = 'internal';
        try {
          const response = await edit(new NextRequest('http://localhost/api/edit', { ...init, signal: init?.signal ?? undefined }));
          internalStatus = response.status;
          return response;
        } finally { boundary.source = 'session'; }
      }
      if (target.hostname !== 'provider.invalid') throw new Error('Unexpected external transport denied');
      expect(target.origin).toBe('https://provider.invalid');
      expect(target.pathname).toBe('/images/generations');
      expect(target.search).toBe(''); expect(target.hash).toBe(''); expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { model: string; n: number; images: Array<{ image_url: { url: string } }> };
      expect(body.model).toBe('gpt-image-1'); expect(body.n).toBe(1);
      const sentImages = body.images.map(item => item.image_url.url);
      expect(sentImages).toHaveLength(2); expect(sentImages[1]).toBe(overlay);
      const sentPrimary = await loadSafeImageInput(sentImages[0]);
      expect(sentPrimary.mimeType).toBe('image/png');
      expect(createHash('sha256').update(sentPrimary.buffer).digest('hex')).toBe(originalVersion.checksum);
      providerCalls++;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const response = await executeAnnotations(request(`legacy-media-${name}`));
    expect(internalCalls).toBe(1); expect(providerCalls).toBe(0);
    if (response.status !== 202) {
      // Capture the downstream rejection and zero-side-effect assertions before
      // the RED assertion, rather than leaving billing observations unexecuted.
      const failure: unknown = await response.clone().json();
      expect(await editDatabaseSnapshot(query)).toEqual(before);
      expect(boundary.callbacks).toHaveLength(0);
      console.info('Legacy media boundary:', { name, internalStatus, responseStatus: response.status, failure,
        primaryPixelsDecoded: true, compiledOverlayDecoded: true, descriptorFailure, databaseUnchanged: true });
    }
    expect(response.status).toBe(202);
    const { taskId } = await response.json() as { taskId: string };
    expect(boundary.callbacks).toHaveLength(1); await boundary.callbacks.shift()!();
    expect(providerCalls).toBe(1);
    const billing = await canvasBilling(query);
    expect(billing.tasks).toHaveLength(1);
    expect(billing.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', project_id: 'shared', status: 'completed' });
    expect(billing.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(billing.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect(billing.publications).toHaveLength(1);
    expect(billing.publications[0]).toMatchObject({ task_id: taskId, actor_id: 'editor', owner_id: 'owner',
      project_id: 'shared', workspace_id: 'shared', grant_generation: '1', publication_intent: {
        parentVersionIds: ['version-shared'], selectionSnapshot: [{ entityId: 'image-shared',
          placementId: 'placement-shared', assetVersionId: 'version-shared' }],
        annotationEditSource: { version: 1, requestDigest: billing.tasks[0].request_digest,
          sourceSnapshot: [{ versionId: 'version-shared', assetId: 'asset-shared' }] },
      } });
    const commands = (await query('SELECT * FROM wujie_canvas_asset_commands')).rows;
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toMatchObject({ actor_id: 'editor', owner_id: 'owner', project_id: 'shared' });
    const published = (await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [command.asset_version_id])).rows[0];
    expect(published).toMatchObject({ asset_id: command.asset_id, owner_id: 'owner', project_id: 'shared', task_id: taskId,
      availability: 'ready', mime_type: 'image/png' });
    const placement = (await query('SELECT * FROM wujie_workspace_placements WHERE id=$1', [command.placement_id])).rows[0];
    expect(placement).toMatchObject({ asset_id: command.asset_id, asset_version_id: published.id, owner_id: 'owner',
      project_id: 'shared', workspace_kind: 'canvas', workspace_id: 'shared', status: 'active' });
    const document = (await query("SELECT projection,sequence FROM wujie_project_canvas_documents WHERE project_id='shared' AND owner_id='owner'")).rows[0];
    expect(document.projection.placements[command.placement_id]).toMatchObject({ assetVersionId: published.id });
    expect(Number(document.sequence)).toBe(Number(command.document_sequence));
    expect((await query('SELECT * FROM wujie_canvas_media_lineage WHERE target_version_id=$1', [published.id])).rows[0])
      .toMatchObject({ actor_id: 'editor', task_id: taskId, source_kind: 'task', output_index: 0,
        target_asset_id: command.asset_id, target_owner_id: 'owner', target_project_id: 'shared' });
    // A SQL-only NULL-MIME bypass must not satisfy the future success contract:
    // the real managed reader must also deliver the same original version bytes,
    // without a test-manufactured MIME or mutation of the registered version.
    const delivered = await readManagedAssetVersionBytes(version!, 'image');
    expect(delivered).toMatchObject({ mimeType: 'image/png', totalBytes: bytes.buffer.length });
    expect(delivered.bytes).toEqual(bytes.buffer);
    expect(await getManagedAssetMediaDescriptor(version!, 'image')).toMatchObject({
      assetVersionId: 'version-shared', assetKind: 'image', mimeType: 'image/png',
      width: 2, height: 2, byteSize: bytes.buffer.length, checksum: originalVersion.checksum,
    });
    expect((await query("SELECT to_jsonb(v) AS row FROM wujie_asset_versions v WHERE id='version-shared'")).rows[0].row).toEqual(originalVersion);
    expect(await readFile(join(process.env.WUJIE_DATA_DIR!, 'shared.png'))).toEqual(bytes.buffer);
  });
}, 60_000);

it.each([
  { name: 'corrupt-primary', mime: null, corrupt: true, status: 422, code: 'ANNOTATION_ASSET_INVALID' },
  { name: 'explicit-non-image', mime: 'video/mp4', corrupt: false, status: 404, code: 'ANNOTATION_PROJECT_NOT_FOUND' },
])('$name is rejected by the real source/compiler before an internal edit or charge exists', async ({ name, mime, corrupt, status, code }): Promise<void> => {
  await withIsolatedPostgres('annotation_legacy_reject', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_users SET image_models=ARRAY['provider::gpt-image-1'] WHERE id='editor'");
    await query("UPDATE wujie_asset_versions SET mime_type=$1 WHERE id='version-shared'", [mime]);
    const file = join(process.env.WUJIE_DATA_DIR!, 'shared.png');
    const original = await readFile(file);
    // Mutate only this helper-created isolated fixture; always restore its bytes.
    if (corrupt) await writeFile(file, Buffer.from('not an image despite its .png filename'));
    try {
      const before = await editDatabaseSnapshot(query);
      let networkCalls = 0;
      vi.stubGlobal('fetch', async (): Promise<never> => { networkCalls++; throw new Error('No transport allowed before rejection'); });
      const response = await executeAnnotations(request(`legacy-media-${name}`));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, code });
      expect(networkCalls).toBe(0); expect(boundary.callbacks).toHaveLength(0);
      expect(await editDatabaseSnapshot(query)).toEqual(before);
    } finally { if (corrupt) await writeFile(file, original); }
  });
}, 60_000);
