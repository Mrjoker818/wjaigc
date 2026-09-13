import type { APIRequestContext, APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import {
  createRecordedApiRequest,
  type RecordedApiRequest,
} from '../../../tests/helpers/media-gateway-e2e-evidence';

describe('media gateway API request evidence', () => {
  it('records gateway identifiers and strips query strings and sensitive response fields', async () => {
    const networkEntries: Array<Record<string, unknown>> = [];
    const recordedFacts: Array<Record<string, unknown>> = [];
    const payload = {
      requestId: 'req_evidence',
      gatewayRequestId: 'gateway_evidence',
      taskIds: ['task_evidence'],
      authorization: 'Bearer must-not-leak',
      nested: { apiKey: 'must-not-leak' },
    };
    const response = {
      status: () => 202,
      headers: () => ({ 'content-type': 'application/json; charset=utf-8' }),
      json: async () => payload,
    } as unknown as APIResponse;
    const request = {
      post: async () => response,
    } as unknown as APIRequestContext;
    const evidence = {
      record: (value: Record<string, unknown>) => recordedFacts.push(value),
      recordNetwork: (value: Record<string, unknown>) => networkEntries.push(value),
    } as unknown as Parameters<typeof createRecordedApiRequest>[1];

    const api: RecordedApiRequest = createRecordedApiRequest(request, evidence);
    await expect(api.post('/api/gateway/v1/images?token=secret', {
      headers: { authorization: 'Bearer must-not-leak' },
      data: { prompt: 'private prompt' },
    })).resolves.toBe(response);

    expect(networkEntries).toHaveLength(1);
    expect(networkEntries[0]).toMatchObject({
      method: 'POST',
      url: '/api/gateway/v1/images',
      status: 202,
      mimeType: 'application/json',
      requestId: 'req_evidence',
      gatewayRequestId: 'gateway_evidence',
      taskId: 'task_evidence',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    const serialized = JSON.stringify({ networkEntries, recordedFacts });
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('private prompt');
    expect(serialized).not.toContain('token=secret');
  });
});
