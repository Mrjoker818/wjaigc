import { describe, expect, it } from 'vitest';
import { buildProjectWorkspaceUrl } from '@/lib/project-workspace-url';

describe('buildProjectWorkspaceUrl', () => {
  it('keeps the active project in the URL while preserving unrelated query state', () => {
    expect(buildProjectWorkspaceUrl(
      { pathname: '/', search: '?e2e=6eb061a&view=dashboard', hash: '#canvas' },
      'project_1785672740345_w0o09zyjz',
    )).toBe('/?e2e=6eb061a&projectId=project_1785672740345_w0o09zyjz#canvas');
  });
});
