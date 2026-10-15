// @vitest-environment jsdom
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SketchToCodePanel } from '@/components/sketch-to-code-panel';
import { createSketchPanelSession, type SketchScope } from '@/lib/sketch-to-code/client';
import { createSketchImagePanelSession, type SketchImageTask } from '@/lib/sketch-to-code/image-client';
import { appendSketchStroke } from '@/lib/sketch-to-code/drawing';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import { SketchPlacement, type SketchInsert } from '@/lib/sketch-to-code/placement-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import type { WorkspaceAssetReference } from '@/lib/asset-core/types';

// Only the transport and canvas are faked. Both session factories retain their
// real clients; discovery is a candidate list, never a task/result receipt.
const discoveryUrl = '/api/tasks/recover?projectId=project-a';
const a5 = { id: 'A5', projectId: 'project-a', type: 'sketch-to-image', status: 'processing',
  createdAt: 1792020000000, updatedAt: 1792020300000 };
const a6 = { id: 'A6', projectId: 'project-a', type: 'sketch-to-image', status: 'processing',
  createdAt: 1792020600000, updatedAt: 1792020900000 };
const pricing = { version: 1 as const,
  vision: { providerId: 'vision-a', modelId: 'same-model', calls: 1 as const, mode: 'token' as const,
    reserveCredits: 10, tokenPricing: { input: 1000, output: 4000 } },
  image: { providerId: 'image-a', modelId: 'same-model', calls: 1 as const, credits: 20 }, totalReserveCredits: 30 };
const processing: SketchImageTask & { success: true; type: 'sketch-to-image' } = {
  success: true, type: 'sketch-to-image', taskId: 'A5', projectId: 'project-a',
  visionProviderId: 'vision-a', visionModelId: 'same-model', imageProviderId: 'image-a', imageModelId: 'same-model',
  status: 'processing', phase: 'generation', progress: 55, reserveCredits: 30, pricing,
  needsReconcile: false, dispatchPending: false, recoveryPending: false, refunded: false, requestId: 'request-a5',
};
const completed: typeof processing = { ...processing, status: 'completed', progress: 100,
  previewAssetId: 'sketch-input-a5', previewAssetVersionId: 'sketch-input-version-a5',
  imageAssetId: 'sketch-output-a5', imageAssetVersionId: 'sketch-output-version-a5',
  previewUrl: '/api/serve-upload/sketch-input-a5.png', imageUrl: '/api/serve-upload/sketch-output-a5.png',
  analysis: { summary: '蓝色房子', composition: '草图居中', prompt: '水彩蓝色房子', negativePrompt: '模糊' },
  // 1,000 input and 250 output tokens cost 2; the image costs 20.
  actualCredits: 22,
};
const vision: TaskModelDescriptor = { providerId: 'vision-a', modelId: 'same-model', kind: 'chat', sourceType: 'chat',
  protocol: 'chat-completions', executionMode: 'sync', supportsVision: true, allowedRatios: [], allowedSizes: [],
  qualityOptions: [], maxOutputs: 1, supportsReferenceImages: false, supportsMask: false, outputKinds: [], capabilitySources: {} };
const image: TaskModelDescriptor = { ...vision, providerId: 'image-a', kind: 'image', sourceType: 'image',
  supportsReferenceImages: true, maxReferenceImages: 1, supportedOperations: ['image-to-image'], outputKinds: ['image'],
  allowedRatios: ['4:3'], allowedSizes: ['1024'], qualityOptions: ['standard'] };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } });
function deferred(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve!: (response: Response) => void;
  return { promise: new Promise<Response>(done => { resolve = done; }), resolve };
}
function fixture(): {
  session: ReturnType<typeof createSketchPanelSession>; imageSession: ReturnType<typeof createSketchImagePanelSession>;
  current: { actorId: string; projectId: string }; fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  io: { discover: () => Promise<Response>; poll: () => Promise<Response>; cancel: () => Promise<Response> };
} {
  const current = { actorId: 'actor-a', projectId: 'project-a' };
  const scope: SketchScope = { actorId: 'actor-a', projectId: 'project-a', key: 'scope-a', authority: 'legacy',
    assertCurrent: (): void => {
      if (current.actorId !== 'actor-a' || current.projectId !== 'project-a') throw new Error('当前身份或项目已失效');
    } };
  const io = { discover: async (): Promise<Response> => json({ success: true, tasks: [a6, a5], retryAfterMs: 3000 }),
    poll: async (): Promise<Response> => json(processing),
    cancel: async (): Promise<Response> => json({ ...processing, status: 'cancelled', progress: 0, refunded: true }) };
  const fetcher = vi.fn<typeof fetch>(async (url, init): Promise<Response> => {
    if (String(url) === discoveryUrl && init?.method === 'GET') return io.discover();
    if (String(url) === '/api/poll-task' && init?.method === 'POST') return io.poll();
    if (String(url) === '/api/cancel-task' && init?.method === 'POST') return io.cancel();
    // Unexpected admissions remain wholly synthetic and are exposed by the
    // literal request-sequence assertions below, never forwarded anywhere.
    return json({ success: false, error: 'UNEXPECTED_SYNTHETIC_REQUEST' }, 409);
  });
  vi.stubGlobal('fetch', fetcher);
  return { current, io, fetcher, session: createSketchPanelSession(scope), imageSession: createSketchImagePanelSession(scope) };
}
type Fixture = ReturnType<typeof fixture>;
function panel(f: Fixture): React.ReactElement {
  // A spread keeps the initial RED compatible with today's Props interface.
  // Ignoring this optional future prop must fail behavior, not compilation.
  const props: React.ComponentProps<typeof SketchToCodePanel> & { recoverTasks: boolean } = {
    session: f.session, imageSession: f.imageSession, models: [vision, image], recoverTasks: true,
  };
  return <SketchToCodePanel {...props} />;
}
async function discovered(f: Fixture): Promise<void> {
  await waitFor(() => expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual([discoveryUrl]));
  const init = f.fetcher.mock.calls[0][1];
  expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  expect(new Headers(init?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
}
async function chooseA5(): Promise<void> {
  // The accessible recovery action identifies the exact server candidate;
  // neither its copy nor a new visual style is prescribed here.
  fireEvent.click(await screen.findByRole('button', { name: /A5/ }));
}
function readyDrawing(f: Fixture, view: ReturnType<typeof render>): void {
  f.session.history = appendSketchStroke(f.session.history,
    { id: 'new-dot', tool: 'pen', color: '#111827', width: 5, points: [{ x: 10, y: 20 }] });
  f.session.selection = '["vision-a","same-model"]';
  f.imageSession.visionSelection = '["vision-a","same-model"]';
  f.imageSession.imageSelection = '["image-a","same-model"]';
  view.rerender(panel(f));
}
function expectAdmissionBlocked(f: Fixture): void {
  expect(f.session.history.present.strokes).toHaveLength(1);
  expect((screen.getByLabelText('视觉分析模型') as HTMLSelectElement).value).toBe('["vision-a","same-model"]');
  expect((screen.getByLabelText('图像生成模型') as HTMLSelectElement).value).toBe('["image-a","same-model"]');
  for (const mode of ['草图生图', '草图转代码']) {
    fireEvent.click(screen.getByRole('button', { name: mode }));
    const submit = screen.getByRole('button', { name: mode === '草图生图' ? /^生成(?:新)?图像/ : /^生成(?:新任务)?代码/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.queryAllByText('尚未提交').filter(element => !element.closest('[hidden]'))).toHaveLength(0);
    fireEvent.click(submit);
  }
  fireEvent.click(screen.getByRole('button', { name: '草图生图' }));
  expect(f.fetcher.mock.calls.filter(call => ['/api/sketch-to-code', '/api/sketch-to-image'].includes(String(call[0])))).toHaveLength(0);
  expect(f.session.client.input).toBeUndefined(); expect(f.imageSession.client.input).toBeUndefined();
}
beforeEach((): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==');
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Real placement classes consume synthetic protected receipts. The sink records
// every insertion unconditionally: it must not hide duplicate calls by entity ID.
async function waitForRecoveryChoice(f: Fixture, mode: 'image' | 'code', id: string): Promise<void> {
  await waitFor((): void => {
    const candidate = screen.getByRole('button', { name: new RegExp(`^${mode === 'image' ? '草图生图' : '草图转代码'} · ${id} ·`) });
    expect((candidate as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('正在读取原任务，请稍候…')).toBeNull();
    expect((mode === 'image' ? f.imageSession.client.task : f.session.client.task)?.taskId).toBe(id);
  });
}

function recoveryFailure(error: unknown, context: string, f: Fixture, inserted?: readonly WorkspaceAssetReference[]): never {
  const requests = f.fetcher.mock.calls.map(([url, init], index) => {
    const path = String(url);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body)) as Record<string, unknown>; } catch { /* GET has no body. */ }
    return { index, method: init?.method ?? 'GET', url: path,
      stage: path.startsWith('/api/tasks/recover?') ? 'discovery' : path === '/api/poll-task' ? 'protected-poll'
        : path === '/api/assets/transfer' ? 'placement-transfer' : path.startsWith('/api/assets?')
          ? path.includes('&placementId=') ? 'placement-readback' : 'asset-read'
          : path === '/api/sketch-to-image' || path === '/api/sketch-to-code' ? 'admission-or-SAME-reconciliation' : 'other',
      taskId: body.taskId, sourceVersion: body.sourceVersion, signalPresent: !!init?.signal, aborted: init?.signal?.aborted ?? null };
  });
  const diagnostic = { context, alerts: screen.queryAllByRole('alert').map(element => element.textContent),
    insertionCount: inserted ? inserted.length : null, insertPort: inserted ? 'unconditional-recording-sink' : 'not-supplied',
    insertions: inserted?.map(reference => ({ assetVersionId: reference.assetVersionId, entityId: reference.entityId,
      placementId: reference.placementId, sourceTrace: reference.sourceTrace })),
    codeTaskId: f.session.client.task?.taskId, imageTaskId: f.imageSession.client.task?.taskId, requests };
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nRecovery failure diagnostics:\n${JSON.stringify(diagnostic, null, 2)}`, { cause: error });
}

function placementRecoveryFixture(mode: 'image' | 'code'): {
  f: Fixture; drawer: () => React.ReactElement; inserted: WorkspaceAssetReference[];
} {
  vi.stubGlobal('crypto', webcrypto);
  const f = fixture(), inserted: WorkspaceAssetReference[] = [];
  const insert: SketchInsert = async (reference): Promise<void> => { inserted.push(reference); };
  const tasks = new Map<string, Record<string, unknown>>();
  for (const id of ['A5', 'A6']) {
    tasks.set(id, mode === 'image' ? { ...completed, taskId: id, requestId: `request-${id}`,
      previewAssetId: `sketch-input-${id}`, previewAssetVersionId: `sketch-input-version-${id}`,
      imageAssetId: `sketch-output-${id}`, imageAssetVersionId: `sketch-output-version-${id}`,
      previewUrl: `/api/serve-upload/sketch-input-${id}.png`, imageUrl: `/api/serve-upload/sketch-output-${id}.png` }
      : { success: true, type: 'sketch-to-code', taskId: id, projectId: 'project-a', providerId: 'vision-a', modelId: 'same-model',
        status: 'completed', progress: 100, reserveCredits: 10, actualCredits: 2, analysis: '蓝色房子页面',
        previewAssetId: `sketch-input-${id}`, previewAssetVersionId: `sketch-input-version-${id}`,
        htmlAssetId: `sketch-html-${id}`, htmlAssetVersionId: `sketch-html-version-${id}` });
  }
  const receipts = new Map<string, Record<string, unknown>>(), byNonce = new Map<string, Record<string, unknown>>();
  const transport = f.fetcher.getMockImplementation()!;
  f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [a5, a6].map(candidate => ({ ...candidate,
    type: mode === 'image' ? 'sketch-to-image' : 'sketch-to-code', status: 'completed' })) });
  f.fetcher.mockImplementation(async (url, init): Promise<Response> => {
    if (String(url) === '/api/poll-task') {
      const body = JSON.parse(String(init?.body)) as { taskId: string; projectId: string };
      expect(body.projectId).toBe('project-a');
      expect(new Headers(init?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
      return json(tasks.get(body.taskId));
    }
    if (String(url).startsWith('/api/assets?')) {
      const query = new URL(String(url), 'http://synthetic.invalid').searchParams;
      expect(query.get('projectId')).toBe('project-a');
      const receipt = query.get('placementId');
      if (receipt) return json(receipts.get(receipt));
      const task = [...tasks.values()].find(value => value[mode === 'image' ? 'imageAssetVersionId' : 'previewAssetVersionId'] === query.get('assetVersionId'))!;
      return json({ kind: 'image', assetId: task[mode === 'image' ? 'imageAssetId' : 'previewAssetId'],
        assetVersionId: query.get('assetVersionId'), url: mode === 'image' ? task.imageUrl : `/api/serve-upload/${task.previewAssetId}.png` });
    }
    if (String(url) === '/api/assets/transfer') {
      const body = JSON.parse(String(init?.body)) as { sourceVersion: string; targetProject: string; entityId: string;
        idempotencyKey: string; metadata: { sourceTrace: unknown } };
      expect(body.targetProject).toBe('project-a');
      expect(new Headers(init?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
      const prior = byNonce.get(body.idempotencyKey);
      if (prior) return json({ ...prior, reused: true });
      const task = [...tasks.values()].find(value => value[mode === 'image' ? 'imageAssetVersionId' : 'previewAssetVersionId'] === body.sourceVersion)!;
      const receipt = { placementId: `placement-${receipts.size + 1}`, placementStatus: 'active', reused: false,
        entityId: body.entityId, kind: 'image', sourceTrace: body.metadata.sourceTrace,
        assetId: task[mode === 'image' ? 'imageAssetId' : 'previewAssetId'], assetVersionId: body.sourceVersion,
        url: mode === 'image' ? task.imageUrl : `/api/serve-upload/${task.previewAssetId}.png` };
      receipts.set(receipt.placementId, receipt); byNonce.set(body.idempotencyKey, receipt); return json(receipt);
    }
    return transport(url, init);
  });
  return { f, inserted, drawer: (): React.ReactElement => <SketchToCodePanel session={f.session} imageSession={f.imageSession}
    models={[vision, image]} recoverTasks={true} insert={insert} /> };
}

describe('review regressions: pending image admission and original placement intent', (): void => {
  it('does not replace the image client or abandon its frozen SAME key when recovery is clicked during an outstanding new admission', async (): Promise<void> => {
    const f = fixture(), admission = deferred();
    f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [{ ...a5, status: 'completed' }] });
    f.io.poll = async (): Promise<Response> => json(completed);
    const transport = f.fetcher.getMockImplementation()!; let admissions = 0;
    f.fetcher.mockImplementation(async (url, init): Promise<Response> => {
      if (String(url) === '/api/sketch-to-image') return admissions++ === 0 ? admission.promise
        : json({ ...processing, taskId: 'A6' }, 202);
      return transport(url, init);
    });
    const view = render(panel(f));
    try {
      await discovered(f); await chooseA5(); await screen.findByText('已完成 · 100%');
      await waitForRecoveryChoice(f, 'image', 'A5');
      readyDrawing(f, view);
      fireEvent.click(screen.getByRole('button', { name: /^生成新图像/ }));
      await waitFor(() => expect(f.fetcher.mock.calls.filter(call => String(call[0]) === '/api/sketch-to-image')).toHaveLength(1));
      const owner = f.imageSession.client, frozen = owner.input;
      const submission = f.fetcher.mock.calls.find(call => String(call[0]) === '/api/sketch-to-image')!;
      expect(frozen).toBeDefined(); expect(submission[1]?.signal?.aborted).toBe(false);
      const beforeRecovery = f.fetcher.mock.calls.length;
      await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: /^草图生图 · A5 ·/ })); });
      expect(f.imageSession.client).toBe(owner);
      expect(f.fetcher).toHaveBeenCalledTimes(beforeRecovery);
      expect(submission[1]?.signal?.aborted).toBe(false);
      expect(owner.input).toBe(frozen);
      await act(async (): Promise<void> => { admission.resolve(json({ success: false }, 503)); });
      await screen.findByRole('button', { name: '核对原提交（相同标识）' });
      expect(owner.admissionUnknown).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '核对原提交（相同标识）' }));
      await screen.findByText('生图中 · 55%');
      expect(f.imageSession.client).toBe(owner); expect(owner.task?.taskId).toBe('A6');
      const requests = f.fetcher.mock.calls.filter(call => String(call[0]) === '/api/sketch-to-image');
      expect(requests).toHaveLength(2); expect(requests[1][1]?.body).toBe(requests[0][1]?.body);
      expect(JSON.parse(String(requests[1][1]?.body)).idempotencyKey).toBe(frozen!.idempotencyKey);
      expect(new Headers(requests[1][1]?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
    } catch (error) { recoveryFailure(error, 'pending-image-admission', f); }
    finally { view.unmount(); admission.resolve(json({ success: false }, 503)); }
  });

  it.each([
    ['image', 'same-task'], ['code', 'same-task'], ['image', 'A-B-A'], ['code', 'A-B-A'],
    ['image', 'close-reopen'], ['code', 'close-reopen'],
  ] as const)('retains one actual insertion for the original %s placement intent across %s recovery', async (mode, path): Promise<void> => {
    const { f, inserted, drawer } = placementRecoveryFixture(mode);
    let view = render(drawer());
    const choose = async (id: string): Promise<void> => {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${mode === 'image' ? '草图生图' : '草图转代码'} · ${id} ·`) }));
      await screen.findByText('已完成 · 100%');
      expect((mode === 'image' ? f.imageSession.client.task : f.session.client.task)?.taskId).toBe(id);
      await waitForRecoveryChoice(f, mode, id);
    };
    const add = async (): Promise<void> => {
      const button = screen.getByRole('button', { name: mode === 'image' ? '添加生成图到画布' : '添加到画布' });
      expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
      await screen.findByText(mode === 'image' ? '生成图像已新增到画布，原始草图保持不变' : '原始草图PNG已放置，代码仍需当前授权读取');
    };
    try {
      await discovered(f); await choose('A5');
      expect(mode === 'image' ? f.imageSession.placement : f.session.placement).toBeInstanceOf(mode === 'image' ? SketchImagePlacement : SketchPlacement);
      await add(); expect(inserted).toHaveLength(1);
      const original = inserted[0];
      expect(original.sourceTrace).toMatchObject({ source: mode === 'image' ? 'sketch-to-image' : 'sketch-to-code', taskId: 'A5', projectId: 'project-a' });
      expect(original.assetVersionId).toBe(mode === 'image' ? 'sketch-output-version-A5' : 'sketch-input-version-A5');
      if (path === 'A-B-A') { await choose('A6'); await add(); expect(inserted).toHaveLength(2); }
      if (path === 'close-reopen') {
        fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' })); view.unmount(); view = render(drawer());
      }
      await choose('A5'); await add();
      expect(inserted.filter(reference => reference.assetVersionId === original.assetVersionId)).toHaveLength(1);
      expect(inserted).toHaveLength(path === 'A-B-A' ? 2 : 1);
      const versions = inserted.map(reference => reference.assetVersionId);
      expect(new Set(versions).size).toBe(versions.length);
      expect(f.fetcher.mock.calls.filter(call => ['/api/sketch-to-code', '/api/sketch-to-image'].includes(String(call[0])))).toHaveLength(0);
    } catch (error) { recoveryFailure(error, `${mode}/${path}`, f, inserted); }
    finally { view.unmount(); }
  });

  it.each(['image', 'code'] as const)('does not reuse the original %s placement after its actor/project scope becomes invalid', async (mode): Promise<void> => {
    const { f, inserted, drawer } = placementRecoveryFixture(mode); const view = render(drawer());
    try {
      await discovered(f);
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${mode === 'image' ? '草图生图' : '草图转代码'} · A5 ·`) }));
      await screen.findByText('已完成 · 100%');
      await waitForRecoveryChoice(f, mode, 'A5');
      const originalPlacement = mode === 'image' ? f.imageSession.placement : f.session.placement;
      expect(originalPlacement).toBeInstanceOf(mode === 'image' ? SketchImagePlacement : SketchPlacement);
      f.current.actorId = 'actor-b'; f.current.projectId = 'project-b'; view.rerender(drawer());
      const before = f.fetcher.mock.calls.length;
      expect((screen.getByRole('button', { name: mode === 'image' ? '添加生成图到画布' : '添加到画布' }) as HTMLButtonElement).disabled).toBe(true);
      await expect(originalPlacement!.add()).rejects.toThrow();
      expect(inserted).toHaveLength(0); expect(f.fetcher).toHaveBeenCalledTimes(before);
    } catch (error) { recoveryFailure(error, `${mode}/invalidated-scope`, f, inserted); }
    finally { view.unmount(); }
  });
});

describe('opted-in sketch drawer recovers the original paid task without resubmission', (): void => {
  it.each(['image', 'code'] as const)('preserves explicit SAME frozen idempotency reconciliation for unknown %s admission despite independent discovery loading/failure', async (mode): Promise<void> => {
    const f = fixture(), discovery = deferred(); f.io.discover = (): Promise<Response> => discovery.promise;
    const route = mode === 'image' ? '/api/sketch-to-image' : '/api/sketch-to-code';
    const code = { success: true, type: 'sketch-to-code', taskId: 'A5', projectId: 'project-a', providerId: 'vision-a',
      modelId: 'same-model', status: 'processing', phase: 'reconstruction', progress: 40, reserveCredits: 10 };
    const transport = f.fetcher.getMockImplementation()!; let attempts = 0;
    f.fetcher.mockImplementation(async (url, init): Promise<Response> => {
      if (String(url) === route && init?.method === 'POST') return attempts++ === 0
        ? json({ success: false }, 503) : json(mode === 'image' ? processing : code, 202);
      return transport(url, init);
    });
    const common = { projectId: 'project-a', imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==',
      instruction: '原始冻结意图', idempotencyKey: 'original-frozen-nonce' };
    const client = mode === 'image' ? f.imageSession.client : f.session.client;
    const start = mode === 'image'
      ? f.imageSession.client.start({ ...common, visionProviderId: 'vision-a', visionModelId: 'same-model', imageProviderId: 'image-a', imageModelId: 'same-model', aspectRatio: '4:3' })
      : f.session.client.start({ ...common, providerId: 'vision-a', modelId: 'same-model' });
    await expect(start).rejects.toThrow();
    expect(client.admissionUnknown).toBe(true); expect(client.task).toBeUndefined();
    const frozenBody = String(f.fetcher.mock.calls[0][1]?.body);
    const view = render(panel(f));
    await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
    readyDrawing(f, view);
    f.session.instruction = '后续编辑不可代替原意图'; f.imageSession.instruction = '后续图像意图';
    view.rerender(panel(f));
    if (mode === 'code') fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect((screen.getByRole('button', { name: '核对原提交（相同标识）' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async (): Promise<void> => { discovery.resolve(json({ success: false }, 503)); });
    await screen.findByRole('alert');
    const reconcile = screen.getByRole('button', { name: '核对原提交（相同标识）' });
    expect((reconcile as HTMLButtonElement).disabled).toBe(false); fireEvent.click(reconcile);
    await screen.findByText(mode === 'image' ? '生图中 · 55%' : '重建中 · 40%');
    expect(client.admissionUnknown).toBe(false); expect(client.task?.taskId).toBe('A5');
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual([route, discoveryUrl, route]);
    expect(String(f.fetcher.mock.calls[2][1]?.body)).toBe(frozenBody);
    expect(JSON.parse(frozenBody)).toMatchObject(common);
    expect(new Headers(f.fetcher.mock.calls[2][1]?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
    expect(f.fetcher.mock.calls[2][1]?.credentials).toBe('same-origin');
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: mode === 'image' ? /^生成新图像/ : /^生成新任务代码/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['image', 'code'] as const)('keeps a known %s task checkable and cancellable during independent discovery loading and failure', async (mode): Promise<void> => {
    const f = fixture(), discovery = deferred(); f.io.discover = (): Promise<Response> => discovery.promise;
    const code = { success: true, type: 'sketch-to-code', taskId: 'A5', projectId: 'project-a', providerId: 'vision-a',
      modelId: 'same-model', status: 'processing', phase: 'reconstruction', progress: 40, reserveCredits: 10 };
    if (mode === 'code') {
      f.io.poll = async (): Promise<Response> => json(code);
      f.io.cancel = async (): Promise<Response> => json({ ...code, status: 'cancelled', progress: 0, refunded: true });
      await f.session.client.poll('A5');
    } else await f.imageSession.client.poll('A5');
    render(panel(f)); await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
    if (mode === 'code') fireEvent.click(screen.getByRole('button', { name: '草图转代码' }));
    expect((screen.getByRole('button', { name: '取消任务（等待确认）' }) as HTMLButtonElement).disabled).toBe(false);
    const check = screen.getByRole('button', { name: '核对任务状态' });
    expect((check as HTMLButtonElement).disabled).toBe(false); fireEvent.click(check);
    await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(3));
    await screen.findByText(mode === 'image' ? '生图中 · 55%' : '重建中 · 40%');
    await act(async (): Promise<void> => { discovery.resolve(json({ success: false }, 503)); });
    await screen.findByRole('alert');
    const cancel = screen.getByRole('button', { name: '取消任务（等待确认）' });
    expect((cancel as HTMLButtonElement).disabled).toBe(false); fireEvent.click(cancel);
    await screen.findByText('已取消（服务端确认） · 0%');
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', discoveryUrl, '/api/poll-task', '/api/cancel-task']);
  });

  it.each([
    { ...a5, id: '../A5' }, { ...a5, projectId: 'project-b' },
    { ...a5, updatedAt: a5.createdAt - 1 }, { ...a5, status: 'invented' }, {},
  ])('keeps malformed or cross-project discovery unresolved: %j', async (candidate): Promise<void> => {
    const f = fixture(); f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [candidate] });
    const view = render(panel(f));
    await screen.findByRole('alert'); readyDrawing(f, view); expectAdmissionBlocked(f);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /草图生图 · A5/ })).toBeNull();
  });

  it('allows new work only after a valid empty discovery and ignores unrelated task types', async (): Promise<void> => {
    const f = fixture(); f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [{ ...a5, type: 'generate' }] });
    const view = render(panel(f));
    await screen.findByText('当前项目未发现可恢复的草图任务。'); readyDrawing(f, view);
    expect((screen.getByRole('button', { name: /^生成图像/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'unmount'] as const)('discards late discovery after %s without cancelling the backend', async (action): Promise<void> => {
    const f = fixture(), discovery = deferred(); f.io.discover = (): Promise<Response> => discovery.promise;
    const view = render(panel(f)); await discovered(f);
    const signal = f.fetcher.mock.calls[0][1]?.signal;
    if (action === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' })); else view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async (): Promise<void> => { discovery.resolve(json({ success: true, tasks: [a5] })); });
    expect(screen.queryByRole('button', { name: /草图生图 · A5/ })).toBeNull();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains candidates and the exact failed choice across close and read-only discovery retries', async (): Promise<void> => {
    const f = fixture(); f.io.poll = async (): Promise<Response> => json({ success: false }, 503);
    const view = render(panel(f)); await discovered(f); await chooseA5(); await screen.findByRole('alert');
    view.unmount();
    f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [] });
    render(panel(f)); await screen.findByRole('button', { name: '重试核对原任务 A5' });
    await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: /草图生图 · A6/ })).toBeDefined();
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual([discoveryUrl, '/api/poll-task', discoveryUrl]);
  });

  it.each(['close', 'unmount'] as const)('aborts selected polling and rejects a late completed result after %s', async (action): Promise<void> => {
    const f = fixture(), receipt = deferred(); f.io.poll = (): Promise<Response> => receipt.promise;
    const view = render(panel(f)); await discovered(f); await chooseA5();
    await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
    const signal = f.fetcher.mock.calls[1][1]?.signal;
    if (action === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭草图创作' })); else view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async (): Promise<void> => { receipt.resolve(json(completed)); });
    expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
    expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下载生成图像' })).toBeNull();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps an existing validated session task usable when discovery is empty', async (): Promise<void> => {
    const f = fixture(); await f.imageSession.client.poll('A5');
    f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [] });
    render(panel(f)); await screen.findByText('当前项目未发现可恢复的草图任务。');
    expect(screen.getByText('生图中 · 55%')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' }));
    await screen.findByText('已取消（服务端确认） · 0%');
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual(['/api/poll-task', discoveryUrl, '/api/cancel-task']);
  });

  it('recovers a code task through its real client without a drawing or selected model', async (): Promise<void> => {
    const f = fixture();
    f.io.discover = async (): Promise<Response> => json({ success: true, tasks: [{ ...a5, type: 'sketch-to-code' }] });
    const code = { success: true, type: 'sketch-to-code', taskId: 'A5', projectId: 'project-a', providerId: 'vision-a',
      modelId: 'same-model', status: 'processing', phase: 'reconstruction', progress: 40, reserveCredits: 10 };
    f.io.poll = async (): Promise<Response> => json(code);
    f.io.cancel = async (): Promise<Response> => json({ ...code, status: 'cancelled', progress: 0, refunded: true });
    render(panel(f)); await discovered(f); await chooseA5(); await screen.findByText('重建中 · 40%');
    expect(f.session.client.task?.taskId).toBe('A5'); expect(f.session.client.input).toBeUndefined();
    expect(f.session.selection).toBe(''); expect(f.session.history.present.strokes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' }));
    await screen.findByText('已取消（服务端确认） · 0%');
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual([discoveryUrl, '/api/poll-task', '/api/cancel-task']);
  });

  it('switches guarded image clients by exact choice and cannot bypass another active candidate with an old terminal task', async (): Promise<void> => {
    const f = fixture(); const view = render(panel(f)); await discovered(f);
    f.io.poll = async (): Promise<Response> => json({ ...processing, taskId: 'A6' });
    fireEvent.click(screen.getByRole('button', { name: /草图生图 · A6/ })); await screen.findByText('任务：A6 · 请求：request-a5');
    f.io.poll = async (): Promise<Response> => json({ ...processing, status: 'failed' });
    await chooseA5(); await screen.findByText('失败，草图已保留 · 55%');
    expect(f.imageSession.client.task?.taskId).toBe('A5'); readyDrawing(f, view); expectAdmissionBlocked(f);
    expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual([discoveryUrl, '/api/poll-task', '/api/poll-task']);
    expect(f.fetcher.mock.calls.slice(1).map(call => JSON.parse(String(call[1]?.body)).taskId)).toEqual(['A6', 'A5']);
  });

  it('requires an exact A5 choice among candidates, real-polls it with empty drawing/models, and cancels only on explicit server confirmation', async (): Promise<void> => {
    const f = fixture(), cancellation = deferred(); f.io.cancel = (): Promise<Response> => cancellation.promise;
    // No model catalog/selection or drawing is required to recover an old task.
    const props = { recoverTasks: true };
    const view = render(<SketchToCodePanel session={f.session} imageSession={f.imageSession} {...props} />);
    try {
      await discovered(f);
      await screen.findByRole('button', { name: /A6/ }); await screen.findByRole('button', { name: /A5/ });
      expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
      expect(f.fetcher).toHaveBeenCalledTimes(1); // Even the newer A6 is never autochosen.
      expect(screen.queryByRole('button', { name: '取消任务（等待确认）' })).toBeNull();
      await chooseA5(); await screen.findByText('生图中 · 55%');
      expect(f.imageSession.client.task).toMatchObject({ taskId: 'A5', projectId: 'project-a', status: 'processing',
        visionProviderId: 'vision-a', imageProviderId: 'image-a', reserveCredits: 30 });
      expect(screen.getByText('预留额度：30；实际净费：尚未确认')).toBeDefined();
      expect(screen.getByText('视觉分析预留：10；单张图像报价：20')).toBeDefined();
      expect(f.session.history.present.strokes).toHaveLength(0);
      expect(f.imageSession.visionSelection).toBe(''); expect(f.imageSession.imageSelection).toBe('');
      expect(f.imageSession.client.input).toBeUndefined(); expect(f.session.client.input).toBeUndefined();
      expect((screen.getByRole('button', { name: '核对任务状态' }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '取消任务（等待确认）' }));
      await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(3));
      expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull();
      expect(screen.queryByText(/已取消（服务端确认）/)).toBeNull();
      await act(async (): Promise<void> => { cancellation.resolve(json({ ...processing, status: 'cancelled', progress: 0, refunded: true })); });
      await screen.findByText('已取消（服务端确认） · 0%');
      expect(screen.getByText('退款状态：服务端确认已退还预留额度')).toBeDefined();
      expect(f.imageSession.client.task).toMatchObject({ taskId: 'A5', status: 'cancelled', refunded: true });
      expect(f.fetcher.mock.calls.map(call => [String(call[0]), call[1]?.method])).toEqual([
        ['/api/tasks/recover?projectId=project-a', 'GET'], ['/api/poll-task', 'POST'], ['/api/cancel-task', 'POST'],
      ]);
      for (const call of f.fetcher.mock.calls.slice(1)) {
        expect(JSON.parse(String(call[1]?.body))).toEqual({ taskId: 'A5', projectId: 'project-a' });
        expect(new Headers(call[1]?.headers).get('x-wujie-expected-actor-id')).toBe('actor-a');
      }
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    } finally {
      view.unmount(); cancellation.resolve(json({ ...processing, status: 'cancelled', progress: 0, refunded: true }));
    }
    expect(f.fetcher).toHaveBeenCalledTimes(3); // Closing does not cancel again.
  });

  it('blocks both paid modes during discovery and after discovery 503 despite valid new drawing/model selections', async (): Promise<void> => {
    const f = fixture(), discovery = deferred(); f.io.discover = (): Promise<Response> => discovery.promise;
    const view = render(panel(f));
    try {
      await discovered(f); readyDrawing(f, view); expectAdmissionBlocked(f);
      await act(async (): Promise<void> => { discovery.resolve(json({ success: false, error: 'TASK_RECOVERY_UNAVAILABLE' }, 503)); });
      await screen.findByRole('alert'); expectAdmissionBlocked(f);
      expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
      expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual(['/api/tasks/recover?projectId=project-a']);
    } finally { view.unmount(); discovery.resolve(json({ success: true, tasks: [], retryAfterMs: 3000 })); }
  });

  it('treats selected candidate polling and its 503 as unresolved, blocking new admission rather than showing 尚未提交', async (): Promise<void> => {
    const f = fixture(), receipt = deferred(); f.io.poll = (): Promise<Response> => receipt.promise;
    const view = render(panel(f));
    try {
      await discovered(f); await chooseA5();
      await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
      readyDrawing(f, view); expectAdmissionBlocked(f);
      expect(f.imageSession.client.task).toBeUndefined();
      expect(screen.queryByRole('button', { name: '取消任务（等待确认）' })).toBeNull();
      await act(async (): Promise<void> => { receipt.resolve(json({ success: false, error: 'SKETCH_TASK_UNAVAILABLE' }, 503)); });
      await screen.findByRole('alert'); expectAdmissionBlocked(f);
      expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
      expect(f.fetcher.mock.calls.map(call => String(call[0]))).toEqual(['/api/tasks/recover?projectId=project-a', '/api/poll-task']);
      expect(JSON.parse(String(f.fetcher.mock.calls[1][1]?.body))).toEqual({ taskId: 'A5', projectId: 'project-a' });
    } finally { view.unmount(); receipt.resolve(json(processing)); }
  });

  it('aborts the original read and rejects an abort-ignoring completed A5 response after actor/project scope invalidation', async (): Promise<void> => {
    const f = fixture(), receipt = deferred(); f.io.poll = (): Promise<Response> => receipt.promise;
    const view = render(panel(f));
    try {
      await discovered(f); await chooseA5();
      await waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2));
      const signal = f.fetcher.mock.calls[1][1]?.signal;
      expect(signal?.aborted).toBe(false);
      f.current.actorId = 'actor-b'; f.current.projectId = 'project-b'; view.rerender(panel(f));
      expect(signal?.aborted).toBe(true);
      await act(async (): Promise<void> => { receipt.resolve(json(completed)); });
      expect(f.imageSession.client.task).toBeUndefined(); expect(f.session.client.task).toBeUndefined();
      expect(screen.queryByText('任务：A5 · 请求：request-a5')).toBeNull();
      expect(screen.queryByRole('button', { name: '打开图像预览' })).toBeNull();
      expect(screen.queryByRole('button', { name: '下载生成图像' })).toBeNull();
      expect(screen.queryByText(/服务端确认已退还预留额度/)).toBeNull();
      expect(f.fetcher.mock.calls.map(call => [String(call[0]), call[1]?.method])).toEqual([
        ['/api/tasks/recover?projectId=project-a', 'GET'], ['/api/poll-task', 'POST'],
      ]);
      expect(f.imageSession.client.input).toBeUndefined(); expect(f.session.client.input).toBeUndefined();
    } finally { view.unmount(); receipt.resolve(json(completed)); }
  });
});
