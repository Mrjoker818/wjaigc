import { buildWorkPlan, normalizeWorkMode } from '@/lib/chatgpt-work-mode';
import { describe, expect, it } from 'vitest';

describe('ChatGPT work mode', () => {
  it('builds an auditable multi-step plan and gates sensitive actions', () => {
    expect(normalizeWorkMode('work')).toBe('work');
    const plan = buildWorkPlan('研究竞品并生成报告，完成后删除旧文件');
    expect(plan.steps.map(step => step.title)).toContain('等待用户批准关键操作');
    expect(plan.steps.some(step => step.approvalRequired)).toBe(true);
    expect(plan.deliverable).toBe('带来源或依据的结构化报告');
  });
});
