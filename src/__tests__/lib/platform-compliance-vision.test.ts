import { describe, expect, it, vi } from 'vitest';

import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';
import {
  type ComplianceVisionFetcher,
  ComplianceVisionError,
  invokeComplianceVision,
} from '@/lib/platform-compliance/vision-client';
import type { ApiProvider } from '@/lib/universal-api-types';

const provider: ApiProvider = {
  id: 'pear-vision', name: 'Pear Vision', baseUrl: 'https://pear.example/v1',
  apiKey: 'test-key', isEnabled: true, type: 'vlm', createdAt: 1, updatedAt: 1,
};
const rules = resolveComplianceRuleSet({
  platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
}).rules.filter(rule => rule.evaluator === 'vision');

function providerChecks() {
  return rules.map(rule => ({
    ruleId: rule.id,
    status: 'passed',
    evidence: [`observed=${rule.id}`],
    measuredValue: 'compliant',
    confidence: 0.9,
    remediation: null,
  }));
}

function response(content: string, status = 200, requestId = 'provider-request-1'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

describe('platform compliance frozen vision client', () => {
  it('calls only the frozen provider and model without fallback', async () => {
    const fetcher = vi.fn<ComplianceVisionFetcher>(
      async () => response(JSON.stringify({ checks: providerChecks() })),
    );

    const result = await invokeComplianceVision({
      provider,
      modelId: 'gemini-vision-stable',
      imageInput: '/api/serve-upload/authorized.png',
      rules,
      productFacts: '材质为食品级不锈钢',
      claims: '宣称通过 FDA 认证',
      reportLanguage: '中文',
      requestId: 'local-request-1',
      signal: new AbortController().signal,
    }, { fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(provider.baseUrl, '/chat/completions', expect.any(Object));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[2]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gemini-vision-stable', stream: false,
      response_format: { type: 'json_object' },
    });
    expect(JSON.stringify(body)).toContain('/api/serve-upload/authorized.png');
    expect(JSON.stringify(body)).toContain('材质为食品级不锈钢');
    expect(JSON.stringify(body)).toContain('宣称通过 FDA 认证');
    expect(JSON.stringify(body)).toContain('中文');
    expect(result).toMatchObject({
      providerId: provider.id,
      modelId: 'gemini-vision-stable',
      requestId: 'provider-request-1',
    });
    expect(result.checks).toHaveLength(rules.length);
  });

  it.each([
    ['markdown fenced JSON', `\`\`\`json\n${JSON.stringify({ checks: providerChecks() })}\n\`\`\``],
    ['extra response key', JSON.stringify({ checks: providerChecks(), extra: true })],
    ['missing rule result', JSON.stringify({ checks: providerChecks().slice(1) })],
    ['empty content', ''],
  ])('rejects %s instead of accepting loose model output', async (_name, content) => {
    const fetcher = vi.fn(async () => response(content));

    await expect(invokeComplianceVision({
      provider,
      modelId: 'gemini-vision-stable',
      imageInput: '/api/serve-upload/authorized.png',
      rules,
      requestId: 'local-request-1',
      signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_RESPONSE_INVALID',
      providerId: provider.id,
      modelId: 'gemini-vision-stable',
      requestId: 'provider-request-1',
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, false],
    [429, true],
    [500, true],
  ])('preserves frozen error identity for HTTP %i', async (status, retryable) => {
    const fetcher = vi.fn(async () => response('{}', status, `request-${status}`));

    let error: unknown;
    try {
      await invokeComplianceVision({
        provider,
        modelId: 'gemini-vision-stable',
        imageInput: '/api/serve-upload/authorized.png',
        rules,
        requestId: 'local-request-1',
        signal: new AbortController().signal,
      }, { fetcher });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ComplianceVisionError);
    expect(error).toMatchObject({
      providerId: provider.id,
      modelId: 'gemini-vision-stable',
      requestId: `request-${status}`,
      providerStatus: status,
      retryable,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks a response-loss timeout with the local request identity and no replay', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('timed out', 'AbortError');
    });

    await expect(invokeComplianceVision({
      provider,
      modelId: 'gemini-vision-stable',
      imageInput: '/api/serve-upload/authorized.png',
      rules,
      requestId: 'local-request-1',
      signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_SUBMISSION_UNKNOWN',
      providerId: provider.id,
      modelId: 'gemini-vision-stable',
      requestId: 'local-request-1',
      retryable: false,
      submissionUnknown: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks a response body transport failure as submission unknown', async () => {
    let sentHeaders = false;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (!sentHeaders) {
          sentHeaders = true;
          stream.enqueue(new TextEncoder().encode('{"choices":'));
          return;
        }
        stream.error(new TypeError('socket reset during body'));
      },
    });
    const fetcher = vi.fn(async () => new Response(body, {
      headers: { 'x-request-id': 'body-loss-request-1' },
    }));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_SUBMISSION_UNKNOWN',
      requestId: 'body-loss-request-1',
      retryable: false,
      submissionUnknown: true,
    });
  });

  it('classifies an already-aborted caller signal without attempting submission', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled by user', 'AbortError'));
    const fetcher = vi.fn(async () => response(JSON.stringify({ checks: providerChecks() })));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: controller.signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_CANCELLED', requestId: 'local-request-1', retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['declared length', new Response(response(JSON.stringify({ checks: providerChecks() })).body, {
      headers: { 'content-length': String(300 * 1024) },
    }), 'local-request-1'],
    ['streamed bytes', response(
      `${JSON.stringify({ checks: providerChecks() })}${' '.repeat(300 * 1024)}`,
    ), 'provider-request-1'],
  ])('rejects provider responses over the byte limit from %s', async (
    _name, oversized, expectedRequestId,
  ) => {
    const fetcher = vi.fn(async () => oversized);

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_RESPONSE_INVALID', requestId: expectedRequestId, retryable: true,
    });
  });

  it('does not retain malformed provider content in the parse error chain', async () => {
    const secret = 'provider-secret-payload';
    const fetcher = vi.fn(async () => response(secret));

    let error: unknown;
    try {
      await invokeComplianceVision({
        provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
        requestId: 'local-request-1', signal: new AbortController().signal,
      }, { fetcher });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'COMPLIANCE_VISION_RESPONSE_INVALID' });
    expect((error as Error & { cause?: Error }).cause?.message ?? '').not.toContain('provider-s');
  });

  it.each([
    ['depth', {
      nested: JSON.parse(`${'{\"child\":'.repeat(12)}true${'}'.repeat(12)}`) as unknown,
    }],
    ['items', { nested: Array.from({ length: 300 }, (_, index) => index) }],
  ])('rejects provider envelopes over the %s limit', async (_name, extra) => {
    const envelope = {
      choices: [{ message: { content: JSON.stringify({ checks: providerChecks() }) } }],
      ...extra,
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope)));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_RESPONSE_INVALID', requestId: 'local-request-1', retryable: true,
    });
  });

  it('rejects excessive items inside the model content JSON', async () => {
    const checks = providerChecks();
    checks[0].evidence = Array.from({ length: 300 }, (_, index) => `evidence-${index}`);
    const fetcher = vi.fn(async () => response(JSON.stringify({ checks })));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: new AbortController().signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_RESPONSE_INVALID', requestId: 'provider-request-1', retryable: true,
    });
  });

  it.each(['evidence', 'measuredValue', 'remediation'] as const)(
    'rejects an oversized model %s string at the vision boundary',
    async field => {
      const checks: Record<string, unknown>[] = providerChecks();
      checks[0] = {
        ...checks[0],
        ...(field === 'remediation' ? { status: 'blocked' } : {}),
        [field]: field === 'evidence' ? ['x'.repeat(16_385)] : 'x'.repeat(16_385),
      };
      const fetcher = vi.fn(async () => response(JSON.stringify({ checks })));

      await expect(invokeComplianceVision({
        provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
        requestId: 'local-request-1', signal: new AbortController().signal,
      }, { fetcher })).rejects.toMatchObject({
        code: 'COMPLIANCE_VISION_RESPONSE_INVALID',
        requestId: 'provider-request-1',
        retryable: true,
        submissionUnknown: false,
      });
    },
  );

  it('rejects an unsafe provider request id without retaining provider-controlled text', async () => {
    const unsafeRequestId = `secret/${'x'.repeat(300)}`;
    const fetcher = vi.fn(async () => response(
      JSON.stringify({ checks: providerChecks() }), 200, unsafeRequestId,
    ));

    let error: unknown;
    try {
      await invokeComplianceVision({
        provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
        requestId: 'local-request-1', signal: new AbortController().signal,
      }, { fetcher });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'COMPLIANCE_VISION_RESPONSE_INVALID', requestId: 'local-request-1', retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('cancels the response reader and reports caller cancellation during body reads', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        setTimeout(() => controller.abort(new DOMException('cancelled by user', 'AbortError')), 0);
        setTimeout(() => stream.error(new Error('late stream failure')), 20);
      },
      cancel,
    });
    const fetcher = vi.fn(async () => new Response(body, {
      headers: { 'x-request-id': 'body-request-1' },
    }));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: controller.signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_CANCELLED', requestId: 'body-request-1', retryable: false,
      submissionUnknown: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unsafe request id', 200, { 'x-request-id': 'unsafe/request' }],
    ['oversized content length', 200, { 'content-length': String(300 * 1024) }],
    ['HTTP error', 429, { 'x-request-id': 'request-429' }],
  ])('cancels the unconsumed response body for %s', async (_name, status, headers) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const fetcher = vi.fn(async () => new Response(body, { status, headers }));

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: new AbortController().signal,
    }, { fetcher })).rejects.toBeInstanceOf(ComplianceVisionError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['successful response', 200, { 'x-request-id': 'provider-request-1' }],
    ['HTTP rejection', 429, { 'x-request-id': 'provider-request-429' }],
    ['unsafe request id', 200, { 'x-request-id': 'unsafe/request' }],
  ])('prioritizes caller cancellation after fetch over %s', async (_name, status, headers) => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const fetcher = vi.fn(async () => {
      controller.abort(new DOMException('cancelled by user', 'AbortError'));
      return new Response(body, { status, headers });
    });

    await expect(invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: controller.signal,
    }, { fetcher })).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_CANCELLED',
      requestId: 'local-request-1',
      retryable: false,
      submissionUnknown: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unsafe request id', 200, { 'x-request-id': 'unsafe/request' }, 'local-request-1'],
    ['oversized content length', 200, {
      'x-request-id': 'provider-request-1', 'content-length': String(300 * 1024),
    }, 'provider-request-1'],
    ['HTTP rejection', 429, { 'x-request-id': 'provider-request-429' }, 'provider-request-429'],
  ])('preserves caller cancellation during asynchronous cleanup for %s', async (
    _name, status, headers, expectedRequestId,
  ) => {
    const controller = new AbortController();
    let markCleanupStarted!: () => void;
    let finishCleanup!: () => void;
    const cleanupStarted = new Promise<void>(resolve => { markCleanupStarted = resolve; });
    const cleanupPending = new Promise<void>(resolve => { finishCleanup = resolve; });
    const cancel = vi.fn(async () => {
      markCleanupStarted();
      await cleanupPending;
    });
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const fetcher = vi.fn(async () => new Response(body, { status, headers }));

    const execution = invokeComplianceVision({
      provider, modelId: 'gemini-vision-stable', imageInput: '/uploads/authorized.png', rules,
      requestId: 'local-request-1', signal: controller.signal,
    }, { fetcher });
    await cleanupStarted;
    controller.abort(new DOMException('cancelled during cleanup', 'AbortError'));
    finishCleanup();

    await expect(execution).rejects.toMatchObject({
      code: 'COMPLIANCE_VISION_CANCELLED',
      requestId: expectedRequestId,
      retryable: false,
      submissionUnknown: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
