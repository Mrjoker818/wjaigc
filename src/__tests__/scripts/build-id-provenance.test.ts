import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nextConfig, * as buildConfig from '../../../next.config';

const resolveBuildId = (buildConfig as unknown as {
  resolveBuildId?: (directory: string) => string;
}).resolveBuildId;

let repository: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
}

describe('Next build source identity', () => {
  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), 'wujie-build-id-'));
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    writeFileSync(join(repository, 'source.txt'), 'version one\n');
    git('add', 'source.txt');
    git('-c', 'user.name=Build Test', '-c', 'user.email=build-test@example.invalid', 'commit', '-qm', 'initial');
  });

  afterEach(() => rmSync(repository, { recursive: true, force: true }));

  it('records the exact committed tree for a clean checkout', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    expect(resolveBuildId?.(repository)).toBe(expectedTree);
  });

  it('does not claim the committed tree after a tracked source change', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(repository, 'source.txt'), 'version two\n');

    const buildId = resolveBuildId?.(repository);
    expect(buildId).toMatch(/^unverified-[0-9a-f]{32}$/);
    expect(buildId).not.toBe(expectedTree);
  });

  it('does not claim the committed tree with an untracked source file', () => {
    writeFileSync(join(repository, 'new-source.ts'), 'export const version = 2;\n');
    expect(resolveBuildId?.(repository)).toMatch(/^unverified-[0-9a-f]{32}$/);
  });

  it('does not claim a tree without Git metadata', () => {
    const outsideRepository = mkdtempSync(join(tmpdir(), 'wujie-no-git-'));
    try {
      expect(resolveBuildId?.(outsideRepository)).toMatch(/^unverified-[0-9a-f]{32}$/);
    } finally {
      rmSync(outsideRepository, { recursive: true, force: true });
    }
  });

  it('uses source identity for the production Next build', () => {
    expect(nextConfig.generateBuildId).toBeTypeOf('function');
  });
});
