import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const routeFile = path.resolve(root, 'src/app/api/save-image/route.ts');
const serverCallers = [
  'src/lib/persist-result-image.ts',
  'src/lib/agent-runtime/agent-edit-execution-service.ts',
  'src/app/api/generate/route.ts',
  'src/app/api/brand-ecommerce/route.ts',
  'src/app/api/workflow/execute/route.ts',
  'src/app/api/refine-engine/route.ts',
  'src/app/api/scene-studio/generate/route.ts',
  'src/app/api/image/upscale-pro/route.ts',
  'src/app/api/video/generate/route.ts',
  'src/app/api/video/extend/route.ts',
];

describe('save-image authentication contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires verified authentication before parsing media content', () => {
    const handler = source.slice(source.indexOf('export async function POST(request: NextRequest)'));
    const authorizationIndex = handler.indexOf('requireApiAuthOrReject(request)');
    const contentTypeIndex = handler.indexOf("request.headers.get('content-type')");
    const bodyIndex = handler.indexOf('await request.json()');

    expect(source).not.toContain("request.headers.get('x-internal-call')");
    expect(source).not.toContain("request.headers.get('host')?.startsWith('localhost')");
    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(contentTypeIndex).toBeGreaterThan(authorizationIndex);
    expect(bodyIndex).toBeGreaterThan(authorizationIndex);
  });

  it('requires every server-side persistence caller to use signed internal headers', () => {
    for (const relativePath of serverCallers) {
      const caller = readFileSync(path.resolve(root, relativePath), 'utf8');
      expect(caller, relativePath).toContain('/api/save-image');
      expect(caller, relativePath).toContain('getInternalRequestHeaders');
      expect(caller, relativePath).not.toMatch(
        /\/api\/save-image[\s\S]{0,400}headers:\s*\{\s*['\"]Content-Type['\"]:\s*['\"]application\/json['\"]\s*\}/,
      );
    }
  });

  it('persists quality enhancement output directly without a self-HTTP save-image call', () => {
    const caller = readFileSync(path.resolve(root, 'src/lib/quality-enhance.ts'), 'utf8');
    expect(caller).toContain('await persistAssetBytes({');
    expect(caller).not.toContain('/api/save-image');
  });
});
