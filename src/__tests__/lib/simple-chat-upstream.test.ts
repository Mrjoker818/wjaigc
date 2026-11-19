import { describe, expect, it } from 'vitest';
import { describeUpstreamChatError, resolveToolAspectRatio } from '@/lib/simple-chat-upstream';
import { getChatControlSupport, isPearChatProvider, resolveChatControls } from '@/lib/chat-generation-controls';
import type { ApiProvider } from '@/lib/universal-api-types';

const pear = { id: 'p', name: 'Pear LLM', baseUrl: 'https://api.pearapi.ai', advancedParams: {} } as unknown as ApiProvider;
const other = { id: 'o', name: 'Other', baseUrl: 'https://api.example.com', advancedParams: {} } as unknown as ApiProvider;

describe('simple chat upstream helpers', () => {
  it('maps tool aspect ratios and legacy pixel sizes', () => {
    expect(resolveToolAspectRatio({ aspect_ratio: '16:9' })).toBe('16:9');
    expect(resolveToolAspectRatio({ size: '1024x1792' })).toBe('9:16');
    expect(resolveToolAspectRatio({ aspect_ratio: '7:3' })).toBe('1:1');
    expect(resolveToolAspectRatio({})).toBe('1:1');
  });

  it('explains relay errors instead of echoing raw JSON', () => {
    expect(describeUpstreamChatError(400, '{"error":"不支持的模型"}', 'x-model')).toContain('不支持模型「x-model」');
    expect(describeUpstreamChatError(503, '{"error":{"message":"对话生成失败，请稍后重试"}}', 'qwen3.7-plus')).toContain('暂时无法处理');
    expect(describeUpstreamChatError(401, '{"error":{"message":"invalid API key"}}', 'm')).toContain('API Key');
    expect(describeUpstreamChatError(429, 'rate limited', 'm')).toContain('429');
  });
});

describe('PearAPI reasoning controls', () => {
  it('recognizes the Pear relay by base URL', () => {
    expect(isPearChatProvider(pear)).toBe(true);
    expect(isPearChatProvider(other)).toBe(false);
  });

  it('sends only the standard reasoning_effort for GPT and Gemini on PearAPI', () => {
    const gpt = resolveChatControls('gpt-6.1-sol', pear, 'maximum', undefined);
    expect(gpt.requestParams).toEqual({ reasoning_effort: 'high' });
    const gemini = resolveChatControls('gemini-4-argon', pear, 'low', undefined);
    expect(gemini.requestParams).toEqual({ reasoning_effort: 'low' });
    expect(gemini.requestParams).not.toHaveProperty('thinking_budget');
  });

  it('sends no reasoning fields for PearAPI models without documented support', () => {
    const qwen = resolveChatControls('qwen3.7-plus', pear, 'high', undefined);
    expect(qwen.requestParams).toEqual({});
    expect(getChatControlSupport('qwen3.7-plus', pear).supportsReasoning).toBe(false);
  });

  it('keeps existing behaviour for other providers', () => {
    expect(resolveChatControls('gemini-2.5-pro', other, 'medium', undefined).requestParams).toEqual({ thinking_budget: 4096 });
    expect(getChatControlSupport('gpt-6.1-sol', other).reasoningMode).toBe('reasoning_effort');
  });
});
