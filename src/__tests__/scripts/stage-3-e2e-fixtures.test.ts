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

const canvasPerformanceSource = readFileSync(
  resolve(process.cwd(), 'tests/helpers/canvas-performance.ts'),
  'utf8',
);
const stage3BrowserHelperSource = readFileSync(
  resolve(process.cwd(), 'tests/helpers/stage-3-e2e.ts'),
  'utf8',
);
const stage3FixtureSource = readFileSync(
  resolve(process.cwd(), 'scripts/stage-3-e2e-fixtures.mjs'),
  'utf8',
);
const infiniteCanvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const playwrightConfigSource = readFileSync(
  resolve(process.cwd(), 'playwright.config.ts'),
  'utf8',
);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePngChunks(bytes: Buffer): string[] {
  const chunkTypes: string[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    expect(offset + 12).toBeLessThanOrEqual(bytes.length);
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    expect(chunkEnd).toBeLessThanOrEqual(bytes.length);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = bytes.subarray(offset + 4, offset + 8 + length);
    expect(bytes.readUInt32BE(offset + 8 + length), `${type} CRC`).toBe(crc32(payload));
    chunkTypes.push(type);
    offset = chunkEnd;
  }
  expect(offset).toBe(bytes.length);
  return chunkTypes;
}

describe('Stage 3 performance evidence contract', () => {
  it('does not hide a foreign toolbar that blocks a Canvas node hit target', () => {
    const hitChecks = [...canvasPerformanceSource.matchAll(/const hit = document\.elementFromPoint/g)]
      .map(match => canvasPerformanceSource.slice(
        match.index,
        canvasPerformanceSource.indexOf('if (!hit ||', match.index),
      ));

    expect(hitChecks).toHaveLength(2);
    for (const hitCheck of hitChecks) {
      expect(hitCheck).not.toContain('[data-toolbar]');
      expect(hitCheck).toContain('[data-floating-panel], [data-popup], [data-modal]');
    }
  });

  it('measures input delay only for events created inside the active sample window', () => {
    expect(canvasPerformanceSource).not.toContain("buffered: true");
    expect(canvasPerformanceSource).toContain('timing.startTime >= state.startedAt');
  });

  it('proves the API-selected Canvas mode reaches the rendered viewport', () => {
    expect(stage3FixtureSource).toContain('E2E_STAGE3_EXPECTED_CANVAS_MODE');
    expect(stage3BrowserHelperSource).toContain("'E2E_STAGE3_EXPECTED_CANVAS_MODE'");
    expect(stage3BrowserHelperSource).toContain('syncBody.canvasKernelMode');
    expect(stage3BrowserHelperSource).toContain('environment.expectedCanvasMode');
    expect(stage3BrowserHelperSource).toContain("data-canvas-kernel-mode");
    expect(infiniteCanvasSource).toContain('data-canvas-kernel-mode={canvasKernelMode}');
  });

  it('fails closed on missing fixtures and browser runtime errors', () => {
    expect(stage3BrowserHelperSource).not.toContain('test.skip(missing.length > 0');
    expect(stage3BrowserHelperSource).not.toContain('test.skip(!projectId');
    expect(stage3BrowserHelperSource).toContain('Stage 3 runtime evidence failed');
    expect(stage3BrowserHelperSource).toContain("entry.type === 'error'");
    expect(stage3BrowserHelperSource).toContain("entry.type === 'pageerror'");
    expect(stage3BrowserHelperSource).toContain("page.on('pageerror'");
    expect(stage3BrowserHelperSource).toContain('isBenignStage3RequestAbort');
  });

  it('never exempts project persistence failures from the abort gate', () => {
    expect(stage3BrowserHelperSource).toContain("entry.method === 'GET'");
    expect(stage3BrowserHelperSource).toContain("pathname === '/api/task-events'");
    expect(stage3BrowserHelperSource).toContain("entry.method === 'POST' && pathname === '/api/activity'");
    expect(stage3BrowserHelperSource).toContain("pathname.startsWith('/api/serve-upload/')");
    expect(stage3BrowserHelperSource).not.toContain("pathname === '/api/user-data/sync'");
  });

  it('names every evidence tree by Canvas mode and controlled run id', () => {
    expect(stage3BrowserHelperSource).toContain('E2E_STAGE3_EXPECTED_CANVAS_MODE');
    expect(stage3BrowserHelperSource).toContain('E2E_STAGE3_RUN_ID');
    expect(playwrightConfigSource).toContain('stage3EvidenceScope');
    expect(playwrightConfigSource).toContain('Boolean(process.env.E2E_STAGE3_RUN_ID)');
    expect(playwrightConfigSource).toContain('E2E_STAGE3_EXPECTED_CANVAS_MODE');
    expect(playwrightConfigSource).toContain('E2E_STAGE3_RUN_ID');
  });

  it('keeps retries and repeated runs in distinct evidence directories', () => {
    expect(stage3BrowserHelperSource).toContain('`retry-${testInfo.retry}`');
    expect(stage3BrowserHelperSource).toContain('`repeat-${testInfo.repeatEachIndex}`');
  });
});

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
    expect(validatePngChunks(bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('routes pnpm Stage 3 video and trace output into the immutable baseline directory', () => {
    const source = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(source).toContain("process.env.npm_lifecycle_event === 'test:e2e:stage-3'");
    expect(source).toContain('`./test-results/stage-3-baseline/${stage3EvidenceScope}/playwright-output`');
    expect(source).toContain('`test-results/stage-3-baseline/${stage3EvidenceScope}/playwright-report`');
    expect(source).toContain('`test-results/stage-3-baseline/${stage3EvidenceScope}/junit.xml`');
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
      unclickableSamples: [{ id: 'node-a', hitTag: 'DIV', hitClass: 'overlay' }],
    });

    expect(sample.averageFps).toBe(6);
    expect(sample.inputDelayP95Ms).toBe(32);
    expect(sample.longestTaskMs).toBe(72);
    expect(sample.longestSaveTaskMs).toBe(91);
    expect(sample.disappearedFrames).toBe(2);
    expect(sample.unclickableDurationMs).toBe(48);
    expect(sample.unclickableSamples).toEqual([{ id: 'node-a', hitTag: 'DIV', hitClass: 'overlay' }]);
  });
});
