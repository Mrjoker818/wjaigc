import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isServerDataRootDurable } from '@/lib/server-data-root';

const originalDataDir = process.env.WUJIE_DATA_DIR;
const originalDurable = process.env.WUJIE_DATA_DIR_DURABLE;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = originalDataDir;
  if (originalDurable === undefined) delete process.env.WUJIE_DATA_DIR_DURABLE;
  else process.env.WUJIE_DATA_DIR_DURABLE = originalDurable;
});

describe('server data root durability', () => {
  it('does not treat an arbitrary configured directory as durable without an explicit declaration', () => {
    const configured = path.resolve('output', 'ephemeral-data');
    process.env.WUJIE_DATA_DIR = configured;
    delete process.env.WUJIE_DATA_DIR_DURABLE;

    expect(isServerDataRootDurable(configured)).toBe(false);
  });

  it('accepts an explicitly declared configured persistent mount', () => {
    const configured = path.resolve('output', 'persistent-data');
    process.env.WUJIE_DATA_DIR = configured;
    process.env.WUJIE_DATA_DIR_DURABLE = 'true';

    expect(isServerDataRootDurable(configured)).toBe(true);
  });
});
