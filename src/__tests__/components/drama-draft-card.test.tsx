// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DramaDraftCard } from '@/components/simple-chat/drama-draft-card';
import { readDramaDraft } from '@/lib/simple-chat-drama-draft';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';
import { project, taskWithMessages } from '@/__tests__/fixtures/simple-chat-sync';

const draft = { dramaId: 'drama_1', title: '雨夜来信', projectId: 'project-1', summary: '1 集、6 场、3 个角色' };

describe('simple chat drama draft', () => {
  it('reads a well-formed draft and rejects broken ones', () => {
    expect(readDramaDraft(draft)).toEqual(draft);
    expect(readDramaDraft({ ...draft, projectId: undefined })).toEqual({ dramaId: 'drama_1', title: '雨夜来信', summary: '1 集、6 场、3 个角色' });
    expect(readDramaDraft({ ...draft, dramaId: '../x' })).toBeNull();
    expect(readDramaDraft({ ...draft, title: ' ' })).toBeNull();
    expect(readDramaDraft({ ...draft, projectId: 'a b' })).toBeNull();
    expect(readDramaDraft('drama_1')).toBeNull();
  });

  it('syncs a message with a valid draft and rejects a broken one', () => {
    const task = taskWithMessages('t1', 2);
    task.messages[1] = { ...task.messages[1], role: 'assistant', dramaDraft: draft };
    expect(validateSimpleChatProjects([project('p1', [task])])).toEqual({ success: true });

    const broken = taskWithMessages('t2', 1);
    (broken.messages[0] as unknown as Record<string, unknown>).dramaDraft = { dramaId: 'drama_1' };
    expect(validateSimpleChatProjects([project('p2', [broken])])).toMatchObject({ success: false, field: 'dramaDraft' });
  });

  it('links the card to the drama in the video workbench', () => {
    const html = renderToStaticMarkup(<DramaDraftCard draft={draft} />);
    expect(html).toContain('《雨夜来信》');
    expect(html).toContain('1 集、6 场、3 个角色');
    expect(html).toContain('短剧剧本已保存在短剧工作台');
    expect(html).toContain('href="/video?projectId=project-1&amp;dramaId=drama_1"');
    expect(html).toContain('在短剧工作台打开');
  });
});
