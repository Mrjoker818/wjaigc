import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stage3SourceIdentity } from '../../../tests/helpers/stage-3-source-state';

const temporaryRepositories: string[] = [];

afterEach(() => {
  for (const directory of temporaryRepositories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository(): { directory: string; head: string } {
  const directory = mkdtempSync(join(tmpdir(), 'wujie-stage3-source-'));
  temporaryRepositories.push(directory);
  execFileSync('git', ['init'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'stage3@example.test'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Stage 3'], { cwd: directory });
  writeFileSync(join(directory, 'source.txt'), 'one\n');
  execFileSync('git', ['add', 'source.txt'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: directory });
  return {
    directory,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
  };
}

describe('stage3SourceIdentity', () => {
  it('uses the exact commit for a clean tree and a content fingerprint for dirty source', () => {
    const { directory, head } = createRepository();
    expect(stage3SourceIdentity(directory)).toBe(head);

    writeFileSync(join(directory, 'source.txt'), 'two\n');
    const firstDirtyIdentity = stage3SourceIdentity(directory);
    expect(firstDirtyIdentity).toMatch(new RegExp(`^${head}-worktree-[a-f0-9]{12}$`));

    writeFileSync(join(directory, 'source.txt'), 'three\n');
    expect(stage3SourceIdentity(directory)).not.toBe(firstDirtyIdentity);

    execFileSync('git', ['checkout', '--', 'source.txt'], { cwd: directory });
    writeFileSync(join(directory, 'untracked.txt'), 'first\n');
    const firstUntrackedIdentity = stage3SourceIdentity(directory);
    expect(firstUntrackedIdentity).toMatch(new RegExp(`^${head}-worktree-[a-f0-9]{12}$`));

    writeFileSync(join(directory, 'untracked.txt'), 'second\n');
    expect(stage3SourceIdentity(directory)).not.toBe(firstUntrackedIdentity);
  });
});
