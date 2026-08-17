import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATHS = [
  '.',
  ':(exclude).superpowers/sdd/task-1-brief.md',
  ':(exclude).superpowers/sdd/task-2-brief.md',
  ':(exclude).playwright-cli/**',
  ':(exclude).playwright-output/**',
  ':(exclude)output/**',
  ':(exclude)playwright-report/**',
  ':(exclude)test-results/**',
];

const EXCLUDED_CONTROLLER_PATHS = [
  '.superpowers/sdd/task-1-brief.md',
  '.superpowers/sdd/task-2-brief.md',
];

export interface Stage3SourceState {
  commit: string;
  tree: string;
  productTreeClean: boolean;
  productStatus: string[];
  excludedControllerPaths: string[];
}

export function stage3SourceState(cwd = process.cwd()): Stage3SourceState {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...SOURCE_PATHS],
    { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).trim();
  return {
    commit,
    tree,
    productTreeClean: status.length === 0,
    productStatus: status ? status.split(/\r?\n/) : [],
    excludedControllerPaths: [...EXCLUDED_CONTROLLER_PATHS],
  };
}

export function stage3SourceIdentity(cwd = process.cwd()): string {
  try {
    const sourceState = stage3SourceState(cwd);
    const head = sourceState.commit;
    const status = `${sourceState.productStatus.join('\n')}\n`;
    if (sourceState.productTreeClean) return head;

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
