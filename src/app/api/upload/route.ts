import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getServerDataRoot } from '@/lib/server-data-root';

export async function POST(request: NextRequest) {
  try {
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

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'png';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `upload-${timestamp}-${random}.${ext}`;

    const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
    const uploadDir = isProd
      ? path.join(getServerDataRoot(), 'uploads')
      : path.join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    // 生产环境也写入 public/uploads 以便静态服务
    let webPath: string;
    if (isProd) {
      const publicDir = path.join(process.cwd(), 'public', 'uploads');
      if (!existsSync(publicDir)) await mkdir(publicDir, { recursive: true });
      try { await copyFile(filePath, path.join(publicDir, filename)); } catch { /* ignore */ }
      webPath = '/api/serve-upload';
    } else {
      webPath = '/uploads';
    }

    // Return the URL path
    const url = `${webPath}/${filename}`;

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
