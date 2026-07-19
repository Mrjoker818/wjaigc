import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/export-project/route.ts');

describe('project source export authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires an administrator before GET can create an archive', () => {
    const handler = source.slice(source.indexOf('export async function GET(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireAdminUser(request)');
    const archiveIndex = handler.indexOf('createTarGz(scope)');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(archiveIndex).toBeGreaterThan(authorizationIndex);
  });

  it('requires an administrator before POST parses scope or creates an archive', () => {
    const handler = source.slice(source.indexOf('export async function POST(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireAdminUser(request)');
    const bodyIndex = handler.indexOf('await request.json()');
    const archiveIndex = handler.indexOf('createTarGz(scope)');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeGreaterThan(authorizationIndex);
    expect(archiveIndex).toBeGreaterThan(authorizationIndex);
  });
});
