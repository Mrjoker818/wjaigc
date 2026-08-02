import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/user-manager.ts'),
  'utf8',
);

describe('UserManager autosave snapshot quota contract', () => {
  it('writes a trimmed snapshot rather than duplicating raw data/blob image payloads', () => {
    const protector = source.indexOf('private protectAgainstDataLoss(): void');
    const snapshotClone = source.indexOf('const snapshotData = JSON.parse(JSON.stringify(this.multiUserData));', protector);
    const trimUrls = source.indexOf('this.trimDataUrls(snapshotData);', snapshotClone);

    expect(protector).toBeGreaterThan(-1);
    expect(snapshotClone).toBeGreaterThan(protector);
    expect(trimUrls).toBeGreaterThan(snapshotClone);
  });

  it('evicts the oldest snapshots and retries when localStorage is full', () => {
    const protector = source.indexOf('private protectAgainstDataLoss(): void');
    const retryLoop = source.indexOf('while (snapshots.length > 1)', protector);
    const eviction = source.indexOf('snapshots = snapshots.slice(1);', retryLoop);
    const retryWrite = source.indexOf('localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshots));', eviction);

    expect(retryLoop).toBeGreaterThan(protector);
    expect(eviction).toBeGreaterThan(retryLoop);
    expect(retryWrite).toBeGreaterThan(eviction);
  });
});
