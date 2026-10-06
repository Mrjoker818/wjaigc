import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Only authenticated internal delivery, provider credentials, external transport
// and platform scheduling are fixtures. The route, proof, PG billing and worker
// remain real. This tests the dispatch seam, not the annotation compiler.
const boundary = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, externalCalls: 0 }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { boundary.callbacks.push(callback); },
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<unknown> => ({ userId: 'editor', userRole: 'user', source: 'internal',
    user: { id: 'editor', name: 'Editor', role: 'user', status: 'active', imageModels: ['provider::gpt-image-1'] } }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({ 'x-test-auth': 'editor' }),
  getRequestUser: async (): Promise<unknown> => ({ userId: 'editor', userRole: 'user', source: 'internal',
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

import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasEdit, editBody } from '../helpers/canvas-edit-fixture';
import { canvasBilling } from '../helpers/canvas-generation-fixture';
import { findAuthorizedAnnotationSource } from '@/lib/annotation-authorized-source';
import { parseCanvasTaskPublicationIntent } from '@/lib/collaboration/task-publication-intent';
import { POST } from '@/app/api/edit/route';

beforeEach((): void => {
  boundary.callbacks = []; boundary.externalCalls = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
    boundary.externalCalls++;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe('https://provider.invalid');
    expect(url.pathname).toBe('/images/generations');
    return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
  });
});
afterEach((): void => { boundary.callbacks = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('real NULL-MIME worker rejects another valid PNG before dispatch and refunds only its own charge once', async (): Promise<void> => {
  await withIsolatedPostgres('annotation_byte_dispatch', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const originalRow = (await query("SELECT to_jsonb(v) AS row FROM wujie_asset_versions v WHERE id='version-shared'")).rows[0].row;
    const source = await findAuthorizedAnnotationSource('editor', 'shared', 'image-shared');
    expect(source).not.toBeNull();
    const file = join(process.env.WUJIE_DATA_DIR!, 'shared.png');
    const original = await readFile(file);
    const response = await POST(new NextRequest('http://localhost/api/edit', { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'annotation-byte-dispatch' },
      body: JSON.stringify(editBody({ count: 1, assetWorkspace: 'canvas', assetWorkspaceId: 'shared',
        referenceImages: [], assetSourcePlacementId: 'placement-shared', sourceEntityId: 'image-shared',
        _annotationReferenceImage: `data:image/png;base64,${original.toString('base64')}`,
        _annotationSource: source })) }));
    expect(response.status).toBe(200);
    const { taskId } = await response.json() as { taskId: string };
    expect(boundary.callbacks).toHaveLength(1);
    const worker = boundary.callbacks.shift()!;
    const charged = await canvasBilling(query);
    expect(charged.tasks.map(row => row.id)).toEqual([taskId]);
    expect(charged.transactions.map(row => [row.user_id, row.type, Number(row.amount)]))
      .toEqual([['editor', 'consume', -7]]);
    const intent = parseCanvasTaskPublicationIntent(charged.publications[0].publication_intent);
    expect(intent.annotationEditSource?.byteProof?.checksum)
      .toBe(createHash('sha256').update(original).digest('hex'));
    try {
      const changed = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
      expect(changed.equals(original)).toBe(false);
      const pixels = await sharp(changed).raw().toBuffer({ resolveWithObject: true });
      expect([pixels.info.width, pixels.info.height]).toEqual([2, 2]);
      await writeFile(file, changed);
      await worker();
      expect(boundary.externalCalls).toBe(0);
      const failed = await canvasBilling(query);
      expect(failed.tasks).toHaveLength(1);
      expect(failed.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', status: 'failed' });
      expect(failed.transactions.map(row => [row.user_id, row.type, Number(row.amount)]).sort())
        .toEqual([['editor', 'consume', -7], ['editor', 'refund', 7]]);
      expect(failed.publications).toHaveLength(1);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      expect((await query('SELECT * FROM wujie_asset_versions')).rows).toHaveLength(2);
      expect((await query("SELECT to_jsonb(v) AS row FROM wujie_asset_versions v WHERE id='version-shared'")).rows[0].row).toEqual(originalRow);
      await worker();
      expect(boundary.externalCalls).toBe(0);
      expect(await canvasBilling(query)).toEqual(failed);
    } finally { await writeFile(file, original); }
    expect(await readFile(file)).toEqual(original);
  });
}, 60_000);
