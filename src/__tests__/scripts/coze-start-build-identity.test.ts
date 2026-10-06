import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
let fixture: string;
interface ScriptResult {
  exitCode: number | null;
  output: string;
}

interface ScriptRun {
  completion: Promise<ScriptResult>;
  waitForOutput: (message: string) => Promise<void>;
}

const ownedChildren = new Map<ChildProcessWithoutNullStreams, Promise<ScriptResult>>();

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 5_000 }).trim();
}

function runStart(): string {
  return execFileSync(
    bash,
    ['-c', 'PATH="$PWD/fake-bin:$PATH" exec bash scripts/coze-start.sh'],
    { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 10_000 },
  );
}

function runScript(script: string): ScriptRun {
  let output = '';
  let closed = false;
  let spawnError: Error | undefined;
  const child = spawn(
      bash,
      ['-c', `PATH="$PWD/fake-bin:$PATH" exec bash scripts/${script}`],
      {
        cwd: fixture,
        windowsHide: true,
        env: { ...process.env, DATABASE_URL: '', PGDATABASE_URL: '' },
      },
    );
  const completion = new Promise<ScriptResult>((resolveRun, rejectRun) => {
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', (error: Error) => {
      spawnError = error;
      rejectRun(error);
    });
    child.on('close', (exitCode) => {
      closed = true;
      ownedChildren.delete(child);
      resolveRun({ exitCode, output });
    });
  });
  // Keep errors observable by the test/cleanup without an unhandled rejection
  // while the test is still waiting for a synchronization message.
  void completion.catch(() => undefined);
  ownedChildren.set(child, completion);
  return {
    completion,
    waitForOutput: async (message: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!output.includes(message)) {
        if (spawnError) throw new Error(`Script failed before ${message}: ${output}`, { cause: spawnError });
        if (closed) throw new Error(`Script closed before ${message}: ${output}`, { cause: spawnError });
        if (Date.now() >= deadline) throw new Error(`Script did not reach ${message}: ${output}`);
        await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
      }
    },
  };
}

// Real Bash/Git process startup can exceed five seconds on Windows; lock
// contention also includes the production script's real five-second sleep.
// This local integration budget matches the two existing contention cases and
// does not change the production wait loop or the global Vitest configuration.
describe('Coze startup build identity', { timeout: 15_000 }, () => {
  beforeEach(() => {
    expect(ownedChildren.size).toBe(0);
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

  afterEach(async () => {
    const cleanupErrors: unknown[] = [];
    for (const [child, completion] of ownedChildren) {
      if (child.pid && child.exitCode === null) {
        try {
          if (process.platform === 'win32') {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true, timeout: 2_000, stdio: 'pipe',
            });
          } else {
            child.kill('SIGTERM');
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Owned script did not close before fixture cleanup')), 2_000);
          }),
        ]);
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        clearTimeout(timer);
      }
    }
    if (ownedChildren.size > 0) {
      throw new AggregateError(cleanupErrors, 'Refusing to remove a fixture still used by an owned script');
    }
    try {
      rmSync(fixture, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Owned script cleanup failed');
  });

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
    await preview.waitForOutput('Another build holds the Next lock; waiting...');
    expect(existsSync(join(fixture, '.next', 'lock'))).toBe(true);
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);
    unlinkSync(join(fixture, '.next', 'lock'));
    const result = await preview.completion;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Build completed successfully.');
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  });

  it('waits for a locked concurrent build instead of deleting its lock', async () => {
    const expectedTree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), 'old-build-id\n');
    writeFileSync(join(fixture, '.next', 'lock'), 'building\n');

    const startup = runScript('coze-start.sh');
    await startup.waitForOutput('Build lock detected, waiting...');
    expect(existsSync(join(fixture, '.next', 'lock'))).toBe(true);
    writeFileSync(join(fixture, '.next', 'BUILD_ID'), `${expectedTree}\n`);
    writeFileSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'), `${expectedTree}\n`);
    if (existsSync(join(fixture, '.next', 'lock'))) unlinkSync(join(fixture, '.next', 'lock'));
    const result = await startup.completion;

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
    await startup.waitForOutput('Build lock detected, waiting...');
    expect(existsSync(join(fixture, '.next', 'lock'))).toBe(true);
    if (existsSync(join(fixture, '.next', 'lock'))) unlinkSync(join(fixture, '.next', 'lock'));
    const result = await startup.completion;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`started:${expectedTree}`);
    expect(result.output).not.toContain('started during build');
    expect(existsSync(join(fixture, 'events.log'))).toBe(false);
  }, 15_000);
});
