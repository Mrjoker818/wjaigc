import { describe, expect, it } from 'vitest';

import {
  SurfaceAgentRequestError,
  buildAgentEditRequest,
  buildCanvasAgentRequest,
  buildSimpleChatAgentRequest,
} from '@/lib/agent-runtime/surface-requests';

describe('agent runtime surface requests', () => {
  it('preserves the canvas provider, model, and source-version identity', () => {
    expect(buildCanvasAgentRequest({
      projectId: 'project-1',
      workspaceId: 'canvas:project-1',
      providerId: 'provider-chat',
      modelId: 'model-chat',
      prompt: '生成一张海报',
      sourceVersionIds: ['version-1'],
      selectedEntityIds: ['canvas-image-1'],
      visibleVersionIds: ['version-1'],
      mode: 'agent',
      conversationId: 'conversation-1',
    })).toMatchObject({
      workspace: 'canvas',
      mode: 'agent',
      providerId: 'provider-chat',
      modelId: 'model-chat',
      sourceVersionIds: ['version-1'],
    });
  });

  it('limits standalone-chat Agent tools to its authorized registry surface', () => {
    expect(buildSimpleChatAgentRequest({
      projectId: 'project-1',
      workspaceId: 'standalone-chat:conversation-1',
      providerId: 'provider-chat',
      modelId: 'model-chat',
      prompt: '分析并生成图片',
      mode: 'agent',
      conversationId: 'conversation-1',
      sourceVersionIds: ['version-1'],
    }).allowedToolIds).toEqual([
      'analyze_image',
      'generate_image',
    ]);
  });

  it('keeps the selected image entity in the Agent-edit context', () => {
    const request = buildAgentEditRequest({
      projectId: 'project-1',
      workspaceId: 'canvas:project-1',
      providerId: 'provider-chat',
      modelId: 'model-chat',
      prompt: '把天空改成日落',
      selectedEntityId: 'canvas-image-1',
      sourceVersionId: 'version-1',
    });
    expect(request.context.selectedEntityIds).toEqual(['canvas-image-1']);
    expect(request.allowedToolIds).toEqual(['agent_edit']);
  });

  it('does not enable tools for conversation mode', () => {
    expect(buildCanvasAgentRequest({
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: '你好',
      sourceVersionIds: [], mode: 'conversation',
    }).allowedToolIds).toEqual([]);
  });

  it('rejects vision requests without an image version', () => {
    expect(() => buildSimpleChatAgentRequest({
      projectId: 'project-1', workspaceId: 'standalone-chat:conversation-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: '分析图片',
      sourceVersionIds: [], mode: 'vision', conversationId: 'conversation-1',
    })).toThrow(SurfaceAgentRequestError);
  });

  it('rejects client credential fields instead of offering third-party configuration', () => {
    expect(() => buildAgentEditRequest({
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: '编辑图片',
      selectedEntityId: 'canvas-image-1', sourceVersionId: 'version-1',
      apiKey: 'not-accepted',
    })).toThrow(SurfaceAgentRequestError);
  });

  it.each([
    ['prompt', { prompt: 'x'.repeat(16_385) }],
    ['identifier', { projectId: 'x'.repeat(257) }],
    ['idempotency key', { idempotencyKey: 'x'.repeat(257) }],
    ['source versions', { sourceVersionIds: Array.from({ length: 65 }, (_, i) => `v-${i}`) }],
    ['selected entities', { selectedEntityIds: Array.from({ length: 65 }, (_, i) => `e-${i}`) }],
  ])('rejects an over-limit %s before authorization', (_label, override) => {
    expect(() => buildCanvasAgentRequest({
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: 'hello',
      sourceVersionIds: [], mode: 'agent', ...override,
    })).toThrow(SurfaceAgentRequestError);
  });

  it('accepts exact request boundaries and rejects an oversized serialized input', () => {
    expect(buildCanvasAgentRequest({
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: 'x'.repeat(16_384),
      idempotencyKey: 'i'.repeat(256),
      sourceVersionIds: Array.from({ length: 64 }, (_, i) => `v-${i}`),
      selectedEntityIds: Array.from({ length: 64 }, (_, i) => `e-${i}`),
      mode: 'agent',
    })).toMatchObject({ prompt: 'x'.repeat(16_384) });

    expect(() => buildCanvasAgentRequest({
      projectId: 'project-1', workspaceId: 'canvas:project-1',
      providerId: 'provider-chat', modelId: 'model-chat', prompt: 'hello',
      sourceVersionIds: [], mode: 'agent',
      ignoredPayload: 'x'.repeat(256 * 1024),
    } as Parameters<typeof buildCanvasAgentRequest>[0])).toThrow(SurfaceAgentRequestError);
  });
});
