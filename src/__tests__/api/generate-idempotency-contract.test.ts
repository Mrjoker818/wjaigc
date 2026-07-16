import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('generate submitOnly idempotency contract', () => {
  it('looks up an Idempotency-Key before registering a new async task', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const lookup = source.indexOf('getCloudTaskForUserByIdempotencyKey', branch);
    const register = source.indexOf('registerTask(asyncTaskId', branch);

    expect(lookup).toBeGreaterThan(branch);
    expect(register).toBeGreaterThan(lookup);
    expect(source).toContain("request.headers.get('idempotency-key')");
  });

  it('starts submitOnly background work only after an atomic persistent task insert succeeds', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
    const branch = source.indexOf('if (submitOnly)');
    const persisted = source.indexOf('const taskCreated = await recordImageTaskSubmitted', branch);
    const collision = source.indexOf('if (!taskCreated)', persisted);
    const reusedLookup = source.indexOf('getCloudTaskForUserByIdempotencyKey', collision);
    const register = source.indexOf('registerTask(asyncTaskId', branch);

    expect(persisted).toBeGreaterThan(branch);
    expect(collision).toBeGreaterThan(persisted);
    expect(reusedLookup).toBeGreaterThan(collision);
    expect(register).toBeGreaterThan(collision);
  });
});
