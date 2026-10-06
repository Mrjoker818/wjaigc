import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { requireOfflineBridgeTestMediaRoot } from '../helpers/offline-bridge-media-guard';

it('accepts an existing dedicated temporary media root outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'wujie-bridge-test-'));
  try {
    expect(requireOfflineBridgeTestMediaRoot(root)).toBe(resolve(root));
  } finally { rmdirSync(root); }
});

it.each(['.wujie-data', resolve(process.cwd(), 'wujie-bridge-test-ci'), tmpdir()])(
  'rejects a non-dedicated or in-repository media root: %s', root => {
    expect(() => requireOfflineBridgeTestMediaRoot(root)).toThrow('Dedicated offline bridge media root required');
  },
);

it('rejects an existing marked directory when it is inside the repository', () => {
  const root = mkdtempSync(join(process.cwd(), 'wujie-bridge-test-'));
  try {
    expect(() => requireOfflineBridgeTestMediaRoot(root)).toThrow('Dedicated offline bridge media root required');
  } finally { rmdirSync(root); }
});
