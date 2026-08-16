import { describe, expect, it } from 'vitest';

import {
  assertStage4FixtureDatabase,
  assertStage4FixtureDatabaseEnvironment,
  buildStage4FixturePlan,
} from '../../../scripts/stage-4-e2e-fixtures.mjs';
import {
  assertWorkflowMonitorCoverage,
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
      'postgresql://127.0.0.1:5432/wujie_stage4_fixture',
    )).not.toThrow();

    expect(() => assertStage4FixtureDatabase(
      'postgresql://db.example.com:5432/wujie_prod',
    )).toThrow(/must not target a shared or production database/i);

    expect(() => assertStage4FixtureDatabase(
      'postgresql://db.example.com:5432/wujie',
    )).toThrow(/must prove isolated Stage 4 scope/i);
  });

  it('requires the running application database to exactly match the isolated Stage 4 target', () => {
    const isolated = 'postgresql://127.0.0.1:5432/wujie_stage4_fixture';

    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
    })).toThrow(/application database URL .* required/i);
    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      PGDATABASE_URL: 'postgresql://db.example.com:5432/wujie_production',
    })).toThrow(/must not target a shared or production database/i);
    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      PGDATABASE_URL: 'postgresql://127.0.0.1:5432/wujie_other_test',
    })).toThrow(/must exactly match E2E_STAGE4_DATABASE_URL/i);
    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      PGDATABASE_URL: isolated,
    })).not.toThrow();
  });
});

describe('Stage 4 workflow performance samples', () => {
  it('tracks all 100 fixture nodes without truncation', () => {
    const ids = selectWorkflowMonitorIds(Array.from({ length: 100 }, (_, index) => `stage4-node-${index + 1}`));

    expect(() => assertWorkflowMonitorCoverage(ids, 100)).not.toThrow();
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('stage4-node-1');
    expect(ids[99]).toBe('stage4-node-100');
  });

  it('blocks a performance gate that cannot monitor every fixture node', () => {
    const ids = selectWorkflowMonitorIds(Array.from({ length: 99 }, (_, index) => `stage4-node-${index + 1}`));

    expect(() => assertWorkflowMonitorCoverage(ids, 100)).toThrow(/must monitor all 100 fixture nodes/i);
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
      monitoredNodeCount: 100,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
      unclickableSamples: [],
    });

    expect(sample.averageFps).toBeGreaterThanOrEqual(55);
    expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
    expect(sample.monitoredNodeCount).toBe(100);
    expect(sample.lostNodeCount).toBe(0);
    expect(sample.unclickableDurationMs).toBe(0);
  });
});
