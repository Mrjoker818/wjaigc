import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { executeToolCall, validateChatToolCall } from '@/lib/chat-tools';

describe('chat tool governance', () => {
  it('rejects missing required tool parameters before execution', () => {
    expect(validateChatToolCall('generate_image', {})).toContain('Missing required parameter: prompt');
    expect(validateChatToolCall('upscale', { image_url: 'https://example.com/image.png', scale: '8' })).toContain('Invalid value for scale');
  });

  it('accepts valid tool parameters', () => {
    expect(validateChatToolCall('generate_image', { prompt: 'a studio product photo', aspect_ratio: '1:1' })).toBeNull();
  });

  it('rejects a tool excluded from the current agent capability list before it can execute', async () => {
    const result = await executeToolCall('generate_image', { prompt: 'a studio product photo' }, {
      chatApiKey: 'test-key',
      chatBaseUrl: 'https://example.com',
      origin: 'https://app.example.com',
      userId: 'user-1',
      allowedTools: ['upscale'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool is not allowed for this agent: generate_image');
  });
});
