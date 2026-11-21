// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { createEmptyDramaProject, type DramaProjectV1, type DramaShot } from '@/lib/drama/types';
import { findShot, updateShot } from '@/lib/drama/workbench-state';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/drama/drama-context', () => ({ useDrama: () => context }));
import { PolishButton, ShotLanguageFields, usePromptPolish } from '@/components/drama/drama-shot-language';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let doc: DramaProjectV1;
let context: { doc: DramaProjectV1; dramaId: string; projectId?: string; update: (edit: (doc: DramaProjectV1) => DramaProjectV1) => void };
let selected: string;
let redraw: () => void;
let requests: Array<{ body: { action: string; doc: DramaProjectV1; shotId: string }; signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }>;
const shot = (id: string): DramaShot => ({ id, index: 0, title: '', purpose: '', actionBeat: '', prompt: `原画面${id}`,
  directedPrompt: '原导演描述', duration: 5, durationSec: 5, aspectRatio: '9:16', references: [], continuityNotes: [],
  shotSize: '全景', cameraMotion: '固定', cameraMove: '固定', lighting: '原光线', audioCues: '原声音', status: 'planned', takes: [] });
const current = () => findShot(doc, selected)!.shot;
const result = { prompt: '润色 @小林 @信封', shotSize: '近景', cameraMotion: '推进', lighting: '模型光线', audioCues: '模型声音' };
function Harness() {
  const item = current();
  const polish = usePromptPolish(item);
  return <>
    <PolishButton busy={polish.busy} onPolish={() => void polish.polish()} />
    <textarea aria-label="画面提示词" value={item.prompt} onChange={event => {
      polish.dropUndo();
      context.update(value => updateShot(value, item.id, { prompt: event.target.value, directedPrompt: undefined }));
    }} />
    <ShotLanguageFields shot={item} />
    {polish.canUndo ? <button onClick={polish.restore}>恢复原来的</button> : null}
  </>;
}
function Root() {
  const [, refresh] = useState(0);
  useLayoutEffect(() => { redraw = () => refresh(value => value + 1); }, []);
  return <Harness />;
}
function mount() {
  const view = render(<Root />);
  // Match the workbench: edit the latest document synchronously, then schedule a render.
  context.update = edit => { doc = edit(doc); context.doc = doc; redraw(); };
  return view;
}
function start() { fireEvent.click(screen.getByRole('button', { name: '润色' })); return requests.at(-1)!; }
async function finish(request = requests.at(-1)!, value = result) {
  // Deliberately ignore abort: a response already in transit must still be rejected.
  await act(async () => { request.response.resolve(new Response(JSON.stringify({ shot: value }))); });
}
beforeEach(() => {
  vi.clearAllMocks(); selected = 's1'; requests = [];
  doc = createEmptyDramaProject();
  doc.cast = [{ id: 'lin', name: '小林', appearance: '短发' }];
  doc.props = [{ id: 'letter', name: '信封', description: '' }];
  doc.planner = { providerId: 'authorized-provider', modelId: 'authorized-model' };
  doc.episodes = [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 'sc', heading: '室内', summary: '', shots: [shot('s1'), shot('s2')] }] }];
  context = { doc, dramaId: 'd1', projectId: 'p1', update: edit => { doc = edit(doc); context.doc = doc; } };
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    expect(url).toBe('/api/drama/plan');
    const response = deferred<Response>();
    requests.push({ body: JSON.parse(init.body as string), signal: init.signal as AbortSignal, response });
    return response.promise;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('D04 prompt polish input lifetime', () => {
  it.each([
    ['画面提示词', '人工画面'], ['景别', '特写'], ['运镜', '拉出'], ['光线', '人工光线'], ['声音（填了会让模型一起生成音效）', '人工声音'],
  ])('keeps manual %s edits when an older response arrives', async (label, value) => {
    mount(); const request = start();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const edited = structuredClone(current());
    await finish(request);
    expect(current()).toEqual(edited);
    expect(request.signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: '恢复原来的' })).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(['dialogue', 'actionBeat', 'durationSec', 'characterIds', 'directedPrompt'] as const)('rejects changes to same-shot %s input', async field => {
    mount(); const request = start();
    act(() => context.update(value => updateShot(value, 's1', { [field]: field === 'durationSec' ? 10 : field === 'characterIds' ? ['lin'] : '人工修改' })));
    const edited = structuredClone(current());
    await finish(request);
    expect(current()).toEqual(edited);
    expect(request.signal.aborted).toBe(true);
  });

  it('checks the latest document inside update even before another render', async () => {
    mount(); const request = start();
    doc = updateShot(doc, 's1', { lighting: '尚未渲染的人工光线' });
    context.doc = doc;
    await finish(request);
    expect(current().lighting).toBe('尚未渲染的人工光线');
    expect(current().prompt).toBe('原画面s1');
    expect(screen.queryByRole('button', { name: '恢复原来的' })).toBeNull();
  });

  it.each(['shot', 'drama', 'project', 'planner', 'scene', 'cast', 'delete'] as const)('rejects an old response after %s changes without relying on a parent key', async target => {
    if (target === 'cast') { doc = updateShot(doc, 's1', { characterIds: ['lin'] }); context.doc = doc; }
    const view = mount(); const request = start();
    act(() => {
      if (target === 'shot') selected = 's2';
      if (target === 'drama') context.dramaId = 'd2';
      if (target === 'project') context.projectId = 'p2';
      if (target === 'planner') doc = { ...doc, planner: { providerId: 'another-authorized-provider', modelId: 'another-model' } };
      if (target === 'scene') doc = { ...doc, episodes: doc.episodes.map(e => ({ ...e, scenes: e.scenes.map(s => ({ ...s, heading: '室外' })) })) };
      if (target === 'cast') {
        doc = { ...doc, cast: doc.cast.map(member => ({ ...member, appearance: '人工修改的造型' })) };
      }
      if (target === 'delete') { selected = 's2'; doc = { ...doc, episodes: doc.episodes.map(e => ({ ...e, scenes: e.scenes.map(s => ({ ...s, shots: s.shots.filter(item => item.id !== 's1') })) })) }; }
      context.doc = doc; view.rerender(<Root />);
    });
    const edited = structuredClone(doc);
    await finish(request);
    expect(doc).toEqual(edited);
    expect(request.signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: '恢复原来的' })).toBeNull();
  });

  it('does not let an obsolete request clear the new request busy state or undo', async () => {
    mount(); const old = start();
    fireEvent.change(screen.getByLabelText('光线'), { target: { value: '人工光线' } });
    expect((screen.getByRole('button', { name: '润色' }) as HTMLButtonElement).disabled).toBe(false);
    const latest = start();
    await finish(old);
    expect((screen.getByRole('button', { name: '润色中' }) as HTMLButtonElement).disabled).toBe(true);
    await finish(latest);
    expect(current().prompt).toBe(result.prompt);
    fireEvent.click(screen.getByRole('button', { name: '恢复原来的' }));
    expect(current().lighting).toBe('人工光线');
  });

  it('applies normal polish with the selected planner, preserves mentions and restores original fields', async () => {
    mount(); const before = structuredClone(current()); const request = start();
    expect(request.body).toMatchObject({ action: 'polish', shotId: 's1', doc: { planner: doc.planner } });
    await finish();
    expect(current()).toMatchObject({ ...result, cameraMove: result.cameraMotion, characterIds: ['lin'], propIds: ['letter'] });
    expect(current().directedPrompt).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '恢复原来的' }));
    for (const field of ['prompt', 'directedPrompt', 'shotSize', 'cameraMotion', 'cameraMove', 'lighting', 'audioCues'] as const) expect(current()[field]).toBe(before[field]);
    expect(screen.queryByRole('button', { name: '恢复原来的' })).toBeNull();
  });

  it('reports real network errors and allows retry', async () => {
    mount(); const request = start();
    await act(async () => request.response.reject(new Error('离线网络故障')));
    expect(toast.error).toHaveBeenCalledWith('润色失败', { description: '离线网络故障' });
    expect((screen.getByRole('button', { name: '润色' }) as HTMLButtonElement).disabled).toBe(false);
    expect(current().prompt).toBe('原画面s1');
  });

  it('does not cancel normal polish for unrelated shot progress', async () => {
    mount(); const request = start();
    act(() => context.update(value => updateShot(value, 's2', { status: 'generating' })));
    expect(request.signal.aborted).toBe(false);
    await finish(request);
    expect(current().prompt).toBe(result.prompt);
    expect(findShot(doc, 's2')!.shot.status).toBe('generating');
    expect(screen.getByRole('button', { name: '恢复原来的' })).toBeTruthy();
  });

  it('silently handles a rejected request after cancellation and leaves manual input intact', async () => {
    mount(); const request = start();
    fireEvent.change(screen.getByLabelText('光线'), { target: { value: '人工光线' } });
    await act(async () => request.response.reject(new DOMException('取消', 'AbortError')));
    expect(current().lighting).toBe('人工光线');
    expect(toast.error).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '润色' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('aborts on unmount and silently ignores a late response', async () => {
    const view = mount(); const request = start(); view.unmount();
    expect(request.signal.aborted).toBe(true);
    await finish(request);
    expect(current().prompt).toBe('原画面s1');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
