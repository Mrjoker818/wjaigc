import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/image/start-services/route.ts');

describe('image start-services authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires an administrator before it can spawn a local image service', () => {
    const authorizationIndex = source.indexOf('requireApiAuthOrReject(request)');
    const administratorIndex = source.indexOf("authResult.userRole !== 'admin'");
    const spawnIndex = source.indexOf("spawn('iopaint'");

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(administratorIndex).toBeGreaterThan(authorizationIndex);
    expect(spawnIndex).toBeGreaterThan(administratorIndex);
    expect(source).toContain("status: 403");
  });
});
