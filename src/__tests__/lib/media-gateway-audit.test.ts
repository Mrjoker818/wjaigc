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

  it.each(['gateway_task_query', 'gateway_task_cancel'] as const)(
    'persists only redacted lifecycle facts for %s',
    async (action) => {
      const fullSecret = `wmg_${'q'.repeat(43)}`;
      await expect(auditGatewayEvent({
        action,
        outcome: 'failure',
        requestId: `req-${fullSecret}`,
        gatewayKeyId: 'gwkey_1',
        userId: 'user-1',
        responseStatus: 503,
        taskResult: { imageUrl: 'https://private.example/result.png' },
        providerApiKey: 'provider-secret',
        rawError: 'postgres://private-host/internal-error',
        authorization: `Bearer ${fullSecret}`,
      } as never)).resolves.toBe(true);

      const persisted = mocks.dbAddAuditLog.mock.calls[0][0];
      expect(persisted).toMatchObject({
        user_id: 'user-1',
        action,
        target_type: 'media_gateway_task',
        target_id: 'gwkey_1',
        level: 'warn',
        response_status: 503,
      });
      expect(persisted.request_data).toEqual({
        action,
        outcome: 'failure',
        requestId: 'req-[REDACTED]',
        gatewayKeyId: 'gwkey_1',
        userId: 'user-1',
        responseStatus: 503,
      });
      const serialized = JSON.stringify(persisted);
      expect(serialized).not.toContain(fullSecret);
      expect(serialized).not.toContain('private.example');
      expect(serialized).not.toContain('provider-secret');
      expect(serialized).not.toContain('private-host');
      expect(serialized).not.toContain('internal-error');
    },
  );

  it('bounds invalid lifecycle identifiers instead of persisting oversized values', async () => {
    await auditGatewayEvent({
      action: 'gateway_task_query',
      outcome: 'success',
      requestId: `req-${'a'.repeat(500)}`,
      gatewayKeyId: `gwkey-${'b'.repeat(500)}`,
      userId: `user-${'c'.repeat(500)}`,
      responseStatus: 200,
    } as never);

    expect(mocks.dbAddAuditLog.mock.calls[0][0].request_data).toEqual({
      action: 'gateway_task_query',
      outcome: 'success',
      requestId: '[REDACTED]',
      gatewayKeyId: '[REDACTED]',
      userId: '[REDACTED]',
      responseStatus: 200,
    });
  });
});
