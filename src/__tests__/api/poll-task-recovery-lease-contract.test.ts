import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('poll-task recovery lease contract', () => {
  it('claims a durable task lease before rebuilding an in-memory task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');
    const recoveryStart = source.indexOf('const recovery = buildRecoveredTaskContext');
    const leaseClaim = source.indexOf('claimCloudTaskLease(', recoveryStart);
    const register = source.indexOf('registerTask(recovery.taskId', recoveryStart);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(leaseClaim).toBeGreaterThan(recoveryStart);
    expect(register).toBeGreaterThan(leaseClaim);
  });
});
