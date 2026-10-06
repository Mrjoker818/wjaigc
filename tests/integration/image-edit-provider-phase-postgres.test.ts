import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { isActiveOfflineBridgeTestConnection } from '../helpers/offline-bridge-database-guard';
import { ensureCoreTables } from '@/lib/db-storage';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { claimCloudTaskLease } from '@/lib/cloud-task-storage';
import { submit302aiEsrganTask, submit302aiImageUpscaleTask, submit302aiUpscaleTask, submit302aiUpscaleV6Task } from '@/lib/image-edit-upscale-provider';
import { submitImageTask, autoTrySubmitImageTask } from '@/lib/image-edit-provider';
import { describeImageWithVision } from '@/lib/image-edit-vision-provider';
import { openImageEditProviderPhase } from '@/lib/task-core/image-edit-provider-phase';
import type { OpenImageEditProviderPhaseInput } from '@/lib/task-core/image-edit-provider-checkpoint';
import type { ImageEditProviderExecution, ImageEditProviderIdentity, ImageEditProviderAccepted } from '@/lib/image-edit-provider-boundary';
import type { ImageEditModelCandidate } from '@/lib/task-core/image-edit-model-plan';

vi.mock('server-only', () => ({}));
const digest = 'a'.repeat(64);
const output = 'https://media.invalid/result.png';
const source = 'https://media.invalid/source.png';
const base = 'https://provider.invalid';
const key = 'offline-secret-j4e';

beforeEach((): void => {
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});
afterEach((): void => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(query: QueryFn, databaseUrl: string): Promise<OpenImageEditProviderPhaseInput> {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('options');
  const activeBridge = isActiveOfflineBridgeTestConnection(process.env, databaseUrl)
    && schema?.startsWith('-csearch_path=test_task_8cb3j4e_');
  const legacy = url.hostname === '127.0.0.1' && url.port === '55492'
    && url.pathname === '/wujie_yjs_task8cb3i2_20260927'
    && schema?.startsWith('-csearch_path=test_task_8cb3j4e_');
  if (!activeBridge && !legacy) throw new Error('Isolated PG required');
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('phase-user','Phase','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('phase-credit','phase-user',100,100,0,1,1)`);
  const created = await createBillableTask({ userId: 'phase-user', idempotencyKey: 'phase-admission',
    requestDigest: digest, creditCost: 7, task: { id: 'phase-task', projectId: 'phase-project', type: 'image-edit',
      status: 'processing', progress: 0, createdAt: Date.now(), updatedAt: Date.now(),
      result: { existing: { preserved: true }, skillBillingProvenance: { marker: 'keep' } } } });
  expect(created.charged).toBe(true);
  expect(await claimCloudTaskLease('phase-task', 'worker-a', 120_000)).toMatchObject({ owner: 'worker-a' });
  return { taskId: 'phase-task', actorUserId: 'phase-user', projectId: 'phase-project', requestDigest: digest,
    leaseOwner: 'worker-a', phase: { phaseId: 'upscale:0', inputDigest: 'b'.repeat(64),
      targets: [{ providerId: 'provider-a', modelId: '302-esrgan', kind: 'upscale' }] },
    beforeDispatch: async (): Promise<void> => {}, secretValues: [key] };
}
async function ready(input: OpenImageEditProviderPhaseInput): Promise<ImageEditProviderExecution> {
  const opened = await openImageEditProviderPhase(input);
  if (opened.status !== 'ready') throw new Error('fixture expected ready: ' + opened.status);
  return opened.boundary;
}
async function checkpoint(query: QueryFn): Promise<unknown> {
  return (await query("SELECT result->'imageEditExecution' AS checkpoint FROM cloud_tasks WHERE id='phase-task'")).rows[0].checkpoint;
}
function esrgan(boundary: ImageEditProviderExecution): ReturnType<typeof submit302aiEsrganTask> {
  return submit302aiEsrganTask(base, key, source, 2, { providerId: 'provider-a', boundary });
}

function imageInput(input: OpenImageEditProviderPhaseInput, kind: 'image' | 'vision' = 'image'): OpenImageEditProviderPhaseInput {
  return { ...input, phase: { phaseId: kind + ':0', inputDigest: 'c'.repeat(64),
    targets: [{ providerId: 'provider-a', modelId: kind === 'image' ? 'dall-e-3' : 'vision-model', kind }] } };
}
function candidate(model = 'dall-e-3', providerId = 'provider-a'): ImageEditModelCandidate {
  return { providerId, model, apiKey: key, apiBaseUrl: base + '/v1', source: 'admin-auto', providerType: 'image',
    advancedParams: { compatProfile: 'openai', secret: 'private-advanced' },
    provider: { id: providerId, name: providerId, baseUrl: base + '/v1', apiKey: key, type: 'image', isEnabled: true,
      createdAt: 1, updatedAt: 1, requestStyle: 'images-generations' } };
}
function imageSubmit(boundary: ImageEditProviderExecution, host = base + '/v1'): ReturnType<typeof submitImageTask> {
  return submitImageTask(host, key, { model: 'dall-e-3', prompt: 'paint a tree', size: '1024x1024' },
    '/images/generations', undefined, { providerId: 'provider-a', boundary });
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function observedRequest(entered: Promise<void>, settled: Promise<{ value: unknown } | { error: unknown }>): Promise<void> {
  await Promise.race([entered, settled.then((outcome): never => {
    if ('error' in outcome) throw outcome.error;
    throw new Error('Adapter finished without entering the HTTP observer');
  })]);
}
async function unchanged(query: QueryFn): Promise<unknown> {
  return { tasks: (await query("SELECT to_jsonb(t) - 'revision' - 'updated_at' - 'result' AS row, result - 'imageEditExecution' AS result FROM cloud_tasks t ORDER BY id")).rows,
    credits: (await query('SELECT * FROM wujie_credits ORDER BY id')).rows,
    ledger: (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows };
}
interface ObservedAttempt { status: string; identity: ImageEditProviderIdentity; result?: ImageEditProviderAccepted; bodyDigest: string; endpoint: string }
async function attempts(query: QueryFn, phaseIndex = 0): Promise<ObservedAttempt[]> {
  const stored = await checkpoint(query) as { phases: Array<{ attempts: ObservedAttempt[] }> };
  return stored.phases[phaseIndex].attempts;
}
function offline(responses: Array<() => Response | Promise<Response>>): { transport: typeof fetch; requests: Request[] } {
  const requests: Request[] = [];
  return { requests, transport: async (input, init): Promise<Response> => {
    const request = new Request(input, init);
    expect(new URL(request.url).hostname).toBe('provider.invalid');
    expect(request.method).toBe('POST');
    const respond = responses[requests.length];
    if (!respond) throw new Error('Undeclared extra submission');
    requests.push(request);
    return respond();
  } };
}
const direct = (): Response => Response.json({ data: [{ url: output }] });

describe('durable provider phase / real adapter and PostgreSQL', (): void => {
  // Missing pre-dispatch persistence must fail at the HTTP observer, not setup/import.
  it('commits started before the actual adapter request is observed', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-started', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      let observed: unknown;
      input.transport = async (request, init): Promise<Response> => {
        const actual = new Request(request, init);
        expect(actual.url).toBe(base + '/302/submit/esrgan');
        expect(actual.method).toBe('POST');
        expect(actual.headers.get('authorization')).toBe('Bearer ' + key);
        const bytes = Buffer.from(await actual.arrayBuffer());
        expect(JSON.parse(bytes.toString())).toEqual({ image_url: source, upscale_factor: 2 });
        observed = await checkpoint(query);
        expect.soft(observed).toMatchObject({ version: 1, requestDigest: digest, phases: [{ phaseId: 'upscale:0', attempts: [{
          status: 'started', identity: { providerId: 'provider-a', modelId: '302-esrgan', kind: 'upscale' },
          endpoint: base + '/302/submit/esrgan', method: 'POST', bodyDigest: createHash('sha256').update(bytes).digest('hex'),
        }] }] });
        return Response.json({ image: { url: output, width: 64, height: 64 } });
      };
      await expect(esrgan(await ready(input))).resolves.toMatchObject({ directUrl: output });
      expect(observed).not.toBeNull();
    });
  });

  // A server accepted the first request but the response was lost: a new boundary cannot resend.
  it('response loss reopens submission-unknown with zero additional network', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-lost', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const requests: string[] = [];
      input.transport = async (request, init): Promise<Response> => {
        const actual = new Request(request, init);
        expect(actual.url).toBe(base + '/302/submit/esrgan');
        requests.push(actual.url);
        throw new Error('server accepted; response connection lost');
      };
      await expect(esrgan(await ready(input))).rejects.toThrow();
      const reopened = await openImageEditProviderPhase({ ...input });
      expect.soft(reopened.status).toBe('submission-unknown');
      if (reopened.status === 'ready') await expect(esrgan(reopened.boundary)).rejects.toThrow();
      expect(requests).toHaveLength(1);
    });
  });

  it.each([
    ['direct', direct, { kind: 'image', directUrl: output }],
    ['remote', (): Response => Response.json({ task_id: 'remote-17' }), { kind: 'image', taskId: 'remote-17' }],
  ] as const)('%s acceptance is durable, reopens without network and preserves task/ledger fields', async (_name, response, expected): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-accepted', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      const before = await unchanged(query);
      const wire = offline([response]); input.transport = wire.transport;
      await imageSubmit(await ready(input));
      expect(await openImageEditProviderPhase({ ...input })).toEqual({ status: 'accepted', identity: input.phase.targets[0], result: expected });
      expect(wire.requests).toHaveLength(1);
      expect(await attempts(query)).toMatchObject([{ status: 'accepted', result: expected }]);
      expect(await unchanged(query)).toEqual(before);
      expect(JSON.stringify(await checkpoint(query))).not.toMatch(/offline-secret-j4e|private-advanced|authorization|paint a tree/);
    });
  });

  it.each(['302-super-upscale-v2', '302-upscale-v6', '302-image-upscale', '302-esrgan'])('real %s adapter persists precise identity', async (model): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-four', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      input.phase = { ...input.phase, targets: [{ providerId: 'provider-a', modelId: model, kind: 'upscale' }] };
      await query("UPDATE cloud_tasks SET type='upscale' WHERE id='phase-task'");
      const wire = offline([(): Response => Response.json({ image: { url: output, width: 64, height: 96 } })]);
      input.transport = wire.transport;
      const options = { providerId: 'provider-a', boundary: await ready(input) };
      if (model === '302-super-upscale-v2') await submit302aiUpscaleTask(base, key, source, 2, 0.2, 2, 0.1, 'quality', 'blurry', options);
      else if (model === '302-upscale-v6') await submit302aiUpscaleV6Task(base, key, source, 2, options);
      else if (model === '302-image-upscale') await submit302aiImageUpscaleTask(base, key, source, 2, options);
      else await submit302aiEsrganTask(base, key, source, 2, options);
      const endpoint = model.replace('302-', '');
      expect(wire.requests[0].url).toBe(base + '/302/submit/' + endpoint);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'accepted', identity: input.phase.targets[0],
        result: { kind: 'image', directUrl: output, width: 64, height: 96 } });
    });
  });

  it('vision accepted is one phase; later image phase uses its own result and digest', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-vision', async ({ query, databaseUrl }): Promise<void> => {
      const owner = await fixture(query, databaseUrl);
      const vision = imageInput(owner, 'vision');
      const description = 'A wooden house beneath a bright blue sky.';
      const wire = offline([(): Response => Response.json({ choices: [{ message: { content: description } }] }), direct]);
      vision.transport = wire.transport;
      await expect(describeImageWithVision('data:image/png;base64,aGVsbG8=', 'describe', [candidate('vision-model')], await ready(vision))).resolves.toBe(description);
      expect(await openImageEditProviderPhase(vision)).toEqual({ status: 'accepted', identity: vision.phase.targets[0], result: { kind: 'vision', text: description } });
      const image = imageInput({ ...owner, transport: wire.transport });
      await imageSubmit(await ready(image));
      expect(await attempts(query, 0)).toMatchObject([{ status: 'accepted', result: { kind: 'vision' } }]);
      expect(await attempts(query, 1)).toMatchObject([{ status: 'accepted', result: { kind: 'image' } }]);
      expect((await query('SELECT status FROM cloud_tasks')).rows[0].status).toBe('processing');
      expect(wire.requests).toHaveLength(2);
    });
  });

  it('explicit 404 permits actual /v1 fallback', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-v1', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      const wire = offline([(): Response => Response.json({ error: 'endpoint not found' }, { status: 404 }), direct]);
      input.transport = wire.transport;
      await imageSubmit(await ready(input), base);
      expect(wire.requests.map(request => request.url)).toEqual([base + '/images/generations', base + '/v1/images/generations']);
      expect((await attempts(query)).map(attempt => attempt.status)).toEqual(['rejected', 'accepted']);
    });
  });

  it('explicit 400 permits actual JSON to multipart fallback with exact byte digest', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-multipart', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      const wire = offline([(): Response => Response.json({ error: { message: 'invalid request: expected multipart form' } }, { status: 400 }), direct]);
      input.transport = wire.transport;
      await autoTrySubmitImageTask([candidate()], model => ({ model, prompt: 'paint a tree', image: 'data:image/png;base64,aGVsbG8=' }),
        'mask', '/images/edits', await ready(input));
      expect(wire.requests).toHaveLength(2);
      const sent = wire.requests[1];
      expect(sent.headers.get('content-type')).toContain('multipart/form-data; boundary=');
      const bytes = Buffer.from(await sent.clone().arrayBuffer());
      const form = await sent.formData();
      expect(form.get('model')).toBe('dall-e-3');
      expect(form.get('image')).toBeInstanceOf(File);
      expect(await attempts(query)).toMatchObject([{ status: 'rejected' }, { status: 'accepted', bodyDigest: createHash('sha256').update(bytes).digest('hex') }]);
    });
  });

  it.each([
    ['500', (): Response => new Response('invalid request', { status: 500 })],
    ['503', (): Response => new Response('unavailable', { status: 503 })],
    ['408', (): Response => new Response('timeout', { status: 408 })],
    ['504', (): Response => new Response('timeout', { status: 504 })],
    ['524', (): Response => new Response('timeout', { status: 524 })],
    ['429 ambiguous', (): Response => new Response('try later', { status: 429 })],
    ['400 ambiguous', (): Response => new Response('unexpected error', { status: 400 })],
    ['200 HTML', (): Response => new Response('<html>unknown</html>')],
    ['bad JSON', (): Response => new Response('{broken', { headers: { 'content-type': 'application/json' } })],
    ['read error', (): Response => new Response(new ReadableStream({ start(controller): void { controller.error(new Error('read failed')); } }))],
    ['network loss', (): Response => { throw new Error('connection lost'); }],
    ['redirect', (): Response => new Response(null, { status: 307, headers: { location: base + '/other' } })],
  ] as const)('%s stays started, stops real adapter fallbacks and all later phases', async (_name, response): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-unknown', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      input.phase = { ...input.phase, targets: [...input.phase.targets, { providerId: 'provider-b', modelId: 'dall-e-3', kind: 'image' }] };
      const wire = offline([response]); input.transport = wire.transport;
      const boundary = await ready(input);
      await expect(autoTrySubmitImageTask([candidate(), candidate('dall-e-3', 'provider-b')], model => ({ model, prompt: 'tree' }),
        'mask', '/images/generations', boundary)).rejects.toThrow();
      expect(await openImageEditProviderPhase({ ...input })).toEqual({ status: 'submission-unknown' });
      expect(await openImageEditProviderPhase({ ...input, phase: { ...input.phase, phaseId: 'later:1' } })).toEqual({ status: 'submission-unknown' });
      await expect(imageSubmit(boundary)).rejects.toThrow();
      expect(wire.requests).toHaveLength(1);
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
    });
  });

  it('bad SSE cannot accept a partial vision description', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-sse', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl), 'vision');
      const wire = offline([(): Response => new Response('data: {"choices":[{"delta":{"content":"A long description of the complete image."}}]}\n\ndata: {broken\n',
        { headers: { 'content-type': 'text/event-stream' } })]);
      input.transport = wire.transport;
      await expect(describeImageWithVision('data:image/png;base64,aGVsbG8=', 'describe', [candidate('vision-model')], await ready(input))).rejects.toThrow();
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(wire.requests).toHaveLength(1);
    });
  });

  it.each([
    [405, 'method rejected'], [415, 'media rejected'], [422, 'unsupported size'],
    [400, 'required parameter'], [401, 'invalid API key'], [403, 'permission denied'], [429, 'too many requests'],
  ])('proven %s rejection reopens ready, allows one later acceptance, and stores no secrets', async (status, message): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-rejected', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const wire = offline([(): Response => Response.json({ error: { code: key, message: message + ' ' + key, body: 'private-body' } }, { status }),
        (): Response => Response.json({ image: { url: output } })]);
      input.transport = wire.transport;
      await expect(esrgan(await ready(input))).rejects.toThrow();
      expect(await attempts(query)).toMatchObject([{ status: 'rejected' }]);
      await esrgan(await ready({ ...input }));
      expect((await attempts(query)).map(attempt => attempt.status)).toEqual(['rejected', 'accepted']);
      expect(JSON.stringify(await checkpoint(query))).not.toMatch(/offline-secret-j4e|private-body/);
    });
  });

  it.each(['started', 'accepted'] as const)('real SQL %s write fault stops the adapter without false acceptance', async (fault): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-write-fault', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const boundary = await ready({ ...input, transport: async (): Promise<Response> => {
        sends++; return Response.json({ image: { url: output } });
      } });
      let sends = 0;
      await query(`CREATE FUNCTION reject_phase_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.result #>> '{imageEditExecution,phases,0,attempts,0,status}' = '${fault}'
          THEN RAISE EXCEPTION 'j4e ${fault} write fault'; END IF; RETURN NEW; END $$`);
      await query('CREATE TRIGGER reject_phase_write BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_phase_write()');
      const errors = vi.spyOn(console, 'error');
      try {
        await expect(esrgan(boundary)).rejects.toMatchObject({ cause: { message: `j4e ${fault} write fault` } });
        expect(errors.mock.calls).toEqual([]); // Direct pool transaction surfaces the exact SQL error; no blanket log suppression.
      } finally { errors.mockRestore(); }
      expect(sends).toBe(fault === 'started' ? 0 : 1);
      expect(await attempts(query)).toMatchObject(fault === 'started' ? [] : [{ status: 'started' }]);
      if (fault === 'accepted') expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
    });
  });

  it.each(['same-boundary', 'two-instances'] as const)('%s concurrent adapters produce a single request and acceptance', async (mode): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-concurrent', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const entered = deferred(); const release = deferred(); let sends = 0;
      input.transport = async (): Promise<Response> => { sends++; entered.resolve(); await release.promise; return Response.json({ image: { url: output } }); };
      const first = await ready(input);
      const second = mode === 'same-boundary' ? first : await ready({ ...input });
      const pending = esrgan(first);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      try {
        await observedRequest(entered.promise, settled);
        await expect(esrgan(second)).rejects.toThrow();
        expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
        expect(sends).toBe(1);
      } finally { release.resolve(); await settled; }
      expect(await settled).toHaveProperty('value');
      expect(await attempts(query)).toMatchObject([{ status: 'accepted' }]);
    });
  });

  it.each(['cancelled', 'expired', 'new-owner', 'same-owner-new-lease'] as const)('%s during HTTP blocks late acceptance without overwriting state', async (mode): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-late', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const entered = deferred(); const release = deferred(); let sends = 0;
      input.transport = async (): Promise<Response> => { sends++; entered.resolve(); await release.promise; return Response.json({ image: { url: output } }); };
      const pending = esrgan(await ready(input));
      const settled = pending.then(value => ({ value }), error => ({ error }));
      let before: unknown;
      try {
        await observedRequest(entered.promise, settled);
        if (mode === 'cancelled') await query("UPDATE cloud_tasks SET status='cancelled', result=result || '{\"terminalMarker\":true}'::jsonb WHERE id='phase-task'");
        else {
          await query("UPDATE cloud_tasks SET lease_expires_at=1 WHERE id='phase-task'");
          if (mode !== 'expired') expect(await claimCloudTaskLease(input.taskId, mode === 'new-owner' ? 'worker-b' : 'worker-a', 120_000)).not.toBeNull();
        }
        before = (await query('SELECT * FROM cloud_tasks')).rows;
      } finally { release.resolve(); await settled; }
      expect(await settled).toHaveProperty('error');
      expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual(before);
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(sends).toBe(1);
    });
  });

  it('beforeDispatch is awaited without a row lock and can veto with no started or HTTP', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-before', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); let sends = 0;
      input.transport = async (): Promise<Response> => { sends++; return direct(); };
      input.beforeDispatch = async (): Promise<void> => {
        await query("SET lock_timeout='300ms'");
        await query("UPDATE cloud_tasks SET result=result || '{\"concurrent\":true}'::jsonb WHERE id='phase-task'");
        throw new Error('authorization revoked');
      };
      await expect(esrgan(await ready(input))).rejects.toMatchObject({ cause: { message: 'authorization revoked' } });
      expect(sends).toBe(0);
      expect(await attempts(query)).toEqual([]);
    });
  });

  it('expiry while waiting for the row lock is checked by the actual write', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-expiry-sql', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); let sends = 0;
      input.transport = async (): Promise<Response> => { sends++; return direct(); };
      const boundary = await ready(input);
      await query("UPDATE cloud_tasks SET lease_expires_at=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint+150 WHERE id='phase-task'");
      await query('BEGIN');
      await query("SELECT id FROM cloud_tasks WHERE id='phase-task' FOR UPDATE");
      const pending = esrgan(boundary).then(value => ({ value }), error => ({ error }));
      try { await query('SELECT pg_sleep(0.3)'); } finally { await query('COMMIT'); }
      expect(await pending).toHaveProperty('error');
      expect(sends).toBe(0);
      expect(await attempts(query)).toEqual([]);
    });
  });

  it('captures owner, phase, targets, callbacks and secret list before the first await', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-snapshot', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const wire = offline([(): Response => Response.json({ image: { url: output } })]);
      input.transport = wire.transport;
      const original = structuredClone({ ...input, transport: undefined, beforeDispatch: undefined });
      const opening = openImageEditProviderPhase(input);
      input.taskId = 'foreign-task'; input.actorUserId = 'foreign-actor'; input.projectId = 'foreign-project';
      input.requestDigest = 'd'.repeat(64); input.leaseOwner = 'foreign-worker';
      (input.phase.targets[0] as { providerId: string }).providerId = 'foreign-provider';
      input.phase.inputDigest = 'e'.repeat(64);
      input.beforeDispatch = async (): Promise<void> => { throw new Error('mutated callback'); };
      input.transport = fetch;
      const opened = await opening;
      if (opened.status !== 'ready') throw new Error('expected ready');
      await esrgan(opened.boundary);
      const restored = await openImageEditProviderPhase({ ...original, beforeDispatch: async (): Promise<void> => {}, transport: fetch });
      expect(restored).toMatchObject({ status: 'accepted', identity: { providerId: 'provider-a' } });
      expect(wire.requests).toHaveLength(1);
    });
  });

  it('reopen rejects changed input digest, target order and exact provider/model identity', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-conflict', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      input.phase = { ...input.phase, targets: [...input.phase.targets, { providerId: 'provider-b', modelId: '302-esrgan', kind: 'upscale' }] };
      await ready(input);
      const before = await checkpoint(query);
      for (const phase of [
        { ...input.phase, inputDigest: 'd'.repeat(64) },
        { ...input.phase, targets: [...input.phase.targets].reverse() },
        { ...input.phase, targets: [{ ...input.phase.targets[0], providerId: 'provider-a ' }, input.phase.targets[1]] },
        { ...input.phase, targets: [{ ...input.phase.targets[0], modelId: '302-esrgan ' }, input.phase.targets[1]] },
      ]) await expect(openImageEditProviderPhase({ ...input, phase })).rejects.toThrow();
      expect(await checkpoint(query)).toEqual(before);
    });
  });

  it('invalid owner, phase and target inputs fail without changing any SQL row', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-validation', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const before = (await query('SELECT * FROM cloud_tasks')).rows;
      const cases: OpenImageEditProviderPhaseInput[] = [
        ...['', 'other'].flatMap(value => [ { ...input, taskId: value }, { ...input, actorUserId: value },
          { ...input, projectId: value }, { ...input, leaseOwner: value } ]),
        ...['', 'A'.repeat(64), 'd'.repeat(64)].map(requestDigest => ({ ...input, requestDigest })),
        ...['', '../phase', 'a'.repeat(129)].map(phaseId => ({ ...input, phase: { ...input.phase, phaseId } })),
        { ...input, phase: { ...input.phase, inputDigest: 'B'.repeat(64) } },
        ...[[], new Array<ImageEditProviderIdentity>(1), [input.phase.targets[0], input.phase.targets[0]],
          [{ providerId: '', modelId: '302-esrgan', kind: 'upscale' }],
          [{ providerId: 'a'.repeat(513), modelId: '302-esrgan', kind: 'upscale' }],
          [{ providerId: 'provider-a', modelId: ' ', kind: 'upscale' }],
          [{ providerId: 'provider-a', modelId: '302-esrgan', kind: 'video' }],
          [input.phase.targets[0], { providerId: 'v', modelId: 'vision', kind: 'vision' }],
        ].map(targets => ({ ...input, phase: { ...input.phase, targets: targets as ImageEditProviderIdentity[] } })),
        { ...input, beforeDispatch: undefined as unknown as () => Promise<void> },
      ];
      for (const invalid of cases) await expect(openImageEditProviderPhase(invalid)).rejects.toThrow();
      expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual(before);
      for (const update of ["type='generate'", "status='queued'", "status='completed'", "status='cancelled'", "status='failed'",
        "lease_owner=''", 'lease_expires_at=1', "request_digest=''", "user_id='other'", "project_id='other'"]) {
        await query("UPDATE cloud_tasks SET type='image-edit',status='processing',lease_owner='worker-a',lease_expires_at=$1,request_digest=$2,user_id='phase-user',project_id='phase-project'", [Date.now()+120_000, digest]);
        await query('UPDATE cloud_tasks SET ' + update);
        const snapshot = (await query('SELECT * FROM cloud_tasks')).rows;
        await expect(openImageEditProviderPhase(input)).rejects.toThrow();
        expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual(snapshot);
      }
    });
  });

  it.each(['string', 'form', 'blob', 'array-buffer', 'typed-array', 'search-params', 'request'] as const)('%s body is sent with the hashed bytes, endpoint secrecy and headers intact', async (bodyType): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-body', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const form = new FormData(); form.set('image', new Blob(['payload'], { type: 'image/png' }), 'source.png');
      const bytes = new TextEncoder().encode('payload');
      const bodies: Record<typeof bodyType, BodyInit> = { string: 'payload', form, blob: new Blob(['payload']),
        'array-buffer': bytes.buffer, 'typed-array': bytes, 'search-params': new URLSearchParams({ input: 'payload' }), request: 'payload' };
      const wire = offline([(): Response => Response.json({ image: { url: output } })]); input.transport = wire.transport;
      const boundary = await ready(input); const identity = input.phase.targets[0];
      const url = new URL(base + '/submit?token=' + key + '#private');
      const init = { method: 'POST', body: bodies[bodyType], headers: { authorization: 'Bearer ' + key, 'x-custom': 'preserved' } };
      const request = bodyType === 'request' ? new Request(url, init) : url;
      await boundary.transport(request, bodyType === 'request' ? undefined : init, identity);
      const actual = wire.requests[0];
      const actualBytes = Buffer.from(await actual.clone().arrayBuffer());
      expect(actual.headers.get('authorization')).toBe('Bearer ' + key);
      expect(actual.headers.get('x-custom')).toBe('preserved');
      expect(actual.url).toContain('?token=' + key);
      if (bodyType === 'form') expect((await actual.formData()).get('image')).toBeInstanceOf(File);
      else expect(actualBytes.toString()).toBe(bodyType === 'search-params' ? 'input=payload' : 'payload');
      expect(await attempts(query)).toMatchObject([{ endpoint: base + '/submit', bodyDigest: createHash('sha256').update(actualBytes).digest('hex') }]);
      await boundary.onAccepted(identity, { kind: 'image', taskId: ' remote-untrimmed ' });
      expect(await openImageEditProviderPhase(input)).toMatchObject({ status: 'accepted', result: { taskId: ' remote-untrimmed ' } });
      expect(JSON.stringify(await checkpoint(query))).not.toContain(key);
    });
  });

  it.each(['GET', 'consumed', 'broken-stream'] as const)('%s request is stopped before beforeDispatch, started and network', async (mode): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-request-invalid', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); let before = 0; let sends = 0;
      input.beforeDispatch = async (): Promise<void> => { before++; };
      input.transport = async (): Promise<Response> => { sends++; return direct(); };
      const boundary = await ready(input);
      let request: Request;
      if (mode === 'GET') request = new Request(base);
      else if (mode === 'consumed') { request = new Request(base, { method: 'POST', body: 'payload' }); await request.text(); }
      else request = new Request(base, { method: 'POST', duplex: 'half', body: new ReadableStream({ start(controller): void { controller.error(new Error('unreadable')); } }) } as RequestInit);
      await expect(boundary.transport(request, undefined, input.phase.targets[0])).rejects.toThrow();
      expect(before).toBe(0); expect(sends).toBe(0); expect(await attempts(query)).toEqual([]);
    });
  });

  it.each(['external', 'adapter', 'request'] as const)('%s signal remains effective when other signal sources are present', async (abortSource): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-signal', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const external = new AbortController(); const adapter = new AbortController(); const requestController = new AbortController();
      input.signal = external.signal;
      const wire = offline([(): Response => direct()]); input.transport = wire.transport;
      input.beforeDispatch = async (): Promise<void> => {
        ({ external, adapter, request: requestController })[abortSource].abort(new Error('cancelled before dispatch'));
      };
      const boundary = await ready(input);
      const request = new Request(base + '/submit', { method: 'POST', body: 'payload', signal: requestController.signal });
      await expect(boundary.transport(request, { signal: adapter.signal }, input.phase.targets[0])).rejects.toThrow();
      expect(wire.requests).toHaveLength(0); expect(await attempts(query)).toEqual([]);
    });
  });

  it('aborting during real adapter HTTP leaves started and cannot accept or resend', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-abort-http', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); const controller = new AbortController(); input.signal = controller.signal;
      const wire = offline([(): Response => { controller.abort(); return Response.json({ image: { url: output } }); }]); input.transport = wire.transport;
      await expect(esrgan(await ready(input))).rejects.toThrow();
      expect(await openImageEditProviderPhase({ ...input, signal: undefined })).toEqual({ status: 'submission-unknown' });
      expect(wire.requests).toHaveLength(1);
    });
  });

  it('callback cannot accept without a request, from a different instance, phase, or identity, or twice', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-callback', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      const wire = offline([(): Response => direct()]); input.transport = wire.transport;
      const first = await ready(input); const other = await ready(input);
      const otherPhase = await ready({ ...input, phase: { ...input.phase, phaseId: 'later:1' } });
      const identity = input.phase.targets[0];
      const result: ImageEditProviderAccepted = { kind: 'image', directUrl: output };
      await expect(first.onAccepted(identity, result)).rejects.toThrow();
      await first.transport(base + '/submit', { method: 'POST', body: 'payload' }, identity);
      await expect(other.onAccepted(identity, result)).rejects.toThrow();
      await expect(otherPhase.onAccepted(identity, result)).rejects.toThrow();
      await expect(first.onAccepted({ ...identity, providerId: 'foreign' }, result)).rejects.toThrow();
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      await first.onAccepted(identity, result);
      const before = (await query('SELECT * FROM cloud_tasks')).rows;
      await expect(first.onAccepted(identity, result)).rejects.toThrow();
      expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual(before);
    });
  });

  it.each([
    ['empty', { kind: 'image' }], ['wrong-kind', { kind: 'vision', text: 'description' }],
    ['blank-url', { kind: 'image', directUrl: ' ' }], ['wrong-task', { kind: 'image', taskId: 12 }],
    ['nan', { kind: 'image', directUrl: output, width: NaN }], ['negative', { kind: 'image', directUrl: output, height: -1 }],
    ['infinite', { kind: 'image', directUrl: output, width: Infinity }],
    ['undefined', { kind: 'image', directUrl: output, width: undefined }],
    ['bigint', { kind: 'image', directUrl: output, width: BigInt(1) }],
    ['extra-secret', { kind: 'image', directUrl: output, apiKey: key }],
  ] as const)('invalid accepted %s cannot change started', async (_name, result): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-result', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); input.transport = async (): Promise<Response> => direct();
      const boundary = await ready(input); const identity = input.phase.targets[0];
      await boundary.transport(base, { method: 'POST', body: 'payload' }, identity);
      await expect(boundary.onAccepted(identity, result as ImageEditProviderAccepted)).rejects.toThrow();
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
    });
  });

  it('acceptance over 16MiB fails without truncating or clearing the durable started attempt', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-limit', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl), 'vision');
      input.transport = async (): Promise<Response> => Response.json({ choices: [{ message: { content: 'x'.repeat(16*1024*1024) } }] });
      await expect(describeImageWithVision('data:image/png;base64,aGVsbG8=', 'describe', [candidate('vision-model')], await ready(input))).rejects.toThrow();
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
    });
  });

  it('corrupt persisted checkpoints are rejected instead of reset or silently normalized', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-corrupt', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); await ready(input);
      const valid = await checkpoint(query) as { version: number; requestDigest: string; phases: Array<Record<string, unknown>> };
      const corruptions: unknown[] = [null, [], 'bad', { ...valid, version: 2 }, { ...valid, requestDigest: 'e'.repeat(64) },
        { ...valid, extra: true }, { ...valid, phases: [...valid.phases, ...valid.phases] },
        { ...valid, phases: [{ ...valid.phases[0], targets: [{ ...input.phase.targets[0], apiKey: key }] }] },
        { ...valid, phases: [{ ...valid.phases[0], attempts: [{ status: 'mystery' }] }] },
        { ...valid, extra: 'x'.repeat(16*1024*1024) }];
      for (const corruption of corruptions) {
        await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{imageEditExecution}',$1::jsonb)", [JSON.stringify(corruption)]);
        await expect(openImageEditProviderPhase(input)).rejects.toThrow();
        expect(await checkpoint(query)).toEqual(corruption);
      }
    });
  });

  it('known secret values are absent from thrown network errors as well as checkpoint data', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-error-secret', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      input.transport = async (): Promise<Response> => { throw new Error('connection lost for ' + key); };
      let caught: unknown;
      try { await esrgan(await ready(input)); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).cause)).not.toContain(key);
      expect(JSON.stringify(await checkpoint(query))).not.toContain(key);
    });
  });

  it('explicit rejection permits the next precise candidate and redacts the adapter-visible error', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-candidate', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      input.phase = { ...input.phase, targets: [...input.phase.targets, { providerId: 'provider-b', modelId: 'dall-e-3', kind: 'image' }] };
      const wire = offline([(): Response => Response.json({ error: { message: 'unauthorized ' + key } }, { status: 401 }), direct]);
      input.transport = wire.transport;
      const errors = vi.spyOn(console, 'error'); const warnings = vi.spyOn(console, 'warn');
      try {
        await expect(autoTrySubmitImageTask([candidate(), candidate('dall-e-3', 'provider-b')], model => ({ model, prompt: 'tree' }),
          'mask', '/images/generations', await ready(input))).resolves.toMatchObject({ directUrl: output, providerId: 'provider-b' });
        expect(JSON.stringify(errors.mock.calls)).not.toContain(key);
        expect(JSON.stringify(warnings.mock.calls)).not.toContain(key);
      } finally { errors.mockRestore(); warnings.mockRestore(); }
      expect(await attempts(query)).toMatchObject([{ status: 'rejected', identity: { providerId: 'provider-a' } },
        { status: 'accepted', identity: { providerId: 'provider-b' } }]);
      expect(wire.requests).toHaveLength(2);
    });
  });

  it('a known credential echoed as an accepted URL is refused without changing the URL identity', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-accepted-secret', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      input.transport = async (): Promise<Response> => Response.json({ image: { url: output + '?api_key=' + key } });
      await expect(esrgan(await ready(input))).rejects.toThrow();
      expect(JSON.stringify(await checkpoint(query))).not.toContain(key);
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
    });
  });

  it('failed onAccepted cannot be replayed in memory after the database fault is removed', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-callback-fault', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); input.transport = async (): Promise<Response> => direct();
      const boundary = await ready(input); const identity = input.phase.targets[0];
      await boundary.transport(base, { method: 'POST', body: 'payload' }, identity);
      await query(`CREATE FUNCTION reject_accept() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'j4e accept storage fault'; END $$`);
      await query('CREATE TRIGGER reject_accept BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_accept()');
      await expect(boundary.onAccepted(identity, { kind: 'image', directUrl: output })).rejects.toThrow('j4e accept storage fault');
      await query('DROP TRIGGER reject_accept ON cloud_tasks');
      await expect(boundary.onAccepted(identity, { kind: 'image', directUrl: output })).rejects.toThrow();
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
    });
  });

  it('cancellation inside beforeDispatch is rechecked before sending and preserves its result changes', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-cancel-before', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl); let sends = 0;
      input.transport = async (): Promise<Response> => { sends++; return direct(); };
      input.beforeDispatch = async (): Promise<void> => {
        await query("UPDATE cloud_tasks SET status='cancelled',result=result || '{\"cancelProof\":true}'::jsonb");
      };
      await expect(esrgan(await ready(input))).rejects.toThrow();
      expect(sends).toBe(0); expect(await attempts(query)).toEqual([]);
      expect((await query('SELECT status,result FROM cloud_tasks')).rows[0]).toMatchObject({ status: 'cancelled', result: { cancelProof: true } });
    });
  });

  it('a rejected checkpoint write fault retains started and forbids adapter fallback', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-reject-fault', async ({ query, databaseUrl }): Promise<void> => {
      const input = imageInput(await fixture(query, databaseUrl));
      const wire = offline([(): Response => new Response('not found', { status: 404 })]); input.transport = wire.transport;
      const boundary = await ready(input);
      await query(`CREATE FUNCTION reject_rejection() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.result #>> '{imageEditExecution,phases,0,attempts,0,status}'='rejected'
          THEN RAISE EXCEPTION 'j4e rejection write fault'; END IF; RETURN NEW; END $$`);
      await query('CREATE TRIGGER reject_rejection BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_rejection()');
      await expect(imageSubmit(boundary, base)).rejects.toMatchObject({ cause: { message: 'j4e rejection write fault' } });
      expect(wire.requests).toHaveLength(1);
      expect(await attempts(query)).toMatchObject([{ status: 'started' }]);
      expect(await openImageEditProviderPhase(input)).toEqual({ status: 'submission-unknown' });
    });
  });

  it.each(['phaseId', 'inputDigest', 'requestDigest'] as const)('trailing newline in %s is not a valid phase identity', async (field): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4e-exact-identity', async ({ query, databaseUrl }): Promise<void> => {
      const input = await fixture(query, databaseUrl);
      if (field === 'requestDigest') {
        input.requestDigest += '\n';
        // A malformed persisted digest must fail even when the caller supplies the identical malformed value.
        await query('UPDATE cloud_tasks SET request_digest=$1', [input.requestDigest]);
      } else input.phase[field] += '\n';
      const before = (await query('SELECT * FROM cloud_tasks')).rows;
      await expect(openImageEditProviderPhase(input)).rejects.toThrow();
      expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual(before);
    });
  });
});
