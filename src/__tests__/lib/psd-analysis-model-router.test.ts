import { describe, expect, it, vi } from 'vitest';

import {
  buildPsdVisionCandidates,
  invokePsdVisionCandidates,
  type PsdVisionCandidate,
} from '@/lib/psd-analysis/model-router';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

function provider(
  id: string,
  selectedModels: string[],
  type: ApiProvider['type'] = 'vlm',
): ApiProvider {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example/v1`,
    apiKey: `${id}-secret`,
    isEnabled: true,
    type,
    modelType: type,
    selectedModels,
    createdAt: 1,
    updatedAt: 1,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'User',
    role: 'user',
    chatModels: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function candidate(id: string, model: string): PsdVisionCandidate {
  return {
    key: `${id}::${model}`,
    kind: 'provider',
    providerId: id,
    providerName: id,
    model,
    baseUrl: `https://${id}.example/v1`,
    apiKey: `${id}-secret`,
  };
}

function successResponse(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

describe('PSD vision candidate authorization', () => {
  it('keeps only authorized unique automatic candidates and caps them at three', () => {
    const candidates = buildPsdVisionCandidates({
      user: user({
        chatModels: [
          'pear::gpt-4o',
          'apimart::gemini-2.5-flash',
          'pear::qwen-vl-max',
          'extra::gpt-4.1',
        ],
      }),
      providers: [
        provider('pear', ['gpt-4o', 'qwen-vl-max', 'gpt-4o']),
        provider('apimart', ['gemini-2.5-flash'], 'chat'),
        provider('extra', ['gpt-4.1'], 'chat'),
        provider('nonvision', ['deepseek-chat'], 'chat'),
      ],
    });

    expect(candidates.map(item => item.key)).toEqual([
      'pear::gpt-4o',
      'pear::qwen-vl-max',
      'apimart::gemini-2.5-flash',
    ]);
  });

  it('requires an exact enabled provider-owned model assigned to a regular user', () => {
    expect(() => buildPsdVisionCandidates({
      user: user({ chatModels: ['other::gpt-4o'] }),
      providers: [provider('pear', ['gpt-4o'])],
      providerId: 'pear',
      model: 'gpt-4o',
    })).toThrowError(expect.objectContaining({
      code: 'PSD_ANALYSIS_MODEL_FORBIDDEN',
      status: 403,
    }));

    expect(() => buildPsdVisionCandidates({
      user: user({ chatModels: ['pear::gpt-4o'] }),
      providers: [provider('pear', ['gpt-4o'])],
      providerId: 'pear',
      model: 'gpt-4.1',
    })).toThrowError(expect.objectContaining({
      code: 'PSD_ANALYSIS_MODEL_UNAVAILABLE',
      status: 400,
    }));
  });

  it('allows an explicitly configured platform model only in automatic mode', () => {
    const candidates = buildPsdVisionCandidates({
      user: user(),
      providers: [],
      platformModel: 'platform-vision-model',
    });
    expect(candidates).toEqual([expect.objectContaining({
      key: 'platform::platform-vision-model',
      kind: 'platform',
    })]);
  });
});

describe('PSD vision invocation', () => {
  it('never falls back when an explicit provider/model pair fails', async () => {
    const fetchCandidate = vi.fn()
      .mockResolvedValueOnce(new Response('provider failed', { status: 503 }))
      .mockResolvedValueOnce(successResponse('should not be reached'));

    await expect(invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o'), candidate('apimart', 'gemini-2.5-flash')],
      exactSelection: true,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      fetchCandidate,
    })).rejects.toMatchObject({ code: 'PSD_ANALYSIS_UPSTREAM_FAILED' });
    expect(fetchCandidate).toHaveBeenCalledTimes(1);
  });

  it('uses the next automatic candidate only after a retryable failure', async () => {
    const fetchCandidate = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(successResponse('{"ok":true}'));

    const result = await invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o'), candidate('apimart', 'gemini-2.5-flash')],
      exactSelection: false,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      fetchCandidate,
    });

    expect(result).toMatchObject({
      content: '{"ok":true}',
      providerId: 'apimart',
      model: 'gemini-2.5-flash',
    });
    expect(result.fallbackReason).toContain('pear::gpt-4o');
    expect(fetchCandidate).toHaveBeenCalledTimes(2);
  });

  it('does not hide credential errors behind another provider', async () => {
    const fetchCandidate = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(successResponse('should not be reached'));

    await expect(invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o'), candidate('apimart', 'gemini-2.5-flash')],
      exactSelection: false,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      fetchCandidate,
    })).rejects.toMatchObject({ code: 'PSD_ANALYSIS_PROVIDER_AUTH_FAILED', status: 502 });
    expect(fetchCandidate).toHaveBeenCalledTimes(1);
  });

  it('sends text before image with bounded OpenAI-compatible parameters', async () => {
    const fetchCandidate = vi.fn().mockResolvedValue(successResponse('content'));
    await invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o')],
      exactSelection: true,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      fetchCandidate,
    });

    const [, requestBody] = fetchCandidate.mock.calls[0];
    expect(requestBody).toMatchObject({
      model: 'gpt-4o',
      max_tokens: 4096,
      temperature: 0.3,
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'analyze' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } },
        ],
      }],
    });
  });

  it('rejects a response larger than 256 KiB', async () => {
    const large = 'x'.repeat(256 * 1024 + 1);
    await expect(invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o')],
      exactSelection: true,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      fetchCandidate: vi.fn().mockResolvedValue(new Response(large)),
    })).rejects.toMatchObject({ code: 'PSD_ANALYSIS_OUTPUT_TOO_LARGE' });
  });

  it('aborts the current candidate when one shared deadline expires', async () => {
    const fetchCandidate = vi.fn((
      _candidate: PsdVisionCandidate,
      _requestBody: Record<string, unknown>,
      signal: AbortSignal,
    ) => new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));

    await expect(invokePsdVisionCandidates({
      candidates: [candidate('pear', 'gpt-4o')],
      exactSelection: false,
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'analyze',
      deadlineMs: 5,
      fetchCandidate,
    })).rejects.toMatchObject({ code: 'PSD_ANALYSIS_TIMEOUT', status: 504 });
    expect(fetchCandidate).toHaveBeenCalledTimes(1);
  });
});
