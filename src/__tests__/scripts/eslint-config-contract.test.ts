import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ESLint repository boundaries', () => {
  it('does not lint nested worktrees as part of the active checkout', () => {
    const config = readFileSync(resolve(process.cwd(), 'eslint.config.mjs'), 'utf8');
    for (const ignoredPath of [
      '.worktrees/**',
      '.playwright-cli/**',
      '.playwright-output/**',
      'output/**',
    ]) {
      expect(config).toContain(`'${ignoredPath}'`);
    }
  });
});
