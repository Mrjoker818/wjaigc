// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkPlanCard } from '@/components/simple-chat/work-plan-card';
import { buildWorkPlan } from '@/lib/chatgpt-work-mode';

const plan = buildWorkPlan('写一份开业推广方案');

describe('WorkPlanCard', () => {
  it('shows the current step while the reply streams', () => {
    const html = renderToStaticMarkup(<WorkPlanCard plan={plan} content={'## 步骤 2 · 收集并核验资料\n…'} finished={false} />);
    expect(html).toContain('工作计划');
    expect(html).toContain('第 2/4 步');
    expect(html).toContain('正在写');
  });

  it('says it waits for the user when the model stopped after asking questions', () => {
    const html = renderToStaticMarkup(<WorkPlanCard plan={plan} content={'## 步骤 1 · 明确目标与交付物\n请补充城市。'} finished />);
    expect(html).toContain('完成 1/4 步 · 待你回复');
    expect(html).toContain('待继续');
    expect(html).not.toContain('未单独展开');
  });

  it('renders nothing for a finished reply without any step heading, such as a failed request', () => {
    expect(renderToStaticMarkup(<WorkPlanCard plan={plan} content="请求失败：API 错误 405" finished />)).toBe('');
  });

  it('reports a complete plan as done', () => {
    const content = plan.steps.map((step, index) => `## 步骤 ${index + 1} · ${step.title}\n内容`).join('\n');
    expect(renderToStaticMarkup(<WorkPlanCard plan={plan} content={content} finished />)).toContain('已完成');
  });
});
