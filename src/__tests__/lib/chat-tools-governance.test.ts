import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-internal-request': 'true',
    'x-internal-user-id': 'user-1',
    'x-wujie-internal-secret': 'test-secret',
  }),
}));
const kickoffDurableGenerationTasks = vi.fn();
vi.mock('@/lib/task-core/durable-generation-kickoff', () => ({
  kickoffDurableGenerationTasks,
}));

import {
  executeAdmittedToolCall,
  executeToolCall,
  validateChatToolCall,
} from '@/lib/chat-tools';

describe('chat tool governance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    kickoffDurableGenerationTasks.mockReset().mockResolvedValue({
      attempted: ['task-1'], accepted: ['task-1'], failed: [],
    });
  });

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

  it('admits generation without kickoff and continues it once with the same stable key', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true, taskId: 'task-1', taskIds: ['task-1'], model: 'model-image',
      providerId: 'provider-image',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('generate_image', { prompt: 'a studio product photo' }, {
      chatApiKey: 'test-key', chatBaseUrl: 'https://example.com', origin: 'https://app.example.com',
      userId: 'user-1', imageModel: 'model-image', imageProviderId: 'provider-image',
      idempotencyKey: 'stable-key', deferAgentExecution: true,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        'idempotency-key': 'stable-key',
        'x-wujie-agent-defer-execution': 'true',
      }),
    });
    expect(kickoffDurableGenerationTasks).not.toHaveBeenCalled();

    await executeAdmittedToolCall(result);
    expect(kickoffDurableGenerationTasks).toHaveBeenCalledTimes(1);
    expect(kickoffDurableGenerationTasks).toHaveBeenCalledWith({
      taskIds: ['task-1'], userId: 'user-1', userRole: 'user',
    });
  });

  it('admits editing without provider execution and resumes with the canonical stable key', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, mode: 'polling', taskId: 'edit-1', model: 'model-edit',
        providerId: 'provider-edit',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, mode: 'polling', taskId: 'edit-1', replayed: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('edit_image', {
      image_url: 'https://example.com/source.png', prompt: 'make it brighter',
    }, {
      chatApiKey: 'test-key', chatBaseUrl: 'https://example.com', origin: 'https://app.example.com',
      userId: 'user-1', imageModel: 'model-edit', imageProviderId: 'provider-edit',
      idempotencyKey: 'stable-edit-key', deferAgentExecution: true,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        'idempotency-key': 'stable-edit-key',
        'x-wujie-agent-defer-execution': 'true',
      }),
    });
    await executeAdmittedToolCall(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        'idempotency-key': 'stable-edit-key',
        'x-wujie-agent-resume-execution': 'true',
      }),
    });
    expect((fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>)['x-idempotency-key'])
      .toBeUndefined();
  });

  it('uses the exact selected chat provider and model for agent-v2 image analysis', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'exact analysis' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await executeToolCall('analyze_image', {
      image_url: 'https://example.com/source.png',
    }, {
      chatApiKey: 'exact-key',
      chatBaseUrl: 'https://exact.example.com/v1',
      chatModel: 'exact-vision-model',
      chatProviderId: 'exact-provider',
      origin: 'https://app.example.com',
      userId: 'user-1',
      deferAgentExecution: true,
    });

    expect(result).toMatchObject({ success: true, resultText: '图片分析结果：exact analysis' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://exact.example.com/v1/chat/completions');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer exact-key' }),
      body: expect.stringContaining('"model":"exact-vision-model"'),
    });
  });

  it('rejects agent-v2 image analysis when the exact paid pair is unavailable', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');

    const result = await executeToolCall('analyze_image', {
      image_url: 'https://example.com/source.png',
    }, {
      chatApiKey: 'exact-key',
      chatBaseUrl: 'https://exact.example.com/v1',
      origin: 'https://app.example.com',
      userId: 'user-1',
      deferAgentExecution: true,
    });

    expect(result).toMatchObject({ success: false, error: 'MODEL_ROUTE_MISMATCH' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
