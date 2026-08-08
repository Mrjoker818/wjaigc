import { describe, expect, it } from 'vitest';

import {
  createDurableGenerationBatch,
  normalizeGenerationSubmitSlots,
  projectCanonicalGenerationSlot,
  reconcileGenerationBatch,
  resolveGenerationSlotIndex,
  type CanonicalGenerationSlot,
} from '@/lib/task-core/generation-batch';

describe('durable generation batches', () => {
  it.each([1, 2, 3, 4] as const)(
    'creates %i stable ordered slots with unique child task identities',
    (requestedCount) => {
      const batch = createDurableGenerationBatch({
        batchId: 'batch-a',
        requestedCount,
        createTaskId: (slotIndex) => `task-${slotIndex}`,
      });

      expect(batch.requestedCount).toBe(requestedCount);
      expect(batch.slots).toHaveLength(requestedCount);
      expect(batch.slots.map((slot) => slot.slotId)).toEqual(
        Array.from({ length: requestedCount }, (_, index) => `batch-a:${index}`),
      );
      expect(batch.slots.map((slot) => slot.slotIndex)).toEqual(
        Array.from({ length: requestedCount }, (_, index) => index),
      );
      expect(new Set(batch.slots.map((slot) => slot.taskId)).size).toBe(requestedCount);
    },
  );

  it('clamps finite counts to the supported range and rejects invalid counts', () => {
    expect(createDurableGenerationBatch({
      batchId: 'batch-low',
      requestedCount: 0,
      createTaskId: (slotIndex) => `low-${slotIndex}`,
    }).requestedCount).toBe(1);
    expect(createDurableGenerationBatch({
      batchId: 'batch-high',
      requestedCount: 8,
      createTaskId: (slotIndex) => `high-${slotIndex}`,
    }).requestedCount).toBe(4);
    expect(() => createDurableGenerationBatch({
      batchId: 'batch-invalid',
      requestedCount: Number.NaN,
      createTaskId: (slotIndex) => `invalid-${slotIndex}`,
    })).toThrow('requestedCount');
  });

  it('exposes out-of-order completions immediately without changing slot order', () => {
    let batch = createDurableGenerationBatch({
      batchId: 'batch-order',
      requestedCount: 4,
      createTaskId: (slotIndex) => `task-${slotIndex + 1}`,
    });

    for (const slotNumber of [3, 1, 4, 2]) {
      const slotIndex = slotNumber - 1;
      batch = reconcileGenerationBatch(batch, {
        batchId: batch.batchId,
        slotId: `${batch.batchId}:${slotIndex}`,
        slotIndex,
        taskId: `task-${slotNumber}`,
        status: 'completed',
        result: { imageUrl: `https://cdn.example.com/${slotNumber}.png` },
      });

      expect(batch.slots[slotIndex]).toMatchObject({
        status: 'completed',
        result: { imageUrl: `https://cdn.example.com/${slotNumber}.png` },
      });
      expect(batch.slots.map((slot) => slot.slotIndex)).toEqual([0, 1, 2, 3]);
    }
  });

  it('keeps completed siblings and rejects stale or duplicate terminal rewrites', () => {
    const initial = createDurableGenerationBatch({
      batchId: 'batch-reload',
      requestedCount: 2,
      createTaskId: (slotIndex) => `task-${slotIndex}`,
    });
    const completedEvent: CanonicalGenerationSlot = {
      batchId: 'batch-reload',
      slotId: 'batch-reload:0',
      slotIndex: 0,
      taskId: 'task-0',
      status: 'completed',
      result: { imageUrl: 'https://cdn.example.com/result.png' },
    };

    const completed = reconcileGenerationBatch(initial, completedEvent);
    const siblingFailed = reconcileGenerationBatch(completed, {
      batchId: 'batch-reload',
      slotId: 'batch-reload:1',
      slotIndex: 1,
      taskId: 'task-1',
      status: 'failed',
      error: { code: 'PROVIDER_FAILED', message: 'provider rejected the request' },
    });
    const stale = reconcileGenerationBatch(siblingFailed, {
      ...completedEvent,
      status: 'processing',
      result: undefined,
    });
    const duplicate = reconcileGenerationBatch(stale, completedEvent);

    expect(duplicate.slots[0]).toEqual(completed.slots[0]);
    expect(duplicate.slots[1]).toMatchObject({
      status: 'failed',
      error: { code: 'PROVIDER_FAILED' },
    });
  });
});

describe('canonical generation slot projection', () => {
  it('normalizes canonical slots and preserves legacy taskIds compatibility', () => {
    expect(normalizeGenerationSubmitSlots({
      batchId: 'batch-submit',
      slots: [
        { taskId: 'task-2', slotId: 'batch-submit:1', slotIndex: 1, status: 'queued' },
        { taskId: 'task-1', slotId: 'batch-submit:0', slotIndex: 0, status: 'submitting' },
      ],
      taskIds: ['legacy-ignored'],
    })).toEqual([
      {
        taskId: 'task-1',
        batchId: 'batch-submit',
        slotId: 'batch-submit:0',
        slotIndex: 0,
        status: 'submitting',
      },
      {
        taskId: 'task-2',
        batchId: 'batch-submit',
        slotId: 'batch-submit:1',
        slotIndex: 1,
        status: 'queued',
      },
    ]);

    expect(normalizeGenerationSubmitSlots({
      taskIds: ['legacy-a', 'legacy-b'],
    })).toEqual([
      { taskId: 'legacy-a', slotIndex: 0, status: 'submitting' },
      { taskId: 'legacy-b', slotIndex: 1, status: 'submitting' },
    ]);
  });

  it('falls back to legacy task order when canonical slots contain duplicate or out-of-range indexes', () => {
    expect(normalizeGenerationSubmitSlots({
      batchId: 'batch-submit',
      slots: [
        { taskId: 'task-a', slotId: 'batch-submit:0', slotIndex: 0 },
        { taskId: 'task-b', slotId: 'batch-submit:duplicate', slotIndex: 0 },
      ],
      taskIds: ['task-a', 'task-b'],
    })).toEqual([
      { taskId: 'task-a', batchId: 'batch-submit', slotIndex: 0, status: 'submitting' },
      { taskId: 'task-b', batchId: 'batch-submit', slotIndex: 1, status: 'submitting' },
    ]);

    expect(normalizeGenerationSubmitSlots({
      batchId: 'batch-submit',
      slots: [
        { taskId: 'task-a', slotId: 'batch-submit:0', slotIndex: 0 },
        { taskId: 'task-b', slotId: 'batch-submit:9', slotIndex: 9 },
      ],
      taskIds: ['task-a', 'task-b'],
    })).toEqual([
      { taskId: 'task-a', batchId: 'batch-submit', slotIndex: 0, status: 'submitting' },
      { taskId: 'task-b', batchId: 'batch-submit', slotIndex: 1, status: 'submitting' },
    ]);
  });

  it('rejects conflicting batch identities and retains every task with stable fallback indexes', () => {
    expect(normalizeGenerationSubmitSlots({
      batchId: 'batch-submit',
      slots: [
        { taskId: 'task-a', batchId: 'other-batch', slotIndex: 0 },
        { taskId: 'task-b', batchId: 'batch-submit', slotIndex: 1 },
      ],
    })).toEqual([
      { taskId: 'task-a', batchId: 'batch-submit', slotIndex: 0, status: 'submitting' },
      { taskId: 'task-b', batchId: 'batch-submit', slotIndex: 1, status: 'submitting' },
    ]);
  });

  it('falls back safely when a legacy proxy returns an unknown slot status', () => {
    expect(normalizeGenerationSubmitSlots({
      batchId: 'batch-submit',
      slots: [
        { taskId: 'task-a', slotId: 'batch-submit:0', slotIndex: 0, status: 'provider-running' },
      ],
    })).toEqual([
      {
        taskId: 'task-a',
        batchId: 'batch-submit',
        slotId: 'batch-submit:0',
        slotIndex: 0,
        status: 'submitting',
      },
    ]);
  });

  it('keeps the submitted slot authoritative when server metadata conflicts', () => {
    const submitted = {
      taskId: 'task-a',
      slotId: 'batch-a:0',
      slotIndex: 0,
    };

    expect(resolveGenerationSlotIndex(submitted, {
      taskId: 'task-a',
      slotId: 'batch-a:0',
      slotIndex: 2,
    })).toBe(0);
    expect(resolveGenerationSlotIndex(submitted, {
      taskId: 'other-task',
      slotId: 'batch-a:2',
      slotIndex: 2,
    })).toBe(0);
  });

  it('projects the same durable slot identity for polling and SSE sources', () => {
    const taskResult = {
      submissionPayload: {
        batchId: 'batch-projection',
        slotId: 'batch-projection:2',
        slotIndex: 2,
      },
      imageUrl: 'https://cdn.example.com/result.png',
      imageUrls: ['https://cdn.example.com/result.png'],
      apiKey: 'must-not-leak',
    };

    const polling = projectCanonicalGenerationSlot({
      taskId: 'task-3',
      status: 'completed',
      result: taskResult,
    });
    const sse = projectCanonicalGenerationSlot({
      taskId: 'task-3',
      status: 'completed',
      result: taskResult,
    });

    expect(sse).toEqual(polling);
    expect(sse).toEqual({
      batchId: 'batch-projection',
      slotId: 'batch-projection:2',
      slotIndex: 2,
      taskId: 'task-3',
      status: 'completed',
      result: {
        imageUrl: 'https://cdn.example.com/result.png',
        imageUrls: ['https://cdn.example.com/result.png'],
      },
    });
  });

  it('returns null for legacy tasks without durable slot metadata', () => {
    expect(projectCanonicalGenerationSlot({
      taskId: 'legacy-task',
      status: 'processing',
      result: {},
    })).toBeNull();
  });
});
