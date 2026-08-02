import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const evidenceSource = readFileSync(
  resolve(process.cwd(), 'tests/helpers/evidence.ts'),
  'utf8',
);
const p0Source = readFileSync(
  resolve(process.cwd(), 'tests/e2e/p0-core.spec.ts'),
  'utf8',
);

describe('browser dialog evidence contract', () => {
  it('records and dismisses unexpected native browser dialogs during E2E tests', () => {
    expect(evidenceSource).toContain("page.on('dialog'");
    expect(evidenceSource).toContain('evidence.dialogs.push');
    expect(evidenceSource).toContain('dialog.dismiss()');
  });

  it('fails the P0 browser journey when an unexpected native dialog appears', () => {
    expect(p0Source).toMatch(/expect\(\s*evidence\.dialogs,/);
  });
});
