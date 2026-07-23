import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);
const simpleChatStorageSource = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/simple-chat-types.ts'),
  'utf8',
);

describe('simple chat dashboard synchronization contract', () => {
  it('uses the same project storage reader as the simple-chat page', () => {
    expect(simpleChatStorageSource).toContain("const PROJECTS_KEY = 'wujie_chat_projects'");
    expect(dashboardSource).toContain(
      "import { loadProjects as loadSimpleChatProjects } from '@/components/simple-chat/simple-chat-types';",
    );
    expect(dashboardSource).toContain('const projects = loadSimpleChatProjects();');
    expect(dashboardSource).not.toContain("localStorage.getItem('simpleChatProjects')");
  });
});
