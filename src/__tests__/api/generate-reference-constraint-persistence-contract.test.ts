import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generate reference constraint persistence contract', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/app/api/generate/route.ts'),
    'utf8',
  );

  it('persists per-category reference strengths into every resumable generation payload', () => {
    const payloadBlocks = [...source.matchAll(
      /const submissionPayload: Record<string, unknown> = \{([\s\S]*?)\n      \};/g,
    )];

    expect(payloadBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of payloadBlocks) {
      expect(block[1]).toContain('referenceCategoryStrengths,');
    }
  });
});
