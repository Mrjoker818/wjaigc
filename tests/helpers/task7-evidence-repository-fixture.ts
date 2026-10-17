import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface Task7EvidenceRepository {
  repositoryRoot: string;
  rootDirectory: string;
  head: string;
}

export interface Task7EvidenceRepositoryFixture {
  readonly fixtureRoot: string;
  createRepository(): Promise<Task7EvidenceRepository>;
  dispose(): Promise<void>;
}

export function createTask7FixtureGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const controlled: NodeJS.ProcessEnv = { ...source };
  for (const name of Object.keys(controlled)) {
    if (name.toUpperCase().startsWith('GIT_')) delete controlled[name];
  }
  // Child-only: inherited routing/config/template/trace variables cannot escape the fixture.
  // Git for Windows accepts /dev/null but rejects Node's Windows devNull (\\.\nul).
  return { ...controlled, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
}

export async function createTask7EvidenceRepositoryFixture(): Promise<Task7EvidenceRepositoryFixture> {
  const temporaryParent = await realpath(tmpdir());
  const prefix = 'task7-evidence-fixture-';
  const fixtureRoot = await mkdtemp(join(temporaryParent, prefix));
  const ownership = await lstat(fixtureRoot);
  const seed = join(fixtureRoot, 'seed');
  const pending = new Set<Promise<Task7EvidenceRepository>>();
  let closed = false;
  let disposal: Promise<void> | undefined;

  async function removeOwnedFixture(): Promise<void> {
    const current = await lstat(fixtureRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!current) return;
    const resolved = await realpath(fixtureRoot);
    if (!current.isDirectory() || current.isSymbolicLink() || resolved !== fixtureRoot
      || dirname(resolved) !== temporaryParent || !basename(resolved).startsWith(prefix)
      || current.dev !== ownership.dev || current.ino !== ownership.ino) {
      throw new Error('TASK7_REPOSITORY_FIXTURE_OWNERSHIP_CHANGED');
    }
    await rm(resolved, { recursive: true, force: true });
  }

  function git(args: string[]): string {
    const result = spawnSync('git', args, { cwd: seed, encoding: 'utf8', windowsHide: true, env: createTask7FixtureGitEnvironment() });
    if (result.error || result.signal || result.status !== 0) {
      throw result.error || new Error(result.stderr || 'TASK7_REPOSITORY_FIXTURE_GIT_FAILED');
    }
    return result.stdout.trim();
  }

  let head: string;
  try {
    await mkdir(seed);
    git(['init', '-q']);
    git(['config', 'user.email', 'task7@example.invalid']);
    git(['config', 'user.name', 'Task 7 Test']);
    await writeFile(join(seed, '.gitignore'), 'output/\n', 'utf8');
    await writeFile(join(seed, 'tracked.txt'), 'clean\n', 'utf8');
    git(['add', '.gitignore', 'tracked.txt']);
    git(['commit', '-qm', 'test fixture']);
    head = git(['rev-parse', 'HEAD']).toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error('TASK7_REPOSITORY_FIXTURE_HEAD_INVALID');
  } catch (error) {
    try { await removeOwnedFixture(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'TASK7_REPOSITORY_FIXTURE_BOOTSTRAP_AND_CLEANUP_FAILED'); }
    throw error;
  }

  return {
    fixtureRoot,
    createRepository: (): Promise<Task7EvidenceRepository> => {
      if (closed) return Promise.reject(new Error('TASK7_REPOSITORY_FIXTURE_CLOSED'));
      const operation = (async (): Promise<Task7EvidenceRepository> => {
        const container = await mkdtemp(join(fixtureRoot, 'repo-'));
        const repositoryRoot = join(container, 'repository');
        // Byte copies, not worktrees, alternates or hardlinks: each case may mutate Git safely.
        await cp(seed, repositoryRoot, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
        return { repositoryRoot, rootDirectory: join(repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence'), head };
      })();
      const tracked = operation.finally((): void => { pending.delete(tracked); });
      pending.add(tracked);
      return tracked;
    },
    dispose: (): Promise<void> => {
      if (disposal) return disposal;
      closed = true;
      disposal = (async (): Promise<void> => {
        const results = await Promise.allSettled([...pending]);
        const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        try { await removeOwnedFixture(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, 'TASK7_REPOSITORY_FIXTURE_DISPOSE_FAILED');
      })();
      return disposal;
    },
  };
}
