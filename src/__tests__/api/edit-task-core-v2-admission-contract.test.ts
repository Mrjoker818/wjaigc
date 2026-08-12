import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/app/api/edit/route.ts'),
  'utf8',
);

describe('edit task core-v2 billing admission', () => {
  it('forces authenticated edit billing through the durable atomic task core', () => {
    expect(source).toContain('sessionUser = authResult.user');
    expect(source).toContain("const editTaskCoreMode = 'core-v2'");
    expect(source).not.toContain('sessionUser = await getSessionUser(request)');
    expect(source).toContain('mode: editTaskCoreMode');
    expect(source).toContain("usesAtomicBilling = admission.mode === 'core-v2'");
    expect(source).toContain("registerTask(taskId, 'edit', '语言修图', sessionUser?.id, annotationTaskId ? 'durable' : 'memory')");
  });
});
