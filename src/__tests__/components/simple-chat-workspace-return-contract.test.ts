import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

    expect(canvasWorkspace).toContain("params.get('view') === 'dashboard'");
    expect(canvasWorkspace).toContain('useState<WorkspaceMode>(getInitialWorkspaceMode)');
  });

  it('opens the explicitly selected canvas project without routing through login or bare Canvas', () => {
    expect(chatArea).toMatch(/window\.open\(\s*`\/\?projectId=\$\{encodeURIComponent\(targetProjectId\)\}`\s*,\s*['_"]blank['"]\s*\)/);
    expect(chatArea).not.toContain("window.open('/', '_blank')");
    expect(simpleChatPage).not.toMatch(/router\.(?:push|replace)\(\s*['"]\/(?:login|canvas)['"]/);
    expect(simpleChatPage).not.toContain("onBackToWorkspace={() => window.location.href = '/'}");
  });
});
