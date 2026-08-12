import { describe, expect, it } from 'vitest';

import { selectInitialSimpleChatProject } from '@/components/simple-chat/simple-chat-types';

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
});
