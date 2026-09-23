import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
let fixture: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: fixture, encoding: 'utf8', windowsHide: true }).trim();
}

function runStart(): string {
  return execFileSync(
    bash,
    ['-c', 'PATH="$PWD/fake-bin:$PATH" exec bash scripts/coze-start.sh'],
    { cwd: fixture, encoding: 'utf8', windowsHide: true },
  );
}

function runScript(script: string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      bash,
      ['-c', `PATH="$PWD/fake-bin:$PATH" exec bash scripts/${script}`],
      {
        cwd: fixture,
        windowsHide: true,
        env: { ...process.env, DATABASE_URL: '', PGDATABASE_URL: '' },
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', rejectRun);
    child.on('close', (exitCode) => resolveRun({ exitCode, output }));
  });
}

describe('Coze startup build identity', () => {
  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'wujie-coze-build-'));
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, '.next'));
    mkdirSync(join(fixture, 'fake-bin'));
    mkdirSync(join(fixture, 'node_modules', '.bin'), { recursive: true });
    copyFileSync(resolve(process.cwd(), 'scripts/coze-start.sh'), join(fixture, 'scripts', 'coze-start.sh'));
    copyFileSync(resolve(process.cwd(), 'scripts/coze-preview-build.sh'), join(fixture, 'scripts', 'coze-preview-build.sh'));
    const helper = resolve(process.cwd(), 'scripts/coze-build-source.sh');
    if (existsSync(helper)) copyFileSync(helper, join(fixture, 'scripts', 'coze-build-source.sh'));
    writeFileSync(join(fixture, '.gitignore'), '.next/\ndist/\nnode_modules/\nfake-bin/\nevents.log\n');
    writeFileSync(join(fixture, 'source.txt'), 'source version one\n');
    writeFileSync(join(fixture, 'fake-bin', 'pnpm'), '#!/usr/bin/env bash\nif [ "$*" = "install --frozen-lockfile" ]; then exit 0; fi\nif [ "$*" = "run build" ]; then\n  if [ -f .next/lock ]; then echo "Another next build process is already running" >&2; exit 1; fi\n  git rev-parse "HEAD^{tree}" > .next/BUILD_ID\n  cp .next/BUILD_ID .next/WUJIE_BUILD_COMPLETE\n  echo build >> events.log\n  exit 0\nfi\nexit 1\n');
    writeFileSync(join(fixture, 'node_modules', '.bin', 'next'), '#!/usr/bin/env bash\nif [ -f .next/lock ]; then echo "started during build" >&2; exit 1; fi\necho "started:$(cat .next/BUILD_ID)"\n');
    chmodSync(join(fixture, 'fake-bin', 'pnpm'), 0o755);
    chmodSync(join(fixture, 'node_modules', '.bin', 'next'), 0o755);
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    git('add', '.gitignore', 'source.txt', 'scripts/coze-start.sh', 'scripts/coze-preview-build.sh');
    git('-c', 'user.name=Build Test', '-c', 'user.email=build-test@example.invalid', 'commit', '-qm', 'initial');
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it('rebuilds before starting when an existing Next build belongs to an older source tree', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), 'old-build-id\n');

    expect(runStart()).toContain(`started:${expectedTree}`);
    expect(readFileSync(join(fixture, 'events.log'), 'utf8')).toBe('build\n');
  });

  it('starts a build whose ID matches the clean source tree without rebuilding', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);

    expect(runStart()).toContain(`started:${expectedTree}`);
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  });

  it('restores a matching packaged dist artifact when the local Next directory is missing', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    mkdirSync(join(fixture, 'dist'));
    writeFileSync(join(fixture, 'dist', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, 'dist', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);

    expect(runStart()).toContain(`started:${expectedTree}`);
    expect(readFileSync(join(fixture, '.next', 'BUILD_ID'), 'utf8').trim()).toBe(expectedTree);
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  });

  it('retains the packaged runtime path when Git metadata is absent', () => {
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), 'packaged-build\n');
    rmSync(join(fixture, '.git'), { recursive: true, force: true });

    expect(runStart()).toContain('started:packaged-build');
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  });

  it('does not start a partial build that has a matching ID but no completion marker', () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);

    expect(runStart()).toContain(`started:${expectedTree}`);
    expect(existsSync(join(fixture, 'events.log'))).toBe(true);
    expect(readFileSync(join(fixture, 'events.log'), 'utf8')).toBe('build\n');
    expect(readFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), 'utf8').trim()).toBe(expectedTree);
  });

  it('waits for a concurrent preview build and reuses its matching artifact', async () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'lock'), 'building\n');

    const preview = runScript('coze-preview-build.sh');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 500));
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);
    unlinkSync(join(fixture, '.next', 'lock'));
    const result = await preview;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Build completed successfully.');
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  });

  it('waits for a locked concurrent build instead of deleting its lock', async () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), 'old-build-id\n');
    writeFileSync(join(fixture, '.next', 'lock'), 'building\n');

    const startup = runScript('coze-start.sh');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2500));
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);
    if (existsSync(join(fixture, '.next', 'lock'))) unlinkSync(join(fixture, '.next', 'lock'));
    const result = await startup;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`started:${expectedTree}`);
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  }, 15_000);

  it('does not start a matching artifact while Next still holds its build lock', async () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'lock'), 'building\n');

    const startup = runScript('coze-start.sh');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2500));
    if (existsSync(join(fixture, '.next', 'lock'))) unlinkSync(join(fixture, '.next', 'lock'));
    const result = await startup;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`started:${expectedTree}`);
    expect(result.output).not.toContain('started during build');
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  }, 15_000);
});
