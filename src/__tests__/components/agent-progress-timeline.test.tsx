import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AgentProgressTimeline } from '@/components/agent-runtime/AgentProgressTimeline';
import type { AgentRunProjection } from '@/lib/agent-runtime/types';

const planningProjection: AgentRunProjection = {
  runId: 'run-1', status: 'planning', lastSequence: 2,
  plan: [{ id: 'plan-1', label: '正在规划', status: 'active' }],
  assetVersionIds: [], ignoredEventIds: [], missingSequences: [],
};

describe('Agent progress timeline', () => {
  it('shows planning progress and an enabled cancel command for active runs', () => {
    const markup = renderToStaticMarkup(
      <AgentProgressTimeline projection={planningProjection} onCancel={() => undefined} />,
    );

    expect(markup).toContain('正在规划');
    expect(markup).toContain('取消任务');
    expect(markup).not.toContain('disabled');
  });

  it('hides cancellation after a terminal event and renders a normalized error', () => {
    const markup = renderToStaticMarkup(
      <AgentProgressTimeline projection={{
        ...planningProjection,
        status: 'failed',
        error: { code: 'MODEL_ROUTE_MISMATCH', message: '模型路由不匹配', retryable: true },
      }} onCancel={() => undefined} />,
    );

    expect(markup).not.toContain('取消任务');
    expect(markup).toContain('MODEL_ROUTE_MISMATCH');
    expect(markup).toContain('模型路由不匹配');
    expect(markup).toContain('可重试');
  });

  it('shows queued state after an event stream becomes stale', () => {
    const markup = renderToStaticMarkup(
      <AgentProgressTimeline projection={planningProjection} stale />,
    );

    expect(markup).toContain('正在排队');
  });
});
