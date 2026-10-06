import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { isActiveOfflineBridgeTestConnection } from '../helpers/offline-bridge-database-guard';
import { ensureCoreTables } from '@/lib/db-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { claimCloudTaskLease } from '@/lib/cloud-task-storage';
import { openImageEditProviderPhase } from '@/lib/task-core/image-edit-provider-phase';
import type { OpenImageEditProviderPhaseInput } from '@/lib/task-core/image-edit-provider-checkpoint';
import type { ImageEditProviderCallOptions, ImageEditProviderAccepted } from '@/lib/image-edit-provider-boundary';
import { createImageEditProviderCall } from '@/lib/image-edit-provider-boundary';
import { submitDedicatedRemoveBg } from '@/lib/remove-bg-provider';
import { enhanceViaAI } from '@/lib/quality-enhance';
import type { ApiProvider } from '@/lib/universal-api-types';

vi.mock('server-only', () => ({}));
const external = vi.hoisted(() => ({ upload: vi.fn(), source: vi.fn(), find: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  uploadBinaryToS3: external.upload, readManagedImageFromS3Bounded: external.source,
}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: external.find }));
vi.mock('@/lib/safe-image-download', async original => {
  const actual = await original<typeof import('@/lib/safe-image-download')>();
  return { ...actual, downloadPublicImage: async (input: string | URL,
    options?: Parameters<typeof actual.downloadPublicImage>[1]): Promise<{ buffer: Buffer; mimeType: string }> => {
    if (String(input).includes('127.0.0.1')) return actual.downloadPublicImage(input, options);
    if (String(input) === source) {
      const response = await (sourceReadForSafe?.(new Request(source)) ?? Promise.resolve(binary(sourceBytes)));
      options?.signal?.throwIfAborted();
      return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: 'image/png' };
    }
    return external.download(String(input), options);
  } };
});
const base = 'https://aux-provider.invalid';
const source = 'https://media.invalid/j4f-source.png';
const output = 'https://media.invalid/j4f-output.png';
const key = 'offline-j4f-secret';
const stopped = 'Image edit provider boundary stopped';
let sourceBytes: Buffer;
let transparentBytes: Buffer;
let sourceReadForSafe: ((request: Request) => Promise<Response>) | undefined;

beforeEach(async (): Promise<void> => {
  sourceReadForSafe = undefined;
  const pg = new URL(process.env.POSTGRES_TEST_DATABASE_URL!);
  const activeBridge = isActiveOfflineBridgeTestConnection(process.env, process.env.POSTGRES_TEST_DATABASE_URL!);
  const legacy = pg.hostname === '127.0.0.1' && pg.port === '55492'
    && pg.pathname === '/wujie_yjs_task8cb3i2_20260927';
  if (!activeBridge && !legacy) throw new Error('Isolated PG required before connecting');
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
  vi.stubEnv('INTERNAL_API_SECRET', 'offline-j4f-internal-secret-at-least-32-characters');
  external.upload.mockReset().mockResolvedValue(null);
  external.source.mockReset().mockRejectedValue(new Error('Undeclared S3 read'));
  external.find.mockReset().mockResolvedValue(null);
  sourceBytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#cc8844' } }).png().toBuffer();
  external.download.mockReset().mockImplementation(async (url: string): Promise<{ buffer: Buffer; mimeType: string }> => {
    if (url !== output) throw new Error(`Undeclared public image download: ${url}`);
    return { buffer: sourceBytes, mimeType: 'image/png' };
  });
  const rgba = Buffer.alloc(64);
  for (let pixel = 0; pixel < 16; pixel++) {
    rgba.set([204, 136, 68, pixel < 8 ? 255 : 0], pixel * 4);
  }
  transparentBytes = await sharp(rgba, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
});
afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function provider(): ApiProvider {
  return { id: 'aux-provider', name: 'Aux', type: 'image', isEnabled: true, baseUrl: base + '/v1', apiKey: key,
    selectedModel: 'gpt-image-1', createdAt: 1, updatedAt: 1,
    advancedParams: { removeBgRequestProfile: 'removebg-multipart' } };
}
async function fixture(query: QueryFn, databaseUrl: string): Promise<OpenImageEditProviderPhaseInput> {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('options');
  const activeBridge = isActiveOfflineBridgeTestConnection(process.env, databaseUrl)
    && schema?.startsWith('-csearch_path=test_task_8cb3j4f_');
  const legacy = url.hostname === '127.0.0.1' && url.port === '55492'
    && url.pathname === '/wujie_yjs_task8cb3i2_20260927'
    && schema?.startsWith('-csearch_path=test_task_8cb3j4f_');
  if (!activeBridge && !legacy) throw new Error('Isolated PG required');
  await ensureCoreTables();
  for (const migration of ['20260909_mpe_export_cleanup_outbox.sql', '20260910_mpe_export_cleanup_leases.sql', '20260927_asset_cleanup_local_identity.sql']) {
    await query(await readFile(path.resolve('migrations', migration), 'utf8'));
  }
  await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('aux-user','Aux','test','active','user',1,1)");
  await query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) VALUES ('aux-credit','aux-user',100,100,0,1,1)");
  expect((await createBillableTask({ userId: 'aux-user', idempotencyKey: 'aux-admission', requestDigest: 'a'.repeat(64), creditCost: 7,
    task: { id: 'aux-task', projectId: 'aux-project', type: 'image-edit', status: 'processing', progress: 0,
      createdAt: Date.now(), updatedAt: Date.now(), result: { existing: { preserved: true }, skillBillingProvenance: { marker: 'keep' } } } })).charged).toBe(true);
  expect(await claimCloudTaskLease('aux-task', 'aux-worker', 120_000)).toMatchObject({ owner: 'aux-worker' });
  return { taskId: 'aux-task', actorUserId: 'aux-user', projectId: 'aux-project', requestDigest: 'a'.repeat(64), leaseOwner: 'aux-worker',
    phase: { phaseId: 'aux:0', inputDigest: 'b'.repeat(64), targets: [{ providerId: 'aux-provider', modelId: 'gpt-image-1', kind: 'image' }] },
    beforeDispatch: async (): Promise<void> => {}, secretValues: [key] };
}
async function ready(input: OpenImageEditProviderPhaseInput): Promise<ImageEditProviderCallOptions> {
  const opened = await openImageEditProviderPhase(input);
  if (opened.status !== 'ready') throw new Error('Expected ready: ' + opened.status);
  return { providerId: 'aux-provider', boundary: opened.boundary };
}
async function checkpoint(query: QueryFn): Promise<unknown> {
  return (await query("SELECT result->'imageEditExecution' AS checkpoint FROM cloud_tasks WHERE id='aux-task'")).rows[0].checkpoint;
}
async function attempts(query: QueryFn): Promise<Array<{ status: string; result?: ImageEditProviderAccepted }>> {
  const stored = await checkpoint(query) as { phases: Array<{ attempts: Array<{ status: string; result?: ImageEditProviderAccepted }> }> };
  return stored.phases[0].attempts;
}
async function unchanged(query: QueryFn): Promise<unknown> {
  return { tasks: (await query("SELECT to_jsonb(t) - 'revision' - 'updated_at' - 'result' AS row, result - 'imageEditExecution' AS result FROM cloud_tasks t ORDER BY id")).rows,
    credits: (await query('SELECT * FROM wujie_credits ORDER BY id')).rows,
    ledger: (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows };
}
function binary(bytes = transparentBytes, mime = 'image/png'): Response {
  return new Response(Uint8Array.from(bytes), { headers: { 'content-type': mime } });
}
const runRemove = submitDedicatedRemoveBg;
const runEnhance = enhanceViaAI;
function sourceData(): string { return 'data:image/png;base64,' + sourceBytes.toString('base64'); }
function network(submit: (request: Request) => Promise<Response>, later?: (request: Request) => Promise<Response>,
  sourceRead?: (request: Request) => Promise<Response>): Request[] {
  sourceReadForSafe = sourceRead;
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.url === source && request.method === 'GET') return sourceRead ? sourceRead(request) : binary(sourceBytes);
    if (request.url.startsWith(base + '/') && request.method === 'POST') { requests.push(request); return submit(request); }
    if (later && request.url.startsWith(base + '/v1/tasks/') && request.method === 'GET') return later(request);
    throw new Error('Undeclared network: ' + request.method + ' ' + request.url);
  });
  return requests;
}
type Helper = 'remove' | 'enhance';
function invoke(kind: Helper, execution?: ImageEditProviderCallOptions, signal?: AbortSignal, p = provider()): Promise<unknown> {
  return kind === 'remove' ? runRemove(p, sourceData(), { execution, signal })
    : runEnhance(source, 'gpt-image-1', p.id, {}, p, execution ? { execution, signal } : undefined);
}
async function invariant(query: QueryFn, before: unknown): Promise<void> {
  expect(await unchanged(query)).toEqual(before);
  expect(JSON.stringify(await checkpoint(query))).not.toMatch(/offline-j4f-secret|Bearer|apiKey|advancedParams|image_file|base64/);
}

describe('auxiliary helpers / real durable PG phase', (): void => {
  it('rejects a private enhance source before provider phase or credit changes', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-private-source', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const before = await unchanged(query);
      const sends = vi.fn(async (): Promise<never> => { throw new Error('Undeclared network'); });
      vi.stubGlobal('fetch', sends);
      await expect(runEnhance('http://127.0.0.1/private-source.png', 'gpt-image-1', 'aux-provider', {}, provider(),
        { execution: await ready(input) })).rejects.toThrow(stopped);
      expect(sends).not.toHaveBeenCalled();
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'ready' });
      expect(await attempts(query)).toEqual([]);
      await invariant(query, before);
    });
  });
  it('RED RemoveBG commits started before the real transparent PNG response', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-started', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => {
        expect.soft(await attempts(query)).toMatchObject([{ status: 'started' }]);
        return binary();
      });
      const result = await runRemove(provider(), sourceData(), { execution: await ready(input) });
      expect(result.buffer).toEqual(transparentBytes);
      expect(result.directUrl).toMatch(/^\/api\/serve-upload\/exports\/.+-remove-bg\.png$/);
      expect(await readFile(path.join(process.env.WUJIE_DATA_DIR!, result.directUrl!.replace('/api/serve-upload/', '')))).toEqual(result.buffer);
      vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Recovery must not use HTTP'); });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { directUrl: result.directUrl } });
      expect(requests).toHaveLength(1);
      expect(await unchanged(query)).toEqual(before);
    });
  });
  it('RED enhance response loss stops instead of original-image fallback and reopens unknown', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-loss', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const requests = network(async (): Promise<Response> => { throw new Error('server accepted; response lost'); });
      const outcome = await runEnhance(source, 'gpt-image-1', 'aux-provider', {}, provider(), { execution: await ready(input) })
        .then(value => ({ value }), (error: unknown) => ({ error }));
      expect.soft(outcome).toMatchObject({ error: { message: stopped } });
      expect.soft((await openImageEditProviderPhase(input)).status).toBe('submission-unknown');
      expect(requests).toHaveLength(1);
    });
  });
  it('does not hand an accepted private enhance URL to the privileged save endpoint', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-enhance-private', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      let internalSaves = 0;
      const requests = network(async (): Promise<Response> =>
        Response.json({ imageUrl: 'http://127.0.0.1/private-image.png' }), async (): Promise<Response> => {
        internalSaves++;
        return Response.json({ success: true, url: '/api/serve-upload/uploads/unsafe.png' });
      });
      await expect(invoke('enhance', await ready(input))).rejects.toThrow(stopped);
      expect(internalSaves).toBe(0);
      expect(requests).toHaveLength(1);
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted',
        result: { directUrl: 'http://127.0.0.1/private-image.png' } });
      expect((await query("SELECT status,credit_status FROM cloud_tasks WHERE id='aux-task'")).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
    });
  });
  it('rejects a private legacy enhance result without privileged remote fetching', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-legacy-private', async ({ query, databaseUrl }): Promise<void> => {
      await fixture(query, databaseUrl);
      const before = await unchanged(query);
      let privilegedSaves = 0;
      const requests = network(async (): Promise<Response> =>
        Response.json({ imageUrl: 'http://127.0.0.1/private-image.png' }), async (): Promise<Response> => {
        privilegedSaves += 1;
        return Response.json({ success: true, url: '/api/serve-upload/uploads/unsafe.png' });
      });
      expect(await invoke('enhance')).toEqual({ url: source, enhanced: false });
      expect(privilegedSaves).toBe(0);
      expect(requests).toHaveLength(1);
      expect(await checkpoint(query)).toBeNull();
      expect(await unchanged(query)).toEqual(before);
    });
  });
  it('persists an accepted image data URL without privileged remote fetching', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-enhance-data', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const dataUrl = sourceData();
      let internalSaves = 0;
      const requests = network(async (): Promise<Response> => Response.json({ imageUrl: dataUrl }),
        async (): Promise<Response> => {
          internalSaves++;
          return Response.json({ success: true, url: '/api/serve-upload/uploads/legacy-data.png' });
        });
      const result = await invoke('enhance', await ready(input)) as { url: string; enhanced: boolean };
      expect(result.enhanced).toBe(true);
      expect(result.url).toMatch(/^\/api\/serve-upload\/exports\/.+\.png$/);
      expect(await readFile(path.join(process.env.WUJIE_DATA_DIR!, result.url.replace('/api/serve-upload/', ''))))
        .toEqual(sourceBytes);
      expect(internalSaves).toBe(0);
      expect(requests).toHaveLength(1);
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted',
        result: { directUrl: result.url, managedExport: true } });
      expect(JSON.stringify(await checkpoint(query))).not.toContain('base64');
    });
  });
  it.each(['direct', 'remote'] as const)('enhance %s is accepted before persistence or polling', async (mode): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-enhance', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const before = await unchanged(query);
      const expected = mode === 'direct' ? { kind: 'image', directUrl: output } : { kind: 'image', taskId: 'remote-7' };
      let laterCount = 0;
      const requests = network(async (): Promise<Response> => {
        expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
        return Response.json(mode === 'direct' ? { imageUrl: output } : { task_id: 'remote-7' });
      }, async (request): Promise<Response> => {
        laterCount++;
        expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: expected }]);
        expect(request.method).toBe('GET');
        return Response.json({ status: 'completed', result: { image_url: output } });
      });
      const result = await runEnhance(source, 'gpt-image-1', 'aux-provider', {}, provider(), { execution: await ready(input) });
      expect(result.enhanced).toBe(true);
      expect(await readFile(path.join(process.env.WUJIE_DATA_DIR!, result.url.replace('/api/serve-upload/', '')))).toEqual(sourceBytes);
      vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Recovery must not use HTTP'); });
      expect(await openImageEditProviderPhase({ ...input })).toMatchObject({ status: 'accepted', result: expected });
      expect(laterCount).toBe(mode === 'direct' ? 0 : 1);
      expect(requests).toHaveLength(1);
      expect(await unchanged(query)).toEqual(before);
    });
  }, 15000);
  it.each([
    ['broken JSON', (): Response => new Response('{bad', { headers: { 'content-type': 'application/json' } })],
    ['missing result', (): Response => Response.json({})],
    ['object result', (): Response => Response.json({ taskId: { id: 'fake' }, imageUrl: { url: output } })],
    ['blank result', (): Response => Response.json({ taskId: ' ', imageUrl: '' })],
    ['500', (): Response => new Response('invalid request', { status: 500 })],
  ] as const)('enhance %s cannot be fallback or a second POST', async (_name, response): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-unknown', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => response());
      const p = provider(); p.baseUrl = base;
      await expect(runEnhance(source, 'gpt-image-1', p.id, {}, p, { execution: await ready(input) })).rejects.toThrow(stopped);
      expect(await openImageEditProviderPhase({ ...input })).toEqual({ status: 'submission-unknown' });
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(requests).toHaveLength(1);
      expect(await unchanged(query)).toEqual(before);
    });
  });
  it.each([
    ['multipart', 'png'], ['JSON', 'png'], ['multipart', 'webp'], ['JSON', 'webp'], ['multipart', 'zip'], ['JSON', 'zip'],
  ] as const)('RemoveBG %s %s preserves decoded bytes and accepted local identity', async (profile, mode): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-formats', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      let bytes = transparentBytes; let mime = 'image/png';
      if (mode === 'webp') { bytes = await sharp(transparentBytes).webp({ lossless: true }).toBuffer(); mime = 'image/webp'; }
      if (mode === 'zip') {
        const zip = new JSZip(); zip.file('result/color.png', sourceBytes);
        zip.file('result/alpha.png', await sharp(transparentBytes).extractChannel('alpha').png().toBuffer());
        bytes = await zip.generateAsync({ type: 'nodebuffer' }); mime = 'application/zip';
      }
      const p = provider(); p.selectedModel = undefined; p.selectedModels = ['gpt-image-1'];
      p.advancedParams = { removeBgRequestProfile: profile === 'JSON' ? 'images-generations' : 'removebg-multipart', removeBgResponseMode: mode };
      const requests = network(async (request): Promise<Response> => {
        expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
        expect(request.headers.get('x-api-key')).toBe(key);
        if (profile === 'JSON') expect(await request.clone().json()).toEqual({ model: 'gpt-image-1', image: sourceData(), response_format: mode === 'webp' ? 'webp' : 'png' });
        else {
          const form = await request.clone().formData();
          expect(form.get('size')).toBe('auto');
          expect(Buffer.from(await (form.get('image_file') as File).arrayBuffer())).toEqual(sourceBytes);
        }
        return binary(bytes, mime);
      });
      const result = await runRemove(p, sourceData(), { execution: await ready(input) });
      expect(result.mimeType).toBe(mode === 'webp' ? 'image/webp' : 'image/png');
      // WebP may discard RGB values of fully transparent pixels, even in lossless mode.
      expect(await sharp(result.buffer).raw().toBuffer()).toEqual(await sharp(mode === 'webp' ? bytes : transparentBytes).raw().toBuffer());
      expect(await readFile(path.join(process.env.WUJIE_DATA_DIR!, result.directUrl!.replace('/api/serve-upload/', '')))).toEqual(result.buffer);
      expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: { kind: 'image', directUrl: result.directUrl } }]);
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it.each(['opaque', 'bad bytes', 'wrong MIME', 'storage fault'] as const)('RemoveBG %s stays unknown without a false success', async (fault): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-binary-fail', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      if (fault === 'storage fault') external.upload.mockRejectedValue(new Error('offline S3 write failure'));
      const requests = network(async (): Promise<Response> => binary(fault === 'opaque' ? sourceBytes : fault === 'bad bytes' ? Buffer.from('bad image') : transparentBytes,
        fault === 'wrong MIME' ? 'text/html' : 'image/png'));
      await expect(invoke('remove', await ready(input))).rejects.toThrow(stopped);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it.each(['remove', 'enhance'] as const)('%s explicit rejection reopens ready under the old failure contract', async (kind): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-rejected', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => Response.json({ error: 'permission denied ' + key }, { status: 403 }));
      const pending = invoke(kind, await ready(input));
      if (kind === 'remove') await expect(pending).rejects.toMatchObject({ code: 'REMOVE_BG_PROVIDER_REJECTED' });
      else await expect(pending).resolves.toEqual({ url: source, enhanced: false });
      expect((await openImageEditProviderPhase(input)).status).toBe('ready');
      expect(await attempts(query)).toMatchObject([{ status: 'rejected' }]);
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it('enhance explicit 404 permits exactly one /v1 continuation', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-v1', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const p = provider(); p.baseUrl = base;
      const requests = network(async (request): Promise<Response> => request.url === base + '/images/generations'
        ? new Response('not found', { status: 404 }) : Response.json({ data: { url: output } }));
      expect(await invoke('enhance', await ready(input), undefined, p)).toMatchObject({ enhanced: true });
      expect(requests.map(request => request.url)).toEqual([base + '/images/generations', base + '/v1/images/generations']);
      expect((await attempts(query)).map(attempt => attempt.status)).toEqual(['rejected', 'accepted']);
      await invariant(query, before);
    });
  });
  for (const kind of ['remove', 'enhance'] as const) {
    it.each(['revoked', 'lease-before', 'lease-after', 'accepted SQL', 'started SQL'] as const)(`${kind} %s stops without settlement`, async (fault): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-fence', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl);
        input.beforeDispatch = async (): Promise<void> => {
          if (fault === 'revoked') throw new Error('source authorization revoked');
          if (fault === 'lease-before') await query("UPDATE cloud_tasks SET lease_expires_at=1 WHERE id='aux-task'");
        };
        if (fault.endsWith('SQL')) {
          const status = fault.startsWith('accepted') ? 'accepted' : 'started';
          await query(`CREATE FUNCTION j4f_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.result #>> '{imageEditExecution,phases,0,attempts,0,status}' = '${status}' THEN RAISE EXCEPTION 'j4f ${status} write fault'; END IF; RETURN NEW; END $$`);
          await query('CREATE TRIGGER j4f_reject_write BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION j4f_reject_write()');
        }
        const before = await unchanged(query);
        const exportDir = path.join(process.env.WUJIE_DATA_DIR!, 'exports');
        const filesBefore = kind === 'remove' && fault === 'accepted SQL' ? await readdir(exportDir) : [];
        const requests = network(async (): Promise<Response> => {
          if (fault === 'lease-after') await query("UPDATE cloud_tasks SET lease_expires_at=1 WHERE id='aux-task'");
          return kind === 'remove' ? binary() : Response.json({ image_url: output });
        });
        await expect(invoke(kind, await ready(input))).rejects.toThrow(stopped);
        const sent = fault === 'lease-after' || fault === 'accepted SQL';
        expect(requests).toHaveLength(sent ? 1 : 0);
        expect(await attempts(query)).toMatchObject(sent ? [{ status: 'started' }] : []);
        if (fault === 'accepted SQL') expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
        if (kind === 'remove' && fault === 'accepted SQL') {
          const created = (await readdir(exportDir)).filter(file => !filesBefore.includes(file));
          expect(created).toHaveLength(1);
          expect(await readFile(path.join(exportDir, created[0]))).toEqual(transparentBytes);
        }
        if (fault.startsWith('lease-')) {
          // Compare to the deliberate lease loss, with every non-lease task and billing field unchanged.
          const snapshot = before as { tasks: Array<{ row: Record<string, unknown> }> };
          snapshot.tasks[0].row.lease_expires_at = 1;
        }
        await invariant(query, before);
      });
    });
    it.each(['disabled', 'no key', 'bad URL', 'wrong identity', 'no model'] as const)(`${kind} invalid %s is rejected before source reads or sends`, async (fault): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-invalid', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl); const execution = await ready(input); const before = await unchanged(query);
        const p = provider(); let model = 'gpt-image-1'; let reads = 0;
        if (fault === 'disabled') p.isEnabled = false;
        if (fault === 'no key') p.apiKey = ' ';
        if (fault === 'bad URL') p.baseUrl = 'file:///private';
        if (fault === 'wrong identity') execution.providerId = 'other';
        if (fault === 'no model') { p.selectedModel = ''; model = ''; }
        const requests = network(async (): Promise<Response> => binary(), undefined, async (): Promise<Response> => { reads++; return binary(sourceBytes); });
        const pending = kind === 'remove' ? runRemove(p, sourceData(), { execution }) : runEnhance(source, model, p.id, {}, p, { execution });
        await expect(pending).rejects.toThrow(stopped);
        expect(reads).toBe(0); expect(requests).toHaveLength(0); expect(await attempts(query)).toEqual([]);
        await invariant(query, before);
      });
    });
    it.each(['source', 'send', 'response body'] as const)(`${kind} cancellation during %s cannot accept or return success`, async (point): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-cancel', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl); const before = await unchanged(query);
        const controller = new AbortController();
        const sourceRead = async (): Promise<Response> => { if (point === 'source') controller.abort(new Error('cancel source')); return binary(sourceBytes); };
        external.source.mockImplementation(async (): Promise<Buffer> => { await sourceRead(); return sourceBytes; });
        const requests = network(async (): Promise<Response> => {
          if (point === 'send') controller.abort(new Error('cancel send'));
          if (point === 'response body') {
            const bytes = kind === 'remove' ? transparentBytes : Buffer.from(JSON.stringify({ url: output }));
            return new Response(new ReadableStream({ pull(stream): void { controller.abort(new Error('cancel body')); stream.enqueue(bytes); stream.close(); } }),
              { headers: { 'content-type': kind === 'remove' ? 'image/png' : 'application/json' } });
          }
          return kind === 'remove' ? binary() : Response.json({ url: output });
        }, undefined, sourceRead);
        const execution = await ready(input);
        const pending = kind === 'remove' ? runRemove(provider(), '/api/serve-upload/j4f-offline-source.png', { execution, signal: controller.signal })
          : runEnhance(source, 'gpt-image-1', 'aux-provider', {}, provider(), { execution, signal: controller.signal });
        await expect(pending).rejects.toThrow(stopped);
        expect(requests).toHaveLength(point === 'source' ? 0 : 1);
        expect(await attempts(query)).toMatchObject(point === 'source' ? [] : [{ status: 'started' }]);
        expect((await openImageEditProviderPhase(input)).status).toBe(point === 'source' ? 'ready' : 'submission-unknown');
        await invariant(query, before);
      });
    });
    it(`${kind} freezes provider, model, target, signal and bound methods before source preparation`, async (): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-snapshot', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl);
        input.phase.targets = [{ providerId: 'aux-provider', modelId: 'j4f-exact-model', kind: 'image' }];
        const before = await unchanged(query);
        const p = provider(); p.selectedModel = 'j4f-exact-model'; p.selectedModels = ['j4f-exact-model'];
        p.advancedParams = { removeBgRequestProfile: 'images-generations', removeBgResponseMode: 'png' };
        const target = { targetWidth: 4096, targetHeight: 4096 };
        const mutate = (): void => {
          p.id = 'changed'; p.baseUrl = 'https://changed.invalid'; p.apiKey = 'changed-secret'; p.isEnabled = false;
          p.selectedModel = 'changed-model'; p.selectedModels![0] = 'changed-model'; p.advancedParams!.removeBgResponseMode = 'zip';
          target.targetWidth = 1; target.targetHeight = 1;
          execution.providerId = 'changed';
          execution.boundary.transport = async (): Promise<never> => { throw new Error('mutated transport'); };
          execution.boundary.onAccepted = async (): Promise<never> => { throw new Error('mutated acceptance'); };
          options.signal = AbortSignal.abort('replacement signal'); options.timeoutMs = 1;
        };
        external.source.mockImplementation(async (): Promise<Buffer> => { mutate(); return sourceBytes; });
        const requests = network(async (request): Promise<Response> => {
          expect(request.url).toBe(base + (kind === 'remove' ? '/v1/v1.0/removebg' : '/v1/images/generations'));
          expect(request.headers.get(kind === 'remove' ? 'x-api-key' : 'authorization')).toBe(kind === 'remove' ? key : 'Bearer ' + key);
          const body = await request.clone().json(); expect(body.model).toBe('j4f-exact-model');
          if (kind === 'enhance') expect(body).toMatchObject({ size: '4096x4096', image_urls: [source], referenceStrength: 30 });
          else expect(body).toMatchObject({ response_format: 'png', image: sourceData() });
          return kind === 'remove' ? binary() : Response.json({ url: output });
        }, undefined, async (): Promise<Response> => { mutate(); return binary(sourceBytes); });
        const execution = await ready(input);
        const options = { execution, signal: new AbortController().signal, timeoutMs: 1000 };
        const result = kind === 'remove' ? await runRemove(p, '/api/serve-upload/j4f-offline-source.png', options)
          : await runEnhance(source, 'j4f-exact-model', 'aux-provider', target, p, options);
        expect(result).toBeDefined(); expect(requests).toHaveLength(1);
        expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', identity: { providerId: 'aux-provider', modelId: 'j4f-exact-model' } });
        await invariant(query, before);
      });
    });
  }
  it.each(['poll HTTP', 'poll network', 'poll failed', 'poll missing result', 'poll cancel', 'download HTTP', 'download network', 'download cancel'] as const)('enhance accepted survives %s without new submission', async (fault): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-after-accept', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query); const controller = new AbortController();
      const remote = fault.startsWith('poll');
      const expected = remote ? { kind: 'image', taskId: 'remote-8' } : { kind: 'image', directUrl: output };
      if (!remote) external.download.mockImplementation(async (): Promise<{ buffer: Buffer; mimeType: string }> => {
        expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: expected }]);
        if (fault.endsWith('cancel')) controller.abort(new Error('cancel after acceptance'));
        if (fault.endsWith('network')) throw new Error('connection lost');
        if (fault.endsWith('HTTP')) throw new Error('Remote image returned HTTP 503');
        return { buffer: sourceBytes, mimeType: 'image/png' };
      });
      const requests = network(async (): Promise<Response> => Response.json(remote ? { id: 'remote-8' } : { url: output }), async (): Promise<Response> => {
        expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: expected }]);
        if (fault.endsWith('cancel')) controller.abort(new Error('cancel after acceptance'));
        if (fault.endsWith('network')) throw new Error('connection lost');
        if (fault.endsWith('HTTP')) return new Response('error', { status: 503 });
        return Response.json({ status: fault === 'poll failed' ? 'failed' : 'completed' });
      });
      await expect(invoke('enhance', await ready(input), controller.signal)).rejects.toThrow(stopped);
      vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('No recovery HTTP'); });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: expected });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  }, 12000);
  it('RemoveBG cancellation during persistence preserves unknown and does not accept', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-save-cancel', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query); const controller = new AbortController();
      external.upload.mockImplementation(async (): Promise<null> => { controller.abort(new Error('cancel persistence')); return null; });
      const requests = network(async (): Promise<Response> => binary());
      await expect(invoke('remove', await ready(input), controller.signal)).rejects.toThrow(stopped);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it.each(['remove', 'enhance'] as const)('%s keeps no-execution legacy behavior', async (kind): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-legacy', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); await ready(input); const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => kind === 'remove' ? binary() : Response.json({ url: output }));
      const result = await invoke(kind);
      expect(result).toMatchObject(kind === 'remove' ? { buffer: transparentBytes, mimeType: 'image/png' } : { enhanced: true });
      if (kind === 'remove') expect(result).not.toHaveProperty('directUrl');
      else {
        const enhancedUrl = (result as { url: string }).url;
        expect(enhancedUrl).toMatch(/^\/api\/serve-upload\/exports\/.+\.png$/);
        expect(await readFile(path.join(process.env.WUJIE_DATA_DIR!, enhancedUrl.replace('/api/serve-upload/', ''))))
          .toEqual(sourceBytes);
      }
      expect(await attempts(query)).toEqual([]); expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  for (const kind of ['remove', 'enhance'] as const) {
    it.each(['network loss', '503'] as const)(`${kind} ${'%s'} does not resend and reopens unknown without HTTP`, async (fault): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-no-resend', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl); const before = await unchanged(query);
        const requests = network(async (): Promise<Response> => {
          if (fault === 'network loss') throw new Error('lost response ' + key);
          return new Response('unavailable ' + key, { status: 503 });
        });
        const execution = await ready(input);
        await expect(invoke(kind, execution)).rejects.toThrow(stopped);
        vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Recovery must not use HTTP'); });
        expect(await openImageEditProviderPhase({ ...input })).toEqual({ status: 'submission-unknown' });
        await expect(invoke(kind, execution)).rejects.toThrow(stopped);
        expect(requests).toHaveLength(1); await invariant(query, before);
      });
    });
    it(`${kind} pre-aborted signal causes no source read or attempt`, async (): Promise<void> => {
      await withIsolatedPostgres('task-8cb3j4f-preabort', async ({ query, databaseUrl }): Promise<void> => {
        const input = await fixture(query, databaseUrl); const before = await unchanged(query);
        const requests = network(async (): Promise<Response> => binary());
        await expect(invoke(kind, await ready(input), AbortSignal.abort(new Error('already cancelled')))).rejects.toThrow(stopped);
        expect(requests).toHaveLength(0); expect(await attempts(query)).toEqual([]); await invariant(query, before);
      });
    });
  }
  it('RemoveBG caller signal does not replace its configured timeout', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-timeout', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const caller = new AbortController();
      const requests = network(async (request): Promise<Response> => {
        await new Promise<void>(resolve => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener('abort', (): void => resolve(), { once: true });
        });
        return binary();
      });
      await expect(runRemove(provider(), sourceData(), { execution: await ready(input), signal: caller.signal, timeoutMs: 100 })).rejects.toThrow(stopped);
      expect(caller.signal.aborted).toBe(false); expect(requests).toHaveLength(1);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' }); await invariant(query, before);
    });
  });
  it.each(['absent provider', 'mismatched providerId', 'invalid target'] as const)('enhance %s fails before source access', async (invalid): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-config', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const execution = await ready(input); const before = await unchanged(query);
      let reads = 0;
      const requests = network(async (): Promise<Response> => Response.json({ url: output }), undefined,
        async (): Promise<Response> => { reads++; return binary(sourceBytes); });
      await expect(runEnhance(source, 'gpt-image-1', invalid === 'mismatched providerId' ? 'other' : 'aux-provider',
        invalid === 'invalid target' ? { targetWidth: NaN } : {}, invalid === 'absent provider' ? undefined : provider(), { execution })).rejects.toThrow(stopped);
      expect(reads).toBe(0); expect(requests).toHaveLength(0); expect(await attempts(query)).toEqual([]); await invariant(query, before);
    });
  });
  it.each([
    { imageUrl: output }, { image_url: output }, { url: output }, { data: { image_url: output } }, { data: { url: output } },
  ])('enhance retains synchronous response alias %j', async (response): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-alias', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => Response.json(response));
      expect(await invoke('enhance', await ready(input))).toMatchObject({ enhanced: true });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { directUrl: output } });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it('enhance legacy automatic lookup retains its default model', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-default', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); await ready(input); const before = await unchanged(query);
      external.find.mockResolvedValue(provider());
      const requests = network(async (request): Promise<Response> => {
        expect(await request.clone().json()).toMatchObject({ model: 'gpt-image-1' });
        return Response.json({ imageUrl: output });
      });
      expect(await runEnhance(source)).toMatchObject({ enhanced: true });
      expect(await attempts(query)).toEqual([]); expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it('enhance cancellation while waiting to poll keeps the accepted task', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-poll-wait', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query); const controller = new AbortController();
      const requests = network(async (): Promise<Response> => Response.json({ taskId: 'remote-wait' }));
      const pending = invoke('enhance', await ready(input), controller.signal);
      const outcome = pending.then(value => ({ value }), (error: unknown) => ({ error }));
      for (let i = 0; i < 100 && (await attempts(query))[0]?.status !== 'accepted'; i++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(await attempts(query)).toMatchObject([{ status: 'accepted' }]);
      controller.abort(new Error('cancel before first poll'));
      expect(await outcome).toMatchObject({ error: { message: stopped } });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { taskId: 'remote-wait' } });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
  it('enhance real polling deadline stops but preserves accepted for recovery', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-poll-deadline', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      // The real 150-second helper deadline must expire before this fixture's lease.
      await query("UPDATE cloud_tasks SET lease_expires_at=(extract(epoch from clock_timestamp()) * 1000)::bigint+300000 WHERE id='aux-task'");
      const before = await unchanged(query); let polls = 0;
      const requests = network(async (): Promise<Response> => Response.json({ taskId: 'remote-pending' }), async (request): Promise<Response> => {
        expect(request.method).toBe('GET'); polls++;
        expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: { taskId: 'remote-pending' } }]);
        return Response.json({ status: 'processing' });
      });
      await expect(invoke('enhance', await ready(input))).rejects.toThrow(stopped);
      expect(polls).toBeGreaterThan(0); expect(requests).toHaveLength(1);
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { taskId: 'remote-pending' } });
      await invariant(query, before);
    });
  }, 170000);
});

interface StreamObservations { pulls: number; chunks: number; cancelled: number; eof: boolean }
function observedStream(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200): {
  response: Response; seen: StreamObservations;
} {
  const seen = { pulls: 0, chunks: 0, cancelled: 0, eof: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller): void {
      seen.pulls++;
      if (seen.chunks < chunks.length) controller.enqueue(chunks[seen.chunks++]);
      else { seen.eof = true; controller.close(); }
    },
    cancel(): void { seen.cancelled++; },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { status, headers }), seen };
}

describe('fix1 I1 bounded provider response / real stream and PG', (): void => {
  // Break: call/phase consumes even a clearly oversized response before the adapter's old limit.
  it.each([200, 403])('RemoveBG declared oversized %s reads zero chunks and cannot reject the attempt', async (status): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-header', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const stream = observedStream([status === 200 ? Uint8Array.from(transparentBytes) : new TextEncoder().encode('permission denied')],
        { 'content-type': 'image/png', 'content-length': String(32 * 1024 * 1024 + 1) }, status);
      const requests = network(async (): Promise<Response> => stream.response);
      // A caller cannot raise RemoveBG's server-owned 32 MiB limit.
      const execution = { ...await ready(input), responseMaxBytes: 64 * 1024 * 1024 };
      const outcome = await runRemove(provider(), sourceData(), { execution }).then(value => ({ value }), (error: unknown) => ({ error }));
      expect.soft(outcome).toMatchObject({ error: { message: stopped } });
      expect.soft(stream.seen).toEqual({ pulls: 0, chunks: 0, cancelled: 1, eof: false });
      expect.soft(stream.response.body!.locked).toBe(false);
      expect.soft(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect.soft(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });

  // Small 8-byte contract exercises the same real transport without allocating a large fixture.
  it.each([
    ['absent', 200], ['understated', 200], ['absent', 403], ['understated', 403],
  ] as const)('%s content-length / %s stops on the first overflowing chunk before EOF', async (length, status): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-stream', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const headers: Record<string, string> = { 'content-type': 'text/plain' };
      if (length === 'understated') headers['content-length'] = '2';
      const stream = observedStream(['perm', 'issi', 'on d', 'enied'].map(text => new TextEncoder().encode(text)), headers, status);
      const requests = network(async (): Promise<Response> => stream.response);
      const options = { ...await ready(input), responseMaxBytes: 8 };
      const call = createImageEditProviderCall(options, 'gpt-image-1', 'image');
      const outcome = await call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' })
        .then(value => ({ value }), (error: unknown) => ({ error }));
      expect.soft(outcome).toMatchObject({ error: { message: stopped } });
      expect.soft(stream.seen).toEqual({ pulls: 3, chunks: 3, cancelled: 1, eof: false });
      expect.soft(stream.response.body!.locked).toBe(false);
      expect.soft(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect.soft(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      if ((await attempts(query))[0]?.status === 'started') {
        await expect(call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' })).rejects.toThrow(stopped);
      }
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });

  it.each(['init', 'request', 'phase'] as const)('%s abort while waiting on a body read cancels and releases the real reader', async (signalLocation): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-abort', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const controller = new AbortController(); let cancelCount = 0; let pulls = 0;
      let finish!: () => void; let entered!: () => void;
      const reading = new Promise<void>(resolve => { entered = resolve; });
      const stream = new ReadableStream<Uint8Array>({
        start(body): void { finish = (): void => body.close(); },
        pull(body): void { pulls++; if (pulls === 1) body.enqueue(new Uint8Array([1, 2, 3, 4])); else entered(); },
        cancel(): void { cancelCount++; },
      }, { highWaterMark: 0 });
      const requests = network(async (): Promise<Response> => new Response(stream));
      const options = { ...await ready(signalLocation === 'phase' ? { ...input, signal: controller.signal } : input), responseMaxBytes: 8 };
      const call = createImageEditProviderCall(options, 'gpt-image-1', 'image');
      const endpoint = base + '/v1/images/generations';
      const pending = (signalLocation === 'request'
        ? call.transport(new Request(endpoint, { method: 'POST', body: '{}', signal: controller.signal }))
        : call.transport(endpoint, { method: 'POST', body: '{}', signal: signalLocation === 'init' ? controller.signal : undefined }))
        .then(value => ({ value }), (error: unknown) => ({ error }));
      await reading;
      controller.abort(new Error('fix1 abort during read'));
      let settled = false;
      const observed = pending.then(value => { settled = true; return value; });
      await Promise.race([observed, new Promise<void>(resolve => setTimeout(resolve, 100))]);
      try {
        expect.soft(settled).toBe(true);
        expect.soft(cancelCount).toBe(1);
      } finally { if (!cancelCount) finish(); }
      expect.soft(await observed).toMatchObject({ error: { message: stopped } });
      expect.soft(stream.locked).toBe(false);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('invalid limit %s fails in call and phase before any submission', async (responseMaxBytes): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-invalid', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => binary());
      const options = await ready(input);
      expect(() => createImageEditProviderCall({ ...options, responseMaxBytes }, 'gpt-image-1', 'image')).toThrow(stopped);
      await expect(options.boundary.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' },
        { providerId: 'aux-provider', modelId: 'gpt-image-1', kind: 'image' }, responseMaxBytes)).rejects.toThrow('Invalid provider response limit');
      expect(requests).toHaveLength(0); expect(await attempts(query)).toEqual([]);
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'ready' }); await invariant(query, before);
    });
  });

  it('call captures its limit and bounds a legacy three-argument phase facade before buffering', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-call', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const stream = observedStream([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)]);
      const requests = network(async (): Promise<Response> => stream.response);
      const real = await ready(input); const forwarded: Array<number | undefined> = [];
      const options: ImageEditProviderCallOptions = { ...real, responseMaxBytes: 8, boundary: {
        // Deliberately omit the fourth argument: real PG still records the attempt, while call owns the first body read.
        transport: async (request, init, identity, max): Promise<Response> => {
          forwarded.push(max); return real.boundary.transport(request, init, identity);
        },
        onAccepted: real.boundary.onAccepted.bind(real.boundary),
      } };
      const call = createImageEditProviderCall(options, 'gpt-image-1', 'image');
      options.responseMaxBytes = 1024;
      await expect(call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' })).rejects.toThrow(stopped);
      expect(forwarded).toEqual([8]);
      expect(stream.seen).toEqual({ pulls: 3, chunks: 3, cancelled: 1, eof: false }); expect(stream.response.body!.locked).toBe(false);
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      await expect(call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' })).rejects.toThrow(stopped);
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });

  it.each([201, 403])('within-limit %s preserves complete body, status and headers and normal phase classification', async (status): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-exact', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const text = status === 403 ? 'permission denied' : 'exact successful body';
      const stream = observedStream([new TextEncoder().encode(text.slice(0, 4)), new TextEncoder().encode(text.slice(4))],
        { 'content-length': String(text.length), 'content-type': 'text/plain', 'x-fix1-marker': 'preserved' }, status);
      const requests = network(async (): Promise<Response> => stream.response);
      const call = createImageEditProviderCall({ ...await ready(input), responseMaxBytes: text.length }, 'gpt-image-1', 'image');
      const response = await call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' });
      expect(response.status).toBe(status); expect(response.statusText).toBe(stream.response.statusText);
      expect([...response.headers]).toEqual([...stream.response.headers]); expect(await response.text()).toBe(text);
      expect(stream.seen).toEqual({ pulls: 3, chunks: 2, cancelled: 0, eof: true }); expect(stream.response.body!.locked).toBe(false);
      if (status === 201) {
        await call.acceptImage({ directUrl: output });
        expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { directUrl: output } });
      } else {
        expect(await attempts(query)).toMatchObject([{ status: 'rejected' }]);
        expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'ready' });
      }
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });

  it('no limit retains exactly three transport arguments', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4f-fix1-legacy', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const before = await unchanged(query);
      const requests = network(async (): Promise<Response> => binary()); const real = await ready(input);
      const arities: number[] = [];
      const call = createImageEditProviderCall({ ...real, responseMaxBytes: undefined, boundary: {
        transport: async (...args): Promise<Response> => { arities.push(args.length); return real.boundary.transport(...args); },
        onAccepted: real.boundary.onAccepted.bind(real.boundary),
      } }, 'gpt-image-1', 'image');
      const response = await call.transport(base + '/v1/images/generations', { method: 'POST', body: '{}' });
      expect(Buffer.from(await response.arrayBuffer())).toEqual(transparentBytes); expect(arities).toEqual([3]);
      await call.acceptImage({ directUrl: output });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted' });
      expect(requests).toHaveLength(1); await invariant(query, before);
    });
  });
});
