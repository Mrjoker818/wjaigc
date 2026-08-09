import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/edit/route.ts'),
  'utf8',
);

describe('language edit task admission contract', () => {
  it('uses one guarded migration path before starting background work', () => {
    expect(source).toMatch(/executeTaskEntryMigration(?:<[^>]+>)?\(\{/);
    expect(source).toContain('createBillableTask({');
    expect(source).toContain("annotationIdempotencyKey || requestId");
  });

  it('does not issue a legacy refund for a core-v2 admission', () => {
    expect(source).toContain('usesAtomicBilling');
    expect(source).toContain('if (usesAtomicBilling && annotationTaskId)');
    expect(source).toContain('else if (!usesAtomicBilling && deductedCredits > 0 && sessionUser)');
  });

  it('preserves billing and idempotency HTTP semantics', () => {
    expect(source).toContain('error instanceof InsufficientCreditsError');
    expect(source).toContain('error instanceof IdempotencyConflictError');
    expect(source).toContain('{ status: error.statusCode }');
  });
});
