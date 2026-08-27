import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CanvasSourceTraceBadge,
  WorkspaceSourceTraceDetails,
} from '@/components/workspace-source-trace';

const trace = {
  source: 'simple-chat',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'task-1',
  messageId: 'message-1',
  modelId: 'gpt-image-1',
  providerId: 'provider-1',
  createdAt: '2026-08-27T08:30:00.000Z',
  apiKey: 'secret-key',
  token: 'secret-token',
  rawPrompt: 'private prompt',
};

describe('workspace source trace UI', () => {
  it('renders read-only provenance without exposing unvalidated secrets', () => {
    const markup = renderToStaticMarkup(React.createElement(WorkspaceSourceTraceDetails, { sourceTrace: trace }));

    expect(markup).toContain('来源：智能对话');
    expect(markup).toContain('chat project');
    expect(markup).toContain('chat-project-1');
    expect(markup).toContain('gpt-image-1');
    expect(markup).toContain('provider-1');
    expect(markup).not.toContain('secret-key');
    expect(markup).not.toContain('secret-token');
    expect(markup).not.toContain('private prompt');
  });

  it('renders a compact canvas badge only for a selected image with a valid trace', () => {
    const markup = renderToStaticMarkup(React.createElement(CanvasSourceTraceBadge, {
      sourceTrace: trace,
      isSelected: true,
    }));
    const unselectedMarkup = renderToStaticMarkup(React.createElement(CanvasSourceTraceBadge, {
      sourceTrace: trace,
      isSelected: false,
    }));
    const invalidMarkup = renderToStaticMarkup(React.createElement(CanvasSourceTraceBadge, {
      sourceTrace: { ...trace, source: 'forged' },
      isSelected: true,
    }));

    expect(markup).toContain('智能对话');
    expect(markup).toContain('title=');
    expect(markup).not.toContain('secret-key');
    expect(unselectedMarkup).toBe('');
    expect(invalidMarkup).toBe('');
  });

  it('keeps source trace details wired into their owning production parents', () => {
    const nodeEditorSource = readFileSync('src/components/node-editor.tsx', 'utf8');
    const infiniteCanvasSource = readFileSync('src/components/infinite-canvas.tsx', 'utf8');

    expect(nodeEditorSource).toContain("import { WorkspaceSourceTraceDetails } from '@/components/workspace-source-trace'");
    expect(nodeEditorSource).toContain('<WorkspaceSourceTraceDetails sourceTrace={node.config.sourceTrace} />');
    expect(infiniteCanvasSource).toContain("import { CanvasSourceTraceBadge } from '@/components/workspace-source-trace'");
    expect(infiniteCanvasSource).toContain('<CanvasSourceTraceBadge sourceTrace={image.sourceTrace} isSelected={isSelected} />');
  });
});
