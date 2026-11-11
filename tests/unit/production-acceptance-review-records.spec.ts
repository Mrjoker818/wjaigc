import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const recordDirectory = 'docs/testing/baselines/';
const recordName = 'production-acceptance-review-2026-11-11.json';
const originalBase = '7fdc0108952fb3a68415ca3a2a26b5d33641dc6b';
const reviewedParent = 'c8dac11754b7b6dd9de8d4829e44777f1ca0ce88';

interface ReviewEntry {
  path: string;
  reviewArea: 'infra' | 'server' | 'ui' | 'workflow';
  source: 'main' | 'candidate';
  sourceCommit: string | null;
  sourceBlob: string | null;
  reviewedBlob: string | null;
  disposition: 'reviewed' | 'hold';
  summary: string;
  evidence: string[];
}

type AdditionalReviewEntry = Pick<ReviewEntry, 'path' | 'reviewedBlob' | 'disposition' | 'summary' | 'evidence'>;

function git(...args: string[]): string {
  return gitInput(args);
}

function gitInput(args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, input,
  }).trimEnd();
}

function readRecord(): {
  comparisonBaseline: string;
  reviewedParent: string;
  entries: ReviewEntry[];
  additionalPaths?: AdditionalReviewEntry[];
} {
  return JSON.parse(readFileSync(resolve(recordDirectory, recordName), 'utf8'));
}

function readAllowlist(): string[] {
  return JSON.parse(readFileSync(resolve(recordDirectory, 'protected-baseline-allowed-paths.json'), 'utf8'));
}

it('records every original production acceptance blocker as an exact reviewed version or an explicit hold', () => {
  const review = readRecord();
  const entries = review.entries;
  const expectedSource = new Set(git('diff', '--name-only', originalBase, reviewedParent).split(/\r?\n/u));
  expect(review.comparisonBaseline).toBe(originalBase);
  expect(review.reviewedParent).toBe(reviewedParent);
  expect(entries).toHaveLength(160);
  expect(new Set(entries.map(entry => entry.path.toLowerCase())).size).toBe(160);
  const mainEntries = entries.filter(entry => entry.source === 'main');
  expect(mainEntries).toHaveLength(156);
  for (const entry of mainEntries) expect(entry.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
  const commits = [...new Set(mainEntries.map(entry => entry.sourceCommit!))];
  const reachable = new Set(git('rev-list', reviewedParent).split(/\r?\n/u));
  for (const commit of commits) expect(reachable.has(commit), commit).toBe(true);
  const sourcePaths = new Map<string, Set<string>>();
  const changedPaths = gitInput(['diff-tree', '--stdin', '-m', '-r', '--format=@@%H',
    '--no-renames', '--name-only'], commits.join('\n') + '\n');
  let commitPaths: Set<string> | undefined;
  for (const line of changedPaths.split(/\r?\n/u)) {
    if (line.startsWith('@@')) {
      const commit = line.slice(2);
      commitPaths = sourcePaths.get(commit) ?? new Set();
      sourcePaths.set(commit, commitPaths);
    } else if (line) commitPaths?.add(line);
  }
  const objects = gitInput(['cat-file', '--batch-check=%(objectname) %(objecttype)'],
    mainEntries.map(entry => entry.sourceCommit + ':' + entry.path).join('\n') + '\n').split(/\r?\n/u);
  expect(objects).toHaveLength(mainEntries.length);
  const sourceBlobs = new Map(mainEntries.map((entry, index) => {
    const object = objects[index];
    expect(object).toMatch(/^[a-f0-9]{40} blob$| missing$/u);
    return [entry.path, object.endsWith(' missing') ? null : object.split(' ')[0]];
  }));
  for (const entry of entries) {
    expect(entry.path).toMatch(/^[A-Za-z0-9_.\-[\]/]+$/u);
    expect(entry.path.split('/')).not.toContain('..');
    expect(entry.path).not.toMatch(/^\/|\/$/u);
    expect(['infra', 'server', 'ui', 'workflow']).toContain(entry.reviewArea);
    expect(['reviewed', 'hold']).toContain(entry.disposition);
    expect(entry.summary.trim()).not.toBe('');
    expect(entry.evidence.length).toBeGreaterThan(0);
    if (entry.reviewedBlob) expect(entry.reviewedBlob).toMatch(/^[a-f0-9]{40}$/u);
    if (entry.source === 'main') {
      expect(expectedSource.has(entry.path), entry.path).toBe(true);
      expect(sourcePaths.get(entry.sourceCommit!)?.has(entry.path), entry.path).toBe(true);
      expect(sourceBlobs.get(entry.path), entry.path).toBe(entry.sourceBlob);
    } else {
      expect(entry.source).toBe('candidate');
      expect(entry.sourceCommit).toBeNull();
      expect(entry.sourceBlob).toBeNull();
    }
  }
});

it('allows only the reviewed versions of the paths recorded in this audit', () => {
  const allowlist = readAllowlist();
  const locallyChanged = new Set([
    ...git('diff', '--name-only').split(/\r?\n/u),
    ...git('ls-files', '--others', '--exclude-standard').split(/\r?\n/u),
  ]);
  const indexObjects = new Map(git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map(line => {
    const boundary = line.indexOf('\t');
    const [, blob, stage] = line.slice(0, boundary).split(' ');
    expect(stage).toBe('0');
    return [line.slice(boundary + 1), blob];
  }));
  const { entries, additionalPaths = [] } = readRecord();
  const allEntries = [...entries, ...additionalPaths];
  expect(new Set(allEntries.map(entry => entry.path.toLowerCase())).size).toBe(allEntries.length);
  for (const entry of additionalPaths) {
    expect(entry.path).toMatch(/^[A-Za-z0-9_.\-[\]/]+$/u);
    expect(entry.path.split('/')).not.toContain('..');
    expect(entry.path).not.toMatch(/^\/|\/$/u);
    expect(entry.disposition).toBe('reviewed');
    expect(entry.reviewedBlob).toMatch(/^[a-f0-9]{40}$/u);
    expect(entry.summary.trim()).not.toBe('');
    expect(entry.evidence.length).toBeGreaterThan(0);
  }
  const worktreePaths = allEntries
    .filter(entry => entry.disposition === 'reviewed' && locallyChanged.has(entry.path) && existsSync(resolve(entry.path)))
    .map(entry => entry.path);
  const worktreeObjects = worktreePaths.length
    ? gitInput(['hash-object', '--stdin-paths'], worktreePaths.join('\n') + '\n').split(/\r?\n/u)
    : [];
  expect(worktreeObjects).toHaveLength(worktreePaths.length);
  const worktreeObjectByPath = new Map(worktreePaths.map((path, index) => [path, worktreeObjects[index]]));
  for (const entry of allEntries) {
    expect(allowlist.filter(allowed => allowed === entry.path)).toHaveLength(entry.disposition === 'reviewed' ? 1 : 0);
    if (entry.disposition === 'hold') continue;
    const currentBlob = locallyChanged.has(entry.path)
      ? worktreeObjectByPath.get(entry.path) ?? null
      : indexObjects.get(entry.path) ?? null;
    expect(currentBlob, 'Unreviewed change to ' + entry.path).toBe(entry.reviewedBlob);
  }
});
