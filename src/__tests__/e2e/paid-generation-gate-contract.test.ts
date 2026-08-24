import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/quality.yml'), 'utf8');
const p0Spec = readFileSync(resolve(process.cwd(), 'tests/e2e/p0-core.spec.ts'), 'utf8');
const transparentSpec = readFileSync(
  resolve(process.cwd(), 'tests/e2e/native-transparent-generation.spec.ts'),
  'utf8',
);

describe('paid generation E2E gate contract', () => {
  it('accepts the same explicit approval values in CI and the browser suite', () => {
    expect(workflow).toContain('E2E_ENABLE_PAID_GENERATION');
    expect(workflow).toContain('[ "$E2E_ENABLE_PAID_GENERATION" != "true" ]');
    expect(p0Spec).toContain("['true', '1'].includes((process.env.E2E_ENABLE_PAID_GENERATION || '').toLowerCase())");
  });

  it('keeps the real transparent paid test progressive and accounting-aware', () => {
    expect(transparentSpec).toContain("getByRole('button', { name: 'x2', exact: true })");
    expect(transparentSpec).toContain('expect(taskIds).toHaveLength(2)');
    expect(transparentSpec).toContain('releaseSecondSlotPolling');
    expect(transparentSpec).toContain('expect(alphaVerification).toMatchObject');
    expect(transparentSpec).toContain("page.request.get('/api/credits')");
    expect(transparentSpec).toContain('expectedCreditCost');
    expect(transparentSpec).toContain("saveBrowserEvidence(page, testInfo, evidence, 'native-transparent-generation-x2')");
  });
});
