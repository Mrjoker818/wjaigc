import { describe, expect, it } from 'vitest';

import {
  consumeSimpleChatWorkspaceHandoffForProject,
  createSimpleChatWorkspaceHandoffRunGuard,
  getSimpleChatWorkspaceHandoffIdentity,
  shouldConsumeSimpleChatWorkspaceHandoff,
} from '@/lib/simple-chat-workspace-handoff-client';
import { createEmptyWorkflow } from '@/lib/workflow-engine';

const intent = {
  targetProjectId: 'canvas-1',
  chatProjectId: 'chat-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

describe('simple chat workspace consumer guard', () => {
  it('consumes only a handoff for the current project', () => {
    expect(shouldConsumeSimpleChatWorkspaceHandoff(intent, 'canvas-1')).toBe(true);
    expect(shouldConsumeSimpleChatWorkspaceHandoff(intent, 'canvas-2')).toBe(false);
    expect(shouldConsumeSimpleChatWorkspaceHandoff(null, 'canvas-1')).toBe(false);
  });

  it('suppresses only the same running identity and allows retry after failure', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const identity = getSimpleChatWorkspaceHandoffIdentity(intent);

    expect(guard.begin(identity)).toBe(true);
    expect(guard.begin(identity)).toBe(false);
    guard.fail(identity);
    expect(guard.begin(identity)).toBe(true);
  });

  it('does not let an older failed run reset a newer identity', () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const first = getSimpleChatWorkspaceHandoffIdentity(intent);
    const second = getSimpleChatWorkspaceHandoffIdentity({ ...intent, chatMessageId: 'message-2' });

    expect(guard.begin(first)).toBe(true);
    expect(guard.begin(second)).toBe(true);
    guard.fail(first);
    expect(guard.begin(second)).toBe(false);
  });

  it('runs the existing executor only for the matching project and releases failures for retry', async () => {
    const guard = createSimpleChatWorkspaceHandoffRunGuard();
    const events: string[] = [];
    let persistAttempts = 0;
    const input = {
      intent,
      currentProjectId: 'canvas-1',
      currentWorkflow: createEmptyWorkflow('existing'),
      guard,
      resolve: async () => {
        events.push('resolve');
        return {
          text: 'hello',
          images: [],
          sourceTrace: {
            source: 'simple-chat' as const,
            chatProjectId: 'chat-1',
            chatTaskId: 'task-1',
            messageId: 'message-1',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
          warnings: [],
        };
      },
      transfer: async () => { throw new Error('unexpected transfer'); },
      persist: async () => {
        persistAttempts += 1;
        events.push('persist');
        if (persistAttempts === 1) throw new Error('save failed');
      },
      cleanUrl: () => { events.push('clean'); },
      now: () => 1000,
    };

    await expect(consumeSimpleChatWorkspaceHandoffForProject({
      ...input,
      currentProjectId: 'canvas-2',
    })).resolves.toBeNull();
    expect(events).toEqual([]);

    await expect(consumeSimpleChatWorkspaceHandoffForProject(input)).rejects.toThrow('save failed');
    await expect(consumeSimpleChatWorkspaceHandoffForProject(input)).resolves.toMatchObject({ status: 'success' });
    expect(events).toEqual(['resolve', 'persist', 'resolve', 'persist', 'clean']);
  });
});
