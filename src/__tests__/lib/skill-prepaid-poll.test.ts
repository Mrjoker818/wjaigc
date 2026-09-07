import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTask } from '@/lib/cloud-task-storage';
const mocks = vi.hoisted(() => ({ ensureTables: vi.fn(), getParent: vi.fn(), query: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cloud-task-storage', () => ({
  ensureCloudTaskTables: mocks.ensureTables,
  getCloudTaskForUser: mocks.getParent,
}));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ query: mocks.query }) }));
import {
  cancelSkillPrepaidChildren,
  inspectSkillPrepaidPoll,
  getSkillPrepaidSubmissionDeadline,
} from '@/lib/skill-runtime/prepaid-generation';

const child: CloudTask = {
  id: 'async-child', userId: 'user', projectId: 'project', type: 'generate-async', status: 'processing',
  progress: 0, creditStatus: 'not-applicable', creditCost: 0, createdAt: 1, updatedAt: 1,
  result: { skillBillingProvenance: { runId: 'parent', stepId: 'image-step', operationKey: 'op' } },
};
describe('prepaid child polling lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getParent.mockResolvedValue({ id: 'parent', userId: 'user', projectId: 'project',
      type: 'agent-run', status: 'processing', creditStatus: 'pending' });
    mocks.query.mockResolvedValue({ rows: [{ paused_at: 0, completed_at: 0,
      status: 'accepted', provider_task_id: 'async-child' }] });
  });
  it('does not alter standalone tasks', async () => {
    expect(await inspectSkillPrepaidPoll({ ...child, result: {} })).toEqual({ action: 'allow' });
    expect(mocks.getParent).not.toHaveBeenCalled();
  });
  it('allows an accepted child of an active parent', async () => {
    expect(await inspectSkillPrepaidPoll(child)).toEqual({ action: 'allow' });
  });
  it.each(['cancelled', 'failed', 'timeout'])('stops child when parent is %s', async (status) => {
    mocks.getParent.mockResolvedValue({ id: 'parent', userId: 'user', projectId: 'project', type: 'agent-run', status });
    expect(await inspectSkillPrepaidPoll(child)).toMatchObject({ action: 'stop', status });
  });
  it('waits while parent is paused', async () => {
    mocks.query.mockResolvedValue({ rows: [{ paused_at: 1, completed_at: 0, status: 'accepted', provider_task_id: 'async-child' }] });
    expect(await inspectSkillPrepaidPoll(child)).toMatchObject({ action: 'wait' });
  });
  it('waits before parent records durable acceptance', async () => {
    mocks.query.mockResolvedValue({ rows: [{ paused_at: 0, completed_at: 0, status: 'prepared', provider_task_id: '' }] });
    expect(await inspectSkillPrepaidPoll(child)).toMatchObject({ action: 'wait' });
  });
  it('refuses a child tied to another project', async () => {
    mocks.getParent.mockResolvedValue({ id: 'parent', userId: 'user', projectId: 'other', type: 'agent-run', status: 'processing' });
    expect(await inspectSkillPrepaidPoll(child)).toMatchObject({ action: 'stop', status: 'failed' });
  });
  it('excludes persisted pauses but retains the active submission budget', async () => {
    mocks.query.mockResolvedValue({ rows: [
      { event_type: 'run.paused', created_at: 60_000 },
      { event_type: 'run.resumed', created_at: 960_000 },
    ] });
    const deadline = await getSkillPrepaidSubmissionDeadline({ ...child, createdAt: 0 }, 1_000_000);
    expect(deadline).toEqual({ expired: false, deadlineAt: 1_500_000, remainingMs: 500_000 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('owner_id=$2'), ['parent', 'user', 'project']);
    expect(await getSkillPrepaidSubmissionDeadline({ ...child, createdAt: 0 }, 1_500_001))
      .toMatchObject({ expired: true, remainingMs: 0 });
  });
  it('does not extend standalone deadlines or query events', async () => {
    expect(await getSkillPrepaidSubmissionDeadline({ ...child, createdAt: 0, result: {} }, 700_000))
      .toEqual({ expired: true, deadlineAt: 600_000, remainingMs: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('clips pauses at child creation and ignores duplicate pauses and unmatched resumes', async () => {
    mocks.query.mockResolvedValue({ rows: [
      { event_type: 'run.resumed', created_at: 1 },
      { event_type: 'run.paused', created_at: 100 },
      { event_type: 'run.paused', created_at: 200 },
      { event_type: 'run.resumed', created_at: 1000 },
      { event_type: 'run.paused', created_at: 2000 },
    ] });
    expect(await getSkillPrepaidSubmissionDeadline({ ...child, createdAt: 500 }, 3000))
      .toEqual({ expired: false, deadlineAt: 602_000, remainingMs: 599_000 });
  });
  it('cancels only live zero-cost prepaid children owned by the cancelled parent run', async () => {
    mocks.getParent.mockResolvedValue({
      id: 'parent', userId: 'user', projectId: 'project', type: 'agent-run',
      status: 'cancelled', creditStatus: 'charged',
    });
    mocks.query.mockResolvedValue({ rows: [{ id: 'child-1' }, { id: 'child-2' }] });

    await expect(cancelSkillPrepaidChildren({
      actorUserId: 'user',
      runId: 'parent',
    })).resolves.toEqual(['child-1', 'child-2']);

    expect(mocks.ensureTables).toHaveBeenCalledTimes(1);
    expect(mocks.getParent).toHaveBeenCalledWith('parent', 'user');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE cloud_tasks[\s\S]*status IN \('queued', 'pending', 'processing'\)[\s\S]*credit_status = 'not-applicable'[\s\S]*skillBillingProvenance,runId/),
      ['parent', 'user', expect.any(Number), 'project'],
    );
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/FROM cloud_tasks parent/);
  });

  it('refuses to cancel children unless the owned parent is already cancelled', async () => {
    await expect(cancelSkillPrepaidChildren({
      actorUserId: 'user', runId: 'parent',
    })).resolves.toEqual([]);

    expect(mocks.query).not.toHaveBeenCalled();
  });
});
