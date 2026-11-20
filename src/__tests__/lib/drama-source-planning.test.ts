import { describe, expect, it } from 'vitest';
import { buildDramaShotMessages, parseDramaShotResponse } from '@/lib/drama/planner';
import { createEmptyDramaProject, type DramaProjectV1 } from '@/lib/drama/types';

function fixture(): DramaProjectV1 {
  const script = '第一场 内景 客厅\r\n林夏：请保留这句原话。\r\n第二场 外景 街道\r\n林夏：第二场。';
  return { ...createEmptyDramaProject(), episodes: [{ id: 'e', index: 0, title: '一', logline: '', script, structuredScript: script,
    scenes: [{ id: 's', heading: '客厅', summary: '旧摘要', sourceRange: { start: 0, end: script.indexOf('第二场') }, shots: [] }] }] } as DramaProjectV1;
}
describe('source-backed shot planning', () => {
  it('fits planned shots to the selected video model duration set', () => {
    const doc = createEmptyDramaProject();
    doc.episodes = [{ id: 'e', index: 0, title: '', logline: '', script: '', scenes: [{ id: 's', heading: '', summary: '', shots: [] }] }];
    const input = { doc, episodeId: 'e', sceneId: 's', allowedDurations: [4, 8, 12] };
    expect(buildDramaShotMessages(input)[1].content).toContain('4、8、12');
    expect(parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: 'x', duration: 7 }] }), input)[0].durationSec).toBe(8);
  });
  it('plans the current scene from exact original dialogue, not a stale summary or another scene', () => {
    const messages = buildDramaShotMessages({ doc: fixture(), episodeId: 'e', sceneId: 's' });
    expect(messages[1].content).toContain('林夏：请保留这句原话。');
    expect(messages[1].content).not.toContain('林夏：第二场。');
  });
  it('blocks planning from structure that predates a body edit', () => {
    const doc = fixture(); doc.episodes[0].script += '\n新台词';
    expect(() => buildDramaShotMessages({ doc, episodeId: 'e', sceneId: 's' })).toThrow('DRAMA_SOURCE_STALE');
  });
  it('rejects invented dialogue in imported scripts', () => {
    const input = { doc: fixture(), episodeId: 'e', sceneId: 's' };
    expect(() => parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: '看向窗外', dialogue: '编造的一句话' }] }), input)).toThrow('DRAMA_PLAN_INVALID');
    expect(parseDramaShotResponse(JSON.stringify({ shots: [{ prompt: '看向窗外', dialogue: '请保留这句原话。' }] }), input)[0].dialogue).toBe('请保留这句原话。');
  });
});
