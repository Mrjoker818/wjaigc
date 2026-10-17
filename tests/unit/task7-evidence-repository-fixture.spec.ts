import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import {
  createTask7EvidenceRepositoryFixture,
  createTask7FixtureGitEnvironment,
  type Task7EvidenceRepositoryFixture,
} from '../helpers/task7-evidence-repository-fixture';

const fixtures: Task7EvidenceRepositoryFixture[] = [];

async function fixture(): Promise<Task7EvidenceRepositoryFixture> {
  const value = await createTask7EvidenceRepositoryFixture();
  fixtures.push(value);
  expect(isAbsolute(value.fixtureRoot)).toBe(true);
  return value;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: createTask7FixtureGitEnvironment() });
  if (result.error || result.signal || result.status !== 0) throw result.error || new Error(result.stderr || 'FIXTURE_GIT_FAILED');
  return result.stdout.trim();
}

afterEach(async (): Promise<void> => {
  const results = await Promise.allSettled(fixtures.splice(0).map(value => value.dispose()));
  const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'TASK7_REPOSITORY_FIXTURES_CLEANUP_FAILED');
});

it('materializes independent physical repositories with the same real committed baseline', async (): Promise<void> => {
  const value = await fixture();
  const [first, second] = await Promise.all([value.createRepository(), value.createRepository()]);
  expect(first.repositoryRoot).not.toBe(second.repositoryRoot);
  expect(first.head).toMatch(/^[a-f0-9]{40}$/u);
  expect(first.head).toBe(second.head);
  for (const repository of [first, second]) {
    expect(git(repository.repositoryRoot, ['rev-parse', 'HEAD'])).toBe(first.head);
    expect(git(repository.repositoryRoot, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    expect(await readFile(join(repository.repositoryRoot, 'tracked.txt'), 'utf8')).toBe('clean\n');
    expect(repository.rootDirectory).toBe(join(repository.repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence'));
  }
});

it('keeps worktree, index and committed HEAD changes out of other and later repositories', async (): Promise<void> => {
  const value = await fixture();
  const first = await value.createRepository();
  const second = await value.createRepository();
  await writeFile(join(first.repositoryRoot, 'tracked.txt'), 'changed\n', 'utf8');
  expect(git(first.repositoryRoot, ['status', '--porcelain'])).toMatch(/tracked\.txt/u);
  expect(git(second.repositoryRoot, ['status', '--porcelain'])).toBe('');
  expect(await readFile(join(second.repositoryRoot, 'tracked.txt'), 'utf8')).toBe('clean\n');
  git(first.repositoryRoot, ['add', 'tracked.txt']);
  git(first.repositoryRoot, ['commit', '-qm', 'independent copy']);
  expect(git(first.repositoryRoot, ['rev-parse', 'HEAD'])).not.toBe(first.head);
  const third = await value.createRepository();
  for (const repository of [second, third]) {
    expect(git(repository.repositoryRoot, ['rev-parse', 'HEAD'])).toBe(first.head);
    expect(git(repository.repositoryRoot, ['status', '--porcelain'])).toBe('');
    expect(await readFile(join(repository.repositoryRoot, 'tracked.txt'), 'utf8')).toBe('clean\n');
  }
});

it('retains the original ignored-artifact behavior without sharing ignored files', async (): Promise<void> => {
  const value = await fixture();
  const first = await value.createRepository();
  const second = await value.createRepository();
  await mkdir(first.rootDirectory, { recursive: true });
  await writeFile(join(first.rootDirectory, 'ignored.txt'), 'allowed\n', 'utf8');
  expect(git(first.repositoryRoot, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
  await expect(access(join(second.rootDirectory, 'ignored.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('disposes only its own fixture and refuses materialization after disposal', async (): Promise<void> => {
  const first = await fixture();
  const other = await fixture();
  await first.createRepository();
  const retained = await other.createRepository();
  await first.dispose();
  await first.dispose();
  await expect(access(first.fixtureRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(first.createRepository()).rejects.toThrow('TASK7_REPOSITORY_FIXTURE_CLOSED');
  expect(await readFile(join(retained.repositoryRoot, 'tracked.txt'), 'utf8')).toBe('clean\n');
  expect(git(retained.repositoryRoot, ['rev-parse', 'HEAD'])).toBe(retained.head);
});

it('removes inherited Git redirects from a real child without mutating their source environment', (): void => {
  const names = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_TEMPLATE_DIR', 'GIT_EXEC_PATH', 'GIT_TRACE'];
  const source: NodeJS.ProcessEnv = { ...process.env, TASK7_KEEP: 'retained',
    ...Object.fromEntries(names.map(name => [name, 'test-only-not-used-by-git'])),
    GIT_CONFIG_GLOBAL: 'test-only-global', GIT_CONFIG_SYSTEM: 'test-only-system' };
  const snapshot = { ...source };
  const result = spawnSync(process.execPath, ['-e',
    `const {spawnSync}=require('node:child_process');
     const names=JSON.parse(process.argv[1]);
     const configs=['--global','--system'].map(scope=>{
       const result=spawnSync('git',['config',scope,'--list'],{encoding:'utf8',windowsHide:true});
       return {status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr};
     });
     process.stdout.write(JSON.stringify({redirects:names.filter(name=>process.env[name]!==undefined),keep:process.env.TASK7_KEEP,configs,noSystem:process.env.GIT_CONFIG_NOSYSTEM,prompt:process.env.GIT_TERMINAL_PROMPT}));`,
    JSON.stringify(names)], { encoding: 'utf8', windowsHide: true, env: createTask7FixtureGitEnvironment(source) });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ redirects: [], keep: 'retained',
    configs: [{ status: 0, signal: null, stdout: '', stderr: '' }, { status: 0, signal: null, stdout: '', stderr: '' }],
    noSystem: '1', prompt: '0' });
  expect(source).toEqual(snapshot);
});

it('constructs its own repository without changing an inherited external Git config target', async (): Promise<void> => {
  const owner = await fixture();
  const externalConfig = join(owner.fixtureRoot, 'external.gitconfig');
  const original = '[boundary]\n\tvalue = retained\n';
  await writeFile(externalConfig, original, 'utf8');
  const moduleUrl = pathToFileURL(resolve('tests/helpers/task7-evidence-repository-fixture.ts')).href;
  const program = `
    import { spawnSync } from 'node:child_process';
    const { createTask7EvidenceRepositoryFixture, createTask7FixtureGitEnvironment } = await import(process.argv[1]);
    let owned;
    try {
      owned = await createTask7EvidenceRepositoryFixture();
      const copy = await owned.createRepository();
      const identity = spawnSync('git', ['config', '--local', '--get', 'user.name'], {
        cwd: copy.repositoryRoot, encoding: 'utf8', windowsHide: true, env: createTask7FixtureGitEnvironment()
      });
      if (identity.status !== 0 || identity.stdout.trim() !== 'Task 7 Test') throw new Error('LOCAL_IDENTITY_REQUIRED');
      process.stdout.write(JSON.stringify({ head: copy.head, parentConfigUnchanged: process.env.GIT_CONFIG === process.argv[2] }));
    } catch { process.stderr.write('TASK7_GIT_ENV_BOUNDARY_FAILED'); process.exitCode = 2; }
    finally { if (owned) await owned.dispose(); }
  `;
  // The hostile target is another file owned by this test, never user configuration.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, moduleUrl, externalConfig],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG: externalConfig } });
  expect(await readFile(externalConfig, 'utf8')).toBe(original);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ head: expect.stringMatching(/^[a-f0-9]{40}$/u), parentConfigUnchanged: true });
});
