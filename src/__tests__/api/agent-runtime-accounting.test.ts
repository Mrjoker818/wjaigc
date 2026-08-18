import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Agent runtime accounting and result projection boundaries', () => {
  it('keeps public Agent routes behind the shared runtime accounting service', () => {
    const collectionRoute = source('src/app/api/agent-runs/route.ts');
    const runRoute = source('src/app/api/agent-runs/[runId]/route.ts');
    const runtime = source('src/lib/agent-runtime/service.ts');
    const routeAggregate = `${collectionRoute}\n${runRoute}`;

    expect(collectionRoute).toContain('createAgentRun');
    expect(runRoute).toContain('cancelAgentRun');
    expect(routeAggregate).not.toMatch(/consumeCredits|refundCredits|chargeCloudTaskCredits/);
    expect(runtime).toContain('createBillableTask');
    expect(runtime).toContain('settleFailedTask');
    expect(runtime).toContain('transitionTask');
  });

  it('routes durable and standalone-chat Agent results through one workspace projector', () => {
    const persistence = source('src/lib/cloud-task-persistence.ts');
    const standaloneChat = source('src/app/api/simple-chat/chat/route.ts');

    expect(persistence).toContain("from '@/lib/agent-runtime/workspace-results'");
    expect(persistence).toContain('await projectAgentResultToWorkspace({');
    expect(persistence).toContain('idempotencyKey: agentWorkspaceProjectionIdempotencyKey({');
    expect(standaloneChat).toContain("from '@/lib/agent-runtime/workspace-results'");
    expect(standaloneChat).toContain('await projectAgentResultToWorkspace({');
    expect(standaloneChat).toContain('idempotencyKey: agentWorkspaceProjectionIdempotencyKey({');
  });

  it('keeps Stage 4 inventory, PostgreSQL accounting, and five-browser v2 evidence in CI', () => {
    const qualityWorkflow = source('.github/workflows/quality.yml');

    expect(qualityWorkflow).toContain('stage-4-workspace-interoperability:');
    expect(qualityWorkflow).toContain('pnpm test:inventory:stage-4');
    expect(qualityWorkflow).toContain('tests/integration/stage-4-agent-accounting-postgres.test.ts');
    expect(qualityWorkflow).toContain('tests/integration/stage-4-agent-events-postgres.test.ts');
    expect(qualityWorkflow).toContain('E2E_STAGE4_EXPECTED_AGENT_MODE: agent-v2');
    expect(qualityWorkflow).toContain('E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE: react-flow-v2');
    expect(qualityWorkflow).toContain('pnpm test:e2e:stage-4');
  });
});
