import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/agent-edit/route.ts'),
  'utf8',
);
const persistenceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-task-persistence.ts'),
  'utf8',
);

describe('agent edit task admission contract', () => {
  it('validates content safety before any credit admission', () => {
    const safety = routeSource.indexOf('checkPromptSafety(prompt)');
    const legacyCharge = routeSource.indexOf('consumeCredits(');
    const atomicAdmission = routeSource.indexOf('createBillableTask({');

    expect(safety).toBeGreaterThan(0);
    expect(legacyCharge).toBeGreaterThan(safety);
    expect(atomicAdmission).toBeGreaterThan(safety);
  });

  it('uses guarded atomic admission and reuses duplicate requests', () => {
    expect(routeSource).toContain('executeTaskEntryMigration<AgentAdmission>({');
    expect(routeSource).toContain('createBillableTask({');
    expect(routeSource).toContain('admission.value.reused');
    expect(routeSource).toContain("code: 'AGENT_TASK_TERMINAL'");
  });

  it('does not expose terminal state before durable settlement', () => {
    expect(routeSource).not.toMatch(/void\s+recordAgentTaskTerminal/);
    expect(routeSource).toContain('await recordAgentTaskTerminal(taskId');
    expect(routeSource).not.toMatch(
      /localTaskStore\.set\(taskId,\s*\{[\s\S]{0,350}?status:\s*'failed'[\s\S]{0,350}?await recordAgentTaskTerminal\(taskId/,
    );
  });

  it('contains timeout persistence failures instead of creating an unhandled rejection', () => {
    expect(routeSource).toContain('[agent-edit] timeout persistence failed:');
  });

  it('settles failed agent tasks atomically and charges only completed tasks', () => {
    expect(persistenceSource).toContain('await settleFailedTask({');
    expect(persistenceSource).toContain("creditStatus: 'charged'");
  });

  it('tracks a legacy charge before durable task creation so admission failures can refund it', () => {
    const chargeTracking = routeSource.indexOf('deductedCredits = creditCost');
    const durableCreate = routeSource.indexOf('const created = await recordAgentTaskSubmitted({');

    expect(chargeTracking).toBeGreaterThan(0);
    expect(chargeTracking).toBeLessThan(durableCreate);
  });

  it('returns completed replays before same-task adoption in every runtime mode', () => {
    const replay = routeSource.indexOf("admission.value.status === 'completed'");
    const adoption = routeSource.indexOf('prepareAdmittedAgentTaskExecution({');
    expect(replay).toBeGreaterThan(0);
    expect(replay).toBeLessThan(adoption);
  });
});
