import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('administrator settings runtime limits', () => {
  it('keeps the video duration input aligned with the 15-second API limit', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/dashboard/admin-tabs.tsx'),
      'utf8',
    );

    expect(source).toMatch(/numInput\('maxVideoDuration', 'w-24', '[^']+', 1, 15\)/);
    expect(source).toContain('min={min} max={max}');
    expect(source).not.toMatch(/numInput\('maxVideoDuration', 'w-24', '[^']+', 1, 600\)/);
  });
});
