import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  userId: '',
  requests: 0,
  holdSubmit: false,
  submitSignal: null as AbortSignal | null,
  releaseSubmit: null as (() => void) | null,
  provider: { id: 'provider-a', name: 'synthetic', isEnabled: true, type: 'image', modelType: 'image', apiKey: 'synthetic-key', baseUrl: 'https://provider.invalid/v1', compatProfile: '', selectedModels: ['image-one'], discoveredModels: [], createdAt: 1, updatedAt: 1 },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: async () => [fixture.provider] }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: fixture.userId, role: 'admin', status: 'active' }), listManagedUsers: async () => [] }));
vi.mock('@/lib/display3d-prompts', () => ({ buildDisplay3DRenderPrompt: () => 'synthetic prompt' }));
vi.mock('@/lib/calculate-pixels', () => ({ calculateActualPixelsFromRatio: () => '1024x1024' }));
vi.mock('@/lib/api-validator', () => ({ validateApiInputs: () => null }));
vi.mock('@/lib/api-compatibility', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api-compatibility')>(),
  parseResponseForProfile: () => ({ mode: 'direct', taskIds: [], directImageUrls: ['/synthetic/image.png'] }),
}));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: async (_base: string, _path: string, options: RequestInit) => {
  fixture.requests++;
  fixture.submitSignal = options.signal ?? null;
  if (fixture.holdSubmit) await new Promise<void>(resolve => { fixture.releaseSubmit = resolve; });
  return { ok: true, json: async () => ({}) };
} }));

import { POST } from '@/app/api/display-3d/generate/route';
import { cancelTask, getActiveTaskCount, getTaskInfo, MAX_CONCURRENT_PER_USER, registerTask, updateTaskProgress } from '@/lib/task-registry';

const getSubmitSignal = (): AbortSignal | null => fixture.submitSignal;
let ownedTasks: string[] = [];
afterEach(() => {
  fixture.releaseSubmit?.();
  fixture.releaseSubmit = null;
  fixture.holdSubmit = false;
  // Cancel queued work before freeing slots, so cleanup cannot start a submission.
  for (const id of ownedTasks) {
    if (getTaskInfo(id)?.status === 'queued') {
      cancelTask(id);
      updateTaskProgress(id, { status: 'cancelled' });
    }
  }
  for (const id of ownedTasks) {
    const task = getTaskInfo(id);
    if (task && !['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) {
      cancelTask(id);
      updateTaskProgress(id, { status: 'cancelled' });
    }
  }
  ownedTasks = [];
});

async function enqueueDisplayTask(): Promise<string> {
  fixture.userId = `synthetic-display-queue-${crypto.randomUUID()}`;
  fixture.requests = 0;
  fixture.submitSignal = null;
  for (let index = 0; index < MAX_CONCURRENT_PER_USER; index++) {
    const id = `${fixture.userId}-blocker-${index}`;
    ownedTasks.push(id);
    registerTask(id, 'display3d', 'synthetic blocker', fixture.userId);
  }
  const res = await POST(new NextRequest('https://synthetic.invalid/api/display-3d/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brandName: 'synthetic', providerId: 'provider-a', model: 'image-one' }),
  }));
  expect(res.status).toBe(200);
  const body = await res.json() as { taskId: string };
  ownedTasks.push(body.taskId);
  return body.taskId;
}

describe('display3d queue admission with the real task registry', () => {
  it('does not submit until an active slot is released', async () => {
    const id = await enqueueDisplayTask();
    expect(getTaskInfo(id)?.status).toBe('queued');
    expect(fixture.requests).toBe(0);
    updateTaskProgress(ownedTasks[0], { status: 'completed' });
    await vi.waitFor(() => expect(fixture.requests).toBe(1));
    await vi.waitFor(() => expect(getTaskInfo(id)?.status).toBe('completed'));
  });

  it('never submits a task cancelled while waiting for a slot', async () => {
    const id = await enqueueDisplayTask();
    expect(getTaskInfo(id)?.status).toBe('queued');
    cancelTask(id);
    updateTaskProgress(id, { status: 'cancelled' });
    updateTaskProgress(ownedTasks[0], { status: 'completed' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fixture.requests).toBe(0);
    expect(getTaskInfo(id)?.status).toBe('cancelled');
  });

  it('does not retain a queue slot when only the cancellation mark is delivered', async () => {
    const id = await enqueueDisplayTask();
    cancelTask(id);
    await Promise.resolve();
    updateTaskProgress(ownedTasks[0], { status: 'completed' });
    await vi.waitFor(() => expect(getActiveTaskCount(fixture.userId)).toBe(MAX_CONCURRENT_PER_USER - 1));
    expect(fixture.requests).toBe(0);
  });

  it('does not submit if cancellation races with slot admission', async () => {
    const id = await enqueueDisplayTask();
    updateTaskProgress(ownedTasks[0], { status: 'completed' });
    cancelTask(id);
    updateTaskProgress(id, { status: 'cancelled' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.requests).toBe(0);
    expect(getTaskInfo(id)?.status).toBe('cancelled');
  });

  it('expires queued work without submitting and removes it from the queue', async () => {
    vi.useFakeTimers();
    try {
      const id = await enqueueDisplayTask();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(getTaskInfo(id)?.status).toBe('failed');
      expect(fixture.requests).toBe(0);
      updateTaskProgress(ownedTasks[0], { status: 'completed' });
      expect(getActiveTaskCount(fixture.userId)).toBe(MAX_CONCURRENT_PER_USER - 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signals cancellation to an in-flight submission and rejects its late result', async () => {
    fixture.userId = `synthetic-display-submit-${crypto.randomUUID()}`;
    fixture.requests = 0;
    fixture.submitSignal = null;
    fixture.holdSubmit = true;
    const res = await POST(new NextRequest('https://synthetic.invalid/api/display-3d/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'synthetic', providerId: 'provider-a', model: 'image-one' }),
    }));
    const body = await res.json() as { taskId: string };
    ownedTasks.push(body.taskId);
    await vi.waitFor(() => expect(fixture.requests).toBe(1));
    cancelTask(body.taskId);
    updateTaskProgress(body.taskId, { status: 'cancelled' });
    expect(getSubmitSignal()?.aborted).toBe(true);
    fixture.releaseSubmit?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(getTaskInfo(body.taskId)?.status).toBe('cancelled');
  });
});
