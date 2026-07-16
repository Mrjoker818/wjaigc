import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

describe('simple chat document and theme contract', () => {
  it('keeps document tags and pre-hydration scripts out of the segment layout', async () => {
    const layout = await source('src/app/simple-chat/layout.tsx');

    expect(layout).not.toContain("from 'next/script'");
    expect(layout).not.toMatch(/<html\b/i);
    expect(layout).not.toMatch(/<body\b/i);
  });

  it('defaults the chat login theme to dark instead of the operating system preference', async () => {
    const theme = await source('src/components/simple-chat/theme-script.tsx');

    expect(theme).not.toContain('window.matchMedia');
  });

  it('keeps duplicate-user repair compatible with file-only deployments', async () => {
    const auth = await source('src/lib/server-auth.ts');

    expect(auth).toContain('isDatabaseConfigured()');
  });

  it('keeps the standalone smart-chat Agent entry available before an Agent exists', async () => {
    const chatArea = await source('src/components/simple-chat/chat-area.tsx');

    expect(chatArea).toContain('title="Agent 模式"');
    expect(chatArea).toContain('onClick={() => setShowAgentPanel(true)}');
    expect(chatArea).not.toContain("{(project.agents.length > 0 || activeAgent) && (");
  });
});
