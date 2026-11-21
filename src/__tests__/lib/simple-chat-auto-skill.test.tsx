// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveSkillFileSteps, readSimpleChatReplySkill, selectSimpleChatAutoSkill } from '@/lib/simple-chat-auto-skill';
import { SIMPLE_CHAT_PRESET_SKILLS } from '@/lib/skill-runtime/simple-chat-presets';
import { SkillTraceCard } from '@/components/simple-chat/skill-trace-card';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';
import { project, taskWithMessages } from '@/__tests__/fixtures/simple-chat-sync';

const knownSkillIds = SIMPLE_CHAT_PRESET_SKILLS.map(skill => skill.id);
const pick = (text: string, options: { explicitSkillId?: string; previousSkillId?: string } = {}) =>
  selectSimpleChatAutoSkill(text, { ...options, knownSkillIds });

describe('auto skill selection', () => {
  it('routes requests to make a file to the matching preset skill', () => {
    expect(pick('帮我做一份季度汇报PPT').skillId).toBe('ppt-master');
    expect(pick('把下面的数据整理成 Excel 表格').skillId).toBe('excel-master');
    expect(pick('用思维导图梳理这本书').skillId).toBe('mindmap-master');
    expect(pick('画一个请假审批流程图').skillId).toBe('flowchart-master');
    expect(pick('写一份租房合同').skillId).toBe('word-master');
    expect(pick('设计一张中秋海报').skillId).toBe('poster-design');
    expect(pick('帮我写一封催款邮件').skillId).toBe('email-master');
  });

  it('leaves questions about a file type to plain chat', () => {
    expect(pick('你好').skillId).toBeNull();
    expect(pick('excel 里 VLOOKUP 怎么用').skillId).toBeNull();
    expect(pick('这个 PPT 讲得好不好').skillId).toBeNull();
    expect(pick('word 文档怎么加页码').skillId).toBeNull();
  });

  it('lets a slash command win and strips it from the request', () => {
    expect(pick('/word 写一份请假条')).toEqual({ skillId: 'word-master', text: '写一份请假条', source: 'command' });
    expect(pick('/PPT 产品发布', { explicitSkillId: 'excel-master' })).toMatchObject({ skillId: 'ppt-master', source: 'command' });
    expect(pick('/unknown 你好')).toMatchObject({ skillId: null, text: '/unknown 你好' });
  });

  it('uses the skill chosen in the composer when there is no command', () => {
    expect(pick('随便聊聊', { explicitSkillId: 'mindmap-master' })).toMatchObject({ skillId: 'mindmap-master', source: 'explicit' });
    expect(pick('随便聊聊', { explicitSkillId: 'not-a-skill' }).skillId).toBeNull();
  });

  it('keeps the previous skill for a short edit of its result only', () => {
    expect(pick('第 3 页标题改短一点', { previousSkillId: 'ppt-master' })).toMatchObject({ skillId: 'ppt-master', source: 'follow-up' });
    expect(pick('谢谢，今天天气怎么样', { previousSkillId: 'ppt-master' }).skillId).toBeNull();
    expect(pick(`改一下${'很长'.repeat(80)}`, { previousSkillId: 'ppt-master' }).skillId).toBeNull();
  });
});

describe('skill file steps', () => {
  it('follows the reply from prose to a parsed json block', () => {
    expect(deriveSkillFileSteps('', false)).toEqual(['running', 'pending', 'pending', 'pending']);
    expect(deriveSkillFileSteps('好的，大纲如下', false)).toEqual(['done', 'running', 'pending', 'pending']);
    expect(deriveSkillFileSteps('大纲\n```json\n{"slides":', false)).toEqual(['done', 'done', 'running', 'pending']);
    expect(deriveSkillFileSteps('```json\n{"slides":[{"title":"汇报"}]}\n```', true)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('fails the data step when the finished block does not parse', () => {
    expect(deriveSkillFileSteps('```json\n{"slides":[\n```', true)).toEqual(['done', 'done', 'failed', 'pending']);
  });

  it('does not claim a file when the model only asked a question', () => {
    expect(deriveSkillFileSteps('请问汇报对象是谁？', true)).toEqual(['done', 'pending', 'pending', 'pending']);
  });
});

describe('skill trace', () => {
  it('names the skill and how it was chosen, with steps only for file skills', () => {
    const ppt = renderToStaticMarkup(<SkillTraceCard skill={{ id: 'ppt-master', name: 'PPT大师', source: 'auto' }} content={'```json\n{"slides":[{"title":"汇报"}]}\n```'} finished />);
    expect(ppt).toContain('技能 · PPT大师');
    expect(ppt).toContain('自动匹配');
    expect(ppt).toContain('可以下载');
    const email = renderToStaticMarkup(<SkillTraceCard skill={{ id: 'email-master', name: '邮件写作助手', source: 'command' }} content="正文" finished />);
    expect(email).toContain('指令');
    expect(email).not.toContain('可以下载');
  });

  it('syncs a valid reply skill and rejects a broken one', () => {
    const task = taskWithMessages('t1', 2);
    task.messages[1] = { ...task.messages[1], role: 'assistant', skill: { id: 'ppt-master', name: 'PPT大师', source: 'auto' } };
    expect(validateSimpleChatProjects([project('p1', [task])])).toEqual({ success: true });
    const broken = taskWithMessages('t2', 1);
    (broken.messages[0] as unknown as Record<string, unknown>).skill = { id: 'ppt-master', name: 'PPT大师', source: 'guess' };
    expect(validateSimpleChatProjects([project('p2', [broken])])).toMatchObject({ success: false, field: 'skill' });
    expect(readSimpleChatReplySkill({ id: '../x', name: 'n', source: 'auto' })).toBeNull();
  });
});
