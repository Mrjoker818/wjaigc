import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Task 7 evidence CLI module guards', () => {
  it('does not execute the finalizer when the module is imported', () => {
    const script = resolve(process.cwd(), 'scripts', 'finalize-read-only-canvas-share-evidence.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--eval', `import(${JSON.stringify(pathToFileURL(script).href)})`],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('does not execute the initializer when the module is imported', () => {
    const script = resolve(process.cwd(), 'scripts', 'init-read-only-canvas-share-evidence.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--eval', `import(${JSON.stringify(pathToFileURL(script).href)})`],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });
});
