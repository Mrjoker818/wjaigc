// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSketchImageControls } from '@/components/workflow-sketch-image-controls';
import type { WorkflowSketchImageReference } from '@/lib/workflow-engine';
import type { SketchScope } from '@/lib/sketch-to-code/client';
import { SketchImageClient } from '@/lib/sketch-to-code/image-client';
import { SketchImagePlacement } from '@/lib/sketch-to-code/image-placement-client';
import type { SketchInsert } from '@/lib/sketch-to-code/placement-client';

const reference: WorkflowSketchImageReference = { kind: 'sketch-image-reference', taskId: 'image-task', projectId: 'project-a',
  visionProviderId: 'vision-a', visionModelId: '视觉/模型', imageProviderId: 'image-a', imageModelId: '生成/模型',
  previewAssetId: 'input-asset', previewAssetVersionId: 'input-version', imageAssetId: 'result-asset', imageAssetVersionId: 'result-version' };
const pricing = { version: 1, vision: { providerId: 'vision-a', modelId: '视觉/模型', calls: 1, mode: 'token', reserveCredits: 3,
  tokenPricing: { input: 2, output: 4 } }, image: { providerId: 'image-a', modelId: '生成/模型', calls: 1, credits: 10 }, totalReserveCredits: 13 };
const completed = { success: true, type: 'sketch-to-image', taskId: reference.taskId, projectId: reference.projectId,
  visionProviderId: reference.visionProviderId, visionModelId: reference.visionModelId,
  imageProviderId: reference.imageProviderId, imageModelId: reference.imageModelId,
  previewAssetId: reference.previewAssetId, previewAssetVersionId: reference.previewAssetVersionId,
  imageAssetId: reference.imageAssetId, imageAssetVersionId: reference.imageAssetVersionId,
  status: 'completed', progress: 100, phase: 'generation', reserveCredits: 13, actualCredits: 20, refunded: true, pricing,
  previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/generated-image',
  analysis: { summary: '草图', composition: '构图', prompt: '生图', negativePrompt: '' } };
let revoked: boolean;
let requests: { url: string; init?: RequestInit; body?: Record<string, unknown> }[];
let pollResult: Record<string, unknown>;
let mime: 'image/png' | 'image/jpeg' | 'image/webp';
let inserted: Parameters<SketchInsert>[];
const insert: SketchInsert = async (...args): Promise<void> => { inserted.push(args); };
function scope(authority: SketchScope['authority'] = 'legacy', key = 'scope-a'): SketchScope {
  return { actorId: 'u1', projectId: 'project-a', key, authority, assertCurrent: (write?: boolean): void => {
    if (revoked || authority === 'unknown' || write && authority !== 'legacy') throw new Error('PRIVATE_AUTH_ERROR');
  } };
}
function imageResponse(): Response {
  const bytes = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10, 1]
    : mime === 'image/jpeg' ? [255, 216, 255, 224] : [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80];
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': mime } });
}
function mount(currentScope = scope()): ReturnType<typeof render> {
  return render(<WorkflowSketchImageControls scope={currentScope} reference={reference} status="success" insert={insert} />);
}
beforeEach(() => {
  revoked = false; requests = []; pollResult = { ...completed }; mime = 'image/png'; inserted = [];
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:generated') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(url), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url: path, init, body });
    if (path === '/api/poll-task') return Response.json(pollResult);
    if (path === completed.imageUrl) return imageResponse();
    if (path === '/api/assets/transfer') return Response.json({ url: completed.imageUrl, assetId: 'result-asset', assetVersionId: 'result-version',
      entityId: body?.entityId, placementId: 'place-a', placementStatus: 'active', reused: false });
    if (path.startsWith('/api/assets?')) {
      const transfer = requests.find(item => item.url === '/api/assets/transfer')?.body;
      return Response.json({ url: completed.imageUrl, kind: 'image', assetId: 'result-asset', assetVersionId: 'result-version',
        ...(path.includes('placementId=') ? { entityId: transfer?.entityId, placementId: 'place-a' } : {}) });
    }
    throw new Error(`Unexpected route: ${path}`);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('workflow generated sketch image controls (real read/placement clients, controlled transport)', () => {
  it('does not start, read or cancel on mount; previews only fresh protected generated bytes even when net fee exceeds reserve', async () => {
    mount(); await act(async () => {}); expect(requests).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '预览生成图' }));
    const image = await screen.findByRole('img', { name: '草图生成图预览' }); expect(image.getAttribute('src')).toBe('blob:generated');
    expect(requests.map(item => item.url)).toEqual(['/api/poll-task', '/api/poll-task', completed.imageUrl]);
    expect(requests[0].body).toEqual({ taskId: 'image-task', projectId: 'project-a' });
    expect(requests[0].init?.headers).toMatchObject({ 'x-wujie-expected-actor-id': 'u1' });
    expect(requests.every(item => item.init?.cache === 'no-store')).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toMatchObject({ type: 'image/png' });
  });
  it.each([{ type: 'image/png', extension: 'png' }, { type: 'image/jpeg', extension: 'jpg' }, { type: 'image/webp', extension: 'webp' }] as const)
    ('downloads a new authorized $type read with its real suffix and revokes the download URL', async ({ type, extension }) => {
      mime = type; mount();
      fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('img');
      fireEvent.click(screen.getByRole('button', { name: '下载生成图' }));
      await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
      const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(`sketch-image-image-task.${extension}`);
      expect(requests.filter(item => item.url === completed.imageUrl)).toHaveLength(2);
      expect(requests.filter(item => item.url === '/api/poll-task')).toHaveLength(4);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generated');
      expect(vi.mocked(URL.createObjectURL).mock.calls[1][0]).toMatchObject({ type });
    });
  it.each(['taskId', 'projectId', 'visionProviderId', 'visionModelId', 'imageProviderId', 'imageModelId',
    'previewAssetId', 'previewAssetVersionId', 'imageAssetId', 'imageAssetVersionId'] as const)
    ('rejects a changed protected %s before reading bytes or transferring', async field => {
      pollResult[field] = 'changed'; mount(); fireEvent.click(screen.getByRole('button', { name: '预览生成图' }));
      await screen.findByRole('alert'); expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(requests.every(item => item.url === '/api/poll-task')).toBe(true);
      expect(inserted).toEqual([]);
    });
  it('rechecks four references after image() performs its own fresh poll, so a later result version cannot become a preview', async () => {
    const transport = globalThis.fetch; let polls = 0;
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      if (String(url) === '/api/poll-task' && ++polls === 2) pollResult = { ...completed, imageAssetVersionId: 'later-version' };
      return transport(url, init);
    }));
    mount(); fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('alert');
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).toBeNull();
  });
  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('does not treat %s as a readable completion', async flag => {
    pollResult[flag] = true; mount(); fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('alert');
    expect(requests.some(item => item.url === completed.imageUrl)).toBe(false); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('adds the generated asset through the original insert callback and one original placement while preserving the source reference', async () => {
    const before = JSON.stringify(reference); mount(); fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' }));
    await waitFor(() => expect(inserted).toHaveLength(1));
    expect(inserted[0][0]).toMatchObject({ kind: 'image', assetId: 'result-asset', assetVersionId: 'result-version', placementId: 'place-a' });
    const transfer = requests.find(item => item.url === '/api/assets/transfer')!.body!;
    expect(transfer).toMatchObject({ sourceVersion: 'result-version', targetProject: 'project-a', targetWorkspace: 'canvas:project-a', entityType: 'canvas-image' });
    expect(transfer.entityId).not.toBe('input-asset'); expect(JSON.stringify(reference)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' })); await act(async () => {});
    expect(inserted).toHaveLength(1); expect(requests.filter(item => item.url === '/api/assets/transfer')).toHaveLength(1);
  });
  it('disables document placement with an explanation but keeps authorized preview readable', async () => {
    mount(scope('document')); const add = screen.getByRole('button', { name: '添加生成图到画布' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true); expect(screen.getByText(/协作文档暂不能放置生成图/)).toBeTruthy();
    fireEvent.click(add); fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('img');
    expect(requests.some(item => item.url === '/api/assets/transfer')).toBe(false);
  });
  it('rejects unknown scope before every operation', async () => {
    mount(scope('unknown'));
    for (const name of ['预览生成图', '下载生成图', '添加生成图到画布']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement; expect(button.disabled).toBe(true); fireEvent.click(button);
    }
    await act(async () => {}); expect(requests).toEqual([]);
  });
  it('clears old bytes and stops both clients on read authorization withdrawal without displaying the private failure', async () => {
    const stopRead = vi.spyOn(SketchImageClient.prototype, 'stop'), stopPlace = vi.spyOn(SketchImagePlacement.prototype, 'stop');
    mount(); fireEvent.click(screen.getByRole('button', { name: '添加生成图到画布' })); await waitFor(() => expect(inserted).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('img');
    revoked = true; fireEvent.click(screen.getByRole('button', { name: '下载生成图' })); await screen.findByRole('alert');
    expect(screen.queryByRole('img')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generated');
    expect(stopRead).toHaveBeenCalled(); expect(stopPlace).toHaveBeenCalled(); expect(document.body.textContent).not.toContain('PRIVATE_AUTH_ERROR');
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
  it.each(['scope', 'key', 'reference', 'status', 'unmount', 'close'] as const)('stops a late image body on %s change, without creating stale URLs or cancelling the task', async change => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; }), transport = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url, init) => String(url) === completed.imageUrl ? pending : transport(url, init)));
    const stop = vi.spyOn(SketchImageClient.prototype, 'stop'), currentScope = scope(); const view = mount(currentScope);
    fireEvent.click(screen.getByRole('button', { name: '预览生成图' }));
    await waitFor(() => expect(requests.filter(item => item.url === '/api/poll-task')).toHaveLength(2));
    if (change === 'unmount') view.unmount();
    else if (change === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭生成图预览' }));
    else view.rerender(<WorkflowSketchImageControls scope={change === 'scope' ? scope('legacy', 'scope-b') : change === 'key' ? { ...currentScope, key: 'scope-b' } : currentScope}
      reference={change === 'reference' ? { ...reference, imageAssetVersionId: 'new-version' } : reference} status={change === 'status' ? 'failed' : 'success'} insert={insert} />);
    await act(async () => { release(imageResponse()); });
    expect(stop).toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).toBeNull();
    expect(requests.some(item => /cancel|sketch-to-image/.test(item.url))).toBe(false);
  });
  it('does not publish a late body after authority loss without a rerender', async () => {
    let release!: (response: Response) => void; const transport = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url, init) => String(url) === completed.imageUrl ? new Promise<Response>(resolve => { release = resolve; }) : transport(url, init)));
    mount(); fireEvent.click(screen.getByRole('button', { name: '预览生成图' }));
    await waitFor(() => expect(requests.filter(item => item.url === '/api/poll-task')).toHaveLength(2));
    revoked = true; await act(async () => { release(imageResponse()); }); await screen.findByRole('alert');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('reports a failed fresh read safely instead of retaining old preview bytes', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('img');
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('PRIVATE_NETWORK_DATA'));
    fireEvent.click(screen.getByRole('button', { name: '预览生成图' })); await screen.findByRole('alert');
    expect(screen.queryByRole('img')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generated');
    expect(document.body.textContent).not.toContain('PRIVATE_NETWORK_DATA');
  });
  it('terminal failure outranks a residual generation phase and disables all result reads', async () => {
    render(<WorkflowSketchImageControls scope={scope()} reference={reference} status="failed" phase="generation" progress={60} error="SKETCH_IMAGE_FAILED" />);
    expect(screen.queryByText(/正在生成图片/)).toBeNull(); expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: '预览生成图' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {}); expect(requests).toEqual([]);
  });
});
