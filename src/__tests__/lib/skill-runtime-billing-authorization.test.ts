import { describe, expect, it } from 'vitest';
import { assertSkillBillingAuthorization } from '@/lib/skill-runtime/billing-authorization';

function fixture() {
  return {
    source: 'internal',
    actorUserId: 'user-1', projectId: 'project-1',
    providerId: 'provider-1', modelId: 'image-1', outputCount: 1,
    idempotencyKey: 'agent-provider:operation',
    context: {
      runId: 'run-1', stepId: 'generate', requestDigest: 'step-digest',
      operationKey: 'agent-op:operation',
      executionFence: { runId: 'run-1', leaseOwner: 'lease-1', generation: 1 },
    },
    task: {
      id: 'run-1', userId: 'user-1', projectId: 'project-1', type: 'agent-run',
      status: 'processing', creditStatus: 'charged', creditCost: 62,
      chargedTransactionId: 'charge-1', refundedTransactionId: '',
    },
    charge: { id: 'charge-1', userId: 'user-1', taskId: 'run-1', type: 'consume', amount: -62 },
    lease: { runId: 'run-1', actorUserId: 'user-1', projectId: 'project-1',
      leaseOwner: 'lease-1', generation: 1, pausedAt: 0, completedAt: 0 },
    operation: { operationKey: 'agent-op:operation', actorUserId: 'user-1', projectId: 'project-1',
      runId: 'run-1', stepId: 'generate', toolId: 'generate_image', requestDigest: 'step-digest',
      idempotencyKey: 'agent-provider:operation', status: 'submitted' },
    frozen: {
      skill: { modelBindings: { image: { providerId: 'provider-1', modelId: 'image-1' } } },
      skillSnapshot: { steps: [{ id: 'generate', toolId: 'generate_image', modelRole: 'image' }] },
    },
  };
}

describe('Skill prepaid generation authorization', () => {
  it('authorizes a paid parent without inspecting remaining user balance', () => {
    expect(assertSkillBillingAuthorization(fixture())).toEqual({
      runId: 'run-1', stepId: 'generate', operationKey: 'agent-op:operation',
      chargedTransactionId: 'charge-1',
    });
  });

  it('accepts pending settlement only when the original debit ledger is present', () => {
    const input = fixture();
    input.task.creditStatus = 'pending';
    expect(assertSkillBillingAuthorization(input)).toMatchObject({ chargedTransactionId: 'charge-1' });
  });

  it('preserves an authoritative zero-cost parent without fabricating a debit', () => {
    const input = fixture();
    input.task.creditStatus = 'not-applicable';
    input.task.creditCost = 0;
    input.task.chargedTransactionId = '';
    expect(assertSkillBillingAuthorization({ ...input, charge: null }))
      .toMatchObject({ runId: 'run-1', chargedTransactionId: '' });
  });

  it.each([
    ['session forgery', (v: ReturnType<typeof fixture>) => { v.source = 'session'; }],
    ['wrong owner', (v: ReturnType<typeof fixture>) => { v.task.userId = 'other'; }],
    ['wrong project', (v: ReturnType<typeof fixture>) => { v.task.projectId = 'other'; }],
    ['wrong parent', (v: ReturnType<typeof fixture>) => { v.task.id = 'other'; }],
    ['not a Skill run', (v: ReturnType<typeof fixture>) => { v.task.type = 'generate'; }],
    ['unpaid', (v: ReturnType<typeof fixture>) => { v.task.creditStatus = 'not-applicable'; }],
    ['refunded', (v: ReturnType<typeof fixture>) => { v.task.refundedTransactionId = 'refund-1'; }],
    ['missing ledger charge', (v: ReturnType<typeof fixture>) => { v.charge.id = ''; }],
    ['wrong ledger owner', (v: ReturnType<typeof fixture>) => { v.charge.userId = 'other'; }],
    ['wrong ledger task', (v: ReturnType<typeof fixture>) => { v.charge.taskId = 'other'; }],
    ['wrong ledger type', (v: ReturnType<typeof fixture>) => { v.charge.type = 'recharge'; }],
    ['wrong charge amount', (v: ReturnType<typeof fixture>) => { v.charge.amount = -2; }],
    ['cancelled parent', (v: ReturnType<typeof fixture>) => { v.task.status = 'cancelled'; }],
    ['stale fence', (v: ReturnType<typeof fixture>) => { v.lease.generation = 2; }],
    ['paused lease', (v: ReturnType<typeof fixture>) => { v.lease.pausedAt = 1; }],
    ['finished lease', (v: ReturnType<typeof fixture>) => { v.lease.completedAt = 1; }],
    ['wrong operation', (v: ReturnType<typeof fixture>) => { v.operation.operationKey = 'other'; }],
    ['wrong step', (v: ReturnType<typeof fixture>) => { v.operation.stepId = 'other'; }],
    ['changed step digest', (v: ReturnType<typeof fixture>) => { v.operation.requestDigest = 'other'; }],
    ['changed idempotency key', (v: ReturnType<typeof fixture>) => { v.idempotencyKey = 'other'; }],
    ['completed operation', (v: ReturnType<typeof fixture>) => { v.operation.status = 'completed'; }],
    ['wrong provider', (v: ReturnType<typeof fixture>) => { v.providerId = 'other'; }],
    ['wrong model', (v: ReturnType<typeof fixture>) => { v.modelId = 'other'; }],
    ['orchestrator step', (v: ReturnType<typeof fixture>) => { v.frozen.skillSnapshot.steps[0].modelRole = 'orchestrator'; }],
    ['extra free images', (v: ReturnType<typeof fixture>) => { v.outputCount = 2; }],
  ])('rejects %s', (_name, change) => {
    const input = fixture();
    change(input);
    expect(() => assertSkillBillingAuthorization(input)).toThrowError(/SKILL_BILLING_NOT_AUTHORIZED/);
  });
});
