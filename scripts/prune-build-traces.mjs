import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXCLUDED_PROJECT_DIRS = [
  '.tmp',
  '.playwright-cli',
  'output',
  'test-results',
  'playwright-report',
];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function collectTraceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTraceFiles(entryPath);
    return entry.name.endsWith('.nft.json') ? [entryPath] : [];
  }));
  return nested.flat();
}

export async function readTraceWhenAvailable(
  traceFile,
  { pollIntervalMs = 50, timeoutMs = 5_000 } = {},
) {
  const startedAt = Date.now();

  while (true) {
    try {
      return JSON.parse(await readFile(traceFile, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' || Date.now() - startedAt >= timeoutMs) {
        throw error;
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(pollIntervalMs, remainingMs));
      });
    }
  }
}

async function main() {
  const projectRoot = process.cwd();
  const traceRoot = path.join(projectRoot, '.next', 'server');
  const excludedRoots = EXCLUDED_PROJECT_DIRS.map((directory) =>
    path.join(projectRoot, directory),
  );
  const traceFiles = await collectTraceFiles(traceRoot);
  let removed = 0;

  for (const traceFile of traceFiles) {
    const trace = await readTraceWhenAvailable(traceFile);
    const files = Array.isArray(trace.files) ? trace.files : [];
    const filtered = files.filter((file) => {
      const resolved = path.resolve(path.dirname(traceFile), file);
      const excluded = excludedRoots.some((root) => isInside(root, resolved));
      if (excluded) removed += 1;
      return !excluded;
    });

    if (filtered.length !== files.length) {
      await writeFile(traceFile, JSON.stringify({ ...trace, files: filtered }));
    }
  }

  console.log(`[build-trace] inspected ${traceFiles.length} traces; removed ${removed} local artifact references`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('[build-trace] failed to prune local artifact references', error);
    process.exitCode = 1;
  });
}
