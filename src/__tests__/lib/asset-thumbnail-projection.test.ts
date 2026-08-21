import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/asset-core/canvas-project-sync.ts'),
  'utf8',
);

describe('asset thumbnail projection contract', () => {
  it('projects only ready variants and prefers 512 before falling back to 256', () => {
    expect(source).toContain("variant.status = 'ready'");
    expect(source).toMatch(/variant\.size\s+IN\s*\(512,\s*256\)/);
    expect(source).toMatch(/ORDER BY\s+variant\.size\s+DESC/);
    expect(source).toContain('thumbnail_url');
  });

  it('scopes the variant to the exact asset version selected by the placement', () => {
    expect(source).toContain('variant.asset_version_id = version.id');
  });
});
