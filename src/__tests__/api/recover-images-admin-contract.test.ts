import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const routeFile = path.resolve(process.cwd(), 'src/app/api/recover-images/route.ts');

describe('recover-images authorization contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires an authenticated administrator for both recovery handlers', () => {
    expect(source.match(/authResult\.userRole !== 'admin'/g)).toHaveLength(2);
    expect(source).toContain("status: 403");
  });

  it('does not retain the public legacy recovery key or trust a body key', () => {
    expect(source).not.toContain('wujie-recovery-2024');
    expect(source).not.toContain('adminKey');
  });

  it('rejects traversal-like single-file recovery paths before file access', () => {
    expect(source).toContain('isSafeRecoveryPath(targetFilename)');
    expect(source).toContain("return NextResponse.json({ error: 'Invalid recovery filename' }, { status: 400 });");
  });
});
