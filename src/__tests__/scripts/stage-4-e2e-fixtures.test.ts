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
    expect(plan.workflows.every(item => item.expectedNodeIds.length === 100)).toBe(true);
    expect(plan.workflows.every(item => new Set(item.expectedNodeIds).size === 100)).toBe(true);
    expect(plan.users.every(user => user.username.includes(plan.runId))).toBe(true);
  });

  it('fails closed when the Stage 4 fixture database is not configured', () => {
    expect(() => assertStage4FixtureDatabase(undefined, 'review-42')).toThrow(
      'BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation',
    );
  });

  it('requires an explicit safe run id and exact controlled database name', () => {
    const isolated = 'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require';

    expect(() => assertStage4FixtureDatabase(isolated, undefined)).toThrow(/E2E_STAGE4_RUN_ID is required/i);
    expect(() => assertStage4FixtureDatabase(isolated, 'review-42')).not.toThrow();
    expect(() => assertStage4FixtureDatabase(
      'postgresql://stage4_runner@127.0.0.1:5544/wujie?schema=wujie_stage4_review_42',
      'review-42',
    )).toThrow(/must not use connection query parameters/i);
    expect(() => assertStage4FixtureDatabase(
      'postgresql://stage4_runner@production-stage4.example.com:5544/wujie_stage4_review_42',
      'review-42',
    )).toThrow(/production-looking database host/i);
    expect(() => assertStage4FixtureDatabase(
      'postgresql://stage4_runner@127.0.0.1:5544/wujie_production',
      'review-42',
    )).toThrow(/database name must exactly match wujie_stage4_review_42/i);
  });

  it.each([
    ['host', 'prod.example'],
    ['hostaddr', '10.0.0.8'],
    ['port', '5432'],
    ['user', 'admin'],
    ['database', 'production'],
    ['dbname', 'production'],
    ['service', 'prod'],
    ['options', '-c search_path=public'],
  ])('blocks PostgreSQL query override %s before it can alter fixture routing', (key, value) => {
    const isolatedLookingUrl = new URL(
      'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42',
    );
    isolatedLookingUrl.searchParams.set(key, value);

    expect(() => assertStage4FixtureDatabase(isolatedLookingUrl.toString(), 'review-42'))
      .toThrow(/must not use connection query parameter/i);
  });

  it('accepts only the allowed SSL metadata on an exact isolated target', () => {
    expect(() => assertStage4FixtureDatabase(
      'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require',
      'review-42',
    )).not.toThrow();
  });

  it('does not expose credentials or the full connection string when blocking an override', () => {
    const credential = 'stage4-password-do-not-report';
    const rawUrl = `postgresql://stage4_runner:${credential}@127.0.0.1:5544/wujie_stage4_review_42?host=prod.example`;

    try {
      assertStage4FixtureDatabase(rawUrl, 'review-42');
      throw new Error('expected Stage 4 database isolation to block');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/must not use connection query parameters/i);
      expect(message).not.toContain(credential);
      expect(message).not.toContain(rawUrl);
    }
  });

  it('blocks when either configured application database variable is shared or production', () => {
    const isolated = 'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require';

    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      E2E_STAGE4_RUN_ID: 'review-42',
      DATABASE_URL: 'postgresql://app@production-db.example.com:5432/wujie_production',
      PGDATABASE_URL: isolated,
    })).toThrow(/production-looking database host|database name must exactly match/i);
    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      E2E_STAGE4_RUN_ID: 'review-42',
      DATABASE_URL: isolated,
      PGDATABASE_URL: 'postgresql://app@shared-db.example.com:5432/wujie_production',
    })).toThrow(/production-looking database host|database name must exactly match|configured database targets must match/i);
    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: isolated,
      E2E_STAGE4_RUN_ID: 'review-42',
      DATABASE_URL: '   ',
      PGDATABASE_URL: isolated,
    })).toThrow(/valid URL|application database URL/i);
  });

  it('requires the effective app database identity to exactly match user, host, port, database, and SSL target', () => {
    const isolated = 'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require';
    const baseEnvironment = {
      E2E_STAGE4_DATABASE_URL: isolated,
      E2E_STAGE4_RUN_ID: 'review-42',
    };

    expect(() => assertStage4FixtureDatabaseEnvironment(baseEnvironment)).toThrow(/application database URL .* required/i);
    for (const mismatchedTarget of [
      'postgresql://other_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require',
      'postgresql://stage4_runner@localhost:5544/wujie_stage4_review_42?sslmode=require',
      'postgresql://stage4_runner@127.0.0.1:5432/wujie_stage4_review_42?sslmode=require',
      'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_other_run?sslmode=require',
      'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=disable',
    ]) {
      expect(() => assertStage4FixtureDatabaseEnvironment({
        ...baseEnvironment,
        DATABASE_URL: mismatchedTarget,
      })).toThrow(/must exactly match E2E_STAGE4_DATABASE_URL|database name must exactly match/i);
    }

  });

  it('accepts syntactically different URLs only when their final parsed identities match', () => {
    const fixtureUrl = 'postgres://stage4_runner@LOCALHOST/wujie_stage4_review_42?sslmode=require';

    expect(() => assertStage4FixtureDatabaseEnvironment({
      E2E_STAGE4_DATABASE_URL: fixtureUrl,
      E2E_STAGE4_RUN_ID: 'review-42',
      DATABASE_URL: 'postgresql://stage4_runner@localhost:5432/wujie_stage4_review_42?sslmode=require',
      PGDATABASE_URL: 'postgres://stage4_runner@LOCALHOST/wujie_stage4_review_42?sslmode=require',
    })).not.toThrow();
  });

  it.each(['DATABASE_URL', 'PGDATABASE_URL'] as const)(
    'accepts an exact isolated match when only %s is configured',
    variableName => {
      const isolated = 'postgresql://stage4_runner@127.0.0.1:5544/wujie_stage4_review_42?sslmode=require';

      expect(() => assertStage4FixtureDatabaseEnvironment({
        E2E_STAGE4_DATABASE_URL: isolated,
        E2E_STAGE4_RUN_ID: 'review-42',
        [variableName]: isolated,
      })).not.toThrow();
    },
  );
});

describe('Stage 4 workflow performance samples', () => {
  const expectedIds = Array.from({ length: 100 }, (_, index) => `stage4-node-${index + 1}`);

  it('accepts the exact expected 100 fixture node ID set', () => {
    const ids = selectWorkflowMonitorIds(expectedIds);

    expect(() => assertWorkflowMonitorCoverage(ids, expectedIds)).not.toThrow();
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('stage4-node-1');
    expect(ids[99]).toBe('stage4-node-100');
  });

  it('rejects a missing expected fixture node ID', () => {
    const ids = selectWorkflowMonitorIds(expectedIds.slice(0, 99));

    expect(() => assertWorkflowMonitorCoverage(ids, expectedIds)).toThrow(/missing expected node IDs/i);
  });

  it('rejects duplicate monitored node IDs instead of hiding them', () => {
    const ids = selectWorkflowMonitorIds([...expectedIds.slice(0, 99), expectedIds[0]]);

    expect(() => assertWorkflowMonitorCoverage(ids, expectedIds)).toThrow(/duplicate monitored node IDs/i);
  });

  it('rejects 100 arbitrary node IDs with the right count', () => {
    const ids = selectWorkflowMonitorIds(Array.from({ length: 100 }, (_, index) => `wrong-node-${index + 1}`));

    expect(() => assertWorkflowMonitorCoverage(ids, expectedIds)).toThrow(/missing expected node IDs/i);
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
