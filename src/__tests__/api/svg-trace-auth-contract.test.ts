import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/svg-trace/route.ts');

describe('svg-trace authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('authenticates callers before parsing a tracing request or running vectorization', () => {
    const handler = source.slice(source.indexOf('export async function POST(req: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(req)');
    const requestBodyIndex = handler.indexOf('const body: TraceRequest = await req.json()');
    const vectorizationIndex = handler.indexOf('await resolveImageUrl(imageUrl)');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(requestBodyIndex).toBeGreaterThan(authorizationIndex);
    expect(vectorizationIndex).toBeGreaterThan(requestBodyIndex);
  });
});
