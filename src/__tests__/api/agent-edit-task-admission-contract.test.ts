import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-runtime/agent-edit-execution-service.ts'),
  'utf8',
);
const persistenceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-task-persistence.ts'),
  'utf8',
);
const chatRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/chat/route.ts'),
  'utf8',
);
const providerSubmissionSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-runtime/provider-submission.ts'),
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

  it('bounds and replays an owned terminal task before current model or placement authorization', () => {
    const auth = routeSource.indexOf('requireApiAuthOrReject(request)');
    const bounds = routeSource.indexOf('parseBoundedAgentSurfaceBody', auth);
    const replayLookup = routeSource.indexOf('getCloudTaskForUserByIdempotencyKey', bounds);
    const modelAuthorization = routeSource.indexOf('resolveTaskModel(', replayLookup);
    const placementAuthorization = routeSource.indexOf('admitAuthorizedAgentExecution({', replayLookup);

    expect(bounds).toBeGreaterThan(auth);
    expect(replayLookup).toBeGreaterThan(bounds);
    expect(replayLookup).toBeLessThan(modelAuthorization);
    expect(replayLookup).toBeLessThan(placementAuthorization);
  });

  it('never normalizes exact agent-v2 chat or image model spelling', () => {
    expect(routeSource).toContain('strictProviderModel ? imageModel : normalizeModelForApi(imageModel)');
    expect(routeSource).toContain('pureImageModel,');
    expect(routeSource).toContain('strictProviderModel ? exactImageModel : stripProviderModelPrefix(exactImageModel)');
  });

  it('binds both agent-edit and canvas chat to the selected entity placement URL', () => {
    expect(routeSource).toContain('resolveSelectedAgentMediaUrl(authorizedContext, selectedEntityIds)');
    expect(chatRouteSource).toContain(
      'resolveSelectedAgentMediaUrl(authorizedContext, input.taskContext.selectedEntityIds || [])',
    );
  });

  it('never retries a strict provider submit at an alternate v1 endpoint', () => {
    expect(routeSource).toContain("skipV1Retry: agentRuntimeMode === 'agent-v2'");
    expect(routeSource.match(/submitAgentImageProviderRequest\(\{/g)).toHaveLength(3);
    expect(providerSubmissionSource).toContain('skipV1Retry: strictProviderModel');
  });

  it('carries stable idempotency on every Agent provider-facing submit', () => {
    expect(routeSource).toContain("headers['Idempotency-Key'] = stepContext.idempotencyKey");
    expect(routeSource).not.toContain("`${operationContext.idempotencyKey}:${stepKey}`");
    expect(routeSource).toContain('submitStrictAgentGeneration({');
    expect(routeSource).toContain('model: String(pureImageModel)');
    expect(routeSource).toContain('await stepContext.recordAccepted(genTaskId)');
    expect(routeSource).toContain('recovery: {');
    expect(routeSource).not.toContain('model: imageModel,\n                  providerId: imageProviderId');
    expect(routeSource).toContain("'Idempotency-Key': providerIdempotencyKey");
  });

  it('owns every provider-facing tool call with a durable child operation', () => {
    for (const toolId of [
      'upscale',
      'remove_background',
      'svg_trace',
      'generate_image',
      'generate_video',
      'extend_video',
    ]) {
      expect(routeSource).toContain(`toolId: '${toolId}'`);
    }
    expect(routeSource).not.toContain("getInternalApiUrl(`/api/poll-task?taskId=${vTaskId}`)");
    expect(routeSource).not.toContain("getInternalApiUrl(`/api/poll-task?taskId=${exTaskId}`)");
    expect(routeSource).toContain('await stepContext.recordAccepted(providerTaskId)');
  });

  it('propagates an Agent-v2 provider exception to the durable adapter for one terminal settlement', () => {
    expect(routeSource).toMatch(
      /console\.error\('\[agent-edit\] Error:'[\s\S]{0,200}?if \(agentRuntimeMode === 'agent-v2'\) throw err;[\s\S]{0,300}?await recordAgentTaskTerminal\(taskId/,
    );
  });
});
