// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { reduceSkillEvents } from '@/components/skill-runtime/skill-event-projection';
import type { AgentEvent } from '@/lib/agent-runtime/types';
import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';
import { reduceAgentEvents } from '@/lib/agent-runtime/event-reducer';
import { createAgentRunEventPoller } from '@/components/agent-runtime/use-agent-run-events';

afterEach(cleanup);
function event(sequence: number, type: AgentEvent['type'], payload: Record<string, unknown> = {}): AgentEvent {
  return { runId: 'run', eventId: `e${sequence}`, sequence, type, timestamp: '2026-09-03T22:39:43.358Z', payload };
}
const created = event(1, 'run.created', { skillSnapshot: { steps: [
  { id: 'a', label: '方案分析' }, { id: 'b', label: '图像生成' },
] } });
const start = event(2, 'tool.started', { stepId: 'a', generation: 0 });

describe('frozen Skill step display', () => {
  it('preserves generic runs and malformed snapshots', () => {
    for (const snapshot of [undefined, null, { steps: [null] }, { steps: [{ id: 'a' }] }]) {
      const events = [event(1, 'run.created', { skillSnapshot: snapshot }), start];
      expect(reduceSkillEvents(events)).toEqual(reduceAgentEvents(events));
    }
  });
  it('keeps the first duplicate event and ignores events after cancellation', () => {
    const cancelled = event(3, 'run.cancelled');
    const events = [created, start, start, cancelled, event(4, 'tool.completed', { stepId: 'a' })];
    expect(reduceSkillEvents(events).plan.map(s => s.status)).toEqual(['cancelled', 'pending']);
  });
  it('uses the Skill projection only when explicitly selected by the poller', async () => {
    for (const project of [undefined, reduceSkillEvents]) {
      const results: ReturnType<typeof reduceAgentEvents>[] = [];
      const poller = createAgentRunEventPoller({
        runId: 'run', project,
        load: async (_id, after) => after === 0 ? [created, start] : [event(3, 'run.cancelled')],
        onProjection: result => { results.push(result); }, onStale: () => undefined,
      });
      await poller.poll();
      await poller.poll();
      expect(results[0]?.plan.map(s => s.status)).toEqual(project ? ['processing', 'pending'] : []);
      expect(results[1]?.status).toBe('cancelled');
      expect(results[1]?.plan.map(s => s.status)).toEqual(project ? ['cancelled', 'pending'] : []);
      expect(poller.isActive()).toBe(false);
    }
  });
  it('shows frozen steps before a plan.updated event exists', () => {
    expect(reduceSkillEvents([created, start]).plan.map(s => s.status)).toEqual(['processing', 'pending']);
  });
  it('replays the real manual pause then cancel sequence', () => {
    const result = reduceSkillEvents([created, start,
      event(3, 'run.paused', { nextStepId: 'a', pauseReason: 'user' }),
      event(4, 'run.cancelled')]);
    expect(result.status).toBe('cancelled');
    expect(result.plan.map(s => s.status)).toEqual(['cancelled', 'pending']);
  });
  it('keeps completed steps and terminates every active parallel step', () => {
    expect(reduceSkillEvents([created, start,
      event(3, 'tool.completed', { stepId: 'a' }),
      event(4, 'tool.started', { stepId: 'b' }), event(5, 'run.timeout')]).plan.map(s => s.status))
      .toEqual(['completed', 'timeout']);
    expect(reduceSkillEvents([created, start,
      event(3, 'tool.started', { stepId: 'b' }), event(4, 'run.cancelled')]).plan.map(s => s.status))
      .toEqual(['cancelled', 'cancelled']);
  });
  it('shows an error pause and rejects stale generation and late completion', () => {
    const paused = [created, start, event(3, 'run.paused', { nextStepId: 'a', pauseReason: 'execution-error' })];
    expect(reduceSkillEvents(paused).plan[0]?.status).toBe('failed');
    const result = reduceSkillEvents([...paused,
      event(4, 'run.resumed', { nextStepId: 'a', generation: 1 }),
      event(5, 'tool.completed', { stepId: 'a', generation: 0 }),
      event(6, 'tool.started', { stepId: 'a', generation: 1 }),
      event(7, 'run.cancelled'), event(8, 'tool.completed', { stepId: 'a', generation: 1 })]);
    expect(result.plan[0]?.status).toBe('cancelled');
  });
  it('renders status labels and keeps cancel terminal controls absent', () => {
    render(<SkillRunProgress projection={{ ...reduceSkillEvents([created]), status: 'cancelled',
      plan: [{ id: 'a', label: '方案分析', status: 'completed' }, { id: 'b', label: '图像生成', status: 'cancelled' }] }} />);
    expect(screen.getAllByText('已取消').length).toBe(2);
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续' })).toBeNull();
  });
});
