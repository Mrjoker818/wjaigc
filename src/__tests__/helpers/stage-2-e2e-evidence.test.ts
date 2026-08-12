import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  redactStage2Evidence,
  redactStage2TraceText,
  requireNonEmptyStage2Value,
  stage2PlacementDiff,
  sanitizeStage2Url,
  stage2DatabaseConnectionString,
  stage2ProjectPresenceIsValid,
  stage2ProjectMatrixValue,
  stage2SingleNewPlacementMatches,
  validateStage2SessionPayload,
  validateStage2ProjectIsolation,
} from '../../../tests/helpers/stage-2-e2e';
import { stage2RunStatus } from '../../../tests/helpers/stage-2-reporter';

describe('Stage 2 E2E evidence safety', () => {
  it('waits for the requested project identity before interacting with the canvas', () => {
    const canvasSource = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
    const helperSource = readFileSync(resolve(process.cwd(), 'tests/helpers/stage-2-e2e.ts'), 'utf8');

    expect(canvasSource).toContain("data-project-id={projectId || brandProject?.id || ''}");
    expect(helperSource).toContain("toHaveAttribute('data-project-id', projectId");
  });

  it('removes bearer tokens and credential values from captured text', () => {
    const input = 'Authorization: Bearer secret.jwt.value api_key=provider-secret password="plain-secret"';
    const output = redactStage2Evidence(input);
    expect(output).not.toContain('secret.jwt.value');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('plain-secret');
    expect(output).toContain('[REDACTED]');
  });

  it('requires a separate controlled project for each Playwright project', () => {
    expect(stage2ProjectMatrixValue('{"chromium":"legacy-chrome","firefox":"legacy-firefox"}', 'chromium')).toBe('legacy-chrome');
    expect(stage2ProjectMatrixValue('{"chromium":"legacy-chrome"}', 'firefox')).toBeNull();
    expect(stage2ProjectMatrixValue('not-json', 'chromium')).toBeNull();
    expect(stage2ProjectMatrixValue('{"chromium":"shared","firefox":"shared"}', 'chromium')).toBeNull();
  });

  it('rejects project IDs reused by different writable scenarios', () => {
    expect(() => validateStage2ProjectIsolation({
      E2E_STAGE2_RUN_ID: 'run-42',
      E2E_STAGE2_UPLOAD_PROJECT_IDS: '{"chromium":"shared-run-42"}',
      E2E_STAGE2_WORKFLOW_PROJECT_IDS: '{"chromium":"shared-run-42"}',
    })).toThrow(/reuses controlled project/);
    expect(() => validateStage2ProjectIsolation({
      E2E_STAGE2_RUN_ID: 'run-42',
      E2E_STAGE2_UPLOAD_PROJECT_IDS: '{"chromium":"upload-run-42"}',
      E2E_STAGE2_WORKFLOW_PROJECT_IDS: '{"chromium":"workflow-run-42"}',
    })).not.toThrow();
    expect(() => validateStage2ProjectIsolation({
      E2E_STAGE2_RUN_ID: 'run-42',
      E2E_STAGE2_UPLOAD_PROJECT_IDS: '{"chromium":"old-project"}',
    })).toThrow(/must include Stage 2 run id/);
    expect(() => validateStage2ProjectIsolation({
      E2E_STAGE2_RUN_ID: 'run-42',
      E2E_STAGE2_UPLOAD_PROJECT_IDS: '{"chromium":"cross-browser-run-42"}',
      E2E_STAGE2_WORKFLOW_PROJECT_IDS: '{"firefox":"cross-browser-run-42"}',
    })).toThrow(/reuses controlled project/);
  });

  it('finds only active placements added after a database baseline', () => {
    expect(stage2PlacementDiff(['placement-a'], [
      { id: 'placement-a', status: 'active' },
      { id: 'placement-b', status: 'active' },
      { id: 'placement-c', status: 'trashed' },
    ])).toEqual(['placement-b']);
  });

  it('rejects duplicate or identity-mismatched placements before cleanup', () => {
    const expected = {
      placementId: 'placement-b',
      entityId: 'canvas-image-b',
      assetVersionId: 'version-b',
    };
    expect(stage2SingleNewPlacementMatches(['placement-a'], [
      { id: 'placement-a', status: 'active', entityId: 'canvas-image-a', assetVersionId: 'version-a' },
      { id: 'placement-b', status: 'active', entityId: 'canvas-image-b', assetVersionId: 'version-b' },
    ], expected)).toBe(true);
    expect(stage2SingleNewPlacementMatches(['placement-a'], [
      { id: 'placement-b', status: 'active', entityId: 'canvas-image-b', assetVersionId: 'version-b' },
      { id: 'placement-c', status: 'active', entityId: 'canvas-image-c', assetVersionId: 'version-b' },
    ], expected)).toBe(false);
    expect(stage2SingleNewPlacementMatches(['placement-a'], [
      { id: 'placement-b', status: 'active', entityId: 'wrong-entity', assetVersionId: 'version-b' },
    ], expected)).toBe(false);
  });

  it('asserts exact transfer placement identity before destructive E2E cleanup', () => {
    const source = readFileSync(resolve(process.cwd(), 'tests/e2e/stage-2-cross-workspace.spec.ts'), 'utf8');
    expect(source.match(/assertSingleNewProjectPlacement\(/g)?.length).toBeGreaterThanOrEqual(3);
    const scenarios = source.split('finally {');
    expect(scenarios.slice(0, 3).every(scenario => scenario.includes('assertSingleNewProjectPlacement('))).toBe(true);
  });

  it('checks unique placement only after canvas visibility and durable project sync', () => {
    const source = readFileSync(resolve(process.cwd(), 'tests/e2e/stage-2-cross-workspace.spec.ts'), 'utf8');
    const scenarios = source.split('finally {').slice(0, 3);

    expect(source).toContain('observeProjectGraphSaves');
    for (const scenario of scenarios) {
      const visible = scenario.lastIndexOf('canvasImageByUrl(page, created.url)).toBeVisible');
      const saved = scenario.lastIndexOf('await saves.waitFor(created');
      const exact = scenario.lastIndexOf('assertSingleNewProjectPlacement(');
      expect(visible).toBeGreaterThan(-1);
      expect(saved).toBeGreaterThan(visible);
      expect(exact).toBeGreaterThan(saved);
    }
  });

  it('binds the durable save observation to the transferred entity, version, and placement', () => {
    const source = readFileSync(resolve(process.cwd(), 'tests/e2e/stage-2-cross-workspace.spec.ts'), 'utf8');
    const observer = source.slice(
      source.indexOf('function observeProjectGraphSaves('),
      source.indexOf("test.use({ trace: 'off'"),
    );
    expect(observer).toContain('${value.entityId}:${value.assetVersionId}:${value.placementId}');
    expect(observer).toContain('matches.has(keyOf(expected))');
    expect(observer).toContain('update.versionId');
    expect(observer).toContain('update.placementId');
  });

  it('rejects empty controlled fixture identities before locating UI state', () => {
    expect(requireNonEmptyStage2Value(' /api/serve-upload/image.png ', 'source URL')).toBe('/api/serve-upload/image.png');
    expect(() => requireNonEmptyStage2Value('', 'source URL')).toThrow(/source URL must be non-empty/);
    expect(() => requireNonEmptyStage2Value('   ', 'missing-media filename')).toThrow(/missing-media filename must be non-empty/);
  });

  it('requires an explicit Stage 2 database connection instead of ambient app credentials', () => {
    expect(stage2DatabaseConnectionString({
      E2E_STAGE2_DATABASE_URL: 'postgresql://stage2:test@example.test/wujie',
      DATABASE_URL: 'postgresql://wrong:test@example.test/wrong',
      PGDATABASE_URL: 'postgresql://also-wrong:test@example.test/wrong',
    })).toBe('postgresql://stage2:test@example.test/wujie');
    expect(() => stage2DatabaseConnectionString({
      DATABASE_URL: 'postgresql://ambient:test@example.test/wrong',
    })).toThrow(/E2E_STAGE2_DATABASE_URL/);
  });

  it('rejects a successful login response when the page session belongs to another user', () => {
    expect(validateStage2SessionPayload({
      success: true,
      user: { name: 'stage2_run_42' },
    }, 'stage2_run_42')).toBe(true);
    expect(validateStage2SessionPayload({
      success: true,
      user: { name: 'admin' },
    }, 'stage2_run_42')).toBe(false);
    expect(validateStage2SessionPayload({ success: true, user: null }, 'stage2_run_42')).toBe(false);
  });

  it('allows an unconsumed COW fixture to have no asset-graph project row', () => {
    expect(stage2ProjectPresenceIsValid([], 'must-be-missing')).toBe(true);
    expect(stage2ProjectPresenceIsValid([{ id: 'project-a' }], 'must-be-missing')).toBe(false);
    expect(stage2ProjectPresenceIsValid([], false)).toBe(false);
    expect(stage2ProjectPresenceIsValid([{ id: 'project-a' }], false)).toBe(true);
    expect(stage2ProjectPresenceIsValid([], 'optional')).toBe(true);
    expect(stage2ProjectPresenceIsValid([{ id: 'project-a' }], 'optional')).toBe(true);
  });

  it('redacts sensitive URL parameters beyond token and key aliases', () => {
    const url = sanitizeStage2Url('https://example.test/api?auth=a&session=b&signature=c&safe=visible');
    expect(url).not.toContain('auth=a');
    expect(url).not.toContain('session=b');
    expect(url).not.toContain('signature=c');
    expect(url).toContain('safe=visible');
  });

  it('removes cookie headers and signed URLs from Playwright trace text', () => {
    const trace = '{"headers":[{"name":"cookie","value":"session=secret"}],"refreshToken":"refresh secret value","client_secret":"client-secret","url":"https://example.test/media?signature=abc&safe=yes"}';
    const output = redactStage2TraceText(trace);
    expect(output).not.toContain('session=secret');
    expect(output).not.toContain('refresh secret value');
    expect(output).not.toContain('client-secret');
    expect(output).not.toContain('signature=abc');
    expect(output).toContain('safe=yes');
  });

  it('fails the dedicated gate when any scenario is skipped', () => {
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 0, skipped: 0 })).toBe('passed');
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 0, skipped: 1 })).toBe('failed');
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 1, skipped: 0 })).toBe('failed');
    expect(stage2RunStatus({ baseStatus: 'failed', failed: 0, skipped: 0 })).toBe('failed');
  });
});
