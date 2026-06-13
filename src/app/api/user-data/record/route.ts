import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { appendUserJsonl, ensureUserDataDirs, getUserDataDir } from '@/lib/server-user-storage';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

type DataArea = 'images' | 'chat' | 'projects' | 'uploads' | 'layers' | 'exports' | '3d';

const allowedAreas = new Set<DataArea>(['images', 'chat', 'projects', 'uploads', 'layers', 'exports', '3d']);

const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB limit for payload

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'asset';
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const ext = mime.includes('png') ? '.png'
    : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg'
    : mime.includes('webp') ? '.webp'
    : mime.includes('gif') ? '.gif'
    : mime.includes('json') ? '.json'
    : mime.includes('text') ? '.txt'
    : '.bin';
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  return { buffer, ext };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionUser = await getSessionUser(request);
    if (!sessionUser || !sessionUser.id) {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
    }
    // 安全红线：仅使用服务端会话的用户ID，绝不回退到客户端传值
    const userId = sessionUser.id;
    const requestedUserId = String(body.userId || '');
    const area = String(body.area || 'projects') as DataArea;
    if (!allowedAreas.has(area)) {
      return NextResponse.json({ success: false, error: 'Invalid data area' }, { status: 400 });
    }

    // Payload size limit
    const payloadStr = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload ?? '');
    if (payloadStr.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json({ success: false, error: 'Payload too large (max 10MB)' }, { status: 413 });
    }

    // 禁止跨用户写入（管理员也只能管理，不能将数据写入其他用户目录）
    if (requestedUserId && requestedUserId !== userId) {
      return NextResponse.json({ success: false, error: 'Cross-user write denied' }, { status: 403 });
    }
    await ensureUserDataDirs(userId);

    let storedFile: string | undefined;

    if (typeof body.dataUrl === 'string' && body.dataUrl.startsWith('data:')) {
      const decoded = decodeDataUrl(body.dataUrl);
      if (decoded) {
        const filename = safeFilename(String(body.filename || `${Date.now()}${decoded.ext}`));
        const finalName = filename.includes('.') ? filename : `${filename}${decoded.ext}`;
        const target = path.join(getUserDataDir(userId), area, `${Date.now()}_${finalName}`);
        await writeFile(target, decoded.buffer);
        storedFile = target;
      }
    } else if (typeof body.content === 'string') {
      const filename = safeFilename(String(body.filename || `${Date.now()}.json`));
      const target = path.join(getUserDataDir(userId), area, `${Date.now()}_${filename}`);
      await writeFile(target, body.content, 'utf8');
      storedFile = target;
    }

    await appendUserJsonl(userId, area, {
      type: body.type || 'record',
      filename: body.filename,
      storedFile,
      metadata: body.metadata || {},
      payload: body.payload,
    });

    return NextResponse.json({ success: true, storedFile });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record user data',
    }, { status: 500 });
  }
}
