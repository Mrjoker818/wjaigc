import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hubSource = readFileSync(resolve(process.cwd(), 'src/components/workflow-hub.tsx'), 'utf8');
const editorSource = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');
const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('workflow persistence wiring', () => {
  it('loads the current users saved workflows instead of using mock workflows as the dashboard state', () => {
    expect(hubSource).not.toContain('useState(MOCK_WORKFLOWS)');
    expect(hubSource).toContain("fetch('/api/workflow/save'");
    expect(hubSource).toContain('userId?: string');
  });

  it('passes the authenticated user ID to the workflow hub and node editor', () => {
    expect(workspaceSource).toMatch(/<NodeEditor[\s\S]*userId=\{currentUser\?\.id\}/);
    expect(workspaceSource).toMatch(/<WorkflowHub[\s\S]*userId=\{currentUser\?\.id\}/);
    expect(editorSource).toContain('userId?: string');
    expect(editorSource).not.toContain("localStorage.getItem('wujie_user_id') || 'anonymous'");
  });
});
