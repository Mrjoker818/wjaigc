import { describe, expect, it } from 'vitest';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import {
  buildSimpleChatWorkspaceHandoffUrl,
  parseSimpleChatWorkspaceHandoffBody,
  parseSimpleChatWorkspaceHandoffIntent,
} from '@/lib/simple-chat-workspace-handoff';

const intent = {
  targetProjectId: 'canvas-project-1',
  chatProjectId: 'chat-project-1',
  chatTaskId: 'task-1',
  chatMessageId: 'message-1',
};

describe('simple chat workspace handoff contracts', () => {
  it('round-trips bounded identifiers without embedding text or media URLs', () => {
    const url = buildSimpleChatWorkspaceHandoffUrl(intent);
    expect(url).toContain('mode=drama');
    expect(url).not.toContain('prompt=');
    expect(url).not.toContain('imageUrl=');
    expect(parseSimpleChatWorkspaceHandoffIntent(url.split('?')[1])).toEqual(intent);
    expect(parseSimpleChatWorkspaceHandoffIntent(`projectId=x&mode=drama&chatProjectId=${'x'.repeat(201)}`)).toBeNull();
    expect(parseSimpleChatWorkspaceHandoffBody(intent)).toEqual(intent);
    // Links created before the drama workbench still use mode=node.
    expect(parseSimpleChatWorkspaceHandoffIntent(url.split('?')[1].replace('mode=drama', 'mode=node'))).toEqual(intent);
    expect(parseSimpleChatWorkspaceHandoffIntent(url.split('?')[1].replace('mode=drama', 'mode=canvas'))).toBeNull();
    expect(parseSimpleChatWorkspaceHandoffBody({ ...intent, targetProjectId: undefined, projectId: 'canvas-project-1' })).toBeNull();
  });

  it('normalizes and bounds source trace metadata', () => {
    const sourceTrace = parseWorkspaceSourceTrace({
      source: 'simple-chat',
      chatProjectId: 'chat-project-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      modelId: 'openai/gpt-image-1',
      providerId: 'provider\nforged',
      generationTaskIds: Array.from({ length: 20 }, (_, index) => `generation-${index}`),
      createdAt: '2026-08-27T08:00:00+08:00',
      secret: 'must-not-leak',
    });
    expect(sourceTrace).toEqual({
      source: 'simple-chat',
      chatProjectId: 'chat-project-1',
      chatTaskId: 'task-1',
      messageId: 'message-1',
      modelId: 'openai/gpt-image-1',
      generationTaskIds: Array.from({ length: 16 }, (_, index) => `generation-${index}`),
      createdAt: '2026-08-27T00:00:00.000Z',
    });
  });
});
