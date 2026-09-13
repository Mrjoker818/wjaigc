import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readGatewayJson } from '@/lib/media-gateway/http';
import { trustedGatewayContext } from '@/lib/media-gateway/internal-client';
import {
  normalizeGatewayImageRequest,
  normalizeGatewayVideoRequest,
} from '@/lib/media-gateway/schema';

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/gateway/v1/images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('media gateway external security boundary', () => {
  it('rejects declared and streamed request bodies larger than one MiB', async () => {
    const declared = jsonRequest('{}', { 'content-length': '1048577' });
    await expect(readGatewayJson(declared)).rejects.toMatchObject({
      code: 'GATEWAY_BODY_TOO_LARGE',
      status: 413,
    });

    const streamed = jsonRequest(JSON.stringify({ prompt: 'x'.repeat(1_048_577) }));
    await expect(readGatewayJson(streamed)).rejects.toMatchObject({
      code: 'GATEWAY_BODY_TOO_LARGE',
      status: 413,
    });
  });

  it('rejects invalid JSON without returning parser or payload details', async () => {
    const secret = `wmg_${'s'.repeat(43)}`;
    const error = await readGatewayJson(jsonRequest(`{"prompt":"${secret}"`)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: 'GATEWAY_INVALID_REQUEST', status: 400 });
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).message)).not.toContain('Unexpected');
  });

  it.each([
    ['image', normalizeGatewayImageRequest, { prompt: 'safe', providerId: 'pear', modelId: 'image', metadata: { role: 'admin' } }],
    ['video', normalizeGatewayVideoRequest, { prompt: 'safe', providerId: 'pear', modelId: 'video', constructor: { prototype: { trusted: true } } }],
  ] as const)('rejects undeclared %s request fields instead of silently dropping them', (_kind, normalize, body) => {
    expect(() => normalize(body)).toThrowError(expect.objectContaining({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 400,
    }));
  });

  it('ignores externally forged trusted headers from cookie and desktop authentication', () => {
    const forged = new Headers({
      'x-wujie-source-channel': 'gateway',
      'x-wujie-gateway-request-id': 'gwreq_forged',
      'x-wujie-gateway-key-id': 'gwkey_forged',
      'x-wujie-internal-secret': 'forged-secret',
    });

    expect(trustedGatewayContext('cookie', forged)).toBeUndefined();
    expect(trustedGatewayContext('desktop-token', forged)).toBeUndefined();
    expect(trustedGatewayContext('internal', forged)).toEqual({
      sourceChannel: 'gateway',
      gatewayRequestId: 'gwreq_forged',
      gatewayKeyId: 'gwkey_forged',
    });
  });
});
