import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  assertStage2OutputOutsideRepository,
  assertStage2DatabaseGuard,
  buildStage2FixturePlan,
  buildStage2FixtureUser,
  buildStage2FixtureUsername,
  defaultStage2FixturePaths,
  stage2PlacementEntityId,
  stage2CompletedMigrationCheckpoint,
  stage2FixturePngBytes,
  stringifyStage2Environment,
} from '../../../scripts/stage-2-e2e-fixtures.mjs';

describe('Stage 2 E2E fixture plan', () => {
  it('uses a PNG fixture that strict browser decoders can fully read', async () => {
    const decoded = await sharp(stage2FixturePngBytes()).raw().toBuffer({ resolveWithObject: true });

    expect(decoded.info.width).toBe(64);
    expect(decoded.info.height).toBe(64);
    expect(decoded.data.length).toBe(64 * 64 * decoded.info.channels);
  });

  it('allocates every browser/scenario to a unique run-owned project', () => {
    const plan = buildStage2FixturePlan('run-42');
    const ids = Object.values(plan.projectMatrices).flatMap(matrix => Object.values(matrix));

    expect(plan.browsers).toEqual([
      'chromium',
      'chromium-1080p',
      'firefox',
      'webkit',
      'mobile-chromium',
    ]);
    expect(ids.length).toBe(60);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id.includes('run-42'))).toBe(true);
  });

  it('keeps COW projects out of the seeded asset graph', () => {
    const plan = buildStage2FixturePlan('run-42');
    const cow = new Set(Object.values(plan.projectMatrices.E2E_STAGE2_COPY_ON_WRITE_PROJECT_IDS));
    const graphProjects = new Set(plan.graphProjects.map(project => project.id));

    expect([...cow].every(id => !graphProjects.has(id))).toBe(true);
    expect(plan.legacyProjects.filter(project => cow.has(project.id))).toHaveLength(5);
  });

  it('provides a concrete source identity for every cross-workspace scenario', () => {
    const plan = buildStage2FixturePlan('run-42');

    expect(plan.assets.filter(asset => asset.role === 'embedded-chat')).toHaveLength(5);
    expect(plan.assets.filter(asset => asset.role === 'workflow')).toHaveLength(5);
    expect(plan.assets.filter(asset => asset.role === 'standalone-chat')).toHaveLength(5);
    expect(plan.assets.filter(asset => asset.role === 'shared')).toHaveLength(5);
  });

  it('seeds completed migration checkpoints for graph projects so shadow saves can reconcile them', () => {
    const plan = buildStage2FixturePlan('run-42');
    const project = plan.graphProjects.find(candidate => candidate.role === 'refresh' && candidate.browser === 'chromium');
    expect(project).toBeTruthy();

    const checkpoint = stage2CompletedMigrationCheckpoint(plan, project!);

    expect(checkpoint.status).toBe('completed');
    expect(checkpoint.projectId).toBe(project!.id);
    expect(checkpoint.legacyProjectId).toBe(project!.id);
    expect(checkpoint.checkpoint.sourceSchemaVersion).toBe(3);
    expect(Object.values(checkpoint.checkpoint.legacyImageMappings)).toHaveLength(1);
  });

  it('writes an ASCII-only environment file that preserves Windows Unicode paths', () => {
    const source = { E2E_STAGE2_UPLOAD_FIXTURE: 'J:\\无界本地版\\fixture.png' };
    const serialized = stringifyStage2Environment(source);

    expect(serialized).toMatch(/^[\x00-\x7f]+$/);
    expect(JSON.parse(serialized)).toEqual(source);
  });

  it('grants the isolated browser user both product workspaces', () => {
    expect(buildStage2FixtureUser({
      userId: 'stage2-user-run-42',
      username: 'stage2_run_42',
    })).toMatchObject({
      id: 'stage2-user-run-42',
      name: 'stage2_run_42',
      role: 'user',
      status: 'active',
      productType: 'canvas,chat',
    });
  });

  it('allocates a stable unique login name for each fixture run', () => {
    const first = buildStage2FixtureUsername('stage2_user', 'run-42');
    const second = buildStage2FixtureUsername('stage2_user', 'run-43');

    expect(first).toBe(buildStage2FixtureUsername('stage2_user', 'run-42'));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^stage2_user_[a-f0-9]{12}$/);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it('matches seeded placement identities to the entity ids used by each workspace UI', () => {
    expect(stage2PlacementEntityId({ entityId: 'image-1' }, 'canvas-image')).toBe('image-1');
    expect(stage2PlacementEntityId({ entityId: 'image-1' }, 'workflow-input')).toBe('image-1-input');
    expect(stage2PlacementEntityId({ entityId: 'image-1' }, 'chat-result')).toBe('image-1:chat-result');
  });

  it('requires an exact database guard token before fixture mutation', async () => {
    const query = async () => ({ rows: [{ guard_token: 'expected-token' }] });

    await expect(assertStage2DatabaseGuard(query, 'expected-token')).resolves.toBeUndefined();
    await expect(assertStage2DatabaseGuard(query, 'wrong-token')).rejects.toThrow('database guard');
    await expect(assertStage2DatabaseGuard(async () => ({ rows: [] }), 'expected-token'))
      .rejects.toThrow('database guard');
  });

  it('rejects a short authentication secret before connecting to the fixture database', () => {
    const result = spawnSync(process.execPath, ['scripts/stage-2-e2e-fixtures.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        NODE_ENV: 'test',
        E2E_STAGE2_ALLOW_SEED: '1',
        E2E_STAGE2_DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/stage2_preflight?sslmode=disable',
        E2E_STAGE2_DATABASE_GUARD: 'stage2-preflight-guard',
        E2E_STAGE2_RUN_ID: 'stage2-preflight',
        E2E_TEST_USERNAME: 'stage2_preflight',
        E2E_TEST_PASSWORD: 'stage2-preflight-password',
        WUJIE_AUTH_SECRET: 'stage2-auth-secret-coze-s24-r2',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WUJIE_AUTH_SECRET must contain at least 32 characters');
    expect(result.stderr).not.toContain('ECONNREFUSED');
  });

  it('defaults credential-bearing fixture output outside the repository', () => {
    const paths = defaultStage2FixturePaths('run-42');

    expect(paths.output.replaceAll('\\', '/')).not.toContain('/output/');
    expect(paths.dataRoot.replaceAll('\\', '/')).not.toContain('/output/');
    expect(paths.uploadFixture.replaceAll('\\', '/')).not.toContain('/output/');
  });

  it('rejects an explicit credential output path inside the repository', () => {
    const repositoryRoot = resolve(process.cwd());

    expect(() => assertStage2OutputOutsideRepository(
      resolve(repositoryRoot, 'output', 'stage-2-env.json'),
      repositoryRoot,
    )).toThrow(/outside the repository/);
    expect(() => assertStage2OutputOutsideRepository(
      resolve(repositoryRoot, '..', 'stage-2-env.json'),
      repositoryRoot,
    )).not.toThrow();
  });

  it('keeps generated evidence output out of accidental git staging', () => {
    const ignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(ignore).toMatch(/^\/output\/$/m);
  });
});
