import { cp, mkdir, readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const results = join(root, 'test-results');
const artifacts = join(root, '.playwright-output');
const targets = {
  '.png': 'screenshots',
  '.webm': 'videos',
  '.zip': 'traces',
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !Object.values(targets).includes(entry.name)) files.push(...await walk(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

try {
  await access(artifacts);
} catch {
  console.log('No Playwright runtime artifacts found; nothing to collect.');
  process.exit(0);
}

const archiveId = process.env.E2E_RUN_ID || new Date().toISOString().replaceAll(/[:.]/g, '-');
const files = await walk(artifacts);
let copied = 0;
for (const source of files) {
  const extension = Object.keys(targets).find((suffix) => source.endsWith(suffix));
  if (!extension) continue;
  const destinationDir = join(results, targets[extension]);
  await mkdir(destinationDir, { recursive: true });
  const uniqueName = `${archiveId}__${relative(artifacts, source).replaceAll(/[\\/]/g, '__')}`;
  await cp(source, join(destinationDir, uniqueName));
  copied += 1;
}
console.log(`Collected ${copied} Playwright artifacts into standardized evidence directories with archive id ${archiveId}.`);
