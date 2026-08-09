import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('image edit task admission contract', () => {
  it('never returns an asynchronous provider task before durable persistence finishes', () => {
    expect(source).not.toMatch(/void\s+recordImageTaskSubmitted\s*\(/);
    expect(source).toContain('await persistSubmittedImageTask({');
  });

  it('persists one durable record for each asynchronous erase task', () => {
    const eraseAdmissions = source.match(
      /await persistSubmittedImageTask\(\{[\s\S]*?type: 'erase',[\s\S]*?\}\);/g,
    ) || [];

    expect(eraseAdmissions).toHaveLength(1);
  });

  it('enables core-v2 only for the staged 302 upscale admission path', () => {
    expect(source).toContain('resolveImageEditTaskCoreMode(');
    expect(source).toMatch(/executeTaskEntryMigration(?:<[^>]+>)?\(\{/);
    expect(source).toContain('createBillableTask({');
    expect(source).toContain("action === 'upscale' && Boolean(requested302UpscaleModel)");
  });

  it('settles an admitted core-v2 task instead of issuing a legacy refund', () => {
    expect(source).toContain('atomicBillingTaskId = admission.value.taskId');
    expect(source).toContain('await settleFailedTask({');
    expect(source).toContain('if (usesAtomicBilling && atomicBillingTaskId)');
  });
});
