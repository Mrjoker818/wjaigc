import { describe, expect, it } from 'vitest';

import {
  assertStage4FixtureDatabase,
  buildStage4FixturePlan,
} from '../../../scripts/stage-4-e2e-fixtures.mjs';
import {
  selectWorkflowMonitorIds,
  summarizeWorkflowPerformance,
} from '../../../tests/helpers/workflow-performance';

describe('Stage 4 fixture isolation', () => {
  it('builds isolated browser, user, and workflow plans for the legacy baseline', () => {
    const plan = buildStage4FixturePlan('s4-run');

    expect(plan.browserProfiles).toHaveLength(5);
    expect(new Set(plan.users.map(user => user.id)).size).toBe(5);
    expect(plan.workflows.every(item => item.nodeCount === 100)).toBe(true);
    expect(plan.users.every(user => user.username.includes(plan.runId))).toBe(true);
  });

  it('fails closed when the Stage 4 fixture database is not configured', () => {
    expect(() => assertStage4FixtureDatabase(undefined)).toThrow(
      'BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation',
    );
  });

  it('accepts isolated Stage 4 fixture databases and rejects shared or production databases', () => {
    expect(() => assertStage4FixtureDatabase(
      'postgresql://fixture_user:secret@127.0.0.1:5432/wujie_stage4_fixture',
    )).not.toThrow();

    expect(() => assertStage4FixtureDatabase(
      'postgresql://app:secret@db.example.com:5432/wujie_prod',
    )).toThrow(/must not target a shared or production database/i);

    expect(() => assertStage4FixtureDatabase(
      'postgresql://app:secret@db.example.com:5432/wujie',
    )).toThrow(/must prove isolated Stage 4 scope/i);
  });
});

describe('Stage 4 workflow performance samples', () => {
  it('tracks all 100 fixture nodes without truncation', () => {
    const ids = selectWorkflowMonitorIds(Array.from({ length: 100 }, (_, index) => `stage4-node-${index + 1}`));

    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('stage4-node-1');
    expect(ids[99]).toBe('stage4-node-100');
  });

  it('summarizes workflow interaction evidence without hiding dropped nodes', () => {
    const sample = summarizeWorkflowPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: [0, 16, 32, 48, 64, 80, 96],
      inputDelaysMs: [5, 8, 12, 18, 42],
      inputDelaySamples: [
        {
          source: 'pointer',
          name: 'pointermove',
          delayMs: 12,
          startTime: 64,
          observedAt: 76,
        },
      ],
      longTasksMs: [12, 40, 18],
      longTaskSamples: [
        { startTime: 220, durationMs: 40, name: 'self' },
      ],
      lostNodeCount: 0,
      unclickableDurationMs: 0,
      unclickableSamples: [],
    });

    expect(sample.averageFps).toBeGreaterThanOrEqual(55);
    expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
    expect(sample.lostNodeCount).toBe(0);
    expect(sample.unclickableDurationMs).toBe(0);
  });
});
