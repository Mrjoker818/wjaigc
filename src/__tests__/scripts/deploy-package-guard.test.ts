import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const verifier = resolve('scripts/verify-deploy-package.mjs');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const syntheticValue = 'synthetic-credential-value';
const runtimeEnv = {
  PGDATABASE_URL: 'postgres://synthetic.invalid/db',
  WUJIE_BOOTSTRAP_PROVIDERS_JSON: syntheticValue,
  WUJIE_ADMIN_PASSWORD: syntheticValue,
};
const tempRoot = realpathSync(tmpdir());
let fixture: string;
type FixtureEnv = Partial<NodeJS.ProcessEnv>;

function writeFixture(relativePath: string, content: string) {
  const target = join(fixture, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function writeExecutable(file: string, lines: string[]) {
  chmodSync(writeFixture(file, ['#!/usr/bin/env bash', ...lines, ''].join('\n')), 0o755);
}

function run(command: string, args: string[], env: FixtureEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: fixture,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env, NODE_ENV: env.NODE_ENV ?? 'test' },
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function runCoze(script: string, args: string[] = [], env: FixtureEnv = runtimeEnv) {
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  copyFileSync(resolve('scripts', script), join(fixture, 'scripts', script));
  copyFileSync(verifier, join(fixture, 'scripts/verify-deploy-package.mjs'));
  return run(bash, [
    '-c', 'PATH="$PWD/fake-bin:$PATH" exec bash "$@"', 'coze-test', `scripts/${script}`, ...args,
  ], env);
}

function writeTrace(file: string, files: string[] = []) {
  writeFixture(file, JSON.stringify({ version: 1, files }));
}

describe('deployment package guard', () => {
  beforeEach(() => {
    fixture = mkdtempSync(join(tempRoot, 'wujie-deploy-package-'));
  });

  afterEach(() => {
    expect(dirname(realpathSync(fixture))).toBe(tempRoot);
    rmSync(fixture, { recursive: true });
  });

  it.each([
    'deploy-seed/system/api-providers.json',
    'deploy-seed/system/users.json',
    'scripts/export-deploy-seed.mjs',
    'data/system/api-providers.json',
    'data/system/users.json',
    'data/system/auth-secret',
  ])('blocks the retired source path %s', (file) => {
    writeFixture(file, syntheticValue);

    const result = run(process.execPath, [verifier, '--source']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(file);
    expect(result.output).not.toContain(syntheticValue);
  });

  it.each([
    ['.next/next-server.js.nft.json', '../deploy-seed/system/api-providers.json', 'deploy-seed/system/api-providers.json'],
    ['.next/server/instrumentation.js.nft.json', '..\\..\\deploy-seed\\system\\.\\users.json', 'deploy-seed/system/users.json'],
    ['.next/next-minimal-server.js.nft.json', '../data/system/auth-secret', 'data/system/auth-secret'],
    ['.next/server/instrumentation.js.nft.json', '../../data/system/api-providers.json', 'data/system/api-providers.json'],
  ])('blocks a legacy reference in %s even when the source file is absent', (manifest, reference, file) => {
    writeTrace(manifest, [reference]);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(manifest);
    expect(result.output).toContain(file);
  });

  it.each([
    '.next/standalone/app/deploy-seed/system/users.json',
    'public/deploy-seed/system/api-providers.json',
    '.next/standalone/app/data/system/users.json',
    'public/data/system/auth-secret',
  ])('blocks a copied file at %s even when every trace is clean', (file) => {
    writeTrace('.next/next-server.js.nft.json');
    writeFixture(file, syntheticValue);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(file);
    expect(result.output).not.toContain(syntheticValue);
  });

  it('reports an invalid NFT manifest without echoing its contents', () => {
    const manifest = '.next/next-server.js.nft.json';
    writeFixture(manifest, `{"files":[${syntheticValue}]}`);

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain(manifest);
    expect(result.output).not.toContain(syntheticValue);
  });

  it('rejects build output with no manifests to verify', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');

    const result = run(process.execPath, [verifier, '--built']);

    expect(result.status).toBe(1);
    expect(result.output).toContain('No NFT manifests');
  });

  it('accepts a clean package with unrelated system file names', () => {
    mkdirSync(join(fixture, 'deploy-seed/system'), { recursive: true });
    writeTrace('.next/next-server.js.nft.json', ['server/system/users.json', 'server/data/system/settings.json']);
    writeFixture('.next/server/system/users.json', '{}');
    writeFixture('.next/server/data/system/settings.json', '{}');

    expect(run(process.execPath, [verifier, '--source']).status).toBe(0);
    expect(run(process.execPath, [verifier, '--built']).status).toBe(0);
  });

  it('prunes the three generated credential paths while retaining neighboring files', () => {
    const manifest = '.next/server/instrumentation.js.nft.json';
    const retained = ['../../data/system/auth-secret.backup', '../../data/system/settings.json'];
    writeTrace(manifest, [
      '../../data/system/users.json',
      '../../data/system/api-providers.json',
      '../../data/system/auth-secret',
      ...retained,
    ]);

    const result = run(process.execPath, [resolve('scripts/prune-build-traces.mjs')]);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(fixture, manifest), 'utf8')).files).toEqual(retained);
  });

  it('fails the Coze deployment build if compilation produces a legacy NFT reference', () => {
    writeExecutable('fake-bin/pnpm', [
      'if [[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON || -v WUJIE_ADMIN_PASSWORD ]]; then exit 8; fi',
      'if [ "$*" = "install --frozen-lockfile" ]; then echo synthetic-install; exit 0; fi',
      'if [ "$*" = "run migrate" ] && [[ -v PGDATABASE_URL ]]; then echo synthetic-migrate; exit 0; fi',
      'if [ "$*" != "run build" ]; then exit 2; fi',
      'mkdir -p .next',
      `printf '%s\\n' '{"version":1,"files":["../deploy-seed/system/users.json"]}' > .next/next-server.js.nft.json`,
      'echo synthetic-build-completed',
    ]);

    const result = runCoze('coze-deploy-build.sh');

    expect(result.output).toMatch(/synthetic-install[\s\S]+synthetic-migrate[\s\S]+synthetic-build-completed/);
    expect(result.status).toBe(1);
    expect(result.output).toContain('.next/next-server.js.nft.json');
    expect(result.output).toContain('deploy-seed/system/users.json');
  }, 15_000);

  it('starts a packaged deployment without NFT manifests', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', [
      '[ "${WUJIE_DEPLOYMENT_DB_ONLY:-}" = "1" ] || exit 3',
      '[ "${WUJIE_AUTH_PERSISTENCE_MODE:-}" = "DB_ONLY" ] || exit 4',
      '[[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON && -v WUJIE_ADMIN_PASSWORD ]] || exit 5',
      'echo synthetic-runtime-started',
    ]);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.status).toBe(0);
    expect(result.output).toContain('synthetic-runtime-started');
  }, 15_000);

  it('blocks a packaged deployment with a generated credential replica at its source path', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeFixture('data/system/auth-secret', syntheticValue);
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', ['echo synthetic-runtime-started']);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.status).toBe(1);
    expect(result.output).toContain('data/system/auth-secret');
    expect(result.output).not.toContain(syntheticValue);
    expect(result.output).not.toContain('synthetic-runtime-started');
  }, 15_000);

  it('requires a DB URL for deploy while allowing preview without one', () => {
    writeFixture('.next/BUILD_ID', 'synthetic-build');
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('node_modules/.bin/next', [
      'if [[ -v WUJIE_DEPLOYMENT_DB_ONLY || -v WUJIE_AUTH_PERSISTENCE_MODE ]]; then exit 3; fi',
      'echo synthetic-preview-started',
    ]);

    const deployment = runCoze('coze-start.sh', ['--deployment'], {});
    const preview = runCoze('coze-start.sh', [], {});

    expect(deployment.status).toBe(1);
    expect(deployment.output).toContain('requires DATABASE_URL or PGDATABASE_URL');
    expect(deployment.output).not.toContain('synthetic-preview-started');
    expect(preview.status).toBe(0);
    expect(preview.output).toContain('synthetic-preview-started');
  }, 15_000);

  it('requires verified NFT manifests immediately after a deployment fallback build', () => {
    writeExecutable('fake-bin/git', ['exit 1']);
    writeExecutable('fake-bin/next', ['echo synthetic-runtime-started']);
    writeExecutable('fake-bin/pnpm', [
      'if [[ -v WUJIE_BOOTSTRAP_PROVIDERS_JSON || -v WUJIE_ADMIN_PASSWORD ]]; then exit 8; fi',
      'if [ "$*" = "install --frozen-lockfile" ]; then',
      '  mkdir -p node_modules/.bin',
      '  cp fake-bin/next node_modules/.bin/next',
      '  echo synthetic-install',
      '  exit 0',
      'fi',
      'if [ "$*" != "run build" ]; then exit 2; fi',
      'mkdir -p .next',
      'echo synthetic-build > .next/BUILD_ID',
      'echo synthetic-build-completed',
    ]);

    const result = runCoze('coze-start.sh', ['--deployment']);

    expect(result.output).toMatch(/synthetic-install[\s\S]+synthetic-build-completed/);
    expect(result.status).toBe(1);
    expect(result.output).toContain('No NFT manifests found under .next');
    expect(result.output).not.toContain('synthetic-runtime-started');
  }, 15_000);
});
