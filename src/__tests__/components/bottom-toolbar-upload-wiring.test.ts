import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ecommerce = readFileSync(resolve(process.cwd(), 'src/components/brand-ecommerce-panel.tsx'), 'utf8');
const packaging = readFileSync(resolve(process.cwd(), 'src/components/brand-packaging-panel.tsx'), 'utf8');

describe('bottom toolbar upload wiring', () => {
  it('does not fall back to browser-only blob URLs in Brand E-commerce', () => {
    expect(ecommerce).not.toContain('setRefImage(URL.createObjectURL(file))');
    expect(ecommerce).not.toContain('setProductImage(URL.createObjectURL(file))');
  });

  it('persists Brand Packaging assets before they can reach a generation request', () => {
    expect(packaging).not.toContain('const url = URL.createObjectURL(file)');
    expect(packaging).toContain("fetch('/api/upload'");
  });
});
