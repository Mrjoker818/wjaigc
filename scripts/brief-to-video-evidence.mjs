import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXPECTED_PROJECTS = ['chromium', 'firefox', 'webkit', 'mobile-chromium'];
const REQUIRED_ARTIFACTS = ['console.json', 'network.json', 'final.png', 'trace.zip', 'video.webm', 'machine-evidence.json'];
const HEX_40 = /^[a-f0-9]{40}$/u;
const HEX_64 = /^[a-f0-9]{64}$/u;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function provenanceSha(provenance) {
  return sha256(Buffer.from(JSON.stringify(provenance)));
}

function sameProvenance(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateCandidateProvenance(raw, git) {
  const provenance = record(raw);
  const trees = record(provenance?.candidateTrees);
  const gitTrees = record(git?.candidateTrees);
  if (provenance?.scheme !== 'git-parent-subtrees-v1') {
    return { ok: false, detail: 'candidate provenance scheme is missing or unsupported' };
  }
  if (!HEX_40.test(String(provenance.expectedParentCommit || ''))
    || provenance.expectedParentCommit !== git?.parentCommit) {
    return { ok: false, detail: 'candidate parent commit does not match HEAD^' };
  }
  for (const name of ['src', 'tests', 'scripts']) {
    if (!HEX_40.test(String(trees?.[name] || '')) || trees[name] !== gitTrees?.[name]) {
      return { ok: false, detail: `candidate ${name} tree does not match HEAD:${name}` };
    }
  }
  return { ok: true, detail: `git-parent-subtrees-v1 parent=${provenance.expectedParentCommit}` };
}

export async function readCandidateGitState(repositoryRoot, options = {}) {
  const git = async (...args) => (await execFileAsync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  })).stdout.trim();
  const indexMode = options.index === true;
  const candidateTree = indexMode ? await git('write-tree') : 'HEAD';
  const [parentCommit, src, tests, scripts] = await Promise.all([
    git('rev-parse', indexMode ? 'HEAD' : 'HEAD^'),
    git('rev-parse', `${candidateTree}:src`),
    git('rev-parse', `${candidateTree}:tests`),
    git('rev-parse', `${candidateTree}:scripts`),
  ]);
  const candidateCommit = indexMode ? undefined : await git('rev-parse', 'HEAD');
  return { parentCommit, candidateCommit, candidateTrees: { src, tests, scripts } };
}

export function validateCloudEvidence(raw, options = {}) {
  const cloud = record(raw);
  if (cloud?.verdict !== 'CLOUD PASS') {
    return { ok: false, blocked: true, detail: 'CLOUD UNVERIFIED' };
  }
  const successful = record(cloud.successfulRun);
  const cancelled = record(cloud.cancelledRun);
  const resolution = record(successful?.resolution);
  const artifact = record(successful?.artifact);
  const successOk = HEX_40.test(String(options.expectedExactCommit || ''))
    && cloud.exactCommit === options.expectedExactCommit
    && ['runId', 'internalTaskId', 'remoteTaskId', 'chargeTransactionId', 'videoAssetVersionId']
      .every(key => string(successful?.[key]))
    && Array.isArray(successful?.parentVersionIds)
    && successful.parentVersionIds.length > 0
    && successful.parentVersionIds.every(string)
    && typeof successful?.mime === 'string' && successful.mime.startsWith('video/')
    && string(successful?.signature)
    && Number(successful?.durationSeconds) > 0
    && Number(resolution?.width) > 0 && Number(resolution?.height) > 0
    && HEX_64.test(String(artifact?.sha256 || '')) && Number(artifact?.bytes) > 0;
  const cancelOk = ['runId', 'internalTaskId', 'remoteTaskId', 'chargeTransactionId', 'refundTransactionId']
    .every(key => string(cancelled?.[key]))
    && Number(cancelled?.refundAmount) > 0
    && cancelled?.lateCompletionSuppressed === true;
  return successOk && cancelOk
    ? { ok: true, blocked: false, detail: 'CLOUD PASS with success, cancellation, billing, lineage and media evidence' }
    : { ok: false, blocked: false, detail: 'CLOUD PASS payload is incomplete or invalid' };
}

export async function validateBriefToVideoEvidence(evidence, options) {
  const provenance = validateCandidateProvenance(evidence?.sourceCommit, options.git);
  const projects = evidence?.local?.playwright?.projects;
  const names = Array.isArray(projects) ? projects.map(item => item?.name).sort() : [];
  const expectedNames = [...(options.expectedProjects || EXPECTED_PROJECTS)].sort();
  const expectedCandidateSha = provenanceSha(evidence?.sourceCommit);
  const errors = [];
  if (evidence?.local?.verdict !== 'LOCAL PASS') errors.push('local verdict is not LOCAL PASS');
  if (evidence?.local?.playwright?.passed !== 4 || evidence?.local?.playwright?.failed !== 0) {
    errors.push('Playwright summary is not 4 passed / 0 failed');
  }
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) errors.push('Playwright project set is not exact');
  if (!provenance.ok) errors.push(provenance.detail);
  if (evidence?.candidateSha !== expectedCandidateSha) errors.push('candidate SHA does not match source provenance');

  if (Array.isArray(projects)) {
    for (const project of projects) {
      try {
        const manifestPath = path.isAbsolute(project.manifest)
          ? project.manifest
          : path.resolve(options.repositoryRoot, project.manifest);
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (manifest.project !== project.name || manifest.status !== 'passed'
          || manifest.cloudVerified !== false || manifest.supplierVerified !== false
          || manifest.candidateSha !== expectedCandidateSha
          || !sameProvenance(manifest.candidateProvenance, evidence.sourceCommit)
          || !Array.isArray(manifest.artifactErrors) || manifest.artifactErrors.length !== 0) {
          errors.push(`${project.name}: manifest contract mismatch`);
          continue;
        }
        const files = Array.isArray(manifest.files) ? manifest.files : [];
        const artifactNames = files.map(file => file?.name).sort();
        if (JSON.stringify(artifactNames) !== JSON.stringify([...REQUIRED_ARTIFACTS].sort())) {
          errors.push(`${project.name}: required artifact set is incomplete or contains duplicates`);
          continue;
        }
        const machine = files.find(file => file?.name === 'machine-evidence.json');
        if (!machine || machine.sha256 !== project.machineEvidenceSha256) {
          errors.push(`${project.name}: machine evidence digest mismatch`);
          continue;
        }
        const machineBody = JSON.parse(await readFile(path.join(path.dirname(manifestPath), machine.name), 'utf8'));
        if (machineBody.candidateSha !== expectedCandidateSha
          || !sameProvenance(machineBody.candidateProvenance, evidence.sourceCommit)) {
          errors.push(`${project.name}: machine evidence candidate mismatch`);
          continue;
        }
        for (const file of files) {
          if (!string(file?.name) || !HEX_64.test(String(file?.sha256 || ''))) {
            errors.push(`${project.name}: invalid artifact declaration`);
            continue;
          }
          const bytes = await readFile(path.join(path.dirname(manifestPath), file.name));
          if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
            errors.push(`${project.name}: ${file.name} hash or byte count mismatch`);
          }
        }
      } catch (error) {
        errors.push(`${project?.name || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return {
    local: { ok: errors.length === 0, detail: errors.length === 0 ? `four manifests and hashes verified; ${provenance.detail}` : errors.join('; ') },
    cloud: validateCloudEvidence(evidence?.cloud, {
      expectedExactCommit: options.expectedExactCommit,
    }),
  };
}

export { EXPECTED_PROJECTS };
