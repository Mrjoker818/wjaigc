import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');

describe('root layout font loading', () => {
  it('does not require a remote Google font during production builds', () => {
    expect(layoutSource).not.toContain("next/font/google");
    expect(layoutSource).toContain('className="antialiased"');
  });
});
