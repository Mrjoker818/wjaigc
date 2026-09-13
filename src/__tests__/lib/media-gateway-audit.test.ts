import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dbAddAuditLog: vi.fn() }));

vi.mock('@/lib/db-storage', () => ({ dbAddAuditLog: mocks.dbAddAuditLog }));

import { auditGatewayEvent } from '@/lib/media-gateway/audit';

describe('media gateway audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbAddAuditLog.mockResolvedValue('audit-1');
  });

  it('persists only an allowlisted redacted gateway event', async () => {
    const unsafe = {
      actorId: 'admin-1',
      actorName: 'Administrator',
      action: 'gateway_key_issue',
      outcome: 'success',
      gatewayKeyId: 'gwkey_1',
      keyPrefix: 'wmg_abcd1234',
      userId: 'user-1',
      errorCode: null,
      secret: `wmg_${'s'.repeat(43)}`,
      keyHash: 'sha256-private-hash',
      prompt: 'private creative prompt',
      image: 'data:image/png;base64,private-image-content',
    };

    await expect(auditGatewayEvent(unsafe as never)).resolves.toBe(true);

    const persisted = mocks.dbAddAuditLog.mock.calls[0][0];
    const serialized = JSON.stringify(persisted);
    expect(persisted).toMatchObject({
      user_id: 'admin-1',
      user_name: 'Administrator',
      action: 'gateway_key_issue',
      target_type: 'media_gateway_key',
      target_id: 'gwkey_1',
      level: 'info',
    });
    expect(serialized).toContain('wmg_abcd1234');
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
    });

    const persisted = mocks.dbAddAuditLog.mock.calls[0][0];
    expect(persisted.level).toBe('warn');
    expect(JSON.stringify(persisted)).toContain('GATEWAY_INTERNAL_UNAVAILABLE');
    expect(persisted).not.toHaveProperty('error_message');
    expect(persisted).not.toHaveProperty('stack_trace');
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
