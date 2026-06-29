import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { deleteBackup } from '@/lib/desktop-cloud';
import { dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  const { id } = await context.params;
  const success = await deleteBackup(id);
  await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'backup_delete', target_type: 'backup', target_id: id, detail: '', ip_address: null, created_at: Date.now() });
  return NextResponse.json({ success });
}
