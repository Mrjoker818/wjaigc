import { dbAddAuditLog } from '@/lib/db-storage';

export type GatewayAuditAction =
  | 'gateway_key_issue'
  | 'gateway_key_update'
  | 'gateway_key_revoke'
  | 'gateway_task_query'
  | 'gateway_task_cancel';

interface GatewayKeyAuditEvent {
  actorId: string;
  actorName?: string;
  action: 'gateway_key_issue' | 'gateway_key_update' | 'gateway_key_revoke';
  outcome: 'success' | 'failure';
  gatewayKeyId?: string;
  keyPrefix?: string;
  userId?: string;
  errorCode?: string | null;
  responseStatus?: number;
}

interface GatewayTaskAuditEvent {
  action: 'gateway_task_query' | 'gateway_task_cancel';
  outcome: 'success' | 'failure';
  requestId: string;
  gatewayKeyId?: string;
  userId?: string;
  responseStatus: number;
}

export type GatewayAuditEvent = GatewayKeyAuditEvent | GatewayTaskAuditEvent;

const SECRET_PATTERNS = [
  /wmg_[A-Za-z0-9_-]{43,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:sk|token|api[_-]?key)_[A-Za-z0-9_-]{20,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

function sanitizeAuditText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return SECRET_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, '[REDACTED]'),
    value,
  );
}

function sanitizeAuditIdentifier(value: unknown): string | null {
  const sanitized = sanitizeAuditText(value);
  if (sanitized === null) return null;
  if (Buffer.byteLength(sanitized) > 200 || /[\u0000-\u001f\u007f]/.test(sanitized)) {
    return '[REDACTED]';
  }
  return sanitized;
}

function isTaskAuditEvent(event: GatewayAuditEvent): event is GatewayTaskAuditEvent {
  return event.action === 'gateway_task_query' || event.action === 'gateway_task_cancel';
}

export async function auditGatewayEvent(event: GatewayAuditEvent): Promise<boolean> {
  if (isTaskAuditEvent(event)) {
    const gatewayRequestId = sanitizeAuditIdentifier(event.requestId) ?? '[REDACTED]';
    const gatewayKeyId = sanitizeAuditIdentifier(event.gatewayKeyId);
    const userId = sanitizeAuditIdentifier(event.userId);
    const responseStatus = Number.isInteger(event.responseStatus) ? event.responseStatus : 500;
    const facts = Object.fromEntries(Object.entries({
      action: event.action,
      outcome: event.outcome,
      gatewayRequestId,
      gatewayKeyId,
      userId,
    }).filter(([, value]) => value !== null));

    try {
      const auditId = await dbAddAuditLog({
        user_id: userId ?? 'anonymous',
        user_name: null,
        action: event.action,
        target_type: 'media_gateway_task',
        target_id: gatewayKeyId,
        detail: JSON.stringify(facts),
        ip_address: null,
        created_at: Date.now(),
        level: event.outcome === 'success' ? 'info' : 'warn',
        request_data: facts,
        response_status: responseStatus,
      });
      return auditId.length > 0;
    } catch {
      return false;
    }
  }

  const actorId = sanitizeAuditText(event.actorId) ?? '[REDACTED]';
  const gatewayKeyId = sanitizeAuditIdentifier(event.gatewayKeyId);
  const facts = Object.fromEntries(Object.entries({
    action: event.action,
    outcome: event.outcome,
    gatewayKeyId,
    keyPrefix: sanitizeAuditIdentifier(event.keyPrefix),
    userId: sanitizeAuditIdentifier(event.userId),
    errorCode: sanitizeAuditIdentifier(event.errorCode ?? undefined),
  }).filter(([, value]) => value !== null));

  try {
    const auditEntry = {
      user_id: actorId,
      user_name: null,
      action: event.action,
      target_type: 'media_gateway_key',
      target_id: gatewayKeyId,
      detail: JSON.stringify(facts),
      ip_address: null,
      created_at: Date.now(),
      level: event.outcome === 'success' ? 'info' : 'warn',
      request_data: facts,
      ...(Number.isInteger(event.responseStatus) ? { response_status: event.responseStatus } : {}),
    };
    const auditId = await dbAddAuditLog(auditEntry);
    return auditId.length > 0;
  } catch {
    // Audit is best-effort after the authoritative mutation; callers must not retry it.
    return false;
  }
}
