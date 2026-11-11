import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKED_PATHS = [
  'deploy-seed/system/api-providers.json',
  'deploy-seed/system/users.json',
  'scripts/export-deploy-seed.mjs',
  'data/system/api-providers.json',
  'data/system/users.json',
  'data/system/auth-secret',
];

class VerificationError extends Error {}

function portablePath(file) {
  return file.replaceAll('\\', '/');
}

export function matchBlockedPath(file) {
  const normalized = path.posix.normalize(portablePath(file)).toLowerCase();
  return BLOCKED_PATHS.find((blocked) => normalized === blocked || normalized.endsWith(`/${blocked}`));
}

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new VerificationError(`Cannot inspect path ${JSON.stringify(file)}.`);
  }
}

async function verifyCopyTree(directory, { optional = false } = {}) {
  const stat = await statIfPresent(directory);
  if (!stat && optional) return [];
  if (!stat?.isDirectory()) throw new VerificationError(`Expected a directory at ${directory}.`);

  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch {
    throw new VerificationError(`Cannot inspect copy paths under ${directory}.`);
  }

  for (const entry of entries) {
    const file = portablePath(path.join(entry.parentPath, entry.name));
    if (matchBlockedPath(file)) throw new VerificationError(`Forbidden copied path ${JSON.stringify(file)}.`);
  }
  return entries;
}

async function readTraceFiles(manifest) {
  // Parser errors can include snippets of the input. Report the path only.
  let files;
  try {
    files = JSON.parse(await readFile(manifest, 'utf8'))?.files;
  } catch {
    throw new VerificationError(`Cannot read NFT manifest ${JSON.stringify(manifest)}.`);
  }
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) {
    throw new VerificationError(`Invalid files array in NFT manifest ${JSON.stringify(manifest)}.`);
  }
  return files;
}

async function main() {
  const [phase] = process.argv.slice(2);
  if (process.argv.length !== 3 || (phase !== '--source' && phase !== '--built')) {
    throw new VerificationError('Expected --source or --built.');
  }

  for (const file of BLOCKED_PATHS) {
    if (await statIfPresent(file)) throw new VerificationError(`Forbidden source path ${file}.`);
  }

  if (phase === '--source') {
    console.log('[deploy-package] Verified absence of retired source paths.');
    return;
  }

  await verifyCopyTree('public', { optional: true });
  const entries = await verifyCopyTree('.next');
  const manifests = entries.filter((entry) => entry.name.endsWith('.nft.json'));
  if (manifests.length === 0) throw new VerificationError('No NFT manifests found under .next.');

  for (const entry of manifests) {
    const manifest = portablePath(path.join(entry.parentPath, entry.name));
    if (!entry.isFile()) throw new VerificationError(`Expected a regular NFT manifest at ${JSON.stringify(manifest)}.`);
    const directory = path.posix.dirname(manifest);
    for (const reference of await readTraceFiles(manifest)) {
      const blocked = matchBlockedPath(path.posix.resolve(directory, portablePath(reference)));
      if (blocked) throw new VerificationError(`Forbidden NFT reference ${blocked} in ${JSON.stringify(manifest)}.`);
    }
  }

  console.log(`[deploy-package] Verified ${manifests.length} NFT manifests and copy paths under .next and public.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof VerificationError ? error.message : 'Unable to verify deployment package.';
    console.error(`[deploy-package] ${message}`);
    process.exitCode = 1;
  });
}
