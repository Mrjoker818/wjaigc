import type { AgentExecutionFence } from '@/lib/agent-runtime/execution-fence';

export interface SkillBillingContext {
  runId: string;
  stepId: string;
  requestDigest: string;
  operationKey: string;
  executionFence: AgentExecutionFence;
}

export interface SkillBillingAuthorizationInput {
  source: string;
  actorUserId: string;
  projectId: string;
  providerId: string;
  modelId: string;
  outputCount: number;
  idempotencyKey: string;
  context: SkillBillingContext;
  task: {
    id: string; userId: string; projectId: string; type: string; status: string;
    creditStatus: string; creditCost: number; chargedTransactionId: string;
    refundedTransactionId: string;
  };
  charge: { id: string; userId: string; taskId: string; type: string; amount: number } | null;
  lease: {
    runId: string; actorUserId: string; projectId: string; leaseOwner: string;
    generation: number; pausedAt: number; completedAt: number;
  };
  operation: {
    operationKey: string; actorUserId: string; projectId: string; runId: string;
    stepId: string; toolId: string; requestDigest: string; idempotencyKey: string; status: string;
  };
  frozen: {
    skill?: { modelBindings?: Record<string, { providerId: string; modelId: string }> };
    skillSnapshot?: { steps?: Array<{ id: string; toolId: string; modelRole: string }> };
  };
}

export interface SkillBillingProvenance {
  runId: string;
  stepId: string;
  operationKey: string;
  chargedTransactionId: string;
}

export function assertSkillBillingAuthorization(input: SkillBillingAuthorizationInput): SkillBillingProvenance {
  const { context, task, charge, lease, operation } = input;
  const fence = context.executionFence;
  const step = input.frozen.skillSnapshot?.steps?.find(candidate => candidate.id === context.stepId);
  const binding = step && input.frozen.skill?.modelBindings?.[step.modelRole];
  const prepaid = Number.isFinite(task.creditCost) && task.creditCost > 0
    && ['charged', 'pending'].includes(task.creditStatus)
    && Boolean(task.chargedTransactionId) && charge?.id === task.chargedTransactionId
    && charge.userId === input.actorUserId && charge.taskId === context.runId
    && charge.type === 'consume' && charge.amount === -task.creditCost;
  const configuredFree = task.creditCost === 0 && task.creditStatus === 'not-applicable'
    && task.chargedTransactionId === '' && charge === null;
  const identifiers = [
    input.actorUserId, input.projectId, input.providerId, input.modelId, input.idempotencyKey,
    context.runId, context.stepId, context.requestDigest, context.operationKey, fence?.leaseOwner,
  ];
  if (
    input.source !== 'internal'
    || identifiers.some(value => typeof value !== 'string' || !value.trim() || value.length > 256)
    || input.outputCount !== 1
    || !fence || fence.runId !== context.runId
    || !Number.isSafeInteger(fence.generation) || fence.generation < 0
    || task.id !== context.runId || task.userId !== input.actorUserId || task.projectId !== input.projectId
    || task.type !== 'agent-run' || task.status !== 'processing'
    || (!prepaid && !configuredFree) || task.refundedTransactionId !== ''
    || lease.runId !== context.runId || lease.actorUserId !== input.actorUserId
    || lease.projectId !== input.projectId || lease.leaseOwner !== fence.leaseOwner
    || lease.generation !== fence.generation || lease.pausedAt !== 0 || lease.completedAt !== 0
    || operation.operationKey !== context.operationKey || operation.runId !== context.runId
    || operation.actorUserId !== input.actorUserId || operation.projectId !== input.projectId
    || operation.stepId !== context.stepId || operation.toolId !== 'generate_image'
    || operation.requestDigest !== context.requestDigest || operation.idempotencyKey !== input.idempotencyKey
    || !['prepared', 'submitted'].includes(operation.status)
    || !step || step.toolId !== 'generate_image' || step.modelRole !== 'image'
    || !binding || binding.providerId !== input.providerId || binding.modelId !== input.modelId
  ) {
    throw new Error('SKILL_BILLING_NOT_AUTHORIZED');
  }
  return {
    runId: input.context.runId,
    stepId: input.context.stepId,
    operationKey: input.context.operationKey,
    chargedTransactionId: input.task.chargedTransactionId,
  };
}
