import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const requiredTargets = [
  'src/app/api/annotations/execute/route.ts',
  'src/app/api/annotations/resolve-target/route.ts',
  'src/features/annotations/annotation-types.ts',
  'src/features/annotations/annotation-bundle.ts',
  'src/features/annotations/annotation-composer.tsx',
  'src/features/annotations/annotation-overlay.tsx',
  'src/features/annotations/node-annotation-workspace.tsx',
  'src/features/annotations/use-annotation-controller.ts',
  'src/lib/annotation-mask.ts',
  'src/lib/annotation-provider-adapter.ts',
  'tests/e2e/annotation-core.spec.ts',
] as const;

interface ManifestEntry {
  targetPath: string;
  size: number;
  sha256: string;
  hashMode: 'text-lf' | 'binary';
  installedSha256: string;
  operation: 'add' | 'replace';
  expectedBaseSha256?: string;
}

interface Fixture {
  root: string;
  packageRoot: string;
  targetRoot: string;
  manifestPath: string;
  entries: ManifestEntry[];
}

const temporaryRoots: string[] = [];
const verifierPath = resolve(process.cwd(), 'scripts/verify-annotation-upgrade.mjs');

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function write(relativeRoot: string, relativePath: string, content: string | Buffer): void {
  const absolute = join(relativeRoot, ...relativePath.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function writeManifest(fixture: Fixture): void {
  writeFileSync(
    fixture.manifestPath,
    `${JSON.stringify({
      schemaVersion: 2,
      packageId: 'annotation-verifier-test',
      baseCommit: 'base-commit',
      sourceCommit: 'source-commit',
      fileCount: fixture.entries.length,
      files: fixture.entries,
    }, null, 2)}\n`,
    'utf8',
  );
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'annotation-upgrade-verifier-'));
  temporaryRoots.push(root);
  const packageRoot = join(root, 'package');
  const targetRoot = join(root, 'target');
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(targetRoot, { recursive: true });

  const entries = requiredTargets.map<ManifestEntry>((targetPath, index) => {
    const payload = `payload:${targetPath}\n`;
    write(join(packageRoot, 'payload'), targetPath, payload);

    if (index === 0) {
      const base = `base:${targetPath}\n`;
      write(targetRoot, targetPath, base);
      return {
        targetPath,
        size: Buffer.byteLength(payload),
        sha256: sha256(payload),
        hashMode: 'text-lf',
        installedSha256: sha256(payload),
        operation: 'replace',
        expectedBaseSha256: sha256(base),
      };
    }

    return {
      targetPath,
      size: Buffer.byteLength(payload),
      sha256: sha256(payload),
      hashMode: 'text-lf',
      installedSha256: sha256(payload),
      operation: 'add',
    };
  });

  const fixture: Fixture = {
    root,
    packageRoot,
    targetRoot,
    manifestPath: join(packageRoot, 'MANIFEST.json'),
    entries,
  };
  writeManifest(fixture);
  return fixture;
}

function runVerifier(fixture: Fixture, includeTarget = true) {
  const args = [verifierPath, '--package', fixture.packageRoot];
  if (includeTarget) args.push('--target', fixture.targetRoot);
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('annotation upgrade package verifier', () => {
  test('requires the r4 execution, cancellation, database and image-safety boundary', () => {
    const source = readFileSync(verifierPath, 'utf8');

    for (const required of [
      'src/app/api/cancel-task/route.ts',
      'src/app/api/edit/route.ts',
      'src/app/api/poll-task/route.ts',
      'src/lib/cloud-task-storage.ts',
      'src/lib/edit-task-store.ts',
      'src/lib/safe-image-download.ts',
      'src/lib/safe-image-input.ts',
      'src/lib/task-registry.ts',
    ]) {
      expect(source).toContain(`'${required}'`);
    }
    expect(source).toContain("endsWith('-r4')");
    expect(source).toContain('r4 升级包必须包含可验证的 SOURCE_COMMIT.bundle');
  });

  test('accepts the expected base and an already-applied target', () => {
    const fixture = createFixture();
    const preflight = runVerifier(fixture);
    expect(preflight.status, preflight.stderr).toBe(0);
    expect(preflight.stdout).toContain('target-ready');

    for (const entry of fixture.entries) {
      const payload = readFileSync(join(fixture.packageRoot, 'payload', ...entry.targetPath.split('/')));
      write(fixture.targetRoot, entry.targetPath, payload);
    }

    const repeated = runVerifier(fixture);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.stdout).toContain('already-applied');
  });

  test('rejects a replacement when the target has drifted from the expected base', () => {
    const fixture = createFixture();
    write(fixture.targetRoot, fixture.entries[0].targetPath, 'unexpected target content');

    const result = runVerifier(fixture);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('安装前哈希不匹配');
  });

  test('rejects an add operation that would overwrite different existing content', () => {
    const fixture = createFixture();
    const addEntry = fixture.entries.find((entry) => entry.operation === 'add');
    expect(addEntry).toBeDefined();
    write(fixture.targetRoot, addEntry!.targetPath, 'existing unrelated content');

    const result = runVerifier(fixture);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('新增文件已存在且内容不同');
  });

  test('requires an expected base hash for every replacement', () => {
    const fixture = createFixture();
    delete fixture.entries[0].expectedBaseSha256;
    writeManifest(fixture);

    const result = runVerifier(fixture, false);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('expectedBaseSha256');
  });

  test('accepts CRLF checkout content when the manifest uses normalized LF hashes', () => {
    const fixture = createFixture();
    const targetPath = fixture.entries[0].targetPath;
    const baseContent = readFileSync(join(fixture.targetRoot, ...targetPath.split('/')), 'utf8');
    write(fixture.targetRoot, targetPath, baseContent.replaceAll('\n', '\r\n'));

    const result = runVerifier(fixture);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('target-ready');
  });
});
