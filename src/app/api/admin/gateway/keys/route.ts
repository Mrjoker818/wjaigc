import { NextRequest, NextResponse } from 'next/server';

import { auditGatewayEvent, type GatewayAuditEvent } from '@/lib/media-gateway/audit';
import { GatewayError } from '@/lib/media-gateway/types';
import { issueGatewayKey, listGatewayKeys } from '@/lib/media-gateway/key-service';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const CREATE_FIELDS = new Set(['userId', 'label', 'requestsPerMinute', 'dailyQuota']);

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

function parseCreate(value: unknown) {
  if (!isObject(value) || Object.keys(value).some(field => !CREATE_FIELDS.has(field))) return null;
  if (
    typeof value.userId !== 'string' || value.userId.trim().length === 0 || value.userId.length > 200
    || typeof value.label !== 'string' || value.label.trim().length === 0 || value.label.length > 100
    || !Number.isInteger(value.requestsPerMinute) || Number(value.requestsPerMinute) < 1 || Number(value.requestsPerMinute) > 600
    || !Number.isInteger(value.dailyQuota) || Number(value.dailyQuota) < 0 || Number(value.dailyQuota) > 100_000
  ) return null;
  return {
    userId: value.userId,
    label: value.label,
    requestsPerMinute: value.requestsPerMinute as number,
    dailyQuota: value.dailyQuota as number,
  };
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return responseError(403, 'ADMIN_REQUIRED', 'Administrator access required');
  try {
    return NextResponse.json({ success: true, keys: await listGatewayKeys() });
  } catch (error) {
    return serviceError(error);
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return responseError(403, 'ADMIN_REQUIRED', 'Administrator access required');
  const input = parseCreate(await readJson(request));
  if (!input) {
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_issue',
      outcome: 'failure',
      errorCode: 'GATEWAY_INVALID_REQUEST',
      responseStatus: 400,
    });
    return responseError(400, 'GATEWAY_INVALID_REQUEST', 'Invalid gateway key request');
  }
  try {
    const issued = await issueGatewayKey({ ...input, createdBy: admin.id });
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_issue',
      outcome: 'success',
      gatewayKeyId: issued.key.id,
      keyPrefix: issued.key.keyPrefix,
      userId: issued.key.userId,
      responseStatus: 201,
    });
    return NextResponse.json({ success: true, ...issued }, { status: 201 });
  } catch (error) {
    await safeAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: 'gateway_key_issue',
      outcome: 'failure',
      userId: input.userId,
      errorCode: errorCode(error),
      responseStatus: errorStatus(error),
    });
    return serviceError(error);
  }
}
