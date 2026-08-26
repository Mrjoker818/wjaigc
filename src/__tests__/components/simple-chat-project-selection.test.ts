import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
});
