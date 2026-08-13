import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assertStage3DatabaseGuard,
  assertStage3OutputOutsideRepository,
  buildStage3CleanupPlan,
  buildStage3FixturePlan,
  stage3FixturePngBytes,
} from '../../../scripts/stage-3-e2e-fixtures.mjs';
import { summarizeCanvasPerformance } from '../../../tests/helpers/canvas-performance';

describe('Stage 3 E2E fixture isolation', () => {
  it('creates isolated 1, 100 and 300 node projects for every browser profile', () => {
    const plan = buildStage3FixturePlan('run-20260813');

    expect(plan.projects).toHaveLength(15);
    expect(new Set(plan.projects.map(project => project.id)).size).toBe(15);
    expect(plan.projects.filter(project => project.nodeCount === 1)).toHaveLength(5);
    expect(plan.projects.filter(project => project.nodeCount === 100)).toHaveLength(5);
    expect(plan.projects.filter(project => project.nodeCount === 300)).toHaveLength(5);
    expect(plan.projects.every(project => project.images.length === project.nodeCount)).toBe(true);
  });

  it('keeps credential and fixture environment output outside the repository', () => {
    const repository = resolve('repository');

    expect(() => assertStage3OutputOutsideRepository(repository, repository)).toThrow(
      'Stage 3 credential output must remain outside the repository',
    );
    expect(() => assertStage3OutputOutsideRepository(resolve(repository, 'test-results', 'stage3.json'), repository))
      .toThrow('Stage 3 credential output must remain outside the repository');
    expect(() => assertStage3OutputOutsideRepository(resolve(repository, '..', 'stage3.json'), repository))
      .not.toThrow();
  });

  it('requires the exact database guard token before fixture mutation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ guard_token: 'stage3-token' }] });

    await expect(assertStage3DatabaseGuard(query, 'stage3-token')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      'SELECT guard_token FROM wujie_stage3_e2e_guard WHERE guard_token=$1',
      ['stage3-token'],
    );
    await expect(assertStage3DatabaseGuard(query, '')).rejects.toThrow('Stage 3 database guard token is required');
  });

  it('limits cleanup by owner, run id and the exact project set', () => {
    const cleanup = buildStage3CleanupPlan({
      ownerId: 'stage3-owner',
      runId: 'run-20260813',
      projectIds: ['project-a', 'project-b'],
    });

    expect(cleanup.length).toBeGreaterThan(0);
    for (const statement of cleanup) {
      expect(statement.sql).toContain('owner_id = $1');
      expect(statement.sql).toContain("metadata->>'stage3RunId' = $2");
      if (statement.sql.includes('wujie_projects')) {
        expect(statement.sql).toContain('id = ANY($3::text[])');
        expect(statement.sql).not.toContain('project_id = ANY($3::text[])');
      } else {
        expect(statement.sql).toContain('project_id = ANY($3::text[])');
      }
      expect(statement.params).toEqual([
        'stage3-owner',
        'run-20260813',
        ['project-a', 'project-b'],
      ]);
    }
  });

  it('uses one controlled 64 by 64 PNG for every render node', () => {
    const bytes = stage3FixturePngBytes();
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
  });

  it('routes pnpm Stage 3 video and trace output into the immutable baseline directory', () => {
    const source = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(source).toContain("process.env.npm_lifecycle_event === 'test:e2e:stage-3'");
    expect(source).toContain("'./test-results/stage-3-baseline/playwright-output'");
  });
});

describe('Stage 3 performance sample summarization', () => {
  it('calculates frame rate, p95 input delay and continuity failures without hiding long tasks', () => {
    const sample = summarizeCanvasPerformance({
      startedAt: 0,
      endedAt: 1_000,
      frameTimestamps: [0, 16, 32, 48, 64, 80, 96],
      inputDelaysMs: [2, 4, 8, 16, 32],
      longTasksMs: [12, 72, 31],
      saveTasksMs: [18, 91],
      disappearedFrames: 2,
      unclickableDurationMs: 48,
    });

    expect(sample.averageFps).toBe(6);
    expect(sample.inputDelayP95Ms).toBe(32);
    expect(sample.longestTaskMs).toBe(72);
    expect(sample.longestSaveTaskMs).toBe(91);
    expect(sample.disappearedFrames).toBe(2);
    expect(sample.unclickableDurationMs).toBe(48);
  });
});
