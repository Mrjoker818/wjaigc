import { NextRequest, NextResponse } from 'next/server';
import { dbAddAuditLog } from '@/lib/db-storage';
import { getSessionUser } from '@/lib/server-auth';
import { getOperationAuditAction, normalizeAuditPath } from '@/lib/operation-audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const method = String(body.method || 'POST').toUpperCase();
    const path = normalizeAuditPath(String(body.path || ''));
    const status = Number(body.status) || 0;
    const action = typeof body.action === 'string' && body.action.length <= 64
      ? body.action
      : getOperationAuditAction(path, method);
    const error = typeof body.error === 'string' ? body.error.slice(0, 300) : '';

    await dbAddAuditLog({
      user_id: user.id,
      user_name: user.name,
      action,
      target_type: 'api_request',
      target_id: path,
      detail: `${method} ${path}`,
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      created_at: Date.now(),
      level: status === 0 || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      error_message: error || (status >= 400 ? `HTTP ${status}` : null),
      stack_trace: null,
      request_data: null,
      response_status: status,
      duration_ms: Math.min(Math.max(Number(body.durationMs) || 0, 0), 3_600_000),
      model: null,
      provider_id: null,
      resolution_status: 'none',
      resolution_detail: null,
      resolved_at: null,
      resolved_by: null,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to record activity' }, { status: 400 });
  }
}
