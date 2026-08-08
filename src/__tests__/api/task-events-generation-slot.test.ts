import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { attachCanonicalGenerationSlotToEvent } from '@/lib/task-core/generation-batch';
import type { TaskEvent } from '@/lib/task-registry';

describe('task-events generation slot contract', () => {
  it('projects durable generation events through the shared canonical slot projector', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/task-events/route.ts'),
      'utf8',
    );

    expect(source).toContain("attachCanonicalGenerationSlotToEvent");
    expect(source).toContain("const payload = projectTaskEventPayload(event)");
    expect(source).toContain("return attachCanonicalGenerationSlotToEvent(event)");
  });

  it('preserves the legacy SSE envelope while attaching canonical slot metadata', () => {
    const event: TaskEvent = {
      taskId: 'task-slot-2',
      type: 'completed',
      task: {
        taskId: 'task-slot-2',
        type: 'generate-async',
        status: 'completed',
        progress: 100,
        result: {
          submissionPayload: {
            batchId: 'batch-sse',
            slotId: 'batch-sse:1',
            slotIndex: 1,
          },
          imageUrl: 'https://cdn.example.com/slot-2.png',
        },
        createdAt: 1,
        updatedAt: 2,
      },
    };

    expect(attachCanonicalGenerationSlotToEvent(event)).toEqual({
      ...event,
      batchId: 'batch-sse',
      slotId: 'batch-sse:1',
      slotIndex: 1,
      status: 'completed',
      result: {
        imageUrl: 'https://cdn.example.com/slot-2.png',
      },
    });
  });
});
