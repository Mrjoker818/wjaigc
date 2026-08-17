import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Agent runtime surface boundaries', () => {
  it('keeps independent navigation and never shows a user API-key setup path', () => {
    const canvas = source('src/components/chat-panel.tsx');
    const standalone = source('src/components/simple-chat/chat-area.tsx');
    const editor = source('src/components/agent-editor.tsx');

    expect(canvas).not.toContain("window.location.href = '/simple-chat'");
    expect(standalone).toMatch(/window\.open\(\s*`\/\?projectId=\$\{encodeURIComponent\(targetProjectId\)\}`/);
    expect(editor).not.toMatch(/API\s*Key.*(?:配置|设置)|配置.*API\s*Key/);
  });

  it('mounts shared progress only from real run IDs and preserves them in chat history', () => {
    const canvas = source('src/components/chat-panel.tsx');
    const standalone = source('src/components/simple-chat/chat-area.tsx');
    const standaloneTypes = source('src/components/simple-chat/simple-chat-types.ts');
    const editor = source('src/components/agent-editor.tsx');

    for (const component of [canvas, standalone, editor]) {
      expect(component).toContain('useAgentRunEvents');
      expect(component).toContain('AgentProgressTimeline');
    }
    expect(canvas).toContain('agentRunId?: string');
    expect(standaloneTypes).toContain('agentRunId?: string');
    expect(editor).toContain('data.runId');
  });

  it('propagates Asset Graph identity and targets late run updates to the captured message', () => {
    const canvas = source('src/components/chat-panel.tsx');
    const standalone = source('src/components/simple-chat/chat-area.tsx');
    const editor = source('src/components/agent-editor.tsx');

    expect(canvas).toContain('sourceVersionIds: chatSourceVersionIds');
    expect(canvas).toContain('selectedEntityIds: chatSelectedEntityIds');
    expect(standalone).toContain('sourceVersionIds: requestSourceVersionIds');
    expect(standalone).toContain('selectedEntityIds: requestSelectedEntityIds');
    expect(standalone).toContain('message.id === assistantMessageId');
    expect(editor).toContain('selectedEntityId');
  });

  it('persists the exact image Agent run identity for refresh recovery', () => {
    const editor = source('src/components/agent-editor.tsx');
    expect(editor).toContain('wujie_agent_run:${projectId}:${selectedEntityId}');
    expect(editor).toContain('localStorage.getItem(runStorageKey)');
    expect(editor).toContain('localStorage.setItem(runStorageKey, agentRunId)');
  });
});
