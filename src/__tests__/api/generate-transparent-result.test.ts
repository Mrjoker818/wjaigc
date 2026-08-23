import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const generateSource = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');
const persistenceSource = readFileSync(resolve(process.cwd(), 'src/lib/cloud-task-persistence.ts'), 'utf8');
const pollSource = readFileSync(resolve(process.cwd(), 'src/app/api/poll-task/route.ts'), 'utf8');

describe('transparent generation result metadata', () => {
  it('persists transparent intent in every resumable generation payload and digest', () => {
    expect((generateSource.match(/background: body\.background/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((generateSource.match(/output_format: body\.output_format/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('verifies completed transparent results in the durable terminal boundary', () => {
    expect(persistenceSource).toContain('verifyGeneratedImageAlphaSet(');
    expect(persistenceSource).toContain('alphaVerification');
    expect(persistenceSource).toContain("submissionPayload?.background === 'transparent'");
    expect(persistenceSource).toContain('TRANSPARENT_RESULT_NOT_ALPHA');
    expect(persistenceSource).toContain("type: 'remove-background'");
    expect(persistenceSource).toContain('separatelyBilled: true');
  });

  it('exposes verification and the explicit action in task polling responses', () => {
    expect(pollSource).toContain('taskResult?.alphaVerification');
    expect(pollSource).toContain('taskResult?.warning');
    expect(pollSource).toContain('taskResult?.nextAction');
  });
});
