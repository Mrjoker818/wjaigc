import { describe, expect, it } from 'vitest';
import {
  DRAMA_CHAT_HANDOFF_SCRIPT_CHARS,
  buildDramaChatHandoff,
  dramaChatHandoffMessage,
  takeDramaChatHandoff,
  writeDramaChatHandoff,
} from '@/lib/drama/chat-handoff';
import { createEmptyDramaProject, type DramaEpisode, type DramaProjectV1 } from '@/lib/drama/types';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';
import { project, taskWithMessages } from '@/__tests__/fixtures/simple-chat-sync';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
    items,
  };
}

function sampleDoc(script = '第 1 场 · 便利店 · 内 · 夜\n阿强：「这单不是我的。」'): { doc: DramaProjectV1; episode: DramaEpisode } {
  const base = createEmptyDramaProject();
  const episode = {
    ...base.episodes[0],
    index: 0,
    title: '送错的外卖',
    logline: '外卖员暴雨夜送错餐',
    script,
    scenes: [{ id: 's1', heading: '便利店门口', summary: '阿强发现送错了', locationId: 'l1', characterIds: ['c1'], shots: [] }],
  } as DramaEpisode;
  const doc = {
    ...base,
    title: '雨夜来信',
    cast: [{ ...(base.cast[0] ?? {}), id: 'c1', name: '阿强' }],
    locations: [{ ...(base.locations[0] ?? {}), id: 'l1', name: '便利店' }],
    episodes: [episode],
  } as DramaProjectV1;
  return { doc, episode };
}

describe('drama to chat handoff', () => {
  it('writes the episode logline, cast, scenes and script as Markdown', () => {
    const { doc, episode } = sampleDoc();
    const handoff = buildDramaChatHandoff(doc, episode, { dramaId: 'drama_1', projectId: 'project-1' }, 1000);
    expect(handoff).toMatchObject({ dramaId: 'drama_1', projectId: 'project-1', title: '雨夜来信', summary: '第 1 集 · 1 场 · 1 个角色' });
    expect(handoff.text).toContain('## 《雨夜来信》第 1 集：送错的外卖');
    expect(handoff.text).toContain('**梗概**：外卖员暴雨夜送错餐');
    expect(handoff.text).toContain('1. 便利店门口（便利店；阿强）：阿强发现送错了');
    expect(handoff.text).toContain('阿强：「这单不是我的。」');
    expect(dramaChatHandoffMessage(handoff)).toContain('告诉我想怎么改');
  });

  it('does not repeat an episode number the title already has', () => {
    const { doc, episode } = sampleDoc();
    const titled = { ...episode, title: '第 1 集：三点十七分的指针' };
    const handoff = buildDramaChatHandoff({ ...doc, episodes: [titled] }, titled, { dramaId: 'drama_1' });
    expect(handoff.text).toContain('## 《雨夜来信》第 1 集：三点十七分的指针');
    expect(handoff.text).not.toContain('第 0 集');
  });

  it('cuts a very long script and says so', () => {
    const { doc, episode } = sampleDoc('字'.repeat(DRAMA_CHAT_HANDOFF_SCRIPT_CHARS + 50));
    const handoff = buildDramaChatHandoff(doc, episode, { dramaId: 'drama_1' });
    expect(handoff.text).toContain('后面的内容没有带过来');
    expect(handoff).not.toHaveProperty('projectId');
  });

  it('is read once, and ignored when stale or malformed', () => {
    const storage = memoryStorage();
    const { doc, episode } = sampleDoc();
    writeDramaChatHandoff(storage, buildDramaChatHandoff(doc, episode, { dramaId: 'drama_1' }, 1000));
    expect(takeDramaChatHandoff(storage, 2000)?.dramaId).toBe('drama_1');
    expect(takeDramaChatHandoff(storage, 2000)).toBeNull();

    writeDramaChatHandoff(storage, buildDramaChatHandoff(doc, episode, { dramaId: 'drama_1' }, 1000));
    expect(takeDramaChatHandoff(storage, 1000 + 11 * 60 * 1000)).toBeNull();
    expect(storage.items.size).toBe(0);

    storage.setItem('wujie:drama-chat-handoff', JSON.stringify({ dramaId: '../x', title: 't', summary: '', text: 'x', createdAt: 1000 }));
    expect(takeDramaChatHandoff(storage, 1000)).toBeNull();
    storage.setItem('wujie:drama-chat-handoff', '{not json');
    expect(takeDramaChatHandoff(storage, 1000)).toBeNull();
  });

  it('starts a chat task whose first message syncs', () => {
    const { doc, episode } = sampleDoc();
    const handoff = buildDramaChatHandoff(doc, episode, { dramaId: 'drama_1', projectId: 'project-1' });
    const task = taskWithMessages('t1', 0);
    task.messages = [{
      id: 'm1', role: 'assistant', content: dramaChatHandoffMessage(handoff), status: 'completed', createdAt: Date.now(), artifacts: [],
      dramaDraft: { dramaId: handoff.dramaId, title: handoff.title, projectId: 'project-1', summary: handoff.summary },
    }];
    expect(validateSimpleChatProjects([project('p1', [task])])).toEqual({ success: true });
  });
});
