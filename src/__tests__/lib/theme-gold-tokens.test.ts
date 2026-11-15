import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// Regression: `to-gold-dark` had no theme token, so primary CTAs faded to
// transparent on the right. Every gold utility used in components must resolve.
const css = readFileSync(path.resolve('src/app/globals.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

it('defines a theme color for every gold utility used in source', () => {
  const used = new Set<string>();
  for (const file of sourceFiles(path.resolve('src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\b(?:from|via|to|bg|text|border|ring|shadow|fill|stroke)-(gold(?:-[a-z]+)?)(?=[\s'"`/:\]]|$)/g)) {
      used.add(match[1]);
    }
  }
  expect(used.size).toBeGreaterThan(0);
  const missing = [...used].filter(name => !css.includes(`--color-${name}:`) && !css.includes(`--shadow-${name}:`));
  expect(missing).toEqual([]);
});
