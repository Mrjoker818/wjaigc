// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DramaScriptStep } from '@/components/drama/drama-script-step';
import { DramaWorkbenchContext, type DramaWorkbenchApi } from '@/components/drama/drama-context';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';

const raw = '第1集 雨夜\n第1场 咖啡馆 内 夜\n林夏：等我。';
const edited = '第1集 雨夜\n第1场 咖啡馆 内 夜\n林夏：别走。\n第2场 街道 外 夜\n林夏：下雨了。';
const fixture = () => ({
  ...createEmptyDramaProject({ title: '雨夜' }),
  sourceScript: { originalText: raw, format: 'text' as const, importedAt: 123 },
  episodes: [{ id: 'ep1', index: 0, title: '第1集', logline: '', script: raw, structuredScript: raw, scenes: [{
    id: 'sc1', heading: '第1场 咖啡馆 内 夜', summary: '林夏：等我。', sourceRange: { start: 7, end: raw.length }, shots: [{
      id: 'shot1', index: 0, title: '旧镜头', purpose: '', actionBeat: '', prompt: '咖啡馆', duration: 5, durationSec: 5,
      aspectRatio: '9:16', references: [], continuityNotes: [],
      status: 'completed' as const, selectedTakeId: 'take1', takes: [{ id: 'take1', status: 'completed' as const, videoUrl: '/old.mp4', createdAt: 1 }],
    }],
  }] }],
});
let latest: DramaProjectV1;
function Harness({ initial = fixture() as DramaProjectV1 }: { initial?: DramaProjectV1 }) {
  const [doc, setDoc] = useState(initial);
  const [index, setIndex] = useState(0);
  useEffect(() => { latest = doc; }, [doc]);
  const api = { doc, episode: doc.episodes[index], update: setDoc, replaceDoc: setDoc,
    runJob: async (_: string, job: () => Promise<void>) => { await job(); return true; },
    busyLabel: null, setStep: () => undefined } as unknown as DramaWorkbenchApi;
  return <DramaWorkbenchContext.Provider value={api}><button onClick={() => setIndex(1)}>切换下一集</button><DramaScriptStep /></DramaWorkbenchContext.Provider>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('script structure refresh', () => {
  it('can explicitly archive the original scenes when the source body is cleared', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    fireEvent.click(screen.getByRole('button', { name: '应用分场更新' }));
    expect(latest.episodes[0].scenes).toHaveLength(0);
    expect(latest.episodes[0].archivedScenes?.[0].shots[0].takes[0].videoUrl).toBe('/old.mp4');
  });
  it('does not offer an unsaveable structural result with too many characters in one scene', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: `第1场 咖啡馆\n${Array.from({ length: 31 }, (_, i) => `角色${i}：你好。`).join('\n')}` } });
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    expect(screen.getByRole('alert').textContent).toMatch(/重新解析失败/);
    expect(screen.queryByRole('button', { name: '应用分场更新' })).toBeNull();
    expect(latest.episodes[0].scenes[0].shots[0].takes[0].videoUrl).toBe('/old.mp4');
  });
  it('passes the selected planner on regeneration and retains it in the returned document', async () => {
    const planner = { providerId: 'authorized-provider', modelId: 'chat-model' };
    const initial = { ...fixture(), planner };
    let submitted: unknown;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ doc: createEmptyDramaProject({ title: '新剧本' }) }));
    });
    render(<Harness initial={initial as DramaProjectV1} />);
    fireEvent.change(screen.getByRole('textbox', { name: '一句话梗概' }), { target: { value: '雨夜重逢' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '按梗概重新生成剧本' })));
    expect(submitted).toMatchObject({ planner });
    expect((latest as DramaProjectV1 & { planner?: typeof planner }).planner).toEqual(planner);
    expect(latest.sourceScript?.originalText).toBe(raw);
  });
  it('previews changed scenes before applying and retains matched IDs, takes and raw original', () => {
    render(<Harness />);
    expect(screen.queryByText(/正文已修改，分场结构尚未更新/)).toBeNull();
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: edited } });
    expect(screen.getByText(/正文已修改，分场结构尚未更新/)).toBeTruthy();
    expect(latest.episodes[0].scenes).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    const panel = within(screen.getByRole('region', { name: '重新解析预览' }));
    expect(panel.getByText(/别走/)).toBeTruthy();
    expect(panel.getByText(/下雨了/)).toBeTruthy();
    expect(panel.getByText(/^分场 1 → 2 · 受影响场次/)).toBeTruthy();
    expect(latest.episodes[0].scenes).toHaveLength(1);
    fireEvent.click(panel.getByRole('button', { name: '应用分场更新' }));
    expect(latest.episodes[0].scenes).toHaveLength(2);
    expect(latest.episodes[0].scenes[0].id).toBe('sc1');
    expect(latest.episodes[0].scenes[0].shots[0]).toEqual(fixture().episodes[0].scenes[0].shots[0]);
    expect((latest as ReturnType<typeof fixture>).sourceScript.originalText).toBe(raw);
    expect(screen.queryByText(/正文已修改，分场结构尚未更新/)).toBeNull();
  });

  it('cancels a refresh and invalidates the proposed changes on later edits', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    fireEvent.click(screen.getByRole('button', { name: '取消分场更新' }));
    expect(latest.episodes[0].scenes).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: `${edited}\n林夏：再见。` } });
    expect(screen.queryByRole('button', { name: '应用分场更新' })).toBeNull();
  });

  it('invalidates a preview when a scene is manually edited or the active episode changes', () => {
    const doc = fixture();
    doc.episodes.push({ ...doc.episodes[0], id: 'ep2', title: '第2集', scenes: [] });
    render(<Harness initial={doc as DramaProjectV1} />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    fireEvent.change(screen.getByLabelText('第 1 场内容'), { target: { value: '人工校对后内容' } });
    expect(screen.queryByRole('button', { name: '应用分场更新' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    fireEvent.click(screen.getByRole('button', { name: '切换下一集' }));
    expect(screen.queryByRole('button', { name: '应用分场更新' })).toBeNull();
  });

  it('keeps legacy scenes usable without claiming their structure is stale', () => {
    const doc: DramaProjectV1 = fixture();
    delete doc.sourceScript;
    delete doc.episodes[0].structuredScript;
    render(<Harness initial={doc} />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: '手写新内容' } });
    expect(screen.getByLabelText('第 1 场内容')).toBeTruthy();
    expect(screen.queryByText(/正文已修改，分场结构尚未更新/)).toBeNull();
  });

  it('explains a failed structural refresh without applying partial results or exposing parser codes', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('剧本正文'), { target: { value: `第1场 ${'门'.repeat(201)}\n甲：好。` } });
    fireEvent.click(screen.getByRole('button', { name: '预览重新解析' }));
    expect(screen.getByRole('alert').textContent).toMatch(/重新解析失败.*检查/);
    expect(screen.getByRole('alert').textContent).not.toContain('DRAMA_SOURCE_');
    expect(screen.queryByRole('button', { name: '应用分场更新' })).toBeNull();
    expect(latest.episodes[0].scenes).toHaveLength(1);
    expect(latest.episodes[0].scenes[0].shots[0].takes[0].videoUrl).toBe('/old.mp4');
  });
});
