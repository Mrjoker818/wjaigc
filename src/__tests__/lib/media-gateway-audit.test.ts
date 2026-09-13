import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dbAddAuditLog: vi.fn() }));

vi.mock('@/lib/db-storage', () => ({ dbAddAuditLog: mocks.dbAddAuditLog }));

import { auditGatewayEvent } from '@/lib/media-gateway/audit';

describe('media gateway audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbAddAuditLog.mockResolvedValue('audit-1');
  });

  it('redacts secret-shaped values even inside allowlisted audit fields', async () => {
    const fullSecret = `wmg_${'s'.repeat(43)}`;
    const unsafe = {
      actorId: fullSecret,
      actorName: `Administrator ${fullSecret}`,
      action: 'gateway_key_issue',
      outcome: 'success',
      gatewayKeyId: fullSecret,
      keyPrefix: fullSecret,
      userId: fullSecret,
      errorCode: null,
      responseStatus: 201,
      secret: fullSecret,
      keyHash: 'sha256-private-hash',
      prompt: 'private creative prompt',
      image: 'data:image/png;base64,private-image-content',
    };

    await expect(auditGatewayEvent(unsafe as never)).resolves.toBe(true);

    const persisted = mocks.dbAddAuditLog.mock.calls[0][0];
    const serialized = JSON.stringify(persisted);
    expect(persisted).toMatchObject({
      action: 'gateway_key_issue',
      target_type: 'media_gateway_key',
      level: 'info',
      response_status: 201,
    });
    expect(persisted.user_id).toBe('[REDACTED]');
    expect(persisted.user_name).toBe('Administrator [REDACTED]');
    expect(persisted.target_id).toBe('[REDACTED]');
    expect(JSON.stringify(persisted.request_data)).not.toContain(fullSecret);
    expect(String(persisted.detail)).not.toContain(fullSecret);
    expect(serialized).not.toContain(fullSecret);
    expect(serialized).not.toContain(unsafe.secret);
    expect(serialized).not.toContain(unsafe.keyHash);
    expect(serialized).not.toContain(unsafe.prompt);
    expect(serialized).not.toContain(unsafe.image);
  });

  it('records a failure outcome with a stable error code and no exception text', async () => {
    await auditGatewayEvent({
      actorId: 'admin-1',
      action: 'gateway_key_revoke',
      outcome: 'failure',
      gatewayKeyId: 'gwkey_1',
      errorCode: 'GATEWAY_INTERNAL_UNAVAILABLE',
      responseStatus: 503,
    });

    const persisted = mocks.dbAddAuditLog.mock.calls[0][0];
    expect(persisted.level).toBe('warn');
    expect(persisted.response_status).toBe(503);
    expect(JSON.stringify(persisted)).toContain('GATEWAY_INTERNAL_UNAVAILABLE');
    expect(persisted).not.toHaveProperty('error_message');
    expect(persisted).not.toHaveProperty('stack_trace');
  });

  it('omits response_status when the caller cannot supply an exact status', async () => {
    await auditGatewayEvent({
      actorId: 'admin-1',
      action: 'gateway_key_update',
      outcome: 'failure',
      gatewayKeyId: 'gwkey_1',
      errorCode: 'GATEWAY_INTERNAL_UNAVAILABLE',
    });

    expect(mocks.dbAddAuditLog.mock.calls[0][0]).not.toHaveProperty('response_status');
  });

  it('returns false instead of throwing when persistent audit storage fails', async () => {
    mocks.dbAddAuditLog.mockRejectedValue(new Error('database unavailable'));

    await expect(auditGatewayEvent({
      actorId: 'admin-1',
      action: 'gateway_key_update',
      outcome: 'success',
      gatewayKeyId: 'gwkey_1',
    })).resolves.toBe(false);
  });

  it('treats the existing audit helper empty-id failure signal as not persisted', async () => {
    mocks.dbAddAuditLog.mockResolvedValue('');

    await expect(auditGatewayEvent({
      actorId: 'admin-1',
      action: 'gateway_key_update',
      outcome: 'success',
      gatewayKeyId: 'gwkey_1',
    })).resolves.toBe(false);
  });
});
