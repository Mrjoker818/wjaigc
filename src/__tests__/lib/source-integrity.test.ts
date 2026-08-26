import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const sourceRoot = resolve(projectRoot, 'src');

function findConflictMarkers(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return findConflictMarkers(filePath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return /^(<<<<<<<|=======|>>>>>>>)/m.test(readFileSync(filePath, 'utf8')) ? [filePath] : [];
  });
}

describe('repository source integrity', () => {
  it('contains no unresolved Git merge markers in TypeScript sources', () => {
    expect(findConflictMarkers(sourceRoot)).toEqual([]);
  });

  it('keeps the canvas runtime helper modules available', () => {
    expect(existsSync(resolve(projectRoot, 'src/lib/canvas-pan-virtualization.ts'))).toBe(true);
    expect(existsSync(resolve(projectRoot, 'src/lib/canvas-generation-results.ts'))).toBe(true);
  });

  it('uses a cross-platform Node postinstall hook', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.postinstall).toContain('node scripts/prepare-tools.mjs');
    expect(existsSync(resolve(projectRoot, 'scripts/prepare-tools.mjs'))).toBe(true);
  });

  it('limits binary model ignores to repository-root asset directories', () => {
    const gitignore = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('/models/');
    expect(gitignore).toContain('/upscayl-models/');
    expect(gitignore).not.toMatch(/^models\/$/m);
    expect(gitignore).not.toMatch(/^upscayl-models\/$/m);
  });

  it('keeps nested deployment worktrees out of Git and TypeScript builds', () => {
    const gitignore = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8');
    const tsconfig = JSON.parse(readFileSync(resolve(projectRoot, 'tsconfig.json'), 'utf8')) as {
      exclude?: string[];
    };

    expect(gitignore).toMatch(/^\/worktrees\/$/m);
    expect(tsconfig.exclude).toContain('.worktrees/**/*');
    expect(tsconfig.exclude).toContain('worktrees/**/*');
  });
});
