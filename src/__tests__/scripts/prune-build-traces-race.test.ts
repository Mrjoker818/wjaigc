import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('build trace pruning', () => {
  it('waits for an enumerated trace that is temporarily unavailable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wujie-build-trace-'));
    temporaryDirectories.push(directory);
    const tracePath = path.join(directory, 'route.js.nft.json');
    const pendingPath = `${tracePath}.pending`;
    const trace = { files: ['../../../../output/local-artifact.json', './route.js'] };

    await writeFile(pendingPath, JSON.stringify(trace), 'utf8');
    const restore = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        rename(pendingPath, tracePath).then(() => resolve(), reject);
      }, 25);
    });

    const scriptUrl = pathToFileURL(
      path.resolve(process.cwd(), 'scripts/prune-build-traces.mjs'),
    ).href;
    const buildTraceModule = await import(scriptUrl) as {
      readTraceWhenAvailable?: (
        filePath: string,
        options?: { pollIntervalMs?: number; timeoutMs?: number },
      ) => Promise<unknown>;
    };

    expect(buildTraceModule.readTraceWhenAvailable).toBeTypeOf('function');
    await expect(
      buildTraceModule.readTraceWhenAvailable?.(tracePath, {
        pollIntervalMs: 5,
        timeoutMs: 500,
      }),
    ).resolves.toEqual(trace);
    await restore;
  });
});
