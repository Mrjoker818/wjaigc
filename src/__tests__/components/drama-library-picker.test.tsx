// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';

vi.mock('@/components/drama/drama-context', () => ({ useDrama: () => context }));
import { DramaLibraryPicker } from '@/components/drama/drama-library-picker';

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let context: { doc: DramaProjectV1; dramaId: string; projectId?: string; canvasMedia: Array<{ url: string; name: string }> };
let reads: Array<{ url: string; response: ReturnType<typeof deferred> }>;
const onPick = vi.fn();
const onOpenChange = vi.fn();
const picker = (open = true) => <DramaLibraryPicker open={open} onOpenChange={onOpenChange} title="素材库" onPick={onPick} />;
const choices = () => screen.queryAllByRole('button', { name: /^选用/ }).map(button => button.getAttribute('aria-label'));
async function answer(index: number, value: unknown, status = 200) {
  await act(async () => { reads[index].response.resolve(json(value, status)); });
}
async function fillOther(label = '旧缓存') {
  await answer(reads.length - 1, { projects: [{ id: 'other' }] });
  const doc = createEmptyDramaProject();
  doc.references = [{ url: '/old.png', name: label, source: 'chat' }];
  await answer(reads.length - 1, { project: { id: 'other', title: label, doc } });
  expect(screen.getByRole('button', { name: `选用 ${label}` })).toBeTruthy();
}
beforeEach(() => {
  vi.clearAllMocks(); reads = [];
  const doc = createEmptyDramaProject();
  doc.references = [{ url: '/current.png', name: '本片素材', source: 'chat' }];
  context = { doc, dramaId: 'd1', canvasMedia: [{ url: '/canvas.png', name: '画布素材' }] };
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const response = deferred(); reads.push({ url, response }); return response.promise;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('D05 library scope lifetime', () => {
  it.each(['project-arrives', 'project-changes', 'drama-changes'] as const)('synchronously hides old choices when %s, through a pending request and failure', async change => {
    if (change !== 'project-arrives') context.projectId = 'p1';
    const view = render(picker()); await fillOther();
    let atCommit: string[] = [];
    // Runs before passive effects: clearing state only in useEffect is too late.
    function Probe() { useLayoutEffect(() => { atCommit = choices() as string[]; }); return null; }
    if (change === 'drama-changes') context.dramaId = 'd2'; else context.projectId = 'p2';
    view.rerender(<>{picker()}<Probe /></>);
    expect(atCommit).not.toContain('选用 旧缓存');
    expect(choices()).toEqual(['选用 画布素材', '选用 本片素材']);
    expect(screen.getByRole('status').textContent).toContain('正在读取');
    expect(reads.at(-1)!.url).toBe(`/api/drama/projects?projectId=${change === 'drama-changes' ? 'p1' : 'p2'}`);
    await act(async () => reads.at(-1)!.response.reject(new Error('离线网络故障')));
    expect(choices()).toEqual(['选用 画布素材', '选用 本片素材']);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选用 本片素材' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ url: '/current.png' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ignores a late response from the previous scope after the next scope succeeds', async () => {
    const view = render(picker());
    await answer(0, { projects: [{ id: 'old' }] }); const oldRead = reads.length - 1;
    context.projectId = 'p2'; view.rerender(picker());
    await fillOther('新缓存');
    const doc = createEmptyDramaProject(); doc.references = [{ url: '/late.png', name: '迟到旧素材', source: 'chat' }];
    await answer(oldRead, { project: { id: 'old', title: '旧项目', doc } });
    expect(choices()).toContain('选用 新缓存');
    expect(choices()).not.toContain('选用 迟到旧素材');
  });

  it('keeps current sources, dedupe, stored-image rules and normal scoped selection', async () => {
    context.projectId = 'p1'; const view = render(picker());
    expect(reads[0].url).toBe('/api/drama/projects?projectId=p1');
    await answer(0, { projects: [{ id: 'd1' }, { id: 'other' }] });
    expect(reads.map(r => r.url)).toEqual(['/api/drama/projects?projectId=p1', '/api/drama/projects/other']);
    const doc = createEmptyDramaProject();
    doc.references = [{ url: '/other.png', name: '同项目素材', source: 'chat' }, { url: 'blob:temporary', name: '临时', source: 'chat' }, { url: '/canvas.png', name: '重复', source: 'canvas' }];
    await answer(1, { project: { id: 'other', title: '同项目', doc } });
    expect(choices()).toEqual(['选用 画布素材', '选用 本片素材', '选用 同项目素材']);
    fireEvent.click(screen.getByRole('button', { name: '选用 同项目素材' }));
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ url: '/other.png' }));
    view.unmount();
  });

  it('retains no cross-drama cache on a keyed parent remount (existing lifecycle protection)', async () => {
    const view = render(<DramaLibraryPicker key="d1" open onOpenChange={onOpenChange} title="素材库" onPick={onPick} />);
    await fillOther(); context.dramaId = 'd2';
    view.rerender(<DramaLibraryPicker key="d2" open onOpenChange={onOpenChange} title="素材库" onPick={onPick} />);
    expect(choices()).not.toContain('选用 旧缓存');
    await act(async () => reads.at(-1)!.response.reject(new Error('离线故障')));
    expect(choices()).not.toContain('选用 旧缓存');
  });
});
