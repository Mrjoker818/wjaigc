import { dbAddAuditLog } from '@/lib/db-storage';

export type GatewayAuditAction =
  | 'gateway_key_issue'
  | 'gateway_key_update'
  | 'gateway_key_revoke';

export interface GatewayAuditEvent {
  actorId: string;
  actorName?: string;
  action: GatewayAuditAction;
  outcome: 'success' | 'failure';
  gatewayKeyId?: string;
  keyPrefix?: string;
  userId?: string;
  errorCode?: string | null;
  responseStatus?: number;
}

const SECRET_PATTERNS = [
  /wmg_[A-Za-z0-9_-]{43,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:sk|token|api[_-]?key)_[A-Za-z0-9_-]{20,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

function sanitizeAuditText(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return SECRET_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, '[REDACTED]'),
    value,
  );
}

export async function auditGatewayEvent(event: GatewayAuditEvent): Promise<boolean> {
  const actorId = sanitizeAuditText(event.actorId) ?? '[REDACTED]';
  const gatewayKeyId = sanitizeAuditText(event.gatewayKeyId);
  const facts = {
    outcome: event.outcome,
    gatewayKeyId,
    keyPrefix: sanitizeAuditText(event.keyPrefix),
    userId: sanitizeAuditText(event.userId),
    errorCode: sanitizeAuditText(event.errorCode),
    responseStatus: Number.isInteger(event.responseStatus) ? event.responseStatus : null,
  };

  try {
    const auditEntry = {
      user_id: actorId,
      user_name: sanitizeAuditText(event.actorName),
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
