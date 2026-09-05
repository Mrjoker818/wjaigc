import { describe, expect, it } from 'vitest';

import {
  assertStage4FixtureDatabase,
  assertStage4FixtureDatabaseEnvironment,
  buildStage4FixturePlan,
  stage4UsernameRunToken,
} from '../../../scripts/stage-4-e2e-fixtures.mjs';
import {
  assertWorkflowMonitorCoverage,
  assertWorkflowPerformanceThresholds,
  assertWorkflowVirtualizationCoverage,
  resolveExpectedMountedWorkflowNodeIds,
  recordAndSummarizeWorkflowPerformance,
  resolveWorkflowMonitorBatch,
  selectWorkflowMonitorIds,
  summarizeWorkflowPerformance,
  shouldEnforceWorkflowFpsGate,
  shouldObserveWorkflowLongTasks,
} from '../../../tests/helpers/workflow-performance';
import { stage4RuntimeEvidenceFailures } from '../../../tests/helpers/stage-4-evidence-filter';

describe('Stage 4 fixture isolation', () => {
  it('builds isolated browser, user, and workflow plans for the legacy baseline', () => {
    const plan = buildStage4FixturePlan('s4-run');

    expect(plan.browserProfiles).toHaveLength(5);
    expect(new Set(plan.users.map(user => user.id)).size).toBe(5);
    expect(plan.workflows.every(item => item.nodeCount === 100)).toBe(true);
    expect(plan.workflows.every(item => item.expectedNodeIds.length === 100)).toBe(true);
    expect(plan.workflows.every(item => new Set(item.expectedNodeIds).size === 100)).toBe(true);
    expect(plan.users.every(user => user.username.includes(stage4UsernameRunToken(plan.runId)))).toBe(true);
    expect(plan.users.every(user => /^[a-zA-Z0-9_]{3,32}$/.test(user.username))).toBe(true);
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

  it('derives the explicit mounted subset for the 100-node virtualized fixture', () => {
    const workflow = buildStage4FixturePlan('mounted-subset').workflows[0]!.workflow;
    const expectedMountedIds = Array.from({ length: 5 }, (_, row) => (
      Array.from({ length: 4 }, (_, column) => `stage4-node-${row * 10 + column + 1}`)
    )).flat();

    const mountedIds = resolveExpectedMountedWorkflowNodeIds(
      workflow.nodes,
      { x: 0, y: 0, zoom: 0.8 },
      { width: 800, height: 600 },
    );

    expect(mountedIds).toEqual(expectedMountedIds);
    expect(mountedIds).toHaveLength(20);
    expect(mountedIds.length).toBeLessThan(workflow.nodes.length);
    expect(() => assertWorkflowVirtualizationCoverage({
      domainNodeIds: workflow.nodes.map(node => node.id),
      expectedDomainNodeIds: expectedIds,
      mountedNodeIds: mountedIds,
      expectedMountedNodeIds: expectedMountedIds,
    })).not.toThrow();
  });

  it('rejects an empty mounted set instead of turning the performance gate into a domain-only test', () => {
    expect(() => assertWorkflowVirtualizationCoverage({
      domainNodeIds: expectedIds,
      expectedDomainNodeIds: expectedIds,
      mountedNodeIds: [],
      expectedMountedNodeIds: ['stage4-node-1'],
    })).toThrow(/mounted node IDs/i);
  });

  it('rotates bounded monitor batches across every mounted node without duplicates', () => {
    const batches = Array.from({ length: 12 }, (_, frameIndex) => (
      resolveWorkflowMonitorBatch(expectedIds, frameIndex, 12)
    ));

    expect(batches.every(batch => batch.length > 0 && batch.length <= 9)).toBe(true);
    expect(batches.every(batch => new Set(batch).size === batch.length)).toBe(true);
    expect(new Set(batches.flat())).toEqual(new Set(expectedIds));
  });

  it('keeps the 55 FPS gate on the two desktop Chromium performance profiles', () => {
    expect(shouldEnforceWorkflowFpsGate('chromium')).toBe(true);
    expect(shouldEnforceWorkflowFpsGate('chromium-1080p')).toBe(true);
    expect(shouldEnforceWorkflowFpsGate('firefox')).toBe(false);
    expect(shouldEnforceWorkflowFpsGate('webkit')).toBe(false);
    expect(shouldEnforceWorkflowFpsGate('mobile-chromium')).toBe(false);
    expect(() => shouldEnforceWorkflowFpsGate('renamed-chromium')).toThrow(/unknown browser profile/i);
  });

  it('registers the long-task observer only when the browser advertises support', () => {
    expect(shouldObserveWorkflowLongTasks(undefined)).toBe(false);
    expect(shouldObserveWorkflowLongTasks([])).toBe(false);
    expect(shouldObserveWorkflowLongTasks(['event', 'longtask'])).toBe(true);
  });

  it('fails closed on console warnings and unknown network errors while allowing task SSE cancellation', () => {
    expect(stage4RuntimeEvidenceFailures([], [{
      method: 'GET',
      text: 'NS_ERROR_ABORT',
      url: 'http://127.0.0.1:5000/api/task-events',
    }])).toEqual({ consoleFailures: [], networkFailures: [] });

    const consoleWarning = { type: 'warning', text: 'unexpected warning' };
    const serverFailure = { method: 'POST', status: 500, url: 'http://127.0.0.1:5000/api/workflow/execute' };
    expect(stage4RuntimeEvidenceFailures([consoleWarning], [serverFailure])).toEqual({
      consoleFailures: [consoleWarning],
      networkFailures: [serverFailure],
    });
  });

  it('allows an aborted duplicate sync only after the same request payload succeeded', () => {
    const succeeded = {
      method: 'POST',
      status: 200,
      requestDigest: 'same-payload',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      occurredAt: 100,
    };
    const aborted = {
      method: 'POST',
      text: 'net::ERR_ABORTED',
      requestDigest: 'same-payload',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      occurredAt: 110,
    };

    expect(stage4RuntimeEvidenceFailures([], [succeeded, aborted]).networkFailures).toEqual([]);
    expect(stage4RuntimeEvidenceFailures([], [aborted]).networkFailures).toEqual([aborted]);
  });

  it('allows an aborted workflow status poll only after the identical request succeeds', () => {
    const aborted = {
      method: 'POST',
      text: 'net::ERR_ABORTED',
      requestDigest: 'same-status-payload',
      url: 'http://127.0.0.1:5000/api/workflow/execute',
      occurredAt: 100,
    };
    const recovered = {
      method: 'POST',
      status: 200,
      requestDigest: aborted.requestDigest,
      url: aborted.url,
      occurredAt: 120,
    };

    expect(stage4RuntimeEvidenceFailures([], [aborted, recovered]).networkFailures).toEqual([]);
    expect(stage4RuntimeEvidenceFailures([], [aborted]).networkFailures).toEqual([aborted]);
    expect(stage4RuntimeEvidenceFailures([], [aborted, {
      ...recovered,
      requestDigest: 'different-status-payload',
    }]).networkFailures).toEqual([aborted]);
  });

  it('allows an aborted idempotent GET only when the same URL later succeeds', () => {
    const aborted = {
      method: 'GET',
      text: 'net::ERR_ABORTED',
      url: 'http://127.0.0.1:5000/api/skills?surface=canvas',
      occurredAt: 100,
    };
    const recovered = {
      method: 'GET',
      status: 200,
      url: aborted.url,
      occurredAt: 120,
    };

    expect(stage4RuntimeEvidenceFailures([], [aborted, recovered]).networkFailures).toEqual([]);
    expect(stage4RuntimeEvidenceFailures([], [recovered, aborted]).networkFailures).toEqual([]);
    expect(stage4RuntimeEvidenceFailures([], [aborted]).networkFailures).toEqual([aborted]);
  });

  it('allows browser-cancelled Next.js chunks during an intentional route change', () => {
    const abortedChunk = {
      method: 'GET',
      text: 'net::ERR_ABORTED',
      url: 'http://127.0.0.1:5000/_next/static/chunks/3195.example.js',
    };
    expect(stage4RuntimeEvidenceFailures([], [abortedChunk]).networkFailures).toEqual([]);
    expect(stage4RuntimeEvidenceFailures([], [{ ...abortedChunk, status: 404, text: undefined }]).networkFailures)
      .toHaveLength(1);
  });

  it('keeps latency and continuity gates active when a browser cannot provide a 55 FPS RAF baseline', () => {
    const sample = summarizeWorkflowPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: Array.from({ length: 40 }, (_, index) => index * 25),
      inputDelaysMs: [5, 10],
      inputDelaySamples: [{ source: 'pointer', name: 'pointermove', delayMs: 10, startTime: 100, observedAt: 110 }],
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    });

    expect(() => assertWorkflowPerformanceThresholds(sample, { enforceFps: false })).not.toThrow();
    expect(() => assertWorkflowPerformanceThresholds({ ...sample, inputDelayP95Ms: 51 }, { enforceFps: false }))
      .toThrow(/P95 <= 50ms/i);
  });

  it('summarizes workflow interaction evidence without hiding dropped nodes', () => {
    const sample = summarizeWorkflowPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: Array.from({ length: 60 }, (_, index) => index * 16),
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
    expect(() => assertWorkflowPerformanceThresholds(sample)).not.toThrow();
  });

  it('rejects a short RAF burst instead of inflating it across a 1000ms measurement', () => {
    const sample = summarizeWorkflowPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: [0, 16, 32, 48, 64, 80, 96],
      inputDelaysMs: [5],
      inputDelaySamples: [{ source: 'pointer', name: 'pointermove', delayMs: 5, startTime: 10, observedAt: 15 }],
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    });

    expect(sample.averageFps).toBe(6);
    expect(() => assertWorkflowPerformanceThresholds(sample)).toThrow(/55 FPS/i);
  });

  it('counts complete frame intervals without granting a free first frame', () => {
    const sample = summarizeWorkflowPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: Array.from({ length: 56 }, (_, index) => index * 16),
      inputDelaysMs: [5],
      inputDelaySamples: [{ source: 'pointer', name: 'pointermove', delayMs: 5, startTime: 10, observedAt: 15 }],
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    });

    expect(sample.averageFps).toBe(55);
  });

  it('fails closed when frame or input latency evidence is missing', () => {
    const base = {
      startedAt: 0,
      endedAt: 1_000,
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    };

    expect(() => summarizeWorkflowPerformance({
      ...base,
      frameTimestamps: [16],
      inputDelaysMs: [5],
      inputDelaySamples: [{ source: 'pointer' as const, name: 'pointermove', delayMs: 5, startTime: 10, observedAt: 15 }],
    })).toThrow(/at least two valid frames/i);
    expect(() => summarizeWorkflowPerformance({
      ...base,
      frameTimestamps: [16, 32],
      inputDelaysMs: [],
      inputDelaySamples: [],
    })).toThrow(/input latency samples/i);
  });

  it('reports the raw timing envelope when frame evidence is invalid', () => {
    expect(() => summarizeWorkflowPerformance({
      startedAt: 100.2,
      endedAt: 180,
      frameTimestamps: [99.9, 116.6, 133.3],
      inputDelaysMs: [5],
      inputDelaySamples: [{ source: 'pointer', name: 'pointermove', delayMs: 5, startTime: 110, observedAt: 115 }],
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    })).toThrow(/startedAt=100\.2.*firstFrame=99\.9.*lastFrame=133\.3.*frameCount=3/i);
  });

  it('records raw evidence before invalid timing is rejected', async () => {
    const raw = {
      startedAt: 100.2,
      endedAt: 180,
      frameTimestamps: [99.9, 116.6, 133.3],
      inputDelaysMs: [5],
      inputDelaySamples: [{ source: 'pointer' as const, name: 'pointermove', delayMs: 5, startTime: 110, observedAt: 115 }],
      longTasksMs: [],
      monitoredNodeCount: 48,
      lostNodeCount: 0,
      unclickableDurationMs: 0,
    };
    const recorded: unknown[] = [];

    await expect(recordAndSummarizeWorkflowPerformance(raw, evidence => { recorded.push(evidence); }))
      .rejects.toThrow(/invalid frame timestamps/i);
    expect(recorded).toEqual([raw]);
  });
});
