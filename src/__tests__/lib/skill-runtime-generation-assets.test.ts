import { describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '@/lib/agent-runtime/types';

vi.mock('server-only', () => ({}));

function event(
  sequence: number,
  type: AgentEvent['type'],
  payload: Record<string, unknown>,
): AgentEvent {
  return {
    eventId: `event-${sequence}`,
    runId: 'run-generation-assets',
    sequence,
    type,
    timestamp: '2026-09-13T00:00:00.000Z',
    payload,
  };
}

describe('Skill Runtime generation asset selection', () => {
  it('只保留与成功 generation 精确配对的资产，并兼容无 generation 的历史事件', async () => {
    const service = await import('@/lib/skill-runtime/service') as Record<string, unknown>;
    expect(typeof service.completedAssetVersionIds).toBe('function');

    const collect = service.completedAssetVersionIds as (events: readonly AgentEvent[]) => string[];
    expect(collect([
      event(1, 'asset.created', { stepId: 'generate-film', generation: 1, assetVersionId: 'stale-v1' }),
      event(2, 'asset.created', { stepId: 'generate-film', generation: 2, assetVersionId: 'current-v2' }),
      event(3, 'tool.completed', { stepId: 'generate-film', generation: 2 }),
      event(4, 'asset.created', { stepId: 'legacy-step', assetVersionId: 'legacy-v1' }),
      event(5, 'tool.completed', { stepId: 'legacy-step' }),
    ])).toEqual(['current-v2', 'legacy-v1']);
  });
});
