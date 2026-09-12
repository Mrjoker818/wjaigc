import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  validateBriefToVideoEvidence,
  validateCandidateProvenance,
  validateCloudEvidence,
} from '../../../scripts/brief-to-video-evidence.mjs';

const temporaryRoots: string[] = [];
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const hex = (value: string): string => value.repeat(64).slice(0, 64);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function provenance() {
  return {
    scheme: 'git-parent-subtrees-v1',
    expectedParentCommit: '1'.repeat(40),
    candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
  };
}

const provenanceSha = (): string => sha256(JSON.stringify(provenance()));

describe('Brief-to-video evidence validation', () => {
  it('rejects candidate provenance that does not match the checked out parent and subtrees', () => {
    expect(validateCandidateProvenance(provenance(), {
      parentCommit: '1'.repeat(40),
      candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
    })).toEqual({ ok: true, detail: expect.stringContaining('git-parent-subtrees-v1') });

    expect(validateCandidateProvenance(provenance(), {
      parentCommit: '9'.repeat(40),
      candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
    }).ok).toBe(false);
  });

  it('verifies the exact four-project set and every declared artifact hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brief-video-evidence-'));
    temporaryRoots.push(root);
    const projects = ['chromium', 'firefox', 'webkit', 'mobile-chromium'];
    const records = [];
    for (const project of projects) {
      const directory = join(root, project);
      await mkdir(directory, { recursive: true });
      const machine = JSON.stringify({
        project,
        candidateSha: provenanceSha(),
        candidateProvenance: provenance(),
      });
      await writeFile(join(directory, 'machine-evidence.json'), machine);
      const manifest = {
        schemaVersion: 2,
        project,
        status: 'passed',
        cloudVerified: false,
        supplierVerified: false,
        candidateSha: provenanceSha(),
        candidateProvenance: provenance(),
        artifactErrors: [],
        files: [{ name: 'machine-evidence.json', bytes: Buffer.byteLength(machine), sha256: sha256(machine) }],
      };
      const manifestPath = join(directory, 'evidence-manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));
      records.push({ name: project, manifest: manifestPath, machineEvidenceSha256: sha256(machine) });
    }
    const evidence = {
      local: { verdict: 'LOCAL PASS', playwright: { passed: 4, failed: 0, projects: records } },
      candidateSha: provenanceSha(),
      sourceCommit: provenance(),
      cloud: { verdict: 'CLOUD UNVERIFIED' },
    };

    await expect(validateBriefToVideoEvidence(evidence, {
      repositoryRoot: root,
      git: {
        parentCommit: '1'.repeat(40),
        candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
      },
    })).resolves.toMatchObject({ local: { ok: true }, cloud: { ok: false, blocked: true } });

    const originalDigest = evidence.local.playwright.projects[0].machineEvidenceSha256;
    evidence.local.playwright.projects[0].machineEvidenceSha256 = hex('a');
    await expect(validateBriefToVideoEvidence(evidence, {
      repositoryRoot: root,
      git: {
        parentCommit: '1'.repeat(40),
        candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
      },
    })).resolves.toMatchObject({ local: { ok: false } });

    evidence.local.playwright.projects[0].machineEvidenceSha256 = originalDigest;
    evidence.candidateSha = hex('f');
    await expect(validateBriefToVideoEvidence(evidence, {
      repositoryRoot: root,
      git: {
        parentCommit: '1'.repeat(40),
        candidateTrees: { src: '2'.repeat(40), tests: '3'.repeat(40), scripts: '4'.repeat(40) },
      },
    })).resolves.toMatchObject({ local: { ok: false } });
  });

  it('requires complete successful and cancelled cloud chains before CLOUD PASS', () => {
    const complete = {
      verdict: 'CLOUD PASS',
      exactCommit: '5'.repeat(40),
      successfulRun: {
        runId: 'run-success', internalTaskId: 'task-success', remoteTaskId: 'remote-success',
        chargeTransactionId: 'charge-success', videoAssetVersionId: 'version-video',
        parentVersionIds: ['version-first', 'version-last'], mime: 'video/mp4',
        signature: '000000206674797069736f6d', durationSeconds: 5,
        resolution: { width: 1080, height: 1920 },
        artifact: { sha256: hex('b'), bytes: 1024 },
      },
      cancelledRun: {
        runId: 'run-cancel', internalTaskId: 'task-cancel', remoteTaskId: 'remote-cancel',
        chargeTransactionId: 'charge-cancel', refundTransactionId: 'refund-cancel',
        refundAmount: 60, lateCompletionSuppressed: true,
      },
    };
    expect(validateCloudEvidence(complete)).toEqual({ ok: true, blocked: false, detail: expect.stringContaining('CLOUD PASS') });
    expect(validateCloudEvidence({ ...complete, cancelledRun: { ...complete.cancelledRun, refundTransactionId: undefined } }).ok).toBe(false);
    expect(validateCloudEvidence({ ...complete, successfulRun: { ...complete.successfulRun, parentVersionIds: [] } }).ok).toBe(false);
    expect(validateCloudEvidence({ verdict: 'CLOUD UNVERIFIED' })).toMatchObject({ ok: false, blocked: true });
  });
});
