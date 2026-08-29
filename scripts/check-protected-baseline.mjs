import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FEATURE_CONTRACT_PATH = 'docs/testing/baselines/protected-features.json';
const REQUIRED_EVIDENCE_CONTRACTS = [
  'docs/testing/baselines/2026-08-08-baseline.json',
  'docs/testing/baselines/compatibility-samples.json',
  'docs/testing/evidence/README.md',
  'tests/helpers/evidence-manifest.ts',
];

const DEFAULT_ALLOWED_INFRA_PATHS = [
  '.github/workflows/stage-0-quality.yml',
  'docs/',
  'scripts/check-protected-baseline.mjs',
  'scripts/generate-function-inventory.mjs',
  'src/__tests__/',
  'tasks/',
  'tests/',
  'package.json',
  'vitest.config.ts',
  'playwright.config.ts',
];

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isAllowedPath(path, allowedPaths = DEFAULT_ALLOWED_INFRA_PATHS) {
  const normalized = normalizePath(path);
  return allowedPaths.some((allowed) => {
    const normalizedAllowed = normalizePath(allowed);
    return normalizedAllowed.endsWith('/')
      ? normalized.startsWith(normalizedAllowed)
      : normalized === normalizedAllowed;
  });
}

function duplicateIds(features) {
  const seen = new Set();
  const duplicates = new Set();
  for (const feature of features) {
    const id = feature?.featureId;
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export function evaluateProtectedBaseline({
  baselineFeatures,
  candidateFeatures,
  changedPaths = [],
  untrackedPaths = [],
  missingProtectedSourcePaths = [],
  missingEvidenceContracts = [],
  baseResolved = true,
  candidateResolved = true,
  allowedPaths = DEFAULT_ALLOWED_INFRA_PATHS,
}) {
  const pass = [];
  const warn = [];
  const block = [];

  if (!baseResolved) block.push('The base Git ref cannot be resolved.');
  if (!candidateResolved) block.push('The candidate Git ref cannot be resolved.');

  for (const id of duplicateIds(candidateFeatures)) {
    block.push(`Duplicate protected featureId: ${id}`);
  }

  const baselineIds = new Set(baselineFeatures.map((feature) => feature.featureId));
  const candidateIds = new Set(candidateFeatures.map((feature) => feature.featureId));
  for (const id of baselineIds) {
    if (!candidateIds.has(id)) block.push(`Protected feature removed: ${id}`);
  }
  for (const id of candidateIds) {
    if (!baselineIds.has(id)) warn.push(`Protected feature added: ${id}`);
  }
  if (block.every((message) => !message.startsWith('Protected feature removed'))) {
    pass.push(`All ${baselineIds.size} baseline feature IDs remain present.`);
  }

  for (const path of [...new Set([...changedPaths, ...untrackedPaths])]) {
    if (!isAllowedPath(path, allowedPaths)) {
      block.push(`Unapproved source drift: ${normalizePath(path)}`);
    }
  }
  if (block.every((message) => !message.startsWith('Unapproved source drift'))) {
    pass.push('No unapproved source drift was detected.');
  }

  for (const path of missingProtectedSourcePaths) {
    block.push(`Protected source path is missing: ${normalizePath(path)}`);
  }
  if (missingProtectedSourcePaths.length === 0) {
    pass.push('All literal protected component paths are present.');
  }

  for (const path of missingEvidenceContracts) {
    block.push(`Required evidence contract is missing: ${normalizePath(path)}`);
  }
  if (missingEvidenceContracts.length === 0) {
    pass.push('All required evidence contracts are present.');
  }

  if (baseResolved && candidateResolved) {
    pass.push('Base and candidate Git refs are confirmed.');
  }

  return { pass, warn, block };
}

function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

function resolveRef(root, ref) {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true });
}

function parseNameList(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseUntracked(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function literalProtectedComponents(features) {
  return [...new Set(
    features
      .flatMap((feature) => Array.isArray(feature.components) ? feature.components : [])
      .filter((path) => (
        typeof path === 'string'
        && path.startsWith('src/')
        && !path.includes('*')
      )),
  )];
}

function findArgument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || fallback;
}

function findRepeatedArguments(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

async function readAllowedPathFile(root, filePath) {
  const parsed = JSON.parse(await readFile(resolve(root, filePath), 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== 'string' || !path.trim())) {
    throw new Error(`Invalid protected baseline allow-path file: ${filePath}`);
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`Duplicate path in protected baseline allow-path file: ${filePath}`);
  }
  return parsed;
}

export async function runProtectedBaselineGate({
  root = process.cwd(),
  base = 'origin/main',
  candidate = 'HEAD',
  extraAllowedPaths = [],
  allowedPathFiles = [],
} = {}) {
  const fileAllowedPaths = (
    await Promise.all(allowedPathFiles.map((filePath) => readAllowedPathFile(root, filePath)))
  ).flat();
  const baselineMetadata = JSON.parse(await readFile(
    join(root, 'docs/testing/baselines/2026-08-08-baseline.json'),
    'utf8',
  ));
  const candidateFeatures = JSON.parse(await readFile(
    join(root, FEATURE_CONTRACT_PATH),
    'utf8',
  ));

  const baseCommit = resolveRef(root, base);
  const candidateCommit = resolveRef(root, candidate);
  let baselineFeatures = candidateFeatures;
  let baseContractFallback = false;
  if (baseCommit) {
    const baseContract = git(
      root,
      ['show', `${baseCommit}:${FEATURE_CONTRACT_PATH}`],
      { allowFailure: true },
    );
    if (baseContract) {
      baselineFeatures = JSON.parse(baseContract);
    } else {
      baseContractFallback = true;
    }
  }

  const committedChanges = baseCommit && candidateCommit
    ? parseNameList(git(root, ['diff', '--name-only', baseCommit, candidateCommit], { allowFailure: true }))
    : [];
  const workingTreeChanges = parseNameList(
    git(root, ['diff', '--name-only', 'HEAD'], { allowFailure: true }),
  );
  const stagedChanges = parseNameList(
    git(root, ['diff', '--cached', '--name-only'], { allowFailure: true }),
  );
  const untrackedPaths = parseUntracked(
    git(root, ['status', '--porcelain', '--untracked-files=all']),
  );

  const missingEvidenceContracts = [];
  for (const path of REQUIRED_EVIDENCE_CONTRACTS) {
    if (!await pathExists(join(root, path))) missingEvidenceContracts.push(path);
  }

  const missingProtectedSourcePaths = [];
  for (const path of literalProtectedComponents(candidateFeatures)) {
    if (!await pathExists(join(root, path))) missingProtectedSourcePaths.push(path);
  }

  const result = evaluateProtectedBaseline({
    baselineFeatures,
    candidateFeatures,
    changedPaths: [...new Set([
      ...committedChanges,
      ...workingTreeChanges,
      ...stagedChanges,
    ])],
    untrackedPaths,
    missingProtectedSourcePaths,
    missingEvidenceContracts,
    baseResolved: Boolean(baseCommit),
    candidateResolved: Boolean(candidateCommit),
    allowedPaths: [
      ...DEFAULT_ALLOWED_INFRA_PATHS,
      ...fileAllowedPaths,
      ...extraAllowedPaths,
    ],
  });

  if (baseContractFallback) {
    result.warn.push(
      `Base ${baseCommit} predates ${FEATURE_CONTRACT_PATH}; checked-in Stage 0 contract was used as the comparison baseline.`,
    );
  }
  if (baselineMetadata.commit !== baseCommit && base === baselineMetadata.branch) {
    result.warn.push(
      `Recorded baseline commit ${baselineMetadata.commit} differs from resolved ${base} commit ${baseCommit}.`,
    );
  }

  return {
    ...result,
    base,
    baseCommit,
    candidate,
    candidateCommit,
  };
}

function printResult(result) {
  console.log(`Protected baseline gate: ${result.base} (${result.baseCommit || 'unresolved'}) -> ${result.candidate} (${result.candidateCommit || 'unresolved'})`);
  for (const message of result.pass) console.log(`PASS  ${message}`);
  for (const message of result.warn) console.log(`WARN  ${message}`);
  for (const message of result.block) console.log(`BLOCK ${message}`);
  console.log(
    result.block.length === 0
      ? `PASS  Release gate completed with ${result.warn.length} warning(s).`
      : `BLOCK Release gate found ${result.block.length} blocking issue(s).`,
  );
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result = await runProtectedBaselineGate({
      base: findArgument(args, '--base', 'origin/main'),
      candidate: findArgument(args, '--candidate', 'HEAD'),
      extraAllowedPaths: findRepeatedArguments(args, '--allow-path'),
      allowedPathFiles: findRepeatedArguments(args, '--allow-path-file'),
    });
    printResult(result);
    if (result.block.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`BLOCK ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
