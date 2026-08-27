import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getInitialWorkspaceModeFromSearch } from '@/lib/project-workspace-url';

const simpleChatPage = readFileSync(
  resolve(process.cwd(), 'src/app/simple-chat/page.tsx'),
  'utf8',
);
const homePage = readFileSync(
  resolve(process.cwd(), 'src/app/page.tsx'),
  'utf8',
);
const canvasWorkspace = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);
const chatArea = readFileSync(
  resolve(process.cwd(), 'src/components/simple-chat/chat-area.tsx'),
  'utf8',
);

describe('simple-chat workspace return contract', () => {
  it('returns directly to an authenticated dashboard state', () => {
    expect(simpleChatPage).toContain("router.replace('/?view=dashboard')");
    expect(simpleChatPage).not.toContain("onBackToWorkspace={() => window.location.href = '/'}");

    expect(homePage).toContain("searchParams.get('view') === 'dashboard'");
    expect(homePage).toContain('useState(!returningToDashboard)');

    expect(canvasWorkspace).toContain('getInitialWorkspaceModeFromSearch,');
    expect(canvasWorkspace).toContain(
      'return getInitialWorkspaceModeFromSearch(window.location.search);',
    );
    expect(canvasWorkspace).toContain('useState<WorkspaceMode>(getInitialWorkspaceMode)');
    expect(canvasWorkspace).toContain('const workspaceLocationSearch = useWorkspaceLocationSearch();');
    expect(canvasWorkspace).toContain(
      'const intent = parseSimpleChatWorkspaceHandoffIntent(workspaceLocationSearch);',
    );
    expect(canvasWorkspace).toContain(
      '[currentProject?.id, handoffRetryRevision, persistNodeWorkflow, workspaceLocationSearch]',
    );
    expect(canvasWorkspace).toContain('cleanUrl: () => replaceWorkspaceHistoryState(');
  });

  it('derives the initial workspace mode through the shared search parser', () => {
    expect(getInitialWorkspaceModeFromSearch('?view=dashboard')).toBe('dashboard');
    expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1&mode=node')).toBe('node');
    expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1')).toBe('canvas');
    expect(getInitialWorkspaceModeFromSearch('')).toBe('dashboard');
  });

  it('opens the explicitly selected canvas project without routing through login or bare Canvas', () => {
    expect(chatArea).toMatch(/window\.location\.assign\(\s*`\/\?projectId=\$\{encodeURIComponent\(targetProjectId\)\}`\s*\)/);
    expect(chatArea).not.toContain('window.open(');
    expect(simpleChatPage).not.toMatch(/router\.(?:push|replace)\(\s*['"]\/(?:login|canvas)['"]/);
    expect(simpleChatPage).not.toContain("onBackToWorkspace={() => window.location.href = '/'}");
  });
});
