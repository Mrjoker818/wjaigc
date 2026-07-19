import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/video/download/route.ts');

describe('video download authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('authenticates callers before reading local files or proxying a remote video', () => {
    const handler = source.slice(source.indexOf('export async function GET(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(request)');
    const urlReadIndex = handler.indexOf("request.nextUrl.searchParams.get('url')");
    const fileReadIndex = handler.indexOf('readLocalVideoBuffer(sourceUrl)');
    const remoteFetchIndex = handler.indexOf('fetch(sourceUrl');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(urlReadIndex).toBeGreaterThan(authorizationIndex);
    expect(fileReadIndex).toBeGreaterThan(urlReadIndex);
    expect(remoteFetchIndex).toBeGreaterThan(urlReadIndex);
  });
});
