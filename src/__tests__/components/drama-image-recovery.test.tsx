// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, type Action } from 'sonner';
import type { MouseEvent } from 'react';
import { useDramaWorkbench } from '@/components/drama/use-drama-workbench';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import { parseDramaProject } from '@/lib/drama/schema';
import { castViewImage, setSlotImage } from '@/lib/drama/bible-images';
import { castImagePrompt, keyframePrompt, keyframeReferences } from '@/lib/drama/reference-prompts';
import { updateShot } from '@/lib/drama/workbench-state';
import { pendingProductionImages, type DramaProductionImage } from '@/lib/drama/production-state';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/use-task-model-catalog', () => ({
  useTaskModelCatalog: () => ({ models: [{ id: 'm', name: 'M', providerId: 'p', isDefault: true }],
    descriptorsByKey: new Map([['p::m', { supportsReferenceImages: true, maxReferenceImages: 2 }]]), loading: false, error: null }),
}));

function fixture(): DramaProjectV1 {
  const shot: DramaShot = { id: 's', index: 0, title: '', prompt: '雨夜', purpose: '', actionBeat: '', duration: 5, durationSec: 5,
    aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [], characterIds: ['c'] };
  return { ...createEmptyDramaProject(), cast: [{ id: 'c', name: '甲', appearance: '短发', imageUrlFront: '/front.png' }],
    locations: [{ id: 'l', name: '街道', description: '雨夜' }], props: [{ id: 'r', name: '伞', description: '红色' }],
    episodes: [{ id: 'e', index: 0, title: '一', logline: '', script: '', scenes: [{ id: 'sc', heading: '街道', summary: '', shots: [shot] }] }] };
}
const json = (value: unknown) => new Response(JSON.stringify(value));
let stored: DramaProjectV1;
let requests: Array<{ url: string; body: Record<string, unknown>; key: string | null }>;
let completePoll: (() => Promise<Response>) | undefined;
let completeSubmit: (() => Promise<Response>) | undefined;
let completeStorage: (() => Promise<Response>) | undefined;

beforeEach(() => {
  stored = fixture(); requests = []; completePoll = undefined; completeSubmit = undefined; completeStorage = undefined; vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    requests.push({ url, body, key: new Headers(init?.headers).get('idempotency-key') });
    if (url === '/api/drama/projects/d' && init?.method === 'PUT') {
      stored = parseDramaProject(JSON.parse(JSON.stringify(body.doc)));
      return json({ project: { id: 'd', doc: stored, version: body.version + 1 } });
    }
    if (url === '/api/generate') {
      if (completeSubmit) return completeSubmit();
      throw new Error('offline: original paid submission response lost');
    }
    if (url === '/api/drama/take-receipt') return json({ taskId: 'original-task' });
    if (url === '/api/poll-task') return completePoll ? completePoll() : json({ status: 'completed', imageUrl: '/original.png' });
    if (url === '/api/save-image' && completeStorage) return completeStorage();
    if (url === '/api/drama/estimate') return json({ total: 1, perShot: {}, balance: 10 });
    throw new Error(`Unexpected offline request: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(doc = stored) {
  return renderHook(() => useDramaWorkbench({ record: { id: 'd', projectId: 'project', title: '测试', doc: parseDramaProject(JSON.parse(JSON.stringify(doc))), version: 1, createdAt: 1, updatedAt: 1 } }));
}
async function pending(target: DramaProductionImage['target'] = { kind: 'keyframe', entityId: 's', view: 'first' }) {
  const hook = open();
  await act(async () => { expect(await hook.result.current.generateProductionImage(target, '原始提示', '9:16', ['/reference.png'])).toBe(false); });
  hook.unmount();
  return parseDramaProject(JSON.parse(JSON.stringify(stored)));
}
const currentShot = (doc: DramaProjectV1) => doc.episodes[0].scenes[0].shots[0];
const paid = () => requests.filter(item => item.url === '/api/generate');

describe('D03 image receipts bound to original inputs', () => {
  it.each([
    ['side', 'back'], ['back', 'side'], ['side', 'front'],
  ] as const)('adopts independent cast views when %s finishes before %s', async (firstView, secondView) => {
    const hook = open();
    const deliveries: Array<(value: Response) => void> = [];
    completeSubmit = () => new Promise(resolve => { deliveries.push(resolve); });
    const generate = (view: typeof firstView | typeof secondView) => hook.result.current.generateProductionImage(
      { kind: 'cast', entityId: 'c', view }, castImagePrompt(stored.cast[0], view, stored.style, view !== 'front'), '2:3', view === 'front' ? [] : ['/front.png'],
    );
    let first!: Promise<boolean>; let second!: Promise<boolean>;
    await act(async () => { first = generate(firstView); second = generate(secondView); });
    expect(deliveries).toHaveLength(2);
    await act(async () => { deliveries[0](json({ imageUrl: `/${firstView}.png` })); expect(await first).toBe(true); });
    await act(async () => { deliveries[1](json({ imageUrl: `/${secondView}.png` })); expect(await second).toBe(true); });
    expect(castViewImage(hook.result.current.doc.cast[0], firstView)).toBe(`/${firstView}.png`);
    expect(castViewImage(hook.result.current.doc.cast[0], secondView)).toBe(`/${secondView}.png`);
    expect(pendingProductionImages(hook.result.current.doc)).toEqual([]);
    expect(stored.productionImages!.map(item => item.applied)).toEqual([true, true]);
    expect(paid()).toHaveLength(2);
    expect(new Set(paid().map(item => item.key)).size).toBe(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('adopts an opening frame when an independent closing frame finishes first', async () => {
    const hook = open();
    const shot = currentShot(stored);
    const deliveries: Array<(value: Response) => void> = [];
    completeSubmit = () => new Promise(resolve => { deliveries.push(resolve); });
    let first!: Promise<boolean>; let last!: Promise<boolean>;
    await act(async () => {
      first = hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'first' }, keyframePrompt(shot, stored, 'first'), '9:16', keyframeReferences(shot, stored, 2, 'first'));
      last = hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'last' }, keyframePrompt(shot, stored, 'last'), '9:16', keyframeReferences(shot, stored, 2, 'last'));
    });
    await act(async () => { deliveries[1](json({ imageUrl: '/last.png' })); expect(await last).toBe(true); });
    await act(async () => { deliveries[0](json({ imageUrl: '/first.png' })); expect(await first).toBe(true); });
    expect(currentShot(hook.result.current.doc)).toMatchObject({ firstFrameUrl: '/first.png', lastFrameUrl: '/last.png' });
    expect(pendingProductionImages(stored)).toEqual([]);
    expect(paid()).toHaveLength(2);
  });

  it('still requires review of a closing frame after its opening reference changes', async () => {
    const hook = open();
    let deliver!: (value: Response) => void;
    completeSubmit = () => new Promise(resolve => { deliver = resolve; });
    let generating!: Promise<boolean>;
    await act(async () => { generating = hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'last' }, '尾帧', '9:16', ['/front.png']); });
    act(() => hook.result.current.update(current => updateShot(current, 's', { firstFrameUrl: '/manual-first.png' })));
    await act(async () => { deliver(json({ imageUrl: '/old-last.png' })); expect(await generating).toBe(false); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/manual-first.png');
    expect(currentShot(hook.result.current.doc).lastFrameUrl).toBeUndefined();
    expect(stored.productionImages![0]).toMatchObject({ state: 'stored', url: '/old-last.png', applied: false });
    expect(paid()).toHaveLength(1);
  });

  it.each(['appearance', 'reference', 'locked-reference', 'selection', 'delete'] as const)('still rejects an old cast view after a %s change', async change => {
    const hook = open();
    let deliver!: (value: Response) => void;
    completeSubmit = () => new Promise(resolve => { deliver = resolve; });
    let generating!: Promise<boolean>;
    await act(async () => { generating = hook.result.current.generateProductionImage({ kind: 'cast', entityId: 'c', view: 'back' }, '背面', '2:3', ['/front.png']); });
    act(() => hook.result.current.update(current => change === 'delete' ? { ...current, cast: [] }
      : change === 'selection' ? setSlotImage(current, { kind: 'cast', id: 'c', view: 'back' }, '/manual-back.png')
        : { ...current, cast: current.cast.map(member => ({ ...member, ...(
          change === 'appearance' ? { appearance: '长发' } : change === 'reference' ? { imageUrlFront: '/new-front.png' } : { lockedImageUrl: '/locked.png' }
        ) })) }));
    const edited = structuredClone(hook.result.current.doc.cast);
    await act(async () => { deliver(json({ imageUrl: '/old-back.png' })); expect(await generating).toBe(false); });
    expect(hook.result.current.doc.cast).toEqual(edited);
    expect(stored.productionImages![0]).toMatchObject({ state: 'stored', url: '/old-back.png', applied: false });
    expect(paid()).toHaveLength(1);
  });

  it.each([
    ['poll', 0], ['poll', 1], ['storage', 0], ['storage', 1],
  ] as const)('keeps an adopted receipt settled when concurrent %s reader %s finishes late', async (stage, lateReader) => {
    const hook = open();
    const deliveries: Array<(value: Response) => void> = [];
    completeSubmit = async () => json({ taskId: 'original-task' });
    if (stage === 'poll') completePoll = () => new Promise(resolve => { deliveries.push(resolve); });
    else {
      completePoll = async () => json({ status: 'completed', imageUrl: 'https://provider.invalid/original.png' });
      completeStorage = () => new Promise(resolve => { deliveries.push(resolve); });
    }
    let generating!: Promise<boolean>; let recovering!: Promise<void>;
    await act(async () => { generating = hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'first' }, '原始画面', '9:16'); });
    await act(async () => { recovering = hook.result.current.recoverProduction(); });
    expect(deliveries).toHaveLength(2);
    const deliver = (index: number) => deliveries[index](json(stage === 'poll' ? { status: 'completed', imageUrl: '/original.png' } : { url: '/original.png' }));
    await act(async () => { deliver(1 - lateReader); await (lateReader === 0 ? recovering : generating); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/original.png');
    expect(pendingProductionImages(hook.result.current.doc)).toEqual([]);
    const adopted = structuredClone(stored.productionImages![0]);
    expect(adopted.applied).toBe(true);
    act(() => hook.result.current.update(current => updateShot(current, 's', { firstFrameUrl: '/manual-later.png' })));
    await act(async () => { deliver(lateReader); await (lateReader === 0 ? generating : recovering); });
    expect(await generating).toBe(true);
    expect(stored.productionImages![0]).toEqual(adopted);
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/manual-later.png');
    expect(pendingProductionImages(hook.result.current.doc)).toEqual([]);
    expect(paid()).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it.each(['prompt', 'reference', 'ratio'] as const)('keeps the real result for review after reload and a %s edit', async field => {
    const doc = await pending();
    const hook = open(doc);
    act(() => hook.result.current.update(current => field === 'prompt' ? updateShot(current, 's', { prompt: '后来改写' })
      : field === 'ratio' ? { ...current, aspectRatio: '16:9' }
        : { ...current, cast: current.cast.map(member => ({ ...member, imageUrlFront: '/new-reference.png' })) }));
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBeUndefined();
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ state: 'stored', url: '/original.png', applied: false, error: expect.stringMatching(/采用|核对/) });
    expect(paid()).toHaveLength(1);
    const before = requests.length;
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(requests.slice(before).every(item => item.url === '/api/drama/projects/d')).toBe(true);
    await act(async () => { expect(await hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'first' }, 'new attempt', '9:16')).toBe(false); });
    expect(paid()).toHaveLength(1);
  });

  it('does not replace a manual selection when the original receipt arrives late, and allows explicit adoption', async () => {
    await pending();
    const hook = open();
    let deliver!: (value: Response) => void;
    completePoll = () => new Promise(resolve => { deliver = resolve; });
    let recovering!: Promise<void>;
    await act(async () => { recovering = hook.result.current.recoverProduction(); await Promise.resolve(); });
    act(() => hook.result.current.update(current => updateShot(current, 's', { firstFrameUrl: '/manual.png' })));
    await act(async () => { deliver(json({ status: 'completed', imageUrl: '/original.png' })); await recovering; });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/manual.png');
    expect(hook.result.current.doc.productionImages![0].applied).toBe(false);
    const notice = vi.mocked(toast).mock.calls.findLast(call => typeof call[1]?.action === 'object');
    expect(notice?.[1]?.action).toMatchObject({ label: expect.stringMatching(/采用/) });
    const action = notice![1]!.action as Action;
    await act(async () => { action.onClick({} as MouseEvent<HTMLButtonElement>); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/original.png');
    expect(hook.result.current.doc.productionImages![0].applied).toBe(true);
    act(() => hook.result.current.update(current => updateShot(current, 's', { firstFrameUrl: '/later-choice.png' })));
    await act(async () => { action.onClick({} as MouseEvent<HTMLButtonElement>); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/later-choice.png');
    expect(paid()).toHaveLength(1);
  });

  it('does not report a late live generation as adopted when the user changed inputs', async () => {
    const hook = open(); let deliver!: (value: Response) => void;
    completeSubmit = () => new Promise(resolve => { deliver = resolve; });
    let generating!: Promise<boolean>;
    await act(async () => { generating = hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'last' }, '原始尾帧', '9:16'); });
    act(() => hook.result.current.update(current => updateShot(current, 's', { lastFramePrompt: '后来修改' })));
    await act(async () => { deliver(json({ imageUrl: '/late.png' })); expect(await generating).toBe(false); });
    expect(currentShot(hook.result.current.doc).lastFrameUrl).toBeUndefined();
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ state: 'stored', url: '/late.png', applied: false });
    expect(paid()).toHaveLength(1);
  });

  it('keeps a deleted target absent and retains its original product without claiming it was applied', async () => {
    await pending(); const hook = open();
    act(() => hook.result.current.update(current => ({ ...current, episodes: [] })));
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(hook.result.current.doc.episodes).toEqual([]);
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ state: 'stored', sourceUrl: '/original.png', url: '/original.png', applied: false, error: expect.stringMatching(/删除|不存在/) });
    expect(paid()).toHaveLength(1);
  });

  it('applies unchanged inputs after reload once, retaining snapshots through schema and checkpoints', async () => {
    const doc = await pending();
    expect(doc.productionImages![0]).toMatchObject({ inputSnapshot: expect.any(String), targetSnapshot: expect.any(String) });
    const hook = open(doc);
    await act(async () => { await hook.result.current.recoverProduction(); await hook.result.current.recoverProduction(); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/original.png');
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ applied: true, inputSnapshot: doc.productionImages![0].inputSnapshot, targetSnapshot: doc.productionImages![0].targetSnapshot });
    hook.unmount();
    const reopened = open();
    await act(async () => { await reopened.result.current.recoverProduction(); });
    expect(paid()).toHaveLength(1);
    expect(requests.filter(item => item.url === '/api/drama/take-receipt')).toHaveLength(1);
    expect(requests.filter(item => item.url === '/api/poll-task')).toHaveLength(1);
  });

  it('loads legacy receipts without inferring a match to new inputs, making review visible', async () => {
    stored.productionImages = [{ id: 'legacy', target: { kind: 'keyframe', entityId: 's', view: 'first' }, providerId: 'p', modelId: 'm',
      state: 'stored', sourceUrl: '/legacy.png', url: '/legacy.png', createdAt: 1, updatedAt: 1 }];
    const hook = open();
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBeUndefined();
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ applied: false, error: expect.stringMatching(/旧|快照|版本/) });
    expect(paid()).toHaveLength(0);
  });

  it('blocks another paid request when an unresolved legacy target has no view', async () => {
    stored.productionImages = [{ id: 'legacy', target: { kind: 'keyframe', entityId: 's' }, providerId: 'p', modelId: 'm', state: 'unknown', createdAt: 1, updatedAt: 1 }];
    const hook = open();
    await act(async () => { expect(await hook.result.current.generateProductionImage({ kind: 'keyframe', entityId: 's', view: 'first' }, 'new inputs', '9:16')).toBe(false); });
    expect(paid()).toHaveLength(0);
    expect(hook.result.current.doc.productionImages).toHaveLength(1);
  });

  it.each(['inputSnapshot', 'targetSnapshot'] as const)('does not invent a missing %s while recovering an older receipt', async field => {
    const doc = await pending(); delete doc.productionImages![0][field];
    const hook = open(doc);
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBeUndefined();
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ url: '/original.png', applied: false, error: expect.stringMatching(/旧|快照|版本/) });
    expect(hook.result.current.doc.productionImages![0][field]).toBeUndefined();
    expect(paid()).toHaveLength(1);
  });

  it('leaves an already applied legacy receipt and subsequent selection settled', async () => {
    currentShot(stored).firstFrameUrl = '/manual-after-legacy.png';
    stored.productionImages = [{ id: 'legacy', target: { kind: 'keyframe', entityId: 's', view: 'first' }, providerId: 'p', modelId: 'm',
      state: 'stored', url: '/legacy.png', applied: true, createdAt: 1, updatedAt: 1 }];
    const hook = open();
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe('/manual-after-legacy.png');
    expect(requests).toHaveLength(0);
  });

  it.each([true, false])('checks the version even for a stored receipt found on mount (changed: %s)', async changed => {
    const doc = await pending();
    Object.assign(doc.productionImages![0], { state: 'stored', url: '/stored-before-close.png', sourceUrl: '/stored-before-close.png' });
    if (changed) currentShot(doc).firstFramePrompt = '重开前的新描述';
    const before = requests.length; const hook = open(doc);
    await act(async () => {});
    expect(currentShot(hook.result.current.doc).firstFrameUrl).toBe(changed ? undefined : '/stored-before-close.png');
    expect(hook.result.current.doc.productionImages![0].applied).toBe(!changed);
    expect(requests.slice(before).every(item => item.url === '/api/drama/projects/d')).toBe(true);
    expect(paid()).toHaveLength(1);
  });

  it('also protects cast view selections and descriptions across reload', async () => {
    const hook = open();
    await act(async () => { await hook.result.current.generateProductionImage({ kind: 'cast', entityId: 'c', view: 'side' }, '侧面', '2:3', ['/front.png']); });
    hook.unmount(); const reopened = open();
    act(() => reopened.result.current.update(current => setSlotImage({ ...current, cast: current.cast.map(member => ({ ...member, appearance: '长发' })) }, { kind: 'cast', id: 'c', view: 'side' }, '/manual-side.png')));
    await act(async () => { await reopened.result.current.recoverProduction(); });
    expect(reopened.result.current.doc.cast[0].imageUrlSide).toBe('/manual-side.png');
    expect(reopened.result.current.doc.productionImages![0]).toMatchObject({ url: '/original.png', applied: false });
  });

  const bibleTargets: DramaProductionImage['target'][] = [
    { kind: 'cast', entityId: 'c', view: 'side' }, { kind: 'location', entityId: 'l', view: 'plate' }, { kind: 'prop', entityId: 'r', view: 'sheet' },
  ];
  it.each(bibleTargets)('restores an unchanged $kind image without another submission', async target => {
    await pending(target); const hook = open();
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ state: 'stored', url: '/original.png', applied: true });
    const doc = hook.result.current.doc;
    expect(target.kind === 'cast' ? doc.cast[0].imageUrlSide : target.kind === 'location' ? doc.locations[0].imageUrl : doc.props[0].imageUrl).toBe('/original.png');
    expect(paid()).toHaveLength(1);
  });
  it.each(bibleTargets)('retains the product for a deleted $kind without recreating the target', async target => {
    await pending(target); const hook = open();
    act(() => hook.result.current.update(current => ({ ...current, cast: [], locations: [], props: [] })));
    await act(async () => { await hook.result.current.recoverProduction(); });
    expect(hook.result.current.doc.cast).toEqual([]); expect(hook.result.current.doc.locations).toEqual([]); expect(hook.result.current.doc.props).toEqual([]);
    expect(hook.result.current.doc.productionImages![0]).toMatchObject({ state: 'stored', url: '/original.png', applied: false, error: expect.stringMatching(/删除|不存在/) });
    expect(vi.mocked(toast).mock.calls.some(call => typeof call[1]?.action === 'object')).toBe(false);
    expect(paid()).toHaveLength(1);
  });
});
