import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn(),
}));

import { trustedGatewayContext } from '@/lib/media-gateway/internal-client';

const forgedHeaders = new Headers({
  'x-wujie-source-channel': 'gateway',
  'x-wujie-gateway-request-id': 'gwreq_1',
  'x-wujie-gateway-key-id': 'gwkey_1',
});

describe('trusted gateway source context', () => {
  it('ignores gateway headers from cookie callers and accepts them only for internal auth', () => {
    expect(trustedGatewayContext('cookie', forgedHeaders)).toBeUndefined();
    expect(trustedGatewayContext('desktop-token', forgedHeaders)).toBeUndefined();
    expect(trustedGatewayContext('internal', forgedHeaders)).toEqual({
      sourceChannel: 'gateway', gatewayRequestId: 'gwreq_1', gatewayKeyId: 'gwkey_1',
    });
  });

  it('sanitizes diagnostic ids instead of persisting arbitrary header content', () => {
    const headers = new Headers(forgedHeaders);
    headers.set('x-wujie-gateway-request-id', 'invalid/diagnostic@host');
    headers.set('x-wujie-gateway-key-id', 'gwkey_1,forged');

    expect(trustedGatewayContext('internal', headers)).toEqual({ sourceChannel: 'gateway' });
  });

  it.each([
    'src/app/api/generate/route.ts',
    'src/app/api/video/generate/route.ts',
  ])('%s persists only the context derived after authoritative authentication', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    const authIndex = source.indexOf('requireApiAuthOrReject(request)');
    const contextIndex = source.indexOf('trustedGatewayContext(', authIndex);
    const payloadIndex = source.indexOf('...gatewayContext', contextIndex);

    expect(authIndex).toBeGreaterThan(-1);
    expect(contextIndex).toBeGreaterThan(authIndex);
    expect(payloadIndex).toBeGreaterThan(contextIndex);
  });
});
