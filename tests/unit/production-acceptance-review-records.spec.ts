import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
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
  disposition: 'reviewed' | 'hold' | 'retired';
  retirement?: TrackedRetirement;
  reviewHistory?: unknown[];
  formalAcceptance?: string;
  summary: string;
  evidence: string[];
}

interface Retirement {
  schemaVersion: 1;
  deletionCommit: string;
  deletionParent: string;
  deletedParentBlob: string;
  reason: string;
  replacement: { description: string; paths: string[]; equivalence: 'not-claimed' };
  obligations: { status: 'none-owned-by-path'; reason: string };
  intent: { basis: 'upstream-deletion-and-current-user-direction'; userDirection: string };
  evidence: { path: string; sha256: string; jsonPointer: string };
}

type AdditionalReviewEntry = Pick<ReviewEntry, 'path' | 'reviewedBlob' | 'summary' | 'evidence'> & {
  disposition: ReviewEntry['disposition'] | 'retired';
  retirement?: Retirement;
};

interface RetirementProof {
  reachable: (commit: string) => boolean;
  parents: (commit: string) => string[];
  deleted: (parent: string, commit: string, path: string) => boolean;
  blob: (ref: string, path: string) => string | null;
  indexBlob: (path: string) => string | null;
  present: (path: string) => boolean;
  evidence: (path: string) => { sha256: string; ignored: boolean; document: unknown };
  originalRecord?: (path: string) => TrackedOriginRecord | null;
}


type RecordedEntry = ReviewEntry | AdditionalReviewEntry | TrackedEntry;

interface V2ProofDocument extends TrackedProofDocument {
  scope: { exactPathCount: number; originalEntries: number; additionalPaths: number };
}

interface V2OriginsDocument extends TrackedOriginsDocument {
  comparisonBaseline: string;
  reviewedParent: string;
  authorizationFileSha256: string;
}

interface V2ObligationRow extends TrackedObligationRow {
  priorRisk: string;
  originalAssertion: string;
  preservation: TrackedObligationRow['preservation'] & { target: string; policy: string };
  evidence: { path: string; sha256: string; jsonPointer: string };
}

interface V2ObligationsDocument extends TrackedObligationsDocument {
  sourceOrigins: { path: string; sha256: string };
  obligations: V2ObligationRow[];
}

function assertTrackedKeys(value: object, keys: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function compactRecordDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function trackedEvidence<T>(
  facts: RetirementProof,
  reference: { path: string; sha256: string },
  exactPath: string,
): T {
  expect(reference.path).toBe(exactPath);
  expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/u);
  const evidence = facts.evidence(reference.path);
  expect(evidence.ignored, 'Tracked evidence must be versionable').toBe(false);
  expect(evidence.sha256).toBe(reference.sha256);
  return evidence.document as T;
}

function repositoryTrackedRetirementProof(additionalEntries: readonly RecordedEntry[] = []): RetirementProof {
  // A fresh instance belongs to one aggregate; never share mutable repository facts across tests.
  const document = readTrackedDocument<V2ProofDocument>(trackedProofPath);
  const origins = readTrackedDocument<V2OriginsDocument>(trackedOriginsPath);
  expect(document.retirements).toHaveLength(38);
  const base = repositoryRetirementProof();
  const trackedPaths = new Set(document.retirements.map(row => row.path));
  const rows = document.retirements.map(row => ({
    path: row.path, deletionCommit: row.deletionCommit, deletionParent: row.deletionParent,
  }));
  for (const entry of additionalEntries) {
    if (entry.disposition === 'retired' && entry.retirement?.schemaVersion === 1) {
      rows.push({
        path: entry.path, deletionCommit: entry.retirement.deletionCommit,
        deletionParent: entry.retirement.deletionParent,
      });
    }
  }
  const requests = new Map<string, [string, string]>();
  const groups = new Map<string, { parent: string; paths: string[] }>();
  for (const row of rows) {
    expect(row.path).toMatch(/^src\/[A-Za-z0-9_.\-[\]/]+$/u);
    expect(row.path.split('/')).not.toContain('..');
    for (const ref of [row.deletionParent, row.deletionCommit]) expect(ref).toMatch(/^[a-f0-9]{40}$/u);
    for (const ref of [row.deletionParent, row.deletionCommit, 'HEAD']) {
      requests.set(ref + '\0' + row.path, [ref, row.path]);
    }
    const group = groups.get(row.deletionCommit) ?? { parent: row.deletionParent, paths: [] };
    expect(group.parent).toBe(row.deletionParent);
    group.paths.push(row.path);
    groups.set(row.deletionCommit, group);
  }
  // Bound repository reads to batches, rather than spawning Git once per field and path.
  const questions = [...requests.values()];
  const answers = gitInput(['cat-file', '--batch-check=%(objectname) %(objecttype)'],
    questions.map(([ref, path]) => ref + ':' + path).join('\n') + '\n').split(/\r?\n/u);
  expect(answers).toHaveLength(questions.length);
  const blobs = new Map<string, string | null>();
  questions.forEach(([ref, path], index) => {
    const answer = answers[index];
    if (!answer.endsWith(' missing')) expect(answer).toMatch(/^[a-f0-9]{40} blob$/u);
    blobs.set(ref + '\0' + path, answer.endsWith(' missing') ? null : answer.split(' ')[0]);
  });
  const reachable = new Map<string, boolean>();
  const parents = new Map<string, string[]>();
  const deletions = new Map<string, Set<string>>();
  for (const [commit, group] of groups) {
    reachable.set(commit, base.reachable(commit));
    parents.set(commit, base.parents(commit));
    const lines = git('diff-tree', '--no-commit-id', '--name-status', '--no-renames',
      '-r', group.parent, commit, '--', ...group.paths).split(/\r?\n/u);
    deletions.set(commit, new Set(lines.filter(line => line.startsWith('D\t')).map(line => line.slice(2))));
  }
  const paths = rows.map(row => row.path);
  const indexed = new Map<string, string>();
  for (const line of git('ls-files', '--stage', '-z', '--', ...paths).split('\0').filter(Boolean)) {
    const boundary = line.indexOf('\t');
    const [, blob, stage] = line.slice(0, boundary).split(' ');
    expect(stage).toBe('0');
    indexed.set(line.slice(boundary + 1), blob);
  }
  const latestChanges = new Map<string, { commit: string; status: string }>();
  let currentCommit = '';
  for (const line of git('log', '--full-history', '--date-order', '--format=@@%H',
    '--name-status', '--no-renames', 'HEAD', '--', ...trackedPaths).split(/\r?\n/u)) {
    if (line.startsWith('@@')) currentCommit = line.slice(2);
    else if (line.includes('\t')) {
      const [status, path] = line.split('\t');
      if (!latestChanges.has(path)) latestChanges.set(path, { commit: currentCommit, status });
    }
  }
  return {
    reachable: commit => reachable.get(commit) ?? false,
    parents: commit => parents.get(commit) ?? [],
    deleted: (parent, commit, path) => groups.get(commit)?.parent === parent
      && Boolean(deletions.get(commit)?.has(path))
      && (!trackedPaths.has(path)
        || (latestChanges.get(path)?.commit === commit && latestChanges.get(path)?.status === 'D')),
    blob: (ref, path) => {
      const key = ref + '\0' + path;
      if (!blobs.has(key)) throw new Error('Unbound tracked-retirement Git object');
      return blobs.get(key) ?? null;
    },
    indexBlob: path => indexed.get(path) ?? null,
    present: base.present,
    evidence: base.evidence,
    originalRecord: path => {
      const record = origins.records.find(row => row.path === path);
      return record ? structuredClone(record) : null;
    },
  };
}

function assertTrackedRetirement(entry: TrackedEntry, suppliedProof?: RetirementProof): void {
  expect(entry.path).toMatch(/^src\/[A-Za-z0-9_.\-[\]/]+$/u);
  expect(entry.path.split('/')).not.toContain('..');
  expect(entry.path).not.toMatch(/\/$/u);
  expect(entry.disposition).toBe('retired');
  expect(entry.reviewedBlob).toBeNull();
  expect(entry.summary.trim()).not.toBe('');
  const retirement = entry.retirement;
  if (!retirement) throw new Error('Missing tracked retirement metadata');
  assertTrackedKeys(retirement, ['schemaVersion', 'kind', 'deletionCommit', 'deletionParent',
    'deletedParentBlob', 'reason', 'replacement', 'intent', 'obligations', 'acceptance', 'origin', 'evidence']);
  assertTrackedKeys(retirement.replacement, ['description', 'paths', 'equivalence', 'nonEquivalentGap']);
  assertTrackedKeys(retirement.intent, ['basis', 'upstreamCommits', 'userDirection']);
  assertTrackedKeys(retirement.obligations, ['status', 'reason', 'categories', 'preservation', 'evidence']);
  assertTrackedKeys(retirement.origin, ['canonicalPointer', 'previousRecordSha256', 'originalSourceTupleSha256']);
  assertTrackedKeys(retirement.evidence, ['path', 'sha256', 'jsonPointer']);
  assertTrackedKeys(retirement.obligations.evidence, ['path', 'sha256', 'jsonPointer']);
  expect(retirement.schemaVersion).toBe(2);
  expect(retirement.kind).toBe('source-only-with-tracked-obligations');
  for (const hash of [retirement.deletionCommit, retirement.deletionParent, retirement.deletedParentBlob]) {
    expect(hash).toMatch(/^[a-f0-9]{40}$/u);
  }
  expect(retirement.reason.trim().length).toBeGreaterThan(20);
  expect(retirement.intent.basis).toBe('upstream-deletion-and-current-user-direction');
  expect(retirement.intent.upstreamCommits).toContain(retirement.deletionCommit);
  expect(retirement.intent.userDirection.trim().length).toBeGreaterThan(20);
  expect(retirement.replacement.description.trim()).not.toBe('');
  expect(retirement.replacement.nonEquivalentGap.trim()).not.toBe('');
  expect(retirement.replacement.equivalence).toBe('not-claimed');
  expect(retirement.replacement.paths.length).toBeGreaterThan(0);
  expect(new Set(retirement.replacement.paths).size).toBe(retirement.replacement.paths.length);
  expect(retirement.obligations.status).toBe('tracked-preserved-pending');
  expect(retirement.obligations.reason.trim()).not.toBe('');
  expect(retirement.obligations.categories.length).toBeGreaterThan(0);
  expect(new Set(retirement.obligations.categories).size).toBe(retirement.obligations.categories.length);
  for (const category of retirement.obligations.categories) expect(category).toMatch(/^[a-z][a-z0-9-]*$/u);
  expect(retirement.obligations.preservation).toEqual({
    physicalDataPreservation: 'unverified', cleanupAuthorized: false,
    migrationExecutionAuthorized: false, newPaidReplacementAuthorized: false,
    accountingDelivered: false, recoveryOrExportDelivered: false,
  });
  expect(retirement.acceptance).toEqual({
    sourceScope: 'source-only', runtimeStatus: 'pending',
    historicalDeliveryStatus: 'pending', equivalence: 'not-claimed',
  });
  expect(entry.formalAcceptance).toBe('runtime-pending');
  const facts = suppliedProof ?? repositoryTrackedRetirementProof();
  const document = trackedEvidence<V2ProofDocument>(facts, retirement.evidence, trackedProofPath);
  expect(document.schemaVersion).toBe(2);
  expect(document.kind).toBe('source-only-retirement-with-tracked-obligations-evidence');
  expect(document.scope).toMatchObject({ exactPathCount: 38, originalEntries: 34, additionalPaths: 4 });
  expect(document.retirements).toHaveLength(38);
  expect(new Set(document.retirements.map(row => row.path.toLowerCase())).size).toBe(38);
  const origins = trackedEvidence<V2OriginsDocument>(facts, document.sourceOrigins, trackedOriginsPath);
  expect(origins.schemaVersion).toBe(2);
  expect(origins.kind).toBe('tracked-retirement-source-origins');
  expect(origins.comparisonBaseline).toBe(originalBase);
  expect(origins.reviewedParent).toBe(reviewedParent);
  expect(origins.original160SourceTuples).toHaveLength(160);
  expect(origins.original286Authorizations).toHaveLength(286);
  expect(origins.records).toHaveLength(38);
  expect(new Set(origins.records.map(row => row.path.toLowerCase())).size).toBe(38);
  expect(document.retirements.map(row => row.path).sort()).toEqual(origins.records.map(row => row.path).sort());
  expect(retirement.evidence.jsonPointer).toMatch(/^\/retirements\/(0|[1-9][0-9]*)$/u);
  const index = Number(retirement.evidence.jsonPointer.split('/').at(-1));
  const row = document.retirements[index];
  if (!row) throw new Error('Missing exact tracked retirement evidence row');
  expect(row).toMatchObject({
    path: entry.path, canonicalPointer: retirement.origin.canonicalPointer,
    schemaVersion: retirement.schemaVersion, kind: retirement.kind,
    deletionCommit: retirement.deletionCommit, deletionParent: retirement.deletionParent,
    deletedParentBlob: retirement.deletedParentBlob, reason: retirement.reason,
    replacement: retirement.replacement, intent: retirement.intent,
    obligations: retirement.obligations, acceptance: retirement.acceptance, origin: retirement.origin,
    sourceOnly: true, runtimeStatus: 'pending', historicalDeliveryStatus: 'pending',
  });
  const originalLookup = facts.originalRecord;
  if (!originalLookup) throw new Error('Missing independent original-record oracle');
  const original = originalLookup(entry.path);
  if (!original) throw new Error('Unregistered tracked retirement path');
  expect(original).toEqual(origins.records[index]);
  expect(original.path).toBe(entry.path);
  const mutable = new Set(['reviewedBlob', 'disposition', 'summary', 'evidence',
    'retirement', 'formalAcceptance', 'reviewHistory']);
  expect(Object.fromEntries(Object.entries(entry).filter(([key]) => !mutable.has(key)))).toEqual(
    Object.fromEntries(Object.entries(original.previousRecord).filter(([key]) => !mutable.has(key))),
  );
  if (original.canonicalPointer.startsWith('/entries/')) {
    expect(origins.original160SourceTuples[Number(original.canonicalPointer.split('/').at(-1))])
      .toEqual(original.originalSourceTuple);
  }
  expect(retirement.origin.canonicalPointer).toMatch(/^\/(entries|additionalPaths)\/(0|[1-9][0-9]*)$/u);
  expect(retirement.origin.canonicalPointer).toBe(original.canonicalPointer);
  expect(trackedSourceTuple(entry)).toEqual(original.originalSourceTuple);
  expect(trackedSourceTuple(original.previousRecord)).toEqual(original.originalSourceTuple);
  expect(retirement.origin.originalSourceTupleSha256).toBe(compactRecordDigest(original.originalSourceTuple));
  expect(original.originalSourceTupleSha256).toBe(retirement.origin.originalSourceTupleSha256);
  expect(retirement.origin.previousRecordSha256).toBe(compactRecordDigest(original.previousRecord));
  expect(original.previousRecordSha256).toBe(retirement.origin.previousRecordSha256);
  const oldHistory = original.previousRecord.reviewHistory ?? [];
  expect(Array.isArray(entry.reviewHistory)).toBe(true);
  expect(entry.reviewHistory).toHaveLength(oldHistory.length + 1);
  expect(entry.reviewHistory.slice(0, oldHistory.length)).toEqual(oldHistory);
  const history = entry.reviewHistory.at(-1) as TrackedHistory;
  expect(history.previous).toEqual(original.previousRecord);
  expect(history.previousRecordSha256).toBe(original.previousRecordSha256);
  expect(history.sourceOnly).toBe(true);
  expect(history.historicalDeliveryStatus).toBe('pending');
  const obligations = trackedEvidence<V2ObligationsDocument>(facts, retirement.obligations.evidence, trackedObligationsPath);
  expect(document.obligationEvidence).toEqual({
    path: trackedObligationsPath, sha256: retirement.obligations.evidence.sha256,
  });
  expect(obligations.schemaVersion).toBe(2);
  expect(obligations.kind).toBe('source-retirement-tracked-obligations-evidence');
  expect(obligations.sourceOrigins).toEqual(document.sourceOrigins);
  expect(obligations.obligations).toHaveLength(38);
  expect(new Set(obligations.obligations.map(item => item.path.toLowerCase())).size).toBe(38);
  expect(obligations.obligations.map(item => item.path).sort()).toEqual(origins.records.map(item => item.path).sort());
  expect(retirement.obligations.evidence.jsonPointer).toBe('/obligations/' + index);
  const obligation = obligations.obligations[index];
  expect(obligation.path).toBe(entry.path);
  expect(obligation.status).toBe('tracked-preserved-pending');
  expect(obligation.categories).toEqual(retirement.obligations.categories);
  expect(obligation.priorRisk.trim()).not.toBe('');
  expect(obligation.originalAssertion.trim()).not.toBe('');
  expect(obligation.sourceIdentity).toEqual({
    deletionParent: retirement.deletionParent, deletedParentBlob: retirement.deletedParentBlob,
    originalRecordSha256: original.previousRecordSha256,
  });
  expect(obligation.evidence).toEqual({
    path: trackedOriginsPath, sha256: document.sourceOrigins.sha256, jsonPointer: '/records/' + index,
  });
  expect(obligation.preservation).toEqual({
    target: 'historical-source-contract-and-obligation-record',
    policy: 'retain-original-identity-evidence-and-existing-data-do-not-clean',
    ...retirement.obligations.preservation, physicalInventory: 'unverified', ledgerReconciled: false,
  });
  expect(obligation.acceptance).toEqual({
    sourceRetirementMayBeSeparate: true, runtimeStatus: 'pending',
    historicalDeliveryStatus: 'pending', noDagRestorationRequirement: true,
  });
  for (const evidencePath of [trackedProofPath, trackedObligationsPath, trackedOriginsPath]) {
    expect(entry.evidence).toContain(evidencePath);
  }
  expect(facts.reachable(retirement.deletionCommit), 'Deletion must be reachable from HEAD').toBe(true);
  expect(facts.parents(retirement.deletionCommit)).toContain(retirement.deletionParent);
  expect(facts.blob(retirement.deletionParent, entry.path)).toBe(retirement.deletedParentBlob);
  expect(facts.blob(retirement.deletionCommit, entry.path)).toBeNull();
  expect(facts.deleted(retirement.deletionParent, retirement.deletionCommit, entry.path)).toBe(true);
  expect(facts.blob('HEAD', entry.path)).toBeNull();
  expect(facts.indexBlob(entry.path)).toBeNull();
  expect(facts.present(entry.path), 'Retired file must remain absent, including symlinks').toBe(false);
  for (const path of retirement.replacement.paths) {
    expect(path).toMatch(/^src\/[A-Za-z0-9_.\-[\]/]+$/u);
    expect(path.split('/')).not.toContain('..');
    expect(facts.present(path), path).toBe(true);
  }
}

function assertAdditionalEntry(entry: RecordedEntry, proof?: RetirementProof): void {
  if (entry.retirement?.schemaVersion === 2) {
    assertTrackedRetirement(entry as TrackedEntry, proof);
    return;
  }
  assertV1AdditionalEntry(entry as AdditionalReviewEntry, proof);
}

function assertTrackedCanonicalSet(record: ReturnType<typeof readRecord>): void {
  const origins = readTrackedDocument<V2OriginsDocument>(trackedOriginsPath);
  const document = readTrackedDocument<V2ProofDocument>(trackedProofPath);
  const all = [...record.entries, ...(record.additionalPaths ?? [])];
  const retired = all.filter(entry => entry.disposition === 'retired');
  const tracked = retired.filter(entry => entry.retirement?.schemaVersion === 2);
  expect(tracked.map(entry => entry.path).sort()).toEqual(document.retirements.map(row => row.path).sort());
  expect(record.entries.filter(entry => entry.disposition === 'retired')).toHaveLength(34);
  expect(record.additionalPaths?.filter(entry => entry.retirement?.schemaVersion === 2)).toHaveLength(4);
  expect(retired.map(entry => entry.path).sort()).toEqual(
    [...retirementPaths, ...origins.records.map(row => row.path)].sort(),
  );
  expect(record.entries.map(entry => trackedSourceTuple(entry))).toEqual(origins.original160SourceTuples);
  const authorizationBytes = readFileSync(resolve(recordDirectory, 'protected-source-authorizations.json'));
  expect(createHash('sha256').update(authorizationBytes).digest('hex')).toBe(origins.authorizationFileSha256);
  const authorizations = JSON.parse(authorizationBytes.toString('utf8')) as { authorizations: unknown[] };
  expect(authorizations.authorizations).toEqual(origins.original286Authorizations);
}

function assertV1AdditionalEntry(entry: AdditionalReviewEntry, proof?: RetirementProof): void {
  expect(entry.path).toMatch(/^[A-Za-z0-9_.\-[\]/]+$/u);
  expect(entry.path.split('/')).not.toContain('..');
  expect(entry.path).not.toMatch(/^\/|\/$/u);
  expect(entry.summary.trim()).not.toBe('');
  expect(entry.evidence.length).toBeGreaterThan(0);
  if (entry.disposition !== 'retired') {
    expect(entry.disposition).toBe('reviewed');
    expect(entry.reviewedBlob).toMatch(/^[a-f0-9]{40}$/u);
    return;
  }
  expect(retirementPaths.some(path => path === entry.path), 'Retirement is exact-path only').toBe(true);
  expect(entry.reviewedBlob).toBeNull();
  const retirement = entry.retirement;
  if (!retirement) throw new Error('Missing retirement metadata');
  expect(retirement.schemaVersion).toBe(1);
  for (const hash of [retirement.deletionCommit, retirement.deletionParent, retirement.deletedParentBlob]) {
    expect(hash).toMatch(/^[a-f0-9]{40}$/u);
  }
  expect(retirement.reason.trim().length).toBeGreaterThan(20);
  expect(retirement.obligations.status).toBe('none-owned-by-path');
  expect(retirement.obligations.reason.trim().length).toBeGreaterThan(20);
  expect(retirement.intent.basis).toBe('upstream-deletion-and-current-user-direction');
  expect(retirement.intent.userDirection.trim().length).toBeGreaterThan(20);
  expect(retirement.replacement.equivalence).toBe('not-claimed');
  expect(retirement.replacement.description.trim().length).toBeGreaterThan(20);
  expect(retirement.replacement.paths.length).toBeGreaterThan(0);
  for (const path of retirement.replacement.paths) {
    expect(path).toMatch(/^src\/[A-Za-z0-9_.\-[\]/]+$/u);
    expect(path.split('/')).not.toContain('..');
  }
  const reference = retirement.evidence;
  expect(reference.path).toMatch(/^docs\/testing\/evidence\/[A-Za-z0-9_.\-/]+\.json$/u);
  expect(reference.path.split('/')).not.toContain('..');
  expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(reference.jsonPointer).toMatch(/^\/retirements\/[0-3]$/u);
  expect(entry.evidence).toContain(reference.path);
  const facts = proof ?? repositoryRetirementProof();
  expect(facts.reachable(retirement.deletionCommit), 'Deletion must be reachable from HEAD').toBe(true);
  expect(facts.parents(retirement.deletionCommit)).toContain(retirement.deletionParent);
  expect(facts.blob(retirement.deletionParent, entry.path)).toBe(retirement.deletedParentBlob);
  expect(facts.blob(retirement.deletionCommit, entry.path)).toBeNull();
  expect(facts.deleted(retirement.deletionParent, retirement.deletionCommit, entry.path)).toBe(true);
  expect(facts.blob('HEAD', entry.path)).toBeNull();
  expect(facts.indexBlob(entry.path)).toBeNull();
  expect(facts.present(entry.path), 'Retired file must remain absent, including symlinks').toBe(false);
  for (const path of retirement.replacement.paths) expect(facts.present(path), path).toBe(true);
  const evidence = facts.evidence(reference.path);
  expect(evidence.ignored, 'Evidence must be versionable docs, not ignored output').toBe(false);
  expect(evidence.sha256).toBe(reference.sha256);
  const document = evidence.document as { schemaVersion: number; kind: string; retirements: unknown[] };
  expect(document.schemaVersion).toBe(1);
  expect(document.kind).toBe('pure-source-retirement-evidence');
  expect(document.retirements[Number(reference.jsonPointer.split('/').at(-1))]).toMatchObject({
    path: entry.path, schemaVersion: retirement.schemaVersion,
    deletionCommit: retirement.deletionCommit, deletionParent: retirement.deletionParent,
    deletedParentBlob: retirement.deletedParentBlob, reason: retirement.reason,
    replacement: retirement.replacement, obligations: retirement.obligations, intent: retirement.intent,
  });
}

function git(...args: string[]): string {
  return gitInput(args);
}

function gitInput(args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, input,
  }).trimEnd();
}

function repositoryRetirementProof(): RetirementProof {
  const ignoredByPath = new Map<string, boolean>();
  return {
    reachable: commit => {
      try { git('merge-base', '--is-ancestor', commit, 'HEAD'); return true; }
      catch { return false; }
    },
    parents: commit => git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1),
    deleted: (parent, commit, path) => git('diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', parent, commit, '--', path) === `D\t${path}`,
    blob: (ref, path) => {
      const object = gitInput(['cat-file', '--batch-check=%(objectname) %(objecttype)'], `${ref}:${path}\n`);
      if (object.endsWith(' missing')) return null;
      expect(object).toMatch(/^[a-f0-9]{40} blob$/u);
      return object.split(' ')[0];
    },
    indexBlob: path => {
      const indexed = git('ls-files', '--stage', '--', path);
      return indexed ? indexed.split(' ')[1] : null;
    },
    present: path => {
      try { lstatSync(resolve(path)); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    evidence: path => {
      const bytes = readFileSync(resolve(path));
      // Ignore rules are fixed for this proof instance; evidence bytes and digests stay live.
      if (!ignoredByPath.has(path)) {
        let ignored = true;
        try { git('check-ignore', '--no-index', '--', path); }
        catch (error) {
          if ((error as { status?: number }).status !== 1) throw error;
          ignored = false;
        }
        ignoredByPath.set(path, ignored);
      }
      return {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ignored: ignoredByPath.get(path)!, document: JSON.parse(bytes.toString('utf8')),
      };
    },
  };
}

function readRecord(view: 'all' | 'legacy-v1-additional' = 'legacy-v1-additional'): {
  comparisonBaseline: string;
  reviewedParent: string;
  entries: ReviewEntry[];
  additionalPaths?: (AdditionalReviewEntry | TrackedEntry)[];
} {
  const record = JSON.parse(readFileSync(resolve(recordDirectory, recordName), 'utf8')) as {
    comparisonBaseline: string; reviewedParent: string; entries: ReviewEntry[];
    additionalPaths?: (AdditionalReviewEntry | TrackedEntry)[];
  };
  if (view === 'all') return record;
  // Keep the unmodified exact-four V1 case scoped to V1. Real aggregates explicitly read all.
  return { ...record, additionalPaths: record.additionalPaths?.filter(entry =>
    !(entry.disposition === 'retired' && entry.retirement?.schemaVersion === 2)) };
}

function readAllowlist(): string[] {
  return JSON.parse(readFileSync(resolve(recordDirectory, 'protected-baseline-allowed-paths.json'), 'utf8'));
}


// Inherited from the original canonical record; these are not V1/V2 retirements.
const originalReviewedNullPaths = [
  'deploy-seed/system/api-providers.json',
  'deploy-seed/system/users.json',
  'scripts/bootstrap-local-tools.sh',
  'scripts/build-with-python-check.sh',
  'scripts/download-iopaint-models.sh',
  'scripts/download-models-background.sh',
  'scripts/download-removebg-models.sh',
  'scripts/ensure-models.sh',
  'scripts/ensure-python-env.sh',
  'scripts/export-deploy-seed.mjs',
  'scripts/iopaint_erase.py',
  'scripts/merge-model-parts.sh',
  'scripts/rembg_remove_background.py',
  'scripts/setup-venv.sh',
  'scripts/start-iopaint-lama.sh',
  'src/lib/image-tools/concurrency-gate.ts',
  'test-results/console/chrome-control-blocked-after-632c59d-20260720.json',
  'test-results/network/cloud-deployment-health-632c59d-20260720.json',
  'test-results/network/cloud-deployment-probe-8fc8f25-20260720.json',
  'test-results/network/pear-layer-retry-f8f7cef.json',
] as const;

function assertOriginalEntryLifecycle(entry: RecordedEntry, proof?: RetirementProof): void {
  // Existing original reviewed/null entries describe approved historical absence.
  // Null alone is never a retirement: registered V2 paths and any retirement claim
  // still require the complete, unchanged V2 validator.
  const trackedPath = readTrackedDocument<TrackedOriginsDocument>(trackedOriginsPath)
    .records.some(record => record.path === entry.path);
  if (trackedPath || entry.disposition === 'retired' || entry.retirement !== undefined) {
    expect(entry.retirement?.schemaVersion).toBe(2);
    assertAdditionalEntry(entry, proof);
  } else {
    expect(['reviewed', 'hold']).toContain(entry.disposition);
    if (entry.disposition === 'reviewed' && entry.reviewedBlob === null) {
      expect(originalReviewedNullPaths.some(path => path === entry.path),
        'Reviewed null is limited to the original 20 exact paths').toBe(true);
    }
  }
  if (entry.reviewedBlob) expect(entry.reviewedBlob).toMatch(/^[a-f0-9]{40}$/u);
}

it('records every original production acceptance blocker as an exact reviewed version or an explicit hold', () => {
  const review = readRecord('all');
  const entries = review.entries;
  const proof = repositoryTrackedRetirementProof();
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
    assertOriginalEntryLifecycle(entry, proof);
    expect(entry.summary.trim()).not.toBe('');
    expect(entry.evidence.length).toBeGreaterThan(0);
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
  const record = readRecord('all');
  const { entries, additionalPaths = [] } = record;
  assertTrackedCanonicalSet(record);
  const proof = repositoryTrackedRetirementProof(additionalPaths);
  const allEntries = [...entries, ...additionalPaths];
  expect(new Set(allEntries.map(entry => entry.path.toLowerCase())).size).toBe(allEntries.length);
  for (const entry of additionalPaths) {
    assertAdditionalEntry(entry, proof);
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
    expect(allowlist.filter(allowed => allowed === entry.path)).toHaveLength(entry.disposition === 'hold' ? 0 : 1);
    if (entry.disposition === 'hold') continue;
    if (entry.disposition === 'retired') {
      assertAdditionalEntry(entry, proof);
      continue;
    }
    const currentBlob = locallyChanged.has(entry.path)
      ? worktreeObjectByPath.get(entry.path) ?? null
      : indexObjects.get(entry.path) ?? null;
    expect(currentBlob, 'Unreviewed change to ' + entry.path).toBe(entry.reviewedBlob);
  }
});

const retirementPaths = [
  'src/lib/video-director/index.ts',
  'src/lib/video-director/model-capabilities.ts',
  'src/lib/video-director/reference-binding.ts',
  'src/lib/video-panel-events.ts',
] as const;

function retirementFixture(): AdditionalReviewEntry {
  return {
    path: retirementPaths[0], reviewedBlob: null, disposition: 'retired',
    summary: 'Retire the deleted director export facade; use the concrete modules.',
    evidence: ['docs/testing/evidence/2026-11-21-retirement-registration/retirement-proof.json'],
    retirement: {
      schemaVersion: 1,
      deletionCommit: '9c8249e9fef309b55152060ce412160ef80456b0',
      deletionParent: '738ed3c835fb7a0d602cc17019788460b1e2537b',
      deletedParentBlob: '6ec92951c7a89d83d3ebefd37cb8df409ab49f8e',
      reason: 'The upstream removed this export-only facade when video creation moved into drama.',
      replacement: { description: 'Use concrete continuity types and drama entry; no API equivalence claim.',
        paths: ['src/lib/video-director/continuity.ts'], equivalence: 'not-claimed' },
      obligations: { status: 'none-owned-by-path', reason: 'This facade only re-exports symbols; it owns no data, task or billing lifecycle.' },
      intent: { basis: 'upstream-deletion-and-current-user-direction', userDirection: 'Align with the latest upstream program and do not restore the retired UI or empty stubs.' },
      evidence: { path: 'docs/testing/evidence/2026-11-21-retirement-registration/retirement-proof.json', sha256: 'a'.repeat(64), jsonPointer: '/retirements/0' },
    },
  };
}

function fixtureProof(): RetirementProof {
  const entry = retirementFixture();
  return {
    reachable: () => true,
    parents: () => [entry.retirement!.deletionParent],
    deleted: () => true,
    blob: ref => ref === entry.retirement!.deletionParent ? entry.retirement!.deletedParentBlob : null,
    indexBlob: () => null,
    present: path => path === 'src/lib/video-director/continuity.ts',
    evidence: () => ({ sha256: 'a'.repeat(64), ignored: false, document: { schemaVersion: 1,
      kind: 'pure-source-retirement-evidence', retirements: [{ path: entry.path, ...entry.retirement! }] } }),
  };
}

it('retirement record contract: permits null only for an evidenced exact retirement', () => {
  expect(() => assertAdditionalEntry(retirementFixture(), fixtureProof())).not.toThrow();
});

it('retirement record contract: registers exactly the four reviewed source retirements', () => {
  const entries = (readRecord().additionalPaths || []).filter(entry => entry.disposition === 'retired');
  expect(entries.map(entry => entry.path).sort()).toEqual([...retirementPaths].sort());
  const allowlist = readAllowlist();
  for (const entry of entries) {
    expect(allowlist.filter(path => path === entry.path)).toHaveLength(1);
    assertAdditionalEntry(entry);
  }
});

it.each([
  { name: 'unreachable deletion', patch: { reachable: () => false } },
  { name: 'wrong actual parent', patch: { parents: () => ['f'.repeat(40)] } },
  { name: 'wrong parent blob', patch: { blob: () => 'f'.repeat(40) } },
  { name: 'commit that did not delete the path', patch: { deleted: () => false } },
  { name: 'path still in deletion commit', patch: { blob: (ref: string) => ref === retirementFixture().retirement!.deletionCommit ? 'f'.repeat(40) : fixtureProof().blob(ref, retirementPaths[0]) } },
  { name: 'restored HEAD path', patch: { blob: (ref: string) => ref === 'HEAD' ? 'f'.repeat(40) : fixtureProof().blob(ref, retirementPaths[0]) } },
  { name: 'restored index path', patch: { indexBlob: () => 'f'.repeat(40) } },
  { name: 'restored worktree path or dangling symlink', patch: { present: () => true } },
  { name: 'missing replacement path', patch: { present: () => false } },
  { name: 'ignored evidence', patch: { evidence: () => ({ ...fixtureProof().evidence(''), ignored: true }) } },
  { name: 'changed evidence hash', patch: { evidence: () => ({ ...fixtureProof().evidence(''), sha256: 'f'.repeat(64) }) } },
  { name: 'evidence for another path', patch: { evidence: () => ({ ...fixtureProof().evidence(''), document: { schemaVersion: 1, kind: 'pure-source-retirement-evidence', retirements: [{ ...retirementFixture().retirement!, path: 'src/lib/unreviewed-missing.ts' }] } }) } },
])('retirement record contract: rejects $name', ({ patch }) => {
  expect(() => assertAdditionalEntry(retirementFixture(), { ...fixtureProof(), ...patch })).toThrow();
});

it.each([
  { name: 'ordinary additional null', mutate: (entry: AdditionalReviewEntry) => { entry.disposition = 'reviewed'; } },
  { name: 'unreviewed missing source', mutate: (entry: AdditionalReviewEntry) => { entry.path = 'src/lib/unreviewed-missing.ts'; } },
  { name: 'directory wildcard', mutate: (entry: AdditionalReviewEntry) => { entry.path = 'src/lib/video-director/*'; } },
  { name: 'case variant', mutate: (entry: AdditionalReviewEntry) => { entry.path = 'src/lib/video-director/Index.ts'; } },
  { name: 'old blob used as current', mutate: (entry: AdditionalReviewEntry) => { entry.reviewedBlob = entry.retirement!.deletedParentBlob; } },
  { name: 'empty blob used as current', mutate: (entry: AdditionalReviewEntry) => { entry.reviewedBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'; } },
  { name: 'no metadata', mutate: (entry: AdditionalReviewEntry) => { delete entry.retirement; } },
  { name: 'no deletion commit', mutate: (entry: AdditionalReviewEntry) => { entry.retirement!.deletionCommit = ''; } },
  { name: 'no reason', mutate: (entry: AdditionalReviewEntry) => { entry.retirement!.reason = ''; } },
  { name: 'no replacement', mutate: (entry: AdditionalReviewEntry) => { entry.retirement!.replacement.paths = []; } },
  { name: 'output-only evidence', mutate: (entry: AdditionalReviewEntry) => { entry.retirement!.evidence.path = 'output/review.json'; } },
])('retirement record contract: rejects $name', ({ mutate }) => {
  const entry = retirementFixture(); mutate(entry);
  expect(() => assertAdditionalEntry(entry, fixtureProof())).toThrow();
});


// Stage 1: exercise the existing validator with V2 JSON; no V2 guard is installed here.
const trackedRetirementDirectory = 'docs/testing/evidence/2026-11-21-tracked-retirement';
const trackedProofPath = trackedRetirementDirectory + '/retirement-proof.json';
const trackedObligationsPath = trackedRetirementDirectory + '/historical-obligations.json';
const trackedOriginsPath = trackedRetirementDirectory + '/source-origins.json';

type TrackedSourceTuple = [string, 'main' | 'candidate' | null, string | null, string | null];

interface TrackedPreviousRecord {
  path: string;
  source?: 'main' | 'candidate';
  sourceCommit?: string | null;
  sourceBlob?: string | null;
  reviewedBlob: string | null;
  disposition: string;
  summary: string;
  evidence: string[];
  reviewHistory?: unknown[];
}

interface TrackedOriginRecord {
  path: string;
  canonicalPointer: string;
  previousRecord: TrackedPreviousRecord;
  previousRecordSha256: string;
  originalSourceTuple: TrackedSourceTuple;
  originalSourceTupleSha256: string;
}

interface TrackedOriginsDocument {
  schemaVersion: number;
  kind: string;
  original160SourceTuples: TrackedSourceTuple[];
  original286Authorizations: { path: string; sourceCommit: string }[];
  records: TrackedOriginRecord[];
}

interface TrackedPreservation {
  physicalDataPreservation: string;
  cleanupAuthorized: boolean;
  migrationExecutionAuthorized: boolean;
  newPaidReplacementAuthorized: boolean;
  accountingDelivered: boolean;
  recoveryOrExportDelivered: boolean;
}

interface TrackedRetirement {
  schemaVersion: number;
  kind: string;
  deletionCommit: string;
  deletionParent: string;
  deletedParentBlob: string;
  reason: string;
  replacement: {
    description: string;
    paths: string[];
    equivalence: string;
    nonEquivalentGap: string;
  };
  intent: { basis: string; upstreamCommits: string[]; userDirection: string };
  obligations: {
    status: string;
    reason: string;
    categories: string[];
    preservation: TrackedPreservation;
    evidence: { path: string; sha256: string; jsonPointer: string };
  };
  acceptance: {
    sourceScope: string;
    runtimeStatus: string;
    historicalDeliveryStatus: string;
    equivalence: string;
  };
  origin: {
    canonicalPointer: string;
    previousRecordSha256: string;
    originalSourceTupleSha256: string;
  };
  evidence: { path: string; sha256: string; jsonPointer: string };
}

interface TrackedProofRow extends Omit<TrackedRetirement, 'evidence'> {
  path: string;
  canonicalPointer: string;
  sourceOnly: boolean;
  runtimeStatus: string;
  historicalDeliveryStatus: string;
  observedDeletionFacts: {
    path: string;
    deletionCommit: string;
    deletionParent: string;
    deletedParentBlob: string;
    absentInWorkingTreeIncludingSymlink: boolean;
    reachableFromHead: boolean;
  };
}

interface TrackedProofDocument {
  schemaVersion: number;
  kind: string;
  sourceOrigins: { path: string; sha256: string };
  obligationEvidence: { path: string; sha256: string };
  retirements: TrackedProofRow[];
}

interface TrackedObligationRow {
  path: string;
  status: string;
  categories: string[];
  sourceIdentity: {
    deletionParent: string;
    deletedParentBlob: string;
    originalRecordSha256: string;
  };
  preservation: TrackedPreservation & {
    physicalInventory: string;
    ledgerReconciled: boolean;
  };
  acceptance: {
    sourceRetirementMayBeSeparate: boolean;
    runtimeStatus: string;
    historicalDeliveryStatus: string;
    noDagRestorationRequirement: boolean;
  };
}

interface TrackedObligationsDocument {
  schemaVersion: number;
  kind: string;
  obligations: TrackedObligationRow[];
}

interface TrackedHistory {
  previous: TrackedPreviousRecord;
  previousRecordSha256: string;
  sourceOnly: boolean;
  historicalDeliveryStatus: string;
}

interface TrackedEntry extends TrackedPreviousRecord {
  formalAcceptance: string;
  reviewHistory: unknown[];
  retirement?: TrackedRetirement;
}

// Independent before-image oracle for the future V2 seam; V1 and its proof stay unchanged.
interface TrackedProof extends RetirementProof {
  originalRecord: (path: string) => TrackedOriginRecord | null;
}

interface TrackedFixture {
  entry: TrackedEntry;
  retirement: TrackedRetirement;
  history: TrackedHistory;
  ledger: TrackedObligationRow;
  proof: TrackedProof;
  rebindEvidence: () => void;
}

function readTrackedDocument<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function trackedDigest(document: unknown): string {
  return createHash('sha256').update(JSON.stringify(document, null, 2) + '\n').digest('hex');
}

function trackedSourceTuple(record: TrackedPreviousRecord): TrackedSourceTuple {
  return [record.path, record.source ?? null, record.sourceCommit ?? null, record.sourceBlob ?? null];
}

function trackedFixture(index = 0): TrackedFixture {
  const proofDocument = readTrackedDocument<TrackedProofDocument>(trackedProofPath);
  const obligationsDocument = readTrackedDocument<TrackedObligationsDocument>(trackedObligationsPath);
  const originsDocument = readTrackedDocument<TrackedOriginsDocument>(trackedOriginsPath);
  const row = proofDocument.retirements[index];
  const ledger = obligationsDocument.obligations[index];
  const original = structuredClone(originsDocument.records[index]);
  if (!row || !ledger || !original) throw new Error('Missing published tracked-retirement fixture');
  const facts = structuredClone(row.observedDeletionFacts);
  const replacementPaths = new Set(row.replacement.paths);
  const retirement: TrackedRetirement = {
    schemaVersion: row.schemaVersion, kind: row.kind,
    deletionCommit: row.deletionCommit, deletionParent: row.deletionParent,
    deletedParentBlob: row.deletedParentBlob, reason: row.reason,
    replacement: structuredClone(row.replacement), intent: structuredClone(row.intent),
    obligations: structuredClone(row.obligations), acceptance: structuredClone(row.acceptance),
    origin: structuredClone(row.origin),
    evidence: { path: trackedProofPath, sha256: trackedDigest(proofDocument), jsonPointer: '/retirements/' + index },
  };
  const history: TrackedHistory = {
    previous: structuredClone(original.previousRecord),
    previousRecordSha256: original.previousRecordSha256,
    sourceOnly: true, historicalDeliveryStatus: 'pending',
  };
  const entry: TrackedEntry = {
    ...structuredClone(original.previousRecord),
    reviewedBlob: null, disposition: 'retired',
    summary: 'Source-only retirement with explicitly tracked, unverified historical obligations.',
    evidence: [...original.previousRecord.evidence, trackedProofPath, trackedObligationsPath, trackedOriginsPath],
    retirement, formalAcceptance: 'runtime-pending',
    reviewHistory: [...(original.previousRecord.reviewHistory ?? []), history],
  };
  const documents = new Map<string, unknown>([
    [trackedProofPath, proofDocument],
    [trackedObligationsPath, obligationsDocument],
    [trackedOriginsPath, originsDocument],
  ]);
  const proof: TrackedProof = {
    reachable: commit => commit === facts.deletionCommit && facts.reachableFromHead,
    parents: commit => commit === facts.deletionCommit ? [facts.deletionParent] : [],
    deleted: (parent, commit, path) => parent === facts.deletionParent
      && commit === facts.deletionCommit && path === facts.path,
    blob: (ref, path) => ref === facts.deletionParent && path === facts.path
      ? facts.deletedParentBlob : null,
    indexBlob: () => null,
    present: path => path === facts.path
      ? !facts.absentInWorkingTreeIncludingSymlink : replacementPaths.has(path),
    evidence: path => {
      if (!documents.has(path)) throw new Error('Unbound tracked-retirement evidence');
      const document = documents.get(path);
      return { sha256: trackedDigest(document), ignored: false, document };
    },
    originalRecord: path => path === original.path ? structuredClone(original) : null,
  };
  const rebindEvidence = () => {
    const metadata = entry.retirement;
    if (!metadata) return;
    // Model a coherent malicious publication, rather than a trivially mismatched JSON copy.
    metadata.origin.previousRecordSha256 = createHash('sha256').update(JSON.stringify(history.previous)).digest('hex');
    metadata.origin.originalSourceTupleSha256 = createHash('sha256').update(JSON.stringify(trackedSourceTuple(entry))).digest('hex');
    history.previousRecordSha256 = metadata.origin.previousRecordSha256;
    ledger.path = entry.path;
    ledger.status = metadata.obligations.status;
    ledger.categories = [...metadata.obligations.categories];
    ledger.sourceIdentity.deletionParent = metadata.deletionParent;
    ledger.sourceIdentity.deletedParentBlob = metadata.deletedParentBlob;
    ledger.sourceIdentity.originalRecordSha256 = metadata.origin.previousRecordSha256;
    Object.assign(ledger.preservation, metadata.obligations.preservation);
    ledger.acceptance.runtimeStatus = metadata.acceptance.runtimeStatus;
    ledger.acceptance.historicalDeliveryStatus = metadata.acceptance.historicalDeliveryStatus;
    metadata.obligations.evidence.sha256 = trackedDigest(obligationsDocument);
    proofDocument.obligationEvidence.sha256 = metadata.obligations.evidence.sha256;
    Object.assign(row, {
      path: entry.path, schemaVersion: metadata.schemaVersion, kind: metadata.kind,
      deletionCommit: metadata.deletionCommit, deletionParent: metadata.deletionParent,
      deletedParentBlob: metadata.deletedParentBlob, reason: metadata.reason,
      replacement: structuredClone(metadata.replacement), intent: structuredClone(metadata.intent),
      obligations: structuredClone(metadata.obligations), acceptance: structuredClone(metadata.acceptance),
      origin: structuredClone(metadata.origin),
    });
    metadata.evidence.sha256 = trackedDigest(proofDocument);
  };
  return { entry, retirement, history, ledger, proof, rebindEvidence };
}

function invokeExistingRetirementValidator(fixture: TrackedFixture): void {
  // JSON is a runtime boundary. Do not change the old V1 parameter types or install a V2 guard in RED.
  Reflect.apply(assertAdditionalEntry, undefined, [fixture.entry, fixture.proof]);
}

it('tracked retirement V2 contract: preserves the actual original 160 and 286 source tuples', () => {
  const origins = readTrackedDocument<TrackedOriginsDocument>(trackedOriginsPath);
  expect(readRecord().entries.map(entry => trackedSourceTuple(entry))).toEqual(origins.original160SourceTuples);
  expect(origins.original160SourceTuples).toHaveLength(160);
  const current = JSON.parse(readFileSync(resolve(recordDirectory, 'protected-source-authorizations.json'), 'utf8')) as {
    authorizations: { path: string; sourceCommit: string }[];
  };
  expect(current.authorizations).toEqual(origins.original286Authorizations);
  expect(origins.original286Authorizations).toHaveLength(286);
});

it('tracked retirement V2 contract: accepts all 38 exact source retirements with history pending', () => {
  const document = readTrackedDocument<TrackedProofDocument>(trackedProofPath);
  const origins = readTrackedDocument<TrackedOriginsDocument>(trackedOriginsPath);
  expect(document.retirements).toHaveLength(38);
  expect(new Set(document.retirements.map(row => row.path)).size).toBe(38);
  expect(origins.records.filter(row => row.canonicalPointer.startsWith('/entries/'))).toHaveLength(34);
  expect(origins.records.filter(row => row.canonicalPointer.startsWith('/additionalPaths/'))).toHaveLength(4);
  for (let index = 0; index < document.retirements.length; index++) {
    const fixture = trackedFixture(index);
    expect(fixture.retirement.obligations.status).toBe('tracked-preserved-pending');
    expect(fixture.retirement.obligations.preservation.physicalDataPreservation).toBe('unverified');
    expect(() => invokeExistingRetirementValidator(fixture), fixture.entry.path).not.toThrow();
  }
});

it.each<{ name: string; mutate: (fixture: TrackedFixture) => void }>([
  { name: 'an unlisted path with coherently rebound evidence',
    mutate: fixture => { fixture.entry.path = 'src/lib/unreviewed-tracked-retirement.ts'; } },
  { name: 'a directory wildcard',
    mutate: fixture => { fixture.entry.path = 'src/lib/workflow-*'; } },
  { name: 'a case variant of the exact path',
    mutate: fixture => { fixture.entry.path = 'src/app/api/workflow/Image-actions/route.ts'; } },
  { name: 'deletion commit substituted for original source commit',
    mutate: fixture => { fixture.entry.sourceCommit = fixture.retirement.deletionCommit; } },
  { name: 'deleted-parent blob substituted for original source blob',
    mutate: fixture => { fixture.entry.sourceBlob = fixture.retirement.deletedParentBlob; } },
  { name: 'original source relabeled as candidate',
    mutate: fixture => { fixture.entry.source = 'candidate'; } },
  { name: 'missing complete previous history',
    mutate: fixture => { fixture.entry.reviewHistory = []; } },
  { name: 'rewritten previous source and matching forged history digests',
    mutate: fixture => {
      fixture.entry.sourceCommit = fixture.retirement.deletionCommit;
      fixture.history.previous.sourceCommit = fixture.retirement.deletionCommit;
    } },
  { name: 'wrong original canonical array position',
    mutate: fixture => { fixture.retirement.origin.canonicalPointer = '/additionalPaths/49'; } },
  { name: 'real historical obligations laundered as none-owned-by-path',
    mutate: fixture => { fixture.retirement.obligations.status = 'none-owned-by-path'; } },
  { name: 'historical obligations marked completed',
    mutate: fixture => { fixture.retirement.obligations.status = 'completed'; } },
  { name: 'runtime marked completed',
    mutate: fixture => { fixture.retirement.acceptance.runtimeStatus = 'completed'; } },
  { name: 'historical delivery marked completed',
    mutate: fixture => { fixture.retirement.acceptance.historicalDeliveryStatus = 'completed'; } },
  { name: 'physical preservation claimed verified',
    mutate: fixture => { fixture.retirement.obligations.preservation.physicalDataPreservation = 'verified'; } },
  { name: 'cleanup authorization',
    mutate: fixture => { fixture.retirement.obligations.preservation.cleanupAuthorized = true; } },
  { name: 'destructive migration authorization',
    mutate: fixture => { fixture.retirement.obligations.preservation.migrationExecutionAuthorized = true; } },
  { name: 'new paid replacement authorization',
    mutate: fixture => { fixture.retirement.obligations.preservation.newPaidReplacementAuthorized = true; } },
  { name: 'accounting delivery claimed complete',
    mutate: fixture => { fixture.retirement.obligations.preservation.accountingDelivered = true; } },
  { name: 'ledger reconciliation claimed complete only in the bound ledger',
    mutate: fixture => { fixture.ledger.preservation.ledgerReconciled = true; } },
  { name: 'physical inventory claimed verified only in the bound ledger',
    mutate: fixture => { fixture.ledger.preservation.physicalInventory = 'verified'; } },
  { name: 'recovery or export claimed complete',
    mutate: fixture => { fixture.retirement.obligations.preservation.recoveryOrExportDelivered = true; } },
  { name: 'replacement equivalence claimed',
    mutate: fixture => { fixture.retirement.replacement.equivalence = 'claimed'; } },
  { name: 'missing V2 metadata',
    mutate: fixture => { delete fixture.entry.retirement; } },
])('tracked retirement V2 contract: rejects $name after accepting the valid base', ({ mutate }) => {
  const fixture = trackedFixture();
  expect(() => invokeExistingRetirementValidator(fixture)).not.toThrow();
  mutate(fixture);
  fixture.rebindEvidence();
  expect(() => invokeExistingRetirementValidator(fixture)).toThrow();
});

it.each<{ name: string; patch: (proof: TrackedProof, path: string) => TrackedProof }>([
  { name: 'a restored path or dangling symlink',
    patch: (proof, path) => ({ ...proof, present: candidate => candidate === path || proof.present(candidate) }) },
  { name: 'an original before-image that cannot be resolved',
    patch: proof => ({ ...proof, originalRecord: () => null }) },
])('tracked retirement V2 contract: rejects $name after accepting the valid proof', ({ patch }) => {
  const fixture = trackedFixture();
  expect(() => invokeExistingRetirementValidator(fixture)).not.toThrow();
  fixture.proof = patch(fixture.proof, fixture.entry.path);
  expect(() => invokeExistingRetirementValidator(fixture)).toThrow();
});


it('original review aggregate lifecycle: preserves existing reviewed-null originals without creating retirements', () => {
  const legacy = readRecord('all').entries.filter(entry =>
    entry.disposition === 'reviewed' && entry.reviewedBlob === null && entry.retirement === undefined);
  expect(legacy.map(entry => entry.path).sort()).toEqual([...originalReviewedNullPaths].sort());
  for (const entry of legacy) {
    expect(() => assertOriginalEntryLifecycle(entry), entry.path).not.toThrow();
    expect(entry.disposition).toBe('reviewed');
    expect(entry.retirement).toBeUndefined();
  }
});

it('original review aggregate lifecycle: rejects a strict V2 relabeled reviewed-null', () => {
  const fixture = trackedFixture();
  expect(() => assertOriginalEntryLifecycle(fixture.entry, fixture.proof)).not.toThrow();
  fixture.entry.disposition = 'reviewed';
  fixture.rebindEvidence();
  expect(() => assertOriginalEntryLifecycle(fixture.entry, fixture.proof)).toThrow();
});

it('original review aggregate lifecycle: rejects reviewed-null after stripping a registered V2 metadata', () => {
  const fixture = trackedFixture();
  expect(() => assertOriginalEntryLifecycle(fixture.entry, fixture.proof)).not.toThrow();
  fixture.entry.disposition = 'reviewed';
  delete fixture.entry.retirement;
  expect(() => assertOriginalEntryLifecycle(fixture.entry, fixture.proof)).toThrow();
});

it('original review aggregate lifecycle: rejects a new reviewed-null path outside the original 20', () => {
  const original = readRecord('all').entries.find(entry => entry.path === originalReviewedNullPaths[0]);
  if (!original) throw new Error('Missing original reviewed-null fixture');
  expect(() => assertOriginalEntryLifecycle(original)).not.toThrow();
  const entry = structuredClone(original);
  entry.path = 'scripts/new-unreviewed-null.ts';
  expect(() => assertOriginalEntryLifecycle(entry)).toThrow();
});
