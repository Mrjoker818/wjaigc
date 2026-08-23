import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const generateSource = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
const persistenceSource = readFileSync(resolve(process.cwd(), 'src/lib/cloud-task-persistence.ts'), 'utf8');

describe('transparent generation result metadata', () => {
  it('persists transparent intent in every resumable generation payload and digest', () => {
    expect((generateSource.match(/background: body\.background/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((generateSource.match(/output_format: body\.output_format/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('verifies completed transparent results in the durable terminal boundary', () => {
    expect(persistenceSource).toContain('verifyGeneratedImageAlpha(');
    expect(persistenceSource).toContain('alphaVerification');
    expect(persistenceSource).toContain("submissionPayload?.background === 'transparent'");
  });
});
