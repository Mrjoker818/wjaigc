import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProjects, saveProjects } from '@/components/simple-chat/simple-chat-types';

const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);
const simpleChatStorageSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/simple-chat-types.ts'),
  'utf8',
);
const simpleChatPageSource = readFileSync(
  resolve(process.cwd(), 'src/app/simple-chat/page.tsx'),
  'utf8',
);
const userDataSyncSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/user-data/sync/route.ts'),
  'utf8',
);

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'window');
});

describe('simple chat dashboard synchronization contract', () => {
  it('uses the same project storage reader as the simple-chat page', () => {
    expect(simpleChatStorageSource).toContain("const PROJECTS_KEY = 'wujie_chat_projects'");
    expect(dashboardSource).toContain(
      "import { loadProjects as loadSimpleChatProjects } from '@/components/simple-chat/simple-chat-types';",
    );
    expect(dashboardSource).toContain('const projects = loadSimpleChatProjects();');
    expect(dashboardSource).not.toContain("localStorage.getItem('simpleChatProjects')");
  });

  it('round-trips Agent run IDs and syncs the same project payload through an allowed key', () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
    });
    const projects = [{
      id: 'project-1', name: 'Project', createdAt: 1, updatedAt: 2,
      tasks: [{
        id: 'task-1', projectId: 'project-1', name: 'Task', model: 'model',
        providerId: 'provider', createdAt: 1, updatedAt: 2,
        messages: [{
          id: 'message-1', role: 'assistant' as const, content: 'working',
          agentRunId: 'durable-task-1', createdAt: 2,
        }],
      }],
      agents: [], knowledgeItems: [],
    }];

    saveProjects(projects);
    expect(loadProjects()[0]?.tasks[0]?.messages[0]?.agentRunId).toBe('durable-task-1');
    expect(simpleChatPageSource).toContain("const PROJECTS_SYNC_KEY = 'chat_simple_projects'");
    expect(userDataSyncSource).toContain("'chat_'");
  });
});
