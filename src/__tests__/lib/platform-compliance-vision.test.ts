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
});
