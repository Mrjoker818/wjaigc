import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('segment elements compatibility route', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/app/api/segment-elements/route.ts'),
    'utf8',
  );

  it('delegates to the unified recoverable layer service', () => {
    expect(source).toContain('submitLayerDecomposition');
    expect(source).toContain('logOperation');
    expect(source).toContain('logError');
    expect(source).not.toContain("'/chat/completions'");
    expect(source).not.toContain("'/segment'");
  });
});
