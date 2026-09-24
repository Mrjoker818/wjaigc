import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

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
if [ "$*" != "--conditions=react-server --import tsx scripts/presence-server.ts" ]; then exit 1; fi
printf 'PRESENCE_CALLED\n'
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
    [undefined, 'NEXT_CALLED'],
    ['false', 'NEXT_CALLED'],
    ['true', 'PRESENCE_CALLED'],
  ])('starts the expected server when flag is %s', (flag, expected) => {
    const directory = createStartupFixture();
    const stdout = execFileSync(shellPath(), [
      '-c', `PATH="$PWD/fake-bin:$PATH" exec bash "${resolve(process.cwd(), 'scripts/coze-start.sh').replaceAll('\\', '/')}"`,
    ], {
      cwd: directory,
      env: {
        ...process.env,
        WUJIE_PRESENCE_ENABLED: flag,
      },
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    expect(stdout).toContain(expected);
    expect(stdout).not.toContain(expected === 'NEXT_CALLED' ? 'PRESENCE_CALLED' : 'NEXT_CALLED');
  });
});
