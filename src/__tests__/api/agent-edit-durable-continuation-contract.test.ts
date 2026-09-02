import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/agent-edit/route.ts'),
  'utf8',
);
const servicePath = path.join(
  process.cwd(),
  'src/lib/agent-runtime/agent-edit-execution-service.ts',
);
const serviceSource = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, 'utf8') : '';
const executorSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/agent-runtime/agent-edit-executor.ts'),
  'utf8',
);

describe('agent-edit durable continuation contract', () => {
  it('keeps the HTTP route thin and shares a route-independent execution service', () => {
    expect(routeSource).toContain("@/lib/agent-runtime/agent-edit-execution-service");
    expect(routeSource).not.toContain('persistPrivateAgentExecutionDescriptor');
    expect(routeSource).not.toContain('executeAgentEditTask');
    expect(serviceSource).toContain('persistPrivateAgentExecutionDescriptor');
    expect(serviceSource).toContain('agentEditContinuation:');
    expect(serviceSource).toContain('export async function executePersistedAgentEditDescriptor');
    expect(serviceSource).toContain('await executeAgentEditTask(input.operationContext)');
    expect(serviceSource).not.toContain("from '@/lib/agent-runtime/same-task-adapter'");
    expect(executorSource).toContain("import('./agent-edit-execution-service')");
    expect(executorSource).not.toContain('@/app/api/agent-edit/route');
  });

  it('does not treat an absent process-local task entry as cancellation', () => {
    expect(serviceSource).not.toMatch(/return\s+!task\s*\|\|\s*task\.status\s*===\s*['"]cancelled['"]/);
    expect(serviceSource).toContain("agentRuntimeMode === 'agent-v2'");
    expect(serviceSource).toContain('operationSignal.aborted');
    expect(serviceSource).toContain('const operationSignal = operationContext.signal || executionSignal;');
  });
});
