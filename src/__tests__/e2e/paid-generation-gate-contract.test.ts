import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/quality.yml'), 'utf8');
const p0Spec = readFileSync(resolve(process.cwd(), 'tests/e2e/p0-core.spec.ts'), 'utf8');

describe('paid generation E2E gate contract', () => {
  it('accepts the same explicit approval values in CI and the browser suite', () => {
    expect(workflow).toContain('E2E_ENABLE_PAID_GENERATION');
    expect(workflow).toContain('[ "$E2E_ENABLE_PAID_GENERATION" != "true" ]');
    expect(p0Spec).toContain("['true', '1'].includes((process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase())");
  });
});
