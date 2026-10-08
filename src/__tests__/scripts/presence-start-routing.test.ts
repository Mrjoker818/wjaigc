import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const presenceEntry = 'scripts/presence-server.ts';
const bootstrapProbe = `
const { createAsyncLocalStorage } = await import('next/dist/server/app-render/async-local-storage.js');
const storage = createAsyncLocalStorage();
storage.run('presence-bootstrap', () => {
  if (storage.getStore() !== 'presence-bootstrap') throw new Error('AsyncLocalStorage context was lost');
  console.log('NEXT_ASYNC_LOCAL_STORAGE_READY');
});
`;

function probeNextRuntime(nodeFlags: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    ...nodeFlags, '--input-type=module', '-e', bootstrapProbe,
  ], {
    cwd: process.cwd(),
    // A parent NODE_OPTIONS preload must not hide a broken shipped entry point.
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
}

function expectNextRuntimeReady(nodeArguments: string[]): void {
  const entryIndex = nodeArguments.indexOf(presenceEntry);
  expect(entryIndex).toBeGreaterThan(0);
  expect(nodeArguments.slice(entryIndex + 1)).toEqual(
    nodeArguments.at(-1) === '--dev' ? ['--dev'] : [],
  );
  const result = probeNextRuntime(nodeArguments.slice(0, entryIndex));
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('NEXT_ASYNC_LOCAL_STORAGE_READY');
}

function shellPath(): string {
  return process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
}

function createStartupFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'wujie-presence-start-'));
  tempDirs.push(directory);
  mkdirSync(join(directory, '.next'));
  mkdirSync(join(directory, 'fake-bin'));
  mkdirSync(join(directory, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(directory, '.next', 'BUILD_ID'), 'test-build-id');
  writeFileSync(join(directory, 'fake-bin', 'node'), `#!/usr/bin/env bash
printf 'PRESENCE_CALLED\n'
printf '%s\\n' "$@"
`);
  chmodSync(join(directory, 'fake-bin', 'node'), 0o755);
  for (const [name, output] of [['next', 'NEXT_CALLED']]) {
    const executable = join(directory, 'node_modules', '.bin', name);
    writeFileSync(executable, `#!/usr/bin/env bash\nprintf '${output}\\n'\n`);
    chmodSync(executable, 0o755);
  }
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Coze presence startup routing', () => {
  it.each([
    [undefined, undefined, 'NEXT_CALLED'],
    ['false', 'false', 'NEXT_CALLED'],
    ['true', undefined, 'PRESENCE_CALLED'],
    ['false', 'true', 'PRESENCE_CALLED'],
    ['true', 'true', 'PRESENCE_CALLED'],
  ])('starts the expected server when presence=%s and Yjs=%s', (presenceFlag, yjsFlag, expected) => {
    const directory = createStartupFixture();
    const stdout = execFileSync(shellPath(), [
      '-c', `PATH="$PWD/fake-bin:$PATH" exec bash "${resolve(process.cwd(), 'scripts/coze-start.sh').replaceAll('\\', '/')}"`,
    ], {
      cwd: directory,
      env: {
        ...process.env,
        WUJIE_PRESENCE_ENABLED: presenceFlag,
        WUJIE_YJS_ENABLED: yjsFlag,
      },
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    expect(stdout).toContain(expected);
    expect(stdout).not.toContain(expected === 'NEXT_CALLED' ? 'PRESENCE_CALLED' : 'NEXT_CALLED');
    if (expected === 'PRESENCE_CALLED') {
      // Run the arguments emitted by the real Coze shell branch against real
      // Next storage, replacing only the long-running server with a pure probe.
      const nodeArguments = stdout.split('PRESENCE_CALLED\n')[1].trim().split(/\r?\n/);
      expectNextRuntimeReady(nodeArguments);
    }
  });
});

describe('Presence package entry runtime bootstrap', () => {
  it.each(['start:presence', 'dev:presence'])('initializes Next storage before %s imports server modules', (scriptName) => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const [executable, ...nodeArguments] = packageJson.scripts[scriptName].split(' ');
    expect(executable).toBe('node');
    expectNextRuntimeReady(nodeArguments);
  });

  it('exposes the original import-order failure without a framework preload', () => {
    const result = probeNextRuntime(['--conditions=react-server', '--import', 'tsx']);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AsyncLocalStorage accessed in runtime where it is not available');
    expect(result.stdout).not.toContain('NEXT_ASYNC_LOCAL_STORAGE_READY');
  });
});
