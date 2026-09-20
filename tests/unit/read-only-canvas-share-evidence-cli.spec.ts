import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const initScript = resolve(process.cwd(), 'scripts', 'init-read-only-canvas-share-evidence.ts');
const finalizeScript = resolve(process.cwd(), 'scripts', 'finalize-read-only-canvas-share-evidence.ts');
const tsxImport = pathToFileURL(resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createRepository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'task7-cli-repo-'));
  temporaryRoots.push(root);
  const runGit = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  expect(runGit(['init', '-q']).status).toBe(0);
  runGit(['config', 'user.email', 'task7@example.invalid']);
  runGit(['config', 'user.name', 'Task 7 Test']);
  await writeFile(join(root, '.gitignore'), 'output/\n', 'utf8');
  runGit(['add', '.gitignore']);
  expect(runGit(['commit', '-qm', 'fixture']).status).toBe(0);
  return { root, head: runGit(['rev-parse', 'HEAD']).stdout.trim().toLowerCase() };
}

function run(script: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, ['--import', tsxImport, script, ...args], { cwd, encoding: 'utf8' });
}

describe('Task 7 evidence CLI guards and strict parsing', () => {
  it.each([initScript, finalizeScript])('does not execute %s when imported', script => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--eval', `import(${JSON.stringify(pathToFileURL(script).href)})`],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 0, stdout: '', stderr: '' });
  });

  it.each([
    ['initializer duplicate', initScript, ['--run-id', 'x', '--run-id', 'y', '--commit', 'a'.repeat(40)], /Duplicate option: --run-id/u],
    ['initializer unknown', initScript, ['--run-id', 'x', '--commit', 'a'.repeat(40), '--root', 'elsewhere'], /Unknown option: --root/u],
    ['initializer positional', initScript, ['positional', '--run-id', 'x', '--commit', 'a'.repeat(40)], /Unexpected positional argument/u],
    ['initializer missing value', initScript, ['--run-id', '--commit', 'a'.repeat(40)], /Missing value for option: --run-id/u],
    ['initializer missing required', initScript, ['--run-id', 'x'], /Missing required option: --commit/u],
    ['finalizer duplicate', finalizeScript, ['--run-id', 'x', '--commit', 'a'.repeat(40), '--nonce', 'b'.repeat(64), '--nonce', 'c'.repeat(64)], /Duplicate option: --nonce/u],
    ['finalizer unknown', finalizeScript, ['--run-id', 'x', '--commit', 'a'.repeat(40), '--nonce', 'b'.repeat(64), '--extra', 'x'], /Unknown option: --extra/u],
    ['finalizer positional', finalizeScript, ['x', '--run-id', 'x', '--commit', 'a'.repeat(40), '--nonce', 'b'.repeat(64)], /Unexpected positional argument/u],
    ['finalizer option value', finalizeScript, ['--run-id', 'x', '--commit', '--nonce', 'b'.repeat(64)], /Missing value for option: --commit/u],
    ['finalizer missing required', finalizeScript, ['--run-id', 'x', '--commit', 'a'.repeat(40)], /Missing required option: --nonce/u],
  ])('rejects %s without evidence side effects', async (_label, script, args, expectedError) => {
    const repository = await createRepository();
    const result = run(script, args, repository.root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(expectedError);
    await expect(readFile(join(repository.root, 'output', 'playwright', 'read-only-canvas-share-evidence', 'staging')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
