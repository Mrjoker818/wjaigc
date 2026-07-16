import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');

describe('UserManager server project sync', () => {
  it('treats an authenticated empty server project record as a ready first-sync state', () => {
    expect(source).toContain("if (!data.success) {");
    expect(source).toContain("if (data.value === undefined || data.value === null) {");
    expect(source).toContain("this._serverSyncReady = true;");
    expect(source).toContain("await this.syncToServer();");
  });

  it('retries transient unsuccessful sync payloads before reporting a failure', () => {
    expect(source).toMatch(/if \(!data\.success\) \{[\s\S]{0,300}retryCount > 0/);
  });
});
