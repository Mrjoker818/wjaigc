import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');

describe('workflow execution persistence wiring', () => {
  it('persists authenticated executions and recovers a status from cloud storage', () => {
    expect(source).toContain("from '@/lib/cloud-task-storage'");
    expect(source).toContain('createCloudTask');
    expect(source).toContain('updateCloudTask');
    expect(source).toContain('getCloudTaskForUser');
    expect(source).toContain("type: 'workflow'");
    expect(source).toContain('persistWorkflowExecution');
    expect(source).toContain('auth.userId');
    expect(source).toMatch(/execState\.currentNodeId = node\.id;\r?\n    await persistWorkflowExecution\(executionId, execState\);/);
    expect(source).toMatch(/await persistWorkflowExecution\(executionId, execState\);\r?\n        continue;/);
  });
});
