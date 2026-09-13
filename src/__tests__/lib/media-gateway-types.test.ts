import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  GatewayError,
  type GatewayAdmissionStatus,
  type GatewayErrorCode,
  type GatewayKeyRecord,
  type GatewayMediaType,
  type GatewayRequestRecord,
} from '@/lib/media-gateway/types';

describe('media gateway domain types', () => {
  it('expresses stable key and request records', () => {
    const key: GatewayKeyRecord = {
      id: 'gateway-key-1',
      userId: 'user-1',
      keyHash: 'sha256-hash',
      keyPrefix: 'wmg_test',
      label: 'production',
      requestsPerMinute: 60,
      dailyQuota: 1000,
      enabled: true,
      createdBy: 'admin-1',
      createdAt: '2026-09-13T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    const request: GatewayRequestRecord = {
      id: 'gateway-request-1',
      gatewayKeyId: key.id,
      userId: key.userId,
      idempotencyKey: 'request-key-1',
      requestDigest: 'request-sha256',
      mediaType: 'image',
      admissionStatus: 'reserved',
      taskIds: [],
      rejectionCode: null,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };

    expect(key.keyHash).toBe('sha256-hash');
    expect(request.gatewayKeyId).toBe(key.id);
    expectTypeOf(key).toMatchTypeOf<GatewayKeyRecord>();
    expectTypeOf(request).toMatchTypeOf<GatewayRequestRecord>();
    expectTypeOf(request.mediaType).toEqualTypeOf<GatewayMediaType>();
    expectTypeOf(request.admissionStatus).toEqualTypeOf<GatewayAdmissionStatus>();
  });

  it('keeps the public error code contract exhaustive and stable', () => {
    const codes = [
      'GATEWAY_DISABLED',
      'GATEWAY_AUTH_REQUIRED',
      'GATEWAY_KEY_INVALID',
      'GATEWAY_RATE_LIMITED',
      'GATEWAY_DAILY_QUOTA_EXCEEDED',
      'GATEWAY_IDEMPOTENCY_REQUIRED',
      'GATEWAY_IDEMPOTENCY_CONFLICT',
      'GATEWAY_BODY_TOO_LARGE',
      'GATEWAY_INVALID_REQUEST',
      'GATEWAY_TASK_NOT_FOUND',
      'GATEWAY_INTERNAL_UNAVAILABLE',
    ] as const satisfies readonly GatewayErrorCode[];

    expect(codes).toHaveLength(11);
    expectTypeOf<GatewayErrorCode>().toEqualTypeOf<(typeof codes)[number]>();
  });

  it('creates a named gateway error with retry metadata', () => {
    const error = new GatewayError(
      'GATEWAY_INTERNAL_UNAVAILABLE',
      503,
      'Gateway unavailable',
      true,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GatewayError');
    expect(error.message).toBe('Gateway unavailable');
    expect(error.code).toBe('GATEWAY_INTERNAL_UNAVAILABLE');
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it('defaults gateway errors to non-retryable', () => {
    const error = new GatewayError('GATEWAY_INVALID_REQUEST', 400, 'Invalid request');

    expect(error.retryable).toBe(false);
  });
});
