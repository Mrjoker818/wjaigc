import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/quality.yml'),
  'utf8',
);

describe('quality workflow contract', () => {
  it('runs the official production dependency audit before build acceptance', () => {
    expect(workflow).toContain('pnpm audit --prod --json --registry=https://registry.npmjs.org');
  });

  it('uses packageManager as the single pnpm version source', () => {
    expect(workflow).not.toMatch(/pnpm\/action-setup@v4\s+with:\s+version:/);
  });
});
