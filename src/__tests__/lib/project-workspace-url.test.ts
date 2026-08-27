import { describe, expect, it } from 'vitest';
import {
  buildProjectWorkspaceUrl,
  clearSimpleChatWorkspaceHandoffParams,
  getInitialWorkspaceModeFromSearch,
} from '@/lib/project-workspace-url';

describe('buildProjectWorkspaceUrl', () => {
  it('keeps the active project in the URL while preserving unrelated query state', () => {
    expect(buildProjectWorkspaceUrl(
      { pathname: '/', search: '?e2e=6eb061a&view=dashboard', hash: '#canvas' },
      'project_1785672740345_w0o09zyjz',
    )).toBe('/?e2e=6eb061a&projectId=project_1785672740345_w0o09zyjz#canvas');
  });
});

describe('workspace handoff URL state', () => {
  it('enters node mode directly for a project handoff URL', () => {
    expect(getInitialWorkspaceModeFromSearch('?projectId=canvas-1&mode=node')).toBe('node');
  });

  it('cleans only handoff parameters after a successful save', () => {
    expect(clearSimpleChatWorkspaceHandoffParams(
      '/?projectId=canvas-1&mode=node&chatProjectId=chat-1&chatTaskId=task-1&chatMessageId=message-1&e2e=keep#node',
    )).toBe('/?projectId=canvas-1&mode=node&e2e=keep#node');
  });
});
