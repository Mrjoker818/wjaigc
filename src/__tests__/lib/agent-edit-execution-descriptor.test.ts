import { describe, expect, it } from 'vitest';

import {
  AgentEditExecutionDescriptorError,
  createAgentEditExecutionDescriptorV1,
  digestAgentEditExecutionDescriptor,
  parseAgentEditExecutionContinuation,
} from '@/lib/agent-runtime/agent-edit-execution-descriptor';

const descriptorInput = {
  sourceVersionId: 'version-source-1',
  maskVersionId: 'version-mask-1',
  prompt: 'Replace the sky',
  imagePrompt: 'A clear sunset',
  providerId: 'provider-chat',
  modelId: 'model-chat',
  imageProviderId: 'provider-image',
  imageModelId: 'model-image',
  maxRounds: 4,
  quality: 'high',
  aspectRatio: '4:3',
};

describe('Agent edit execution descriptor', () => {
  it('creates a bounded v1 descriptor containing only immutable reconstruction fields', () => {
    const descriptor = createAgentEditExecutionDescriptorV1(descriptorInput);
    const serialized = JSON.stringify(descriptor);

    expect(descriptor).toEqual({ version: 1, ...descriptorInput });
    expect(serialized).not.toMatch(/data:image|https?:\/\/|apiKey|token|baseUrl|headers|leaseOwner|generation|userRole/i);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(64 * 1024);
  });

  it.each([
    ['image URL', { sourceVersionId: 'https://assets.example/source.png' }],
    ['data URL', { prompt: 'data:image/png;base64,AAAA' }],
    ['ordinary remote URL', { prompt: 'Use https://assets.example/source.png' }],
    ['signed URL', { imagePrompt: 'https://cdn.example/a.png?X-Amz-Signature=secret' }],
    ['authorization value', { prompt: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' }],
    ['api key value', { imagePrompt: 'x-api-key: abcdefghijklmnop' }],
    ['token value', { prompt: 'access_token=abcdefghijklmnopqrstuvwxyz' }],
    ['secret key', { apiKey: 'sk-secret' }],
    ['unknown field', { unexpected: 'value' }],
  ])('rejects a descriptor containing %s', (_label, patch) => {
    expect(() => createAgentEditExecutionDescriptorV1({
      ...descriptorInput,
      ...patch,
    })).toThrow(AgentEditExecutionDescriptorError);
  });

  it('accepts ordinary Chinese prompts that discuss credentials without containing any credential', () => {
    expect(createAgentEditExecutionDescriptorV1({
      ...descriptorInput,
      prompt: '设计一个API密钥管理页面，并增加访问令牌的中文使用说明，不展示真实凭据。',
    }).prompt).toContain('API密钥管理页面');
  });

  it('fails closed for an unknown continuation version or mismatched canonical digest', () => {
    const descriptor = createAgentEditExecutionDescriptorV1(descriptorInput);
    const digest = digestAgentEditExecutionDescriptor(descriptor);

    expect(parseAgentEditExecutionContinuation({
      kind: 'agent-edit', version: 1, rootToolId: 'agent_edit', descriptorDigest: digest,
    }, descriptor)).toEqual(descriptor);
    expect(() => parseAgentEditExecutionContinuation({
      kind: 'agent-edit', version: 2, rootToolId: 'agent_edit', descriptorDigest: digest,
    }, descriptor)).toThrow(AgentEditExecutionDescriptorError);
    expect(() => parseAgentEditExecutionContinuation({
      kind: 'agent-edit', version: 1, rootToolId: 'agent_edit', descriptorDigest: '0'.repeat(64),
    }, descriptor)).toThrow(AgentEditExecutionDescriptorError);
    expect(() => parseAgentEditExecutionContinuation({
      kind: 'agent-edit', version: 1, rootToolId: 'image_edit', descriptorDigest: digest,
    }, descriptor)).toThrow(AgentEditExecutionDescriptorError);
  });
});
