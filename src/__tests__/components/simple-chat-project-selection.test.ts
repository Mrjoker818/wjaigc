import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  recoverInterruptedSimpleChatProjects,
  selectInitialSimpleChatProject,
} from '@/components/simple-chat/simple-chat-types';

describe('simple chat project deep link', () => {
  const projects = [
    { id: 'chat-a', tasks: [{ id: 'task-a' }] },
    { id: 'chat-b', tasks: [{ id: 'task-b' }] },
  ];

  it('selects the project requested by the URL', () => {
    expect(selectInitialSimpleChatProject(projects, 'chat-b')).toEqual({
      projectId: 'chat-b',
      taskId: 'task-b',
    });
  });

  it('falls back to the first available project', () => {
    expect(selectInitialSimpleChatProject(projects, 'missing')).toEqual({
      projectId: 'chat-a',
      taskId: 'task-a',
    });
  });

  it('restores the exact task requested by the URL', () => {
    const projectsWithHistory = [
      { id: 'chat-a', tasks: [{ id: 'task-a' }] },
      { id: 'chat-b', tasks: [{ id: 'task-b-old' }, { id: 'task-b-active' }] },
    ];

    expect(selectInitialSimpleChatProject(
      projectsWithHistory,
      'chat-b',
      'task-b-active',
    )).toEqual({
      projectId: 'chat-b',
      taskId: 'task-b-active',
    });
  });

  it('keeps the active task identity in the simple-chat URL', async () => {
    const pageSource = await readFile(resolve(process.cwd(), 'src/app/simple-chat/page.tsx'), 'utf8');

    expect(pageSource).toContain("new URLSearchParams(window.location.search).get('taskId')");
    expect(pageSource).toContain(
      'selectInitialSimpleChatProject(loaded, requestedProjectId, requestedTaskId)',
    );
    expect(pageSource).toContain("current.searchParams.set('taskId', activeTaskId)");
  });

  it('normalizes interrupted messages before hydrated projects are persisted', () => {
    const interrupted = [{
      id: 'chat-b',
      name: 'Project B',
      description: '',
      createdAt: 1,
      updatedAt: 2,
      agents: [],
      knowledgeItems: [],
      tasks: [{
        id: 'task-b-active',
        projectId: 'chat-b',
        name: 'Interrupted task',
        model: 'deepseek-v4-flash',
        providerId: 'provider-apimart',
        createdAt: 1,
        updatedAt: 2,
        messages: [{
          id: 'assistant-1',
          role: 'assistant' as const,
          content: '',
          status: 'streaming' as const,
          createdAt: 2,
          retryContext: {
            version: 1 as const,
            kind: 'chat' as const,
            projectId: 'chat-b',
            taskId: 'task-b-active',
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            idempotencyKey: 'simple-chat-retry:task-b-active:assistant-1',
            modelId: 'deepseek-v4-flash',
            providerId: 'provider-apimart',
            webSearch: false,
            sourceVersionIds: [],
            selectedEntityIds: [],
            historyMessageIds: [],
            systemMessages: [],
            knowledgeItems: [],
            memories: [],
          },
        }],
      }],
    }];

    const recovered = recoverInterruptedSimpleChatProjects(interrupted);

    expect(recovered[0].tasks[0].messages[0]).toMatchObject({
      id: 'assistant-1',
      status: 'failed',
      error: {
        message: '上次请求中断，可重试。',
        retryable: true,
      },
    });
    expect(interrupted[0].tasks[0].messages[0].status).toBe('streaming');
  });
});
