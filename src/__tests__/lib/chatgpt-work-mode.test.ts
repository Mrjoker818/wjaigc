import { describe, expect, it } from 'vitest';
import {
  buildWorkModeInstructions,
  buildWorkPlan,
  deriveWorkPlanProgress,
  normalizeWorkMode,
  readWorkPlan,
} from '@/lib/chatgpt-work-mode';
import { createSimpleChatRetryContext, readSimpleChatRetryContext } from '@/lib/simple-chat-retry';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';
import { project, taskWithMessages } from '@/__tests__/fixtures/simple-chat-sync';

describe('work mode plan', () => {
  it('only accepts "work" as work mode', () => {
    expect(normalizeWorkMode('work')).toBe('work');
    expect(normalizeWorkMode('WORK')).toBe('chat');
    expect(normalizeWorkMode(undefined)).toBe('chat');
  });

  it('builds a four-step plan with an inferred deliverable and no approval step', () => {
    const plan = buildWorkPlan('  帮我做一份竞品分析报告，然后发布到公众号 ');
    expect(plan.goal).toBe('帮我做一份竞品分析报告，然后发布到公众号');
    expect(plan.deliverable).toBe('带依据的结构化报告');
    expect(plan.steps.map(step => step.title)).toEqual(['明确目标与交付物', '收集并核验资料', '分步执行', '整理可复核成果']);
    expect(buildWorkPlan('x'.repeat(900)).goal).toHaveLength(500);
  });

  it('asks the model for one heading per step and forbids claiming irreversible actions', () => {
    const text = buildWorkModeInstructions(buildWorkPlan('写一份活动方案'));
    expect(text).toContain('## 步骤 1 · 明确目标与交付物');
    expect(text).toContain('## 步骤 4 · 整理可复核成果');
    expect(text).toContain('交付物：可执行的方案');
    expect(text).toContain('不要声称已经执行了支付、删除、发布、发送等操作');
  });

  it('rejects malformed plans', () => {
    const plan = buildWorkPlan('写周报');
    expect(readWorkPlan(plan)).toEqual(plan);
    expect(readWorkPlan({ ...plan, steps: [] })).toBeNull();
    expect(readWorkPlan({ ...plan, steps: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: 't' })) })).toBeNull();
    expect(readWorkPlan({ ...plan, deliverable: '' })).toBeNull();
    expect(readWorkPlan({ ...plan, steps: [{ id: 'a', title: 'x'.repeat(41) }] })).toBeNull();
    expect(readWorkPlan('plan')).toBeNull();
  });
});

describe('work plan progress', () => {
  const plan = buildWorkPlan('写周报');

  it('starts on step 1 before any heading arrives', () => {
    expect(deriveWorkPlanProgress(plan, '', false)).toEqual({
      statuses: ['running', 'pending', 'pending', 'pending'], current: 1, finished: false,
    });
  });

  it('marks the last heading as running and earlier ones as done', () => {
    const content = '## 步骤 1 · 明确目标与交付物\n目标\n\n## 步骤 2 · 收集并核验资料\n资料';
    expect(deriveWorkPlanProgress(plan, content, false).statuses).toEqual(['done', 'running', 'pending', 'pending']);
  });

  it('reports steps the reply never reached as skipped once finished', () => {
    const content = '## 步骤 1 · 明确目标\n…\n### 步骤3：分步执行\n…';
    const progress = deriveWorkPlanProgress(plan, content, true);
    expect(progress.statuses).toEqual(['done', 'skipped', 'done', 'skipped']);
    expect(progress.current).toBe(3);
  });

  it('ignores step numbers that are not headings or are out of range', () => {
    const content = '先看步骤 2 的说明。\n## 步骤 9 · 额外';
    expect(deriveWorkPlanProgress(plan, content, true).statuses).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  });
});

describe('work mode persistence', () => {
  const context = {
    kind: 'chat' as const,
    projectId: 'project-a',
    taskId: 'task-a',
    userMessageId: 'user-a',
    assistantMessageId: 'assistant-a',
    idempotencyKey: 'simple-chat-retry:task-a:assistant-a',
    modelId: 'chat-model',
    providerId: 'provider-a',
    webSearch: false,
    sourceVersionIds: [],
    selectedEntityIds: [],
    historyMessageIds: [],
    systemMessages: [],
    knowledgeItems: [],
    memories: [],
  };

  it('keeps work mode in the retry context so a retry runs the same way', () => {
    expect(createSimpleChatRetryContext({ ...context, workMode: 'work' }).workMode).toBe('work');
    expect(createSimpleChatRetryContext(context)).not.toHaveProperty('workMode');
    expect(readSimpleChatRetryContext({ version: 1, ...context, workMode: 'chat' })).not.toHaveProperty('workMode');
    expect(readSimpleChatRetryContext({ version: 1, ...context, workMode: 'agent' })).toBeNull();
  });

  it('syncs the task switch and a valid message plan, and rejects a broken plan', () => {
    const chatTask = taskWithMessages('t1', 2);
    chatTask.workMode = 'work';
    chatTask.messages[1] = { ...chatTask.messages[1], role: 'assistant', workPlan: buildWorkPlan('写周报') };
    expect(validateSimpleChatProjects([project('p1', [chatTask])])).toEqual({ success: true });

    const broken = taskWithMessages('t2', 1);
    (broken.messages[0] as unknown as Record<string, unknown>).workPlan = { goal: 'x', deliverable: 'y', steps: [] };
    expect(validateSimpleChatProjects([project('p2', [broken])])).toMatchObject({ success: false, field: 'workPlan' });

    const badMode = taskWithMessages('t3', 1);
    (badMode as unknown as Record<string, unknown>).workMode = 'agent';
    expect(validateSimpleChatProjects([project('p3', [badMode])])).toMatchObject({ success: false });
  });
});
