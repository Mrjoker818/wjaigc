import { describe, expect, it, vi } from 'vitest';
import { SketchClient, sketchModels, type SketchScope } from '@/lib/sketch-to-code/client';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const input = { projectId: 'p1', imageDataUrl: 'data:image/png;base64,aA==', instruction: '中文', providerId: 'provider-1', modelId: 'same-model', idempotencyKey: 'nonce-1' };
const scope = (): SketchScope => ({ actorId: 'u1', projectId: 'p1', key: 'u1:p1:1', authority: 'legacy', assertCurrent: vi.fn() });
const summary = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ success: true, type: 'sketch-to-code', taskId: 't1', projectId: 'p1', providerId: 'provider-1', modelId: 'same-model', status: 'processing', progress: 8, reserveCredits: 20, ...extra });
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completed = (): Record<string, unknown> => summary({ status: 'completed', progress: 100, reserveCredits: 14, actualCredits: 20,
  previewAssetId: 'a1', htmlAssetId: 'a2', previewAssetVersionId: 'v1', htmlAssetVersionId: 'v2', analysis: '布局' });

describe('sketch browser client', () => {
  it('accepts token supplementary settlement without using the reserve as the net fee ceiling', async () => {
    const client = new SketchClient(scope(), async () => response(completed()));
    await expect(client.poll('t1')).resolves.toMatchObject({ status: 'completed', reserveCredits: 14, actualCredits: 20 });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid completed token net fee %s', async actualCredits => {
    const client = new SketchClient(scope(), async () => response({ ...completed(), actualCredits }));
    await expect(client.poll('t1')).rejects.toThrow('草图结果引用或净费用无效');
    expect(client.task).toBeUndefined();
  });
  it('replays the frozen nonce after ACK loss and polls a completed admission summary before exposing results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost ACK'))
      .mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14, html: 'UNTRUSTED', documentUrl: 'https://untrusted.invalid' })))
      .mockResolvedValueOnce(response(completed()));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow();
    await expect(client.start(input, true)).resolves.toMatchObject({ taskId: 't1', status: 'completed', actualCredits: 20 });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/sketch-to-code', '/api/sketch-to-code', '/api/poll-task']);
    expect(fetcher.mock.calls.slice(0, 2).map(call => JSON.parse(String(call[1]?.body)))).toEqual([input, input]);
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({ taskId: 't1', projectId: 'p1' });
    expect(client.admissionUnknown).toBe(false); expect(JSON.stringify(client.task)).not.toMatch(/UNTRUSTED|untrusted.invalid/);
  });
  it('retains a non-completed recoverable identity when completed-summary polling fails without resubmitting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14 })))
      .mockResolvedValueOnce(response({ error: 'poll unavailable' }, 503)).mockResolvedValueOnce(response(completed()));
    const client = new SketchClient(scope(), fetcher);
    // The existing drawer only sets its React task in receive(await start(...)); catch only refreshes/errors.
    let consumerTask: Awaited<ReturnType<SketchClient['start']>> | undefined;
    let caught = false;
    try { consumerTask = await client.start(input); } catch { caught = true; }
    expect(caught).toBe(false); expect(consumerTask).toMatchObject({ taskId: 't1', needsReconcile: true });
    expect(client.task).toMatchObject({ taskId: 't1', projectId: 'p1', providerId: 'provider-1', modelId: 'same-model', needsReconcile: true });
    expect(client.task?.status).not.toBe('completed'); expect(client.task?.progress).toBeLessThan(100);
    for (const field of ['previewAssetId', 'htmlAssetId', 'actualCredits', 'analysis']) expect(client.task).not.toHaveProperty(field);
    expect(client.admissionUnknown).toBe(false); expect(client.input).toEqual(input);
    await expect(client.start({ ...input, idempotencyKey: 'replacement-nonce' })).rejects.toThrow('核对');
    await expect(client.start(input)).resolves.toMatchObject({ taskId: 't1', needsReconcile: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(client.poll('t1')).resolves.toMatchObject({ status: 'completed', actualCredits: 20 });
    expect(fetcher.mock.calls.filter(call => call[0] === '/api/sketch-to-code')).toHaveLength(1);
  });
  it('explicit reconciliation of an accepted completed receipt only polls the original identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14 })))
      .mockResolvedValueOnce(response({ error: 'poll unavailable' }, 503)).mockResolvedValueOnce(response(completed()));
    const client = new SketchClient(scope(), fetcher);
    await client.start(input);
    await expect(client.start(input, true)).resolves.toMatchObject({ status: 'completed', taskId: 't1', actualCredits: 20 });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/sketch-to-code', '/api/poll-task', '/api/poll-task']);
    expect(client.input).toEqual(input);
  });
  it('returns a recoverable receipt to the drawer after a transport failure on the first full poll', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14 })))
      .mockRejectedValueOnce(new TypeError('network lost')).mockResolvedValueOnce(response(completed()));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).resolves.toMatchObject({ taskId: 't1', status: 'processing', needsReconcile: true });
    await expect(client.poll('t1')).resolves.toMatchObject({ taskId: 't1', status: 'completed' });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/sketch-to-code', '/api/poll-task', '/api/poll-task']);
  });
  it('preserves a fully validated completed start receipt and two-response ACK-lost drawer compatibility without an extra poll', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce(response(completed()));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow('lost ACK');
    await expect(client.start(input, true)).resolves.toMatchObject({ status: 'completed', actualCredits: 20, analysis: '布局', htmlAssetVersionId: 'v2' });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/sketch-to-code', '/api/sketch-to-code']);
    expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)))).toEqual([input, input]);
  });
  it.each([{ htmlAssetVersionId: undefined }, { actualCredits: Number.MAX_SAFE_INTEGER + 1 }, { analysis: { summary: 'incomplete' } }])('does not treat a malformed result-bearing completed receipt as an admission-only summary: %j', async invalid => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...completed(), ...invalid }));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow('草图结果引用或净费用无效');
    expect(client.task).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['taskId', 'projectId', 'providerId', 'modelId'] as const)('completed-summary recovery binds the full poll to the original %s', async field => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14 })))
      .mockResolvedValueOnce(response({ ...completed(), [field]: 'changed' }));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow('草图任务身份或状态无效');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(client.task?.taskId).toBe('t1'); expect(client.task?.status).not.toBe('completed');
  });
  it.each(['stop', 'scope', 'timeout'] as const)('completed-summary full-result polling fences late JSON after %s', async change => {
    let release!: (value: unknown) => void; let current = true;
    const context = scope(); context.assertCurrent = (): void => { if (!current) throw new Error('scope changed'); };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', progress: 100, reserveCredits: 14 })))
      .mockResolvedValueOnce({ status: 200, json: () => new Promise(resolve => { release = resolve; }) } as Response);
    const client = new SketchClient(context, fetcher, change === 'timeout' ? 5 : 30_000);
    const pending = client.start(input).then(() => ({ rejected: false }), () => ({ rejected: true }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (change === 'stop') client.stop(); if (change === 'scope') current = false;
    if (change === 'timeout') await vi.waitFor(() => expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true));
    release(completed()); expect(await pending).toEqual({ rejected: true });
    expect(client.task?.taskId).toBe('t1'); expect(client.task?.status).not.toBe('completed'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not poll an identity-invalid completed admission or classify a known 4xx as uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ status: 'completed', providerId: 'foreign' })))
      .mockResolvedValueOnce(response({ error: 'denied' }, 403));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow('草图任务身份或状态无效'); expect(client.task).toBeUndefined();
    await expect(client.start(input, true)).rejects.toThrow('denied'); expect(client.admissionUnknown).toBe(false);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/sketch-to-code', '/api/sketch-to-code']);
  });
  it('keeps the exact six frozen fields and nonce after uncertain admission; only explicit same-intent reconciliation retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost ACK')).mockResolvedValueOnce(response(summary(), 202));
    const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.start({ ...input }, true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)))).toEqual([input, input]);
  });
  it('constructs fresh authorized HTML reads rather than consuming arbitrary result URLs or poll HTML', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<p>中文</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).mockResolvedValueOnce(new Response('denied', { status: 404 }));
    const client = new SketchClient(scope(), fetcher);
    expect(await client.document('t1')).toBe('<p>中文</p>');
    await expect(client.document('t1')).rejects.toThrow();
    expect(fetcher.mock.calls[0][0]).toBe('/api/sketch-to-code/t1/document?projectId=p1');
    expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
  });
  it('fences late JSON and aborts own reads on close without posting cancellation', async () => {
    let resolveBody!: (value: unknown) => void;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 202, json: () => new Promise(resolve => { resolveBody = resolve; }) } as Response);
    const client = new SketchClient(scope(), fetcher);
    const pending = client.start(input);
    await Promise.resolve(); await Promise.resolve();
    client.stop(); resolveBody(summary());
    await expect(pending).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('lets completion win a cancel conflict using the original poll service; 503 stays unknown', async () => {
    const completed = summary({ status: 'completed', progress: 100, actualCredits: 13, previewAssetId: 'a1', htmlAssetId: 'a2', previewAssetVersionId: 'v1', htmlAssetVersionId: 'v2', html: 'ignore', analysis: '布局', refunded: false });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ error: 'SKETCH_TASK_NOT_ACTIVE' }, 409)).mockResolvedValueOnce(response(completed)).mockResolvedValueOnce(response({ error: 'SKETCH_TASK_UNAVAILABLE' }, 503));
    const client = new SketchClient(scope(), fetcher);
    expect(await client.cancel('t1')).toMatchObject({ status: 'completed', actualCredits: 13, reserveCredits: 20 });
    await expect(client.cancel('t1')).rejects.toThrow();
    expect(fetcher.mock.calls[1][0]).toBe('/api/poll-task');
  });
  it('retains unknown intent without implicit retry and rejects reconciliation with edited input', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('uncertain')); const client = new SketchClient(scope(), fetcher);
    await expect(client.start(input)).rejects.toThrow();
    await expect(client.start(input)).rejects.toThrow('核对');
    await expect(client.start({ ...input, instruction: 'edited' }, true)).rejects.toThrow('冻结');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(Object.isFrozen(client.input)).toBe(true);
  });
  it('classifies an explicit rejected admission as rejected rather than unknown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: 'SKETCH_INPUT_INVALID', message: '无效说明' } }, 400));
    const client = new SketchClient(scope(), fetcher); await expect(client.start(input)).rejects.toThrow('无效说明');
    expect(client.admissionUnknown).toBe(false);
  });
  it.each(['taskId', 'projectId', 'providerId', 'modelId', 'progress', 'reserveCredits'] as const)('rejects invalid %s in an admission response', async field => {
    const invalid = { taskId: 'bad space', projectId: 'other', providerId: 'other', modelId: 'other', progress: 101, reserveCredits: -1 };
    const client = new SketchClient(scope(), vi.fn<typeof fetch>().mockResolvedValue(response(summary({ [field]: invalid[field] }), 202)));
    await expect(client.start(input)).rejects.toThrow(); expect(client.task).toBeUndefined();
  });
  it.each(['stop', 'scope', 'timeout'] as const)('rejects late document text after %s, using an entered read boundary', async change => {
    let release!: (value: string) => void;
    let current = true;
    const context = scope(); context.assertCurrent = (): void => { if (!current) throw new Error('scope changed'); };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: () => new Promise<string>(resolve => { release = resolve; }) } as Response);
    const client = new SketchClient(context, fetcher, change === 'timeout' ? 5 : 30_000);
    const pending = client.document('t1');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (change === 'stop') client.stop(); if (change === 'scope') current = false;
    if (change === 'timeout') await vi.waitFor(() => expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true));
    release('<p>late</p>'); await expect(pending).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves safe service error stage/request identity and only reports real phases and net fees', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(summary({ phase: 'invented', needsReconcile: true }), 202)).mockResolvedValueOnce(response(summary({ status: 'failed', phase: 'analysis', error: { code: 'SKETCH_PROVIDER_REJECTED', message: '原服务错误', phase: 'analysis', requestId: 'req1', apiKey: 'secret' }, refunded: false })));
    const client = new SketchClient(scope(), fetcher);
    expect(await client.start(input)).not.toHaveProperty('phase');
    const failed = await client.poll('t1'); expect(failed).toMatchObject({ status: 'failed', phase: 'analysis', refunded: false });
    expect(failed.error).toContain('原服务错误'); expect(failed.error).toContain('req1'); expect(JSON.stringify(failed)).not.toContain('secret');
  });
  it('keeps same-named providers distinct and excludes all capability-incompatible catalog entries', () => {
    const valid = { providerId: 'one', modelId: 'same', kind: 'chat', supportsVision: true, protocol: 'chat-completions', executionMode: 'sync' } as TaskModelDescriptor;
    expect(sketchModels([valid, { ...valid, providerId: 'two' }, { ...valid, supportsVision: false }, { ...valid, executionMode: 'async' }, { ...valid, kind: 'image' }, { ...valid, protocol: 'responses' }]).map(model => model.providerId)).toEqual(['one', 'two']);
  });
});
