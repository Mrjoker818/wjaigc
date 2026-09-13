import { NextRequest, NextResponse } from 'next/server';

import { auditGatewayEvent, type GatewayAuditEvent } from '@/lib/media-gateway/audit';
import { updateGatewayKey, revokeGatewayKey } from '@/lib/media-gateway/key-service';
import { GatewayError } from '@/lib/media-gateway/types';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const UPDATE_FIELDS = new Set(['label', 'requestsPerMinute', 'dailyQuota', 'enabled']);
type RouteContext = { params: Promise<{ keyId: string }> };

function responseError(status: number, code: string, error: string, retryable = false): NextResponse {
  return NextResponse.json({ success: false, code, error, retryable }, { status });
}

function serviceError(error: unknown): NextResponse {
  if (error instanceof GatewayError) {
    const message = error.code === 'GATEWAY_INVALID_REQUEST'
      ? (error.status === 404 ? 'Gateway resource was not found' : 'Invalid gateway key request')
      : 'Media gateway is unavailable';
    return responseError(error.status, error.code, message, error.retryable);
  }
  return responseError(503, 'GATEWAY_INTERNAL_UNAVAILABLE', 'Media gateway is unavailable', true);
}

function errorCode(error: unknown): string {
  return error instanceof GatewayError ? error.code : 'GATEWAY_INTERNAL_UNAVAILABLE';
}

function errorStatus(error: unknown): number {
  return error instanceof GatewayError ? error.status : 503;
}

async function safeAudit(event: GatewayAuditEvent): Promise<void> {
  await auditGatewayEvent(event).catch(() => false);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseUpdate(value: unknown) {
  if (
    !isObject(value)
    || Object.keys(value).length === 0
    || Object.keys(value).some(field => !UPDATE_FIELDS.has(field))
  ) return null;
  if (value.label !== undefined && (
    typeof value.label !== 'string' || value.label.trim().length === 0 || value.label.length > 100
  )) return null;
  if (value.requestsPerMinute !== undefined && (
    !Number.isInteger(value.requestsPerMinute)
    || Number(value.requestsPerMinute) < 1
    || Number(value.requestsPerMinute) > 600
  )) return null;
  if (value.dailyQuota !== undefined && (
    !Number.isInteger(value.dailyQuota)
    || Number(value.dailyQuota) < 0
    || Number(value.dailyQuota) > 100_000
  )) return null;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return null;
  return value as {
    label?: string;
    requestsPerMinute?: number;
    dailyQuota?: number;
    enabled?: boolean;
  };
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await requireAdminUser(request);
  if (!admin) return responseError(403, 'ADMIN_REQUIRED', 'Administrator access required');
  const { keyId } = await context.params;
  const input = parseUpdate(await readJson(request));
  if (!input) {
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_update',
      outcome: 'failure',
      gatewayKeyId: keyId,
      errorCode: 'GATEWAY_INVALID_REQUEST',
      responseStatus: 400,
    });
    return responseError(400, 'GATEWAY_INVALID_REQUEST', 'Invalid gateway key request');
  }
  try {
    const key = await updateGatewayKey(keyId, input);
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_update',
      outcome: 'success',
      gatewayKeyId: key.id,
      keyPrefix: key.keyPrefix,
      userId: key.userId,
      responseStatus: 200,
    });
    return NextResponse.json({ success: true, key });
  } catch (error) {
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_update',
      outcome: 'failure',
      gatewayKeyId: keyId,
      errorCode: errorCode(error),
      responseStatus: errorStatus(error),
    });
    return serviceError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const admin = await requireAdminUser(request);
  if (!admin) return responseError(403, 'ADMIN_REQUIRED', 'Administrator access required');
  const { keyId } = await context.params;
  try {
    const key = await revokeGatewayKey(keyId);
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_revoke',
      outcome: 'success',
      gatewayKeyId: key.id,
      keyPrefix: key.keyPrefix,
      userId: key.userId,
      responseStatus: 200,
    });
    return NextResponse.json({ success: true, key });
  } catch (error) {
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_revoke',
      outcome: 'failure',
      gatewayKeyId: keyId,
      errorCode: errorCode(error),
      responseStatus: errorStatus(error),
    });
    return serviceError(error);
  }
}
