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
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求体格式错误，请检查JSON格式' }, { status: 400 });
  }
  if (body.action === 'delete') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    const success = await deleteResource(id);
    await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'resource_delete', target_type: 'resource', target_id: id, detail: '', ip_address: null, created_at: Date.now() });
    return NextResponse.json({ success });
  }
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload as Record<string, unknown>
    : {};
  const resource = await saveResource({
    id: body.id ? String(body.id) : undefined,
    type: String(body.type || payload.type || 'material'),
    name: String(body.name || payload.name || '').trim(),
    description: String(body.description || payload.description || ''),
    category: String(body.category || payload.category || ''),
    tags: tags(body.tags || payload.tags),
    thumbnailUrl: String(body.thumbnailUrl || payload.thumbnailUrl || ''),
    content: String(body.content || payload.content || ''),
    payload,
    enabled: body.enabled !== false,
    sortOrder: Number(body.sortOrder || body.sort_order || 0),
  });
  await dbAddAuditLog({ user_id: admin.id, user_name: admin.name, action: 'resource_save', target_type: 'resource', target_id: resource.id, detail: resource.type, ip_address: null, created_at: Date.now() });
  return NextResponse.json({ success: true, resource });
}
