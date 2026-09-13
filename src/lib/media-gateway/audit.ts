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
}

export async function auditGatewayEvent(event: GatewayAuditEvent): Promise<boolean> {
  const facts = {
    outcome: event.outcome,
    gatewayKeyId: event.gatewayKeyId ?? null,
    keyPrefix: event.keyPrefix ?? null,
    userId: event.userId ?? null,
    errorCode: event.errorCode ?? null,
  };

  try {
    const auditId = await dbAddAuditLog({
      user_id: event.actorId,
      user_name: event.actorName ?? null,
      action: event.action,
      target_type: 'media_gateway_key',
      target_id: event.gatewayKeyId ?? null,
      detail: JSON.stringify(facts),
      ip_address: null,
      created_at: Date.now(),
      level: event.outcome === 'success' ? 'info' : 'warn',
      request_data: facts,
      response_status: event.outcome === 'success' ? 200 : 500,
    });
    return auditId.length > 0;
  } catch {
    // Audit is best-effort after the authoritative mutation; callers must not retry it.
    return false;
  }
}
