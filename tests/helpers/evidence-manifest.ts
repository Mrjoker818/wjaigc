import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

export type EvidenceStatus = 'completed' | 'failed' | 'blocked' | 'unverified';

export interface EvidenceArtifactPaths {
  screenshot?: string;
  video?: string;
  trace?: string;
  console?: string;
  network?: string;
  task?: string;
  server?: string;
  [kind: string]: string | undefined;
}

export interface EvidenceManifestInput {
  commit: string;
  deploymentUrl: string;
  browser: string;
  viewport: {
    width: number;
    height: number;
  };
  capturedAt: string;
  featureId: string;
  artifactPaths: EvidenceArtifactPaths;
  requestIds: string[];
  status: EvidenceStatus;
}

export interface WriteEvidenceManifestOptions {
  root?: string;
}

const REQUIRED_COMPLETED_ARTIFACTS = [
  'screenshot',
  'console',
  'network',
  'task',
] as const;

function assertNonEmptyString(
  input: Record<string, unknown>,
  field: string,
): asserts input is Record<string, unknown> & Record<typeof field, string> {
  if (typeof input[field] !== 'string' || input[field].trim() === '') {
    throw new Error(`Evidence manifest field "${field}" is required.`);
  }
}

function validateArtifactPath(kind: string, path: unknown): asserts path is string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error(`Evidence artifact path "${kind}" must be a non-empty string.`);
  }
  const normalized = normalize(path);
  if (isAbsolute(path) || normalized === '..' || normalized.startsWith(`..\\`) || normalized.startsWith('../')) {
    throw new Error(`Evidence artifact path "${kind}" must stay inside the evidence directory.`);
  }
}

export function validateEvidenceManifest(
  value: unknown,
): asserts value is EvidenceManifestInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Evidence manifest must be an object.');
  }
  const input = value as Record<string, unknown>;
  for (const field of [
    'commit',
    'deploymentUrl',
    'browser',
    'capturedAt',
    'featureId',
    'status',
  ]) {
    assertNonEmptyString(input, field);
  }

  try {
    const url = new URL(input.deploymentUrl as string);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported');
  } catch {
    throw new Error('Evidence manifest field "deploymentUrl" must be an HTTP(S) URL.');
  }

  if (Number.isNaN(Date.parse(input.capturedAt as string))) {
    throw new Error('Evidence manifest field "capturedAt" must be an ISO date.');
  }

  const viewport = input.viewport as Record<string, unknown> | undefined;
  if (
    !viewport
    || typeof viewport.width !== 'number'
    || viewport.width <= 0
    || typeof viewport.height !== 'number'
    || viewport.height <= 0
  ) {
    throw new Error('Evidence manifest field "viewport" must contain positive width and height.');
  }

  if (!Array.isArray(input.requestIds) || input.requestIds.some((id) => typeof id !== 'string')) {
    throw new Error('Evidence manifest field "requestIds" must be a string array.');
  }

  if (!input.artifactPaths || typeof input.artifactPaths !== 'object' || Array.isArray(input.artifactPaths)) {
    throw new Error('Evidence manifest field "artifactPaths" is required.');
  }
  const artifactPaths = input.artifactPaths as Record<string, unknown>;
  const artifacts = Object.entries(artifactPaths).filter(([, path]) => path !== undefined);
  if (artifacts.length === 0) {
    throw new Error('Evidence manifest field "artifactPaths" must contain evidence paths.');
  }
  for (const [kind, path] of artifacts) validateArtifactPath(kind, path);

  if (input.status === 'completed') {
    for (const kind of REQUIRED_COMPLETED_ARTIFACTS) {
      if (!artifactPaths[kind]) {
        throw new Error(`Completed evidence requires the "${kind}" artifact path.`);
      }
    }
  }
}

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function writeEvidenceManifest(
  input: EvidenceManifestInput,
  options: WriteEvidenceManifestOptions = {},
) {
  validateEvidenceManifest(input);
  const evidenceRoot = options.root || join(process.cwd(), 'test-results', 'evidence');
  const timestamp = safeSegment(input.capturedAt);
  const directory = join(
    evidenceRoot,
    safeSegment(input.commit),
    safeSegment(input.featureId),
    safeSegment(input.browser),
    timestamp,
  );
  const manifestPath = join(directory, 'manifest.json');

  await mkdir(directory, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');

  return { directory, manifestPath };
}
