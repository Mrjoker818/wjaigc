import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { deleteResource, listResources, saveResource } from '@/lib/desktop-cloud';
import { dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

function tags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  const resources = await listResources({
    type: request.nextUrl.searchParams.get('type') || undefined,
    enabledOnly: request.nextUrl.searchParams.get('enabled') === 'true',
  });
  return NextResponse.json({ success: true, resources });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin) return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  const body = await request.json();
  if (body.action === 'delete') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    const success = await deleteResource(id);
    await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'resource_delete', target_type: 'resource', target_id: id, detail: '', ip_address: null, created_at: Date.now() });
    return NextResponse.json({ success });
  }
  const resource = await saveResource({
    id: body.id ? String(body.id) : undefined,
    type: String(body.type || body.payload?.type || 'material'),
    name: String(body.name || body.payload?.name || '').trim(),
    description: String(body.description || body.payload?.description || ''),
    category: String(body.category || body.payload?.category || ''),
    tags: tags(body.tags || body.payload?.tags),
    thumbnailUrl: String(body.thumbnailUrl || body.payload?.thumbnailUrl || ''),
    content: String(body.content || body.payload?.content || ''),
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    enabled: body.enabled !== false,
    sortOrder: Number(body.sortOrder || body.sort_order || 0),
  });
  await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'resource_save', target_type: 'resource', target_id: resource.id, detail: resource.type, ip_address: null, created_at: Date.now() });
  return NextResponse.json({ success: true, resource });
}
