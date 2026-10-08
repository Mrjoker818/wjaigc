import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { resolvePresenceLaunch } from '../../../scripts/presence-server';

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
printf 'PRESENCE_NODE_ENV=%s\\n' "$NODE_ENV"
printf 'LAUNCHED_PUBLIC_ORIGIN=%s\\n' "\${COZE_PROJECT_DOMAIN_DEFAULT:-}"
printf 'PRESENCE_CALLED\n'
printf '%s\\n' "$@"
`);
  chmodSync(join(directory, 'fake-bin', 'node'), 0o755);
  for (const [name, output] of [['next', 'NEXT_CALLED']]) {
    const executable = join(directory, 'node_modules', '.bin', name);
    writeFileSync(executable, `#!/usr/bin/env bash\nprintf 'LAUNCHED_PUBLIC_ORIGIN=%s\\n' "\${COZE_PROJECT_DOMAIN_DEFAULT:-}"\nprintf '${output}\\n'\n`);
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
  it.each([undefined, 'development', 'production'] as const)('uses the sealed production build when inherited NODE_ENV=%s', (nodeEnv) => {
    const directory = createStartupFixture();
    const environment = {
      ...process.env,
      WUJIE_PRESENCE_ENABLED: 'true',
      WUJIE_YJS_ENABLED: 'true',
    };
    if (nodeEnv === undefined) Reflect.deleteProperty(environment, 'NODE_ENV');
    else environment.NODE_ENV = nodeEnv;
    const stdout = execFileSync(shellPath(), [
      '-c', `PATH="$PWD/fake-bin:$PATH" exec bash "${resolve(process.cwd(), 'scripts/coze-start.sh').replaceAll('\\', '/')}"`,
    ], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    const launchedNodeEnv = stdout.match(/^PRESENCE_NODE_ENV=(.*)$/m)?.[1];
    const nodeArguments = stdout.split('PRESENCE_CALLED\n')[1].trim().split(/\r?\n/);
    expect(resolvePresenceLaunch(nodeArguments.slice(nodeArguments.indexOf(presenceEntry) + 1), {
      NODE_ENV: launchedNodeEnv,
      WUJIE_PRESENCE_ENABLED: 'true',
      WUJIE_YJS_ENABLED: 'true',
    })).toEqual({ enabled: true, dev: false });
    expect(launchedNodeEnv).toBe('production');
    expectNextRuntimeReady(nodeArguments);
  });

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

describe('Coze explicit preview origin startup configuration', () => {
  const platformOrigin = 'https://example.dev.coze.site';
  const previewOrigin = 'https://example-5000.dev.coze.site';

  describe.each(['true', 'false'])('with collaboration enabled=%s', (collaborationEnabled) => {
    it.each([
      ['DEV', previewOrigin, previewOrigin],
      ['DEV', '', platformOrigin],
      ['DEV', undefined, platformOrigin],
      ['PROD', previewOrigin, platformOrigin],
      [undefined, previewOrigin, platformOrigin],
      ['development', previewOrigin, platformOrigin],
    ] as const)('launches with the expected exact origin for environment=%s, preview override=%s', (projectEnv, override, expectedOrigin) => {
      const directory = createStartupFixture();
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        WUJIE_PRESENCE_ENABLED: collaborationEnabled,
        WUJIE_YJS_ENABLED: collaborationEnabled,
        COZE_PROJECT_DOMAIN_DEFAULT: platformOrigin,
      };
      if (projectEnv === undefined) Reflect.deleteProperty(environment, 'COZE_PROJECT_ENV');
      else environment.COZE_PROJECT_ENV = projectEnv;
      if (override === undefined) Reflect.deleteProperty(environment, 'WUJIE_PREVIEW_ORIGIN');
      else environment.WUJIE_PREVIEW_ORIGIN = override;

      const stdout = execFileSync(shellPath(), [
        '-c', `PATH="$PWD/fake-bin:$PATH" exec bash "${resolve(process.cwd(), 'scripts/coze-start.sh').replaceAll('\\', '/')}"`,
      ], {
        cwd: directory,
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      });

      expect(stdout.match(/^LAUNCHED_PUBLIC_ORIGIN=(.*)$/m)?.[1]).toBe(expectedOrigin);
      expect(stdout).toContain(collaborationEnabled === 'true' ? 'PRESENCE_CALLED' : 'NEXT_CALLED');
    });
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
