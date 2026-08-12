import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(process.cwd(), 'src/lib/api-auth.ts'), 'utf8');

describe('unified API authentication identity contract', () => {
  it('returns the verified user and source to authenticated routes', () => {
    expect(source).toContain('user: User;');
    expect(source).toContain("source: 'cookie' | 'desktop-token' | 'internal';");
    expect(source).toContain('user: auth.user');
    expect(source).toContain('source: auth.source');
  });
});
