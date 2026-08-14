import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATHS = [
  '.',
  ':(exclude).playwright-cli/**',
  ':(exclude).playwright-output/**',
  ':(exclude)output/**',
  ':(exclude)playwright-report/**',
  ':(exclude)test-results/**',
];

export function stage3SourceIdentity(cwd = process.cwd()): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const status = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all', '--', ...SOURCE_PATHS],
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    if (!status.trim()) return head;

    const diff = execFileSync(
      'git',
      ['diff', '--binary', 'HEAD', '--', ...SOURCE_PATHS],
      { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    const untracked = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_PATHS],
      { cwd, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    ).toString('utf8').split('\0').filter(Boolean).sort();
    const hash = createHash('sha256').update(status).update(diff);
    for (const path of untracked) {
      hash.update(path).update('\0').update(readFileSync(resolve(cwd, path)));
    }
    return `${head}-worktree-${hash.digest('hex').slice(0, 12)}`;
  } catch {
    return 'unknown-source';
  }
}
