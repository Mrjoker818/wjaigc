import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/upload/route.ts');

describe('upload authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires verified authentication before parsing an upload body', () => {
    const handler = source.slice(source.indexOf('export async function POST(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(request)');
    const formDataIndex = handler.indexOf('await request.formData()');

    expect(source).not.toContain("request.headers.get('x-internal-call')");
    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(formDataIndex).toBeGreaterThan(authorizationIndex);
  });
});
