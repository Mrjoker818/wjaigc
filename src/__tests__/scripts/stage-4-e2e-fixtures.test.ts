import { describe, expect, it } from 'vitest';

import {
  assertStage4FixtureDatabase,
  assertStage4FixtureDatabaseEnvironment,
  buildStage4FixturePlan,
  stage4UsernameRunToken,
} from '../../../scripts/stage-4-e2e-fixtures.mjs';
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

describe('Stage 4 runtime evidence filter', () => {
  it('fails closed on console warnings and unknown network errors while allowing task SSE cancellation', () => {
    expect(stage4RuntimeEvidenceFailures([], [{
      method: 'GET',
      text: 'NS_ERROR_ABORT',
      url: 'http://127.0.0.1:5000/api/task-events',
    }])).toEqual({ consoleFailures: [], networkFailures: [] });

    const consoleWarning = { type: 'warning', text: 'unexpected warning' };
    const serverFailure = { method: 'POST', status: 500, url: 'http://127.0.0.1:5000/api/chat' };
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

  it('allows a project sync conflict only after the identical snapshot retries successfully', () => {
    const conflict = {
      method: 'POST',
      status: 409,
      requestDigest: 'same-project-snapshot',
      url: 'http://127.0.0.1:5000/api/user-data/sync',
      occurredAt: 100,
    };
    const browserConflict = {
      type: 'error',
      text: 'Failed to load resource: the server responded with a status of 409 (Conflict)',
      url: conflict.url,
      occurredAt: 101,
    };
    const recovered = {
      method: 'POST',
      status: 200,
      requestDigest: conflict.requestDigest,
      url: conflict.url,
      occurredAt: 120,
    };

    expect(stage4RuntimeEvidenceFailures([browserConflict], [conflict, recovered])).toEqual({
      consoleFailures: [],
      networkFailures: [],
    });
    expect(stage4RuntimeEvidenceFailures([browserConflict], [conflict, {
      ...recovered,
      requestDigest: 'different-project-snapshot',
    }])).toEqual({
      consoleFailures: [browserConflict],
      networkFailures: [conflict],
    });
    expect(stage4RuntimeEvidenceFailures([browserConflict], [conflict])).toEqual({
      consoleFailures: [browserConflict],
      networkFailures: [conflict],
    });
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
});
