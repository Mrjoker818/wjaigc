import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { getSessionUser as getAuthUser } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    // 认证检查：只有登录用户才能上传文件
    // 服务端内部调用（来自 localhost 的请求）自动放行
    const isInternalCall = request.headers.get('x-internal-call') === 'true' 
      || request.headers.get('host')?.startsWith('localhost')
      || request.headers.get('host')?.startsWith('127.0.0.1');
    if (!isInternalCall) {
      const user = await getAuthUser(request);
      if (!user) {
        return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Magic byte validation: verify the file is actually an image
    const IMAGE_SIGNATURES: Record<string, number[][]> = {
      'image/jpeg': [[0xFF, 0xD8, 0xFF]],
      'image/png': [[0x89, 0x50, 0x4E, 0x47]],
      'image/gif': [[0x47, 0x49, 0x46]],
      'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header (webp starts with RIFF)
      'image/svg+xml': [[0x3C]], // starts with <
      'image/bmp': [[0x42, 0x4D]],
    };
    const allowedSigs: number[][] = (IMAGE_SIGNATURES[file.type] || Object.values(IMAGE_SIGNATURES).flat()) as number[][];
    const headerBytes = Array.from(buffer.slice(0, 8));
    const isValidImage = allowedSigs.some((sig) => 
      sig.every((byte, idx) => headerBytes[idx] === byte)
    );
    if (!isValidImage && buffer.length > 8) {
      return NextResponse.json({ error: 'File content does not match image format' }, { status: 400 });
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'png';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `upload-${timestamp}-${random}.${ext}`;

    const { saveImageFile } = await import('@/lib/server-data-root');
    const url = await saveImageFile(buffer, filename, 'uploads');

    return NextResponse.json({
      success: true,
      url,
      filename,
      size: file.size,
      type: file.type,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error('Upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
