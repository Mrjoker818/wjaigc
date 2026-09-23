import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MARKER = 'WUJIE_BUILD_COMPLETE';

export async function clearBuildCompletion(root) {
  await rm(path.join(root, '.next', MARKER), { force: true });
}

export async function sealBuildCompletion(root) {
  const nextDirectory = path.join(root, '.next');
  const buildId = (await readFile(path.join(nextDirectory, 'BUILD_ID'), 'utf8')).trim();
  if (!buildId || /\s/.test(buildId)) {
    throw new Error('Cannot seal a Next build without one valid BUILD_ID');
  }

  const marker = path.join(nextDirectory, MARKER);
  const temporaryMarker = `${marker}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryMarker, `${buildId}\n`, { flag: 'wx' });
    await rename(temporaryMarker, marker);
  } finally {
    await rm(temporaryMarker, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const action = process.argv[2];
  const task = action === 'clear'
    ? clearBuildCompletion(process.cwd())
    : action === 'seal'
      ? sealBuildCompletion(process.cwd())
      : Promise.reject(new Error('Expected build completion action: clear or seal'));
  task.catch((error) => {
    console.error('[build-completion]', error);
    process.exitCode = 1;
  });
}
