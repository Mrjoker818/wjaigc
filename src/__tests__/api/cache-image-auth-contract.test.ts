import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/cache-image/route.ts');

describe('cache-image authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('authenticates callers before parsing a URL or fetching a remote image', () => {
    const handler = source.slice(source.indexOf('export async function POST(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(request)');
    const requestBodyIndex = handler.indexOf('await request.json()');
    const remoteFetchIndex = handler.indexOf('await fetch(imageUrl');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(requestBodyIndex).toBeGreaterThan(authorizationIndex);
    expect(remoteFetchIndex).toBeGreaterThan(requestBodyIndex);
  });
});
