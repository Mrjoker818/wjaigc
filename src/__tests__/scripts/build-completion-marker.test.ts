import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface MarkerModule {
  clearBuildCompletion: (root: string) => Promise<void>;
  sealBuildCompletion: (root: string) => Promise<void>;
}

const modulePath = resolve(process.cwd(), 'scripts/build-completion-marker.mjs');
let fixture: string;

async function markerModule(): Promise<MarkerModule> {
  expect(existsSync(modulePath)).toBe(true);
  return import(pathToFileURL(modulePath).href) as Promise<MarkerModule>;
}

describe('completed Next build marker', () => {
  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'wujie-build-complete-'));
    mkdirSync(join(fixture, '.next'));
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it('clears the previous marker before a build and seals only the resulting ID', async () => {
    const { clearBuildCompletion, sealBuildCompletion } = await markerModule();
    const marker = join(fixture, '.next', 'WUJIE_BUILD_COMPLETE');
    writeFileSync(marker, 'previous-build\n');

    await clearBuildCompletion(fixture);
    expect(existsSync(marker)).toBe(false);

    writeFileSync(join(fixture, '.next', 'BUILD_ID'), 'new-build-id\n');
    await sealBuildCompletion(fixture);
    expect(readFileSync(marker, 'utf8')).toBe('new-build-id\n');
    expect(readdirSync(join(fixture, '.next')).sort()).toEqual(['BUILD_ID', 'WUJIE_BUILD_COMPLETE']);
  });

  it('refuses to mark an incomplete build without a BUILD_ID', async () => {
    const { sealBuildCompletion } = await markerModule();
    await expect(sealBuildCompletion(fixture)).rejects.toThrow();
    expect(existsSync(join(fixture, '.next', 'WUJIE_BUILD_COMPLETE'))).toBe(false);
  });
});
