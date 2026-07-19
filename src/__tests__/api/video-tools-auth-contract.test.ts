import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/video/tools/route.ts');

describe('video tools authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('authenticates callers before parsing work requests or invoking ffmpeg', () => {
    const handler = source.slice(source.indexOf('export async function POST(req: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(req)');
    const requestBodyIndex = handler.indexOf('const body = await req.json()');
    const ffmpegIndex = handler.indexOf('await ensureFfmpeg()');

    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(requestBodyIndex).toBeGreaterThan(authorizationIndex);
    expect(ffmpegIndex).toBeGreaterThan(requestBodyIndex);
  });
});
